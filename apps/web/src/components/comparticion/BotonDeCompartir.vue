<script setup lang="ts">
/**
 * El icono de compartir (P7).
 *
 * El cliente pidió «un icono» en cada pantalla, no un botón de texto más en
 * una fila que ya tiene dos. Así que es un icono — pero **con nombre
 * accesible obligatorio**: `aria-label` con el nombre del recurso.
 *
 * Por qué no se reutiliza `CeibaBoton`, que es la regla de la casa (§2.2.5 del
 * BRIEF-FASE4): `CeibaBoton` tiene `min-height: 34px` y `padding` horizontal
 * de `--ceiba-space-4`; es un botón de texto. Un cuadrado de 28×28 con sólo un
 * glifo dentro no es el mismo componente y forzarlo deformaría el pie de la
 * tarjeta. Se mantienen, eso sí, su borde, su radio, sus transiciones y sus
 * tokens, para que no parezca de otra aplicación.
 *
 * El glifo es un SVG `currentColor` y no un emoji: un emoji cambia de forma en
 * cada sistema operativo y los lectores de pantalla lo leen en voz alta.
 */
withDefaults(
  defineProps<{
    /** Nombre del recurso; entra en el nombre accesible del control. */
    nombre: string;
    compacto?: boolean;
  }>(),
  { compacto: false },
);

defineEmits<{ click: [] }>();
</script>

<template>
  <button
    type="button"
    class="compartir"
    :class="{ 'compartir--compacto': compacto }"
    :aria-label="`Compartir ${nombre}`"
    :title="`Compartir ${nombre}`"
    @click="$emit('click')"
  >
    <svg
      class="compartir__glifo"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.6" y1="10.5" x2="15.4" y2="6.5" />
      <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
    </svg>
  </button>
</template>

<style scoped>
.compartir {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  padding: 0;
  border: 1px solid var(--ceiba-border-strong);
  border-radius: var(--ceiba-radius-md);
  background: var(--ceiba-surface-raised);
  color: var(--ceiba-text-muted);
  cursor: pointer;
  transition:
    background var(--ceiba-duration-fast) var(--ceiba-ease),
    border-color var(--ceiba-duration-fast) var(--ceiba-ease),
    color var(--ceiba-duration-fast) var(--ceiba-ease);
}

.compartir:hover {
  background: var(--ceiba-surface-overlay);
  border-color: var(--ceiba-accent-dim);
  color: var(--ceiba-text);
}

.compartir:focus-visible {
  outline: 2px solid var(--ceiba-focus-ring);
  outline-offset: 2px;
}

.compartir--compacto {
  width: 28px;
  height: 28px;
}

.compartir__glifo {
  display: block;
}
</style>
