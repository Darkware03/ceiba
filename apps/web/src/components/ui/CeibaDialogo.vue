<script setup lang="ts">
/**
 * Diálogo modal sobre `<dialog>` nativo.
 *
 * Se usa el elemento nativo y no un `div` con `position: fixed` porque trae
 * gratis lo que siempre se implementa mal a mano: captura del foco, cierre con
 * `Escape`, capa superior y semántica de modal para lectores de pantalla.
 * §18 pide «confirmaciones para operaciones destructivas», y una confirmación
 * de la que no se puede salir con el teclado no vale.
 */
import { nextTick, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{ abierto: boolean; titulo: string; descripcion?: string }>(),
  { descripcion: '' },
);

const emitir = defineEmits<{ cerrar: [] }>();

const dialogo = ref<HTMLDialogElement | null>(null);

watch(
  () => props.abierto,
  async (abierto) => {
    await nextTick();
    const nodo = dialogo.value;
    if (nodo === null) return;
    if (abierto && !nodo.open) {
      // `showModal` puede no existir en jsdom: la interfaz no debe romperse
      // por eso en pruebas.
      if (typeof nodo.showModal === 'function') nodo.showModal();
      else nodo.setAttribute('open', '');
    } else if (!abierto && nodo.open) {
      if (typeof nodo.close === 'function') nodo.close();
      else nodo.removeAttribute('open');
    }
  },
  { immediate: true },
);
</script>

<template>
  <dialog ref="dialogo" class="dialogo" @cancel.prevent="emitir('cerrar')" @close="emitir('cerrar')">
    <form method="dialog" class="dialogo__marco" @submit.prevent>
      <header class="dialogo__cabecera">
        <h2 class="dialogo__titulo">{{ titulo }}</h2>
        <p v-if="descripcion" class="dialogo__descripcion">{{ descripcion }}</p>
      </header>

      <div class="dialogo__cuerpo"><slot /></div>

      <footer class="dialogo__pie">
        <slot name="acciones" />
      </footer>
    </form>
  </dialog>
</template>

<style scoped>
.dialogo {
  padding: 0;
  border: 1px solid var(--ceiba-border-strong);
  border-radius: var(--ceiba-radius-lg);
  background: var(--ceiba-surface-raised);
  color: var(--ceiba-text);
  width: min(32rem, calc(100vw - 2rem));
}

.dialogo::backdrop {
  /* El velo del diálogo usa el mismo token que el velo de la pantalla de
   * carga: es el único fondo de superposición que define `@ceiba/brand`, y
   * trae las dos variantes de tema. El `rgb(0 0 0 / 55%)` que había aquí era
   * un negro fijo que en tema claro oscurecía la página entera.
   * PETICIÓN A darkware: un `--ceiba-overlay-backdrop` propio para diálogos
   * distinguiría los dos casos sin reutilizar el de carga. */
  background: var(--ceiba-loading-backdrop);
}

.dialogo__marco {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-4);
  padding: var(--ceiba-space-5);
}

.dialogo__titulo {
  font-size: var(--ceiba-text-lg);
}

.dialogo__descripcion {
  margin-top: var(--ceiba-space-1);
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.dialogo__cuerpo {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-3);
}

.dialogo__pie {
  display: flex;
  justify-content: flex-end;
  gap: var(--ceiba-space-2);
}
</style>
