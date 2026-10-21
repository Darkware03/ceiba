<script setup lang="ts">
/**
 * Una petición dentro de una colección.
 *
 * El nombre **sí** es un `RouterLink` aquí (al contrario que en
 * `FilaDeColeccion.vue`, ver su nota): abrir una petición en el constructor es
 * la acción principal de esta pantalla, y un enlace de verdad permite
 * clic-central, «abrir en pestaña nueva» y que el teclado la alcance como lo
 * que es. Un `<div @click>` no da nada de eso.
 *
 * El verbo se pinta con las clases `ceiba-metodo--*` de `base.css`, que sacan
 * el color de los tokens `--ceiba-method-*`. Aquí no se define ni un color.
 */
import { computed } from 'vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import { RUTA_CONSTRUCTOR } from '@/router/nombres';
import { esEjecutableEnElConstructor, verboVisible } from '@/api/peticiones';
import type { Peticion } from '@/api/peticiones';

const props = defineProps<{
  peticion: Peticion;
  /** `true` mientras el servidor genera el cURL de ESTA petición. */
  generandoCurl?: boolean;
  /** `true` mientras hay cualquier mutación en vuelo: desactiva las acciones. */
  ocupado?: boolean;
}>();

const emitir = defineEmits<{
  renombrar: [];
  duplicar: [];
  borrar: [];
  curl: [];
}>();

const verbo = computed(() => verboVisible(props.peticion));

/**
 * El color por método sólo existe para los siete del contrato. Un `TRACE` o un
 * verbo propio no tienen token, y se quedan con el color de texto normal en
 * lugar de robar el de otro método y mentir sobre qué es.
 */
const claseDeVerbo = computed(() =>
  esEjecutableEnElConstructor(props.peticion.method)
    ? `ceiba-metodo--${props.peticion.method.toLowerCase()}`
    : 'fila__verbo--propio',
);

const destino = computed(() => ({
  name: RUTA_CONSTRUCTOR,
  query: {
    peticion: props.peticion.id,
    coleccion: props.peticion.collectionId,
  },
}));
</script>

<template>
  <li class="fila">
    <RouterLink class="fila__enlace" :to="destino">
      <span class="fila__verbo ceiba-metodo" :class="claseDeVerbo">{{ verbo }}</span>
      <span class="fila__datos">
        <span class="fila__nombre">{{ peticion.name }}</span>
        <code class="fila__url">{{ peticion.url }}</code>
      </span>
    </RouterLink>

    <div class="fila__acciones">
      <CeibaBoton
        compacto
        variante="secundario"
        :cargando="generandoCurl === true"
        :deshabilitado="ocupado === true"
        :aria-label="`Copiar como cURL la petición ${peticion.name}`"
        @click="emitir('curl')"
      >
        Copiar como cURL
      </CeibaBoton>
      <CeibaBoton
        compacto
        variante="fantasma"
        :deshabilitado="ocupado === true"
        :aria-label="`Renombrar la petición ${peticion.name}`"
        @click="emitir('renombrar')"
      >
        Renombrar
      </CeibaBoton>
      <CeibaBoton
        compacto
        variante="fantasma"
        :deshabilitado="ocupado === true"
        :aria-label="`Duplicar la petición ${peticion.name}`"
        @click="emitir('duplicar')"
      >
        Duplicar
      </CeibaBoton>
      <CeibaBoton
        compacto
        variante="peligro"
        :deshabilitado="ocupado === true"
        :aria-label="`Borrar la petición ${peticion.name}`"
        @click="emitir('borrar')"
      >
        Borrar
      </CeibaBoton>
    </div>
  </li>
</template>

<style scoped>
.fila {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ceiba-space-4);
  padding: var(--ceiba-space-2) var(--ceiba-space-4);
  list-style: none;
  border-bottom: 1px solid var(--ceiba-border);
}

.fila:last-child {
  border-bottom: 0;
}

.fila:hover {
  background: var(--ceiba-surface-overlay);
}

.fila__enlace {
  display: flex;
  align-items: baseline;
  gap: var(--ceiba-space-3);
  min-width: 0;
  flex: 1 1 auto;
  padding: var(--ceiba-space-1) 0;
  color: inherit;
  text-decoration: none;
}

.fila__enlace:focus-visible {
  outline: none;
  border-radius: var(--ceiba-radius-sm);
  box-shadow: var(--ceiba-focus-ring);
}

.fila__verbo {
  flex: none;
  min-width: 4.5rem;
}

.fila__verbo--propio {
  color: var(--ceiba-text-muted);
}

.fila__datos {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
  min-width: 0;
}

.fila__nombre {
  font-size: var(--ceiba-text-md);
  font-weight: 500;
  color: var(--ceiba-text);
}

.fila__enlace:hover .fila__nombre {
  color: var(--ceiba-accent);
}

.fila__url {
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
  overflow-wrap: anywhere;
}

.fila__acciones {
  display: flex;
  gap: var(--ceiba-space-2);
  flex: none;
  flex-wrap: wrap;
  justify-content: flex-end;
}

@media (max-width: 860px) {
  .fila {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
