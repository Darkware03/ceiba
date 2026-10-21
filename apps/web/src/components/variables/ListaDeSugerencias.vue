<script setup lang="ts">
/**
 * Lista desplegable de variables del autocompletado (`BRIEF-FASE7` §3.C.4).
 *
 * Es el `role="listbox"` del patrón combobox: **no tiene foco nunca**. El foco
 * se queda en el control que la abre (`CampoConVariables.vue`) y la opción
 * activa se anuncia con `aria-activedescendant`. Por eso las opciones responden
 * a `mousedown` con `preventDefault` y no a `click`: un `click` llegaría
 * después del `blur` del control, y para entonces la lista ya estaría cerrada.
 *
 * QUÉ SE ENSEÑA Y QUÉ NO
 * ----------------------
 *  - **Una variable secreta sale marcada y SIN valor.** Ni en claro, ni
 *    cifrado, ni con un enmascarado inventado. El `preview` de una secreta ya
 *    llega `null` desde `usarVariablesDeColeccion.ts`, y aquí además no se
 *    pinta: dos cierres para la misma puerta, a propósito.
 *  - **Una variable eclipsada sale igual, marcada.** El §2.3 es explícito: «el
 *    usuario tiene derecho a saber que existe». Ocultarla haría que buscase
 *    durante media hora por qué `{{base_url}}` no vale lo que puso.
 *  - **Una variable desactivada sale marcada.** Se puede insertar —el texto es
 *    válido— pero no se va a resolver, y eso hay que decirlo antes y no después
 *    de un 404 incomprensible.
 *
 * Los tres estados del §2.2.4 del `BRIEF-FASE4` existen aquí: espera con la
 * marca girando, vacío con texto, y lista. Nunca un hueco mudo.
 */
import { CeibaSpinner } from '@ceiba/brand';
import type { VariableDeColeccion } from '@/composables/usarVariablesDeColeccion';

const props = withDefaults(
  defineProps<{
    sugerencias: readonly VariableDeColeccion[];
    /** Índice resaltado; `-1` cuando no hay ninguno. */
    indiceActivo: number;
    /** `id` del propio `listbox`: lo apunta el `aria-controls` del control. */
    idLista: string;
    /** Prefijo de los `id` de cada opción, para `aria-activedescendant`. */
    prefijoDeOpcion: string;
    /** Nombre accesible de la lista. */
    etiqueta?: string;
    cargandoVariables?: boolean;
    /** Lo tecleado tras las llaves; sólo se usa para redactar el vacío. */
    consulta?: string;
  }>(),
  {
    etiqueta: 'Variables disponibles',
    cargandoVariables: false,
    consulta: '',
  },
);

const emitir = defineEmits<{
  elegir: [indice: number];
  resaltar: [indice: number];
}>();

/**
 * Las dobles llaves van en constantes y no escritas en la plantilla: el
 * compilador de Vue las leería como una interpolación y cierra en el primer
 * `}}`. Medido y documentado en `components/peticiones/DialogoDeCurl.vue`:
 * `Unterminated string constant`.
 */
const APERTURA = '{' + '{';
const CIERRE = '}' + '}';

/** Texto que se insertaría al elegir: el nombre entre dobles llaves. */
function conLlaves(clave: string): string {
  return `${APERTURA}${clave}${CIERRE}`;
}

function idDeOpcion(indice: number): string {
  return `${props.prefijoDeOpcion}-${indice}`;
}

/** Procedencia legible: el entorno si lo hay, si no el ámbito. */
function origenDe(variable: VariableDeColeccion): string {
  if (variable.environmentName !== null) return variable.environmentName;
  return variable.scope === 'collection' ? 'Colección' : 'Workspace';
}

/** Descripción completa para el lector de pantalla, marcas incluidas. */
function descripcionDe(variable: VariableDeColeccion): string {
  const partes: string[] = [conLlaves(variable.key), origenDe(variable)];
  if (variable.isSecret) partes.push('secreta, sin valor visible');
  if (variable.shadowed) partes.push('eclipsada por otra de mayor precedencia');
  if (!variable.isEnabled) partes.push('desactivada');
  if (!variable.isSecret && variable.preview !== null) partes.push(variable.preview);
  return partes.join('. ');
}
</script>

<template>
  <ul
    :id="idLista"
    class="sugerencias"
    role="listbox"
    data-prueba="sugerencias-de-variables"
    :aria-label="etiqueta"
  >
    <li v-if="cargandoVariables" class="sugerencias__estado" role="presentation">
      <CeibaSpinner size="xs" />
      <span>Cargando variables…</span>
    </li>

    <li
      v-else-if="sugerencias.length === 0"
      class="sugerencias__estado sugerencias__estado--vacio"
      role="presentation"
      data-prueba="sugerencias-vacio"
    >
      <span v-if="consulta.length > 0">Ninguna variable coincide con «{{ consulta }}».</span>
      <span v-else>Esta colección no tiene variables disponibles.</span>
    </li>

    <li
      v-for="(variable, indice) in sugerencias"
      :id="idDeOpcion(indice)"
      :key="`${variable.scope}:${variable.environmentId ?? 'sin-entorno'}:${variable.key}`"
      class="sugerencia"
      :class="{
        'sugerencia--activa': indice === indiceActivo,
        'sugerencia--apagada': !variable.isEnabled || variable.shadowed,
      }"
      role="option"
      data-prueba="sugerencia"
      :aria-selected="indice === indiceActivo ? 'true' : 'false'"
      :aria-label="descripcionDe(variable)"
      @mousedown.prevent="emitir('elegir', indice)"
      @mouseenter="emitir('resaltar', indice)"
    >
      <span class="sugerencia__clave">{{ conLlaves(variable.key) }}</span>

      <span class="sugerencia__marcas">
        <span v-if="variable.isSecret" class="marca marca--secreta" data-prueba="marca-secreta">
          secreta
        </span>
        <span
          v-if="variable.shadowed"
          class="marca marca--eclipsada"
          data-prueba="marca-eclipsada"
        >
          eclipsada
        </span>
        <span
          v-if="!variable.isEnabled"
          class="marca marca--desactivada"
          data-prueba="marca-desactivada"
        >
          desactivada
        </span>
      </span>

      <span class="sugerencia__origen">{{ origenDe(variable) }}</span>

      <!-- El valor de una secreta NO se pinta: ni aquí ni en ningún sitio. -->
      <span
        v-if="!variable.isSecret && variable.preview !== null"
        class="sugerencia__vistazo"
        data-prueba="sugerencia-vistazo"
        >{{ variable.preview }}</span
      >
    </li>
  </ul>
</template>

<style scoped>
.sugerencias {
  position: absolute;
  z-index: var(--ceiba-z-overlay);
  top: calc(100% + var(--ceiba-space-1));
  left: 0;
  right: 0;
  max-height: 260px;
  overflow-y: auto;
  margin: 0;
  padding: var(--ceiba-space-1);
  list-style: none;
  background: var(--ceiba-surface-overlay);
  border: 1px solid var(--ceiba-border-strong);
  border-radius: var(--ceiba-radius-md);
}

.sugerencias__estado {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-2);
  padding: var(--ceiba-space-2) var(--ceiba-space-3);
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.sugerencias__estado--vacio {
  color: var(--ceiba-text-faint);
}

.sugerencia {
  display: grid;
  grid-template-columns: minmax(0, auto) minmax(0, auto) minmax(0, 1fr);
  grid-template-areas:
    'clave marcas origen'
    'vistazo vistazo vistazo';
  align-items: center;
  gap: var(--ceiba-space-1) var(--ceiba-space-2);
  padding: var(--ceiba-space-1) var(--ceiba-space-2);
  border-radius: var(--ceiba-radius-sm);
  cursor: pointer;
}

.sugerencia--activa {
  background: var(--ceiba-accent-surface);
}

.sugerencia--apagada .sugerencia__clave {
  opacity: 0.7;
}

.sugerencia__clave {
  grid-area: clave;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text);
}

.sugerencia__marcas {
  grid-area: marcas;
  display: flex;
  gap: var(--ceiba-space-1);
}

.sugerencia__origen {
  grid-area: origen;
  justify-self: end;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

.sugerencia__vistazo {
  grid-area: vistazo;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-muted);
}

.marca {
  padding: 0 var(--ceiba-space-1);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-pill);
  font-size: var(--ceiba-text-xs);
  line-height: 1.6;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.marca--secreta {
  border-color: var(--ceiba-warning);
  color: var(--ceiba-warning);
}

.marca--eclipsada {
  border-color: var(--ceiba-info);
  color: var(--ceiba-info);
}

.marca--desactivada {
  color: var(--ceiba-text-faint);
}
</style>
