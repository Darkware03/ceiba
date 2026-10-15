<script setup lang="ts">
/**
 * Botón de CEIBA.
 *
 * `cargando` deshabilita y muestra el giro de la marca: §18 pide «estados de
 * carga y errores claros», y un botón que sigue pulsable mientras la petición
 * está en vuelo produce dobles envíos.
 */
import { computed } from 'vue';
import { CeibaSpinner } from '@ceiba/brand';

const props = withDefaults(
  defineProps<{
    variante?: 'primario' | 'secundario' | 'fantasma' | 'peligro';
    tipo?: 'button' | 'submit';
    deshabilitado?: boolean;
    cargando?: boolean;
    compacto?: boolean;
    anchoCompleto?: boolean;
  }>(),
  {
    variante: 'secundario',
    tipo: 'button',
    deshabilitado: false,
    cargando: false,
    compacto: false,
    anchoCompleto: false,
  },
);

const inactivo = computed(() => props.deshabilitado || props.cargando);
</script>

<template>
  <button
    class="boton"
    :class="[
      `boton--${variante}`,
      { 'boton--compacto': compacto, 'boton--ancho': anchoCompleto },
    ]"
    :type="tipo"
    :disabled="inactivo"
    :aria-busy="cargando ? 'true' : undefined"
  >
    <CeibaSpinner v-if="cargando" size="xs" class="boton__giro" />
    <slot />
  </button>
</template>

<style scoped>
.boton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--ceiba-space-2);
  padding: var(--ceiba-space-2) var(--ceiba-space-4);
  min-height: 34px;
  border-radius: var(--ceiba-radius-md);
  border: 1px solid var(--ceiba-border-strong);
  background: var(--ceiba-surface-raised);
  color: var(--ceiba-text);
  font-family: inherit;
  font-size: var(--ceiba-text-md);
  font-weight: 500;
  cursor: pointer;
  transition:
    background var(--ceiba-duration-fast) var(--ceiba-ease),
    border-color var(--ceiba-duration-fast) var(--ceiba-ease);
}

.boton:hover:not(:disabled) {
  background: var(--ceiba-surface-overlay);
  border-color: var(--ceiba-accent-dim);
}

.boton:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.boton--compacto {
  min-height: 28px;
  padding: var(--ceiba-space-1) var(--ceiba-space-3);
  font-size: var(--ceiba-text-sm);
}

.boton--ancho {
  width: 100%;
}

.boton--primario {
  background: var(--ceiba-accent);
  border-color: var(--ceiba-accent);
  color: var(--ceiba-on-accent);
  font-weight: 600;
}

.boton--primario:hover:not(:disabled) {
  background: var(--ceiba-accent-strong);
  border-color: var(--ceiba-accent-strong);
}

.boton--fantasma {
  background: transparent;
  border-color: transparent;
  color: var(--ceiba-text-muted);
}

.boton--fantasma:hover:not(:disabled) {
  background: var(--ceiba-surface-overlay);
  color: var(--ceiba-text);
  border-color: transparent;
}

.boton--peligro {
  background: transparent;
  border-color: var(--ceiba-danger);
  color: var(--ceiba-danger);
}

.boton--peligro:hover:not(:disabled) {
  background: color-mix(in srgb, var(--ceiba-danger) 14%, transparent);
}

/* El giro del botón hereda el color del texto del propio botón. */
.boton__giro {
  --ceiba-spinner-size: 14px;
  color: currentColor;
  flex: none;
}
</style>
