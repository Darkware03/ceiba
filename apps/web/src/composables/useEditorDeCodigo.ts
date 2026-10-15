/**
 * Editor de código de CEIBA, sobre CodeMirror 6.
 *
 * POR QUÉ UN COMPOSABLE Y NO UN COMPONENTE: hay dos sitios que necesitan un
 * editor (el cuerpo de la solicitud, editable, y el cuerpo de la respuesta,
 * de sólo lectura) y las dos cajas se pintan distinto. Lo único común es el
 * ciclo de vida de la `EditorView`, que es justo lo que se encapsula aquí.
 *
 * POR QUÉ NO SE USA EL METAPAQUETE `codemirror` NI `basicSetup`: arrastran un
 * tema propio y extensiones que no queremos (autocompletado, linting). Las
 * extensiones se componen a mano desde los paquetes fijados en `package.json`.
 *
 * EL TEMA NO SE DEFINE AQUÍ. `src/styles/base.css` ya viste `.cm-editor`,
 * `.cm-gutters`, `.cm-cursor`, `.cm-panels`… con tokens CEIBA. Lo único que
 * falta allí son los colores de los *tokens de sintaxis*, que CodeMirror no
 * expone como clases estables sino a través de un `HighlightStyle`; ver
 * `construirResaltado()`, que no introduce ni un color nuevo.
 *
 * FUGA DE MEMORIA: una `EditorView` que no se destruye deja escuchadores de
 * DOM y un observador de mutaciones vivos. `onBeforeUnmount` la destruye
 * siempre, y `watch` sobre el contenedor la recrea si el elemento cambia.
 */
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import { Compartment, EditorState } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import {
  HighlightStyle,
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { xml } from '@codemirror/lang-xml';

// ---------------------------------------------------------------------------
// Lógica pura (sin DOM): esto es lo que se puede probar sin montar nada
// ---------------------------------------------------------------------------

export const LENGUAJES = ['json', 'html', 'xml', 'texto'] as const;
export type LenguajeDeEditor = (typeof LENGUAJES)[number];

/**
 * Deduce el lenguaje a partir de un `Content-Type`.
 *
 * Se mira el subtipo con sufijo (`application/problem+json`,
 * `application/atom+xml`) porque es lo que devuelven de verdad muchas APIs;
 * quedarse en `application/json` dejaría sin resaltar la mitad de los casos.
 */
export function lenguajeDesdeTipoDeContenido(tipo: string | null | undefined): LenguajeDeEditor {
  const valor = (tipo ?? '').toLowerCase();
  if (valor.length === 0) return 'texto';
  const sinParametros = valor.split(';')[0]?.trim() ?? '';
  if (sinParametros.includes('json')) return 'json';
  if (sinParametros.includes('html')) return 'html';
  if (sinParametros.includes('xml')) return 'xml';
  return 'texto';
}

/** Adivina el lenguaje por el propio texto cuando no hay `Content-Type`. */
export function lenguajeDesdeContenido(texto: string): LenguajeDeEditor {
  const recortado = texto.trim();
  if (recortado.length === 0) return 'texto';
  const primero = recortado[0];
  if (primero === '{' || primero === '[') return 'json';
  if (recortado.startsWith('<?xml')) return 'xml';
  if (primero === '<') return 'html';
  return 'texto';
}

export interface TextoFormateado {
  readonly texto: string;
  /** `false` si no se pudo formatear: el texto vuelve tal cual, sin tocar. */
  readonly formateado: boolean;
}

/**
 * Reindenta JSON. Si el texto no es JSON válido **se devuelve intacto**: la
 * pestaña «Pretty» de una respuesta rota tiene que seguir enseñando lo que
 * mandó el servidor, no un error en lugar del cuerpo.
 */
export function formatearJson(texto: string, sangria = 2): TextoFormateado {
  const recortado = texto.trim();
  if (recortado.length === 0) return { texto, formateado: false };
  try {
    return { texto: JSON.stringify(JSON.parse(recortado), null, sangria), formateado: true };
  } catch {
    return { texto, formateado: false };
  }
}

/**
 * Embellece según el lenguaje.
 *
 * HUECO: XML y HTML se devuelven tal cual — creo que pertenece a una
 * dependencia de formato (`prettier` o similar) que hoy NO está instalada en
 * `apps/web` y que yo no puedo añadir. Sólo JSON se reindenta.
 */
export function embellecer(texto: string, lenguaje: LenguajeDeEditor): TextoFormateado {
  if (lenguaje === 'json') return formatearJson(texto);
  return { texto, formateado: false };
}

// ---------------------------------------------------------------------------
// Resaltado de sintaxis con tokens CEIBA
// ---------------------------------------------------------------------------

type EspecificacionDeEtiqueta = Parameters<typeof HighlightStyle.define>[0][number];

/**
 * Colores de los tokens de sintaxis, **en el orden de
 * `defaultHighlightStyle`** de `@codemirror/language` 6.13.1.
 *
 * POR QUÉ ASÍ Y NO CON `tags` DE `@lezer/highlight`: ese paquete NO es una
 * dependencia declarada de `apps/web` (sólo llega como dependencia transitiva
 * dentro del almacén de pnpm), así que importarlo sería una dependencia
 * fantasma y yo no puedo tocar `package.json`. Reutilizando las etiquetas que
 * ya trae `defaultHighlightStyle.specs` se consigue lo mismo cambiando
 * únicamente el color, y aquí no se escribe ni un hexadecimal: todo sale de
 * `packages/brand/src/tokens.css`.
 *
 * `null` = la entrada de origen no tiene color (sólo negrita/cursiva/subrayado)
 * y se deja exactamente como está.
 */
const COLORES_DE_RESALTADO: readonly (string | null)[] = [
  'var(--ceiba-text-faint)', //  0 meta
  null, //  1 link
  null, //  2 heading
  null, //  3 emphasis
  null, //  4 strong
  null, //  5 strikethrough
  'var(--ceiba-method-patch)', //  6 keyword
  'var(--ceiba-info)', //  7 atom, bool, url, contentSeparator, labelName
  'var(--ceiba-method-put)', //  8 literal, inserted  (números)
  'var(--ceiba-accent)', //  9 string, deleted
  'var(--ceiba-danger)', // 10 regexp, escape, special(string)
  'var(--ceiba-info)', // 11 definition(variableName)
  'var(--ceiba-text)', // 12 local(variableName)
  'var(--ceiba-success)', // 13 typeName, namespace
  'var(--ceiba-info)', // 14 className
  'var(--ceiba-method-head)', // 15 special(variableName), macroName
  'var(--ceiba-accent-strong)', // 16 definition(propertyName)
  'var(--ceiba-text-faint)', // 17 comment
  'var(--ceiba-danger)', // 18 invalid
];

/**
 * Si una versión futura de `@codemirror/language` cambia su lista, el número
 * de entradas deja de cuadrar y se vuelve al resaltado de la librería en vez
 * de repartir colores al azar. Falla hacia «feo pero correcto».
 */
function construirResaltado(): Extension {
  const origen = defaultHighlightStyle.specs;
  if (origen.length !== COLORES_DE_RESALTADO.length) {
    return syntaxHighlighting(defaultHighlightStyle, { fallback: true });
  }
  const propias: EspecificacionDeEtiqueta[] = origen.map((especificacion, indice) => {
    const color = COLORES_DE_RESALTADO[indice];
    if (color === undefined || color === null) return especificacion;
    return { ...especificacion, color };
  });
  return syntaxHighlighting(HighlightStyle.define(propias), { fallback: true });
}

function extensionDeLenguaje(lenguaje: LenguajeDeEditor): Extension {
  switch (lenguaje) {
    case 'json':
      return json();
    case 'html':
      return html();
    case 'xml':
      return xml();
    case 'texto':
      return [];
  }
}

// ---------------------------------------------------------------------------
// Composable
// ---------------------------------------------------------------------------

export interface OpcionesDeEditorDeCodigo {
  /** Elemento donde se monta la vista. */
  readonly contenedor: Ref<HTMLElement | null>;
  /** Contenido actual. Se vigila: si cambia fuera, el editor se actualiza. */
  readonly contenido: () => string;
  readonly lenguaje?: () => LenguajeDeEditor;
  readonly soloLectura?: () => boolean;
  /** Ajuste de línea. Fijo al crear: cambiarlo en caliente no hace falta. */
  readonly envolver?: boolean;
  /** Se llama en cada edición del usuario, nunca en los cambios programados. */
  readonly alCambiar?: (texto: string) => void;
}

export interface EditorDeCodigo {
  readonly vista: ShallowRef<EditorView | null>;
  /**
   * Motivo por el que no hay editor, si la creación falló. El componente
   * enseña el texto en crudo en ese caso: mejor degradado que en blanco.
   */
  readonly fallo: Ref<string | null>;
  enfocar: () => void;
  texto: () => string;
}

export function usarEditorDeCodigo(opciones: OpcionesDeEditorDeCodigo): EditorDeCodigo {
  const vista = shallowRef<EditorView | null>(null);
  const fallo = ref<string | null>(null);

  const compartimentoDeLenguaje = new Compartment();
  const compartimentoDeLectura = new Compartment();

  const lenguajeActual = (): LenguajeDeEditor => opciones.lenguaje?.() ?? 'texto';
  const esSoloLectura = (): boolean => opciones.soloLectura?.() ?? false;

  function extensionesDeLectura(soloLectura: boolean): Extension {
    return [EditorState.readOnly.of(soloLectura), EditorView.editable.of(!soloLectura)];
  }

  function crear(): void {
    const elemento = opciones.contenedor.value;
    if (elemento === null || vista.value !== null) return;

    const extensiones: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      construirResaltado(),
      bracketMatching(),
      rectangularSelection(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      search({ top: true }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...foldKeymap, indentWithTab]),
      compartimentoDeLenguaje.of(extensionDeLenguaje(lenguajeActual())),
      compartimentoDeLectura.of(extensionesDeLectura(esSoloLectura())),
      EditorView.updateListener.of((actualizacion) => {
        if (!actualizacion.docChanged) return;
        // `alCambiar` sólo debe disparar con edición real del usuario: si se
        // llamara también con los cambios programados, el `watch` de contenido
        // y este escuchador se realimentarían.
        const deUsuario = actualizacion.transactions.some((t) => t.isUserEvent('input') || t.isUserEvent('delete') || t.isUserEvent('move') || t.isUserEvent('undo') || t.isUserEvent('redo'));
        if (deUsuario) opciones.alCambiar?.(actualizacion.state.doc.toString());
      }),
    ];
    if (opciones.envolver === true) extensiones.push(EditorView.lineWrapping);

    try {
      vista.value = new EditorView({
        state: EditorState.create({ doc: opciones.contenido(), extensions: extensiones }),
        parent: elemento,
      });
      fallo.value = null;
    } catch (error) {
      vista.value = null;
      fallo.value =
        error instanceof Error
          ? `No se pudo iniciar el editor de código: ${error.message}`
          : 'No se pudo iniciar el editor de código.';
    }
  }

  function destruir(): void {
    vista.value?.destroy();
    vista.value = null;
  }

  onMounted(crear);
  onBeforeUnmount(destruir);

  // El contenedor puede aparecer después (está detrás de un `v-if` o de una
  // pestaña), así que no basta con `onMounted`.
  watch(opciones.contenedor, (elemento) => {
    if (elemento === null) {
      destruir();
    } else if (vista.value === null) {
      crear();
    }
  });

  watch(opciones.contenido, (nuevo) => {
    const actual = vista.value;
    if (actual === null) return;
    if (actual.state.doc.toString() === nuevo) return;
    actual.dispatch({ changes: { from: 0, to: actual.state.doc.length, insert: nuevo } });
  });

  watch(
    () => lenguajeActual(),
    (lenguaje) => {
      vista.value?.dispatch({
        effects: compartimentoDeLenguaje.reconfigure(extensionDeLenguaje(lenguaje)),
      });
    },
  );

  watch(
    () => esSoloLectura(),
    (soloLectura) => {
      vista.value?.dispatch({
        effects: compartimentoDeLectura.reconfigure(extensionesDeLectura(soloLectura)),
      });
    },
  );

  return {
    vista,
    fallo,
    enfocar: () => vista.value?.focus(),
    texto: () => vista.value?.state.doc.toString() ?? opciones.contenido(),
  };
}
