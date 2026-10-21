<script setup lang="ts">
/**
 * Pantalla «Historial»: bitácora de auditoría, peticiones ya ejecutadas y
 * versiones de colección de un workspace.
 *
 * Los cuatro estados que exige el estándar (BRIEF-FASE4 §2.2.4) están
 * separados y no se pisan:
 *
 *  - **cargando**: `CeibaLoadingScreen` en modo `inline` (el giro de la marca
 *    de `@ceiba/brand`). Para las recargas, el botón «Actualizar» lleva
 *    `:cargando`, que también muestra la marca girando. No hay ni un
 *    indicador de actividad propio, a propósito.
 *  - **error**: `CeibaAviso` con el mensaje de la API y un reintento. El
 *    error **no borra** lo ya cargado: un fallo de red pasajero no debe
 *    convertirse en una pantalla que afirme que no hay historial.
 *  - **vacío**: se distingue «no hay nada registrado» de «el filtro no
 *    encuentra nada», porque son dos problemas distintos del usuario.
 *  - **con datos**: las tres tablas.
 *
 * Las pestañas son pestañas de verdad (`role="tablist"`/`role="tab"` con
 * `aria-selected` y `aria-controls`), siguiendo el patrón de
 * `VistaDeConstructor.vue`. No son botones: `CeibaBoton` no representa una
 * pestaña y usarlo aquí mentiría a los lectores de pantalla.
 *
 * Todo valor visual sale de un token `--ceiba-*` de `@ceiba/brand`.
 */
import { computed, onMounted, ref, useId, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CeibaLoadingScreen } from '@ceiba/brand';

import { METODOS_PERMITIDOS, type MetodoDeSolicitud } from '@/api/ejecucion';
import { mensajeDeError } from '@/api/errores';
import {
  listarHistorialModificaciones,
  listarHistorialPeticiones,
  type EntradaHistorialPeticion,
  type EventoDeAuditoria,
  type VersionDeColeccion,
} from '@/api/studio';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import CeibaCampo from '@/components/ui/CeibaCampo.vue';
import CeibaVacio from '@/components/ui/CeibaVacio.vue';
import { NOMBRES_RUTAS } from '@/router/nombres';
import { usarAlmacenDeConstructor } from '@/stores/constructor';
import { usarAlmacenDeWorkspaces } from '@/stores/workspaces';

type Pestana = 'cambios' | 'peticiones' | 'versiones';

/** Tope de eventos de auditoría que pide esta pantalla. */
const LIMITE_DE_EVENTOS = 100;
/** Tope de peticiones ejecutadas que pide esta pantalla. */
const LIMITE_DE_PETICIONES = 80;

const route = useRoute();
const router = useRouter();
const almacenWorkspaces = usarAlmacenDeWorkspaces();
const almacenConstructor = usarAlmacenDeConstructor();

/* Identificadores únicos: `aria-controls` y `<label for>` necesitan ids
 * estables y que no choquen si la vista se monta dos veces. */
const idBase = useId();
const idSelector = `historial-workspace-${idBase}`;
const idDePestana = (pestana: Pestana): string => `historial-pestana-${pestana}-${idBase}`;
const idDePanel = (pestana: Pestana): string => `historial-panel-${pestana}-${idBase}`;

const workspaceId = ref('');
const pestanaActiva = ref<Pestana>('cambios');
const cargando = ref(false);
/** `true` en cuanto una carga ha terminado **con éxito** para este workspace. */
const cargado = ref(false);
const errorMensaje = ref<string | null>(null);

const eventos = ref<EventoDeAuditoria[]>([]);
const versiones = ref<VersionDeColeccion[]>([]);
const peticiones = ref<EntradaHistorialPeticion[]>([]);
const filtro = ref('');
const entradaSeleccionada = ref<EntradaHistorialPeticion | null>(null);

const ETIQUETAS_ACCION: Record<string, string> = {
  'workspace.created': 'Creó el workspace',
  'workspace.updated': 'Renombró el workspace',
  'workspace.deleted': 'Eliminó el workspace',
  'workspace.member_invited': 'Generó invitación al workspace',
  'workspace.member_joined': 'Se unió al workspace por invitación',
  'workspace.member_role_changed': 'Cambió permisos de colaborador',
  'workspace.member_removed': 'Eliminó colaborador del workspace',
  'collection.created': 'Creó colección',
  'collection.updated': 'Modificó colección',
  'collection.deleted': 'Eliminó colección',
  'collection.imported': 'Importó colección JSON',
  'collection.exported': 'Exportó colección JSON',
  'collection.version_created': 'Guardó versión de colección',
  'folder.created': 'Creó carpeta',
  'folder.updated': 'Modificó carpeta',
  'folder.deleted': 'Eliminó carpeta',
  'request.created': 'Creó petición HTTP',
  'request.updated': 'Modificó petición HTTP',
  'request.deleted': 'Eliminó petición HTTP',
  'request.executed': 'Ejecutó petición HTTP',
  'environment.created': 'Creó entorno',
  'environment.updated': 'Modificó variables de entorno',
  'environment.deleted': 'Eliminó entorno',
  'collection_run.completed': 'Ejecutó corrida de colección',
};

function traducirAccion(action: string): string {
  return ETIQUETAS_ACCION[action] ?? action;
}

const cargandoWorkspaces = computed(
  () => almacenWorkspaces.cargando && !almacenWorkspaces.cargada,
);
const sinWorkspaces = computed(() => almacenWorkspaces.estaVacia);
/** Primera carga de este workspace: todavía no hay nada que enseñar debajo. */
const primeraCarga = computed(() => cargando.value && !cargado.value);

const eventosFiltrados = computed(() => {
  const texto = filtro.value.trim().toLowerCase();
  if (texto === '') return eventos.value;
  return eventos.value.filter(
    (evento) =>
      traducirAccion(evento.action).toLowerCase().includes(texto) ||
      (evento.actorName ?? '').toLowerCase().includes(texto) ||
      (evento.actorEmail ?? '').toLowerCase().includes(texto) ||
      evento.resourceType.toLowerCase().includes(texto) ||
      JSON.stringify(evento.metadata ?? {})
        .toLowerCase()
        .includes(texto),
  );
});

const peticionesFiltradas = computed(() => {
  const texto = filtro.value.trim().toLowerCase();
  if (texto === '') return peticiones.value;
  return peticiones.value.filter(
    (entrada) =>
      entrada.resolvedUrl.toLowerCase().includes(texto) ||
      entrada.method.toLowerCase().includes(texto) ||
      entrada.userName.toLowerCase().includes(texto) ||
      (entrada.environmentName ?? '').toLowerCase().includes(texto),
  );
});

const versionesFiltradas = computed(() => {
  const texto = filtro.value.trim().toLowerCase();
  if (texto === '') return versiones.value;
  return versiones.value.filter(
    (version) =>
      version.collectionName.toLowerCase().includes(texto) ||
      (version.label ?? '').toLowerCase().includes(texto) ||
      (version.notes ?? '').toLowerCase().includes(texto) ||
      version.createdByName.toLowerCase().includes(texto),
  );
});

async function cargarDatos(): Promise<void> {
  if (workspaceId.value === '') return;
  cargando.value = true;
  errorMensaje.value = null;
  try {
    const [modificaciones, ejecutadas] = await Promise.all([
      listarHistorialModificaciones(workspaceId.value, LIMITE_DE_EVENTOS),
      listarHistorialPeticiones(workspaceId.value, LIMITE_DE_PETICIONES),
    ]);
    eventos.value = modificaciones.items;
    versiones.value = modificaciones.versions;
    peticiones.value = ejecutadas.items;
    cargado.value = true;
  } catch (error) {
    // Lo ya cargado se deja intacto: ver la cabecera del fichero.
    errorMensaje.value = mensajeDeError(error);
  } finally {
    cargando.value = false;
  }
}

/** `METODOS_PERMITIDOS` es el vocabulario cerrado del contrato del motor. */
function esMetodoDelContrato(metodo: string): metodo is MetodoDeSolicitud {
  return (METODOS_PERMITIDOS as readonly string[]).includes(metodo);
}

function clasesDeMetodo(metodo: string): string[] {
  const normalizado = metodo.toLowerCase();
  return esMetodoDelContrato(metodo.toUpperCase())
    ? ['ceiba-metodo', `ceiba-metodo--${normalizado}`]
    : ['ceiba-metodo'];
}

/**
 * El constructor sólo admite los métodos del contrato. Si el historial trae
 * otro, el botón se deshabilita en vez de reabrirlo como `GET`: cambiar el
 * método por la espalda sería ejecutar algo distinto de lo que se pidió.
 */
function esReabrible(entrada: EntradaHistorialPeticion): boolean {
  return esMetodoDelContrato(entrada.method.toUpperCase());
}

function reabrirEnConstructor(entrada: EntradaHistorialPeticion): void {
  const metodo = entrada.method.toUpperCase();
  if (!esMetodoDelContrato(metodo)) return;
  almacenConstructor.cargarDesdePeticionGuardada({
    workspaceId: entrada.workspaceId,
    requestId: entrada.requestId ?? undefined,
    method: metodo,
    url: entrada.resolvedUrl,
  });
  void router.push({ name: NOMBRES_RUTAS.CONSTRUCTOR });
}

function irAWorkspaces(): void {
  void router.push({ name: NOMBRES_RUTAS.WORKSPACES });
}

function formatearFecha(iso: string): string {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return iso;
  return fecha.toLocaleString('es-SV', { dateStyle: 'medium', timeStyle: 'medium' });
}

function respuestaCorrecta(entrada: EntradaHistorialPeticion): boolean {
  return entrada.responseStatus !== null && entrada.responseStatus < 400;
}

function etiquetaDeEstado(entrada: EntradaHistorialPeticion): string {
  if (entrada.responseStatus !== null) return String(entrada.responseStatus);
  return 'Sin respuesta';
}

function duracionLegible(ms: number | null): string {
  return ms === null ? '—' : `${ms} ms`;
}

function resumirMetadatos(meta: Record<string, unknown> | null): string {
  if (meta === null) return '';
  const partes: string[] = [];
  if (typeof meta.name === 'string') partes.push(`Nombre: «${meta.name}»`);
  if (typeof meta.method === 'string') partes.push(`Método: ${meta.method}`);
  if (typeof meta.url === 'string') partes.push(`URL: ${meta.url}`);
  if (typeof meta.role === 'string') partes.push(`Rol: ${meta.role}`);
  if (typeof meta.email === 'string') partes.push(`Correo: ${meta.email}`);
  if (typeof meta.label === 'string') partes.push(`Versión: ${meta.label}`);
  if (partes.length > 0) return partes.join(' · ');
  return Object.entries(meta)
    .map(([clave, valor]) => `${clave}: ${typeof valor === 'object' ? JSON.stringify(valor) : String(valor)}`)
    .join(' · ');
}

function cuerpoDeLaEntrada(entrada: EntradaHistorialPeticion): string {
  return entrada.responseBodyPreview ?? entrada.errorMessage ?? '(La API no guardó cuerpo de respuesta para esta petición.)';
}

watch(workspaceId, (nuevo) => {
  entradaSeleccionada.value = null;
  cargado.value = false;
  eventos.value = [];
  versiones.value = [];
  peticiones.value = [];
  if (nuevo !== '') void cargarDatos();
});

onMounted(async () => {
  if (!almacenWorkspaces.cargada) await almacenWorkspaces.cargar();
  // Workspace de la consulta si es uno al que se tiene acceso; si no, el
  // primero de la lista; si no hay ninguno, estado vacío explícito.
  const pedido = typeof route.query.workspaceId === 'string' ? route.query.workspaceId : '';
  const existe = pedido !== '' && almacenWorkspaces.porId(pedido) !== null;
  workspaceId.value = existe ? pedido : (almacenWorkspaces.lista[0]?.id ?? '');
});
</script>

<template>
  <section class="historial" aria-labelledby="historial-titulo">
    <header class="historial__cabecera">
      <div>
        <h1 id="historial-titulo">Historial de cambios y ejecuciones</h1>
        <p class="historial__subtitulo">
          Bitácora auditable de las modificaciones del equipo y de las peticiones HTTP ya
          ejecutadas en este workspace.
        </p>
      </div>

      <div class="historial__controles">
        <div class="historial__selector">
          <label class="historial__etiqueta" :for="idSelector">Workspace</label>
          <select
            :id="idSelector"
            v-model="workspaceId"
            class="historial__select"
            :disabled="almacenWorkspaces.lista.length === 0"
          >
            <option v-if="almacenWorkspaces.lista.length === 0" value="">Sin workspaces</option>
            <option v-for="ws in almacenWorkspaces.lista" :key="ws.id" :value="ws.id">
              {{ ws.name }}
            </option>
          </select>
        </div>
        <CeibaBoton
          variante="secundario"
          :cargando="cargando"
          :deshabilitado="workspaceId === ''"
          @click="cargarDatos()"
        >
          Actualizar
        </CeibaBoton>
      </div>
    </header>

    <CeibaAviso
      v-if="almacenWorkspaces.error"
      tono="error"
      titulo="No se pudo cargar la lista de workspaces"
    >
      {{ almacenWorkspaces.error }}
      <p class="historial__reintento">
        <CeibaBoton
          compacto
          :cargando="almacenWorkspaces.cargando"
          @click="almacenWorkspaces.cargar()"
        >
          Reintentar
        </CeibaBoton>
      </p>
    </CeibaAviso>

    <CeibaAviso v-if="errorMensaje" tono="error" titulo="No se pudo cargar el historial">
      {{ errorMensaje }}
      <p class="historial__reintento">
        <CeibaBoton compacto :cargando="cargando" @click="cargarDatos()">Reintentar</CeibaBoton>
      </p>
    </CeibaAviso>

    <div v-if="cargandoWorkspaces" class="historial__espera">
      <CeibaLoadingScreen inline message="Cargando workspaces…" detail="GET /api/v1/workspaces" />
    </div>

    <CeibaVacio
      v-else-if="sinWorkspaces"
      titulo="Todavía no hay ningún workspace"
      detalle="El historial se registra por workspace. Crea el primero para que haya una bitácora que mostrar."
    >
      <CeibaBoton variante="primario" @click="irAWorkspaces()">Ir a workspaces</CeibaBoton>
    </CeibaVacio>

    <template v-else>
      <div class="historial__barra">
        <div class="historial__pestanas" role="tablist" aria-label="Secciones del historial">
          <button
            :id="idDePestana('cambios')"
            class="historial__pestana"
            :class="{ 'historial__pestana--activa': pestanaActiva === 'cambios' }"
            type="button"
            role="tab"
            :aria-selected="pestanaActiva === 'cambios'"
            :aria-controls="idDePanel('cambios')"
            @click="pestanaActiva = 'cambios'"
          >
            Modificaciones y auditoría ({{ eventos.length }})
          </button>
          <button
            :id="idDePestana('peticiones')"
            class="historial__pestana"
            :class="{ 'historial__pestana--activa': pestanaActiva === 'peticiones' }"
            type="button"
            role="tab"
            :aria-selected="pestanaActiva === 'peticiones'"
            :aria-controls="idDePanel('peticiones')"
            @click="pestanaActiva = 'peticiones'"
          >
            Ejecuciones HTTP ({{ peticiones.length }})
          </button>
          <button
            :id="idDePestana('versiones')"
            class="historial__pestana"
            :class="{ 'historial__pestana--activa': pestanaActiva === 'versiones' }"
            type="button"
            role="tab"
            :aria-selected="pestanaActiva === 'versiones'"
            :aria-controls="idDePanel('versiones')"
            @click="pestanaActiva = 'versiones'"
          >
            Versiones de colecciones ({{ versiones.length }})
          </button>
        </div>

        <div class="historial__filtro">
          <CeibaCampo
            v-model="filtro"
            etiqueta="Filtrar historial"
            tipo="search"
            marcador-de-posicion="Usuario, acción, recurso o URL…"
            ayuda="El filtro se aplica sólo a lo que ya está cargado en pantalla."
          />
        </div>
      </div>

      <!-- Pestaña 1: modificaciones y auditoría -->
      <div
        v-if="pestanaActiva === 'cambios'"
        :id="idDePanel('cambios')"
        class="historial__panel"
        role="tabpanel"
        :aria-labelledby="idDePestana('cambios')"
        tabindex="0"
      >
        <div v-if="primeraCarga" class="historial__espera">
          <CeibaLoadingScreen
            inline
            message="Cargando la bitácora de cambios…"
            detail="GET /api/v1/workspaces/:id/history/changes"
          />
        </div>

        <CeibaVacio
          v-else-if="eventos.length === 0"
          titulo="Sin cambios registrados todavía"
          detalle="Cada creación o modificación de colecciones, carpetas, peticiones, entornos o miembros quedará registrada aquí."
        />

        <CeibaVacio
          v-else-if="eventosFiltrados.length === 0"
          titulo="El filtro no encuentra ningún cambio"
          :detalle="`Hay ${eventos.length} cambios cargados, pero ninguno coincide con «${filtro.trim()}».`"
        >
          <CeibaBoton compacto @click="filtro = ''">Quitar el filtro</CeibaBoton>
        </CeibaVacio>

        <div v-else class="historial__tabla-contenedor">
          <table class="historial__tabla">
            <caption class="ceiba-oculto-visual">
              Modificaciones registradas en la auditoría del workspace
            </caption>
            <thead>
              <tr>
                <th scope="col">Fecha y hora</th>
                <th scope="col">Usuario</th>
                <th scope="col">Acción realizada</th>
                <th scope="col">Recurso</th>
                <th scope="col">Detalle del cambio</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="evento in eventosFiltrados" :key="evento.id">
                <td class="historial__mono">{{ formatearFecha(evento.occurredAt) }}</td>
                <td>
                  <strong>{{ evento.actorName || 'Usuario' }}</strong>
                  <div v-if="evento.actorEmail" class="historial__suave">
                    {{ evento.actorEmail }}
                  </div>
                </td>
                <td><span class="historial__chip">{{ traducirAccion(evento.action) }}</span></td>
                <td class="historial__mono">{{ evento.resourceType }}</td>
                <td class="historial__detalle">{{ resumirMetadatos(evento.metadata) || '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Pestaña 2: peticiones HTTP ya ejecutadas -->
      <div
        v-else-if="pestanaActiva === 'peticiones'"
        :id="idDePanel('peticiones')"
        class="historial__panel"
        role="tabpanel"
        :aria-labelledby="idDePestana('peticiones')"
        tabindex="0"
      >
        <div v-if="primeraCarga" class="historial__espera">
          <CeibaLoadingScreen
            inline
            message="Cargando las peticiones ejecutadas…"
            detail="GET /api/v1/workspaces/:id/history/requests"
          />
        </div>

        <CeibaVacio
          v-else-if="peticiones.length === 0"
          titulo="Sin ejecuciones HTTP registradas"
          detalle="Lanza una petición desde el constructor o corre una colección completa para que aparezca aquí."
        />

        <CeibaVacio
          v-else-if="peticionesFiltradas.length === 0"
          titulo="El filtro no encuentra ninguna petición"
          :detalle="`Hay ${peticiones.length} peticiones cargadas, pero ninguna coincide con «${filtro.trim()}».`"
        >
          <CeibaBoton compacto @click="filtro = ''">Quitar el filtro</CeibaBoton>
        </CeibaVacio>

        <template v-else>
          <div class="historial__tabla-contenedor">
            <table class="historial__tabla">
              <caption class="ceiba-oculto-visual">
                Peticiones HTTP ejecutadas en el workspace
              </caption>
              <thead>
                <tr>
                  <th scope="col">Fecha</th>
                  <th scope="col">Método</th>
                  <th scope="col">URL resuelta</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Duración</th>
                  <th scope="col">Ejecutado por</th>
                  <th scope="col">Acciones</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="entrada in peticionesFiltradas" :key="entrada.id">
                  <td class="historial__mono">{{ formatearFecha(entrada.executedAt) }}</td>
                  <td><span :class="clasesDeMetodo(entrada.method)">{{ entrada.method }}</span></td>
                  <td class="historial__mono historial__url">{{ entrada.resolvedUrl }}</td>
                  <td>
                    <span
                      class="historial__estado"
                      :class="
                        respuestaCorrecta(entrada)
                          ? 'historial__estado--ok'
                          : 'historial__estado--fallo'
                      "
                    >
                      {{ etiquetaDeEstado(entrada) }}
                    </span>
                  </td>
                  <td class="historial__mono">{{ duracionLegible(entrada.responseTimeMs) }}</td>
                  <td>{{ entrada.userName }}</td>
                  <td>
                    <div class="historial__acciones">
                      <CeibaBoton
                        compacto
                        variante="fantasma"
                        @click="entradaSeleccionada = entrada"
                      >
                        Ver respuesta
                      </CeibaBoton>
                      <CeibaBoton
                        compacto
                        variante="secundario"
                        :deshabilitado="!esReabrible(entrada)"
                        :title="
                          esReabrible(entrada)
                            ? undefined
                            : `El constructor no admite el método ${entrada.method}.`
                        "
                        @click="reabrirEnConstructor(entrada)"
                      >
                        Abrir en constructor
                      </CeibaBoton>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <section
            v-if="entradaSeleccionada"
            class="historial__visor"
            aria-label="Respuesta guardada de la petición seleccionada"
          >
            <header class="historial__visor-cabecera">
              <strong class="historial__mono">
                {{ entradaSeleccionada.method }} {{ entradaSeleccionada.resolvedUrl }}
              </strong>
              <CeibaBoton compacto variante="fantasma" @click="entradaSeleccionada = null">
                Cerrar
              </CeibaBoton>
            </header>
            <p class="historial__suave">
              Vista previa guardada por la API; puede estar recortada respecto a la respuesta
              original.
            </p>
            <pre class="historial__pre">{{ cuerpoDeLaEntrada(entradaSeleccionada) }}</pre>
          </section>
        </template>
      </div>

      <!-- Pestaña 3: versiones de colecciones -->
      <div
        v-else
        :id="idDePanel('versiones')"
        class="historial__panel"
        role="tabpanel"
        :aria-labelledby="idDePestana('versiones')"
        tabindex="0"
      >
        <div v-if="primeraCarga" class="historial__espera">
          <CeibaLoadingScreen
            inline
            message="Cargando las versiones de colección…"
            detail="GET /api/v1/workspaces/:id/history/changes"
          />
        </div>

        <CeibaVacio
          v-else-if="versiones.length === 0"
          titulo="Sin instantáneas de versión todavía"
          detalle="Al importar una colección o guardar una versión se almacena aquí una instantánea completa."
        />

        <CeibaVacio
          v-else-if="versionesFiltradas.length === 0"
          titulo="El filtro no encuentra ninguna versión"
          :detalle="`Hay ${versiones.length} versiones cargadas, pero ninguna coincide con «${filtro.trim()}».`"
        >
          <CeibaBoton compacto @click="filtro = ''">Quitar el filtro</CeibaBoton>
        </CeibaVacio>

        <div v-else class="historial__tabla-contenedor">
          <table class="historial__tabla">
            <caption class="ceiba-oculto-visual">
              Instantáneas de versión de las colecciones del workspace
            </caption>
            <thead>
              <tr>
                <th scope="col">Colección</th>
                <th scope="col">Versión</th>
                <th scope="col">Etiqueta</th>
                <th scope="col">Notas</th>
                <th scope="col">Autor</th>
                <th scope="col">Fecha</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="version in versionesFiltradas" :key="version.id">
                <td><strong>{{ version.collectionName || version.collectionId }}</strong></td>
                <td class="historial__mono">v{{ version.versionNumber }}</td>
                <td>
                  <span class="historial__chip">{{ version.label || `v${version.versionNumber}` }}</span>
                </td>
                <td class="historial__detalle">{{ version.notes || '—' }}</td>
                <td>{{ version.createdByName }}</td>
                <td class="historial__mono">{{ formatearFecha(version.createdAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.historial {
  max-width: 1200px;
  width: 100%;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-5);
}

.historial__cabecera {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--ceiba-space-4);
  flex-wrap: wrap;
}

.historial__subtitulo {
  margin-top: var(--ceiba-space-1);
  max-width: 68ch;
  color: var(--ceiba-text-muted);
  font-size: var(--ceiba-text-sm);
}

.historial__controles {
  display: flex;
  align-items: flex-end;
  gap: var(--ceiba-space-3);
  flex-wrap: wrap;
}

.historial__selector {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
}

.historial__etiqueta {
  font-size: var(--ceiba-text-sm);
  font-weight: 500;
  color: var(--ceiba-text-muted);
}

.historial__select {
  min-width: 220px;
  padding: var(--ceiba-space-2) var(--ceiba-space-3);
  border: 1px solid var(--ceiba-border-strong);
  border-radius: var(--ceiba-radius-md);
  background: var(--ceiba-surface);
  color: var(--ceiba-text);
  font-family: inherit;
  font-size: var(--ceiba-text-sm);
}

.historial__select:disabled {
  color: var(--ceiba-text-faint);
  cursor: not-allowed;
}

.historial__reintento {
  margin-top: var(--ceiba-space-2);
}

/* `CeibaLoadingScreen inline` se coloca sobre su contenedor: tiene que ser
 * `position: relative` y tener altura propia o no se vería nada. */
.historial__espera {
  position: relative;
  min-height: 180px;
}

.historial__barra {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: var(--ceiba-space-4);
  flex-wrap: wrap;
}

.historial__pestanas {
  display: flex;
  gap: var(--ceiba-space-1);
  border-bottom: 1px solid var(--ceiba-border);
}

.historial__pestana {
  padding: var(--ceiba-space-2) var(--ceiba-space-3);
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--ceiba-text-muted);
  font-family: inherit;
  font-size: var(--ceiba-text-sm);
  cursor: pointer;
  transition: color var(--ceiba-duration-fast) var(--ceiba-ease);
}

.historial__pestana--activa {
  color: var(--ceiba-text);
  border-bottom-color: var(--ceiba-accent);
  font-weight: 600;
}

.historial__pestana:focus-visible,
.historial__select:focus-visible,
.historial__panel:focus-visible {
  outline: none;
  box-shadow: var(--ceiba-focus-ring);
  border-radius: var(--ceiba-radius-sm);
}

.historial__filtro {
  min-width: 280px;
  flex: 1 1 280px;
  max-width: 420px;
}

.historial__panel {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-4);
  min-width: 0;
}

.historial__tabla-contenedor {
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-lg);
  background: var(--ceiba-surface);
  overflow-x: auto;
}

.historial__tabla {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--ceiba-text-sm);
}

.historial__tabla th,
.historial__tabla td {
  padding: var(--ceiba-space-2) var(--ceiba-space-3);
  border-bottom: 1px solid var(--ceiba-border);
  text-align: left;
  vertical-align: top;
}

.historial__tabla tbody tr:last-child td {
  border-bottom: none;
}

.historial__tabla th {
  background: var(--ceiba-surface-raised);
  color: var(--ceiba-text-muted);
  font-weight: 500;
  white-space: nowrap;
}

.historial__mono {
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-xs);
}

.historial__suave {
  color: var(--ceiba-text-faint);
  font-size: var(--ceiba-text-xs);
}

.historial__chip {
  display: inline-block;
  padding: var(--ceiba-space-1) var(--ceiba-space-2);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-pill);
  background: var(--ceiba-surface-raised);
  font-size: var(--ceiba-text-xs);
}

/* Insignia de estado: fondo neutro + color e indicador de estado en el borde,
 * como hace `CeibaAviso`. No hay token de fondo teñido y no se inventa uno. */
.historial__estado {
  display: inline-block;
  padding: var(--ceiba-space-1) var(--ceiba-space-2);
  border: 1px solid var(--ceiba-border);
  border-left-width: 3px;
  border-radius: var(--ceiba-radius-sm);
  background: var(--ceiba-surface-raised);
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-xs);
  white-space: nowrap;
}

.historial__estado--ok {
  color: var(--ceiba-success);
  border-left-color: var(--ceiba-success);
}

.historial__estado--fallo {
  color: var(--ceiba-danger);
  border-left-color: var(--ceiba-danger);
}

.historial__url {
  max-width: 44ch;
  word-break: break-all;
}

.historial__detalle {
  max-width: 48ch;
  color: var(--ceiba-text-muted);
}

.historial__acciones {
  display: flex;
  gap: var(--ceiba-space-2);
  flex-wrap: wrap;
}

.historial__visor {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-2);
  padding: var(--ceiba-space-4);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-lg);
  background: var(--ceiba-surface);
}

.historial__visor-cabecera {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--ceiba-space-3);
  flex-wrap: wrap;
}

.historial__pre {
  margin: 0;
  padding: var(--ceiba-space-3);
  border-radius: var(--ceiba-radius-md);
  background: var(--ceiba-bg-sunken);
  color: var(--ceiba-text);
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-xs);
  max-height: 320px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 720px) {
  .historial__cabecera,
  .historial__barra {
    flex-direction: column;
    align-items: stretch;
  }

  .historial__filtro {
    max-width: none;
  }
}
</style>
