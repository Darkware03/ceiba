<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useColeccionesStore } from '@/stores/colecciones'
import { exportarColeccion, importarColeccion } from '@/api/studio'
import { NOMBRES_RUTAS } from '@/router/nombres'
import CeibaBoton from '@/components/ui/CeibaBoton.vue'
import CeibaAviso from '@/components/ui/CeibaAviso.vue'

const router = useRouter()
const storeWorkspaces = useWorkspacesStore()
const storeColecciones = useColeccionesStore()

const workspaceSeleccionadoId = ref<string>('')
const coleccionExportarId = ref<string>('')
const jsonEntrada = ref<string>('')
const jsonExportado = ref<string>('')
const importando = ref(false)
const exportando = ref(false)
const error = ref<string | null>(null)
const mensajeExito = ref<string | null>(null)

const workspaceActual = computed(() =>
  storeWorkspaces.items.find((w) => w.id === workspaceSeleccionadoId.value) ?? null,
)
const puedeEditar = computed(() => {
  const r = workspaceActual.value?.myRole
  return !r || r === 'owner' || r === 'admin' || r === 'editor'
})

async function cargarColecciones(): Promise<void> {
  if (!workspaceSeleccionadoId.value) return
  await storeColecciones.cargarColecciones(workspaceSeleccionadoId.value)
  if (!coleccionExportarId.value && storeColecciones.colecciones.length > 0) {
    coleccionExportarId.value = storeColecciones.colecciones[0].id
  }
}

function leerArchivo(ev: Event): void {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    jsonEntrada.value = String(reader.result ?? '')
  }
  reader.readAsText(file)
}

function cargarPlantillaEjemplo(): void {
  jsonEntrada.value = JSON.stringify(
    {
      schemaVersion: 'ceiba.collection.v1',
      collection: {
        name: 'API Pagos Regionales',
        description: 'Colección importada con carpetas y endpoints de prueba',
      },
      folders: [{ id: 'f-auth', parentFolderId: null, name: 'Autenticación', sortOrder: 0 }],
      requests: [
        {
          folderId: 'f-auth',
          name: 'Estado del servicio',
          method: 'GET',
          url: 'https://httpbin.org/get',
          headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
          queryParams: [],
          bodyType: 'none',
          body: null,
          authConfig: { type: 'none' },
        },
      ],
    },
    null,
    2,
  )
}

async function ejecutarImportacion(): Promise<void> {
  if (!workspaceSeleccionadoId.value || !jsonEntrada.value.trim()) return
  importando.value = true
  error.value = null
  mensajeExito.value = null
  try {
    const payload = JSON.parse(jsonEntrada.value) as Record<string, unknown>
    const res = await importarColeccion(workspaceSeleccionadoId.value, payload)
    await storeColecciones.cargarColecciones(workspaceSeleccionadoId.value)
    mensajeExito.value = `Colección «${res.name}» importada (${res.importedFolders} carpetas, ${res.importedRequests} peticiones).`
  } catch (err) {
    error.value =
      err instanceof Error ? err.message : 'El JSON proporcionado no es válido o no pudo importarse.'
  } finally {
    importando.value = false
  }
}

async function ejecutarExportacion(): Promise<void> {
  if (!workspaceSeleccionadoId.value || !coleccionExportarId.value) return
  exportando.value = true
  error.value = null
  try {
    const bundle = await exportarColeccion(workspaceSeleccionadoId.value, coleccionExportarId.value)
    jsonExportado.value = JSON.stringify(bundle, null, 2)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'No se pudo exportar la colección.'
  } finally {
    exportando.value = false
  }
}

function descargarJsonExportado(): void {
  if (!jsonExportado.value) return
  const blob = new Blob([jsonExportado.value], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ceiba-collection-${coleccionExportarId.value.slice(0, 8)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

function irAlWorkspace(): void {
  if (!workspaceSeleccionadoId.value) return
  void router.push({
    name: NOMBRES_RUTAS.WORKSPACE_DETALLE,
    params: { workspaceId: workspaceSeleccionadoId.value },
  })
}

onMounted(async () => {
  if (storeWorkspaces.items.length === 0) {
    await storeWorkspaces.cargar()
  }
  workspaceSeleccionadoId.value =
    storeWorkspaces.activoId ?? storeWorkspaces.items[0]?.id ?? ''
  if (workspaceSeleccionadoId.value) {
    await cargarColecciones()
  }
})

watch(workspaceSeleccionadoId, (nuevoId) => {
  if (nuevoId) {
    storeWorkspaces.seleccionar(nuevoId)
    coleccionExportarId.value = ''
    jsonExportado.value = ''
    void cargarColecciones()
  }
})
</script>

<template>
  <section class="vista-importar" aria-labelledby="titulo-importar">
    <header class="vista-importar__cabecera">
      <div>
        <p class="vista-importar__migas">Portabilidad de colecciones</p>
        <h1 id="titulo-importar" class="vista-importar__titulo">Importar y exportar colecciones</h1>
        <p class="vista-importar__subtitulo">
          Importa colecciones en formato JSON (CEIBA o Postman v2.1) o exporta cualquier colección completa con sus carpetas y peticiones.
        </p>
      </div>
      <div class="vista-importar__controles">
        <select v-model="workspaceSeleccionadoId" class="vista-importar__select">
          <option v-for="ws in storeWorkspaces.items" :key="ws.id" :value="ws.id">
            {{ ws.name }} ({{ ws.myRole === 'viewer' ? 'Solo mostrar' : 'Editar' }})
          </option>
        </select>
        <CeibaBoton variante="secundario" Tamano="sm" @click="irAlWorkspace">
          Ir al workspace
        </CeibaBoton>
      </div>
    </header>

    <CeibaAviso v-if="error" tipo="error" titulo="Error" :mensaje="error" />
    <CeibaAviso v-if="mensajeExito" tipo="exito" titulo="Importación completada" :mensaje="mensajeExito" />

    <div class="vista-importar__grid">
      <div class="vista-importar__panel">
        <h2>Importar colección (JSON)</h2>
        <p class="vista-importar__ayuda">
          Sube un archivo <code>.json</code> o pega el contenido directamente. Cada importación queda registrada en el historial de cambios y versiones.
        </p>

        <div class="vista-importar__acciones-top">
          <input type="file" accept=".json,application/json" @change="leerArchivo" :disabled="!puedeEditar" />
          <CeibaBoton variante="fantasma" Tamano="sm" @click="cargarPlantillaEjemplo">
            Cargar ejemplo JSON
          </CeibaBoton>
        </div>

        <textarea
          v-model="jsonEntrada"
          class="vista-importar__textarea"
          rows="14"
          placeholder='{"name": "Mi colección", "folders": [], "requests": []}'
          :disabled="!puedeEditar"
        ></textarea>

        <div class="vista-importar__footer">
          <span v-if="!puedeEditar" class="vista-importar__aviso-rol">
            Tu rol en este workspace es de solo lectura (viewer); no puedes importar colecciones.
          </span>
          <CeibaBoton
            v-else
            variante="primario"
            :cargando="importando"
            :deshabilitado="!jsonEntrada.trim()"
            @click="ejecutarImportacion"
          >
            Importar colección al workspace
          </CeibaBoton>
        </div>
      </div>

      <div class="vista-importar__panel">
        <h2>Exportar colección a JSON</h2>
        <p class="vista-importar__ayuda">
          Selecciona una colección del workspace para generar su paquete JSON completo con carpetas, cabeceras, parámetros y cuerpo.
        </p>

        <div class="vista-importar__export-bar">
          <select v-model="coleccionExportarId" class="vista-importar__select">
            <option value="" disabled>Selecciona una colección</option>
            <option v-for="col in storeColecciones.colecciones" :key="col.id" :value="col.id">
              {{ col.name }}
            </option>
          </select>
          <CeibaBoton
            variante="primario"
            :cargando="exportando"
            :deshabilitado="!coleccionExportarId"
            @click="ejecutarExportacion"
          >
            Generar exportación
          </CeibaBoton>
          <CeibaBoton
            v-if="jsonExportado"
            variante="secundario"
            @click="descargarJsonExportado"
          >
            Descargar .json
          </CeibaBoton>
        </div>

        <textarea
          v-model="jsonExportado"
          class="vista-importar__textarea"
          rows="14"
          readonly
          placeholder="Aquí aparecerá el JSON exportado de la colección..."
        ></textarea>
      </div>
    </div>
  </section>
</template>

<style scoped>
.vista-importar {
  max-width: 1180px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--espacio-5);
}
.vista-importar__cabecera {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--espacio-4);
  flex-wrap: wrap;
}
.vista-importar__migas {
  margin: 0;
  font-size: var(--tamano-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-texto-atenuado);
}
.vista-importar__titulo {
  margin: var(--espacio-1) 0;
  font-size: var(--tamano-2xl);
}
.vista-importar__subtitulo {
  margin: 0;
  font-size: var(--tamano-sm);
  color: var(--color-texto-secundario);
}
.vista-importar__controles {
  display: flex;
  align-items: center;
  gap: var(--espacio-2);
}
.vista-importar__select {
  padding: var(--espacio-2) var(--espacio-3);
  border-radius: var(--radio-md);
  border: 1px solid var(--color-borde-fuerte);
  background-color: var(--color-superficie-1);
  color: var(--color-texto-primario);
}
.vista-importar__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--espacio-5);
}
.vista-importar__panel {
  background-color: var(--color-superficie-1);
  border: 1px solid var(--color-borde-sutil);
  border-radius: var(--radio-lg);
  padding: var(--espacio-5);
  display: flex;
  flex-direction: column;
  gap: var(--espacio-3);
}
.vista-importar__panel h2 {
  margin: 0;
  font-size: var(--tamano-lg);
}
.vista-importar__ayuda {
  margin: 0;
  font-size: var(--tamano-xs);
  color: var(--color-texto-secundario);
}
.vista-importar__acciones-top,
.vista-importar__export-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--espacio-2);
  flex-wrap: wrap;
}
.vista-importar__textarea {
  width: 100%;
  font-family: var(--fuente-mono);
  font-size: var(--tamano-xs);
  padding: var(--espacio-3);
  border-radius: var(--radio-md);
  border: 1px solid var(--color-borde-fuerte);
  background-color: var(--color-superficie-2);
  color: var(--color-texto-primario);
  resize: vertical;
}
.vista-importar__aviso-rol {
  font-size: var(--tamano-xs);
  color: var(--color-estado-advertencia);
}
@media (max-width: 900px) {
  .vista-importar__grid {
    grid-template-columns: 1fr;
  }
}
</style>
