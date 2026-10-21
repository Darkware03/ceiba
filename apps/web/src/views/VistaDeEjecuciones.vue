<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useColeccionesStore } from '@/stores/colecciones'
import {
  ejecutarColeccion,
  listarEjecucionesColeccion,
  listarEntornos,
  type EjecucionColeccionDto,
  type EntornoDto,
} from '@/api/studio'
import CeibaBoton from '@/components/ui/CeibaBoton.vue'
import CeibaAviso from '@/components/ui/CeibaAviso.vue'
import CeibaVacio from '@/components/ui/CeibaVacio.vue'

const storeWorkspaces = useWorkspacesStore()
const storeColecciones = useColeccionesStore()

const workspaceSeleccionadoId = ref<string>('')
const coleccionSeleccionadaId = ref<string>('')
const entornoSeleccionadoId = ref<string>('')
const entornos = ref<EntornoDto[]>([])
const ejecuciones = ref<EjecucionColeccionDto[]>([])
const ejecucionActiva = ref<EjecucionColeccionDto | null>(null)
const cargando = ref(false)
const ejecutando = ref(false)
const error = ref<string | null>(null)

const workspaceActual = computed(() =>
  storeWorkspaces.items.find((w) => w.id === workspaceSeleccionadoId.value) ?? null,
)

const puedeEjecutar = computed(() => {
  const r = workspaceActual.value?.myRole
  return !r || r === 'owner' || r === 'admin' || r === 'editor' || r === 'executor'
})

async function cargarDatos(): Promise<void> {
  if (!workspaceSeleccionadoId.value) return
  cargando.value = true
  error.value = null
  try {
    await storeColecciones.cargarColecciones(workspaceSeleccionadoId.value)
    const [listaEntornos, listaRuns] = await Promise.all([
      listarEntornos(workspaceSeleccionadoId.value),
      listarEjecucionesColeccion(workspaceSeleccionadoId.value),
    ])
    entornos.value = listaEntornos
    ejecuciones.value = listaRuns
    if (!coleccionSeleccionadaId.value && storeColecciones.colecciones.length > 0) {
      coleccionSeleccionadaId.value = storeColecciones.colecciones[0].id
    }
    if (listaRuns.length > 0 && !ejecucionActiva.value) {
      ejecucionActiva.value = listaRuns[0]
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'No se pudieron cargar las ejecuciones.'
  } finally {
    cargando.value = false
  }
}

async function lanzarCorrida(): Promise<void> {
  if (!workspaceSeleccionadoId.value || !coleccionSeleccionadaId.value) return
  ejecutando.value = true
  error.value = null
  try {
    const corrida = await ejecutarColeccion(workspaceSeleccionadoId.value, {
      collectionId: coleccionSeleccionadaId.value,
      environmentId: entornoSeleccionadoId.value || null,
    })
    ejecuciones.value = [corrida, ...ejecuciones.value]
    ejecucionActiva.value = corrida
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'No se pudo ejecutar la colección.'
  } finally {
    ejecutando.value = false
  }
}

onMounted(async () => {
  if (storeWorkspaces.items.length === 0) {
    await storeWorkspaces.cargar()
  }
  workspaceSeleccionadoId.value =
    storeWorkspaces.activoId ?? storeWorkspaces.items[0]?.id ?? ''
  if (workspaceSeleccionadoId.value) {
    await cargarDatos()
  }
})

watch(workspaceSeleccionadoId, (nuevoId) => {
  if (nuevoId) {
    storeWorkspaces.seleccionar(nuevoId)
    coleccionSeleccionadaId.value = ''
    ejecucionActiva.value = null
    void cargarDatos()
  }
})
</script>

<template>
  <section class="vista-ejecuciones" aria-labelledby="titulo-ejecuciones">
    <header class="vista-ejecuciones__cabecera">
      <div>
        <p class="vista-ejecuciones__migas">Runner de colecciones</p>
        <h1 id="titulo-ejecuciones" class="vista-ejecuciones__titulo">Ejecuciones de colecciones</h1>
        <p class="vista-ejecuciones__subtitulo">
          Ejecuta todas las peticiones de una colección en secuencia con interpolación de entorno y reporte detallado.
        </p>
      </div>
      <div class="vista-ejecuciones__controles">
        <label class="vista-ejecuciones__selector-label">
          <span>Workspace</span>
          <select v-model="workspaceSeleccionadoId" class="vista-ejecuciones__select">
            <option v-for="ws in storeWorkspaces.items" :key="ws.id" :value="ws.id">
              {{ ws.name }}
            </option>
          </select>
        </label>
      </div>
    </header>

    <CeibaAviso v-if="error" tipo="error" titulo="Error" :mensaje="error" />

    <div class="vista-ejecuciones__lanzador">
      <div class="vista-ejecuciones__campo">
        <label>Colección a ejecutar</label>
        <select v-model="coleccionSeleccionadaId" class="vista-ejecuciones__select">
          <option value="" disabled>Selecciona una colección</option>
          <option v-for="col in storeColecciones.colecciones" :key="col.id" :value="col.id">
            {{ col.name }}
          </option>
        </select>
      </div>
      <div class="vista-ejecuciones__campo">
        <label>Entorno (opcional)</label>
        <select v-model="entornoSeleccionadoId" class="vista-ejecuciones__select">
          <option value="">Sin entorno</option>
          <option v-for="env in entornos" :key="env.id" :value="env.id">
            {{ env.name }}
          </option>
        </select>
      </div>
      <CeibaBoton
        v-if="puedeEjecutar"
        variante="primario"
        :cargando="ejecutando"
        :deshabilitado="!coleccionSeleccionadaId"
        @click="lanzarCorrida"
      >
        Ejecutar colección ahora
      </CeibaBoton>
    </div>

    <div v-if="ejecuciones.length === 0 && !cargando" class="vista-ejecuciones__vacio">
      <CeibaVacio
        titulo="Sin corridas registradas"
        descripcion="Selecciona una colección arriba y lánzala para almacenar el reporte de ejecución."
      />
    </div>

    <div v-else class="vista-ejecuciones__layout">
      <aside class="vista-ejecuciones__historial">
        <h2 class="vista-ejecuciones__seccion-titulo">Corridas recientes</h2>
        <ul class="vista-ejecuciones__lista">
          <li v-for="run in ejecuciones" :key="run.id">
            <button
              type="button"
              class="vista-ejecuciones__item"
              :class="{ 'vista-ejecuciones__item--activo': ejecucionActiva?.id === run.id }"
              @click="ejecucionActiva = run"
            >
              <div class="vista-ejecuciones__item-top">
                <span class="vista-ejecuciones__estado" :data-status="run.status">{{ run.status }}</span>
                <span class="vista-ejecuciones__fecha">{{ new Date(run.startedAt).toLocaleString('es-SV') }}</span>
              </div>
              <div class="vista-ejecuciones__metricas">
                <span>Total: <strong>{{ run.summary?.totalRequests ?? 0 }}</strong></span>
                <span class="ok">OK: <strong>{{ run.summary?.succeededRequests ?? 0 }}</strong></span>
                <span class="fail">Fallos: <strong>{{ run.summary?.failedRequests ?? 0 }}</strong></span>
                <span>{{ run.summary?.durationMs ?? 0 }} ms</span>
              </div>
            </button>
          </li>
        </ul>
      </aside>

      <div v-if="ejecucionActiva" class="vista-ejecuciones__detalle">
        <header class="vista-ejecuciones__detalle-header">
          <div>
            <h2>Resultado de corrida</h2>
            <p class="vista-ejecuciones__detalle-meta">
              Estado: <strong>{{ ejecucionActiva.status }}</strong> ·
              Duración total: <strong>{{ ejecucionActiva.summary?.durationMs ?? 0 }} ms</strong>
            </p>
          </div>
        </header>

        <table class="vista-ejecuciones__tabla">
          <thead>
            <tr>
              <th>Petición</th>
              <th>Método</th>
              <th>URL</th>
              <th>Estado HTTP</th>
              <th>Tiempo</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(res, idx) in ejecucionActiva.summary?.results ?? []" :key="idx">
              <td><strong>{{ res.requestName }}</strong></td>
              <td><span class="badge-metodo">{{ res.method }}</span></td>
              <td class="mono">{{ res.url }}</td>
              <td>{{ res.status ?? 'ERR' }}</td>
              <td>{{ res.durationMs }} ms</td>
              <td>
                <span :class="res.passed ? 'badge-ok' : 'badge-fail'">
                  {{ res.passed ? 'Exitoso' : res.error || 'Falló' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </section>
</template>

<style scoped>
.vista-ejecuciones {
  max-width: 1180px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--espacio-5);
}
.vista-ejecuciones__cabecera {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--espacio-4);
  flex-wrap: wrap;
}
.vista-ejecuciones__migas {
  margin: 0;
  font-size: var(--tamano-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-texto-atenuado);
}
.vista-ejecuciones__titulo {
  margin: var(--espacio-1) 0;
  font-size: var(--tamano-2xl);
}
.vista-ejecuciones__subtitulo {
  margin: 0;
  font-size: var(--tamano-sm);
  color: var(--color-texto-secundario);
}
.vista-ejecuciones__selector-label {
  display: flex;
  align-items: center;
  gap: var(--espacio-2);
  font-size: var(--tamano-sm);
}
.vista-ejecuciones__select {
  padding: var(--espacio-2) var(--espacio-3);
  border-radius: var(--radio-md);
  border: 1px solid var(--color-borde-fuerte);
  background-color: var(--color-superficie-1);
  color: var(--color-texto-primario);
  min-width: 200px;
}
.vista-ejecuciones__lanzador {
  display: flex;
  align-items: flex-end;
  gap: var(--espacio-4);
  flex-wrap: wrap;
  padding: var(--espacio-4);
  background-color: var(--color-superficie-1);
  border: 1px solid var(--color-borde-sutil);
  border-radius: var(--radio-lg);
}
.vista-ejecuciones__campo {
  display: flex;
  flex-direction: column;
  gap: var(--espacio-1);
  font-size: var(--tamano-xs);
  color: var(--color-texto-secundario);
}
.vista-ejecuciones__layout {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: var(--espacio-5);
}
.vista-ejecuciones__historial {
  background-color: var(--color-superficie-1);
  border: 1px solid var(--color-borde-sutil);
  border-radius: var(--radio-lg);
  padding: var(--espacio-4);
}
.vista-ejecuciones__seccion-titulo {
  margin: 0 0 var(--espacio-3);
  font-size: var(--tamano-md);
}
.vista-ejecuciones__lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--espacio-2);
}
.vista-ejecuciones__item {
  width: 100%;
  text-align: left;
  padding: var(--espacio-3);
  border-radius: var(--radio-md);
  border: 1px solid var(--color-borde-sutil);
  background-color: var(--color-superficie-2);
  color: var(--color-texto-primario);
  cursor: pointer;
}
.vista-ejecuciones__item--activo {
  border-color: var(--color-acento-primario);
}
.vista-ejecuciones__item-top {
  display: flex;
  justify-content: space-between;
  font-size: var(--tamano-xs);
  margin-bottom: var(--espacio-1);
}
.vista-ejecuciones__estado {
  font-weight: var(--peso-semibold);
  text-transform: uppercase;
}
.vista-ejecuciones__metricas {
  display: flex;
  gap: var(--espacio-2);
  font-size: var(--tamano-xs);
  color: var(--color-texto-secundario);
}
.ok { color: #2e7d32; }
.fail { color: #c62828; }
.vista-ejecuciones__detalle {
  background-color: var(--color-superficie-1);
  border: 1px solid var(--color-borde-sutil);
  border-radius: var(--radio-lg);
  padding: var(--espacio-5);
}
.vista-ejecuciones__tabla {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--tamano-sm);
  margin-top: var(--espacio-3);
}
.vista-ejecuciones__tabla th,
.vista-ejecuciones__tabla td {
  padding: var(--espacio-2) var(--espacio-3);
  border-bottom: 1px solid var(--color-borde-sutil);
  text-align: left;
}
.mono {
  font-family: var(--fuente-mono);
  font-size: var(--tamano-xs);
  word-break: break-all;
}
.badge-metodo {
  font-family: var(--fuente-mono);
  font-size: var(--tamano-xs);
  font-weight: var(--peso-semibold);
}
.badge-ok {
  color: #2e7d32;
  font-weight: var(--peso-semibold);
}
.badge-fail {
  color: #c62828;
  font-weight: var(--peso-semibold);
}
</style>
