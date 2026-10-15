<script setup lang="ts">
/**
 * Selector del método HTTP.
 *
 * Son exactamente los siete de `ALLOWED_METHODS` del contrato del motor:
 * `CONNECT` y `TRACE` están fuera a propósito (túnel y reflejo), así que
 * tampoco se ofrecen aquí. Si la interfaz dejara elegir uno, el motor lo
 * rechazaría con `INVALID_REQUEST` y el usuario no entendería por qué.
 *
 * Es un `<select>` nativo y no un menú propio: teclado, lectores de pantalla y
 * móvil ya funcionan sin escribir una línea.
 */
import { computed } from 'vue';
import { METODOS_PERMITIDOS } from '@/api/ejecucion';
import type { MetodoDeSolicitud } from '@/api/ejecucion';

const props = withDefaults(
  defineProps<{ modelValue: MetodoDeSolicitud; deshabilitado?: boolean }>(),
  { deshabilitado: false },
);

const emitir = defineEmits<{ 'update:modelValue': [valor: MetodoDeSolicitud] }>();

/** El color por método sale de `base.css`; aquí no se define ninguno. */
const clase = computed(() => `ceiba-metodo--${props.modelValue.toLowerCase()}`);

function alCambiar(evento: Event): void {
  const destino = evento.target as HTMLSelectElement;
  emitir('update:modelValue', destino.value as MetodoDeSolicitud);
}
</script>

<template>
  <select
    class="metodo ceiba-metodo"
    :class="clase"
    :value="modelValue"
    :disabled="deshabilitado"
    aria-label="Método HTTP"
    @change="alCambiar"
  >
    <option v-for="opcion in METODOS_PERMITIDOS" :key="opcion" :value="opcion">
      {{ opcion }}
    </option>
  </select>
</template>

<style scoped>
.metodo {
  min-height: 34px;
  padding: 0 var(--ceiba-space-2);
  background: var(--ceiba-surface-raised);
  border: 1px solid var(--ceiba-border-strong);
  border-radius: var(--ceiba-radius-md);
  font-size: var(--ceiba-text-sm);
  cursor: pointer;
}

.metodo:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.metodo:focus-visible {
  outline: none;
  box-shadow: var(--ceiba-focus-ring);
}
</style>
