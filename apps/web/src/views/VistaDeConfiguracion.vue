<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useWorkspacesStore } from '@/stores/workspaces'
import {
  actualizarRolMiembro,
  crearInvitacionWorkspace,
  eliminarMiembroWorkspace,
  listarInvitacionesWorkspace,
  listarMiembrosWorkspace,
  revocarInvitacionWorkspace,
  type InvitacionCreadaDto,
  type InvitacionWorkspaceDto,
  type MiembroWorkspaceDto,
  type RolColaboracion,
} from '@/api/studio'
import CeibaBoton from '@/components/ui/CeibaBoton.vue'
import CeibaCampo from '@/components/ui/CeibaCampo.vue'
import CeibaAviso from '@/components/ui/CeibaAviso.vue'

const storeWorkspaces = useWorkspacesStore()

const workspaceSeleccionadoId = ref<string>('')
const miembros = ref<MiembroWorkspaceDto[]>([])
const invitaciones = ref<InvitacionWorkspaceDto[]>([])
const correoInvitado = ref('')
const rolInvitado = ref<'viewer' | 'editor' | 'executor' | 'admin'>('editor')
const diasExpiracion = ref(7)
const ultimaInvitacionCreada = ref<InvitacionCreadaDto | null>(null)
const urlCopiada = ref(false)
const nombreRenombrado = ref('')
const cargando = ref(false)
const procesando = ref(false)
const error = ref<string | null>(null)
const mensajeExito = ref<string | null>(null)

const workspaceActual = computed(() =>
  storeWorkspaces.items.find((w) => w.id === workspaceSeleccionadoId.value) ?? null,
)

const esAdmin = computed(() => {
  const r = workspaceActual.value?.myRole
  return !r || r === 'owner' || r === 'admin'
})

function descripcionRol(rol: RolColaboracion): string {
  switch (rol) {
    case 'owner':
      return 'Propietario (Control total)'
    case 'admin':
      return 'Administrador (Mostrar, editar y gestionar miembros)'
    case 'editor':
      return 'Mostrar y editar (Colecciones, carpetas, peticiones y entornos)'
    case 'executor':
      return 'Mostrar y ejecutar (Sin editar estructura)'
    case 'viewer':
      return 'Solo mostrar (Solo lectura)'
  }
}

async function cargarColaboracion(): Promise<void> {
  if (!workspaceSeleccionadoId.value) return
  cargando.value = true
  error.value = null
  try {
    const [listaMiembros, listaInvitaciones] = await Promise.all([
      listarMiembrosWorkspace(workspaceSeleccionadoId.value),
      listarInvitacionesWorkspace(workspaceSeleccionadoId.value),
    ])
    miembros.value = listaMiembros
    invitaciones.value = listaInvitaciones
    nombreRenombrado.value = workspaceActual.value?.name ?? ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'No se pudo cargar la configuración.'
  } finally {
    cargando.value = false
  }
}

async function generarInvitacion(): Promise<void> {
  if (!workspaceSeleccionadoId.value) return
  procesando.value = true
  error.value = null
  mensajeExito.value = null
  try {
    const creada = await crearInvitacionWorkspace(workspaceSeleccionadoId.value, {
      email: correoInvitado.value.trim() || undefined,
      role: rolInvitado.value,
      expiresInDays: diasExpiracion.value,
    })
    ultimaInvitacionCreada.value = creada
    correoInvitado.value = ''
    await cargarColaboracion()
    mensajeExito.value = 'Enlace de invitación colaborativa generado correctamente.'
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'No se pudo generar la invitación.'
  } finally {
    procesando.value = false
  }
}

async function copiarUrlInvitacion(): Promise<void> {
  if (!ultimaInvitacionCreada.value) return
  const origin = window.location.origin
  const fullUrl = `${origin}/invitacion/${ultimaInvitacionCreada.value.inviteToken}`
  await navigator.clipboard.writeText(fullUrl)
  urlCopiada.value = true
  setTimeout(() => { urlCopiada.value = false }, 2500)
}

function obtenerUrlCompleta(inv: InvitacionCreadaDto): string {
  return `${window.location.origin}/invitacion/${inv.inviteToken}`
}

async function cambiarRol(miembro: MiembroWorkspaceDto, nuevoRol: string): Promise<void> {
  if (!workspaceSeleccionadoId.value || miembro.role === 'owner') return
  error.value = null
  try {
    await actualizarRolMiembro(
      workspaceSeleccionadoId.value,
      miembro.userId,
      nuevoRol as 'viewer' | 'editor' | 'executor' | 'admin',
    )
    await cargarColaboracion()
    mensajeExito.value = `Permiso de ${miembro.displayName} actualizado a «${descripcionRol(nuevoRol as RolColaboracion)}».`
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'No se pudo actualizar el rol.'
  }
}

async function quitarMiembro(miembro: MiembroWorkspaceDto): Promise<void> {
  if (!workspaceSeleccionadoId.value || miembro.role === 'owner') return
  error.value = null
  try {
    await eliminarMiembroWorkspace(workspaceSeleccionadoId.value, miembro.userId)
    await cargarColaboracion()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'No se pudo eliminar al miembro.'
  }
}

async function revocarInvitacion(id: string): Promise<void> {
  if (!workspaceSeleccionadoId.value) return
  error.value = null
  try {
    await revocarInvitacionWorkspace(workspaceSeleccionadoId.value, id)
    await cargarColaboracion()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'No se pudo revocar la invitación.'
  }
}

async function guardarNombreWorkspace(): Promise<void> {
  if (!workspaceSeleccionadoId.value || !nombreRenombrado.value.trim()) return
  procesando.value = true
  error.value = null
  try {
    await storeWorkspaces.renombrar(workspaceSeleccionadoId.value, {
      name: nombreRenombrado.value.trim(),
    })
    mensajeExito.value = 'Nombre del workspace actualizado.'
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'No se pudo renombrar el workspace.'
  } finally {
    procesando.value = false
  }
}

onMounted(async () => {
  if (storeWorkspaces.items.length === 0) {
    await storeWorkspaces.cargar()
  }
  workspaceSeleccionadoId.value =
    storeWorkspaces.activoId ?? storeWorkspaces.items[0]?.id ?? ''
  if (workspaceSeleccionadoId.value) {
    await cargarColaboracion()
  }
})

watch(workspaceSeleccionadoId, (nuevoId) => {
  if (nuevoId) {
    storeWorkspaces.seleccionar(nuevoId)
    ultimaInvitacionCreada.value = null
    void cargarColaboracion()
  }
})
</script>

<template>
  <section class="vista-config" aria-labelledby="titulo-config">
    <header class="vista-config__cabecera">
      <div>
        <p class="vista-config__migas">Trabajo colaborativo y permisos</p>
        <h1 id="titulo-config" class="vista-config__titulo">Configuración y Colaboradores</h1>
        <p class="vista-config__subtitulo">
          Invita a otros usuarios mediante enlace URL o correo y define si pueden <strong>solo mostrar (lectura)</strong> o <strong>mostrar y editar</strong>.
        </p>
      </div>
      <div class="vista-config__controles">
        <label class="vista-config__selector-label">
          <span>Workspace</span>
          <select v-model="workspaceSeleccionadoId" class="vista-config__select">
            <option v-for="ws in storeWorkspaces.items" :key="ws.id" :value="ws.id">
              {{ ws.name }} ({{ ws.myRole ?? 'miembro' }})
            </option>
          </select>
        </label>
      </div>
    </header>

    <CeibaAviso v-if="error" tipo="error" titulo="Error" :mensaje="error" />
    <CeibaAviso v-if="mensajeExito" tipo="exito" titulo="Listo" :mensaje="mensajeExito" />

    <div class="vista-config__grid">
      <div class="vista-config__panel">
        <h2>Generar invitación colaborativa (por URL / correo)</h2>
        <p class="vista-config__ayuda">
          Comparte el enlace generado con cualquier usuario registrado para que se una al workspace con el nivel de acceso elegido.
        </p>

        <form v-if="esAdmin" class="vista-config__form" @submit.prevent="generarInvitacion">
          <CeibaCampo
            id="correo-invitado"
            v-model="correoInvitado"
            etiqueta="Correo del invitado (opcional: déjalo vacío para enlace abierto por URL)"
            placeholder="colaborador@empresa.com"
          />

          <div class="vista-config__fila-form">
            <label class="vista-config__campo-select">
              <span>Nivel de permiso para el invitado</span>
              <select v-model="rolInvitado" class="vista-config__select">
                <option value="viewer">Solo mostrar (Solo lectura - viewer)</option>
                <option value="editor">Mostrar y editar (Colaborador - editor)</option>
                <option value="executor">Mostrar y ejecutar peticiones (executor)</option>
                <option value="admin">Administrador (Mostrar, editar e invitar - admin)</option>
              </select>
            </label>

            <label class="vista-config__campo-select">
              <span>Validez del enlace</span>
              <select v-model.number="diasExpiracion" class="vista-config__select">
                <option :value="1">1 día</option>
                <option :value="7">7 días</option>
                <option :value="14">14 días</option>
                <option :value="30">30 días</option>
              </select>
            </label>
          </div>

          <CeibaBoton tipo="submit" variante="primario" :cargando="procesando">
            Generar enlace de invitación
          </CeibaBoton>
        </form>
        <p v-else class="vista-config__nota-rol">
          Solo los propietarios o administradores del workspace pueden generar nuevas invitaciones.
        </p>

        <div v-if="ultimaInvitacionCreada" class="vista-config__url-box">
          <p class="vista-config__url-label">
            Enlace de invitación listo ({{ descripcionRol(ultimaInvitacionCreada.role) }}):
          </p>
          <div class="vista-config__url-row">
            <input
              type="text"
              readonly
              class="vista-config__url-input"
              :value="obtenerUrlCompleta(ultimaInvitacionCreada)"
            />
            <CeibaBoton variante="primario" Tamano="sm" @click="copiarUrlInvitacion">
              {{ urlCopiada ? '¡URL Copiada!' : 'Copiar URL' }}
            </CeibaBoton>
          </div>
        </div>

        <h3 class="vista-config__subseccion">Invitaciones generadas</h3>
        <ul v-if="invitaciones.length > 0" class="vista-config__lista-inv">
          <li v-for="inv in invitaciones" :key="inv.id" class="vista-config__item-inv">
            <div>
              <strong>{{ inv.email }}</strong>
              <span class="vista-config__tag">{{ descripcionRol(inv.role) }}</span>
              <span class="vista-config__estado" :data-status="inv.status">{{ inv.status }}</span>
            </div>
            <CeibaBoton
              v-if="esAdmin && inv.status === 'pending'"
              variante="peligro"
              Tamano="sm"
              @click="revocarInvitacion(inv.id)"
            >
              Revocar
            </CeibaBoton>
          </li>
        </ul>
        <p v-else class="vista-config__vacio-txt">No hay invitaciones registradas todavía.</p>
      </div>

      <div class="vista-config__panel">
        <h2>Miembros activos del workspace ({{ miembros.length }})</h2>
        <p class="vista-config__ayuda">
          Cambia en cualquier momento si un colaborador puede <strong>solo mostrar</strong> o <strong>mostrar y editar</strong>.
        </p>

        <table class="vista-config__tabla">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Permiso actual</th>
              <th v-if="esAdmin">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in miembros" :key="m.id">
              <td>
                <div class="vista-config__usuario">
                  <strong>{{ m.displayName }}</strong>
                  <span>{{ m.email }}</span>
                </div>
              </td>
              <td>
                <select
                  v-if="esAdmin && m.role !== 'owner'"
                  :value="m.role"
                  class="vista-config__select"
                  @change="cambiarRol(m, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="viewer">Solo mostrar (viewer)</option>
                  <option value="editor">Mostrar y editar (editor)</option>
                  <option value="executor">Mostrar y ejecutar (executor)</option>
                  <option value="admin">Administrador (admin)</option>
                </select>
                <span v-else class="vista-config__tag">{{ descripcionRol(m.role) }}</span>
              </td>
              <td v-if="esAdmin">
                <CeibaBoton
                  v-if="m.role !== 'owner'"
                  variante="peligro"
                  Tamano="sm"
                  @click="quitarMiembro(m)"
                >
                  Quitar
                </CeibaBoton>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="esAdmin" class="vista-config__renombrar">
          <h3 class="vista-config__subseccion">Ajustes generales del workspace</h3>
          <form class="vista-config__fila-form" @submit.prevent="guardarNombreWorkspace">
            <CeibaCampo
              id="nombre-ws-cfg"
              v-model="nombreRenombrado"
              etiqueta="Nombre del workspace"
            />
            <CeibaBoton tipo="submit" variante="secundario" :cargando="procesando">
              Guardar nombre
            </CeibaBoton>
          </form>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.vista-config {
  max-width: 1180px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--espacio-5);
}
.vista-config__cabecera {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--espacio-4);
  flex-wrap: wrap;
}
.vista-config__migas {
  margin: 0;
  font-size: var(--tamano-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-texto-atenuado);
}
.vista-config__titulo {
  margin: var(--espacio-1) 0;
  font-size: var(--tamano-2xl);
}
.vista-config__subtitulo {
  margin: 0;
  font-size: var(--tamano-sm);
  color: var(--color-texto-secundario);
}
.vista-config__selector-label {
  display: flex;
  align-items: center;
  gap: var(--espacio-2);
  font-size: var(--tamano-sm);
}
.vista-config__select {
  padding: var(--espacio-2) var(--espacio-3);
  border-radius: var(--radio-md);
  border: 1px solid var(--color-borde-fuerte);
  background-color: var(--color-superficie-1);
  color: var(--color-texto-primario);
}
.vista-config__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--espacio-5);
}
.vista-config__panel {
  background-color: var(--color-superficie-1);
  border: 1px solid var(--color-borde-sutil);
  border-radius: var(--radio-lg);
  padding: var(--espacio-5);
  display: flex;
  flex-direction: column;
  gap: var(--espacio-3);
}
.vista-config__panel h2 {
  margin: 0;
  font-size: var(--tamano-lg);
}
.vista-config__ayuda {
  margin: 0;
  font-size: var(--tamano-xs);
  color: var(--color-texto-secundario);
}
.vista-config__form {
  display: flex;
  flex-direction: column;
  gap: var(--espacio-3);
}
.vista-config__fila-form {
  display: flex;
  gap: var(--espacio-3);
  align-items: flex-end;
  flex-wrap: wrap;
}
.vista-config__campo-select {
  display: flex;
  flex-direction: column;
  gap: var(--espacio-1);
  font-size: var(--tamano-xs);
  color: var(--color-texto-secundario);
  flex: 1;
}
.vista-config__url-box {
  padding: var(--espacio-3);
  border-radius: var(--radio-md);
  background-color: var(--color-superficie-2);
  border: 1px solid var(--color-acento-primario);
}
.vista-config__url-label {
  margin: 0 0 var(--espacio-2);
  font-size: var(--tamano-xs);
  font-weight: var(--peso-semibold);
}
.vista-config__url-row {
  display: flex;
  gap: var(--espacio-2);
}
.vista-config__url-input {
  flex: 1;
  font-family: var(--fuente-mono);
  font-size: var(--tamano-xs);
  padding: var(--espacio-2);
  border-radius: var(--radio-sm);
  border: 1px solid var(--color-borde-fuerte);
  background-color: var(--color-superficie-1);
  color: var(--color-texto-primario);
}
.vista-config__subseccion {
  margin: var(--espacio-3) 0 var(--espacio-1);
  font-size: var(--tamano-sm);
}
.vista-config__lista-inv {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--espacio-2);
}
.vista-config__item-inv {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--espacio-2) var(--espacio-3);
  border-radius: var(--radio-md);
  background-color: var(--color-superficie-2);
  font-size: var(--tamano-xs);
}
.vista-config__tag {
  display: inline-block;
  margin-left: var(--espacio-2);
  padding: 2px 8px;
  border-radius: 999px;
  background-color: var(--color-superficie-3);
  font-size: var(--tamano-xs);
}
.vista-config__estado {
  margin-left: var(--espacio-2);
  text-transform: uppercase;
  font-weight: var(--peso-semibold);
}
.vista-config__tabla {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--tamano-sm);
}
.vista-config__tabla th,
.vista-config__tabla td {
  padding: var(--espacio-2);
  border-bottom: 1px solid var(--color-borde-sutil);
  text-align: left;
}
.vista-config__usuario {
  display: flex;
  flex-direction: column;
}
.vista-config__usuario span {
  font-size: var(--tamano-xs);
  color: var(--color-texto-atenuado);
}
@media (max-width: 900px) {
  .vista-config__grid {
    grid-template-columns: 1fr;
  }
}
</style>
