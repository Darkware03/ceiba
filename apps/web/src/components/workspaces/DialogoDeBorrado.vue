<script setup lang="ts">
/**
 * Confirmación de borrado. §18 la exige para toda operación destructiva.
 *
 * Qué hace que esto sea una confirmación de verdad y no un trámite:
 *
 *  - Es un paso **separado y explícito**: el botón de la lista abre este
 *    diálogo, no borra.
 *  - Dice **qué** se va a borrar, por su nombre y su identificador.
 *  - Para el caso irreversible (un workspace, que arrastra sus colecciones)
 *    pide **teclear el identificador**. Es fricción deliberada: el coste de
 *    equivocarse no es simétrico.
 *  - El botón destructivo no depende sólo del color: lleva texto explícito
 *    («Borrar definitivamente») y borde propio.
 *
 * `notaDeRol` cuenta qué rol exige el servidor. Es **información**, no un
 * control: el botón no se oculta por rol, porque la autorización la decide la
 * API y una interfaz que esconde botones no protege nada (§5).
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
    /** Nombre visible de lo que se borra. */
    nombre: string;
    /** Identificador estable; es lo que hay que teclear si `exigirTecleo`. */
    identificador: string;
    /** Qué se pierde, dicho sin rodeos. */
    consecuencia: string;
    notaDeRol?: string;
    /** Pide teclear el identificador antes de habilitar el borrado. */
    exigirTecleo?: boolean;
    guardando?: boolean;
    errorDeEnvio?: string | null;
  }>(),
  { notaDeRol: '', exigirTecleo: false, guardando: false, errorDeEnvio: null },
);

const emitir = defineEmits<{ cerrar: []; confirmar: [] }>();

const confirmacion = ref('');

watch(
  () => props.abierto,
  (abierto) => {
    if (abierto) confirmacion.value = '';
  },
  { immediate: true },
);

const puedeBorrar = computed(
  () => !props.exigirTecleo || confirmacion.value.trim() === props.identificador,
);
</script>

<template>
  <CeibaDialogo :abierto="abierto" :titulo="titulo" @cerrar="emitir('cerrar')">
    <CeibaAviso v-if="errorDeEnvio" tono="error" titulo="No se pudo borrar">
      {{ errorDeEnvio }}
    </CeibaAviso>

    <CeibaAviso tono="aviso" titulo="Esta acción no se puede deshacer">
      Vas a borrar <strong>{{ nombre }}</strong>
      (<code>{{ identificador }}</code
      >). {{ consecuencia }}
    </CeibaAviso>

    <p v-if="notaDeRol" class="borrado__rol">{{ notaDeRol }}</p>

    <CeibaCampo
      v-if="exigirTecleo"
      v-model="confirmacion"
      etiqueta="Escribe el identificador para confirmar"
      monoespaciada
      :ayuda="`Teclea «${identificador}» tal cual.`"
    />

    <template #acciones>
      <CeibaBoton variante="fantasma" :deshabilitado="guardando" @click="emitir('cerrar')">
        Cancelar
      </CeibaBoton>
      <CeibaBoton
        variante="peligro"
        :cargando="guardando"
        :deshabilitado="!puedeBorrar"
        @click="emitir('confirmar')"
      >
        Borrar definitivamente
      </CeibaBoton>
    </template>
  </CeibaDialogo>
</template>

<style scoped>
.borrado__rol {
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-muted);
}
</style>
