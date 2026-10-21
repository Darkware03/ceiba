<script setup lang="ts">
/**
 * Aceptar una invitación a un workspace desde su enlace (`/invitacion/:token`).
 *
 * Lo que esta vista tiene que resolver, y que antes no resolvía:
 *
 *  1. **Los casos reales no son uno solo.** Un enlace puede estar bien, no
 *     existir, haber caducado, haber sido revocado, estar ya aceptado, o
 *     llevar a un workspace del que ya se es miembro. Cada caso tiene aquí su
 *     estado explícito (BRIEF-FASE4 §2.2.4): ninguno cae en un «no pasa nada».
 *
 *  2. **La espera lleva la marca girando.** Antes se pintaba un texto suelto
 *     («Verificando enlace…») sin identidad; ahora es `CeibaLoadingScreen`
 *     (§2.2.3).
 *
 *  3. **Con sesión y sin ella.** Tanto `GET /invitations/:token` como
 *     `POST /invitations/:token/accept` exigen sesión en la API
 *     (`@RutaAutenticadaSinRecurso`), así que un invitado sin sesión recibe
 *     401: se le dice con todas sus letras y se le lleva al acceso con
 *     `?redirect=` para volver aquí, en vez de dejar la tarjeta en blanco.
 *
 *  4. **Defensa de datos.** La respuesta de la API no trae hoy todos los
 *     campos que declara el tipo del cliente (ver informe de la fase): los
 *     textos se pintan sólo cuando llegan, nunca como «undefined».
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { CeibaLoadingScreen, CeibaMark } from '@ceiba/brand';

import { ErrorDeApi, mensajeDeError } from '@/api/errores';
import {
  aceptarInvitacionPorToken,
  consultarInvitacionPorToken,
  type InvitacionPublicaDto,
} from '@/api/studio';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import { NOMBRES_RUTAS } from '@/router/nombres';
import { usarAlmacenDeSesion } from '@/stores/sesion';
import { usarAlmacenDeWorkspaces } from '@/stores/workspaces';

interface ResultadoDeAceptacion {
  readonly alreadyMember: boolean;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly modo: string;
}

const route = useRoute();
const router = useRouter();
const almacenSesion = usarAlmacenDeSesion();
const almacenWorkspaces = usarAlmacenDeWorkspaces();

const token = computed(() => String(route.params['token'] ?? ''));

const invitacion = ref<InvitacionPublicaDto | null>(null);
const resultado = ref<ResultadoDeAceptacion | null>(null);
const cargando = ref(true);
const aceptando = ref(false);
const errorCarga = ref<string | null>(null);
const errorAceptacion = ref<string | null>(null);
const sesionRequerida = ref(false);

const formateadorDeFecha = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'long',
  timeStyle: 'short',
});

/** La API no siempre manda todos los campos del tipo: sólo se pinta lo que llega. */
function textoOVacio(valor: string | null | undefined): string {
  return typeof valor === 'string' && valor.trim() !== '' ? valor.trim() : '';
}

function fechaLegible(iso: string | null | undefined): string {
  const texto = textoOVacio(iso);
  if (texto === '') return '';
  const fecha = new Date(texto);
  return Number.isNaN(fecha.getTime()) ? texto : formateadorDeFecha.format(fecha);
}

function etiquetaDePermiso(rol: string | null | undefined, modo?: string | null): string {
  const declarado = textoOVacio(modo);
  if (declarado !== '') return declarado;
  const valor = textoOVacio(rol);
  if (valor === 'viewer') return 'Solo mostrar (lectura)';
  if (valor === 'editor') return 'Mostrar y editar (colaborador)';
  if (valor === 'executor') return 'Mostrar y ejecutar peticiones';
  if (valor === 'admin') return 'Administrar el workspace y sus miembros';
  if (valor === 'owner') return 'Propietario del workspace';
  return 'Permiso sin determinar';
}

const estadoInvitacion = computed(() => textoOVacio(invitacion.value?.status).toLowerCase());

const caducada = computed(() => {
  const inv = invitacion.value;
  if (inv === null) return false;
  if (inv.isExpired === true) return true;
  if (estadoInvitacion.value === 'expired') return true;
  const limite = textoOVacio(inv.expiresAt);
  if (limite === '') return false;
  const fecha = new Date(limite);
  return !Number.isNaN(fecha.getTime()) && fecha.getTime() < Date.now();
});

const yaAceptada = computed(() => estadoInvitacion.value === 'accepted');
const revocada = computed(
  () => estadoInvitacion.value === 'revoked' || estadoInvitacion.value === 'cancelled',
);
const aceptable = computed(
  () => invitacion.value !== null && !caducada.value && !yaAceptada.value && !revocada.value,
);

const etiquetaDeEstado = computed(() => {
  if (caducada.value) return 'Caducada';
  if (yaAceptada.value) return 'Ya aceptada';
  if (revocada.value) return 'Revocada';
  if (estadoInvitacion.value === 'pending') return 'Pendiente';
  return 'Estado sin determinar';
});

const claseDeEstado = computed(() => {
  if (caducada.value) return 'vista-invitacion__insignia--aviso';
  if (revocada.value) return 'vista-invitacion__insignia--error';
  if (yaAceptada.value) return 'vista-invitacion__insignia--exito';
  if (estadoInvitacion.value === 'pending') return 'vista-invitacion__insignia--activa';
  return 'vista-invitacion__insignia--neutra';
});

const nombreWorkspace = computed(() => textoOVacio(invitacion.value?.workspaceName));
const correoInvitado = computed(() => textoOVacio(invitacion.value?.email));
const invitadoPor = computed(() => {
  const nombre = textoOVacio(invitacion.value?.invitedByName);
  const correo = textoOVacio(invitacion.value?.invitedByEmail);
  if (nombre !== '' && correo !== '') return `${nombre} (${correo})`;
  return nombre !== '' ? nombre : correo;
});
const caducaEl = computed(() => fechaLegible(invitacion.value?.expiresAt));

const nombreWorkspaceResultado = computed(() => textoOVacio(resultado.value?.workspaceName));
const sinToken = computed(() => token.value === '');

function marcarFallo(fallo: unknown, destino: 'carga' | 'aceptacion'): void {
  if (fallo instanceof ErrorDeApi && fallo.esNoAutenticado) {
    sesionRequerida.value = true;
    return;
  }
  if (destino === 'carga') errorCarga.value = mensajeDeError(fallo);
  else errorAceptacion.value = mensajeDeError(fallo);
}

async function cargar(): Promise<void> {
  if (sinToken.value) {
    cargando.value = false;
    return;
  }
  cargando.value = true;
  errorCarga.value = null;
  sesionRequerida.value = false;
  try {
    invitacion.value = await consultarInvitacionPorToken(token.value);
  } catch (fallo) {
    invitacion.value = null;
    marcarFallo(fallo, 'carga');
  } finally {
    cargando.value = false;
  }
}

async function aceptar(): Promise<void> {
  if (sinToken.value || aceptando.value) return;
  aceptando.value = true;
  errorAceptacion.value = null;
  sesionRequerida.value = false;
  try {
    const respuesta = await aceptarInvitacionPorToken(token.value);
    resultado.value = {
      alreadyMember: respuesta.alreadyMember === true,
      workspaceId: textoOVacio(respuesta.workspaceId),
      workspaceName: textoOVacio(respuesta.workspaceName) || nombreWorkspace.value,
      modo: etiquetaDePermiso(respuesta.role, respuesta.modeLabel),
    };
    await almacenWorkspaces.cargar();
  } catch (fallo) {
    marcarFallo(fallo, 'aceptacion');
  } finally {
    aceptando.value = false;
  }
}

function abrirWorkspace(): void {
  const destino = resultado.value?.workspaceId ?? '';
  if (destino === '') {
    void router.push({ name: NOMBRES_RUTAS.WORKSPACES });
    return;
  }
  void router.push({
    name: NOMBRES_RUTAS.WORKSPACE_DETALLE,
    params: { workspaceId: destino },
  });
}

function irAMisWorkspaces(): void {
  void router.push({ name: NOMBRES_RUTAS.WORKSPACES });
}

function irAlAcceso(): void {
  void router.push({ name: NOMBRES_RUTAS.ACCESO, query: { redirect: route.fullPath } });
}

onMounted(() => {
  void cargar();
});
</script>

<template>
  <section class="vista-invitacion">
    <article class="vista-invitacion__tarjeta" aria-labelledby="titulo-invitacion">
      <CeibaLoadingScreen
        v-if="cargando"
        inline
        size="md"
        message="Verificando el enlace de invitación…"
      />
      <CeibaLoadingScreen
        v-else-if="aceptando"
        inline
        size="md"
        message="Uniéndote al workspace…"
        detail="Registrando tu membresía"
      />

      <header class="vista-invitacion__cabecera">
        <CeibaMark :size="40" class="vista-invitacion__marca" />
        <div>
          <p class="vista-invitacion__migas">Invitación colaborativa por enlace</p>
          <h1 id="titulo-invitacion" class="vista-invitacion__titulo">
            Unirse al espacio de trabajo
          </h1>
        </div>
      </header>

      <template v-if="sinToken">
        <CeibaAviso tono="error" titulo="Enlace incompleto">
          Este enlace no incluye ningún testigo de invitación. Pide a quien te invitó que te
          reenvíe el enlace completo.
        </CeibaAviso>
        <div class="vista-invitacion__acciones">
          <CeibaBoton variante="secundario" @click="irAMisWorkspaces">
            Ir a mis workspaces
          </CeibaBoton>
        </div>
      </template>

      <template v-else-if="sesionRequerida">
        <CeibaAviso tono="info" titulo="Necesitas iniciar sesión">
          Las invitaciones se aceptan con una cuenta de CEIBA. Inicia sesión (o crea tu cuenta)
          y volverás a esta misma invitación.
        </CeibaAviso>
        <div class="vista-invitacion__acciones">
          <CeibaBoton variante="primario" @click="irAlAcceso">Iniciar sesión</CeibaBoton>
          <CeibaBoton variante="secundario" @click="irAMisWorkspaces">
            Ir a mis workspaces
          </CeibaBoton>
        </div>
      </template>

      <template v-else-if="resultado">
        <CeibaAviso
          v-if="resultado.alreadyMember"
          tono="info"
          titulo="Ya eras miembro de este workspace"
        >
          Tu acceso sigue activo{{
            nombreWorkspaceResultado ? ` en «${nombreWorkspaceResultado}»` : ''
          }}. No se ha creado ninguna membresía nueva.
        </CeibaAviso>
        <CeibaAviso v-else tono="exito" titulo="Invitación aceptada">
          Ya formas parte{{
            nombreWorkspaceResultado ? ` de «${nombreWorkspaceResultado}»` : ' del workspace'
          }}.
        </CeibaAviso>

        <dl class="vista-invitacion__info">
          <div class="vista-invitacion__fila">
            <dt>Permiso</dt>
            <dd>
              <span class="vista-invitacion__insignia vista-invitacion__insignia--activa">
                {{ resultado.modo }}
              </span>
            </dd>
          </div>
        </dl>

        <div class="vista-invitacion__acciones">
          <CeibaBoton variante="primario" @click="abrirWorkspace">Abrir el workspace</CeibaBoton>
          <CeibaBoton variante="secundario" @click="irAMisWorkspaces">
            Ir a mis workspaces
          </CeibaBoton>
        </div>
      </template>

      <template v-else-if="errorCarga">
        <CeibaAviso tono="error" titulo="Esta invitación no es válida">
          {{ errorCarga }}
        </CeibaAviso>
        <p class="vista-invitacion__nota">
          Puede que el enlace esté incompleto, que se haya revocado o que el workspace ya no
          exista. Pide una invitación nueva a quien administre el espacio.
        </p>
        <div class="vista-invitacion__acciones">
          <CeibaBoton variante="secundario" :cargando="cargando" @click="cargar">
            Reintentar
          </CeibaBoton>
          <CeibaBoton variante="secundario" @click="irAMisWorkspaces">
            Ir a mis workspaces
          </CeibaBoton>
        </div>
      </template>

      <template v-else-if="invitacion">
        <dl class="vista-invitacion__info">
          <div class="vista-invitacion__fila">
            <dt>Workspace</dt>
            <dd>
              <strong v-if="nombreWorkspace">{{ nombreWorkspace }}</strong>
              <span v-else class="vista-invitacion__sin-dato">
                La API no ha devuelto el nombre del workspace
              </span>
            </dd>
          </div>
          <div v-if="invitadoPor" class="vista-invitacion__fila">
            <dt>Invitado por</dt>
            <dd>{{ invitadoPor }}</dd>
          </div>
          <div v-if="correoInvitado" class="vista-invitacion__fila">
            <dt>Dirigida a</dt>
            <dd>{{ correoInvitado }}</dd>
          </div>
          <div class="vista-invitacion__fila">
            <dt>Permiso</dt>
            <dd>
              <span class="vista-invitacion__insignia vista-invitacion__insignia--activa">
                {{ etiquetaDePermiso(invitacion.role, invitacion.modeLabel) }}
              </span>
            </dd>
          </div>
          <div class="vista-invitacion__fila">
            <dt>Estado</dt>
            <dd>
              <span class="vista-invitacion__insignia" :class="claseDeEstado">
                {{ etiquetaDeEstado }}
              </span>
            </dd>
          </div>
          <div v-if="caducaEl" class="vista-invitacion__fila">
            <dt>{{ caducada ? 'Caducó el' : 'Caduca el' }}</dt>
            <dd>{{ caducaEl }}</dd>
          </div>
        </dl>

        <CeibaAviso v-if="caducada" tono="aviso" titulo="Invitación caducada">
          El plazo de este enlace ha terminado, así que ya no se puede aceptar. Pide a quien te
          invitó que genere una invitación nueva.
        </CeibaAviso>
        <CeibaAviso v-else-if="revocada" tono="error" titulo="Invitación revocada">
          Un administrador del workspace retiró esta invitación. Necesitas un enlace nuevo.
        </CeibaAviso>
        <CeibaAviso v-else-if="yaAceptada" tono="info" titulo="Invitación ya aceptada">
          Este enlace se usó antes. Si ya tienes acceso, entra desde tus workspaces; si no,
          pide una invitación nueva.
        </CeibaAviso>
        <CeibaAviso
          v-else-if="!almacenSesion.autenticado"
          tono="info"
          titulo="Inicia sesión para aceptarla"
        >
          La invitación sigue activa, pero hace falta una cuenta de CEIBA para unirse al
          workspace.
        </CeibaAviso>

        <CeibaAviso v-if="errorAceptacion" tono="error" titulo="No se pudo aceptar la invitación">
          {{ errorAceptacion }}
        </CeibaAviso>

        <div class="vista-invitacion__acciones">
          <CeibaBoton
            v-if="aceptable && almacenSesion.autenticado"
            variante="primario"
            :cargando="aceptando"
            @click="aceptar"
          >
            Aceptar invitación
          </CeibaBoton>
          <CeibaBoton
            v-else-if="aceptable"
            variante="primario"
            @click="irAlAcceso"
          >
            Iniciar sesión y aceptar
          </CeibaBoton>
          <CeibaBoton variante="secundario" @click="irAMisWorkspaces">
            Ir a mis workspaces
          </CeibaBoton>
        </div>
      </template>
    </article>
  </section>
</template>

<style scoped>
.vista-invitacion {
  max-width: 620px;
  margin: var(--ceiba-space-7) auto;
  padding: 0 var(--ceiba-space-4);
}

.vista-invitacion__tarjeta {
  position: relative;
  min-height: 18rem;
  background: var(--ceiba-surface);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-lg);
  padding: var(--ceiba-space-6);
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-4);
}

.vista-invitacion__cabecera {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-3);
}

.vista-invitacion__marca {
  color: var(--ceiba-accent);
  flex: none;
}

.vista-invitacion__migas {
  margin: 0;
  font-size: var(--ceiba-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ceiba-text-faint);
}

.vista-invitacion__titulo {
  margin: var(--ceiba-space-1) 0 0;
  font-size: var(--ceiba-text-xl);
}

.vista-invitacion__info {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-2);
  margin: 0;
  padding: var(--ceiba-space-4);
  border-radius: var(--ceiba-radius-md);
  background: var(--ceiba-surface-raised);
  border: 1px solid var(--ceiba-border);
}

.vista-invitacion__fila {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--ceiba-space-3);
  font-size: var(--ceiba-text-sm);
}

.vista-invitacion__fila dt {
  color: var(--ceiba-text-muted);
}

.vista-invitacion__fila dd {
  margin: 0;
  text-align: right;
  color: var(--ceiba-text);
  overflow-wrap: anywhere;
}

.vista-invitacion__sin-dato {
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

.vista-invitacion__insignia {
  display: inline-block;
  padding: var(--ceiba-space-1) var(--ceiba-space-3);
  border-radius: var(--ceiba-radius-pill);
  background: var(--ceiba-surface-overlay);
  border: 1px solid var(--ceiba-border-strong);
  color: var(--ceiba-text-muted);
  font-size: var(--ceiba-text-xs);
  font-weight: 600;
}

.vista-invitacion__insignia--activa {
  color: var(--ceiba-accent);
  border-color: var(--ceiba-accent);
}

.vista-invitacion__insignia--exito {
  color: var(--ceiba-success);
  border-color: var(--ceiba-success);
}

.vista-invitacion__insignia--aviso {
  color: var(--ceiba-warning);
  border-color: var(--ceiba-warning);
}

.vista-invitacion__insignia--error {
  color: var(--ceiba-danger);
  border-color: var(--ceiba-danger);
}

.vista-invitacion__insignia--neutra {
  color: var(--ceiba-text-muted);
  border-color: var(--ceiba-border-strong);
}

.vista-invitacion__nota {
  margin: 0;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.vista-invitacion__acciones {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ceiba-space-3);
  justify-content: flex-end;
}

@media (max-width: 560px) {
  .vista-invitacion__fila {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--ceiba-space-1);
  }

  .vista-invitacion__fila dd {
    text-align: left;
  }

  .vista-invitacion__acciones {
    justify-content: stretch;
  }
}
</style>
