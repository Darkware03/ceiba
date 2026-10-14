<script setup lang="ts">
/**
 * Indicador de actividad de CEIBA: la marca girando.
 *
 * Los estilos viven en `loader.css` para que el mismo giro pueda reutilizarse
 * en el HTML de arranque, antes de que la aplicación Vue esté montada.
 */
import {
  CEIBA_SEED_PATH,
  CEIBA_SPIN_TRANSFORM,
  CEIBA_TREE_PATH,
  CEIBA_VIEWBOX,
} from './mark-path';

type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

withDefaults(
  defineProps<{
    size?: SpinnerSize;
    /** Detiene la animación (capturas y pruebas visuales deterministas). */
    static?: boolean;
    /** Etiqueta accesible; por defecto el elemento es decorativo. */
    label?: string;
  }>(),
  { size: 'lg', static: false, label: '' },
);
</script>

<template>
  <svg
    class="ceiba-spinner"
    :class="[`ceiba-spinner--${size}`, { 'ceiba-spinner--static': static }]"
    :viewBox="CEIBA_VIEWBOX"
    :role="label ? 'img' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
    focusable="false"
  >
    <!-- El <g> reduce la marca al circulo inscrito en el viewBox: sin el,
         las puntas se recortan al girar (19,8 px a 43 grados).
         Lo valida scripts/check-spin.mjs. -->
    <g :transform="CEIBA_SPIN_TRANSFORM">
      <path class="ceiba-spinner__tree" fill-rule="evenodd" :d="CEIBA_TREE_PATH" />
      <path class="ceiba-spinner__seed" :d="CEIBA_SEED_PATH" />
    </g>
  </svg>
</template>
