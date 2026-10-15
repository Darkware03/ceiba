<script setup lang="ts">
/**
 * Campo de formulario con etiqueta, ayuda y error, correctamente enlazados.
 *
 * El enlace no es cosmético: `aria-describedby` y `aria-invalid` son lo que
 * hace que un lector de pantalla anuncie el error del campo. Hacerlo aquí una
 * vez evita que cada formulario lo olvide a su manera.
 */
import { computed, useId } from 'vue';

const props = withDefaults(
  defineProps<{
    etiqueta: string;
    tipo?: string;
    modelValue: string;
    ayuda?: string;
    error?: string | null;
    marcadorDePosicion?: string;
    autocompletado?: string;
    requerido?: boolean;
    deshabilitado?: boolean;
    monoespaciada?: boolean;
    multilinea?: boolean;
    filas?: number;
  }>(),
  {
    tipo: 'text',
    ayuda: '',
    error: null,
    marcadorDePosicion: '',
    autocompletado: 'off',
    requerido: false,
    deshabilitado: false,
    monoespaciada: false,
    multilinea: false,
    filas: 3,
  },
);

const emitir = defineEmits<{ 'update:modelValue': [valor: string] }>();

const idBase = useId();
const idCampo = computed(() => `campo-${idBase}`);
const idAyuda = computed(() => `ayuda-${idBase}`);
const idError = computed(() => `error-${idBase}`);

const descritoPor = computed(() => {
  const partes: string[] = [];
  if (props.ayuda.length > 0) partes.push(idAyuda.value);
  if (props.error !== null && props.error.length > 0) partes.push(idError.value);
  return partes.length > 0 ? partes.join(' ') : undefined;
});

function alEscribir(evento: Event): void {
  const destino = evento.target as HTMLInputElement | HTMLTextAreaElement;
  emitir('update:modelValue', destino.value);
}
</script>

<template>
  <div class="campo" :class="{ 'campo--error': error }">
    <label class="campo__etiqueta" :for="idCampo">
      {{ etiqueta }}
      <span v-if="requerido" class="campo__requerido" aria-hidden="true">*</span>
    </label>

    <textarea
      v-if="multilinea"
      :id="idCampo"
      class="campo__control campo__control--area"
      :class="{ 'campo__control--mono': monoespaciada }"
      :value="modelValue"
      :rows="filas"
      :placeholder="marcadorDePosicion || undefined"
      :required="requerido"
      :disabled="deshabilitado"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="descritoPor"
      @input="alEscribir"
    />
    <input
      v-else
      :id="idCampo"
      class="campo__control"
      :class="{ 'campo__control--mono': monoespaciada }"
      :type="tipo"
      :value="modelValue"
      :placeholder="marcadorDePosicion || undefined"
      :autocomplete="autocompletado"
      :required="requerido"
      :disabled="deshabilitado"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="descritoPor"
      @input="alEscribir"
    />

    <p v-if="ayuda" :id="idAyuda" class="campo__ayuda">{{ ayuda }}</p>
    <p v-if="error" :id="idError" class="campo__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.campo {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
}

.campo__etiqueta {
  font-size: var(--ceiba-text-sm);
  font-weight: 500;
  color: var(--ceiba-text-muted);
}

.campo__requerido {
  color: var(--ceiba-accent);
}

.campo__control {
  width: 100%;
  padding: var(--ceiba-space-2) var(--ceiba-space-3);
  min-height: 34px;
  background: var(--ceiba-bg-sunken);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-md);
  color: var(--ceiba-text);
  font-family: inherit;
  font-size: var(--ceiba-text-md);
}

.campo__control--mono {
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-sm);
}

.campo__control--area {
  resize: vertical;
  line-height: 1.5;
}

.campo__control::placeholder {
  color: var(--ceiba-text-faint);
}

.campo__control:hover:not(:disabled) {
  border-color: var(--ceiba-border-strong);
}

.campo__control:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.campo--error .campo__control {
  border-color: var(--ceiba-danger);
}

.campo__ayuda {
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

.campo__error {
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-danger);
}
</style>
