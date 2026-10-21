import { ref, watch, type Ref } from 'vue';
import { peticionApi } from '@/api/cliente';
import { ErrorDeApi, ErrorDeHueco, mensajeDeError } from '@/api/errores';

/**
 * Variables disponibles para autocompletar dentro de una colección
 * (`BRIEF-FASE7.md` §2.3, `GET /collections/:collectionId/variables`).
 *
 * POR QUÉ ESTE FICHERO SE ESCRIBE CONTRA UN CONTRATO Y NO CONTRA EL CÓDIGO
 * ------------------------------------------------------------------------
 * Igual que `api/peticiones.ts` en la fase 6: la ruta la está implementando el
 * ámbito B **ahora mismo**. El brief fija el contrato precisamente para que los
 * dos ámbitos avancen sin esperarse, así que aquí se transcribe el §2.3 tal
 * cual, se normaliza a la defensiva y las pruebas lo ejercitan con un doble de
 * `fetch`. Mientras la ruta no exista, el widget **se degrada en silencio**
 * (`disponible = false`): un cartel rojo permanente en un campo de texto por un
 * hueco conocido del contrato sería ruido, no información.
 *
 * TODA LLAMADA PASA POR `peticionApi` (`api/cliente.ts`), que es quien resuelve
 * la cookie `HttpOnly` de sesión (C-31) y el testigo CSRF. Aquí **no se hace
 * `fetch` directo**: hacerlo sería saltarse las tres reglas que esa capa existe
 * para imponer.
 *
 * LA FRONTERA DE SECRETOS SE DEFIENDE TAMBIÉN AQUÍ
 * ------------------------------------------------
 * El §2.3 dice que `preview` es `null` cuando `isSecret`. Esta capa **no se fía
 * del servidor**: si llega un `preview` con valor junto a `isSecret: true`, se
 * descarta. No es desconfianza gratuita — es que el único sitio donde ese valor
 * se acabaría pintando es esta lista, y una lista de autocompletado no es una
 * puerta trasera para leer secretos. Si el servidor se equivoca, el fallo se
 * queda en el servidor y no llega a la pantalla.
 */

/** Una variable tal y como la pinta el autocompletado. */
export interface VariableDeColeccion {
  /** Sin llaves: `base_url`, igual que `environment_variables.key`. */
  readonly key: string;
  readonly scope: 'collection' | 'workspace';
  readonly environmentId: string | null;
  readonly environmentName: string | null;
  readonly isSecret: boolean;
  readonly isEnabled: boolean;
  readonly valueKind: string | null;
  /** **Siempre `null` si `isSecret`.** Lo impone esta capa, no el servidor. */
  readonly preview: string | null;
  /** `true` si otra variable de mayor precedencia gana sobre ésta. */
  readonly shadowed: boolean;
}

// ---------------------------------------------------------------------------
// Normalización defensiva, al estilo de `api/peticiones.ts`
// ---------------------------------------------------------------------------

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/**
 * Claves con las que un servidor razonable envolvería la lista.
 *
 * El §2.3 enseña `{ items: [...] }`, pero el envoltorio no está fijado en
 * ningún sitio ejecutable y el resto del módulo `studio` usa envoltorios en
 * castellano. Tolerar las cuatro cuesta diez líneas y elimina el riesgo de que
 * el widget salga mudo por una diferencia de nombre.
 */
const CLAVES_DE_LISTA = ['items', 'variables', 'datos', 'data'] as const;

export function desenvolverVariables(cuerpo: unknown): unknown[] {
  if (Array.isArray(cuerpo)) return cuerpo;
  if (!esObjeto(cuerpo)) return [];
  for (const clave of CLAVES_DE_LISTA) {
    const valor = cuerpo[clave];
    if (Array.isArray(valor)) return valor;
  }
  return [];
}

function textoONulo(valor: unknown): string | null {
  return typeof valor === 'string' && valor.length > 0 ? valor : null;
}

/** `scope` sólo tiene dos valores; cualquier otra cosa es del workspace. */
function normalizarAmbito(valor: unknown): 'collection' | 'workspace' {
  return valor === 'collection' ? 'collection' : 'workspace';
}

/**
 * Convierte lo que venga en una `VariableDeColeccion`, o `null` si no tiene
 * `key`: una variable sin nombre no se puede insertar ni mostrar.
 */
export function normalizarVariable(crudo: unknown): VariableDeColeccion | null {
  if (!esObjeto(crudo)) return null;
  const key = typeof crudo.key === 'string' ? crudo.key.trim() : '';
  if (key.length === 0) return null;

  const isSecret = crudo.isSecret === true;
  const entorno = crudo.environment;

  return {
    key,
    scope: normalizarAmbito(crudo.scope),
    environmentId:
      textoONulo(crudo.environmentId) ??
      (esObjeto(entorno) ? textoONulo(entorno.id) : null),
    environmentName:
      textoONulo(crudo.environmentName) ??
      (esObjeto(entorno) ? textoONulo(entorno.name) : null),
    isSecret,
    // Ausente se interpreta como activa: una variable guardada sin la marca es
    // una variable que cuenta. Desactivarla por omisión la escondería.
    isEnabled: crudo.isEnabled === undefined ? true : crudo.isEnabled === true,
    valueKind: textoONulo(crudo.valueKind),
    // LA FRONTERA: si es secreta, `preview` es null pase lo que pase.
    preview: isSecret ? null : textoONulo(crudo.preview),
    shadowed: crudo.shadowed === true,
  };
}

/**
 * Orden estable: primero las que ganan, después las eclipsadas, y dentro de
 * cada grupo por nombre.
 *
 * Las eclipsadas **no se omiten** (§2.3: «el usuario tiene derecho a saber que
 * existe»), pero tampoco pueden competir por el primer puesto de la lista: la
 * que se inserta al pulsar `Enter` sin mirar tiene que ser la que de verdad va
 * a resolverse.
 */
export function ordenarVariables(
  lista: readonly VariableDeColeccion[],
): VariableDeColeccion[] {
  return [...lista].sort((a, b) => {
    if (a.shadowed !== b.shadowed) return a.shadowed ? 1 : -1;
    return a.key.localeCompare(b.key, 'es');
  });
}

// ---------------------------------------------------------------------------
// Llamada
// ---------------------------------------------------------------------------

export function rutaDeVariables(collectionId: string): string {
  return `/collections/${encodeURIComponent(collectionId)}/variables`;
}

/** `GET /collections/:collectionId/variables` del §2.3, ya normalizado. */
export async function listarVariablesDeColeccion(
  collectionId: string,
): Promise<VariableDeColeccion[]> {
  const cuerpo = await peticionApi<unknown>(rutaDeVariables(collectionId));
  const normalizadas: VariableDeColeccion[] = [];
  for (const crudo of desenvolverVariables(cuerpo)) {
    const variable = normalizarVariable(crudo);
    if (variable !== null) normalizadas.push(variable);
  }
  return ordenarVariables(normalizadas);
}

// ---------------------------------------------------------------------------
// Estado reactivo
// ---------------------------------------------------------------------------

/**
 * Estados que significan «esta ruta todavía no existe», no «ha fallado».
 *
 * MATIZ DECLARADO: el §2.3 también usa 404 para «no tienes rol en ese
 * workspace», así que un 404 de autorización se verá aquí como hueco y el
 * widget callará en vez de avisar. Es la lectura menos dañina de las dos — un
 * campo de texto que grita «403» mientras escribes es peor que una lista que no
 * aparece — pero es una ambigüedad del contrato, no una decisión limpia. El 403
 * explícito sí se muestra como error.
 */
const ESTADOS_DE_HUECO: ReadonlySet<number> = new Set([404, 501]);

function esHuecoDelContrato(error: unknown): boolean {
  if (error instanceof ErrorDeHueco) return true;
  return error instanceof ErrorDeApi && ESTADOS_DE_HUECO.has(error.estado);
}

export interface EstadoDeVariables {
  readonly variables: Readonly<Ref<VariableDeColeccion[]>>;
  readonly cargando: Readonly<Ref<boolean>>;
  readonly error: Readonly<Ref<string | null>>;
  /** `false` cuando el endpoint aún no existe: se degrada en silencio. */
  readonly disponible: Readonly<Ref<boolean>>;
  recargar(): Promise<void>;
}

/**
 * Observa el identificador de colección y mantiene su lista de variables.
 *
 * `collectionId` es un **getter** y no un `Ref` a propósito: el constructor lo
 * saca de la petición cargada, que puede no existir todavía. Mientras devuelva
 * `undefined` la lista queda vacía y **no se llama a la API**: pedir
 * `/collections/undefined/variables` sería fabricar un identificador, que es
 * justo lo que el §3.C.4 prohíbe.
 */
export function usarVariablesDeColeccion(
  collectionId: () => string | undefined,
): EstadoDeVariables {
  const variables = ref<VariableDeColeccion[]>([]);
  const cargando = ref(false);
  const error = ref<string | null>(null);
  const disponible = ref(true);

  /**
   * Contador de generación: si el usuario cambia de petición mientras una
   * respuesta está en vuelo, la vieja no puede pisar a la nueva. Sin esto, la
   * lista de la colección anterior acaba sugiriendo variables que no existen
   * aquí, que es peor que no sugerir nada.
   */
  let generacion = 0;

  async function cargar(id: string | undefined): Promise<void> {
    const mia = ++generacion;
    const limpio = (id ?? '').trim();

    if (limpio.length === 0) {
      variables.value = [];
      cargando.value = false;
      error.value = null;
      return;
    }

    cargando.value = true;
    error.value = null;

    try {
      const lista = await listarVariablesDeColeccion(limpio);
      if (mia !== generacion) return;
      variables.value = lista;
      disponible.value = true;
    } catch (fallo) {
      if (mia !== generacion) return;
      variables.value = [];
      if (esHuecoDelContrato(fallo)) {
        disponible.value = false;
        error.value = null;
      } else {
        disponible.value = true;
        error.value = mensajeDeError(fallo);
      }
    } finally {
      if (mia === generacion) cargando.value = false;
    }
  }

  watch(collectionId, (id) => void cargar(id), { immediate: true });

  return {
    variables,
    cargando,
    error,
    disponible,
    recargar: () => cargar(collectionId()),
  };
}
