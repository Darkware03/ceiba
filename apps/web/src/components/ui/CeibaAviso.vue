<script setup lang="ts">
/**
 * Mensaje de estado: error, aviso o información.
 *
 * Los errores llevan `role="alert"` para que un lector de pantalla los anuncie
 * sin que el usuario tenga que ir a buscarlos; el resto, `role="status"`.
 */
withDefaults(
  defineProps<{
    tono?: 'error' | 'aviso' | 'info' | 'exito';
    titulo?: string;
  }>(),
  { tono: 'error', titulo: '' },
);
</script>

<template>
  <div
    class="aviso"
    :class="`aviso--${tono}`"
    :role="tono === 'error' ? 'alert' : 'status'"
    aria-live="polite"
  >
    <p v-if="titulo" class="aviso__titulo">{{ titulo }}</p>
    <div class="aviso__cuerpo"><slot /></div>
  </div>
</template>

<style scoped>
.aviso {
  padding: var(--ceiba-space-3) var(--ceiba-space-4);
  border: 1px solid var(--ceiba-border);
  border-left-width: 3px;
  border-radius: var(--ceiba-radius-md);
  background: var(--ceiba-surface);
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text);
}

.aviso__titulo {
  font-weight: 600;
  margin-bottom: var(--ceiba-space-1);
}

.aviso__cuerpo {
  color: var(--ceiba-text-muted);
}

.aviso--error {
  border-left-color: var(--ceiba-danger);
}
.aviso--aviso {
  border-left-color: var(--ceiba-warning);
}
.aviso--info {
  border-left-color: var(--ceiba-info);
}
.aviso--exito {
  border-left-color: var(--ceiba-success);
}
</style>
