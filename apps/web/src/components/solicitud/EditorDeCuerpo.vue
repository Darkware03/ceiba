<script setup lang="ts">
/**
 * Cuerpo de la solicitud: `none`, `raw`, `json`, `form_urlencoded`,
 * `multipart_form_data` y `binary_file`.
 *
 * FASE 7, P5. Hasta aquí este componente ofrecía tres modos y el comentario
 * de este mismo sitio decía que los demás no se ofrecían «porque esta
 * interfaz todavía no sabe serializarlos». El cliente pidió exactamente los
 * que faltaban: «en el cuerpo de la petición me debe permitir agregar
 * formdata, binario». Ya se saben componer, así que ya se ofrecen.
 *
 * `custom` sigue sin ofrecerse: el esquema no define su forma, y un modo sin
 * forma no se puede serializar. Al **leer** se toleran los diez valores del
 * enum (lo resuelve `stores/constructor.ts`), que es la decisión de la fase 6
 * que el §3.C.3 del `BRIEF-FASE7` manda mantener.
 *
 * `json` no valida al escribir con un cartel rojo en cada tecla: avisa sólo
 * cuando el texto no es JSON válido y deja enviar igualmente — hay APIs que se
 * prueban a propósito con cuerpos malformados.
 */
import { computed, ref, useId, watch } from 'vue';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import EditorDeCamposDeCuerpo from './EditorDeCamposDeCuerpo.vue';
import SelectorDeFichero from './SelectorDeFichero.vue';
import {
  MODOS_DE_CUERPO,
  esModoCrudo,
  esModoDeFormulario,
  metodoAdmiteCuerpo,
} from '@/api/ejecucion';
import type {
  CampoDeCuerpo,
  FicheroDeCuerpo,
  MetodoDeSolicitud,
  ModoDeCuerpo,
} from '@/api/ejecucion';
import CampoConVariables from '@/components/variables/CampoConVariables.vue';
import ListaDeSugerencias from '@/components/variables/ListaDeSugerencias.vue';
import { usarVariablesDeColeccion } from '@/composables/usarVariablesDeColeccion';
import { usarSugerenciasEnEditor } from '@/composables/usarSugerenciasEnEditor';
import { formatearJson, usarEditorDeCodigo } from '@/composables/useEditorDeCodigo';
import type { LenguajeDeEditor } from '@/composables/useEditorDeCodigo';

const props = withDefaults(
  defineProps<{
    modo: ModoDeCuerpo;
    contenido: string;
    tipoContenido: string | null;
    metodo: MetodoDeSolicitud;
    campos?: readonly CampoDeCuerpo[];
    ficheroBinario?: FicheroDeCuerpo | null;
    workspaceId?: string | null;
    /** Lo que este cuerpo no podrá enviarse tal cual. Se pinta, no se calla. */
    limitaciones?: readonly string[];
    /** Colección de la que salen las variables para sugerir (P6). */
    coleccionId?: string | null;
  }>(),
  {
    campos: () => [],
    ficheroBinario: null,
    workspaceId: null,
    limitaciones: () => [],
    coleccionId: null,
  },
);

const emitir = defineEmits<{
  'update:modo': [valor: ModoDeCuerpo];
  'update:contenido': [valor: string];
  'actualizar-campo': [
    id: string,
    cambio: Partial<Pick<CampoDeCuerpo, 'nombre' | 'valor' | 'tipo' | 'activo'>>,
  ];
  'fichero-de-campo': [id: string, fichero: FicheroDeCuerpo | null];
  'quitar-campo': [id: string];
  'anadir-campo': [];
  'update:ficheroBinario': [fichero: FicheroDeCuerpo | null];
}>();

const ETIQUETAS: Readonly<Record<ModoDeCuerpo, string>> = {
  none: 'Sin cuerpo',
  raw: 'Texto',
  json: 'JSON',
  form_urlencoded: 'Formulario',
  multipart_form_data: 'Multiparte',
  binary_file: 'Binario',
};

/** Título largo de cada modo: la pastilla es corta por fuerza. */
const DESCRIPCIONES: Readonly<Record<ModoDeCuerpo, string>> = {
  none: 'La solicitud se envía sin cuerpo.',
  raw: 'Texto crudo con el tipo de contenido que elijas.',
  json: 'Cuerpo JSON (application/json).',
  form_urlencoded: 'Formulario application/x-www-form-urlencoded. Sólo campos de texto.',
  multipart_form_data: 'Formulario multipart/form-data. Admite campos de texto y ficheros.',
  binary_file: 'Un único fichero como cuerpo de la petición.',
};

const contenedor = ref<HTMLElement | null>(null);
const admiteCuerpo = computed(() => metodoAdmiteCuerpo(props.metodo));
const lenguaje = computed<LenguajeDeEditor>(() => (props.modo === 'json' ? 'json' : 'texto'));
const esCrudo = computed(() => esModoCrudo(props.modo));
const esFormulario = computed(() => esModoDeFormulario(props.modo));

const { variables, cargando: cargandoVariables } = usarVariablesDeColeccion(
  () => props.coleccionId ?? undefined,
);

const jsonInvalido = computed(() => {
  if (props.modo !== 'json') return false;
  if (props.contenido.trim().length === 0) return false;
  return !formatearJson(props.contenido).formateado;
});

const { fallo, vista } = usarEditorDeCodigo({
  contenedor,
  contenido: () => props.contenido,
  lenguaje: () => lenguaje.value,
  alCambiar: (texto) => emitir('update:contenido', texto),
});

/**
 * P6 dentro del editor de código. Misma lista accesible que en la URL y en
 * las cabeceras: el autocompletado se comporta igual en los cuatro sitios que
 * pide el §3.C.4, aunque el control de debajo sea distinto en uno de ellos.
 */
const idBase = useId();
const idLista = computed(() => `sugerencias-cuerpo-${idBase}`);
const prefijoDeOpcion = computed(() => `sugerencia-cuerpo-${idBase}`);

const sugerenciasDelEditor = usarSugerenciasEnEditor({
  vista,
  variables: () => variables.value,
  activo: () => esCrudo.value && !fallo.value,
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
          :title="DESCRIPCIONES[opcion]"
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

    <!--
      §2.4 del BRIEF-FASE6: lo que no se puede representar se declara, no se
      disfraza. Aquí es literal —un fichero que vive en el servidor no puede
      salir de la pestaña del usuario— y callarlo produciría un envío
      silenciosamente incompleto.
    -->
    <CeibaAviso
      v-if="limitaciones.length > 0"
      tono="aviso"
      titulo="Este cuerpo no se enviará entero"
    >
      <ul class="cuerpo__limitaciones">
        <li v-for="(nota, indice) in limitaciones" :key="indice">{{ nota }}</li>
      </ul>
    </CeibaAviso>

    <p v-if="modo === 'none'" class="cuerpo__vacio">Esta solicitud se envía sin cuerpo.</p>

    <template v-else-if="esFormulario">
      <p class="cuerpo__ayuda">{{ DESCRIPCIONES[modo] }}</p>
      <EditorDeCamposDeCuerpo
        :campos="campos"
        :admite-ficheros="modo === 'multipart_form_data'"
        :workspace-id="workspaceId"
        @actualizar="(id, cambio) => emitir('actualizar-campo', id, cambio)"
        @fichero="(id, fichero) => emitir('fichero-de-campo', id, fichero)"
        @quitar="emitir('quitar-campo', $event)"
        @anadir="emitir('anadir-campo')"
      />
    </template>

    <template v-else-if="modo === 'binary_file'">
      <p class="cuerpo__ayuda">{{ DESCRIPCIONES[modo] }}</p>
      <SelectorDeFichero
        :fichero="ficheroBinario"
        :workspace-id="workspaceId"
        proposito="request_body_binary"
        etiqueta="cuerpo binario"
        @update:fichero="emitir('update:ficheroBinario', $event)"
      />
    </template>

    <template v-else-if="esCrudo">
      <CeibaAviso v-if="fallo" tono="error">{{ fallo }}</CeibaAviso>
      <!--
        P6 en el cuerpo crudo. El respaldo (cuando CodeMirror no arranca) usa
        el campo con sugerencias completo. El editor de código todavía NO las
        tiene: hace falta una extensión de CodeMirror y el paquete
        `@codemirror/autocomplete` no está instalado. Está declarado como
        hueco en el informe en vez de fingir que funciona en los dos sitios.
      -->
      <div v-if="fallo" class="cuerpo__respaldo">
        <CampoConVariables
          multilinea
          :filas="10"
          clase-del-control="cuerpo__area"
          :model-value="contenido"
          :variables="variables"
          :cargando-variables="cargandoVariables"
          etiqueta="Cuerpo de la solicitud"
          @update:model-value="emitir('update:contenido', $event)"
        />
      </div>
      <div v-else class="cuerpo__envoltorio">
        <div ref="contenedor" class="cuerpo__editor" data-prueba="editor-de-cuerpo" />
        <div
          v-if="sugerenciasDelEditor.abierta.value"
          class="cuerpo__sugerencias"
          :style="{
            top: `${sugerenciasDelEditor.posicion.value.arriba}px`,
            left: `${sugerenciasDelEditor.posicion.value.izquierda}px`,
          }"
        >
          <ListaDeSugerencias
            :sugerencias="sugerenciasDelEditor.sugerencias.value"
            :indice-activo="sugerenciasDelEditor.indiceActivo.value"
            :id-lista="idLista"
            :prefijo-de-opcion="prefijoDeOpcion"
            :cargando-variables="cargandoVariables"
            :consulta="sugerenciasDelEditor.consulta.value"
            etiqueta="Variables disponibles para el cuerpo"
            @elegir="sugerenciasDelEditor.elegir"
            @resaltar="sugerenciasDelEditor.resaltar"
          />
        </div>
      </div>
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
  flex-wrap: wrap;
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

.cuerpo__ayuda {
  margin: 0;
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

.cuerpo__limitaciones {
  margin: 0;
  padding-left: var(--ceiba-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
}

.cuerpo__envoltorio {
  position: relative;
  min-width: 0;
}

.cuerpo__editor {
  min-height: 180px;
  max-height: 40vh;
  overflow: auto;
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-md);
}

/* La lista flota sobre el editor, anclada al cursor. `--ceiba-z-overlay` es
 * el token que ya usan los diálogos: sin él la lista quedaría por debajo del
 * propio editor en cuanto este tenga `overflow: auto`. */
.cuerpo__sugerencias {
  position: absolute;
  z-index: var(--ceiba-z-overlay);
  min-width: 16rem;
  max-width: 100%;
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
