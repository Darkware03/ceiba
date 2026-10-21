<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NOMBRES_RUTAS } from '@/router/nombres'
import { useWorkspacesStore } from '@/stores/workspaces'
import { useColeccionesStore } from '@/stores/colecciones'
import { useConstructorStore } from '@/stores/constructor'
import { apiStudio } from '@/api/studio'
import type { Coleccion, PeticionGuardada } from '@/api/tipos'
import CeibaBoton from '@/components/ui/CeibaBoton.vue'
import CeibaAviso from '@/components/ui/CeibaAviso.vue'
import CeibaVacio from '@/components/ui/CeibaVacio.vue'
import CeibaDialogo from '@/components/ui/CeibaDialogo.vue'
import CeibaCampo from '@/components/ui/CeibaCampo.vue'
import FilaDeColeccion from '@/components/workspaces/FilaDeColeccion.vue'
import DialogoDeRenombrado from '@/components/workspaces/DialogoDeRenombrado.vue'
import DialogoDeBorrado from '@/components/workspaces/DialogoDeBorrado.vue'

const props = defineProps<{ workspaceId: string }>()
const router = useRouter()
const storeWorkspaces = useWorkspacesStore()
const storeColecciones = useColeccionesStore()
const storeConstructor = useConstructorStore()

const dialogoRenombrarAbierto = ref(false)
const dialogoBorrarAbierto = ref(false)
const modalColeccionAbierto = ref(false)
const nombreNuevaColeccion = ref('')
const descripcionNuevaColeccion = ref('')
const errorNuevaColeccion = ref<string | null>(null)
const creandoColeccion = ref(false)
const modalCarpetaAbierto = ref(false)
const coleccionDestinoCarpeta = ref<string | null>(null)
const nombreNuevaCarpeta = ref('')
const descripcionNuevaCarpeta = ref('')
const errorNuevaCarpeta = ref<string | null>(null)
const creandoCarpeta = ref(false)

const workspace = computed(() => storeWorkspaces.activo)
const rolActual = computed(() => workspace.value?.myRole ?? 'editor')
const puedeEditar = computed(() => ['owner', 'admin', 'editor'].includes(rolActual.value))
const etiquetaRol = computed(() => {
  switch (rolActual.value) {
    case 'owner': return 'Propietario (Control total)'
    case 'admin': return 'Administrador (Mostrar y editar)'
    case 'editor': return 'Colaborador (Mostrar y editar)'
    case 'executor': return 'Ejecutor (Mostrar y ejecutar)'
    case 'viewer': return 'Invitado (Solo mostrar)'
    default: return rolActual.value
  }
})

async function cargarTodo(id: string): Promise<void> {
  try {
    await storeWorkspaces.seleccionarWorkspace(id)
    await storeColecciones.cargarColecciones(id)
    try {
      const config = await apiStudio.obtenerConfiguracionWorkspace(id)
      if (storeWorkspaces.activo && config.workspace?.myRole) {
        storeWorkspaces.activo.myRole = config.workspace.myRole as any
      }
    } catch { /* ignore */ }
  } catch { /* reflejado en store */ }
}

onMounted(() => { void cargarTodo(props.workspaceId) })
watch(() => props.workspaceId, (id) => { if (id) void cargarTodo(id) })

function abrirModalNuevaColeccion(): void {
  if (!puedeEditar.value) return
  nombreNuevaColeccion.value = ''
  descripcionNuevaColeccion.value = ''
  errorNuevaColeccion.value = null
  modalColeccionAbierto.value = true
}

async function confirmarNuevaColeccion(): Promise<void> {
  const nombre = nombreNuevaColeccion.value.trim()
  if (!nombre) { errorNuevaColeccion.value = 'El nombre de la colección es obligatorio.'; return }
  creandoColeccion.value = true
  errorNuevaColeccion.value = null
  try {
    await storeColecciones.crearColeccion({
      workspaceId: props.workspaceId,
      name: nombre,
      description: descripcionNuevaColeccion.value.trim() || null,
    })
    modalColeccionAbierto.value = false
  } catch (err) {
    errorNuevaColeccion.value = err instanceof Error ? err.message : 'No se pudo crear la colección.'
  } finally {
    creandoColeccion.value = false
  }
}

function abrirModalNuevaCarpeta(coleccionId: string): void {
  if (!puedeEditar.value) return
  coleccionDestinoCarpeta.value = coleccionId
  nombreNuevaCarpeta.value = ''
  descripcionNuevaCarpeta.value = ''
  errorNuevaCarpeta.value = null
  modalCarpetaAbierto.value = true
}

async function confirmarNuevaCarpeta(): Promise<void> {
  const nombre = nombreNuevaCarpeta.value.trim()
  if (!nombre || !coleccionDestinoCarpeta.value) {
    errorNuevaCarpeta.value = 'El nombre de la carpeta es obligatorio.'
    return
  }
  creandoCarpeta.value = true
  errorNuevaCarpeta.value = null
  try {
    await storeColecciones.crearCarpeta(coleccionDestinoCarpeta.value, {
      name: nombre,
      description: descripcionNuevaCarpeta.value.trim() || null,
    })
    modalCarpetaAbierto.value = false
  } catch (err) {
    errorNuevaCarpeta.value = err instanceof Error ? err.message : 'No se pudo crear la carpeta.'
  } finally {
    creandoCarpeta.value = false
  }
}

function irANuevaPeticion(coleccion: Coleccion): void {
  if (!puedeEditar.value) return
  storeConstructor.prepararNuevaEnColeccion(props.workspaceId, coleccion.id, null)
  void router.push({
    name: NOMBRES_RUTAS.CONSTRUCTOR,
    query: { workspaceId: props.workspaceId, collectionId: coleccion.id },
  })
}

function abrirPeticionExistente(peticion: PeticionGuardada): void {
  storeConstructor.cargarDesdePeticionGuardada(peticion, props.workspaceId)
  void router.push({
    name: NOMBRES_RUTAS.CONSTRUCTOR,
    query: { workspaceId: props.workspaceId, collectionId: peticion.collectionId, requestId: peticion.id },
  })
}

async function eliminarColeccion(coleccion: Coleccion): Promise<void> {
  if (!puedeEditar.value) return
  await storeColecciones.eliminarColeccion(coleccion.id)
}

function abrirConstructorVacio(): void {
  storeConstructor.reiniciar()
  void router.push({ name: NOMBRES_RUTAS.CONSTRUCTOR, query: { workspaceId: props.workspaceId } })
}

function alBorrarWorkspace(): void {
  dialogoBorrarAbierto.value = false
  void router.push({ name: NOMBRES_RUTAS.WORKSPACES })
}
</script>


<template>
  <section class="vista-ws" aria-labelledby="titulo-ws">
    <div class="vista-ws__migas">
      <RouterLink :to="{ name: NOMBRES_RUTAS.WORKSPACES }" class="vista-ws__miga-enlace">
        Espacios de trabajo
      </RouterLink>
      <span aria-hidden="true">/</span>
      <span>{{ workspace?.name ?? props.workspaceId }}</span>
    </div>

    <CeibaAviso
      v-if="storeWorkspaces.error || storeColecciones.error"
      tipo="error"
      titulo="Error en el espacio de trabajo"
      :mensaje="storeWorkspaces.error ?? storeColecciones.error ?? ''"
    />

    <header v-if="workspace" class="vista-ws__cabecera">
      <div class="vista-ws__identidad">
        <div class="vista-ws__avatar" aria-hidden="true">
          {{ workspace.name.charAt(0).toUpperCase() }}
        </div>
        <div>
          <div class="vista-ws__titulo-fila">
            <h1 id="titulo-ws" class="vista-ws__titulo">{{ workspace.name }}</h1>
            <span class="vista-ws__rol-badge" :data-readonly="!puedeEditar">
              {{ etiquetaRol }}
            </span>
          </div>
          <p class="vista-ws__meta">
            <span class="vista-ws__slug">{{ workspace.slug }}</span>
          </p>
        </div>
      </div>

      <div class="vista-ws__acciones">
        <CeibaBoton
          v-if="puedeEditar"
          variante="primario"
          Tamano="sm"
          @click="abrirModalNuevaColeccion"
        >
          Nueva colección
        </CeibaBoton>
        <CeibaBoton variante="secundario" Tamano="sm" @click="abrirConstructorVacio">
          Constructor libre
        </CeibaBoton>
        <CeibaBoton
          variante="secundario"
          Tamano="sm"
          @click="router.push({ name: NOMBRES_RUTAS.CONFIGURACION })"
        >
          Invitar / Colaboradores
        </CeibaBoton>
        <CeibaBoton
          variante="secundario"
          Tamano="sm"
          @click="router.push({ name: NOMBRES_RUTAS.IMPORTAR })"
        >
          Importar / Exportar JSON
        </CeibaBoton>
        <CeibaBoton
          variante="fantasma"
          Tamano="sm"
          @click="router.push({ name: NOMBRES_RUTAS.HISTORIAL })"
        >
          Historial de cambios
        </CeibaBoton>
        <CeibaBoton
          v-if="rolActual === 'owner' || rolActual === 'admin'"
          variante="fantasma"
          Tamano="sm"
          @click="dialogoRenombrarAbierto = true"
        >
          Renombrar
        </CeibaBoton>
        <CeibaBoton
          v-if="rolActual === 'owner'"
          variante="peligro"
          Tamano="sm"
          @click="dialogoBorrarAbierto = true"
        >
          Eliminar
        </CeibaBoton>
      </div>
    </header>

    <CeibaAviso
      v-if="workspace && !puedeEditar"
      tipo="info"
      titulo="Modo colaborativo de solo lectura (Solo mostrar)"
      mensaje="Tienes acceso a visualizar las colecciones, carpetas, peticiones y documentación de este workspace, pero la edición está deshabilitada para tu rol."
    />

    <section class="vista-ws__colecciones" aria-labelledby="titulo-colecciones">
      <div class="vista-ws__colecciones-cab">
        <h2 id="titulo-colecciones" class="vista-ws__subtitulo">
          Colecciones ({{ storeColecciones.colecciones.length }})
        </h2>
      </div>

      <div
        v-if="storeColecciones.cargando && storeColecciones.colecciones.length === 0"
        class="vista-ws__cargando"
      >
        Cargando colecciones del espacio…
      </div>

      <div v-else-if="storeColecciones.colecciones.length === 0" class="vista-ws__vacio">
        <CeibaVacio
          titulo="Este espacio aún no tiene colecciones"
          descripcion="Crea tu primera colección o impórtala desde un archivo JSON para organizar carpetas y peticiones HTTP."
        >
          <template v-if="puedeEditar" #acciones>
            <CeibaBoton variante="primario" @click="abrirModalNuevaColeccion">
              Crear primera colección
            </CeibaBoton>
            <CeibaBoton
              variante="secundario"
              @click="router.push({ name: NOMBRES_RUTAS.IMPORTAR })"
            >
              Importar colección
            </CeibaBoton>
          </template>
        </CeibaVacio>
      </div>

      <div v-else class="vista-ws__lista-colecciones">
        <div
          v-for="col in storeColecciones.colecciones"
          :key="col.id"
          class="vista-ws__bloque-coleccion"
        >
          <div class="vista-ws__barra-exportar">
            <CeibaBoton
              variante="fantasma"
              Tamano="sm"
              @click="exportarColeccionJson(col)"
            >
              Exportar «{{ col.name }}» (.json)
            </CeibaBoton>
          </div>
          <FilaDeColeccion
            :coleccion="col"
            :arbol="storeColecciones.arbolesPorColeccion[col.id]"
            @renombrar-coleccion="abrirRenombrarColeccion"
            @eliminar-coleccion="eliminarColeccionDirecto"
            @crear-carpeta="abrirModalNuevaCarpeta"
            @eliminar-carpeta="eliminarCarpetaDirecto"
            @crear-peticion="abrirModalNuevaPeticion"
            @abrir-peticion="abrirPeticionEnConstructor"
            @eliminar-peticion="eliminarPeticionDirecto"
          />
        </div>
      </div>
    </section>

    <DialogoDeRenombrado
      :abierto="dialogoRenombrarAbierto"
      :workspace="workspace"
      :procesando="storeWorkspaces.procesando"
      :error-servidor="storeWorkspaces.error"
      @cerrar="dialogoRenombrarAbierto = false"
      @confirmar="confirmarRenombrado"
    />

    <DialogoDeBorrado
      :abierto="dialogoBorrarAbierto"
      :workspace="workspace"
      :procesando="storeWorkspaces.procesando"
      :error-servidor="storeWorkspaces.error"
      @cerrar="dialogoBorrarAbierto = false"
      @confirmar="confirmarBorrado"
    />

    <CeibaDialogo
      :abierto="modalNuevaColeccion"
      titulo="Nueva colección"
      descripcion="Agrupa carpetas y peticiones HTTP dentro del espacio de trabajo."
      @cerrar="modalNuevaColeccion = false"
    >
      <form class="form-modal" @submit.prevent="confirmarNuevaColeccion">
        <CeibaAviso v-if="errorFormulario" tipo="error" :mensaje="errorFormulario" />
        <CeibaCampo
          id="nombre-col"
          v-model="nombreNuevaColeccion"
          etiqueta="Nombre de la colección"
          placeholder="Ej. API de Pagos"
          obligatorio
        />
        <CeibaCampo
          id="desc-col"
          v-model="descripcionNuevaColeccion"
          etiqueta="Descripción (opcional)"
          placeholder="Endpoints principales del servicio"
        />
        <div class="form-modal__acciones">
          <CeibaBoton variante="fantasma" @click="modalNuevaColeccion = false">
            Cancelar
          </CeibaBoton>
          <CeibaBoton tipo="submit" variante="primario" :cargando="procesandoAccion">
            Crear colección
          </CeibaBoton>
        </div>
      </form>
    </CeibaDialogo>

    <CeibaDialogo
      :abierto="modalRenombrarCol"
      titulo="Editar colección"
      @cerrar="modalRenombrarCol = false"
    >
      <form class="form-modal" @submit.prevent="confirmarRenombrarColeccion">
        <CeibaAviso v-if="errorFormulario" tipo="error" :mensaje="errorFormulario" />
        <CeibaCampo
          id="renombrar-col"
          v-model="nuevoNombreCol"
          etiqueta="Nombre"
          obligatorio
        />
        <CeibaCampo
          id="renombrar-desc-col"
          v-model="nuevaDescCol"
          etiqueta="Descripción"
        />
        <div class="form-modal__acciones">
          <CeibaBoton variante="fantasma" @click="modalRenombrarCol = false">
            Cancelar
          </CeibaBoton>
          <CeibaBoton tipo="submit" variante="primario" :cargando="procesandoAccion">
            Guardar cambios
          </CeibaBoton>
        </div>
      </form>
    </CeibaDialogo>

    <CeibaDialogo
      :abierto="modalNuevaCarpeta"
      titulo="Nueva carpeta"
      @cerrar="modalNuevaCarpeta = false"
    >
      <form class="form-modal" @submit.prevent="confirmarNuevaCarpeta">
        <CeibaAviso v-if="errorFormulario" tipo="error" :mensaje="errorFormulario" />
        <CeibaCampo
          id="nombre-carpeta"
          v-model="nombreNuevaCarpeta"
          etiqueta="Nombre de la carpeta"
          placeholder="Ej. Autenticación"
          obligatorio
        />
        <div class="form-modal__acciones">
          <CeibaBoton variante="fantasma" @click="modalNuevaCarpeta = false">
            Cancelar
          </CeibaBoton>
          <CeibaBoton tipo="submit" variante="primario" :cargando="procesandoAccion">
            Crear carpeta
          </CeibaBoton>
        </div>
      </form>
    </CeibaDialogo>

    <CeibaDialogo
      :abierto="modalNuevaPeticion"
      titulo="Nueva petición HTTP"
      @cerrar="modalNuevaPeticion = false"
    >
      <form class="form-modal" @submit.prevent="confirmarNuevaPeticion">
        <CeibaAviso v-if="errorFormulario" tipo="error" :mensaje="errorFormulario" />
        <CeibaCampo
          id="nombre-peticion"
          v-model="nombreNuevaPeticion"
          etiqueta="Nombre de la petición"
          placeholder="Ej. Listar usuarios"
          obligatorio
        />
        <div class="form-modal__campo-select">
          <label for="metodo-peticion">Método HTTP</label>
          <select id="metodo-peticion" v-model="metodoNuevaPeticion">
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="PATCH">PATCH</option>
            <option value="DELETE">DELETE</option>
            <option value="HEAD">HEAD</option>
            <option value="OPTIONS">OPTIONS</option>
          </select>
        </div>
        <CeibaCampo
          id="url-peticion"
          v-model="urlNuevaPeticion"
          etiqueta="URL"
          placeholder="https://api.ejemplo.com/v1/recurso"
          obligatorio
        />
        <div class="form-modal__acciones">
          <CeibaBoton variante="fantasma" @click="modalNuevaPeticion = false">
            Cancelar
          </CeibaBoton>
          <CeibaBoton tipo="submit" variante="primario" :cargando="procesandoAccion">
            Crear y abrir
          </CeibaBoton>
        </div>
      </form>
    </CeibaDialogo>
  </section>
</template>

<style scoped>
.vista-ws {
  max-width: 1080px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--espacio-5);
}

.vista-ws__migas {
  display: flex;
  align-items: center;
  gap: var(--espacio-2);
  font-size: var(--tamano-xs);
  color: var(--color-texto-atenuado);
}

.vista-ws__miga-enlace {
  color: var(--color-texto-secundario);
}

.vista-ws__cabecera {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--espacio-4);
  flex-wrap: wrap;
  padding: var(--espacio-5);
  background-color: var(--color-superficie-1);
  border: 1px solid var(--color-borde-sutil);
  border-radius: var(--radio-lg);
}

.vista-ws__identidad {
  display: flex;
  align-items: center;
  gap: var(--espacio-4);
}

.vista-ws__avatar {
  width: 48px;
  height: 48px;
  border-radius: var(--radio-md);
  background-color: var(--color-acento-primario);
  color: var(--color-texto-sobre-acento);
  font-weight: var(--peso-bold);
  font-size: var(--tamano-xl);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.vista-ws__titulo-fila {
  display: flex;
  align-items: center;
  gap: var(--espacio-3);
  flex-wrap: wrap;
}

.vista-ws__titulo {
  margin: 0;
  font-size: var(--tamano-xl);
  font-weight: var(--peso-bold);
}

.vista-ws__rol-badge {
  padding: 2px 10px;
  border-radius: 999px;
  font-size: var(--tamano-xs);
  font-weight: var(--peso-semibold);
  background-color: var(--color-superficie-3);
  color: var(--color-texto-primario);
}

.vista-ws__rol-badge[data-readonly='true'] {
  background-color: rgba(245, 158, 11, 0.18);
  color: #f59e0b;
}

.vista-ws__meta {
  margin: var(--espacio-1) 0 0;
  display: flex;
  align-items: center;
  gap: var(--espacio-2);
  font-size: var(--tamano-xs);
  color: var(--color-texto-atenuado);
}

.vista-ws__slug {
  font-family: var(--fuente-mono);
}

.vista-ws__acciones {
  display: flex;
  align-items: center;
  gap: var(--espacio-2);
  flex-wrap: wrap;
}

.vista-ws__colecciones {
  display: flex;
  flex-direction: column;
  gap: var(--espacio-3);
}

.vista-ws__subtitulo {
  margin: 0;
  font-size: var(--tamano-md);
  font-weight: var(--peso-semibold);
}

.vista-ws__cargando {
  padding: var(--espacio-6);
  text-align: center;
  color: var(--color-texto-secundario);
}

.vista-ws__vacio {
  background-color: var(--color-superficie-1);
  border: 1px solid var(--color-borde-sutil);
  border-radius: var(--radio-lg);
}

.vista-ws__lista-colecciones {
  display: flex;
  flex-direction: column;
  gap: var(--espacio-3);
}

.vista-ws__bloque-coleccion {
  display: flex;
  flex-direction: column;
  gap: var(--espacio-1);
}

.vista-ws__barra-exportar {
  display: flex;
  justify-content: flex-end;
}

.form-modal {
  display: flex;
  flex-direction: column;
  gap: var(--espacio-4);
}

.form-modal__campo-select {
  display: flex;
  flex-direction: column;
  gap: var(--espacio-1);
  font-size: var(--tamano-xs);
  font-weight: var(--peso-medio);
  color: var(--color-texto-secundario);
}

.form-modal__campo-select select {
  padding: var(--espacio-2) var(--espacio-3);
  background-color: var(--color-superficie-2);
  color: var(--color-texto-primario);
  border: 1px solid var(--color-borde-fuerte);
  border-radius: var(--radio-md);
  font-family: var(--fuente-mono);
}

.form-modal__acciones {
  display: flex;
  justify-content: flex-end;
  gap: var(--espacio-2);
}
</style>
