<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { aceptarInvitacionPorToken, obtenerInvitacionPorToken, type InvitacionPublicaDto } from '@/api/studio'
import { useWorkspacesStore } from '@/stores/workspaces'
import { NOMBRES_RUTAS } from '@/router/nombres'
import CeibaBoton from '@/components/ui/CeibaBoton.vue'
import CeibaAviso from '@/components/ui/CeibaAviso.vue'

const route = useRoute()
const router = useRouter()
const storeWorkspaces = useWorkspacesStore()

const token = computed(() => String(route.params.token ?? ''))
const invitacion = ref<InvitacionPublicaDto | null>(null)
const cargando = ref(true)
const aceptando = ref(false)
const error = ref<string | null>(null)

function etiquetaPermiso(rol: string): string {
  if (rol === 'viewer') return 'Solo mostrar (Lectura)'
  if (rol === 'editor') return 'Mostrar y editar (Colaborador)'
  if (rol === 'executor') return 'Mostrar y ejecutar peticiones'
  if (rol === 'admin') return 'Administrador (Mostrar, editar y gestionar miembros)'
  return rol
}

async function cargar(): Promise<void> {
  if (!token.value) return
  cargando.value = true
  error.value = null
  try {
    invitacion.value = await obtenerInvitacionPorToken(token.value)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'La invitación no existe o ha expirado.'
  } finally {
    cargando.value = false
  }
}

async function aceptar(): Promise<void> {
  if (!token.value) return
  aceptando.value = true
  error.value = null
  try {
    const res = await aceptarInvitacionPorToken(token.value)
    await storeWorkspaces.cargar()
    storeWorkspaces.seleccionar(res.workspaceId)
    await router.push({
      name: NOMBRES_RUTAS.WORKSPACE_DETALLE,
      params: { workspaceId: res.workspaceId },
    })
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'No se pudo aceptar la invitación.'
  } finally {
    aceptando.value = false
  }
}

onMounted(() => {
  void cargar()
})
</script>

<template>
  <section class="vista-invitacion">
    <div class="vista-invitacion__tarjeta">
      <p class="vista-invitacion__migas">Invitación colaborativa por enlace</p>
      <h1 class="vista-invitacion__titulo">Unirse al espacio de trabajo</h1>

      <CeibaAviso v-if="error" tipo="error" titulo="No se pudo procesar la invitación" :mensaje="error" />

      <div v-if="cargando" class="vista-invitacion__estado">
        Verificando enlace de invitación…
      </div>

      <div v-else-if="invitacion" class="vista-invitacion__contenido">
        <div class="vista-invitacion__info">
          <div class="vista-invitacion__fila">
            <span>Workspace:</span>
            <strong>{{ invitacion.workspaceName }}</strong>
          </div>
          <div class="vista-invitacion__fila">
            <span>Invitado por:</span>
            <strong>{{ invitacion.invitedByName }} ({{ invitacion.invitedByEmail }})</strong>
          </div>
          <div class="vista-invitacion__fila">
            <span>Permiso otorgado:</span>
            <span class="vista-invitacion__badge">{{ etiquetaPermiso(invitacion.role) }}</span>
          </div>
          <div class="vista-invitacion__fila">
            <span>Estado:</span>
            <strong>{{ invitacion.status }}</strong>
          </div>
        </div>

        <div class="vista-invitacion__acciones">
          <CeibaBoton
            v-if="invitacion.status === 'pending'"
            variante="primario"
            :cargando="aceptando"
            @click="aceptar"
          >
            Aceptar invitación y abrir workspace
          </CeibaBoton>
          <CeibaBoton
            variante="secundario"
            @click="router.push({ name: NOMBRES_RUTAS.WORKSPACES })"
          >
            Ir a mis workspaces
          </CeibaBoton>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.vista-invitacion {
  max-width: 560px;
  margin: var(--espacio-8) auto;
}
.vista-invitacion__tarjeta {
  background-color: var(--color-superficie-1);
  border: 1px solid var(--color-borde-sutil);
  border-radius: var(--radio-lg);
  padding: var(--espacio-6);
  display: flex;
  flex-direction: column;
  gap: var(--espacio-4);
}
.vista-invitacion__migas {
  margin: 0;
  font-size: var(--tamano-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-texto-atenuado);
}
.vista-invitacion__titulo {
  margin: 0;
  font-size: var(--tamano-xl);
}
.vista-invitacion__info {
  display: flex;
  flex-direction: column;
  gap: var(--espacio-2);
  padding: var(--espacio-4);
  border-radius: var(--radio-md);
  background-color: var(--color-superficie-2);
  border: 1px solid var(--color-borde-sutil);
}
.vista-invitacion__fila {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--espacio-3);
  font-size: var(--tamano-sm);
}
.vista-invitacion__badge {
  padding: 2px 10px;
  border-radius: 999px;
  background-color: var(--color-acento-primario);
  color: var(--color-texto-sobre-acento);
  font-size: var(--tamano-xs);
  font-weight: var(--peso-semibold);
}
.vista-invitacion__acciones {
  display: flex;
  gap: var(--espacio-3);
  justify-content: flex-end;
}
</style>
