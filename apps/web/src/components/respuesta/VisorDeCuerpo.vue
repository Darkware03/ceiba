<script setup lang="ts">
/**
 * Cuerpo de la respuesta, con pestañas Pretty / Raw.
 *
 * Pretty = reindentado y con resaltado y plegado de CodeMirror (sólo JSON se
 * reindenta hoy; ver `embellecer()`). Raw = exactamente los bytes que llegaron,
 * en un `<pre>`, sin editor de por medio: cuando se depura un cuerpo roto,
 * cualquier transformación es sospechosa y hay que poder ver el original.
 *
 * El `<pre>` del modo Raw tiene además una ventaja práctica: el contenido
 * siempre está en el DOM aunque el editor no pueda montarse.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import {
  embellecer,
  lenguajeDesdeContenido,
  lenguajeDesdeTipoDeContenido,
  usarEditorDeCodigo,
} from '@/composables/useEditorDeCodigo';
import type { LenguajeDeEditor } from '@/composables/useEditorDeCodigo';

const props = withDefaults(
  defineProps<{
    cuerpo: string;
    tipoContenido?: string | null;
    truncado?: boolean;
  }>(),
  { tipoContenido: null, truncado: false },
);

type Pestana = 'pretty' | 'raw';

const pestana = ref<Pestana>('pretty');
const contenedor = ref<HTMLElement | null>(null);
const copiado = ref(false);
const falloAlCopiar = ref<string | null>(null);
let temporizador: ReturnType<typeof setTimeout> | null = null;

const lenguaje = computed<LenguajeDeEditor>(() => {
  const porCabecera = lenguajeDesdeTipoDeContenido(props.tipoContenido);
  // Sin `Content-Type` útil (o con `text/plain` sobre un JSON) se mira el
  // propio texto: más vale resaltar bien que obedecer una cabecera perezosa.
  return porCabecera === 'texto' ? lenguajeDesdeContenido(props.cuerpo) : porCabecera;
});

const embellecido = computed(() => embellecer(props.cuerpo, lenguaje.value));

const { fallo } = usarEditorDeCodigo({
  contenedor,
  contenido: () => embellecido.value.texto,
  lenguaje: () => lenguaje.value,
  soloLectura: () => true,
});

watch(
  () => props.cuerpo,
  () => {
    copiado.value = false;
    falloAlCopiar.value = null;
  },
);

onBeforeUnmount(() => {
  if (temporizador !== null) clearTimeout(temporizador);
});

async function copiar(): Promise<void> {
  falloAlCopiar.value = null;
  const portapapeles = globalThis.navigator?.clipboard;
  if (portapapeles === undefined) {
    // Pasa de verdad: sin HTTPS o sin permiso, `navigator.clipboard` no existe.
    falloAlCopiar.value = 'Este navegador no permite copiar al portapapeles desde aquí.';
    return;
  }
  try {
    await portapapeles.writeText(props.cuerpo);
    copiado.value = true;
    if (temporizador !== null) clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      copiado.value = false;
    }, 2000);
  } catch {
    falloAlCopiar.value = 'No se pudo copiar el cuerpo al portapapeles.';
  }
}
</script>

<template>
  <div class="visor" data-prueba="cuerpo-de-respuesta">
    <div class="visor__barra">
      <div class="visor__pestanas" role="tablist" aria-label="Formato del cuerpo">
        <button
          class="visor__pestana"
          :class="{ 'visor__pestana--activa': pestana === 'pretty' }"
          type="button"
          role="tab"
          :aria-selected="pestana === 'pretty'"
          @click="pestana = 'pretty'"
        >
          Pretty
        </button>
        <button
          class="visor__pestana"
          :class="{ 'visor__pestana--activa': pestana === 'raw' }"
          type="button"
          role="tab"
          :aria-selected="pestana === 'raw'"
          @click="pestana = 'raw'"
        >
          Raw
        </button>
      </div>

      <div class="visor__acciones">
        <span class="visor__lenguaje">{{ lenguaje }}</span>
        <CeibaBoton variante="fantasma" compacto @click="copiar">
          {{ copiado ? 'Copiado' : 'Copiar' }}
        </CeibaBoton>
      </div>
    </div>

    <CeibaAviso v-if="truncado" tono="aviso">
      El cuerpo supera el tamaño máximo y se muestra cortado.
    </CeibaAviso>

    <CeibaAviso v-if="falloAlCopiar" tono="aviso">{{ falloAlCopiar }}</CeibaAviso>

    <p v-if="cuerpo.length === 0" class="visor__vacio">La respuesta no tiene cuerpo.</p>

    <template v-else>
      <CeibaAviso v-if="fallo && pestana === 'pretty'" tono="error">{{ fallo }}</CeibaAviso>

      <div
        v-show="pestana === 'pretty' && !fallo"
        ref="contenedor"
        class="visor__editor"
        data-prueba="editor-de-respuesta"
      />

      <pre
        v-show="pestana === 'raw' || fallo"
        class="visor__crudo"
        data-prueba="cuerpo-crudo"
      >{{ cuerpo }}</pre>
    </template>
  </div>
</template>

<style scoped>
.visor {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-2);
  min-height: 0;
}

.visor__barra {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--ceiba-space-2);
}

.visor__pestanas {
  display: inline-flex;
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-md);
  overflow: hidden;
}

.visor__pestana {
  padding: var(--ceiba-space-1) var(--ceiba-space-3);
  min-height: 28px;
  border: none;
  background: transparent;
  color: var(--ceiba-text-muted);
  font-family: inherit;
  font-size: var(--ceiba-text-sm);
  cursor: pointer;
}

.visor__pestana + .visor__pestana {
  border-left: 1px solid var(--ceiba-border);
}

.visor__pestana--activa {
  background: var(--ceiba-surface-overlay);
  color: var(--ceiba-text);
  font-weight: 600;
}

.visor__pestana:focus-visible {
  outline: none;
  box-shadow: var(--ceiba-focus-ring);
}

.visor__acciones {
  display: inline-flex;
  align-items: center;
  gap: var(--ceiba-space-2);
}

.visor__lenguaje {
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
  text-transform: uppercase;
}

.visor__editor,
.visor__crudo {
  min-height: 200px;
  max-height: 46vh;
  overflow: auto;
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-md);
}

.visor__crudo {
  margin: 0;
  padding: var(--ceiba-space-3);
  background: var(--ceiba-bg-sunken);
  color: var(--ceiba-text);
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-sm);
  white-space: pre-wrap;
  word-break: break-word;
}

.visor__vacio {
  padding: var(--ceiba-space-4);
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-faint);
}
</style>
