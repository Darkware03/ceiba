<script setup lang="ts">
/**
 * Conmuta entre el tema oscuro (por defecto) y el claro.
 * El estado real lo lleva `stores/tema.ts`; aquí sólo está el control.
 */
import { computed } from 'vue';
import { usarAlmacenDeTema } from '@/stores/tema';

const tema = usarAlmacenDeTema();
const etiqueta = computed(() =>
  tema.esOscuro ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro',
);
</script>

<template>
  <button
    type="button"
    class="conmutador"
    :title="etiqueta"
    :aria-label="etiqueta"
    :aria-pressed="tema.esOscuro ? 'true' : 'false'"
    @click="tema.alternar()"
  >
    <!-- Iconografía lineal y minimalista (§2): trazo, sin relleno. -->
    <svg
      v-if="tema.esOscuro"
      class="conmutador__icono"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.6v2.3M12 19.1v2.3M2.6 12h2.3M19.1 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
    </svg>
    <svg
      v-else
      class="conmutador__icono"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M20.2 14.4A8.4 8.4 0 1 1 9.6 3.8a6.6 6.6 0 0 0 10.6 10.6Z" />
    </svg>
  </button>
</template>

<style scoped>
.conmutador {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--ceiba-radius-md);
  background: transparent;
  color: var(--ceiba-text-muted);
  cursor: pointer;
}

.conmutador:hover {
  background: var(--ceiba-surface-overlay);
  color: var(--ceiba-text);
}

.conmutador__icono {
  width: 18px;
  height: 18px;
}
</style>
