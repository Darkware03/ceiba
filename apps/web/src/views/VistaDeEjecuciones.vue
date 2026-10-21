<script setup lang="ts">
/**
 * Pantalla «Ejecuciones»: lanza una colección completa y enseña el reporte de
 * las corridas ya guardadas.
 *
 * DOS DECISIONES QUE CONVIENE DEJAR ESCRITAS:
 *
 *  1. **El detalle por corrida es un hueco del contrato.** La API expone
 *     `GET /workspaces/:id/runs` (la lista, con `summary` e `items`) y
 *     `POST /workspaces/:id/runs`, pero **no** `GET /workspaces/:id/runs/:runId`.
 *     Esta vista pinta el resumen que ya viene en la lista y no pide el
 *     detalle en el camino normal. Si alguien lo pide a propósito con el
 *     botón de comprobación, el `ErrorDeHueco` se captura y se dice con todas
 *     sus letras en un `CeibaAviso` en vez de disfrazarlo de fallo pasajero o
 *     de rellenar la tabla con datos inventados.
 *
 *  2. **El botón de ejecutar no se esconde por rol.** El servidor es quien
 *     autoriza la corrida y responde 403 si el rol no basta; ocultar el
 *     control en el cliente no sería un control, sólo daría la falsa
 *     impresión de que la interfaz protege algo. Mismo criterio que
 *     `VistaDeWorkspaces.vue`.
 *
 * Los cuatro estados (carga, vacío, error, con datos) están separados, toda
 * espera muestra el logo de la marca girando y todo valor visual sale de un
 * token `--ceiba-*` de `@ceiba/brand`.
 */
import { computed, onMounted, ref, useId, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CeibaLoadingScreen } from '@ceiba/brand';

import { esErrorDeHueco, mensajeDeError } from '@/api/errores';
import {
  ejecutarColeccion,
  listarEjecucionesColeccion,
  listarEntornos,
  obtenerDetalleCorrida,
  type CorridaDeColeccion,
  type EntornoDeWorkspace,
} from '@/api/studio';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import CeibaVacio from '@/components/ui/CeibaVacio.vue';
import { NOMBRES_RUTAS } from '@/router/nombres';
import { usarAlmacenDeColecciones } from '@/stores/colecciones';
import { usarAlmacenDeWorkspaces } from '@/stores/workspaces';

const route = useRoute();
const router = useRouter();
const almacenWorkspaces = usarAlmacenDeWorkspaces();
const almacenColecciones = usarAlmacenDeColecciones();

const idBase = useId();
const idWorkspace = `ejecuciones-workspace-${idBase}`;
const idColeccion = `ejecuciones-coleccion-${idBase}`;
const idEntorno = `ejecuciones-entorno-${idBase}`;
const idPanelDetalle = `ejecuciones-detalle-${idBase}`;
const idDeCorrida = (runId: string): string => `ejecuciones-corrida-${runId}-${idBase}`;

const workspaceId = ref('');
const coleccionId = ref('');
const entornoId = ref('');
const entornos = ref<EntornoDeWorkspace[]>([]);
const corridas = ref<CorridaDeColeccion[]>([]);
const corridaActivaId = ref('');

const cargando = ref(false);
const cargado = ref(false);
const ejecutando = ref(false);
const comprobandoDetalle = ref(false);
const errorMensaje = ref<string | null>(null);
/** Mensaje del hueco de contrato; no es un error de ejecución. */
const huecoDeDetalle = ref<string | null>(null);

const colecciones = computed(() => almacenColecciones.deWorkspace(workspaceId.value));
const coleccionesCargadas = computed(() => almacenColecciones.cargada(workspaceId.value));
const cargandoWorkspaces = computed(
  () => almacenWorkspaces.cargando && !almacenWorkspaces.cargada,
);
const sinWorkspaces = computed(() => almacenWorkspaces.estaVacia);
const primeraCarga = computed(() => cargando.value && !cargado.value);

const corridaActiva = computed(
  () => corridas.value.find((corrida) => corrida.id === corridaActivaId.value) ?? null,
);

/**
 * La corrida seleccionada no trae desglose por petición. No es un fallo: la
 * lista puede devolver la corrida sin `items`, y el detalle por corrida no
 * existe en la API.
 */
const sinDesglose = computed(() => {
  const corrida = corridaActiva.value;
  if (corrida === null) return false;
  return (corrida.summary?.results.length ?? 0) === 0;
});

function formatearFecha(iso: string | null): string {
  if (iso === null) return '—';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return iso;
  return fecha.toLocaleString('es-SV', { dateStyle: 'medium', timeStyle: 'short' });
}

function duracionLegible(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? '—' : `${ms} ms`;
}

function clasesDeMetodo(metodo: string): string[] {
  const normalizado = metodo.trim().toLowerCase();
  const conocidos = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
  return conocidos.includes(normalizado)
    ? ['ceiba-metodo', `ceiba-metodo--${normalizado}`]
    : ['ceiba-metodo'];
}

/** `status` del contrato: `succeeded`, `failed`, `running`, `cancelled`… */
function corridaCorrecta(corrida: CorridaDeColeccion): boolean {
  return corrida.failedCount === 0 && corrida.status !== 'failed';
}

async function cargarDatos(): Promise<void> {
  if (workspaceId.value === '') return;
  cargando.value = true;
  errorMensaje.value = null;
  huecoDeDetalle.value = null;
  try {
    const [listaEntornos, listaCorridas] = await Promise.all([
      listarEntornos(workspaceId.value),
      listarEjecucionesColeccion(workspaceId.value),
    ]);
    await almacenColecciones.cargar(workspaceId.value);
    entornos.value = [...listaEntornos];
    corridas.value = [...listaCorridas];
    cargado.value = true;

    const primeraColeccion = colecciones.value[0];
    if (coleccionId.value === '' && primeraColeccion !== undefined) {
      coleccionId.value = primeraColeccion.id;
    }
    const primeraCorrida = corridas.value[0];
    if (corridaActivaId.value === '' && primeraCorrida !== undefined) {
      corridaActivaId.value = primeraCorrida.id;
    }
  } catch (error) {
    // No se vacía lo ya cargado: un fallo de red no debe convertirse en una
    // pantalla que afirme que no hay corridas.
    errorMensaje.value = mensajeDeError(error);
  } finally {
    cargando.value = false;
  }
}

async function lanzarCorrida(): Promise<void> {
  if (workspaceId.value === '' || coleccionId.value === '') return;
  ejecutando.value = true;
  errorMensaje.value = null;
  huecoDeDetalle.value = null;
  try {
    const corrida = await ejecutarColeccion(
      workspaceId.value,
      coleccionId.value,
      entornoId.value === '' ? undefined : entornoId.value,
    );
    corridas.value = [corrida, ...corridas.value.filter((previa) => previa.id !== corrida.id)];
    corridaActivaId.value = corrida.id;
  } catch (error) {
    errorMensaje.value = mensajeDeError(error);
  } finally {
    ejecutando.value = false;
  }
}

/**
 * Comprobación explícita del hueco: pide el detalle por corrida y, si la API
 * sigue sin exponerlo, lo dice. No se llama sola en ningún momento.
 */
async function comprobarDetalleDeCorrida(): Promise<void> {
  const corrida = corridaActiva.value;
  if (corrida === null) return;
  comprobandoDetalle.value = true;
  huecoDeDetalle.value = null;
  errorMensaje.value = null;
  try {
    const detalle = await obtenerDetalleCorrida(workspaceId.value, corrida.id);
    corridas.value = corridas.value.map((previa) =>
      previa.id === detalle.id ? detalle : previa,
    );
    corridaActivaId.value = detalle.id;
  } catch (error) {
    if (esErrorDeHueco(error)) {
      huecoDeDetalle.value =
        `La API todavía no expone «${error.rutaQueFalta}»: no hay forma de pedir el ` +
        'detalle de una corrida concreta. Lo que se ve arriba es el resumen que ' +
        'devuelve la lista de corridas, y no se completa con datos inventados.';
    } else {
      errorMensaje.value = mensajeDeError(error);
    }
  } finally {
    comprobandoDetalle.value = false;
  }
}

function irAWorkspaces(): void {
  void router.push({ name: NOMBRES_RUTAS.WORKSPACES });
}

watch(workspaceId, (nuevo) => {
  coleccionId.value = '';
  entornoId.value = '';
  corridaActivaId.value = '';
  corridas.value = [];
  entornos.value = [];
  cargado.value = false;
  huecoDeDetalle.value = null;
  if (nuevo !== '') void cargarDatos();
});

watch(corridaActivaId, () => {
  huecoDeDetalle.value = null;
});

onMounted(async () => {
  if (!almacenWorkspaces.cargada) await almacenWorkspaces.cargar();
  const pedido = typeof route.query.workspaceId === 'string' ? route.query.workspaceId : '';
  const existe = pedido !== '' && almacenWorkspaces.porId(pedido) !== null;
  workspaceId.value = existe ? pedido : (almacenWorkspaces.lista[0]?.id ?? '');
});
</script>

<template>
  <section class="corridas" aria-labelledby="corridas-titulo">
    <header class="corridas__cabecera">
      <div>
        <p class="corridas__migas">Runner de colecciones</p>
        <h1 id="corridas-titulo">Ejecuciones de colecciones</h1>
        <p class="corridas__subtitulo">
          Lanza todas las peticiones de una colección en secuencia, con las variables del entorno
          interpoladas, y consulta el reporte de cada corrida.
        </p>
      </div>

      <div class="corridas__selector">
        <label class="corridas__etiqueta" :for="idWorkspace">Workspace</label>
        <select
          :id="idWorkspace"
          v-model="workspaceId"
          class="corridas__select"
          :disabled="almacenWorkspaces.lista.length === 0"
        >
          <option v-if="almacenWorkspaces.lista.length === 0" value="">Sin workspaces</option>
          <option v-for="ws in almacenWorkspaces.lista" :key="ws.id" :value="ws.id">
            {{ ws.name }}
          </option>
        </select>
      </div>
    </header>

    <CeibaAviso
      v-if="almacenWorkspaces.error"
      tono="error"
      titulo="No se pudo cargar la lista de workspaces"
    >
      {{ almacenWorkspaces.error }}
      <p class="corridas__reintento">
        <CeibaBoton
          compacto
          :cargando="almacenWorkspaces.cargando"
          @click="almacenWorkspaces.cargar()"
        >
          Reintentar
        </CeibaBoton>
      </p>
    </CeibaAviso>

    <CeibaAviso v-if="errorMensaje" tono="error" titulo="Algo ha fallado">
      {{ errorMensaje }}
      <p class="corridas__reintento">
        <CeibaBoton compacto :cargando="cargando" @click="cargarDatos()">Reintentar</CeibaBoton>
      </p>
    </CeibaAviso>

    <CeibaAviso v-if="almacenColecciones.error" tono="aviso" titulo="Colecciones no disponibles">
      {{ almacenColecciones.error }}
    </CeibaAviso>

    <div v-if="cargandoWorkspaces" class="corridas__espera">
      <CeibaLoadingScreen inline message="Cargando workspaces…" detail="GET /api/v1/workspaces" />
    </div>

    <CeibaVacio
      v-else-if="sinWorkspaces"
      titulo="Todavía no hay ningún workspace"
      detalle="Las corridas se guardan por workspace. Crea el primero y añade una colección para poder ejecutarla."
    >
      <CeibaBoton variante="primario" @click="irAWorkspaces()">Ir a workspaces</CeibaBoton>
    </CeibaVacio>

    <template v-else>
      <section class="corridas__lanzador" aria-label="Lanzar una corrida">
        <div class="corridas__campo">
          <label class="corridas__etiqueta" :for="idColeccion">Colección a ejecutar</label>
          <select
            :id="idColeccion"
            v-model="coleccionId"
            class="corridas__select"
            :disabled="colecciones.length === 0"
          >
            <option value="" disabled>
              {{ colecciones.length === 0 ? 'No hay colecciones' : 'Selecciona una colección' }}
            </option>
            <option v-for="coleccion in colecciones" :key="coleccion.id" :value="coleccion.id">
              {{ coleccion.name }}
            </option>
          </select>
        </div>

        <div class="corridas__campo">
          <label class="corridas__etiqueta" :for="idEntorno">Entorno (opcional)</label>
          <select :id="idEntorno" v-model="entornoId" class="corridas__select">
            <option value="">Sin entorno</option>
            <option v-for="entorno in entornos" :key="entorno.id" :value="entorno.id">
              {{ entorno.name }}
            </option>
          </select>
        </div>

        <CeibaBoton
          variante="primario"
          :cargando="ejecutando"
          :deshabilitado="coleccionId === ''"
          @click="lanzarCorrida()"
        >
          Ejecutar colección ahora
        </CeibaBoton>

        <p class="corridas__nota">
          Quien autoriza la corrida es el servidor: si tu rol en este workspace no alcanza,
          responderá 403 y el motivo aparecerá aquí mismo.
        </p>
      </section>

      <div v-if="primeraCarga" class="corridas__espera">
        <CeibaLoadingScreen
          inline
          message="Cargando corridas y entornos…"
          detail="GET /api/v1/workspaces/:id/runs"
        />
      </div>

      <CeibaVacio
        v-else-if="coleccionesCargadas && colecciones.length === 0"
        titulo="Este workspace no tiene colecciones"
        detalle="Una corrida ejecuta las peticiones de una colección; sin colecciones no hay nada que lanzar."
      >
        <CeibaBoton variante="primario" @click="irAWorkspaces()">Ir a workspaces</CeibaBoton>
      </CeibaVacio>

      <!-- «No hay corridas» sólo cuando la carga **terminó bien**. Si falló,
           la lista está vacía porque no se pudo leer, no porque no haya nada:
           decir lo contrario convertiría un fallo de red en un hecho falso.
           El error ya se explica arriba, con su botón de reintento. -->
      <CeibaVacio
        v-else-if="cargado && errorMensaje === null && corridas.length === 0"
        titulo="Sin corridas registradas"
        detalle="Elige una colección arriba y lánzala: el reporte completo quedará guardado y aparecerá en esta lista."
      />

      <div v-else-if="corridas.length > 0" class="corridas__columnas">
        <aside class="corridas__historial" aria-label="Corridas recientes">
          <h2 class="corridas__seccion">Corridas recientes</h2>
          <div
            class="corridas__lista"
            role="tablist"
            aria-orientation="vertical"
            aria-label="Corridas guardadas"
          >
            <button
              v-for="corrida in corridas"
              :id="idDeCorrida(corrida.id)"
              :key="corrida.id"
              class="corridas__item"
              :class="{ 'corridas__item--activo': corridaActivaId === corrida.id }"
              type="button"
              role="tab"
              :aria-selected="corridaActivaId === corrida.id"
              :aria-controls="idPanelDetalle"
              @click="corridaActivaId = corrida.id"
            >
              <span class="corridas__item-fila">
                <span
                  class="corridas__estado"
                  :class="
                    corridaCorrecta(corrida) ? 'corridas__estado--ok' : 'corridas__estado--fallo'
                  "
                >
                  {{ corrida.status }}
                </span>
                <span class="corridas__fecha">{{ formatearFecha(corrida.startedAt) }}</span>
              </span>
              <span class="corridas__item-nombre">{{ corrida.collectionName }}</span>
              <span class="corridas__metricas">
                <span>Total: <strong>{{ corrida.summary?.totalRequests ?? corrida.totalRequests }}</strong></span>
                <span class="corridas__metrica--ok">
                  OK: <strong>{{ corrida.summary?.succeededRequests ?? corrida.passedCount }}</strong>
                </span>
                <span class="corridas__metrica--fallo">
                  Fallos: <strong>{{ corrida.summary?.failedRequests ?? corrida.failedCount }}</strong>
                </span>
                <span>{{ duracionLegible(corrida.summary?.durationMs ?? corrida.durationMs) }}</span>
              </span>
            </button>
          </div>
        </aside>

        <div
          :id="idPanelDetalle"
          class="corridas__detalle"
          role="tabpanel"
          :aria-labelledby="corridaActiva ? idDeCorrida(corridaActiva.id) : undefined"
          tabindex="0"
        >
          <template v-if="corridaActiva">
            <header class="corridas__detalle-cabecera">
              <div>
                <h2>Reporte de la corrida</h2>
                <p class="corridas__detalle-meta">
                  <strong>{{ corridaActiva.collectionName }}</strong>
                  · Entorno: {{ corridaActiva.environmentName ?? 'sin entorno' }}
                  · Lanzada por {{ corridaActiva.triggeredByName }}
                </p>
                <p class="corridas__detalle-meta">
                  Estado: <strong>{{ corridaActiva.status }}</strong>
                  · Inicio: {{ formatearFecha(corridaActiva.startedAt) }}
                  · Fin: {{ formatearFecha(corridaActiva.finishedAt) }}
                  · Duración:
                  <strong>
                    {{ duracionLegible(corridaActiva.summary?.durationMs ?? corridaActiva.durationMs) }}
                  </strong>
                </p>
              </div>
            </header>

            <div v-if="ejecutando" class="corridas__espera">
              <CeibaLoadingScreen
                inline
                message="Ejecutando la colección…"
                detail="POST /api/v1/workspaces/:id/runs"
              />
            </div>

            <template v-else>
              <table v-if="!sinDesglose" class="corridas__tabla">
                <caption class="ceiba-oculto-visual">
                  Resultado de cada petición de la corrida
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Petición</th>
                    <th scope="col">Método</th>
                    <th scope="col">URL</th>
                    <th scope="col">Estado HTTP</th>
                    <th scope="col">Tiempo</th>
                    <th scope="col">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(resultado, indice) in corridaActiva.summary?.results ?? []"
                    :key="`${corridaActiva.id}-${indice}`"
                  >
                    <td><strong>{{ resultado.requestName }}</strong></td>
                    <td><span :class="clasesDeMetodo(resultado.method)">{{ resultado.method }}</span></td>
                    <td class="corridas__mono corridas__url">{{ resultado.url }}</td>
                    <td class="corridas__mono">{{ resultado.status ?? '—' }}</td>
                    <td class="corridas__mono">{{ duracionLegible(resultado.durationMs) }}</td>
                    <td>
                      <span
                        class="corridas__estado"
                        :class="
                          resultado.passed ? 'corridas__estado--ok' : 'corridas__estado--fallo'
                        "
                      >
                        {{ resultado.passed ? 'Exitoso' : (resultado.error ?? 'Falló') }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>

              <CeibaAviso
                v-else
                tono="aviso"
                titulo="La API no expone el detalle de una corrida concreta"
              >
                Esta corrida llegó sin desglose por petición y
                <strong>la API todavía no expone «GET /workspaces/:id/runs/:runId»</strong>:
                no existe ninguna ruta para pedir el detalle de una ejecución. Se muestra sólo el
                resumen que devuelve la lista de corridas; rellenar la tabla con otra cosa sería
                inventarse el endpoint.
                <p class="corridas__reintento">
                  <CeibaBoton
                    compacto
                    :cargando="comprobandoDetalle"
                    @click="comprobarDetalleDeCorrida()"
                  >
                    Comprobar si la API ya lo expone
                  </CeibaBoton>
                </p>
              </CeibaAviso>

              <CeibaAviso v-if="huecoDeDetalle" tono="aviso" titulo="Hueco confirmado contra la API">
                {{ huecoDeDetalle }}
              </CeibaAviso>
            </template>
          </template>

          <CeibaVacio
            v-else
            titulo="Ninguna corrida seleccionada"
            detalle="Elige una corrida de la lista para ver su reporte."
          />
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.corridas {
  max-width: 1180px;
  width: 100%;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-5);
}

.corridas__cabecera {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--ceiba-space-4);
  flex-wrap: wrap;
}

.corridas__migas {
  font-size: var(--ceiba-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ceiba-text-faint);
}

.corridas__subtitulo {
  margin-top: var(--ceiba-space-1);
  max-width: 68ch;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.corridas__selector,
.corridas__campo {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
}

.corridas__etiqueta {
  font-size: var(--ceiba-text-sm);
  font-weight: 500;
  color: var(--ceiba-text-muted);
}

.corridas__select {
  min-width: 220px;
  padding: var(--ceiba-space-2) var(--ceiba-space-3);
  border: 1px solid var(--ceiba-border-strong);
  border-radius: var(--ceiba-radius-md);
  background: var(--ceiba-surface);
  color: var(--ceiba-text);
  font-family: inherit;
  font-size: var(--ceiba-text-sm);
}

.corridas__select:disabled {
  color: var(--ceiba-text-faint);
  cursor: not-allowed;
}

.corridas__reintento {
  margin-top: var(--ceiba-space-2);
}

.corridas__lanzador {
  display: flex;
  align-items: flex-end;
  gap: var(--ceiba-space-4);
  flex-wrap: wrap;
  padding: var(--ceiba-space-4);
  background: var(--ceiba-surface);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-lg);
}

.corridas__nota {
  flex: 1 1 100%;
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

/* `CeibaLoadingScreen inline` se coloca sobre su contenedor: debe ser
 * `position: relative` y tener altura propia. */
.corridas__espera {
  position: relative;
  min-height: 180px;
}

.corridas__columnas {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  gap: var(--ceiba-space-5);
  align-items: start;
}

.corridas__historial,
.corridas__detalle {
  background: var(--ceiba-surface);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-lg);
  padding: var(--ceiba-space-4);
}

.corridas__detalle {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-4);
  min-width: 0;
}

.corridas__seccion {
  margin-bottom: var(--ceiba-space-3);
  font-size: var(--ceiba-text-lg);
}

.corridas__lista {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-2);
}

.corridas__item {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
  width: 100%;
  text-align: left;
  padding: var(--ceiba-space-3);
  border: 1px solid var(--ceiba-border);
  border-left: 3px solid transparent;
  border-radius: var(--ceiba-radius-md);
  background: var(--ceiba-surface-raised);
  color: var(--ceiba-text);
  font-family: inherit;
  font-size: var(--ceiba-text-sm);
  cursor: pointer;
  transition: border-color var(--ceiba-duration-fast) var(--ceiba-ease);
}

.corridas__item--activo {
  border-color: var(--ceiba-accent);
  border-left-color: var(--ceiba-accent);
  background: var(--ceiba-accent-surface);
}

.corridas__item:focus-visible,
.corridas__select:focus-visible,
.corridas__detalle:focus-visible {
  outline: none;
  box-shadow: var(--ceiba-focus-ring);
  border-radius: var(--ceiba-radius-sm);
}

.corridas__item-fila {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--ceiba-space-2);
  font-size: var(--ceiba-text-xs);
}

.corridas__item-nombre {
  font-weight: 600;
}

.corridas__fecha {
  color: var(--ceiba-text-muted);
  font-family: var(--ceiba-font-mono);
}

.corridas__metricas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ceiba-space-2);
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-muted);
}

.corridas__metrica--ok {
  color: var(--ceiba-success);
}

.corridas__metrica--fallo {
  color: var(--ceiba-danger);
}

/* Insignia de estado: superficie neutra y el estado en el texto y el filo,
 * como `CeibaAviso`. No hay token de fondo teñido y no se inventa uno. */
.corridas__estado {
  display: inline-block;
  padding: var(--ceiba-space-1) var(--ceiba-space-2);
  border: 1px solid var(--ceiba-border);
  border-left-width: 3px;
  border-radius: var(--ceiba-radius-sm);
  background: var(--ceiba-surface);
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.corridas__estado--ok {
  color: var(--ceiba-success);
  border-left-color: var(--ceiba-success);
}

.corridas__estado--fallo {
  color: var(--ceiba-danger);
  border-left-color: var(--ceiba-danger);
}

.corridas__detalle-meta {
  margin-top: var(--ceiba-space-1);
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.corridas__tabla {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--ceiba-text-sm);
}

.corridas__tabla th,
.corridas__tabla td {
  padding: var(--ceiba-space-2) var(--ceiba-space-3);
  border-bottom: 1px solid var(--ceiba-border);
  text-align: left;
  vertical-align: top;
}

.corridas__tabla tbody tr:last-child td {
  border-bottom: none;
}

.corridas__tabla th {
  background: var(--ceiba-surface-raised);
  color: var(--ceiba-text-muted);
  font-weight: 500;
  white-space: nowrap;
}

.corridas__mono {
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-xs);
}

.corridas__url {
  max-width: 42ch;
  word-break: break-all;
}

@media (max-width: 900px) {
  .corridas__columnas {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 720px) {
  .corridas__cabecera {
    flex-direction: column;
    align-items: stretch;
  }

  .corridas__select {
    min-width: 0;
    width: 100%;
  }
}
</style>
