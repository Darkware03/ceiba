<script setup lang="ts">
/**
 * Entornos y variables de un workspace.
 *
 * Tres decisiones que conviene dejar escritas:
 *
 *  1. **Todo valor visual sale de un token `--ceiba-*`** (BRIEF-FASE4 §2.1).
 *     La versión anterior usaba un vocabulario inexistente (`--espacio-*`,
 *     `--color-*`, `--ceiba-radio-*`…): el navegador descartaba esas
 *     declaraciones y la vista se quedaba sin estilo.
 *
 *  2. **Las variables secretas no se reescriben desde aquí.** La API acepta
 *     leerlas (`isSecret: true`, valor vacío) pero
 *     `PATCH /workspaces/:id/environments/:envId` **rechaza** `isSecret: true`
 *     al guardar, y mandar el array sin ellas las borraría: ese endpoint
 *     sustituye la tabla de variables entera. Comprobado en
 *     `apps/api/src/modules/studio/studio-core.service.ts`
 *     (`#aFilasDeVariables`, `actualizarEntorno`). Por eso, cuando el entorno
 *     tiene secretos, la rejilla pasa a solo lectura y el guardado omite
 *     `variables`: así las filas existentes quedan intactas en vez de
 *     desaparecer sin avisar.
 *
 *  3. **Toda espera enseña el logo girando** (`CeibaLoadingScreen`), y cada
 *     estado vacío o de error es explícito. El camino feliz solo no basta.
 *
 *  4. **Los permisos se leen de lo que la API devuelve de verdad.**
 *     `GET /workspaces/:id/settings` responde hoy plano
 *     (`{ id, name, …, myRole, counts, retentionPolicy }`), no
 *     `{ workspace, currentUserRole, canEdit }` como declara el tipo de
 *     `@/api/studio`. Comprobado en
 *     `apps/api/src/modules/studio/studio-core.service.ts:1565`. Confiar en
 *     `canEdit` dejaba la vista en solo lectura para todo el mundo, porque
 *     ese campo no llega. Aquí se aceptan las dos formas.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CeibaLoadingScreen } from '@ceiba/brand';

import { mensajeDeError } from '@/api/errores';
import {
  actualizarEntorno,
  crearEntorno,
  eliminarEntorno,
  listarEntornos,
  obtenerConfiguracionWorkspace,
  type ConfiguracionDeWorkspace,
  type EntornoDeWorkspace,
  type RolColaboracion,
  type VariableDeEntorno,
} from '@/api/studio';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import CeibaCampo from '@/components/ui/CeibaCampo.vue';
import CeibaDialogo from '@/components/ui/CeibaDialogo.vue';
import CeibaVacio from '@/components/ui/CeibaVacio.vue';
import { NOMBRES_RUTAS } from '@/router/nombres';
import { usarAlmacenDeWorkspaces } from '@/stores/workspaces';

/**
 * Jerarquía real del servidor (`JERARQUIA_ROLES` en
 * `apps/api/src/modules/studio/studio-collab.service.ts:33`). Crear y editar
 * entornos exige `editor`; `executor` queda por debajo y **no** puede.
 */
const RANGO_DE_ROL: Record<RolColaboracion, number> = {
  viewer: 10,
  executor: 20,
  editor: 30,
  admin: 40,
  owner: 50,
};

const RANGO_MINIMO_PARA_EDITAR = RANGO_DE_ROL.editor;

function esRol(valor: unknown): valor is RolColaboracion {
  return typeof valor === 'string' && Object.hasOwn(RANGO_DE_ROL, valor);
}

/** Fila editable de la rejilla: `value` nunca es `null` mientras se edita. */
interface FilaDeVariable {
  key: string;
  value: string;
  description: string;
  enabled: boolean;
  isSecret: boolean;
}

const almacenWorkspaces = usarAlmacenDeWorkspaces();
const ruta = useRoute();
const enrutador = useRouter();

const workspaceId = ref('');
const entornos = ref<EntornoDeWorkspace[]>([]);
const entornoActivoId = ref<string | null>(null);
const puedeEditar = ref(false);
const rolActual = ref<RolColaboracion | null>(null);

const cargandoEntornos = ref(false);
/** `true` en cuanto una carga de entornos ha terminado **con éxito**. */
const entornosCargados = ref(false);
const guardando = ref(false);
const creando = ref(false);
const eliminando = ref(false);

const errorCarga = ref<string | null>(null);
const errorAccion = ref<string | null>(null);
const errorNuevoNombre = ref<string | null>(null);
const exitoMensaje = ref<string | null>(null);

const nuevoNombre = ref('');
const nuevaDescripcion = ref('');
const nuevaUrlBase = ref('');

const nombreEdicion = ref('');
const descripcionEdicion = ref('');
const esPredeterminadoEdicion = ref(false);
const variablesEdicion = ref<FilaDeVariable[]>([]);

const dialogoDeBorradoAbierto = ref(false);

const entornoActivo = computed(
  () => entornos.value.find((entorno) => entorno.id === entornoActivoId.value) ?? null,
);

const hayWorkspaces = computed(() => almacenWorkspaces.lista.length > 0);

/** Vacío **confirmado** de workspaces: no es lo mismo que «todavía no se sabe». */
const sinWorkspaces = computed(() => almacenWorkspaces.estaVacia);

/**
 * Un entorno con secretos no se puede reescribir por esta ruta sin perderlos.
 * Mientras eso siga así, la rejilla es de solo lectura (decisión 2 de arriba).
 */
const hayVariablesSecretas = computed(() =>
  variablesEdicion.value.some((fila) => fila.isSecret),
);

const variablesEditables = computed(() => puedeEditar.value && !hayVariablesSecretas.value);

/** Validaciones de la rejilla: clave obligatoria, sin espacios y sin repetir. */
const problemasDeVariables = computed<string[]>(() => {
  const problemas: string[] = [];
  const vistas = new Map<string, number>();

  variablesEdicion.value.forEach((fila, indice) => {
    const clave = fila.key.trim();
    if (clave.length === 0) {
      problemas.push(`Fila ${indice + 1}: la clave está vacía.`);
      return;
    }
    if (/\s/u.test(clave)) {
      problemas.push(`Fila ${indice + 1}: «${clave}» no puede llevar espacios.`);
    }
    const anterior = vistas.get(clave);
    if (anterior !== undefined) {
      problemas.push(`«${clave}» está repetida (filas ${anterior + 1} y ${indice + 1}).`);
    } else {
      vistas.set(clave, indice);
    }
  });

  return problemas;
});

const puedeGuardar = computed(
  () =>
    puedeEditar.value &&
    nombreEdicion.value.trim().length > 0 &&
    (!variablesEditables.value || problemasDeVariables.value.length === 0),
);

function descripcionDeRol(rol: RolColaboracion | null): string {
  switch (rol) {
    case 'owner':
      return 'propietario';
    case 'admin':
      return 'administrador';
    case 'editor':
      return 'mostrar y editar';
    case 'executor':
      return 'mostrar y ejecutar';
    case 'viewer':
      return 'solo mostrar';
    default:
      return 'sin rol conocido';
  }
}

function contarVariables(entorno: EntornoDeWorkspace): string {
  const total = entorno.variables.length;
  return total === 1 ? '1 variable' : `${total} variables`;
}

/**
 * Permisos efectivos a partir de la respuesta de `/settings`.
 *
 * Se admite tanto la forma que declara el tipo (`currentUserRole`/`canEdit`)
 * como la que sirve hoy el servidor (`myRole`). Si sólo llega el rol, el
 * permiso se deriva de la misma jerarquía que aplica la API, en vez de
 * suponer que se puede editar (abrir de más) o que no (bloquear a todos).
 */
function permisosDeConfiguracion(datos: ConfiguracionDeWorkspace): {
  rol: RolColaboracion | null;
  puedeEditar: boolean;
} {
  const bruto = datos as unknown as Record<string, unknown>;
  const rolDeclarado: unknown = bruto['currentUserRole'];
  const rolServido: unknown = bruto['myRole'];
  const rol: RolColaboracion | null = esRol(rolDeclarado)
    ? rolDeclarado
    : esRol(rolServido)
      ? rolServido
      : null;

  const permisoDeclarado: unknown = bruto['canEdit'];
  const puedeEditar =
    typeof permisoDeclarado === 'boolean'
      ? permisoDeclarado
      : rol !== null && RANGO_DE_ROL[rol] >= RANGO_MINIMO_PARA_EDITAR;

  return { rol, puedeEditar };
}

/** `route.query.x` puede ser `string`, `null` o un array. Aquí se normaliza. */
function textoDeConsulta(valor: unknown): string {
  if (typeof valor === 'string') return valor;
  if (Array.isArray(valor)) {
    const primero: unknown = valor[0];
    return typeof primero === 'string' ? primero : '';
  }
  return '';
}

function aFila(variable: VariableDeEntorno): FilaDeVariable {
  return {
    key: variable.key,
    value: variable.value ?? '',
    description: variable.description ?? '',
    enabled: variable.enabled !== false,
    isSecret: variable.isSecret === true,
  };
}

function sincronizarFormulario(entorno: EntornoDeWorkspace | null): void {
  if (entorno === null) {
    nombreEdicion.value = '';
    descripcionEdicion.value = '';
    esPredeterminadoEdicion.value = false;
    variablesEdicion.value = [];
    return;
  }
  nombreEdicion.value = entorno.name;
  descripcionEdicion.value = entorno.description ?? '';
  esPredeterminadoEdicion.value = entorno.isDefault;
  variablesEdicion.value = entorno.variables.map(aFila);
}

function limpiarMensajesDeAccion(): void {
  errorAccion.value = null;
  exitoMensaje.value = null;
}

async function cargarWorkspaces(): Promise<void> {
  // El almacén ya cachea la lista: sólo se vuelve a pedir si no está cargada
  // o si la última vez falló (que es justo lo que hace «Reintentar»).
  if (!almacenWorkspaces.cargada || almacenWorkspaces.error !== null) {
    await almacenWorkspaces.cargar();
  }
  if (almacenWorkspaces.lista.length === 0) {
    workspaceId.value = '';
    return;
  }
  const solicitado = textoDeConsulta(ruta.query.workspaceId);
  const existe = almacenWorkspaces.lista.some((workspace) => workspace.id === solicitado);
  workspaceId.value = existe ? solicitado : (almacenWorkspaces.lista[0]?.id ?? '');
}

async function cargarEntornos(): Promise<void> {
  if (workspaceId.value === '') return;
  cargandoEntornos.value = true;
  errorCarga.value = null;
  try {
    const [lista, configuracion] = await Promise.all([
      listarEntornos(workspaceId.value),
      obtenerConfiguracionWorkspace(workspaceId.value),
    ]);
    const permisos = permisosDeConfiguracion(configuracion);
    entornos.value = lista.items;
    puedeEditar.value = permisos.puedeEditar;
    rolActual.value = permisos.rol;
    entornosCargados.value = true;
    const sigueVivo = entornos.value.some((entorno) => entorno.id === entornoActivoId.value);
    if (entornoActivoId.value === null || !sigueVivo) {
      entornoActivoId.value = entornos.value[0]?.id ?? null;
    }
    sincronizarFormulario(entornoActivo.value);
  } catch (error) {
    errorCarga.value = mensajeDeError(error);
  } finally {
    cargandoEntornos.value = false;
  }
}

async function manejarCrearEntorno(): Promise<void> {
  const nombre = nuevoNombre.value.trim();
  errorNuevoNombre.value = null;
  if (workspaceId.value === '') return;
  if (nombre.length === 0) {
    errorNuevoNombre.value = 'Escribe un nombre para el entorno.';
    return;
  }

  creando.value = true;
  limpiarMensajesDeAccion();
  try {
    const urlBase = nuevaUrlBase.value.trim();
    const creado = await crearEntorno(workspaceId.value, {
      name: nombre,
      description: nuevaDescripcion.value.trim() || undefined,
      isDefault: entornos.value.length === 0,
      variables:
        urlBase.length > 0
          ? [{ key: 'BASE_URL', value: urlBase, enabled: true }]
          : [],
    });
    nuevoNombre.value = '';
    nuevaDescripcion.value = '';
    nuevaUrlBase.value = '';
    entornoActivoId.value = creado.id;
    await cargarEntornos();
    exitoMensaje.value = `Entorno «${creado.name}» creado.`;
  } catch (error) {
    errorAccion.value = mensajeDeError(error);
  } finally {
    creando.value = false;
  }
}

function agregarFilaVariable(): void {
  variablesEdicion.value.push({
    key: '',
    value: '',
    description: '',
    enabled: true,
    isSecret: false,
  });
}

function quitarFilaVariable(indice: number): void {
  variablesEdicion.value.splice(indice, 1);
}

async function guardarCambiosEntorno(): Promise<void> {
  const idEntorno = entornoActivoId.value;
  if (workspaceId.value === '' || idEntorno === null || !puedeGuardar.value) return;

  guardando.value = true;
  limpiarMensajesDeAccion();
  try {
    // `variables` se omite cuando el entorno tiene secretos: enviarlo
    // reescribiría la tabla entera y los perdería (ver cabecera, decisión 2).
    const variables: VariableDeEntorno[] | undefined = variablesEditables.value
      ? variablesEdicion.value
          .filter((fila) => fila.key.trim().length > 0)
          .map((fila) => ({
            key: fila.key.trim(),
            value: fila.value,
            description: fila.description.trim() || null,
            enabled: fila.enabled,
          }))
      : undefined;

    const actualizado = await actualizarEntorno(workspaceId.value, idEntorno, {
      name: nombreEdicion.value.trim(),
      description: descripcionEdicion.value.trim() || null,
      isDefault: esPredeterminadoEdicion.value,
      ...(variables === undefined ? {} : { variables }),
    });
    entornoActivoId.value = actualizado.id;
    await cargarEntornos();
    exitoMensaje.value =
      variables === undefined
        ? 'Datos del entorno actualizados. Las variables no se han tocado.'
        : 'Entorno y variables actualizados.';
  } catch (error) {
    errorAccion.value = mensajeDeError(error);
  } finally {
    guardando.value = false;
  }
}

function pedirConfirmacionDeBorrado(): void {
  if (entornoActivo.value === null) return;
  dialogoDeBorradoAbierto.value = true;
}

async function confirmarBorrado(): Promise<void> {
  const idEntorno = entornoActivoId.value;
  if (workspaceId.value === '' || idEntorno === null) return;

  eliminando.value = true;
  limpiarMensajesDeAccion();
  const nombre = entornoActivo.value?.name ?? 'el entorno';
  try {
    await eliminarEntorno(workspaceId.value, idEntorno);
    entornoActivoId.value = null;
    dialogoDeBorradoAbierto.value = false;
    await cargarEntornos();
    exitoMensaje.value = `Entorno «${nombre}» eliminado.`;
  } catch (error) {
    errorAccion.value = mensajeDeError(error);
  } finally {
    eliminando.value = false;
  }
}

watch(workspaceId, (nuevo) => {
  entornoActivoId.value = null;
  entornos.value = [];
  entornosCargados.value = false;
  puedeEditar.value = false;
  rolActual.value = null;
  limpiarMensajesDeAccion();
  if (nuevo === '') return;
  // La URL dice qué workspace se está mirando: así el enlace es compartible.
  if (textoDeConsulta(ruta.query.workspaceId) !== nuevo) {
    void enrutador.replace({ query: { ...ruta.query, workspaceId: nuevo } });
  }
  void cargarEntornos();
});

watch(entornoActivoId, () => {
  sincronizarFormulario(entornoActivo.value);
});

onMounted(() => {
  void cargarWorkspaces();
});
</script>

<template>
  <section class="pagina" aria-labelledby="titulo-entornos">
    <header class="pagina__cabecera">
      <div class="pagina__intro">
        <p class="pagina__migas">Workspace · Entornos</p>
        <h1 id="titulo-entornos" class="pagina__titulo">Entornos y variables</h1>
        <p class="pagina__subtitulo">
          Define variables reutilizables como <code v-pre class="pagina__codigo">{{BASE_URL}}</code>
          o <code v-pre class="pagina__codigo">{{API_KEY}}</code> para interpolarlas en el
          Constructor y en las corridas de colecciones.
        </p>
      </div>

      <label v-if="hayWorkspaces" class="selector">
        <span class="selector__etiqueta">Workspace</span>
        <select
          v-model="workspaceId"
          class="selector__control"
          :disabled="cargandoEntornos || almacenWorkspaces.cargando"
        >
          <option v-for="workspace in almacenWorkspaces.lista" :key="workspace.id" :value="workspace.id">
            {{ workspace.name }}
          </option>
        </select>
      </label>
    </header>

    <!-- Estado: carga de la lista de workspaces -->
    <div v-if="almacenWorkspaces.cargando && !hayWorkspaces" class="espera">
      <CeibaLoadingScreen inline size="md" message="Cargando workspaces…" />
    </div>

    <!-- Estado: la lista de workspaces no se pudo cargar -->
    <CeibaAviso
      v-else-if="almacenWorkspaces.error !== null && !hayWorkspaces"
      tono="error"
      titulo="No se pudo cargar la lista de workspaces"
    >
      <p class="aviso__texto">{{ almacenWorkspaces.error }}</p>
      <CeibaBoton
        variante="secundario"
        compacto
        :cargando="almacenWorkspaces.cargando"
        @click="cargarWorkspaces"
      >
        Reintentar
      </CeibaBoton>
    </CeibaAviso>

    <!-- Estado: vacío confirmado, no hay ningún workspace -->
    <CeibaVacio
      v-else-if="sinWorkspaces"
      titulo="Todavía no hay ningún workspace"
      detalle="Los entornos viven dentro de un workspace. Crea uno y vuelve aquí para parametrizar URLs, cabeceras y credenciales."
    >
      <CeibaBoton variante="primario" @click="enrutador.push({ name: NOMBRES_RUTAS.WORKSPACES })">
        Ir a workspaces
      </CeibaBoton>
    </CeibaVacio>

    <template v-else-if="workspaceId !== ''">
      <CeibaAviso
        v-if="entornosCargados && !puedeEditar"
        tono="info"
        titulo="Modo solo lectura"
      >
        Tu rol en este workspace ({{ descripcionDeRol(rolActual) }}) permite consultar los entornos,
        pero no crearlos ni modificarlos.
      </CeibaAviso>

      <CeibaAviso
        v-if="errorCarga !== null"
        tono="error"
        titulo="No se pudieron cargar los entornos"
      >
        <p class="aviso__texto">{{ errorCarga }}</p>
        <CeibaBoton
          variante="secundario"
          compacto
          :cargando="cargandoEntornos"
          @click="cargarEntornos"
        >
          Reintentar
        </CeibaBoton>
      </CeibaAviso>

      <CeibaAviso v-if="errorAccion !== null" tono="error" titulo="La operación no se completó">
        {{ errorAccion }}
      </CeibaAviso>

      <CeibaAviso v-if="exitoMensaje !== null" tono="exito" titulo="Hecho">
        {{ exitoMensaje }}
      </CeibaAviso>

      <div class="disposicion">
        <CeibaLoadingScreen
          v-if="cargandoEntornos"
          inline
          size="md"
          message="Cargando entornos…"
          detail="GET /api/v1/workspaces/:id/environments"
        />

        <!-- Columna izquierda: alta y lista de entornos -->
        <aside class="panel" aria-labelledby="titulo-lista-entornos">
          <h2 id="titulo-lista-entornos" class="panel__titulo">Entornos del workspace</h2>

          <form v-if="puedeEditar" class="formulario" @submit.prevent="manejarCrearEntorno">
            <CeibaCampo
              v-model="nuevoNombre"
              etiqueta="Nuevo entorno"
              marcadorDePosicion="Desarrollo, Staging, Producción…"
              :error="errorNuevoNombre"
              requerido
              :deshabilitado="creando"
            />
            <CeibaCampo
              v-model="nuevaDescripcion"
              etiqueta="Descripción"
              ayuda="Opcional."
              marcadorDePosicion="Variables para pruebas locales"
              :deshabilitado="creando"
            />
            <CeibaCampo
              v-model="nuevaUrlBase"
              etiqueta="URL base"
              ayuda="Opcional. Si la rellenas se crea la variable BASE_URL con ese valor."
              marcadorDePosicion="https://api.ejemplo.com"
              monoespaciada
              :deshabilitado="creando"
            />
            <CeibaBoton tipo="submit" variante="primario" anchoCompleto :cargando="creando">
              Crear entorno
            </CeibaBoton>
          </form>

          <ul v-if="entornos.length > 0" class="lista">
            <li v-for="entorno in entornos" :key="entorno.id" class="lista__fila">
              <CeibaBoton
                class="lista__disparador"
                :class="{ 'lista__disparador--activo': entorno.id === entornoActivoId }"
                variante="fantasma"
                anchoCompleto
                :aria-current="entorno.id === entornoActivoId ? 'true' : undefined"
                @click="entornoActivoId = entorno.id"
              >
                <span class="lista__contenido">
                  <span class="lista__nombre">
                    {{ entorno.name }}
                    <span v-if="entorno.isDefault" class="insignia insignia--exito">
                      Predeterminado
                    </span>
                  </span>
                  <span class="lista__meta">{{ contarVariables(entorno) }}</span>
                </span>
              </CeibaBoton>
            </li>
          </ul>

          <CeibaVacio
            v-else-if="entornosCargados"
            titulo="Sin entornos creados"
            :detalle="
              puedeEditar
                ? 'Usa el formulario de arriba para crear el primero y parametrizar URLs y cabeceras.'
                : 'Este workspace todavía no tiene entornos y tu rol no permite crearlos.'
            "
          />
        </aside>

        <!-- Columna derecha: editor del entorno seleccionado -->
        <section class="panel" aria-labelledby="titulo-editor-entorno">
          <h2 id="titulo-editor-entorno" class="panel__titulo">
            {{ entornoActivo === null ? 'Editor de entorno' : entornoActivo.name }}
          </h2>

          <template v-if="entornoActivo !== null">
            <div class="editor__cabecera">
              <div class="editor__campos">
                <CeibaCampo
                  v-model="nombreEdicion"
                  etiqueta="Nombre del entorno"
                  requerido
                  :error="
                    nombreEdicion.trim().length === 0 ? 'El nombre no puede quedar vacío.' : null
                  "
                  :deshabilitado="!puedeEditar || guardando"
                />
                <CeibaCampo
                  v-model="descripcionEdicion"
                  etiqueta="Descripción"
                  ayuda="Opcional."
                  :deshabilitado="!puedeEditar || guardando"
                />
                <label class="casilla">
                  <input
                    v-model="esPredeterminadoEdicion"
                    type="checkbox"
                    class="casilla__control"
                    :disabled="!puedeEditar || guardando"
                  />
                  <span>Usar como entorno predeterminado del workspace</span>
                </label>
              </div>

              <div v-if="puedeEditar" class="editor__acciones">
                <CeibaBoton
                  variante="primario"
                  :cargando="guardando"
                  :deshabilitado="!puedeGuardar"
                  @click="guardarCambiosEntorno"
                >
                  Guardar cambios
                </CeibaBoton>
                <CeibaBoton
                  variante="peligro"
                  :deshabilitado="guardando || eliminando"
                  @click="pedirConfirmacionDeBorrado"
                >
                  Eliminar
                </CeibaBoton>
              </div>
            </div>

            <CeibaAviso
              v-if="hayVariablesSecretas"
              tono="aviso"
              titulo="Variables secretas: rejilla en solo lectura"
            >
              Este entorno tiene variables marcadas como secretas. La ruta
              <code class="pagina__codigo">PATCH /workspaces/:id/environments/:envId</code>
              rechaza <code class="pagina__codigo">isSecret: true</code> y sustituye la tabla de
              variables completa, así que reescribirla desde aquí las borraría. «Guardar cambios»
              actualiza nombre, descripción y predeterminado, y deja las variables intactas.
            </CeibaAviso>

            <CeibaAviso
              v-else-if="variablesEditables && problemasDeVariables.length > 0"
              tono="aviso"
              titulo="Revisa las variables antes de guardar"
            >
              <ul class="aviso__lista">
                <li v-for="problema in problemasDeVariables" :key="problema">{{ problema }}</li>
              </ul>
            </CeibaAviso>

            <div class="variables__cabecera">
              <h3 class="variables__titulo">
                Variables (<code v-pre class="pagina__codigo">{{clave}}</code>)
              </h3>
              <CeibaBoton
                v-if="variablesEditables"
                variante="secundario"
                compacto
                :deshabilitado="guardando"
                @click="agregarFilaVariable"
              >
                Añadir variable
              </CeibaBoton>
            </div>

            <table v-if="variablesEdicion.length > 0" class="tabla">
              <caption class="tabla__pie">
                Variables de «{{ entornoActivo.name }}». Las desactivadas no se interpolan.
              </caption>
              <thead>
                <tr>
                  <th scope="col" class="tabla__columna-estrecha">Activa</th>
                  <th scope="col">Clave</th>
                  <th scope="col">Valor</th>
                  <th scope="col">Descripción</th>
                  <th v-if="variablesEditables" scope="col" class="tabla__columna-estrecha">
                    <span class="tabla__encabezado-acciones">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(fila, indice) in variablesEdicion" :key="indice">
                  <td>
                    <input
                      v-model="fila.enabled"
                      type="checkbox"
                      class="casilla__control"
                      :disabled="!variablesEditables || guardando"
                      :aria-label="`Activar la variable ${fila.key || indice + 1}`"
                    />
                  </td>
                  <td>
                    <input
                      v-model="fila.key"
                      class="celda celda--mono"
                      type="text"
                      placeholder="BASE_URL"
                      :disabled="!variablesEditables || guardando"
                      :aria-label="`Clave de la variable ${indice + 1}`"
                    />
                  </td>
                  <td>
                    <div class="celda__valor">
                      <input
                        v-model="fila.value"
                        class="celda celda--mono"
                        type="text"
                        placeholder="https://api.ejemplo.com"
                        :disabled="!variablesEditables || guardando || fila.isSecret"
                        :aria-label="`Valor de la variable ${fila.key || indice + 1}`"
                      />
                      <span v-if="fila.isSecret" class="insignia insignia--aviso">Secreta</span>
                    </div>
                  </td>
                  <td>
                    <input
                      v-model="fila.description"
                      class="celda"
                      type="text"
                      placeholder="Para qué sirve"
                      :disabled="!variablesEditables || guardando"
                      :aria-label="`Descripción de la variable ${fila.key || indice + 1}`"
                    />
                  </td>
                  <td v-if="variablesEditables">
                    <CeibaBoton
                      variante="fantasma"
                      compacto
                      :deshabilitado="guardando"
                      @click="quitarFilaVariable(indice)"
                    >
                      Quitar
                    </CeibaBoton>
                  </td>
                </tr>
              </tbody>
            </table>

            <CeibaVacio
              v-else
              titulo="Este entorno no tiene variables"
              :detalle="
                variablesEditables
                  ? 'Añade la primera con el botón «Añadir variable»: su clave se interpola entre llaves dobles.'
                  : 'No hay variables definidas y tu rol no permite añadirlas.'
              "
            />
          </template>

          <CeibaVacio
            v-else-if="entornos.length > 0"
            titulo="Selecciona un entorno"
            detalle="Elige un entorno de la columna izquierda para administrar sus variables."
          />

          <CeibaVacio
            v-else-if="entornosCargados"
            titulo="Nada que editar todavía"
            detalle="Cuando exista al menos un entorno, aquí se editan su nombre y sus variables."
          />
        </section>
      </div>
    </template>

    <CeibaDialogo
      :abierto="dialogoDeBorradoAbierto"
      titulo="Eliminar entorno"
      descripcion="Esta operación no se puede deshacer."
      @cerrar="dialogoDeBorradoAbierto = false"
    >
      <p class="dialogo__texto">
        Se eliminará «{{ entornoActivo?.name ?? '' }}» y todas sus variables. Las peticiones que
        interpolen esas claves dejarán de resolverlas.
      </p>
      <template #acciones>
        <CeibaBoton
          variante="secundario"
          :deshabilitado="eliminando"
          @click="dialogoDeBorradoAbierto = false"
        >
          Cancelar
        </CeibaBoton>
        <CeibaBoton variante="peligro" :cargando="eliminando" @click="confirmarBorrado">
          Eliminar definitivamente
        </CeibaBoton>
      </template>
    </CeibaDialogo>
  </section>
</template>

<style scoped>
.pagina {
  max-width: 75rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-5);
}

.pagina__cabecera {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--ceiba-space-4);
  flex-wrap: wrap;
}

.pagina__intro {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
  max-width: 60ch;
}

.pagina__migas {
  margin: 0;
  font-size: var(--ceiba-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ceiba-text-faint);
}

.pagina__titulo {
  margin: 0;
  font-size: var(--ceiba-text-2xl);
  font-weight: 700;
  color: var(--ceiba-text);
}

.pagina__subtitulo {
  margin: 0;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.pagina__codigo {
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-xs);
  padding: 0 var(--ceiba-space-1);
  border-radius: var(--ceiba-radius-sm);
  background: var(--ceiba-surface-raised);
  color: var(--ceiba-text);
}

/* --- selector de workspace --- */

.selector {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-2);
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.selector__control {
  min-height: 34px;
  padding: 0 var(--ceiba-space-2);
  border: 1px solid var(--ceiba-border-strong);
  border-radius: var(--ceiba-radius-md);
  background: var(--ceiba-surface-raised);
  color: var(--ceiba-text);
  font-family: inherit;
  font-size: var(--ceiba-text-sm);
  cursor: pointer;
  transition: border-color var(--ceiba-duration-fast) var(--ceiba-ease);
}

.selector__control:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.selector__control:focus-visible {
  outline: none;
  box-shadow: var(--ceiba-focus-ring);
}

/* --- esperas y avisos --- */

.espera {
  position: relative;
  min-height: 12rem;
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-lg);
  background: var(--ceiba-surface);
}

.aviso__texto {
  margin: 0 0 var(--ceiba-space-2);
}

.aviso__lista {
  margin: 0;
  padding-left: var(--ceiba-space-5);
}

/* --- disposición en dos columnas --- */

.disposicion {
  position: relative;
  display: grid;
  grid-template-columns: 20rem 1fr;
  gap: var(--ceiba-space-5);
  align-items: start;
  min-height: 12rem;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-4);
  padding: var(--ceiba-space-4);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-lg);
  background: var(--ceiba-surface);
}

.panel__titulo {
  margin: 0;
  font-size: var(--ceiba-text-lg);
  font-weight: 600;
  color: var(--ceiba-text);
}

.formulario {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-3);
  padding-bottom: var(--ceiba-space-4);
  border-bottom: 1px solid var(--ceiba-border);
}

/* --- lista de entornos --- */

.lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-2);
}

.lista__fila .lista__disparador {
  justify-content: flex-start;
  text-align: left;
  padding: var(--ceiba-space-3);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-md);
  background: var(--ceiba-surface-raised);
}

.lista__fila .lista__disparador--activo {
  border-color: var(--ceiba-accent);
  background: var(--ceiba-accent-surface);
}

.lista__contenido {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
  width: 100%;
}

.lista__nombre {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-2);
  flex-wrap: wrap;
  font-weight: 600;
  color: var(--ceiba-text);
}

.lista__meta {
  font-size: var(--ceiba-text-xs);
  font-weight: 400;
  color: var(--ceiba-text-muted);
}

/* --- insignias de estado (no hay token de fondo teñido: superficie + color) --- */

.insignia {
  display: inline-block;
  padding: 0 var(--ceiba-space-2);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-pill);
  background: var(--ceiba-surface-raised);
  font-size: var(--ceiba-text-xs);
  font-weight: 500;
  white-space: nowrap;
}

.insignia--exito {
  color: var(--ceiba-success);
}

.insignia--aviso {
  color: var(--ceiba-warning);
}

/* --- editor --- */

.editor__cabecera {
  display: flex;
  justify-content: space-between;
  gap: var(--ceiba-space-4);
  flex-wrap: wrap;
}

.editor__campos {
  flex: 1 1 16rem;
  min-width: 16rem;
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-3);
}

.editor__acciones {
  display: flex;
  gap: var(--ceiba-space-2);
  align-items: flex-start;
  flex-wrap: wrap;
}

.casilla {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-2);
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.casilla__control {
  accent-color: var(--ceiba-accent);
}

.casilla__control:focus-visible {
  outline: none;
  box-shadow: var(--ceiba-focus-ring);
}

.casilla__control:disabled {
  cursor: not-allowed;
}

/* --- rejilla de variables --- */

.variables__cabecera {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--ceiba-space-3);
  flex-wrap: wrap;
}

.variables__titulo {
  margin: 0;
  font-size: var(--ceiba-text-md);
  font-weight: 600;
  color: var(--ceiba-text);
}

.tabla {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--ceiba-text-sm);
}

.tabla__pie {
  caption-side: bottom;
  padding-top: var(--ceiba-space-2);
  text-align: left;
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

.tabla th,
.tabla td {
  padding: var(--ceiba-space-2);
  border-bottom: 1px solid var(--ceiba-border);
  text-align: left;
  vertical-align: middle;
}

.tabla th {
  font-size: var(--ceiba-text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ceiba-text-faint);
}

.tabla__columna-estrecha {
  width: 1%;
  white-space: nowrap;
}

.tabla__encabezado-acciones {
  display: inline-block;
}

.celda {
  width: 100%;
  min-height: 30px;
  padding: var(--ceiba-space-1) var(--ceiba-space-2);
  border: 1px solid var(--ceiba-border-strong);
  border-radius: var(--ceiba-radius-sm);
  background: var(--ceiba-bg-sunken);
  color: var(--ceiba-text);
  font-family: inherit;
  font-size: var(--ceiba-text-sm);
  transition: border-color var(--ceiba-duration-fast) var(--ceiba-ease);
}

.celda--mono {
  font-family: var(--ceiba-font-mono);
}

.celda:focus-visible {
  outline: none;
  box-shadow: var(--ceiba-focus-ring);
}

.celda:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.celda__valor {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-2);
}

.dialogo__texto {
  margin: 0;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

@media (max-width: 60rem) {
  .disposicion {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .selector__control,
  .celda {
    transition: none;
  }
}
</style>
