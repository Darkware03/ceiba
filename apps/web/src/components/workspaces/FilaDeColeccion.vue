<script setup lang="ts">
/**
 * Una colección dentro de la vista de un workspace.
 *
 * Es una fila y no una tarjeta porque las colecciones se leen en vertical y en
 * cantidad; a partir de 720 px de ancho se apila para que en móvil no haya
 * desplazamiento horizontal.
 *
 * No hay enlace a «abrir la colección»: esa pantalla todavía no existe en esta
 * ronda y §18 prohíbe pintar controles sin funcionalidad. En cuanto exista la
 * vista de detalle, el nombre pasa a ser `RouterLink`.
 */
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import type { Coleccion } from '@/api/tipos';

defineProps<{ coleccion: Coleccion }>();

const emitir = defineEmits<{ renombrar: []; borrar: [] }>();
</script>

<template>
  <li class="fila">
    <div class="fila__datos">
      <div class="fila__titulo">
        <h3 class="fila__nombre">{{ coleccion.name }}</h3>
        <code class="fila__slug">{{ coleccion.slug }}</code>
      </div>
      <p class="fila__descripcion">{{ coleccion.description ?? 'Sin descripción.' }}</p>
    </div>

    <div class="fila__acciones">
      <CeibaBoton
        compacto
        variante="fantasma"
        :aria-label="`Renombrar la colección ${coleccion.name}`"
        @click="emitir('renombrar')"
      >
        Renombrar
      </CeibaBoton>
      <CeibaBoton
        compacto
        variante="peligro"
        :aria-label="`Borrar la colección ${coleccion.name}`"
        @click="emitir('borrar')"
      >
        Borrar
      </CeibaBoton>
    </div>
  </li>
</template>

<style scoped>
.fila {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ceiba-space-4);
  padding: var(--ceiba-space-3) var(--ceiba-space-4);
  list-style: none;
  border-bottom: 1px solid var(--ceiba-border);
}

.fila:last-child {
  border-bottom: 0;
}

.fila:hover {
  background: var(--ceiba-surface-overlay);
}

.fila__datos {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
  min-width: 0;
}

.fila__titulo {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--ceiba-space-2);
}

.fila__nombre {
  font-size: var(--ceiba-text-md);
}

.fila__slug {
  color: var(--ceiba-text-faint);
  font-size: var(--ceiba-text-xs);
}

.fila__descripcion {
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
  overflow-wrap: anywhere;
}

.fila__acciones {
  display: flex;
  gap: var(--ceiba-space-2);
  flex: none;
}

@media (max-width: 720px) {
  .fila {
    flex-direction: column;
    align-items: stretch;
  }

  .fila__acciones {
    justify-content: flex-end;
  }
}
</style>
