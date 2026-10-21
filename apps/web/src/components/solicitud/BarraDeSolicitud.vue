<script setup lang="ts">
/**
 * Barra superior del constructor: método, URL y envío.
 *
 * El botón se deshabilita con la URL vacía y muestra el giro de la marca
 * mientras la solicitud está en vuelo (`CeibaBoton` ya lo resuelve). Enviar
 * con `Enter` desde el campo de URL es lo que espera cualquiera que haya
 * usado un cliente de API, así que la barra es un `<form>`.
 *
 * Debajo se enseña la URL **efectiva** (con los parámetros ya compuestos)
 * cuando difiere de lo tecleado: es la única forma de que el usuario vea qué
 * se va a pedir de verdad antes de pulsar.
 *
 * FASE 7, P6: la URL deja de ser un `CeibaCampo` y pasa a ser un
 * `CampoConVariables`. El cliente pidió «si pongo las dobles llaves debería
 * mostrarme las variables de entorno», y la URL es el sitio donde más se
 * escriben (`{{base_url}}/v1/…`). Se pierde la etiqueta visible de
 * `CeibaCampo`, así que se repone a mano encima del control para no dejar el
 * campo sin nombre accesible.
 */
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import CampoConVariables from '@/components/variables/CampoConVariables.vue';
import SelectorDeMetodo from './SelectorDeMetodo.vue';
import { usarVariablesDeColeccion } from '@/composables/usarVariablesDeColeccion';
import type { MetodoDeSolicitud } from '@/api/ejecucion';

const props = withDefaults(
  defineProps<{
    metodo: MetodoDeSolicitud;
    url: string;
    urlEfectiva: string;
    ejecutando?: boolean;
    puedeEnviar?: boolean;
    /** Colección de la que salen las variables. `null` ⇒ sin sugerencias. */
    coleccionId?: string | null;
  }>(),
  { ejecutando: false, puedeEnviar: false, coleccionId: null },
);

const emitir = defineEmits<{
  'update:metodo': [valor: MetodoDeSolicitud];
  'update:url': [valor: string];
  /** `blur` del campo de URL: lo usa el autoguardado inmediato (P1). */
  desenfoque: [];
  enviar: [];
}>();

const { variables, cargando } = usarVariablesDeColeccion(() => props.coleccionId ?? undefined);

function alEnviar(): void {
  if (!props.puedeEnviar) return;
  emitir('enviar');
}
</script>

<template>
  <form class="barra" @submit.prevent="alEnviar">
    <div class="barra__fila">
      <SelectorDeMetodo
        :model-value="metodo"
        :deshabilitado="ejecutando"
        @update:model-value="emitir('update:metodo', $event)"
      />

      <div class="barra__url">
        <span id="barra-url-etiqueta" class="barra__etiqueta">URL de destino</span>
        <CampoConVariables
          :model-value="url"
          :variables="variables"
          :cargando-variables="cargando"
          etiqueta="URL de destino"
          marcador-de-posicion="https://api.ejemplo.com/v1/recursos"
          :deshabilitado="ejecutando"
          @update:model-value="emitir('update:url', $event)"
          @desenfoque="emitir('desenfoque')"
          @enviar="alEnviar"
        />
      </div>

      <CeibaBoton
        variante="primario"
        tipo="submit"
        class="barra__enviar"
        :deshabilitado="!puedeEnviar"
        :cargando="ejecutando"
      >
        Enviar
      </CeibaBoton>
    </div>

    <p v-if="urlEfectiva !== url && urlEfectiva.length > 0" class="barra__efectiva">
      <span class="barra__efectiva-etiqueta">Se pedirá:</span>
      <code>{{ urlEfectiva }}</code>
    </p>
  </form>
</template>

<style scoped>
.barra {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-2);
}

.barra__fila {
  display: flex;
  align-items: flex-end;
  gap: var(--ceiba-space-2);
}

.barra__url {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
}

/* Reposición de la etiqueta que ponía `CeibaCampo`: mismo aspecto, para que
 * la barra no cambie de altura ni de aire al pasar al campo con sugerencias. */
.barra__etiqueta {
  font-size: var(--ceiba-text-sm);
  font-weight: 500;
  color: var(--ceiba-text-muted);
}

/* El selector y el botón se alinean con el campo, que lleva etiqueta encima. */
.barra__fila > :deep(select),
.barra__enviar {
  flex: none;
  margin-bottom: 0;
}

.barra__efectiva {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ceiba-space-2);
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
  word-break: break-all;
}

.barra__efectiva-etiqueta {
  flex: none;
}

/* Móvil: la barra se apila en vez de comprimir la URL hasta lo ilegible. */
@media (max-width: 640px) {
  .barra__fila {
    flex-wrap: wrap;
  }

  .barra__url {
    flex-basis: 100%;
    order: -1;
  }

  .barra__enviar {
    margin-left: auto;
  }
}
</style>
