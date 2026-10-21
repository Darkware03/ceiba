<script setup lang="ts">
/**
 * Diálogo de alta y de renombrado de una petición.
 *
 * Es uno solo para los dos casos, igual que `DialogoDeCreacion` sirve a
 * workspaces y colecciones: el formulario es idéntico y escribirlo dos veces
 * sería garantizar que un día divergen. El modo lo decide `peticionInicial`:
 * si viene, se edita; si no, se crea.
 *
 * NO HAY `slug` AQUÍ, Y NO ES UN OLVIDO. `api_requests` no tiene columna de
 * slug: su identificador estable es `id`, «independiente del nombre», y el
 * `external_ref` es para reimportar, no para que lo teclee un humano. Ofrecer
 * un campo que no existe sería un control que miente.
 *
 * `methodCustom` sólo aparece con el método `CUSTOM`, porque la base lo exige
 * exactamente así: `ck_request_custom_verb` comprueba
 * `(method = 'CUSTOM') = (method_custom IS NOT NULL)`. Validarlo aquí evita un
 * 400 del servidor por algo que se puede decir antes y en español.
 */
import { computed, ref, watch } from 'vue';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import CeibaCampo from '@/components/ui/CeibaCampo.vue';
import CeibaDialogo from '@/components/ui/CeibaDialogo.vue';
import {
  ETIQUETA_DE_MODO,
  LONGITUD_MAXIMA_DESCRIPCION_PETICION,
  METODOS_DE_PETICION,
  MODOS_DE_CUERPO_GUARDADO,
  errorDeNombreDePeticion,
  errorDeUrlDePeticion,
  errorDeVerboPropio,
} from '@/api/peticiones';
import type { MetodoDePeticion, Peticion } from '@/api/peticiones';

export interface DatosDePeticion {
  name: string;
  method: MetodoDePeticion;
  methodCustom: string | null;
  url: string;
  description: string | null;
  bodyType: string;
}

const props = withDefaults(
  defineProps<{
    abierto: boolean;
    titulo: string;
    descripcion?: string;
    etiquetaAccion?: string;
    /** Si viene, el diálogo edita esa petición; si no, crea una nueva. */
    peticionInicial?: Peticion | null;
    notaDeRol?: string;
    guardando?: boolean;
    errorDeEnvio?: string | null;
  }>(),
  {
    descripcion: '',
    etiquetaAccion: 'Guardar',
    peticionInicial: null,
    notaDeRol: '',
    guardando: false,
    errorDeEnvio: null,
  },
);

const emitir = defineEmits<{ cerrar: []; guardar: [datos: DatosDePeticion] }>();

const nombre = ref('');
const metodo = ref<MetodoDePeticion>('GET');
const verboPropio = ref('');
const url = ref('');
const descripcionTexto = ref('');
const modoDeCuerpo = ref<string>('none');
/** Sólo se enseñan errores después del primer intento de envío. */
const intentado = ref(false);

watch(
  () => props.abierto,
  (abierto) => {
    if (!abierto) return;
    const inicial = props.peticionInicial;
    nombre.value = inicial?.name ?? '';
    metodo.value = inicial?.method ?? 'GET';
    verboPropio.value = inicial?.methodCustom ?? '';
    url.value = inicial?.url ?? '';
    descripcionTexto.value = inicial?.description ?? '';
    modoDeCuerpo.value = inicial?.bodyType ?? 'none';
    intentado.value = false;
  },
  { immediate: true },
);

const errorNombre = computed(() => errorDeNombreDePeticion(nombre.value));
const errorUrl = computed(() => errorDeUrlDePeticion(url.value));
const errorVerbo = computed(() => errorDeVerboPropio(metodo.value, verboPropio.value));
const errorDescripcion = computed<string | null>(() =>
  descripcionTexto.value.trim().length > LONGITUD_MAXIMA_DESCRIPCION_PETICION
    ? `La descripción no puede superar ${LONGITUD_MAXIMA_DESCRIPCION_PETICION} caracteres.`
    : null,
);

const valido = computed(
  () =>
    errorNombre.value === null &&
    errorUrl.value === null &&
    errorVerbo.value === null &&
    errorDescripcion.value === null,
);

/**
 * El modo de cuerpo no se ofrece si el método no lleva cuerpo. `GET` y `HEAD`
 * con `--data-raw` es exactamente el tipo de cURL que el §2.3 llama «un cURL
 * que se rompe al pegarlo»: mejor no permitir construirlo.
 */
const admiteCuerpo = computed(() => !['GET', 'HEAD'].includes(metodo.value));

watch(admiteCuerpo, (puede) => {
  if (!puede) modoDeCuerpo.value = 'none';
});

function enviar(): void {
  intentado.value = true;
  if (!valido.value) return;
  emitir('guardar', {
    name: nombre.value.trim(),
    method: metodo.value,
    methodCustom: metodo.value === 'CUSTOM' ? verboPropio.value.trim().toUpperCase() : null,
    url: url.value.trim(),
    description: descripcionTexto.value.trim().length > 0 ? descripcionTexto.value.trim() : null,
    bodyType: modoDeCuerpo.value,
  });
}
</script>

<template>
  <CeibaDialogo
    :abierto="abierto"
    :titulo="titulo"
    :descripcion="descripcion"
    @cerrar="emitir('cerrar')"
  >
    <CeibaAviso v-if="errorDeEnvio" tono="error" titulo="No se pudo guardar">
      {{ errorDeEnvio }}
    </CeibaAviso>

    <CeibaCampo
      v-model="nombre"
      etiqueta="Nombre de la petición"
      requerido
      marcador-de-posicion="Listar clientes"
      ayuda="Lo que verás en la lista de la colección."
      :error="intentado ? errorNombre : null"
    />

    <div class="peticion__metodo">
      <label class="peticion__etiqueta" for="peticion-metodo">Método</label>
      <select id="peticion-metodo" v-model="metodo" class="peticion__selector">
        <option v-for="opcion in METODOS_DE_PETICION" :key="opcion" :value="opcion">
          {{ opcion }}
        </option>
      </select>
    </div>

    <CeibaCampo
      v-if="metodo === 'CUSTOM'"
      v-model="verboPropio"
      etiqueta="Verbo propio"
      requerido
      monoespaciada
      marcador-de-posicion="PURGE"
      ayuda="La base lo exige con el método CUSTOM, y sólo con ése."
      :error="intentado ? errorVerbo : null"
    />

    <CeibaCampo
      v-model="url"
      etiqueta="URL"
      requerido
      monoespaciada
      marcador-de-posicion="{{ base_url }}/v1/clientes"
      ayuda="Se guarda sin resolver: las variables {{ … }} se conservan tal cual."
      :error="intentado ? errorUrl : null"
    />

    <div v-if="admiteCuerpo" class="peticion__metodo">
      <label class="peticion__etiqueta" for="peticion-cuerpo">Tipo de cuerpo</label>
      <select id="peticion-cuerpo" v-model="modoDeCuerpo" class="peticion__selector">
        <option v-for="opcion in MODOS_DE_CUERPO_GUARDADO" :key="opcion" :value="opcion">
          {{ ETIQUETA_DE_MODO[opcion] }}
        </option>
      </select>
    </div>

    <CeibaCampo
      v-model="descripcionTexto"
      etiqueta="Descripción (opcional)"
      multilinea
      :filas="2"
      :error="intentado ? errorDescripcion : null"
    />

    <p v-if="notaDeRol" class="peticion__rol">{{ notaDeRol }}</p>

    <template #acciones>
      <CeibaBoton variante="fantasma" :deshabilitado="guardando" @click="emitir('cerrar')">
        Cancelar
      </CeibaBoton>
      <CeibaBoton
        variante="primario"
        tipo="submit"
        :cargando="guardando"
        :deshabilitado="intentado && !valido"
        @click="enviar"
      >
        {{ etiquetaAccion }}
      </CeibaBoton>
    </template>
  </CeibaDialogo>
</template>

<style scoped>
.peticion__metodo {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
}

.peticion__etiqueta {
  font-size: var(--ceiba-text-sm);
  font-weight: 500;
  color: var(--ceiba-text-muted);
}

.peticion__selector {
  min-height: 34px;
  padding: 0 var(--ceiba-space-2);
  background: var(--ceiba-bg-sunken);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-md);
  color: var(--ceiba-text);
  font-family: inherit;
  font-size: var(--ceiba-text-md);
}

.peticion__selector:focus-visible {
  outline: none;
  box-shadow: var(--ceiba-focus-ring);
}

.peticion__rol {
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}
</style>
