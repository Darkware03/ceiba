import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import type { EditorView } from '@codemirror/view';
import type { VariableDeColeccion } from './usarVariablesDeColeccion';

/**
 * Sugerencias de variables dentro del editor de código (P6, cuerpo crudo).
 *
 * POR QUÉ ESTO EXISTE EN VEZ DE REUSAR `CampoConVariables`
 * ---------------------------------------------------------
 * `CampoConVariables` envuelve un `<input>`/`<textarea>` y lee `selectionStart`.
 * El cuerpo crudo no es ninguno de los dos: es una `EditorView` de CodeMirror,
 * cuyo texto vive en `state.doc` y cuyo cursor vive en `state.selection`. No
 * hay forma de que aquel componente lo gobierne.
 *
 * POR QUÉ NO SE USA `@codemirror/autocomplete`, QUE SERÍA LO CANÓNICO
 * -------------------------------------------------------------------
 * **No está instalado** y no es una dependencia transitiva alcanzable:
 * comprobado con `require.resolve` sobre `apps/web`, falla. Añadir un paquete
 * nuevo tocaría `package.json`, que no es de este ámbito y que hay otro agente
 * editando en paralelo. Así que se resuelve con lo que ya hay
 * (`@codemirror/view`, que la aplicación ya usa) y **se reutiliza la misma
 * lista accesible** que el resto de los campos (`ListaDeSugerencias.vue`), de
 * modo que no hay dos comportamientos de autocompletado distintos.
 *
 * Las reglas de disparo son **las mismas** que en `CampoConVariables`, a
 * propósito y copiadas aquí con su motivo: la última apertura antes del
 * cursor, y nada de llaves ni espacios entre ella y el cursor. Si divergieran,
 * la URL y el cuerpo se comportarían distinto ante la misma pulsación.
 */

/** Las dobles llaves, en constantes: ver `DialogoDeCurl.vue`. */
const APERTURA = '{' + '{';
const CIERRE = '}' + '}';

/** Minúsculas y sin diacríticos, igual que en `CampoConVariables`. */
function plegar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase();
}

export interface DisparoDeVariable {
  readonly inicio: number;
  readonly consulta: string;
}

/**
 * ¿El cursor está dentro de unas llaves de apertura sin cerrar?
 *
 * Exportada para poder probarla sin montar CodeMirror, que en `jsdom` no mide
 * nada: una función pura es lo único que se puede afirmar con honestidad.
 */
export function detectarDisparoDeVariable(
  texto: string,
  cursor: number,
): DisparoDeVariable | null {
  const hasta = texto.slice(0, Math.max(0, cursor));
  const inicio = hasta.lastIndexOf(APERTURA);
  if (inicio < 0) return null;
  const fragmento = hasta.slice(inicio + APERTURA.length);
  if (/[{}\s]/u.test(fragmento)) return null;
  return { inicio, consulta: fragmento };
}

/** Filtra por subcadena, sin distinguir mayúsculas ni acentos. */
export function filtrarVariables(
  variables: readonly VariableDeColeccion[],
  consulta: string,
): VariableDeColeccion[] {
  const aguja = plegar(consulta);
  if (aguja.length === 0) return [...variables];
  return variables.filter((variable) => plegar(variable.key).includes(aguja));
}

export interface OpcionesDeSugerenciasEnEditor {
  readonly vista: ShallowRef<EditorView | null>;
  readonly variables: () => readonly VariableDeColeccion[];
  /** `false` apaga el mecanismo entero (modo sin editor, por ejemplo). */
  readonly activo?: () => boolean;
}

export interface SugerenciasEnEditor {
  readonly abierta: Ref<boolean>;
  readonly sugerencias: ComputedRef<VariableDeColeccion[]>;
  readonly indiceActivo: Ref<number>;
  readonly consulta: Ref<string>;
  /** Posición de la lista respecto al contenedor del editor, en píxeles. */
  readonly posicion: Ref<{ arriba: number; izquierda: number }>;
  elegir(indice: number): void;
  resaltar(indice: number): void;
  cerrar(): void;
}

export function usarSugerenciasEnEditor(
  opciones: OpcionesDeSugerenciasEnEditor,
): SugerenciasEnEditor {
  const abierta = ref(false);
  const consulta = ref('');
  const indiceActivo = ref(-1);
  const inicio = ref(0);
  const posicion = ref({ arriba: 0, izquierda: 0 });

  const sugerencias = computed(() =>
    abierta.value ? filtrarVariables(opciones.variables(), consulta.value) : [],
  );

  watch(sugerencias, (lista) => {
    if (lista.length === 0) indiceActivo.value = -1;
    else if (indiceActivo.value < 0 || indiceActivo.value >= lista.length) indiceActivo.value = 0;
  });

  function cerrar(): void {
    abierta.value = false;
    consulta.value = '';
    indiceActivo.value = -1;
  }

  function resaltar(indice: number): void {
    indiceActivo.value = indice;
  }

  /** Coloca la lista bajo el cursor, en coordenadas del contenedor. */
  function situar(vista: EditorView, posicionEnDoc: number): void {
    const coords = vista.coordsAtPos(posicionEnDoc);
    const caja = vista.dom.getBoundingClientRect();
    if (coords === null) {
      posicion.value = { arriba: 0, izquierda: 0 };
      return;
    }
    posicion.value = {
      arriba: Math.max(0, coords.bottom - caja.top),
      izquierda: Math.max(0, coords.left - caja.left),
    };
  }

  function sincronizar(): void {
    const vista = opciones.vista.value;
    if (vista === null || opciones.activo?.() === false) {
      cerrar();
      return;
    }
    const cursor = vista.state.selection.main.head;
    const disparo = detectarDisparoDeVariable(vista.state.doc.toString(), cursor);
    if (disparo === null) {
      cerrar();
      return;
    }
    inicio.value = disparo.inicio;
    consulta.value = disparo.consulta;
    if (!abierta.value) {
      abierta.value = true;
      indiceActivo.value = 0;
    }
    situar(vista, cursor);
  }

  function elegir(indice: number): void {
    const vista = opciones.vista.value;
    const elegida = sugerencias.value[indice];
    if (vista === null || elegida === undefined) return;
    const desde = inicio.value;
    const hasta = vista.state.selection.main.head;
    const texto = `${APERTURA}${elegida.key}${CIERRE}`;
    vista.dispatch({
      changes: { from: desde, to: hasta, insert: texto },
      selection: { anchor: desde + texto.length },
    });
    cerrar();
    vista.focus();
  }

  function mover(paso: number): void {
    const total = sugerencias.value.length;
    if (total === 0) return;
    indiceActivo.value = (indiceActivo.value + paso + total) % total;
  }

  /**
   * Teclado en **fase de captura**.
   *
   * CodeMirror se queda con `ArrowDown`, `Enter` y `Escape` en cuanto llegan a
   * su `contentDOM`. Para que la lista los pueda usar hay que interceptarlos
   * antes y detener la propagación; si no, `Enter` metería un salto de línea
   * en vez de insertar la variable.
   */
  function alTeclear(evento: KeyboardEvent): void {
    if (!abierta.value) return;
    switch (evento.key) {
      case 'ArrowDown':
        evento.preventDefault();
        evento.stopPropagation();
        mover(1);
        return;
      case 'ArrowUp':
        evento.preventDefault();
        evento.stopPropagation();
        mover(-1);
        return;
      case 'Enter':
        if (indiceActivo.value < 0) return;
        evento.preventDefault();
        evento.stopPropagation();
        elegir(indiceActivo.value);
        return;
      case 'Escape':
        evento.preventDefault();
        evento.stopPropagation();
        cerrar();
        return;
      case 'Tab':
        cerrar();
        return;
      default:
    }
  }

  /** Tras escribir o mover el cursor, recalcular en el siguiente fotograma. */
  function alCambiar(): void {
    queueMicrotask(sincronizar);
  }

  let enganchado: HTMLElement | null = null;

  function enganchar(vista: EditorView | null): void {
    if (enganchado !== null) {
      enganchado.removeEventListener('keydown', alTeclear, true);
      enganchado.removeEventListener('keyup', alCambiar);
      enganchado.removeEventListener('mouseup', alCambiar);
      enganchado.removeEventListener('focusout', cerrar);
      enganchado = null;
    }
    if (vista === null) return;
    enganchado = vista.dom;
    enganchado.addEventListener('keydown', alTeclear, true);
    enganchado.addEventListener('keyup', alCambiar);
    enganchado.addEventListener('mouseup', alCambiar);
    enganchado.addEventListener('focusout', cerrar);
  }

  watch(opciones.vista, (vista) => enganchar(vista), { immediate: true });

  onBeforeUnmount(() => {
    enganchar(null);
  });

  return { abierta, sugerencias, indiceActivo, consulta, posicion, elegir, resaltar, cerrar };
}
