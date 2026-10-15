<script setup lang="ts">
/**
 * Estado vacío. Usa la marca estática (`CeibaMark`), no el giro: no hay nada
 * cargando, así que un logo girando aquí mentiría sobre el estado.
 */
import { CeibaMark } from '@ceiba/brand';

withDefaults(defineProps<{ titulo: string; detalle?: string }>(), { detalle: '' });
</script>

<template>
  <div class="vacio">
    <CeibaMark :size="48" class="vacio__marca" />
    <h3 class="vacio__titulo">{{ titulo }}</h3>
    <p v-if="detalle" class="vacio__detalle">{{ detalle }}</p>
    <div class="vacio__acciones"><slot /></div>
  </div>
</template>

<style scoped>
.vacio {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ceiba-space-3);
  padding: var(--ceiba-space-7) var(--ceiba-space-5);
  text-align: center;
  color: var(--ceiba-text-muted);
}

.vacio__marca {
  color: var(--ceiba-text-faint);
  opacity: 0.7;
}

.vacio__titulo {
  color: var(--ceiba-text);
}

.vacio__detalle {
  max-width: 44ch;
  font-size: var(--ceiba-text-sm);
}

.vacio__acciones {
  display: flex;
  gap: var(--ceiba-space-2);
  margin-top: var(--ceiba-space-2);
}
</style>
