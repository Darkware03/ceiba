import { BASE_API, peticionApi } from './cliente';
import { NOMBRE_CABECERA_CSRF, testigoCsrfActual } from './csrf';
import { ErrorDeApi, ErrorDeRed } from './errores';

/**
 * Familia «Peticiones» (`api_requests`), transcrita del contrato **vinculante**
 * del `BRIEF-FASE6.md` §1.
 *
 * POR QUÉ ESTE FICHERO SE ESCRIBE CONTRA UN CONTRATO Y NO CONTRA EL CÓDIGO
 * ------------------------------------------------------------------------
 * Comprobado al escribir esto: las siete rutas **no existen todavía** en
 * `apps/api/src` — el `backend-engineer` las está implementando en paralelo.
 * El brief fija el contrato precisamente para que los dos ámbitos avancen sin
 * esperarse, así que aquí se transcribe el §1 tal cual y las pruebas lo
 * ejercitan con un doble de `fetch`. En cuanto la API esté arriba, esto debería
 * funcionar sin tocar una línea; si no lo hace, la discrepancia está acotada a
 * este fichero.
 *
 * Toda llamada pasa por `peticionApi` (`api/cliente.ts`), que es quien resuelve
 * la cookie `HttpOnly` de sesión (C-31) y el testigo CSRF de las mutantes. Aquí
 * **no se hace `fetch` directo**: hacerlo sería saltarse las tres reglas que esa
 * capa existe para imponer.
 *
 * LA ASIMETRÍA DE RUTAS, igual que en colecciones y por el mismo motivo (§19):
 *
 *   listar y crear          -> /collections/:collectionId/requests
 *   leer/editar/borrar/…    -> /requests/:requestId
 *
 * El servidor resuelve la petición -> colección -> workspace **antes** de
 * autorizar, para que conocer un identificador no baste.
 */

// ---------------------------------------------------------------------------
// Vocabulario, leído del esquema REAL ya aplicado en PostgreSQL
// ---------------------------------------------------------------------------

/**
 * `http_method`, literal de
 * `prisma/migrations/20261014193000_ceiba_initial_schema/migration.sql:32`.
 *
 * Son nueve, no siete: el enum de la base incluye `TRACE` y `CUSTOM`, que el
 * contrato del motor (`ALLOWED_METHODS`) **no** admite ejecutar. Se declaran
 * aquí porque una fila guardada puede tenerlos y la interfaz debe saber
 * leerlos; lo que no puede es fingir que los sabe ejecutar (ver
 * `esEjecutableEnElConstructor`).
 */
export const METODOS_DE_PETICION = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'TRACE',
  'CUSTOM',
] as const;

export type MetodoDePeticion = (typeof METODOS_DE_PETICION)[number];

/**
 * `body_mode` **contado por mí en `prisma/schema/01-enums.prisma`** el
 * 2026-10-21: son **diez**, no ocho.
 *
 * HISTORIA DE ESTA CONSTANTE, porque importa. En la fase 6 este fichero
 * declaraba ocho «tal y como lo enumera el `BRIEF-FASE6` §1» y marcaba
 * `binary_file` y `custom` como sólo-lectura «porque esta interfaz no sabe
 * componer su cuerpo». En la fase 7 ya sabe componer `binary_file` (P5), así
 * que se mueve a los guardables. `custom` se queda fuera **a conciencia**: no
 * tiene forma definida en el esquema y ofrecer un modo sin forma es un control
 * que miente.
 *
 * HUECO DEL SERVIDOR, MEDIDO: el DTO de la API
 * (`apps/api/src/modules/request/dto/request.dto.ts`) aún enumera ocho y
 * rechaza `binary_file` con 422. El §2.1 del `BRIEF-FASE7` dice que debe
 * aceptar «los 10 del enum»; mientras el ámbito A no lo cambie, guardar un
 * cuerpo binario fallará con 422 y la interfaz lo dirá tal cual.
 */
export const MODOS_DE_CUERPO_GUARDADO = [
  'none',
  'raw_json',
  'raw_text',
  'raw_xml',
  'raw_html',
  'graphql',
  'form_urlencoded',
  'multipart_form_data',
  'binary_file',
] as const;

export type ModoDeCuerpoGuardado = (typeof MODOS_DE_CUERPO_GUARDADO)[number];

/** El del enum de la base que esta interfaz lee pero no ofrece. */
export const MODOS_DE_CUERPO_SOLO_LECTURA = ['custom'] as const;

/** Los diez de `body_mode`. Contados en `01-enums.prisma`, no copiados. */
export const MODOS_DE_CUERPO_DEL_ESQUEMA = [
  ...MODOS_DE_CUERPO_GUARDADO,
  ...MODOS_DE_CUERPO_SOLO_LECTURA,
] as const;

/** Etiqueta legible de cada modo de cuerpo. */
export const ETIQUETA_DE_MODO: Readonly<Record<string, string>> = Object.freeze({
  none: 'Sin cuerpo',
  raw_json: 'JSON',
  raw_text: 'Texto plano',
  raw_xml: 'XML',
  raw_html: 'HTML',
  graphql: 'GraphQL',
  form_urlencoded: 'Formulario (urlencoded)',
  multipart_form_data: 'Formulario (multipart)',
  binary_file: 'Fichero binario',
  custom: 'Personalizado',
});

/**
 * Par clave/valor del contrato del §1: `{ key, value, enabled }`.
 *
 * Ojo: **no** es el `Par` del constructor (`api/ejecucion.ts`), que usa
 * `{ id, nombre, valor, activo }`. Son dos vocabularios distintos a propósito —
 * uno es el del servidor y otro el de la interfaz— y la traducción entre ambos
 * está en un solo sitio: `stores/constructor.ts#cargarDesdePeticionGuardada`.
 */
export interface ParGuardado {
  readonly key: string;
  readonly value: string;
  readonly enabled: boolean;
  /**
   * El servidor marca así las cabeceras y parámetros secretos y **manda
   * `value: null`**: «el valor de un secreto NO sale: ni en claro, ni cifrado,
   * ni enmascarado» (`request.service.ts`, leído de su DTO real).
   *
   * La marca se conserva porque la ausencia de valor hay que **decirla**. Si
   * se tratara como una cadena vacía sin más, el constructor abriría la
   * petición con un `Authorization:` vacío y el envío fallaría con un 401 que
   * el usuario no sabría explicar.
   */
  readonly secret?: boolean;
}

/**
 * Campo de un cuerpo de formulario, §2.1 del `BRIEF-FASE7`.
 *
 * `kind: 'file'` exige `fileId`; `kind: 'text'` exige `value`. **Nunca los
 * dos**: lo impone `ck_bodyfield_xor` en la base y se respeta también aquí
 * para que un 500 del CHECK sea imposible desde esta interfaz.
 */
export interface CampoDeCuerpoGuardado {
  readonly key: string;
  readonly kind: 'text' | 'file';
  readonly value?: string;
  readonly fileId?: string | null;
  readonly contentType?: string | null;
  readonly enabled: boolean;
  /** El servidor lo marca cuando el valor vive en `secret_id`. Nunca manda el valor. */
  readonly secret?: boolean;
}

/**
 * Fichero referenciado por un cuerpo. **Metadatos, nunca bytes** (§2.2).
 */
export interface FicheroGuardado {
  readonly id: string;
  readonly fileName: string;
  readonly contentType: string | null;
  readonly sizeBytes: number | null;
  readonly checksumSha256?: string | null;
  readonly purpose?: string | null;
}

/** Una petición guardada, en la forma que devuelve la API. */
export interface Peticion {
  readonly id: string;
  readonly collectionId: string;
  /** `null` = raíz de la colección. */
  readonly folderId: string | null;
  /** Nombre de la carpeta si el servidor lo envía; si no, se muestra el id. */
  readonly folderName: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly method: MetodoDePeticion;
  readonly methodCustom: string | null;
  /** `url_template`: **nunca** resuelta. Las `{{var}}` viajan tal cual. */
  readonly url: string;
  readonly headers: readonly ParGuardado[];
  readonly queryParams: readonly ParGuardado[];
  readonly bodyType: string;
  readonly body: string | null;
  /** §2.1: sólo en `form_urlencoded` y `multipart_form_data`. */
  readonly bodyFields: readonly CampoDeCuerpoGuardado[];
  /** §2.1: sólo en `binary_file`. */
  readonly binaryFile: FicheroGuardado | null;
  readonly sortKey: string | null;
  /**
   * `api_requests.lock_version`. Bloqueo optimista del esquema
   * (`03-organization.prisma`), y la pieza con la que el autoguardado detecta
   * que **otro** ha escrito encima.
   *
   * `null` cuando el servidor no lo manda; entonces la detección de conflicto
   * no es posible y la interfaz lo dice en vez de fingir que vigila.
   */
  readonly lockVersion: number | null;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface EntradaCrearPeticion {
  readonly name: string;
  readonly method: MetodoDePeticion;
  readonly methodCustom?: string | null;
  readonly url: string;
  readonly folderId?: string | null;
  readonly description?: string | null;
  readonly headers?: readonly ParGuardado[];
  readonly queryParams?: readonly ParGuardado[];
  readonly bodyType?: string;
  readonly body?: string | null;
  readonly bodyContentType?: string | null;
  readonly bodyFields?: readonly CampoDeCuerpoGuardado[];
  readonly binaryFileId?: string | null;
  readonly sortKey?: string | null;
}

export type EntradaActualizarPeticion = Partial<EntradaCrearPeticion> & {
  /**
   * Versión que el cliente cree estar editando. Viaja para que el servidor
   * pueda rechazar una escritura sobre una fila ya cambiada.
   *
   * HUECO MEDIDO HOY: `request.repository.ts:367` hace
   * `lockVersion: { increment: 1 }` **sin** condición `WHERE lock_version = ?`,
   * o sea que el servidor NO comprueba nada todavía y el último que escribe
   * gana. El campo se manda igualmente (Zod lo descarta sin error) para que el
   * día que el ámbito A lo implemente no haya que tocar el cliente. Mientras
   * tanto la detección se hace **a posteriori**, comparando la versión
   * devuelta con la esperada: ver `stores/constructor.ts`.
   */
  readonly lockVersion?: number | null;
};

/**
 * Respuesta de `GET /requests/:requestId/curl`, la **única** salida cuya forma
 * fija el §1 literalmente: `{ "curl": "curl --request GET …", "advertencias": [] }`.
 */
export interface ComandoCurl {
  readonly curl: string;
  readonly advertencias: readonly string[];
}

// ---------------------------------------------------------------------------
// Validación, copiada de las reglas del esquema
// ---------------------------------------------------------------------------

export const LONGITUD_MAXIMA_NOMBRE_PETICION = 160;
export const LONGITUD_MAXIMA_DESCRIPCION_PETICION = 4000;

/** Métodos que el motor sabe ejecutar (`ALLOWED_METHODS` del contrato v1). */
const EJECUTABLES: ReadonlySet<string> = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
]);

/**
 * ¿El constructor puede ejecutar este método?
 *
 * `TRACE` y `CUSTOM` se pueden **guardar** (el enum de la base los admite) pero
 * el motor los rechazaría con `INVALID_REQUEST`. Saberlo antes permite decirlo
 * en pantalla en vez de dejar al usuario con un error incomprensible.
 */
export function esEjecutableEnElConstructor(metodo: string): boolean {
  return EJECUTABLES.has(metodo.toUpperCase());
}

/** Verbo que se muestra: el `methodCustom` si el método es `CUSTOM`. */
export function verboVisible(peticion: {
  method: string;
  methodCustom?: string | null;
}): string {
  if (peticion.method === 'CUSTOM') {
    const propio = (peticion.methodCustom ?? '').trim();
    return propio.length > 0 ? propio.toUpperCase() : 'CUSTOM';
  }
  return peticion.method;
}

export function errorDeNombreDePeticion(nombre: string): string | null {
  const limpio = nombre.trim();
  if (limpio.length === 0) return 'El nombre es obligatorio.';
  if (limpio.length > LONGITUD_MAXIMA_NOMBRE_PETICION) {
    return `El nombre no puede superar ${LONGITUD_MAXIMA_NOMBRE_PETICION} caracteres.`;
  }
  return null;
}

/**
 * La URL se valida con una regla deliberadamente laxa.
 *
 * `url_template` **no se guarda resuelta**: `{{base_url}}/v1/clientes` es una
 * plantilla perfectamente válida y `new URL()` la rechazaría. Exigir una URL
 * absoluta aquí haría imposible el caso normal del producto.
 */
export function errorDeUrlDePeticion(url: string): string | null {
  const limpio = url.trim();
  if (limpio.length === 0) return 'La URL es obligatoria.';
  if (/\s/u.test(limpio)) return 'La URL no puede contener espacios.';
  return null;
}

/** `ck_request_custom_verb`: `(method = 'CUSTOM') = (method_custom IS NOT NULL)`. */
export function errorDeVerboPropio(metodo: string, propio: string): string | null {
  if (metodo !== 'CUSTOM') return null;
  const limpio = propio.trim();
  if (limpio.length === 0) return 'Con el método CUSTOM hay que escribir el verbo.';
  if (!/^[A-Za-z][A-Za-z0-9-]*$/u.test(limpio)) {
    return 'El verbo admite letras, dígitos y guiones, y empieza por letra.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Normalización de la respuesta
// ---------------------------------------------------------------------------

/**
 * EL ENVOLTORIO NO ESTÁ FIJADO POR EL CONTRATO, Y ESO HAY QUE ABSORBERLO AQUÍ.
 *
 * El `BRIEF-FASE6` §1 fija las rutas y el cuerpo de **entrada**, y fija la
 * salida **sólo** de `/curl`. No dice si una petición viaja como `{ peticion }`
 * (que es lo coherente con `{ coleccion }` del módulo `collection`) o como
 * `{ request }`. Como el backend se está escribiendo ahora mismo, elegir una e
 * ignorar la otra significa jugarse la vista a cara o cruz: si falla, la
 * colección vuelve a quedar muerta, que es exactamente el fallo que el cliente
 * ha reportado.
 *
 * Así que se toleran las dos, y además el array desnudo. Son veinte líneas y
 * eliminan el riesgo entero.
 */
function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** Claves con las que un servidor razonable envolvería **una** petición. */
const CLAVES_DE_UNA = ['peticion', 'request', 'item', 'dato'] as const;
/** Claves con las que envolvería **la lista**. */
const CLAVES_DE_LISTA = ['peticiones', 'requests', 'items', 'datos'] as const;

export function desenvolverUno(cuerpo: unknown): unknown {
  if (!esObjeto(cuerpo)) return cuerpo;
  for (const clave of CLAVES_DE_UNA) {
    const valor = cuerpo[clave];
    if (esObjeto(valor)) return valor;
  }
  // Sin envoltorio reconocible: puede ser la propia petición desnuda.
  return cuerpo;
}

export function desenvolverLista(cuerpo: unknown): unknown[] {
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

function normalizarMetodo(valor: unknown): MetodoDePeticion {
  if (typeof valor !== 'string') return 'GET';
  const mayusculas = valor.toUpperCase();
  return (METODOS_DE_PETICION as readonly string[]).includes(mayusculas)
    ? (mayusculas as MetodoDePeticion)
    : 'GET';
}

/**
 * Modo de cuerpo. Se admiten los diez del enum de la base, no sólo los ocho
 * seleccionables: una fila con `binary_file` existe y la lista tiene que
 * poder pintarla.
 */
export function normalizarModoDeCuerpo(valor: unknown): string {
  if (typeof valor !== 'string') return 'none';
  const conocidos: readonly string[] = MODOS_DE_CUERPO_DEL_ESQUEMA;
  return conocidos.includes(valor) ? valor : 'none';
}

/** Metadatos de un fichero. Si no hay `id` utilizable, no hay fichero. */
export function normalizarFichero(valor: unknown): FicheroGuardado | null {
  if (!esObjeto(valor)) return null;
  const id = typeof valor.id === 'string' ? valor.id : '';
  if (id.length === 0) return null;
  const tam = valor.sizeBytes;
  return {
    id,
    fileName: typeof valor.fileName === 'string' ? valor.fileName : 'fichero',
    contentType: textoONulo(valor.contentType),
    sizeBytes: typeof tam === 'number' && Number.isFinite(tam) ? tam : null,
    checksumSha256: textoONulo(valor.checksumSha256),
    purpose: textoONulo(valor.purpose),
  };
}

/**
 * Campos del cuerpo. El XOR del esquema se aplica **también al leer**: si el
 * servidor mandase las dos fuentes, manda `kind`. Dejar pasar las dos
 * produciría una fila que al reguardarla violaría `ck_bodyfield_xor` con un
 * 500 que el usuario no podría explicar.
 */
export function normalizarCamposDeCuerpo(valor: unknown): CampoDeCuerpoGuardado[] {
  if (!Array.isArray(valor)) return [];
  const campos: CampoDeCuerpoGuardado[] = [];
  for (const crudo of valor) {
    if (!esObjeto(crudo)) continue;
    const key = typeof crudo.key === 'string' ? crudo.key : null;
    if (key === null) continue;
    const fileId = textoONulo(crudo.fileId);
    const kind: 'text' | 'file' =
      crudo.kind === 'file' || (crudo.kind === undefined && fileId !== null) ? 'file' : 'text';
    campos.push({
      key,
      kind,
      ...(kind === 'file'
        ? { fileId }
        : { value: typeof crudo.value === 'string' ? crudo.value : '' }),
      contentType: textoONulo(crudo.contentType),
      enabled: crudo.enabled === undefined ? true : crudo.enabled === true,
      secret: crudo.secret === true,
    });
  }
  return campos;
}

function normalizarPares(valor: unknown): ParGuardado[] {
  if (!Array.isArray(valor)) return [];
  const pares: ParGuardado[] = [];
  for (const crudo of valor) {
    if (!esObjeto(crudo)) continue;
    const key = typeof crudo.key === 'string' ? crudo.key : null;
    if (key === null) continue;
    pares.push({
      key,
      // Un secreto llega con `value: null`. Queda en cadena vacía **y
      // marcado**, nunca con un relleno inventado del tipo «••••»: un
      // enmascarado falso acabaría enviándose como si fuese el valor.
      value: typeof crudo.value === 'string' ? crudo.value : '',
      // Ausente se interpreta como activo: un par guardado sin la marca es un
      // par que cuenta. Desactivarlo por omisión perdería datos en silencio.
      enabled: crudo.enabled === undefined ? true : crudo.enabled === true,
      secret: crudo.secret === true,
    });
  }
  return pares;
}

/** Claves de los pares cuyo valor el servidor **no** materializa. */
export function clavesSecretas(peticion: {
  headers: readonly ParGuardado[];
  queryParams: readonly ParGuardado[];
}): string[] {
  return [...peticion.headers, ...peticion.queryParams]
    .filter((par) => par.secret === true)
    .map((par) => par.key);
}

/** Convierte lo que venga en una `Peticion` con todos sus campos presentes. */
export function normalizarPeticion(crudo: unknown, collectionId = ''): Peticion {
  const origen = esObjeto(crudo) ? crudo : {};
  const carpeta = origen.folder;
  return {
    id: typeof origen.id === 'string' ? origen.id : '',
    collectionId:
      typeof origen.collectionId === 'string' ? origen.collectionId : collectionId,
    folderId: textoONulo(origen.folderId),
    folderName:
      textoONulo(origen.folderName) ??
      (esObjeto(carpeta) ? textoONulo(carpeta.name) : null),
    name: typeof origen.name === 'string' ? origen.name : 'Sin nombre',
    description: textoONulo(origen.description),
    method: normalizarMetodo(origen.method),
    methodCustom: textoONulo(origen.methodCustom),
    url: typeof origen.url === 'string' ? origen.url : '',
    headers: normalizarPares(origen.headers),
    queryParams: normalizarPares(origen.queryParams),
    bodyType: normalizarModoDeCuerpo(origen.bodyType),
    body: typeof origen.body === 'string' ? origen.body : null,
    bodyFields: normalizarCamposDeCuerpo(origen.bodyFields),
    binaryFile: normalizarFichero(origen.binaryFile),
    sortKey: textoONulo(origen.sortKey),
    lockVersion:
      typeof origen.lockVersion === 'number' && Number.isFinite(origen.lockVersion)
        ? origen.lockVersion
        : null,
    createdAt: textoONulo(origen.createdAt),
    updatedAt: textoONulo(origen.updatedAt),
  };
}

/**
 * Orden estable de la lista: carpeta, luego `sortKey`, luego nombre.
 *
 * El §1 dice que la lista viene como «árbol: carpeta + orden», pero un orden
 * que depende de que el servidor lo respete siempre es un orden que un día
 * salta. Reordenar aquí cuesta nada y hace la vista determinista, que además
 * es lo que permite que la prueba afirme algo.
 */
export function ordenarPeticiones(lista: readonly Peticion[]): Peticion[] {
  return [...lista].sort((a, b) => {
    const carpetaA = a.folderId ?? '';
    const carpetaB = b.folderId ?? '';
    if (carpetaA !== carpetaB) return carpetaA < carpetaB ? -1 : 1;
    const ordenA = a.sortKey ?? '';
    const ordenB = b.sortKey ?? '';
    if (ordenA !== ordenB) return ordenA < ordenB ? -1 : 1;
    return a.name.localeCompare(b.name, 'es');
  });
}

function normalizarCurl(cuerpo: unknown): ComandoCurl {
  const origen = esObjeto(cuerpo) ? cuerpo : {};
  const advertencias = Array.isArray(origen.advertencias)
    ? origen.advertencias.filter((a): a is string => typeof a === 'string')
    : [];
  return {
    curl: typeof origen.curl === 'string' ? origen.curl : '',
    advertencias,
  };
}

// ---------------------------------------------------------------------------
// Las siete rutas del §1
// ---------------------------------------------------------------------------

const id = (valor: string): string => encodeURIComponent(valor);

/**
 * `GET /collections/:collectionId/requests`.
 *
 * Resuelve además el **nombre** de cada carpeta. El servidor las manda en un
 * array aparte (`carpetas`/`folders`, verificado en su controlador) porque una
 * petición sólo lleva `folderId`. Cruzarlos aquí, una vez, evita que la vista
 * tenga que enterarse de esa forma y que acabe enseñando un UUID donde
 * debería poner «Administración».
 */
export async function listarPeticiones(collectionId: string): Promise<Peticion[]> {
  const cuerpo = await peticionApi<unknown>(`/collections/${id(collectionId)}/requests`);
  const nombres = nombresDeCarpeta(cuerpo);
  const lista = desenvolverLista(cuerpo).map((crudo) =>
    normalizarPeticion(crudo, collectionId),
  );
  return ordenarPeticiones(
    lista.map((peticion) =>
      peticion.folderId !== null && peticion.folderName === null
        ? { ...peticion, folderName: nombres.get(peticion.folderId) ?? null }
        : peticion,
    ),
  );
}

/** `folderId` -> nombre, leyendo el array de carpetas si el servidor lo manda. */
function nombresDeCarpeta(cuerpo: unknown): Map<string, string> {
  const nombres = new Map<string, string>();
  if (!esObjeto(cuerpo)) return nombres;
  const crudas = cuerpo.carpetas ?? cuerpo.folders;
  if (!Array.isArray(crudas)) return nombres;
  for (const carpeta of crudas) {
    if (!esObjeto(carpeta)) continue;
    if (typeof carpeta.id === 'string' && typeof carpeta.name === 'string') {
      nombres.set(carpeta.id, carpeta.name);
    }
  }
  return nombres;
}

/** `POST /collections/:collectionId/requests`. */
export async function crearPeticion(
  collectionId: string,
  entrada: EntradaCrearPeticion,
): Promise<Peticion> {
  const cuerpo = await peticionApi<unknown>(`/collections/${id(collectionId)}/requests`, {
    metodo: 'POST',
    cuerpo: entrada,
  });
  return normalizarPeticion(desenvolverUno(cuerpo), collectionId);
}

/** `GET /requests/:requestId`. */
export async function obtenerPeticion(requestId: string): Promise<Peticion> {
  const cuerpo = await peticionApi<unknown>(`/requests/${id(requestId)}`);
  return normalizarPeticion(desenvolverUno(cuerpo));
}

/** `PATCH /requests/:requestId`. */
export async function actualizarPeticion(
  requestId: string,
  entrada: EntradaActualizarPeticion,
): Promise<Peticion> {
  const cuerpo = await peticionApi<unknown>(`/requests/${id(requestId)}`, {
    metodo: 'PATCH',
    cuerpo: entrada,
  });
  return normalizarPeticion(desenvolverUno(cuerpo));
}

/** `DELETE /requests/:requestId` — borrado lógico, responde 204. */
export function borrarPeticion(requestId: string): Promise<void> {
  return peticionApi<void>(`/requests/${id(requestId)}`, { metodo: 'DELETE' });
}

/** `POST /requests/:requestId/duplicate`. */
export async function duplicarPeticion(requestId: string): Promise<Peticion> {
  const cuerpo = await peticionApi<unknown>(`/requests/${id(requestId)}/duplicate`, {
    metodo: 'POST',
  });
  return normalizarPeticion(desenvolverUno(cuerpo));
}

/**
 * `GET /requests/:requestId/curl` — **el comando lo genera el servidor**.
 *
 * ESTO NO SE HACE EN EL CLIENTE, Y NO ES UNA PREFERENCIA DE ESTILO.
 * El navegador no sabe qué cabecera está marcada como secreta: esa marca vive
 * en el servidor. Un cURL fabricado aquí materializaría el valor de una
 * cabecera `Authorization` en un texto que el usuario va a pegar en un chat o
 * en un ticket. Es `C-LEAK` de `CONTROLES.md` por la puerta de atrás. Por eso
 * esta función **sólo transporta** lo que el servidor decide, incluidas las
 * `advertencias`, que son la forma honesta de decir «esto no se puede
 * representar en cURL» en vez de generar una equivalencia falsa
 * (prompt maestro L479, `BRIEF-FASE6` §2.4).
 */
export async function obtenerCurl(requestId: string): Promise<ComandoCurl> {
  const cuerpo = await peticionApi<unknown>(`/requests/${id(requestId)}/curl`);
  return normalizarCurl(cuerpo);
}

// ---------------------------------------------------------------------------
// Subida de ficheros (§2.2 del BRIEF-FASE7) — P5
// ---------------------------------------------------------------------------

/** Defecto del §2.2: 10 MiB. Se comprueba **también** en el servidor (413). */
export const LIMITE_DE_FICHERO_BYTES = 10 * 1024 * 1024;

/**
 * `POST /workspaces/:workspaceId/files`, `multipart/form-data`, campo `file`.
 *
 * POR QUÉ ESTA ÚNICA FUNCIÓN NO PASA POR `peticionApi`, QUE ES LA REGLA
 * ------------------------------------------------------------------------
 * `peticionApi` serializa el cuerpo con `JSON.stringify` y fija
 * `content-type: application/json`. Una subida multiparte necesita que el
 * navegador ponga él el `Content-Type` **con su `boundary`**, cosa que sólo
 * hace si no se le fija la cabecera y se le pasa un `FormData`. No hay forma
 * de expresar eso con el cliente actual.
 *
 * `api/cliente.ts` **no es de este ámbito** (§3 del `BRIEF-FASE7`), así que no
 * se toca: queda pedido en el informe que se le añada soporte de `FormData` y
 * que esta función se migre. Mientras tanto se replican aquí, explícitamente,
 * las tres reglas que esa capa existe para imponer:
 *   1. `credentials: 'include'` — la sesión va en cookie `HttpOnly` (C-31).
 *   2. testigo CSRF en la cabecera `x-ceiba-csrf`, por ser mutante.
 *   3. nada en `localStorage`.
 * Y los errores se traducen al mismo vocabulario (`ErrorDeApi`/`ErrorDeRed`)
 * para que la interfaz no tenga dos redacciones del mismo fallo.
 */
export async function subirFichero(
  workspaceId: string,
  fichero: File,
  proposito: 'form_field_file' | 'request_body_binary' = 'form_field_file',
): Promise<FicheroGuardado> {
  if (fichero.size > LIMITE_DE_FICHERO_BYTES) {
    // Se corta aquí para no gastar la subida entera y recibir un 413: el
    // servidor vuelve a comprobarlo, esto es sólo cortesía.
    throw new ErrorDeApi(
      413,
      'fichero_demasiado_grande',
      `El fichero supera el límite de ${Math.round(LIMITE_DE_FICHERO_BYTES / (1024 * 1024))} MiB.`,
    );
  }

  const formulario = new FormData();
  formulario.append('file', fichero, fichero.name);
  formulario.append('purpose', proposito);

  const cabeceras: Record<string, string> = { accept: 'application/json' };
  const testigo = testigoCsrfActual();
  if (testigo !== null) cabeceras[NOMBRE_CABECERA_CSRF] = testigo;

  let respuesta: Response;
  try {
    respuesta = await fetch(`${BASE_API}/workspaces/${id(workspaceId)}/files`, {
      method: 'POST',
      credentials: 'include',
      headers: cabeceras,
      body: formulario,
    });
  } catch (error) {
    throw new ErrorDeRed('No se pudo contactar con la API de CEIBA.', error);
  }

  if (!respuesta.ok) {
    let codigo = 'error_http';
    let mensaje = `La API respondió ${respuesta.status}.`;
    try {
      const cuerpo = (await respuesta.json()) as { error?: unknown; mensaje?: unknown };
      if (typeof cuerpo.error === 'string') codigo = cuerpo.error;
      if (typeof cuerpo.mensaje === 'string') mensaje = cuerpo.mensaje;
    } catch {
      // Cuerpo no JSON: se queda el mensaje genérico.
    }
    throw new ErrorDeApi(respuesta.status, codigo, mensaje);
  }

  // El §2.2 fija la forma del objeto, no la del envoltorio. Se toleran los
  // tres que un servidor razonable usaría, igual que hace `desenvolverUno`
  // con las peticiones.
  const cuerpo: unknown = await respuesta.json();
  const interior = esObjeto(cuerpo) ? (cuerpo.fichero ?? cuerpo.file ?? cuerpo) : cuerpo;
  const fila = normalizarFichero(desenvolverUno(interior));
  if (fila === null) {
    throw new ErrorDeApi(
      502,
      'respuesta_incompleta',
      'El servidor aceptó el fichero pero no devolvió su identificador.',
    );
  }
  return fila;
}
