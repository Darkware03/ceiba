<script setup lang="ts">
/**
 * Navegación lateral del estudio.
 *
 * DOS CORRECCIONES DE FASE 4, las dos por el mismo motivo —decía cosas que no
 * podía saber—:
 *
 *  1. **El «workspace activo» sale de la URL, no de un campo inventado.**
 *     Antes leía `storeWorkspaces.activo`, que no existe en el almacén
 *     (`stores/workspaces.ts` expone `lista`, `porId(id)` y `estaVacia`), así
 *     que el bloque entero nunca se pintaba. Ahora el workspace activo es,
 *     literalmente, el de la ruta: `params.workspaceId` resuelto con
 *     `porId()`. Si no estamos dentro de un workspace, no hay bloque.
 *
 *  2. **Ya no se anuncia un rol que la API no manda.** Pintaba
 *     `workspaceActivo.myRole ?? 'editor'`, y `GET /api/v1/workspaces`
 *     **no devuelve `myRole`** (`workspace.controller.ts`, `vistaWorkspace()`:
 *     id, slug, name, description, ownerUserId, status, createdAt, updatedAt).
 *     El `?? 'editor'` convertía «no lo sé» en «eres editor», que es
 *     justamente la mentira que no puede permitirse una interfaz que habla de
 *     permisos. El rol real se consulta donde existe de verdad:
 *     `GET /workspaces/:id/settings` → `currentUserRole`, en la vista de
 *     Configuración.
 *
 * Todo valor visual sale de un token `--ceiba-*` de `@ceiba/brand`; antes usaba
 * 46 variables (`--espacio-*`, `--color-*`…) que no existen en ningún sitio, y
 * el navegador descartaba las declaraciones una a una.
 */
import { computed } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { NOMBRES_RUTAS } from '@/router/nombres';
import { usarAlmacenDeWorkspaces } from '@/stores/workspaces';

interface ElementoNav {
  readonly etiqueta: string;
  readonly nombreRuta: string;
  readonly activo: boolean;
}

const ruta = useRoute();
const workspaces = usarAlmacenDeWorkspaces();

/** El workspace activo es el de la URL; si no hay, no hay. */
const workspaceActivo = computed(() => {
  const id = ruta.params['workspaceId'];
  if (typeof id !== 'string' || id.length === 0) return null;
  return workspaces.porId(id);
});

const elementosPrincipales = computed<ElementoNav[]>(() => [
  {
    etiqueta: 'Espacios de trabajo',
    nombreRuta: NOMBRES_RUTAS.WORKSPACES,
    activo:
      ruta.name === NOMBRES_RUTAS.WORKSPACES || ruta.name === NOMBRES_RUTAS.WORKSPACE_DETALLE,
  },
  {
    etiqueta: 'Constructor HTTP',
    nombreRuta: NOMBRES_RUTAS.CONSTRUCTOR,
    activo: ruta.name === NOMBRES_RUTAS.CONSTRUCTOR,
  },
]);

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
    etiqueta: 'Configuración y colaboración',
    nombreRuta: NOMBRES_RUTAS.CONFIGURACION,
    activo: ruta.name === NOMBRES_RUTAS.CONFIGURACION,
  },
]);
</script>

<template>
  <aside class="barra-lateral" aria-label="Navegación principal">
    <nav class="barra-lateral__seccion" aria-labelledby="barra-lateral-navegacion">
      <h2 id="barra-lateral-navegacion" class="barra-lateral__titulo">Navegación</h2>
      <ul class="barra-lateral__lista">
        <li v-for="item in elementosPrincipales" :key="item.nombreRuta">
          <RouterLink
            :to="{ name: item.nombreRuta }"
            class="barra-lateral__enlace"
            :class="{ 'barra-lateral__enlace--activo': item.activo }"
            :aria-current="item.activo ? 'page' : undefined"
          >
            <span class="barra-lateral__indicador" aria-hidden="true"></span>
            <span>{{ item.etiqueta }}</span>
          </RouterLink>
        </li>
      </ul>
    </nav>

    <div v-if="workspaceActivo" class="barra-lateral__seccion">
      <h2 id="barra-lateral-workspace" class="barra-lateral__titulo">Workspace activo</h2>
      <RouterLink
        :to="{
          name: NOMBRES_RUTAS.WORKSPACE_DETALLE,
          params: { workspaceId: workspaceActivo.id },
        }"
        class="barra-lateral__workspace"
        :aria-label="`Abrir el workspace ${workspaceActivo.name}`"
      >
        <span class="barra-lateral__ws-inicial" aria-hidden="true">
          {{ workspaceActivo.name.charAt(0).toUpperCase() }}
        </span>
        <span class="barra-lateral__ws-texto">
          <span class="barra-lateral__ws-nombre">{{ workspaceActivo.name }}</span>
          <code class="barra-lateral__ws-slug">{{ workspaceActivo.slug }}</code>
        </span>
      </RouterLink>
    </div>

    <nav
      class="barra-lateral__seccion barra-lateral__seccion--modulos"
      aria-labelledby="barra-lateral-modulos"
    >
      <h2 id="barra-lateral-modulos" class="barra-lateral__titulo">Módulos del estudio</h2>
      <ul class="barra-lateral__lista">
        <li v-for="modulo in modulosPlataforma" :key="modulo.nombreRuta">
          <RouterLink
            :to="{ name: modulo.nombreRuta }"
            class="barra-lateral__enlace"
            :class="{ 'barra-lateral__enlace--activo': modulo.activo }"
            :aria-current="modulo.activo ? 'page' : undefined"
          >
            <span class="barra-lateral__indicador" aria-hidden="true"></span>
            <span>{{ modulo.etiqueta }}</span>
          </RouterLink>
        </li>
      </ul>
    </nav>
  </aside>
</template>

<style scoped>
.barra-lateral {
  width: 248px;
  flex-shrink: 0;
  background: var(--ceiba-surface);
  border-right: 1px solid var(--ceiba-border);
  padding: var(--ceiba-space-4) var(--ceiba-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-6);
  overflow-y: auto;
}

.barra-lateral__seccion {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-2);
}

.barra-lateral__seccion--modulos {
  margin-top: auto;
  padding-top: var(--ceiba-space-4);
  border-top: 1px solid var(--ceiba-border);
}

.barra-lateral__titulo {
  margin: 0;
  padding: 0 var(--ceiba-space-2);
  font-size: var(--ceiba-text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ceiba-text-faint);
}

.barra-lateral__lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
}

.barra-lateral__enlace {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-2);
  padding: var(--ceiba-space-2) var(--ceiba-space-3);
  border-radius: var(--ceiba-radius-md);
  color: var(--ceiba-text-muted);
  font-size: var(--ceiba-text-sm);
  font-weight: 500;
  text-decoration: none;
  transition:
    background-color var(--ceiba-duration-fast) var(--ceiba-ease),
    color var(--ceiba-duration-fast) var(--ceiba-ease);
}

.barra-lateral__enlace:hover {
  background: var(--ceiba-surface-raised);
  color: var(--ceiba-text);
  text-decoration: none;
}

.barra-lateral__enlace--activo {
  background: var(--ceiba-surface-raised);
  color: var(--ceiba-text);
  font-weight: 600;
}

.barra-lateral__indicador {
  width: 6px;
  height: 6px;
  border-radius: var(--ceiba-radius-pill);
  background: transparent;
  transition: background-color var(--ceiba-duration-fast) var(--ceiba-ease);
}

.barra-lateral__enlace--activo .barra-lateral__indicador {
  background: var(--ceiba-accent);
}

.barra-lateral__workspace {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-3);
  padding: var(--ceiba-space-2) var(--ceiba-space-3);
  border-radius: var(--ceiba-radius-md);
  background: var(--ceiba-surface-raised);
  border: 1px solid var(--ceiba-border);
  text-decoration: none;
  color: var(--ceiba-text);
}

.barra-lateral__workspace:hover {
  border-color: var(--ceiba-border-strong);
  text-decoration: none;
}

.barra-lateral__ws-inicial {
  width: 28px;
  height: 28px;
  border-radius: var(--ceiba-radius-sm);
  background: var(--ceiba-accent);
  color: var(--ceiba-on-accent);
  font-weight: 700;
  font-size: var(--ceiba-text-sm);
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
  font-size: var(--ceiba-text-sm);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.barra-lateral__ws-slug {
  font-size: var(--ceiba-text-xs);
  font-family: var(--ceiba-font-mono);
  color: var(--ceiba-text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 860px) {
  .barra-lateral {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid var(--ceiba-border);
  }
}
</style>
