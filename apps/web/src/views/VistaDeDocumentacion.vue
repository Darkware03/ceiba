<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useWorkspacesStore } from '@/stores/workspaces'
import { obtenerDocumentacionWorkspace, type DocumentacionWorkspaceDto } from '@/api/studio'
import CeibaBoton from '@/components/ui/CeibaBoton.vue'
import CeibaAviso from '@/components/ui/CeibaAviso.vue'
import CeibaVacio from '@/components/ui/CeibaVacio.vue'

const storeWorkspaces = useWorkspacesStore()
const workspaceSeleccionadoId = ref<string>('')
const doc = ref<DocumentacionWorkspaceDto | null>(null)
const cargando = ref(false)
const error = ref<string | null>(null)
const copiado = ref(false)

async function cargarDoc(): Promise<void> {
  if (!workspaceSeleccionadoId.value) return
  cargando.value = true
  error.value = null
  try {
    doc.value = await obtenerDocumentacionWorkspace(workspaceSeleccionadoId.value)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'No se pudo generar la documentación.'
  } finally {
    cargando.value = false
  }
}

async function copiarMarkdown(): Promise<void> {
  if (!doc.value?.markdown) return
  await navigator.clipboard.writeText(doc.value.markdown)
  copiado.value = true
  setTimeout(() => { copiado.value = false }, 2000)
}

function descargarMarkdown(): void {
  if (!doc.value?.markdown) return
  const blob = new Blob([doc.value.markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${doc.value.workspace.slug || 'workspace'}-docs.md`
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(async () => {
  if (storeWorkspaces.items.length === 0) {
    await storeWorkspaces.cargar()
  }
  workspaceSeleccionadoId.value =
    storeWorkspaces.activoId ?? storeWorkspaces.items[0]?.id ?? ''
  if (workspaceSeleccionadoId.value) {
    await cargarDoc()
  }
})

watch(workspaceSeleccionadoId, (nuevoId) => {
  if (nuevoId) {
    storeWorkspaces.seleccionar(nuevoId)
    void cargarDoc()
  }
})
</script>

<template>
  <section class="vista-doc" aria-labelledby="titulo-doc">
    <header class="vista-doc__cabecera">
      <div>
        <p class="vista-doc__migas">Catálogo vivo de endpoints</p>
        <h1 id="titulo-doc" class="vista-doc__titulo">Documentación de API</h1>
        <p class="vista-doc__subtitulo">
          Documentación generada automáticamente a partir de tus colecciones, carpetas y peticiones.
        </p>
      </div>
      <div class="vista-doc__controles">
        <select v-model="workspaceSeleccionadoId" class="vista-doc__select">
          <option v-for="ws in storeWorkspaces.items" :key="ws.id" :value="ws.id">
            {{ ws.name }}
          </option>
        </select>
        <CeibaBoton variante="secundario" Tamano="sm" @click="copiarMarkdown">
          {{ copiado ? 'Markdown copiado' : 'Copiar Markdown' }}
        </CeibaBoton>
        <CeibaBoton variante="primario" Tamano="sm" @click="descargarMarkdown">
          Descargar .md
        </CeibaBoton>
      </div>
    </header>

    <CeibaAviso v-if="error" tipo="error" titulo="Error" :mensaje="error" />

    <div v-if="!doc || doc.collections.length === 0" class="vista-doc__vacio">
      <CeibaVacio
        titulo="Sin colecciones documentadas"
        descripcion="Crea colecciones y peticiones en el workspace para visualizar su referencia técnica."
      />
    </div>

    <div v-else class="vista-doc__colecciones">
      <article v-for="col in doc.collections" :key="col.id" class="vista-doc__coleccion">
        <header class="vista-doc__col-header">
          <h2>{{ col.name }}</h2>
          <p v-if="col.description">{{ col.description }}</p>
        </header>

        <div class="vista-doc__endpoints">
          <div v-for="req in col.requests" :key="req.id" class="vista-doc__endpoint">
            <div class="vista-doc__endpoint-top">
              <span class="vista-doc__metodo" :data-method="req.method">{{ req.method }}</span>
              <code class="vista-doc__url">{{ req.url }}</code>
              <strong class="vista-doc__nombre">{{ req.name }}</strong>
            </div>
            <p v-if="req.description" class="vista-doc__desc">{{ req.description }}</p>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.vista-doc {
  max-width: 1080px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--espacio-5);
}
.vista-doc__cabecera {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--espacio-4);
  flex-wrap: wrap;
}
.vista-doc__migas {
  margin: 0;
  font-size: var(--tamano-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-texto-atenuado);
}
.vista-doc__titulo {
  margin: var(--espacio-1) 0;
  font-size: var(--tamano-2xl);
}
.vista-doc__subtitulo {
  margin: 0;
  font-size: var(--tamano-sm);
  color: var(--color-texto-secundario);
}
.vista-doc__controles {
  display: flex;
  align-items: center;
  gap: var(--espacio-2);
}
.vista-doc__select {
  padding: var(--espacio-2) var(--espacio-3);
  border-radius: var(--radio-md);
  border: 1px solid var(--color-borde-fuerte);
  background-color: var(--color-superficie-1);
  color: var(--color-texto-primario);
}
.vista-doc__colecciones {
  display: flex;
  flex-direction: column;
  gap: var(--espacio-4);
}
.vista-doc__coleccion {
  background-color: var(--color-superficie-1);
  border: 1px solid var(--color-borde-sutil);
  border-radius: var(--radio-lg);
  padding: var(--espacio-5);
}
.vista-doc__col-header h2 {
  margin: 0 0 var(--espacio-1);
}
.vista-doc__col-header p {
  margin: 0 0 var(--espacio-3);
  color: var(--color-texto-secundario);
  font-size: var(--tamano-sm);
}
.vista-doc__endpoints {
  display: flex;
  flex-direction: column;
  gap: var(--espacio-2);
}
.vista-doc__endpoint {
  padding: var(--espacio-3);
  border-radius: var(--radio-md);
  border: 1px solid var(--color-borde-sutil);
  background-color: var(--color-superficie-2);
}
.vista-doc__endpoint-top {
  display: flex;
  align-items: center;
  gap: var(--espacio-3);
  flex-wrap: wrap;
}
.vista-doc__metodo {
  font-family: var(--fuente-mono);
  font-size: var(--tamano-xs);
  font-weight: var(--peso-semibold);
  padding: 2px 8px;
  border-radius: var(--radio-sm);
  background-color: var(--color-superficie-3);
}
.vista-doc__url {
  font-family: var(--fuente-mono);
  font-size: var(--tamano-xs);
  color: var(--color-acento-primario);
}
.vista-doc__desc {
  margin: var(--espacio-2) 0 0;
  font-size: var(--tamano-xs);
  color: var(--color-texto-secundario);
}
</style>
