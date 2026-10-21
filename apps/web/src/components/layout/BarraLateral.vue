<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { NOMBRES_RUTAS } from '@/router/nombres'
import { useWorkspacesStore } from '@/stores/workspaces'

const ruta = useRoute()
const storeWorkspaces = useWorkspacesStore()

const workspaceActivo = computed(() => storeWorkspaces.activo)

interface ElementoNav {
  etiqueta: string
  nombreRuta: string
  activo: boolean
}

const elementosPrincipales = computed<ElementoNav[]>(() => [
  {
    etiqueta: 'Espacios de trabajo',
    nombreRuta: NOMBRES_RUTAS.WORKSPACES,
    activo:
      ruta.name === NOMBRES_RUTAS.WORKSPACES ||
      ruta.name === NOMBRES_RUTAS.WORKSPACE_DETALLE,
  },
  {
    etiqueta: 'Constructor HTTP',
    nombreRuta: NOMBRES_RUTAS.CONSTRUCTOR,
    activo: ruta.name === NOMBRES_RUTAS.CONSTRUCTOR,
  },
])

const modulosPlataforma = computed<ElementoNav[]>(() => [
  {
    etiqueta: 'Historial',
    nombreRuta: NOMBRES_RUTAS.HISTORIAL,
    activo: ruta.name === NOMBRES_RUTAS.HISTORIAL,
  },
  {
    etiqueta: 'Entornos',
    nombreRuta: NOMBRES_RUTAS.ENTORNOS,
    activo: ruta.name === NOMBRES_RUTAS.ENTORNOS,
  },
  {
    etiqueta: 'Ejecuciones',
    nombreRuta: NOMBRES_RUTAS.EJECUCIONES,
    activo: ruta.name === NOMBRES_RUTAS.EJECUCIONES,
  },
  {
    etiqueta: 'Documentación',
    nombreRuta: NOMBRES_RUTAS.DOCUMENTACION,
    activo: ruta.name === NOMBRES_RUTAS.DOCUMENTACION,
  },
  {
    etiqueta: 'Importar / Exportar',
    nombreRuta: NOMBRES_RUTAS.IMPORTAR,
    activo: ruta.name === NOMBRES_RUTAS.IMPORTAR,
  },
  {
    etiqueta: 'Configuración y Colaboración',
    nombreRuta: NOMBRES_RUTAS.CONFIGURACION,
    activo: ruta.name === NOMBRES_RUTAS.CONFIGURACION,
  },
])
</script>

<template>
  <aside class="barra-lateral" aria-label="Navegación principal">
    <div class="barra-lateral__seccion">
      <h2 class="barra-lateral__titulo">Navegación</h2>
      <ul class="barra-lateral__lista">
        <li v-for="item in elementosPrincipales" :key="item.nombreRuta">
          <RouterLink
            :to="{ name: item.nombreRuta }"
            class="barra-lateral__enlace"
            :class="{ 'barra-lateral__enlace--activo': item.activo }"
          >
            <span class="barra-lateral__indicador" aria-hidden="true"></span>
            <span>{{ item.etiqueta }}</span>
          </RouterLink>
        </li>
      </ul>
    </div>

    <div v-if="workspaceActivo" class="barra-lateral__seccion">
      <h2 class="barra-lateral__titulo">Workspace activo</h2>
      <RouterLink
        :to="{
          name: NOMBRES_RUTAS.WORKSPACE_DETALLE,
          params: { workspaceId: workspaceActivo.id },
        }"
        class="barra-lateral__workspace"
      >
        <span class="barra-lateral__ws-inicial" aria-hidden="true">
          {{ workspaceActivo.name.charAt(0).toUpperCase() }}
        </span>
        <span class="barra-lateral__ws-texto">
          <span class="barra-lateral__ws-nombre">{{ workspaceActivo.name }}</span>
          <span class="barra-lateral__ws-slug">
            {{ workspaceActivo.slug }} · {{ workspaceActivo.myRole === 'viewer' ? 'Solo mostrar' : (workspaceActivo.myRole ?? 'editor') }}
          </span>
        </span>
      </RouterLink>
    </div>

    <div class="barra-lateral__seccion barra-lateral__seccion--modulos">
      <h2 class="barra-lateral__titulo">Módulos del Estudio</h2>
      <ul class="barra-lateral__lista">
        <li v-for="mod in modulosPlataforma" :key="mod.nombreRuta">
          <RouterLink
            :to="{ name: mod.nombreRuta }"
            class="barra-lateral__enlace"
            :class="{ 'barra-lateral__enlace--activo': mod.activo }"
          >
            <span class="barra-lateral__indicador" aria-hidden="true"></span>
            <span>{{ mod.etiqueta }}</span>
          </RouterLink>
        </li>
      </ul>
    </div>
  </aside>
</template>

<style scoped>
.barra-lateral {
  width: 248px;
  flex-shrink: 0;
  background-color: var(--color-superficie-1);
  border-right: 1px solid var(--color-borde-sutil);
  padding: var(--espacio-4) var(--espacio-3);
  display: flex;
  flex-direction: column;
  gap: var(--espacio-6);
  overflow-y: auto;
}

.barra-lateral__seccion {
  display: flex;
  flex-direction: column;
  gap: var(--espacio-2);
}

.barra-lateral__seccion--modulos {
  margin-top: auto;
  padding-top: var(--espacio-4);
  border-top: 1px solid var(--color-borde-sutil);
}

.barra-lateral__titulo {
  margin: 0;
  padding: 0 var(--espacio-2);
  font-size: var(--tamano-xs);
  font-weight: var(--peso-semibold);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--color-texto-atenuado);
}

.barra-lateral__lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.barra-lateral__enlace {
  display: flex;
  align-items: center;
  gap: var(--espacio-2);
  padding: var(--espacio-2) var(--espacio-3);
  border-radius: var(--radio-md);
  color: var(--color-texto-secundario);
  font-size: var(--tamano-sm);
  font-weight: var(--peso-medio);
  text-decoration: none;
  transition:
    background-color var(--transicion-rapida),
    color var(--transicion-rapida);
}

.barra-lateral__enlace:hover {
  background-color: var(--color-superficie-2);
  color: var(--color-texto-primario);
  text-decoration: none;
}

.barra-lateral__enlace--activo {
  background-color: var(--color-superficie-2);
  color: var(--color-texto-primario);
  font-weight: var(--peso-semibold);
}

.barra-lateral__indicador {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background-color: transparent;
  transition: background-color var(--transicion-rapida);
}

.barra-lateral__enlace--activo .barra-lateral__indicador {
  background-color: var(--color-acento-primario);
}

.barra-lateral__workspace {
  display: flex;
  align-items: center;
  gap: var(--espacio-3);
  padding: var(--espacio-2) var(--espacio-3);
  border-radius: var(--radio-md);
  background-color: var(--color-superficie-2);
  border: 1px solid var(--color-borde-sutil);
  text-decoration: none;
  color: var(--color-texto-primario);
}

.barra-lateral__workspace:hover {
  border-color: var(--color-borde-fuerte);
  text-decoration: none;
}

.barra-lateral__ws-inicial {
  width: 28px;
  height: 28px;
  border-radius: var(--radio-sm);
  background-color: var(--color-acento-primario);
  color: var(--color-texto-sobre-acento);
  font-weight: var(--peso-bold);
  font-size: var(--tamano-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.barra-lateral__ws-texto {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.barra-lateral__ws-nombre {
  font-size: var(--tamano-sm);
  font-weight: var(--peso-semibold);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.barra-lateral__ws-slug {
  font-size: var(--tamano-xs);
  font-family: var(--fuente-mono);
  color: var(--color-texto-atenuado);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
