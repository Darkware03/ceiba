<script setup lang="ts">
/**
 * Diálogo de renombrado (nombre y descripción) para workspaces y colecciones.
 *
 * El `slug` **no** está aquí a propósito: ninguno de los dos `PATCH` de la API
 * lo admite (`esquemaActualizarWorkspace` y `esquemaActualizarColeccion` sólo
 * aceptan `name` y `description`). Ofrecer un campo que el servidor ignora
 * sería un control que miente.
 *
 * Los dos esquemas exigen además **al menos un cambio** (`refine`: «no hay
 * nada que actualizar»), así que el botón se queda inactivo si no se ha tocado
 * nada: es el mismo 400 que daría el servidor, dicho antes y en español.
 */
import { computed, ref, watch } from 'vue';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import CeibaCampo from '@/components/ui/CeibaCampo.vue';
import CeibaDialogo from '@/components/ui/CeibaDialogo.vue';

const props = withDefaults(
  defineProps<{
    abierto: boolean;
    titulo: string;
    descripcion?: string;
    nombreInicial: string;
    descripcionInicial: string | null;
    /** Nota de rol: la exige el servidor, no esta pantalla. */
    notaDeRol?: string;
    maximoDescripcion?: number;
    guardando?: boolean;
    errorDeEnvio?: string | null;
  }>(),
  {
    descripcion: '',
    notaDeRol: '',
    maximoDescripcion: 2000,
    guardando: false,
    errorDeEnvio: null,
  },
);

const emitir = defineEmits<{
  cerrar: [];
  guardar: [datos: { name: string; description: string | null }];
}>();

const LONGITUD_MAXIMA_NOMBRE = 160;

const nombre = ref('');
const descripcionTexto = ref('');
const intentado = ref(false);

watch(
  () => props.abierto,
  (abierto) => {
    if (!abierto) return;
    nombre.value = props.nombreInicial;
    descripcionTexto.value = props.descripcionInicial ?? '';
    intentado.value = false;
  },
  { immediate: true },
);

const errorNombre = computed<string | null>(() => {
  const limpio = nombre.value.trim();
  if (limpio.length === 0) return 'El nombre es obligatorio.';
  if (limpio.length > LONGITUD_MAXIMA_NOMBRE) {
    return `El nombre no puede superar ${LONGITUD_MAXIMA_NOMBRE} caracteres.`;
  }
  return null;
});

const errorDescripcion = computed<string | null>(() =>
  descripcionTexto.value.trim().length > props.maximoDescripcion
    ? `La descripción no puede superar ${props.maximoDescripcion} caracteres.`
    : null,
);

const descripcionNormalizada = computed<string | null>(() => {
  const limpio = descripcionTexto.value.trim();
  return limpio.length > 0 ? limpio : null;
});

const hayCambios = computed(
  () =>
    nombre.value.trim() !== props.nombreInicial.trim() ||
    descripcionNormalizada.value !== (props.descripcionInicial ?? null),
);

function enviar(): void {
  intentado.value = true;
  if (errorNombre.value !== null || errorDescripcion.value !== null) return;
  if (!hayCambios.value) return;
  emitir('guardar', { name: nombre.value.trim(), description: descripcionNormalizada.value });
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

    <CeibaAviso v-if="notaDeRol" tono="info">{{ notaDeRol }}</CeibaAviso>

    <CeibaCampo
      v-model="nombre"
      etiqueta="Nombre"
      requerido
      :error="intentado ? errorNombre : null"
    />

    <CeibaCampo
      v-model="descripcionTexto"
      etiqueta="Descripción"
      multilinea
      :filas="3"
      ayuda="Opcional. Vacío la deja sin descripción."
      :error="intentado ? errorDescripcion : null"
    />

    <p v-if="!hayCambios" class="renombrado__sin-cambios">
      No has cambiado nada todavía.
    </p>

    <template #acciones>
      <CeibaBoton variante="fantasma" :deshabilitado="guardando" @click="emitir('cerrar')">
        Cancelar
      </CeibaBoton>
      <CeibaBoton
        variante="primario"
        :cargando="guardando"
        :deshabilitado="!hayCambios"
        @click="enviar"
      >
        Guardar cambios
      </CeibaBoton>
    </template>
  </CeibaDialogo>
</template>

<style scoped>
.renombrado__sin-cambios {
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}
</style>
