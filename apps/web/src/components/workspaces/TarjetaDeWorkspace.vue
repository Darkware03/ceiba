<script setup lang="ts">
/**
 * Una tarjeta de la lista de workspaces.
 *
 * La tarjeta no llama a la API ni toca el almacén: emite `renombrar` y
 * `borrar` y es la vista quien decide. Así el mismo componente sirve para
 * pintar y para probar, sin montar media aplicación.
 *
 * Detalle de accesibilidad que no se ve: los botones repiten el mismo texto en
 * cada tarjeta, así que llevan `aria-label` con el nombre del workspace. Un
 * lector de pantalla que enumere botones diría si no «Renombrar, Renombrar,
 * Renombrar…».
 */
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
// Desde `router/nombres.ts` y **no** desde `router/rutas.ts`: la tabla de
// rutas importa todas las vistas en diferido, así que tomar de ahí una simple
// constante arrastraría la aplicación entera a este componente y a su prueba.
import { RUTA_WORKSPACE } from '@/router/nombres';
import type { Workspace } from '@/api/tipos';

defineProps<{ workspace: Workspace }>();

const emitir = defineEmits<{ renombrar: []; borrar: [] }>();

const formateador = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' });

function fechaLegible(iso: string): string {
  const momento = new Date(iso);
  return Number.isNaN(momento.getTime()) ? '—' : formateador.format(momento);
}
</script>

<template>
  <li class="tarjeta ceiba-panel">
    <RouterLink
      class="tarjeta__enlace"
      :to="{ name: RUTA_WORKSPACE, params: { workspaceId: workspace.id } }"
    >
      <h3 class="tarjeta__nombre">{{ workspace.name }}</h3>
      <code class="tarjeta__slug">{{ workspace.slug }}</code>
    </RouterLink>

    <p class="tarjeta__descripcion">
      {{ workspace.description ?? 'Sin descripción.' }}
    </p>

    <footer class="tarjeta__pie">
      <time class="tarjeta__fecha" :datetime="workspace.createdAt">
        Creado el {{ fechaLegible(workspace.createdAt) }}
      </time>

      <div class="tarjeta__acciones">
        <CeibaBoton
          compacto
          variante="fantasma"
          :aria-label="`Renombrar el workspace ${workspace.name}`"
          @click="emitir('renombrar')"
        >
          Renombrar
        </CeibaBoton>
        <CeibaBoton
          compacto
          variante="peligro"
          :aria-label="`Borrar el workspace ${workspace.name}`"
          @click="emitir('borrar')"
        >
          Borrar
        </CeibaBoton>
      </div>
    </footer>
  </li>
</template>

<style scoped>
.tarjeta {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-3);
  padding: var(--ceiba-space-4);
  list-style: none;
}

.tarjeta__enlace {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
  color: var(--ceiba-text);
}

.tarjeta__enlace:hover .tarjeta__nombre {
  color: var(--ceiba-accent);
}

.tarjeta__nombre {
  font-size: var(--ceiba-text-lg);
}

.tarjeta__slug {
  color: var(--ceiba-text-faint);
  font-size: var(--ceiba-text-xs);
}

.tarjeta__descripcion {
  flex: 1;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.tarjeta__pie {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--ceiba-space-2);
  border-top: 1px solid var(--ceiba-border);
  padding-top: var(--ceiba-space-3);
}

.tarjeta__fecha {
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

.tarjeta__acciones {
  display: flex;
  gap: var(--ceiba-space-2);
}
</style>
