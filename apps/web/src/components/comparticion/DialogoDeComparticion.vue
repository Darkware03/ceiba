<script setup lang="ts">
/**
 * Diálogo de compartición (P7).
 *
 * Lo que pidió el cliente, literal: «debe permitir generar enlaces de
 * invitación para workspaces y colecciones; desde su respectiva pantalla debe
 * llevar un icono que permita configurar esto para que sea más rápido y
 * fácil, así como crear workspaces dedicados o compartir existentes».
 *
 * LA PRUEBA DE ACEPTACIÓN ES UN NÚMERO: DOS PULSACIONES
 * -----------------------------------------------------
 * «Que sea más rápido y fácil» se traduce en: dos pulsaciones desde la
 * pantalla hasta tener el enlace en el portapapeles.
 *
 *   1.ª  el icono de compartir de la tarjeta / de la cabecera
 *   2.ª  «Crear enlace y copiar»
 *
 * Por eso el botón principal **hace las dos cosas en un solo gesto**: crea y
 * copia. Partirlo en «Crear» y luego «Copiar» serían tres, y tres es
 * exactamente lo que el cliente dijo que sobraba. El rol y la caducidad ya
 * vienen con un valor por defecto razonable; quien quiera cambiarlos los
 * cambia antes de pulsar, pero no está obligado.
 *
 * QUÉ PASA SI EL PORTAPAPELES NO ESTÁ DISPONIBLE
 * ----------------------------------------------
 * `navigator.clipboard` no existe en contextos no seguros (HTTP plano) ni en
 * jsdom. En ese caso **el enlace no se pierde**: se pinta en un campo de sólo
 * lectura, seleccionado, y se avisa de que hay que copiarlo a mano. Un enlace
 * generado que desaparece porque la copia falló sería peor que no generarlo.
 *
 * «CREAR WORKSPACE DEDICADO O COMPARTIR EL EXISTENTE» (§3.3 del brief)
 * -------------------------------------------------------------------
 * El selector de arriba. Si se elige «uno nuevo y dedicado», se pide el
 * nombre, se crea el workspace y **se comparte el recién creado**, todo sin
 * salir del diálogo.
 */
import { computed, ref, watch } from 'vue';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import CeibaCampo from '@/components/ui/CeibaCampo.vue';
import CeibaDialogo from '@/components/ui/CeibaDialogo.vue';
import { mensajeDeError } from '@/api/errores';
import {
  PERMISOS_DE_COLECCION,
  crearEnlaceDeColeccion,
  invitarColaborador,
  listarEnlacesDeColeccion,
  listarInvitacionesWorkspace,
  revocarEnlaceDeColeccion,
  revocarInvitacion,
  type EnlaceDeColeccion,
} from '@/api/studio';
import { usarAlmacenDeWorkspaces } from '@/stores/workspaces';

const props = defineProps<{
  abierto: boolean;
  /** Qué se comparte. */
  tipo: 'workspace' | 'coleccion';
  /** Identificador del recurso. Para `coleccion`, el `collectionId`. */
  recursoId: string;
  /** Nombre legible, sólo para los textos del diálogo. */
  nombre: string;
}>();

const emitir = defineEmits<{ cerrar: [] }>();

const almacenWorkspaces = usarAlmacenDeWorkspaces();

/** Roles de workspace que el servidor acepta de verdad (`'owner'` lo descarta). */
const ROLES_DE_WORKSPACE = [
  { valor: 'viewer', etiqueta: 'Solo lectura' },
  { valor: 'executor', etiqueta: 'Puede ejecutar' },
  { valor: 'editor', etiqueta: 'Puede editar' },
  { valor: 'admin', etiqueta: 'Administrador' },
] as const;

/**
 * 1, 7 y 30 días y no otra cosa: `studio-collab.service.ts:209` recorta con
 * `Math.min(Math.max(input.expiresInDays ?? 7, 1), 30)`. Ofrecer «90 días» en
 * la interfaz sería ofrecer algo que el servidor va a convertir en 30 sin
 * decirlo.
 */
const CADUCIDADES = [
  { valor: 1, etiqueta: '1 día' },
  { valor: 7, etiqueta: '7 días' },
  { valor: 30, etiqueta: '30 días' },
] as const;

const DESTINO_EXISTENTE = 'existente';
const DESTINO_NUEVO = 'nuevo';

const destino = ref<string>(DESTINO_EXISTENTE);
const nombreDelNuevo = ref('');
const rol = ref<string>('viewer');
const dias = ref<number>(7);
const conCodigo = ref(false);

const trabajando = ref(false);
const error = ref<string | null>(null);
const copiado = ref(false);
const copiaManual = ref(false);

/** El enlace recién creado: lo único que el usuario quiere ver al terminar. */
const enlaceNuevo = ref<{ url: string; codigo: string | null; aviso: string | null } | null>(null);

interface FilaVigente {
  readonly id: string;
  readonly url: string;
  readonly etiqueta: string;
  readonly expiraEl: string | null;
  readonly origen: 'invitations' | 'shares';
}

const vigentes = ref<FilaVigente[]>([]);
const cargandoVigentes = ref(false);
const errorVigentes = ref<string | null>(null);
const revocando = ref<string | null>(null);

const esColeccion = computed(() => props.tipo === 'coleccion');

const opcionesDeRol = computed(() =>
  esColeccion.value
    ? PERMISOS_DE_COLECCION.map((p) => ({ valor: p.valor as string, etiqueta: p.etiqueta }))
    : ROLES_DE_WORKSPACE.map((r) => ({ valor: r.valor as string, etiqueta: r.etiqueta })),
);

const titulo = computed(() =>
  esColeccion.value ? `Compartir la colección «${props.nombre}»` : `Compartir «${props.nombre}»`,
);

/** Crear un workspace dedicado sólo tiene sentido compartiendo un workspace. */
const permiteWorkspaceDedicado = computed(() => !esColeccion.value);

const creandoDedicado = computed(
  () => permiteWorkspaceDedicado.value && destino.value === DESTINO_NUEVO,
);

const puedeEnviar = computed(() => {
  if (trabajando.value) return false;
  if (creandoDedicado.value) return nombreDelNuevo.value.trim().length > 0;
  return props.recursoId.length > 0;
});

const formateador = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' });

function fechaLegible(iso: string | null): string {
  if (iso === null) return 'Sin caducidad';
  const momento = new Date(iso);
  return Number.isNaN(momento.getTime()) ? '—' : `Caduca el ${formateador.format(momento)}`;
}

/*
 * `immediate: true` NO es decorativo: sin él, un diálogo que se monta **ya
 * abierto** nunca carga sus enlaces vigentes.
 *
 * Ocurre de verdad y lo cazó una prueba: `VistaDeWorkspaces.vue` monta este
 * componente con `v-if="aCompartir"`, así que su primer render ya trae
 * `abierto = true` y el observador, sin `immediate`, no llega a dispararse.
 * `VistaDeColeccion.vue` lo monta siempre y sólo cambia la prop, y ahí sí
 * saltaba. Dos vistas, dos comportamientos, un solo componente: eso es un
 * fallo del componente, no de las vistas.
 */
watch(
  () => props.abierto,
  (abierto) => {
    if (!abierto) return;
    reiniciar();
    void cargarVigentes();
  },
  { immediate: true },
);

function reiniciar(): void {
  destino.value = DESTINO_EXISTENTE;
  nombreDelNuevo.value = '';
  rol.value = esColeccion.value ? 'viewer' : 'viewer';
  dias.value = 7;
  conCodigo.value = false;
  error.value = null;
  copiado.value = false;
  copiaManual.value = false;
  enlaceNuevo.value = null;
  revocando.value = null;
}

/** Deriva un `slug` del nombre: el servidor lo exige y el usuario no debe teclearlo. */
function slugDe(nombre: string): string {
  const base = nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 40);
  // Sufijo corto para que dos «Equipo de API» no choquen con un 409 que el
  // usuario no puede resolver porque ni siquiera ve el slug.
  const sufijo = Math.random().toString(36).slice(2, 7);
  return base.length > 0 ? `${base}-${sufijo}` : `compartido-${sufijo}`;
}

/**
 * Copia al portapapeles. Devuelve `false` si el entorno no lo permite, y
 * entonces quien llama enseña el enlace para copiarlo a mano.
 */
async function copiar(texto: string): Promise<boolean> {
  try {
    const portapapeles = globalThis.navigator?.clipboard;
    if (portapapeles === undefined || typeof portapapeles.writeText !== 'function') return false;
    await portapapeles.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

/** El gesto único: crea el enlace y lo deja en el portapapeles. */
async function crearYCopiar(): Promise<void> {
  if (!puedeEnviar.value) return;
  trabajando.value = true;
  error.value = null;
  copiado.value = false;
  copiaManual.value = false;

  try {
    let url = '';
    let codigo: string | null = null;
    let aviso: string | null = null;

    if (esColeccion.value) {
      const enlace = await crearEnlaceDeColeccion(props.recursoId, {
        permiso: rol.value,
        dias: dias.value,
        conCodigo: conCodigo.value,
      });
      url = enlace.url;
      codigo = enlace.codigoDeAcceso;
      aviso = enlace.aviso;
    } else {
      const workspaceId = creandoDedicado.value
        ? await crearWorkspaceDedicado()
        : props.recursoId;
      if (workspaceId === null) return;
      const invitacion = await invitarColaborador(workspaceId, {
        role: rol.value as 'admin' | 'editor' | 'executor' | 'viewer',
        expiresInDays: dias.value,
      });
      url = invitacion.inviteUrl;
    }

    if (url.length === 0) {
      error.value = 'La API no devolvió ningún enlace utilizable.';
      return;
    }

    enlaceNuevo.value = { url, codigo, aviso };
    const copiadoOk = await copiar(url);
    copiado.value = copiadoOk;
    copiaManual.value = !copiadoOk;
    await cargarVigentes();
  } catch (fallo) {
    error.value = mensajeDeError(fallo);
  } finally {
    trabajando.value = false;
  }
}

/** Crea el workspace dedicado y devuelve su id, o `null` si la API lo rechazó. */
async function crearWorkspaceDedicado(): Promise<string | null> {
  const nombre = nombreDelNuevo.value.trim();
  const creado = await almacenWorkspaces.crear({
    name: nombre,
    slug: slugDe(nombre),
    description: null,
  });
  if (creado === null) {
    error.value = almacenWorkspaces.error ?? 'No se pudo crear el workspace.';
    return null;
  }
  return creado.id;
}

async function cargarVigentes(): Promise<void> {
  if (props.recursoId.length === 0) return;
  cargandoVigentes.value = true;
  errorVigentes.value = null;
  try {
    if (esColeccion.value) {
      const lista = await listarEnlacesDeColeccion(props.recursoId);
      vigentes.value = lista
        .filter((enlace: EnlaceDeColeccion) => !enlace.revocado && enlace.url.length > 0)
        .map((enlace) => ({
          id: enlace.id,
          url: enlace.url,
          etiqueta: enlace.etiquetaDePermiso,
          expiraEl: enlace.expiraEl,
          origen: enlace.origen,
        }));
    } else {
      const lista = await listarInvitacionesWorkspace(props.recursoId);
      vigentes.value = lista
        .filter((inv) => inv.status !== 'revoked' && inv.acceptedAt === null)
        .map((inv) => ({
          id: inv.id,
          url: inv.inviteUrl ?? '',
          etiqueta: inv.modeLabel.length > 0 ? inv.modeLabel : inv.role,
          expiraEl: inv.expiresAt,
          origen: 'invitations' as const,
        }));
    }
  } catch (fallo) {
    errorVigentes.value = mensajeDeError(fallo);
  } finally {
    cargandoVigentes.value = false;
  }
}

async function revocar(fila: FilaVigente): Promise<void> {
  revocando.value = fila.id;
  errorVigentes.value = null;
  try {
    if (esColeccion.value) {
      await revocarEnlaceDeColeccion(props.recursoId, { id: fila.id, origen: fila.origen });
    } else {
      await revocarInvitacion(props.recursoId, fila.id);
    }
    vigentes.value = vigentes.value.filter((v) => v.id !== fila.id);
  } catch (fallo) {
    errorVigentes.value = mensajeDeError(fallo);
  } finally {
    revocando.value = null;
  }
}

async function recopiar(): Promise<void> {
  const actual = enlaceNuevo.value;
  if (actual === null) return;
  const ok = await copiar(actual.url);
  copiado.value = ok;
  copiaManual.value = !ok;
}
</script>

<template>
  <CeibaDialogo
    :abierto="abierto"
    :titulo="titulo"
    descripcion="Genera un enlace que puedes pegar en un chat. Elige quién podrá hacer qué y cuánto durará."
    @cerrar="emitir('cerrar')"
  >
    <CeibaAviso v-if="error" tono="error" titulo="No se pudo crear el enlace">
      {{ error }}
    </CeibaAviso>

    <fieldset v-if="permiteWorkspaceDedicado" class="comparticion__grupo">
      <legend class="comparticion__leyenda">Qué se comparte</legend>
      <label class="comparticion__opcion">
        <input v-model="destino" type="radio" :value="DESTINO_EXISTENTE" />
        <span>Este workspace: <strong>{{ nombre }}</strong></span>
      </label>
      <label class="comparticion__opcion">
        <input v-model="destino" type="radio" :value="DESTINO_NUEVO" />
        <span>Un workspace nuevo y dedicado</span>
      </label>
    </fieldset>

    <CeibaCampo
      v-if="creandoDedicado"
      v-model="nombreDelNuevo"
      etiqueta="Nombre del workspace dedicado"
      ayuda="Se crea vacío y se comparte en el mismo gesto. El identificador se genera solo."
      marcador-de-posicion="Equipo de integración"
      requerido
    />

    <div class="comparticion__fila">
      <label class="comparticion__etiqueta">
        <span>{{ esColeccion ? 'Permiso' : 'Rol' }}</span>
        <select v-model="rol" class="comparticion__selector">
          <option v-for="opcion in opcionesDeRol" :key="opcion.valor" :value="opcion.valor">
            {{ opcion.etiqueta }}
          </option>
        </select>
      </label>

      <label class="comparticion__etiqueta">
        <span>Caducidad</span>
        <select v-model.number="dias" class="comparticion__selector">
          <option v-for="opcion in CADUCIDADES" :key="opcion.valor" :value="opcion.valor">
            {{ opcion.etiqueta }}
          </option>
        </select>
      </label>
    </div>

    <label v-if="esColeccion" class="comparticion__opcion">
      <input v-model="conCodigo" type="checkbox" />
      <span>
        Proteger con un código de acceso
        <small class="comparticion__pista">
          El código se muestra una sola vez y no se puede recuperar.
        </small>
      </span>
    </label>

    <div v-if="enlaceNuevo" class="comparticion__resultado">
      <CeibaAviso v-if="copiado" tono="exito" titulo="Enlace copiado al portapapeles">
        Ya lo puedes pegar donde quieras.
      </CeibaAviso>
      <CeibaAviso v-else-if="copiaManual" tono="aviso" titulo="Copia el enlace a mano">
        Este navegador no permite escribir en el portapapeles desde aquí.
      </CeibaAviso>

      <label class="comparticion__etiqueta">
        <span>Enlace</span>
        <input
          class="comparticion__enlace"
          type="text"
          readonly
          :value="enlaceNuevo.url"
          aria-label="Enlace de invitación generado"
          @focus="($event.target as HTMLInputElement).select()"
        />
      </label>

      <CeibaAviso v-if="enlaceNuevo.codigo" tono="aviso" titulo="Código de acceso">
        <code class="comparticion__codigo">{{ enlaceNuevo.codigo }}</code>
        <span v-if="enlaceNuevo.aviso" class="comparticion__pista">{{ enlaceNuevo.aviso }}</span>
      </CeibaAviso>

      <CeibaBoton compacto @click="recopiar">Copiar otra vez</CeibaBoton>
    </div>

    <section class="comparticion__vigentes" aria-labelledby="comparticion-vigentes">
      <h3 id="comparticion-vigentes" class="comparticion__subtitulo">Enlaces vigentes</h3>

      <CeibaAviso v-if="errorVigentes" tono="error">{{ errorVigentes }}</CeibaAviso>

      <p v-else-if="cargandoVigentes" class="comparticion__pista">
        Consultando los enlaces ya emitidos…
      </p>

      <p v-else-if="vigentes.length === 0" class="comparticion__pista">
        No hay ningún enlace activo todavía.
      </p>

      <ul v-else class="comparticion__lista">
        <li v-for="fila in vigentes" :key="fila.id" class="comparticion__item">
          <span class="comparticion__item-texto">
            <strong>{{ fila.etiqueta }}</strong>
            <small class="comparticion__pista">{{ fechaLegible(fila.expiraEl) }}</small>
          </span>
          <CeibaBoton
            compacto
            variante="peligro"
            :cargando="revocando === fila.id"
            :aria-label="`Revocar el enlace ${fila.etiqueta}`"
            @click="revocar(fila)"
          >
            Revocar
          </CeibaBoton>
        </li>
      </ul>
    </section>

    <template #acciones>
      <CeibaBoton @click="emitir('cerrar')">Cerrar</CeibaBoton>
      <CeibaBoton
        variante="primario"
        :cargando="trabajando"
        :deshabilitado="!puedeEnviar"
        @click="crearYCopiar"
      >
        Crear enlace y copiar
      </CeibaBoton>
    </template>
  </CeibaDialogo>
</template>

<style scoped>
.comparticion__grupo {
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-md);
  padding: var(--ceiba-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-2);
}

.comparticion__leyenda {
  padding: 0 var(--ceiba-space-1);
  font-size: var(--ceiba-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ceiba-text-faint);
}

.comparticion__opcion {
  display: flex;
  align-items: flex-start;
  gap: var(--ceiba-space-2);
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text);
  cursor: pointer;
}

.comparticion__fila {
  display: flex;
  gap: var(--ceiba-space-3);
  flex-wrap: wrap;
}

.comparticion__etiqueta {
  flex: 1;
  min-width: 180px;
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.comparticion__selector,
.comparticion__enlace {
  padding: var(--ceiba-space-2);
  border: 1px solid var(--ceiba-border-strong);
  border-radius: var(--ceiba-radius-md);
  background: var(--ceiba-surface);
  color: var(--ceiba-text);
  font-family: inherit;
  font-size: var(--ceiba-text-sm);
}

.comparticion__enlace {
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-xs);
}

.comparticion__resultado {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-3);
  padding-top: var(--ceiba-space-3);
  border-top: 1px solid var(--ceiba-border);
}

.comparticion__codigo {
  display: block;
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-md);
  color: var(--ceiba-text);
}

.comparticion__vigentes {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-2);
  padding-top: var(--ceiba-space-3);
  border-top: 1px solid var(--ceiba-border);
}

.comparticion__subtitulo {
  margin: 0;
  font-size: var(--ceiba-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ceiba-text-faint);
}

.comparticion__pista {
  display: block;
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

.comparticion__lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-2);
}

.comparticion__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ceiba-space-2);
}

.comparticion__item-texto {
  display: flex;
  flex-direction: column;
  min-width: 0;
  font-size: var(--ceiba-text-sm);
}
</style>
