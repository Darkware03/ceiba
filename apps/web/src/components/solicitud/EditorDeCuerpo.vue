<script setup lang="ts">
/**
 * Cuerpo de la solicitud: `none`, `raw` y `json`.
 *
 * El contrato del motor admite además `form`, `urlencoded`, `binary` y
 * `graphql`. Esos modos NO se ofrecen porque esta interfaz todavía no sabe
 * serializarlos; enseñarlos en gris sería prometer algo que no está. Ver el
 * informe de entrega.
 *
 * `json` no valida al escribir con un cartel rojo en cada tecla: avisa sólo
 * cuando el texto no es JSON válido y deja enviar igualmente — hay APIs que se
 * prueban a propósito con cuerpos malformados.
 */
import { computed, ref, watch } from 'vue';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import { MODOS_DE_CUERPO, metodoAdmiteCuerpo } from '@/api/ejecucion';
import type { MetodoDeSolicitud, ModoDeCuerpo } from '@/api/ejecucion';
import { formatearJson, usarEditorDeCodigo } from '@/composables/useEditorDeCodigo';
import type { LenguajeDeEditor } from '@/composables/useEditorDeCodigo';

const props = defineProps<{
  modo: ModoDeCuerpo;
  contenido: string;
  tipoContenido: string | null;
  metodo: MetodoDeSolicitud;
}>();

const emitir = defineEmits<{
  'update:modo': [valor: ModoDeCuerpo];
  'update:contenido': [valor: string];
}>();

const ETIQUETAS: Readonly<Record<ModoDeCuerpo, string>> = {
  none: 'Sin cuerpo',
  raw: 'Texto',
  json: 'JSON',
};

const contenedor = ref<HTMLElement | null>(null);
const admiteCuerpo = computed(() => metodoAdmiteCuerpo(props.metodo));
const lenguaje = computed<LenguajeDeEditor>(() => (props.modo === 'json' ? 'json' : 'texto'));

const jsonInvalido = computed(() => {
  if (props.modo !== 'json') return false;
  if (props.contenido.trim().length === 0) return false;
  return !formatearJson(props.contenido).formateado;
});

const { fallo } = usarEditorDeCodigo({
  contenedor,
  contenido: () => props.contenido,
  lenguaje: () => lenguaje.value,
  alCambiar: (texto) => emitir('update:contenido', texto),
});

/** Al pasar a `json` con el campo vacío se deja un objeto para empezar. */
watch(
  () => props.modo,
  (modo) => {
    if (modo === 'json' && props.contenido.trim().length === 0) {
      emitir('update:contenido', '{\n  \n}');
    }
  },
);

function formatear(): void {
  const resultado = formatearJson(props.contenido);
  if (resultado.formateado) emitir('update:contenido', resultado.texto);
}
</script>

<template>
  <div class="cuerpo">
    <div class="cuerpo__barra">
      <div class="cuerpo__modos" role="group" aria-label="Modo del cuerpo">
        <button
          v-for="opcion in MODOS_DE_CUERPO"
          :key="opcion"
          class="cuerpo__modo"
          :class="{ 'cuerpo__modo--activo': modo === opcion }"
          type="button"
          :aria-pressed="modo === opcion"
          @click="emitir('update:modo', opcion)"
        >
          {{ ETIQUETAS[opcion] }}
        </button>
      </div>

      <div class="cuerpo__acciones">
        <span v-if="tipoContenido" class="cuerpo__tipo">{{ tipoContenido }}</span>
        <CeibaBoton v-if="modo === 'json'" variante="fantasma" compacto @click="formatear">
          Formatear
        </CeibaBoton>
      </div>
    </div>

    <CeibaAviso v-if="modo !== 'none' && !admiteCuerpo" tono="aviso">
      {{ metodo }} no lleva cuerpo: el navegador lo descarta y no se enviará.
    </CeibaAviso>

    <CeibaAviso v-if="jsonInvalido" tono="aviso">
      El texto no es JSON válido. Se enviará tal cual.
    </CeibaAviso>

    <p v-if="modo === 'none'" class="cuerpo__vacio">Esta solicitud se envía sin cuerpo.</p>

    <template v-else>
      <CeibaAviso v-if="fallo" tono="error">{{ fallo }}</CeibaAviso>
      <div v-if="fallo" class="cuerpo__respaldo">
        <textarea
          class="cuerpo__area"
          :value="contenido"
          aria-label="Cuerpo de la solicitud"
          spellcheck="false"
          @input="emitir('update:contenido', ($event.target as HTMLTextAreaElement).value)"
        />
      </div>
      <div v-else ref="contenedor" class="cuerpo__editor" data-prueba="editor-de-cuerpo" />
    </template>
  </div>
</template>

<style scoped>
.cuerpo {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-2);
}

.cuerpo__barra {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--ceiba-space-2);
}

.cuerpo__modos {
  display: inline-flex;
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-md);
  overflow: hidden;
}

.cuerpo__modo {
  padding: var(--ceiba-space-1) var(--ceiba-space-3);
  min-height: 28px;
  border: none;
  background: transparent;
  color: var(--ceiba-text-muted);
  font-family: inherit;
  font-size: var(--ceiba-text-sm);
  cursor: pointer;
}

.cuerpo__modo + .cuerpo__modo {
  border-left: 1px solid var(--ceiba-border);
}

.cuerpo__modo--activo {
  background: var(--ceiba-surface-overlay);
  color: var(--ceiba-text);
  font-weight: 600;
}

.cuerpo__modo:focus-visible {
  outline: none;
  box-shadow: var(--ceiba-focus-ring);
}

.cuerpo__acciones {
  display: inline-flex;
  align-items: center;
  gap: var(--ceiba-space-2);
}

.cuerpo__tipo {
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

.cuerpo__vacio {
  padding: var(--ceiba-space-4);
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-faint);
}

.cuerpo__editor {
  min-height: 180px;
  max-height: 40vh;
  overflow: auto;
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-md);
}

.cuerpo__area {
  width: 100%;
  min-height: 180px;
  padding: var(--ceiba-space-2);
  background: var(--ceiba-bg-sunken);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-md);
  color: var(--ceiba-text);
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-sm);
}
</style>
