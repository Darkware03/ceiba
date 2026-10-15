<script setup lang="ts">
/**
 * Diálogo de creación de un recurso con `slug` + nombre + descripción.
 *
 * Lo usan las dos pantallas (workspaces y colecciones) porque el contrato de
 * creación es literalmente el mismo en la API: `esquemaCrearWorkspace` y
 * `esquemaCrearColeccion` piden los mismos tres campos con las mismas reglas
 * de slug. Escribirlo dos veces sería garantizar que un día divergen.
 *
 * Qué resuelve, más allá de pintar tres campos:
 *
 *  - **El slug se autorrellena** desde el nombre con `slugDesdeNombre()`
 *    mientras el usuario no lo haya tocado. En cuanto lo edita a mano, deja de
 *    sobrescribirse: nada peor que un campo que te borra lo que escribes.
 *  - **Se valida antes de enviar** con `errorDeSlug()`, que es la transcripción
 *    de `esquemaSlug` de la API. No sustituye a la validación del servidor
 *    (esa es la que manda): evita el viaje de ida y vuelta para un fallo obvio.
 */
import { computed, ref, watch } from 'vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import CeibaCampo from '@/components/ui/CeibaCampo.vue';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaDialogo from '@/components/ui/CeibaDialogo.vue';
import { errorDeSlug, slugDesdeNombre } from '@/api/tipos';

const props = withDefaults(
  defineProps<{
    abierto: boolean;
    titulo: string;
    descripcion?: string;
    /** Etiqueta del campo de nombre: «Nombre del workspace», p. ej. */
    etiquetaNombre?: string;
    /** Texto del botón de confirmación. */
    etiquetaAccion?: string;
    /** Ayuda bajo el identificador: dónde se verá ese slug. */
    ayudaSlug?: string;
    /** Máximo de la descripción en el servidor: 2000 (workspace) / 4000 (colección). */
    maximoDescripcion?: number;
    guardando?: boolean;
    /** Error devuelto por la API en el último intento. */
    errorDeEnvio?: string | null;
  }>(),
  {
    descripcion: '',
    etiquetaNombre: 'Nombre',
    etiquetaAccion: 'Crear',
    ayudaSlug: 'Minúsculas, dígitos y guiones. Se usa en URLs y no cambia al renombrar.',
    maximoDescripcion: 2000,
    guardando: false,
    errorDeEnvio: null,
  },
);

const emitir = defineEmits<{
  cerrar: [];
  crear: [datos: { slug: string; name: string; description: string | null }];
}>();

const LONGITUD_MAXIMA_NOMBRE = 160;

const nombre = ref('');
const slug = ref('');
const descripcionTexto = ref('');
/** El usuario ha editado el slug a mano: deja de derivarse del nombre. */
const slugEditado = ref(false);
/** Sólo se enseñan errores después del primer intento de envío. */
const intentado = ref(false);

watch(
  () => props.abierto,
  (abierto) => {
    if (!abierto) return;
    nombre.value = '';
    slug.value = '';
    descripcionTexto.value = '';
    slugEditado.value = false;
    intentado.value = false;
  },
  { immediate: true },
);

watch(nombre, (valor) => {
  if (!slugEditado.value) slug.value = slugDesdeNombre(valor);
});

function alEscribirSlug(valor: string): void {
  slugEditado.value = true;
  slug.value = valor;
}

const errorNombre = computed<string | null>(() => {
  const limpio = nombre.value.trim();
  if (limpio.length === 0) return 'El nombre es obligatorio.';
  if (limpio.length > LONGITUD_MAXIMA_NOMBRE) {
    return `El nombre no puede superar ${LONGITUD_MAXIMA_NOMBRE} caracteres.`;
  }
  return null;
});

const errorIdentificador = computed<string | null>(() => errorDeSlug(slug.value.trim()));

const errorDescripcion = computed<string | null>(() =>
  descripcionTexto.value.trim().length > props.maximoDescripcion
    ? `La descripción no puede superar ${props.maximoDescripcion} caracteres.`
    : null,
);

const hayErrores = computed(
  () =>
    errorNombre.value !== null ||
    errorIdentificador.value !== null ||
    errorDescripcion.value !== null,
);

function enviar(): void {
  intentado.value = true;
  if (hayErrores.value) return;
  const detalle = descripcionTexto.value.trim();
  emitir('crear', {
    slug: slug.value.trim(),
    name: nombre.value.trim(),
    description: detalle.length > 0 ? detalle : null,
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
    <CeibaAviso v-if="errorDeEnvio" tono="error" titulo="No se pudo crear">
      {{ errorDeEnvio }}
    </CeibaAviso>

    <CeibaCampo
      v-model="nombre"
      :etiqueta="etiquetaNombre"
      requerido
      :error="intentado ? errorNombre : null"
      marcador-de-posicion="Plataforma de pagos"
    />

    <CeibaCampo
      :model-value="slug"
      etiqueta="Identificador"
      requerido
      monoespaciada
      :ayuda="ayudaSlug"
      :error="intentado ? errorIdentificador : null"
      marcador-de-posicion="plataforma-de-pagos"
      @update:model-value="alEscribirSlug"
    />

    <CeibaCampo
      v-model="descripcionTexto"
      etiqueta="Descripción"
      multilinea
      :filas="3"
      ayuda="Opcional."
      :error="intentado ? errorDescripcion : null"
    />

    <template #acciones>
      <CeibaBoton variante="fantasma" :deshabilitado="guardando" @click="emitir('cerrar')">
        Cancelar
      </CeibaBoton>
      <CeibaBoton variante="primario" :cargando="guardando" @click="enviar">
        {{ etiquetaAccion }}
      </CeibaBoton>
    </template>
  </CeibaDialogo>
</template>
