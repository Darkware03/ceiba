<script setup lang="ts">
/**
 * Marca CEIBA. El árbol hereda `currentColor`; la semilla usa el verde salvia
 * salvo que se pida la variante monocroma.
 */
import { CEIBA_SEED_PATH, CEIBA_TREE_PATH, CEIBA_VIEWBOX } from './mark-path';

withDefaults(
  defineProps<{
    /** Tamaño en px (se aplica a ancho y alto). */
    size?: number | string;
    /** Semilla del mismo color que el árbol. */
    mono?: boolean;
    /** Texto accesible. Si se omite, la marca es decorativa. */
    title?: string;
  }>(),
  { size: 32, mono: false, title: '' },
);
</script>

<template>
  <svg
    class="ceiba-mark"
    :class="{ 'ceiba-mark--mono': mono }"
    :viewBox="CEIBA_VIEWBOX"
    :width="size"
    :height="size"
    :role="title ? 'img' : undefined"
    :aria-label="title || undefined"
    :aria-hidden="title ? undefined : 'true'"
    focusable="false"
  >
    <path class="ceiba-mark__tree" fill-rule="evenodd" :d="CEIBA_TREE_PATH" />
    <path class="ceiba-mark__seed" :d="CEIBA_SEED_PATH" />
  </svg>
</template>

<style scoped>
.ceiba-mark {
  display: block;
  color: inherit;
}

.ceiba-mark__tree {
  fill: currentColor;
}

.ceiba-mark__seed {
  fill: var(--ceiba-accent, #9dbe8c);
}

.ceiba-mark--mono .ceiba-mark__seed {
  fill: currentColor;
}
</style>
