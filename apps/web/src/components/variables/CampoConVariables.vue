<script setup lang="ts">
/**
 * Campo de texto con autocompletado de variables de doble llave
 * (`BRIEF-FASE7` §3.C.4, P6).
 *
 * Al teclear las dos llaves de apertura se despliega la lista de variables de
 * la colección; lo que se escriba entre esas llaves y el cursor filtra por
 * subcadena, sin distinguir mayúsculas ni acentos. Se elige con el teclado y al
 * elegir se inserta el nombre entre dobles llaves, dejando el cursor detrás.
 *
 * POR QUÉ NO SE REUTILIZA `CeibaCampo`
 * ------------------------------------
 * Mismo motivo que `components/solicitud/EditorDePares.vue`: `CeibaCampo` pinta
 * su etiqueta ENCIMA del control, que es lo correcto en un formulario y rompe
 * la barra de URL y la rejilla de pares, que es donde este control vive. La
 * accesibilidad no se pierde — se mantiene con `aria-label`, que es justo lo
 * que `CeibaCampo` aporta — y además aquí hace falta el `role="combobox"`
 * completo, que `CeibaCampo` no tiene ni debería tener.
 *
 * EL PATRÓN ARIA, QUE NO ES DECORATIVO
 * ------------------------------------
 * `role="combobox"` + `aria-expanded` + `aria-controls` + `aria-autocomplete`
 * en el control, `role="listbox"` con `role="option"` en la lista, y
 * `aria-activedescendant` apuntando a la opción resaltada. El foco **no se
 * mueve** a la lista: así el usuario sigue escribiendo y el lector de pantalla
 * anuncia la opción activa. Es el patrón de la APG; inventar otro aquí
 * significa que con lector de pantalla esto no existe.
 *
 * LA TRAMPA DE LAS DOBLES LLAVES
 * ------------------------------
 * No se escriben literales en la plantilla: el compilador de Vue las leería
 * como interpolación y cierra en el primer `}}`. Medido y documentado en
 * `components/peticiones/DialogoDeCurl.vue`: `Unterminated string constant`.
 * Por eso viven en constantes de este bloque `<script setup>`.
 */
import { computed, nextTick, ref, useId, watch } from 'vue';
import ListaDeSugerencias from '@/components/variables/ListaDeSugerencias.vue';
import type { VariableDeColeccion } from '@/composables/usarVariablesDeColeccion';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    variables?: readonly VariableDeColeccion[];
    /** Nombre accesible del control; se pone como `aria-label`. */
    etiqueta: string;
    marcadorDePosicion?: string;
    multilinea?: boolean;
    filas?: number;
    deshabilitado?: boolean;
    monoespaciada?: boolean;
    cargandoVariables?: boolean;
    /** Clases extra que se añaden al `<input>` / `<textarea>`. */
    claseDelControl?: string;
  }>(),
  {
    variables: () => [],
    marcadorDePosicion: '',
    multilinea: false,
    filas: 6,
    deshabilitado: false,
    monoespaciada: true,
    cargandoVariables: false,
    claseDelControl: '',
  },
);

const emitir = defineEmits<{
  'update:modelValue': [valor: string];
  /** Al perder el foco: lo usa el guardado inmediato de P1. */
  desenfoque: [];
  /** `Enter` con la lista CERRADA y `multilinea = false`. */
  enviar: [];
}>();

const APERTURA = '{' + '{';
const CIERRE = '}' + '}';

const idBase = useId();
const idLista = computed(() => `sugerencias-${idBase}`);
const prefijoDeOpcion = computed(() => `sugerencia-${idBase}`);

const control = ref<HTMLInputElement | HTMLTextAreaElement | null>(null);

const abierta = ref(false);
/** Posición de la primera llave de apertura del disparo en curso. */
const inicioDeDisparo = ref<number | null>(null);
const consulta = ref('');
const indiceActivo = ref(-1);

// ---------------------------------------------------------------------------
// Filtrado
// ---------------------------------------------------------------------------

/**
 * Plegado para comparar: minúsculas y sin diacríticos.
 *
 * `NFD` separa la tilde del carácter base y el rango `U+0300–U+036F` la quita,
 * así `sesión` casa con `sesion`. Las claves de variable suelen ser ASCII, pero
 * quien escribe la consulta es una persona y escribe como habla.
 */
function plegar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase();
}

const sugerencias = computed<VariableDeColeccion[]>(() => {
  if (!abierta.value) return [];
  const aguja = plegar(consulta.value);
  if (aguja.length === 0) return [...props.variables];
  return props.variables.filter((variable) => plegar(variable.key).includes(aguja));
});

/** Hay algo que elegir: distingue «lista abierta» de «lista con opciones». */
const hayOpciones = computed(() => abierta.value && sugerencias.value.length > 0);

const idActivo = computed(() =>
  hayOpciones.value && indiceActivo.value >= 0
    ? `${prefijoDeOpcion.value}-${indiceActivo.value}`
    : undefined,
);

/** Si la lista encoge, el resaltado no puede quedarse fuera de rango. */
watch(sugerencias, (lista) => {
  if (lista.length === 0) {
    indiceActivo.value = -1;
  } else if (indiceActivo.value < 0 || indiceActivo.value >= lista.length) {
    indiceActivo.value = 0;
  }
});

// ---------------------------------------------------------------------------
// Detección del disparo
// ---------------------------------------------------------------------------

interface Disparo {
  readonly inicio: number;
  readonly consulta: string;
}

/**
 * ¿El cursor está dentro de unas llaves de apertura sin cerrar?
 *
 * Se busca la ÚLTIMA apertura antes del cursor y se exige que lo que hay entre
 * ella y el cursor sea un nombre a medio escribir: sin llaves (ya se cerró o se
 * abrió otra) y sin espacios (el usuario siguió escribiendo otra cosa). Sin
 * esas dos condiciones la lista se quedaría abierta para siempre después del
 * primer `{{` de la línea, tapando el campo.
 */
function detectarDisparo(texto: string, cursor: number): Disparo | null {
  const hasta = texto.slice(0, Math.max(0, cursor));
  const inicio = hasta.lastIndexOf(APERTURA);
  if (inicio < 0) return null;
  const fragmento = hasta.slice(inicio + APERTURA.length);
  if (/[{}\s]/u.test(fragmento)) return null;
  return { inicio, consulta: fragmento };
}

function textoActual(): string {
  return control.value?.value ?? props.modelValue;
}

function cursorActual(): number {
  const nodo = control.value;
  if (nodo === null) return textoActual().length;
  return nodo.selectionStart ?? nodo.value.length;
}

function cerrar(): void {
  abierta.value = false;
  inicioDeDisparo.value = null;
  consulta.value = '';
  indiceActivo.value = -1;
}

/** Recalcula el disparo a partir del estado real del control. */
function sincronizar(): void {
  if (props.deshabilitado) return;
  const disparo = detectarDisparo(textoActual(), cursorActual());
  if (disparo === null) {
    if (abierta.value) cerrar();
    return;
  }
  inicioDeDisparo.value = disparo.inicio;
  consulta.value = disparo.consulta;
  if (!abierta.value) {
    abierta.value = true;
    indiceActivo.value = 0;
  }
}

// ---------------------------------------------------------------------------
// Entrada del usuario
// ---------------------------------------------------------------------------

function alEscribir(evento: Event): void {
  const destino = evento.target as HTMLInputElement | HTMLTextAreaElement;
  emitir('update:modelValue', destino.value);
  sincronizar();
}

function mover(paso: number): void {
  const total = sugerencias.value.length;
  if (total === 0) return;
  const actual = indiceActivo.value < 0 ? 0 : indiceActivo.value;
  // Vuelta circular: `+ total` porque el resto de un negativo en JS es negativo.
  indiceActivo.value = (actual + paso + total) % total;
}

function elegir(indice: number): void {
  const variable = sugerencias.value[indice];
  const inicio = inicioDeDisparo.value;
  if (variable === undefined || inicio === null) return;

  const texto = textoActual();
  const cursor = Math.max(cursorActual(), inicio);
  const antes = texto.slice(0, inicio);
  const insercion = `${APERTURA}${variable.key}${CIERRE}`;
  const nuevo = `${antes}${insercion}${texto.slice(cursor)}`;
  const posicion = antes.length + insercion.length;

  cerrar();
  emitir('update:modelValue', nuevo);

  // El control es «controlado» por la prop, pero quien la escribe es el padre.
  // Si el padre tarda (o no la propaga), el DOM se quedaría con el texto a
  // medias y el cursor en otro sitio: se reconcilia aquí, sin esperar a nadie.
  void nextTick(() => {
    const nodo = control.value;
    if (nodo === null) return;
    if (nodo.value !== nuevo) nodo.value = nuevo;
    nodo.focus();
    nodo.setSelectionRange(posicion, posicion);
  });
}

function alTeclear(evento: KeyboardEvent): void {
  if (abierta.value) {
    if (evento.key === 'Escape') {
      // Cierra SIN borrar lo escrito y SIN propagar: si se propagase, cerraría
      // el diálogo que contiene al campo o cancelaría la edición entera.
      evento.preventDefault();
      evento.stopPropagation();
      cerrar();
      return;
    }
    if (evento.key === 'Tab') {
      cerrar();
      return;
    }
    if (hayOpciones.value) {
      if (evento.key === 'ArrowDown') {
        evento.preventDefault();
        mover(1);
        return;
      }
      if (evento.key === 'ArrowUp') {
        evento.preventDefault();
        mover(-1);
        return;
      }
      if (evento.key === 'Enter') {
        evento.preventDefault();
        evento.stopPropagation();
        elegir(indiceActivo.value);
        return;
      }
    }
  }

  // Con la lista cerrada las flechas se comportan como siempre (el navegador
  // mueve el cursor) y `Enter` significa «envía», que es lo que la barra de
  // solicitud espera de toda la vida.
  if (evento.key === 'Enter' && !props.multilinea) emitir('enviar');
}

function alDesenfocar(): void {
  cerrar();
  emitir('desenfoque');
}
</script>

<template>
  <div class="campo-variables">
    <textarea
      v-if="multilinea"
      ref="control"
      class="campo-variables__control campo-variables__control--area"
      :class="[claseDelControl, { 'campo-variables__control--mono': monoespaciada }]"
      role="combobox"
      aria-autocomplete="list"
      :aria-label="etiqueta"
      :aria-expanded="abierta ? 'true' : 'false'"
      :aria-controls="idLista"
      :aria-activedescendant="idActivo"
      :value="modelValue"
      :rows="filas"
      :placeholder="marcadorDePosicion || undefined"
      :disabled="deshabilitado"
      spellcheck="false"
      autocomplete="off"
      @input="alEscribir"
      @keydown="alTeclear"
      @click="sincronizar"
      @blur="alDesenfocar"
    />
    <input
      v-else
      ref="control"
      type="text"
      class="campo-variables__control"
      :class="[claseDelControl, { 'campo-variables__control--mono': monoespaciada }]"
      role="combobox"
      aria-autocomplete="list"
      :aria-label="etiqueta"
      :aria-expanded="abierta ? 'true' : 'false'"
      :aria-controls="idLista"
      :aria-activedescendant="idActivo"
      :value="modelValue"
      :placeholder="marcadorDePosicion || undefined"
      :disabled="deshabilitado"
      spellcheck="false"
      autocomplete="off"
      @input="alEscribir"
      @keydown="alTeclear"
      @click="sincronizar"
      @blur="alDesenfocar"
    />

    <ListaDeSugerencias
      v-if="abierta"
      :sugerencias="sugerencias"
      :indice-activo="indiceActivo"
      :id-lista="idLista"
      :prefijo-de-opcion="prefijoDeOpcion"
      :etiqueta="`Variables para ${etiqueta}`"
      :cargando-variables="cargandoVariables"
      :consulta="consulta"
      @elegir="elegir"
      @resaltar="(indice: number) => (indiceActivo = indice)"
    />
  </div>
</template>

<style scoped>
.campo-variables {
  position: relative;
  width: 100%;
  min-width: 0;
}

.campo-variables__control {
  width: 100%;
  min-width: 0;
  min-height: 30px;
  padding: var(--ceiba-space-1) var(--ceiba-space-2);
  background: var(--ceiba-bg-sunken);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-sm);
  color: var(--ceiba-text);
  font-family: inherit;
  font-size: var(--ceiba-text-sm);
}

.campo-variables__control--mono {
  font-family: var(--ceiba-font-mono);
}

.campo-variables__control--area {
  min-height: 120px;
  resize: vertical;
  line-height: 1.5;
}

.campo-variables__control::placeholder {
  color: var(--ceiba-text-faint);
}

.campo-variables__control:hover:not(:disabled) {
  border-color: var(--ceiba-border-strong);
}

.campo-variables__control:focus-visible {
  outline: none;
  box-shadow: var(--ceiba-focus-ring);
}

.campo-variables__control:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
</style>
