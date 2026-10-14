<script setup lang="ts">
/**
 * Pantalla de carga de CEIBA: logo girando + mensaje.
 *
 * Úsala para cualquier espera bloqueante (arranque, navegación de ruta,
 * importación de colecciones, ejecución de una colección completa…).
 * Para esperas dentro de un panel, pasa `inline` y coloca el contenedor
 * con `position: relative`.
 */
withDefaults(
  defineProps<{
    /** Mensaje principal. */
    message?: string;
    /** Segunda línea opcional, en monoespaciada (p. ej. el paso actual). */
    detail?: string;
    /** Cubre el contenedor padre en lugar de la ventana completa. */
    inline?: boolean;
    /** Fondo opaco: para la pantalla de arranque de la aplicación. */
    boot?: boolean;
    /** Tamaño del logo giratorio. */
    size?: 'sm' | 'md' | 'lg' | 'xl';
  }>(),
  { message: 'Cargando…', detail: '', inline: false, boot: false, size: 'lg' },
);
</script>

<script lang="ts">
import CeibaSpinner from './CeibaSpinner.vue';
export default { components: { CeibaSpinner } };
</script>

<template>
  <div
    class="ceiba-loading"
    :class="{ 'ceiba-loading--inline': inline, 'ceiba-loading--boot': boot }"
    role="status"
    aria-live="polite"
  >
    <div class="ceiba-loading__body">
      <CeibaSpinner :size="size" />
      <p v-if="message" class="ceiba-loading__label">{{ message }}</p>
      <p v-if="detail" class="ceiba-loading__detail">{{ detail }}</p>
    </div>
  </div>
</template>
