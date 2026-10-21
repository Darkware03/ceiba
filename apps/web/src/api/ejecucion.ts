/**
 * Puerto de ejecución de solicitudes HTTP del constructor.
 *
 * POR QUÉ ESTO ES UN «PUERTO» Y NO UNA LLAMADA DIRECTA
 * ----------------------------------------------------
 * Hoy, en este repositorio, **no existe ningún endpoint de la API que ejecute
 * una solicitud del usuario**: `apps/api/src/modules/` sólo tiene `identity`,
 * `workspace` y `collection` (comprobado al escribir esto). El motor
 * (`apps/engine`) sí sabe ejecutar, pero es un servicio aparte que se
 * autentica con `CEIBA_ENGINE_TOKEN`; el navegador **no debe** llamarlo
 * directamente porque eso significaría poner ese testigo en el cliente.
 *
 * Así que la interfaz habla con un puerto con dos adaptadores:
 *
 *  - `adaptadorDirectoDelNavegador` — `fetch` desde la pestaña del usuario. Es
 *    el único que FUNCIONA hoy, y tiene limitaciones serias (ver más abajo).
 *  - `adaptadorDeApi` — el camino correcto el día que exista el endpoint.
 *    Hoy falla a propósito con un mensaje claro.
 *
 * LIMITACIONES DEL ADAPTADOR DIRECTO (se muestran también en la interfaz,
 * §18: «si una función está pendiente, identifícala claramente»):
 *
 *  1. **CORS.** El destino decide. Sin `Access-Control-Allow-Origin` el
 *     navegador no deja leer la respuesta y el fallo llega como un `TypeError`
 *     indistinguible de «servidor caído».
 *  2. **Cabeceras prohibidas.** `Host`, `Connection`, `Content-Length`,
 *     `Origin`, `Referer`, `Cookie`… las fija el navegador y descarta las del
 *     usuario (Fetch Standard, «forbidden header names»). Aquí se filtran y se
 *     informa de cuáles se han ignorado, en vez de mentir diciendo que se
 *     enviaron.
 *  3. **NO pasa por los controles SSRF del motor** (C-SSRF-*). La petición sale
 *     de la máquina del usuario, con su red y su resolución DNS. Es la razón
 *     principal por la que este adaptador es un puente temporal y no el
 *     destino final.
 *  4. **Sin tiempos de DNS/TCP/TLS, sin versión de HTTP y sin saltos de
 *     redirección**: el navegador no los expone. Se devuelven en cero / vacío
 *     en vez de inventarlos.
 *
 * Los tipos de este fichero son una transcripción de
 * `apps/engine/src/contract/engine-contract.ts` (contrato v1). Cuando exista
 * `packages/contracts`, esto debe importarse de allí y borrarse de aquí.
 */
import type { FuncionFetch } from './cliente';
import { BASE_API, peticionApi } from './cliente';

// ---------------------------------------------------------------------------
// Vocabulario del contrato del motor
// ---------------------------------------------------------------------------

/** `ALLOWED_METHODS` del contrato. `CONNECT` y `TRACE` quedan fuera a propósito. */
export const METODOS_PERMITIDOS = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
] as const;

export type MetodoDeSolicitud = (typeof METODOS_PERMITIDOS)[number];

/** `ENGINE_ERROR_CODES` del contrato. Vocabulario cerrado. */
export const CODIGOS_DE_ERROR = [
  'SSRF_BLOCKED',
  'DNS_FAILURE',
  'CONNECTION_REFUSED',
  'CONNECTION_RESET',
  'TLS_ERROR',
  'TIMEOUT',
  'TOO_MANY_REDIRECTS',
  'RESPONSE_TOO_LARGE',
  'SCRIPT_ERROR',
  'SCRIPT_TIMEOUT',
  'INVALID_REQUEST',
  'ENGINE_OVERLOADED',
  /**
   * ORIGEN CLIENTE, no del motor. El motor NUNCA emite este codigo.
   *
   * Significa que la interfaz no pudo siquiera hablar con la API de CEIBA
   * (API caida, sesion perdida, red del navegador). Tiene codigo propio a
   * proposito: reutilizar `CONNECTION_REFUSED` diria que el destino rechazo
   * la conexion, y mandaria a depurar el sitio equivocado.
   */
  'API_INALCANZABLE',
] as const;

export type CodigoDeError = (typeof CODIGOS_DE_ERROR)[number];

/** `ENGINE_OUTCOMES` del contrato. */
export const DESENLACES = ['completed', 'failed', 'blocked', 'timeout', 'too_large'] as const;
export type Desenlace = (typeof DESENLACES)[number];

/**
 * `PUBLIC_ERROR_MESSAGES` del contrato, literal. No se reescriben: si la API
 * y la interfaz dan dos redacciones del mismo fallo, el usuario cree que son
 * dos fallos distintos.
 */
export const MENSAJES_DE_ERROR: Readonly<Record<CodigoDeError, string>> = Object.freeze({
  SSRF_BLOCKED: 'El destino está fuera de la política de red permitida.',
  DNS_FAILURE: 'No se pudo resolver el nombre del destino.',
  CONNECTION_REFUSED: 'El destino rechazó la conexión.',
  CONNECTION_RESET: 'El destino cerró la conexión.',
  TLS_ERROR: 'Falló la negociación TLS con el destino.',
  TIMEOUT: 'El destino agotó el tiempo máximo de la petición.',
  TOO_MANY_REDIRECTS: 'Se superó el número máximo de redirecciones.',
  RESPONSE_TOO_LARGE: 'La respuesta supera el tamaño máximo permitido.',
  SCRIPT_ERROR: 'Los scripts de usuario no están disponibles en esta versión del motor.',
  SCRIPT_TIMEOUT: 'El script agotó su tiempo máximo.',
  INVALID_REQUEST: 'La petición no cumple el contrato del motor.',
  ENGINE_OVERLOADED: 'El motor está saturado; inténtalo de nuevo.',
  // Unico de origen cliente: el fallo es con la API de CEIBA, no con el
  // destino. La redaccion lo deja claro para no mandar a depurar el sitio
  // equivocado.
  API_INALCANZABLE: 'No se pudo contactar con la API de CEIBA; la solicitud no llegó a salir.',
});

// ---------------------------------------------------------------------------
// Forma de la solicitud que compone la interfaz
// ---------------------------------------------------------------------------

/** Par clave/valor activable: sirve igual para cabeceras y para parámetros. */
export interface Par {
  readonly id: string;
  nombre: string;
  valor: string;
  activo: boolean;
}

/**
 * Modos de cuerpo que la interfaz sabe componer.
 *
 * FASE 7, P5. Antes eran tres (`none`, `raw`, `json`) y el comentario de este
 * mismo sitio decía que los demás quedaban fuera «porque la interfaz no sabe
 * serializarlos». Ya los sabe: se añaden los dos de formulario y el binario,
 * que son exactamente los que pidió el cliente («en el cuerpo de la petición
 * me debe permitir agregar formdata, binario»).
 *
 * LOS NOMBRES NUEVOS SON LOS DEL SERVIDOR, a propósito. `raw` y `json` se
 * conservan con su nombre histórico porque hay código y pruebas escritos
 * contra ellos y renombrarlos no añadiría nada; los tres nuevos se llaman
 * `form_urlencoded`, `multipart_form_data` y `binary_file` igual que en
 * `body_mode`, para que la traducción a la fila guardada sea la identidad y no
 * haya una tabla más donde equivocarse.
 *
 * **Siguen sin ser seleccionables los que no se saben componer**: `custom` no
 * tiene forma definida. Al LEER sí se toleran los diez del enum — decisión de
 * la fase 6 que el `BRIEF-FASE7` §3.C.3 manda mantener.
 */
export const MODOS_DE_CUERPO = [
  'none',
  'raw',
  'json',
  'form_urlencoded',
  'multipart_form_data',
  'binary_file',
] as const;
export type ModoDeCuerpo = (typeof MODOS_DE_CUERPO)[number];

/** Los que se componen con filas clave/valor. */
export function esModoDeFormulario(modo: ModoDeCuerpo): boolean {
  return modo === 'form_urlencoded' || modo === 'multipart_form_data';
}

/** Los que se componen escribiendo texto en el editor. */
export function esModoCrudo(modo: ModoDeCuerpo): boolean {
  return modo === 'raw' || modo === 'json';
}

/**
 * Fichero ya subido al servidor. **Nunca lleva los bytes**: el §2.2 del
 * `BRIEF-FASE7` es explícito («nunca bytes al cliente web»). Lo que la
 * interfaz guarda es la referencia y lo justo para poder enseñar al usuario
 * qué adjuntó: nombre, tipo y tamaño.
 */
export interface FicheroDeCuerpo {
  readonly id: string;
  readonly fileName: string;
  readonly contentType: string | null;
  readonly sizeBytes: number | null;
}

/**
 * Una fila de un cuerpo de formulario.
 *
 * `tipo` es el conmutador texto/fichero que pide el §3.C.3. El esquema impone
 * que haya **como mucho una** fuente de valor por campo (`ck_bodyfield_xor`),
 * así que aquí también son excluyentes: al pasar a `fichero` el texto deja de
 * contar, y al revés. No se borra el otro valor para que cambiar de idea no
 * cueste volver a teclearlo, pero sólo se envía el que corresponde al `tipo`.
 */
export interface CampoDeCuerpo {
  readonly id: string;
  nombre: string;
  tipo: 'texto' | 'fichero';
  valor: string;
  fichero: FicheroDeCuerpo | null;
  activo: boolean;
}

export interface CuerpoDeSolicitud {
  modo: ModoDeCuerpo;
  contenido: string;
  /** `null` = se deduce del modo (`json` → `application/json`). */
  tipoContenido: string | null;
  /**
   * Filas de `form_urlencoded` / `multipart_form_data`.
   *
   * OPCIONAL A PROPÓSITO, no por descuido: hay código y pruebas que construyen
   * un `CuerpoDeSolicitud` con tres campos desde antes de la fase 7, y
   * hacerlos obligatorios rompería el `typecheck` de ficheros que no son de
   * este ámbito. Quien lee debe usar `camposDeCuerpo()`.
   */
  campos?: CampoDeCuerpo[];
  /** El único fichero de `binary_file`. */
  ficheroBinario?: FicheroDeCuerpo | null;
}

/** Filas del cuerpo, nunca `undefined`. */
export function camposDeCuerpo(cuerpo: CuerpoDeSolicitud): readonly CampoDeCuerpo[] {
  return cuerpo.campos ?? [];
}

/** Filas que de verdad se envían: activas y con nombre. */
export function camposActivosDeCuerpo(cuerpo: CuerpoDeSolicitud): readonly CampoDeCuerpo[] {
  return camposDeCuerpo(cuerpo).filter((c) => c.activo && c.nombre.trim().length > 0);
}

export interface SolicitudPreparada {
  readonly metodo: MetodoDeSolicitud;
  readonly url: string;
  readonly cabeceras: readonly Par[];
  readonly parametros: readonly Par[];
  readonly cuerpo: CuerpoDeSolicitud;
}

// ---------------------------------------------------------------------------
// Forma del resultado: equivalente a `ExecuteResponse` del contrato
// ---------------------------------------------------------------------------

export interface CabeceraDeRespuesta {
  readonly name: string;
  readonly value: string;
}

export interface TiemposDeEjecucion {
  readonly dnsMs: number;
  readonly tcpMs: number;
  readonly tlsMs: number;
  readonly ttfbMs: number;
  readonly totalMs: number;
}

export interface SaltoDeRedireccion {
  readonly status: number;
  readonly from: string;
  readonly to: string;
}

export interface CargaDeRespuesta {
  readonly status: number;
  readonly statusText: string;
  /** Vacío cuando el transporte no lo expone (siempre, en el navegador). */
  readonly httpVersion: string;
  readonly headers: readonly CabeceraDeRespuesta[];
  readonly bodyEncoding: 'utf8' | 'base64';
  readonly body: string;
  readonly bodyTruncated: boolean;
  readonly sizeBytes: number;
}

export interface ErrorDeEjecucion {
  readonly code: CodigoDeError;
  readonly message: string;
}

/** Equivalente de `ExecuteResponse`, más el adaptador que lo produjo. */
export interface ResultadoDeEjecucion {
  readonly executionId: string;
  readonly outcome: Desenlace;
  readonly response: CargaDeRespuesta | null;
  readonly timings: TiemposDeEjecucion;
  readonly redirects: readonly SaltoDeRedireccion[];
  readonly error: ErrorDeEjecucion | null;
  /** Qué adaptador lo ejecutó. La interfaz lo dice en pantalla. */
  readonly adaptador: IdDeAdaptador;
  /** URL final realmente pedida, con los parámetros ya compuestos. */
  readonly urlEfectiva: string;
  /** Cabeceras que el navegador descartó. Vacío en el adaptador de API. */
  readonly cabecerasIgnoradas: readonly string[];
}

// ---------------------------------------------------------------------------
// Composición de la URL
// ---------------------------------------------------------------------------

/**
 * Compone la URL final con los parámetros de consulta.
 *
 * Reglas:
 *  - Se ignoran los pares desactivados y los que no tienen nombre.
 *  - Un parámetro de la lista **sustituye** al del mismo nombre que ya venga
 *    escrito en la URL, en vez de añadirse (si no, teclear `?a=1` y además
 *    tener la fila `a`, mandaría `a` dos veces sin que el usuario lo pida).
 *  - Dos filas con el **mismo nombre** sí se mandan las dos: eso es
 *    intencionado por parte del usuario y hay APIs que lo usan.
 *
 * No se usa `new URL()` a propósito: el usuario está escribiendo y la URL
 * puede ser todavía inválida o relativa; reventar a media escritura sería
 * peor que componer un texto.
 */
export function construirUrl(url: string, parametros: readonly Par[] = []): string {
  const base = url.trim();
  const activos = parametros.filter((par) => par.activo && par.nombre.trim().length > 0);

  const corteFragmento = base.indexOf('#');
  const fragmento = corteFragmento === -1 ? '' : base.slice(corteFragmento);
  const sinFragmento = corteFragmento === -1 ? base : base.slice(0, corteFragmento);

  const corteConsulta = sinFragmento.indexOf('?');
  const camino = corteConsulta === -1 ? sinFragmento : sinFragmento.slice(0, corteConsulta);
  const consultaPrevia = corteConsulta === -1 ? '' : sinFragmento.slice(corteConsulta + 1);

  if (activos.length === 0) {
    return consultaPrevia.length > 0 ? `${camino}?${consultaPrevia}${fragmento}` : base;
  }

  const busqueda = new URLSearchParams(consultaPrevia);
  const yaSustituidos = new Set<string>();
  for (const par of activos) {
    const nombre = par.nombre.trim();
    if (yaSustituidos.has(nombre)) {
      busqueda.append(nombre, par.valor);
    } else {
      busqueda.set(nombre, par.valor);
      yaSustituidos.add(nombre);
    }
  }

  const consulta = busqueda.toString();
  return consulta.length > 0 ? `${camino}?${consulta}${fragmento}` : `${camino}${fragmento}`;
}

// ---------------------------------------------------------------------------
// Cabeceras que el navegador no deja poner
// ---------------------------------------------------------------------------

/**
 * «Forbidden header names» del Fetch Standard. El navegador las descarta en
 * silencio; aquí se filtran para poder DECIR cuáles se ignoraron.
 */
const CABECERAS_PROHIBIDAS: ReadonlySet<string> = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'permissions-policy',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
]);

const PREFIJOS_PROHIBIDOS = ['proxy-', 'sec-'] as const;

/** `true` si el navegador descartará esta cabecera pase lo que pase. */
export function esCabeceraProhibidaPorElNavegador(nombre: string): boolean {
  const limpio = nombre.trim().toLowerCase();
  if (limpio.length === 0) return false;
  if (CABECERAS_PROHIBIDAS.has(limpio)) return true;
  return PREFIJOS_PROHIBIDOS.some((prefijo) => limpio.startsWith(prefijo));
}

// ---------------------------------------------------------------------------
// Ayudas puras de presentación (probadas sin DOM)
// ---------------------------------------------------------------------------

/**
 * Frases de estado de referencia. Hacen falta porque `Response.statusText`
 * viene **vacío** en HTTP/2 y HTTP/3 (el protocolo eliminó la frase de
 * motivo), y enseñar «200» a secas es peor que enseñar «200 OK».
 */
const FRASES_DE_ESTADO: Readonly<Record<number, string>> = Object.freeze({
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  206: 'Partial Content',
  301: 'Moved Permanently',
  302: 'Found',
  303: 'See Other',
  304: 'Not Modified',
  307: 'Temporary Redirect',
  308: 'Permanent Redirect',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  408: 'Request Timeout',
  409: 'Conflict',
  410: 'Gone',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  418: "I'm a teapot",
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
});

/** Frase del estado: la que mande el servidor y, si no hay, la de referencia. */
export function textoDeEstado(estado: number, textoDelServidor = ''): string {
  const recibido = textoDelServidor.trim();
  if (recibido.length > 0) return recibido;
  return FRASES_DE_ESTADO[estado] ?? '';
}

export type FamiliaDeEstado = 'info' | 'exito' | 'redireccion' | 'cliente' | 'servidor' | 'otra';

/** Familia 1xx/2xx/3xx/4xx/5xx, que es lo que colorea el panel de respuesta. */
export function familiaDeEstado(estado: number): FamiliaDeEstado {
  if (estado >= 100 && estado < 200) return 'info';
  if (estado >= 200 && estado < 300) return 'exito';
  if (estado >= 300 && estado < 400) return 'redireccion';
  if (estado >= 400 && estado < 500) return 'cliente';
  if (estado >= 500 && estado < 600) return 'servidor';
  return 'otra';
}

/** Longitud real en bytes UTF-8, no en caracteres: `€` ocupa 3, no 1. */
export function tamanoEnBytes(texto: string): number {
  return new TextEncoder().encode(texto).length;
}

/** `845 B`, `1,2 kB`, `3,4 MB`. Unidades decimales, como las muestra el navegador. */
export function formatearTamano(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1000 * 1000) return `${(bytes / 1000).toFixed(1).replace('.', ',')} kB`;
  return `${(bytes / (1000 * 1000)).toFixed(1).replace('.', ',')} MB`;
}

/** `12 ms`, `1,23 s`. */
export function formatearDuracion(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2).replace('.', ',')} s`;
}

/** Busca una cabecera sin distinguir mayúsculas. */
export function buscarCabecera(
  cabeceras: readonly CabeceraDeRespuesta[],
  nombre: string,
): string | null {
  const buscado = nombre.toLowerCase();
  for (const cabecera of cabeceras) {
    if (cabecera.name.toLowerCase() === buscado) return cabecera.value;
  }
  return null;
}

/** GET y HEAD no pueden llevar cuerpo: `fetch` lanza `TypeError` si se le pone. */
export function metodoAdmiteCuerpo(metodo: MetodoDeSolicitud): boolean {
  return metodo !== 'GET' && metodo !== 'HEAD';
}

// ---------------------------------------------------------------------------
// Adaptadores
// ---------------------------------------------------------------------------

export type IdDeAdaptador = 'navegador' | 'api';

export interface OpcionesDeEjecucion {
  /** `fetch` inyectable: las pruebas pasan un doble y no tocan la red. */
  readonly fetchImpl?: FuncionFetch;
  readonly senal?: AbortSignal;
  /** Reloj inyectable, para que las pruebas no dependan de la máquina. */
  readonly ahora?: () => number;
  readonly idDeEjecucion?: string;
  /** Contexto que necesita el motor; lo ignora el adaptador del navegador. */
  readonly workspaceId?: string | null;
  readonly requestId?: string | null;
  readonly environmentId?: string | null;
}

export interface PuertoDeEjecucion {
  readonly id: IdDeAdaptador;
  readonly etiqueta: string;
  /** `false` si hoy no se puede usar: la interfaz lo dice en pantalla. */
  readonly disponible: boolean;
  readonly advertencia: string;
  ejecutar(
    solicitud: SolicitudPreparada,
    opciones?: OpcionesDeEjecucion,
  ): Promise<ResultadoDeEjecucion>;
}

/** Tope defensivo: más allá de esto el cuerpo se corta y se marca `bodyTruncated`. */
export const LIMITE_DE_CUERPO_BYTES = 5 * 1024 * 1024;

const TIEMPOS_EN_CERO: TiemposDeEjecucion = Object.freeze({
  dnsMs: 0,
  tcpMs: 0,
  tlsMs: 0,
  ttfbMs: 0,
  totalMs: 0,
});

function nuevoIdDeEjecucion(): string {
  const cripto = globalThis.crypto;
  if (cripto !== undefined && typeof cripto.randomUUID === 'function') return cripto.randomUUID();
  return `ej-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function relojPorDefecto(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function obtenerFetch(opciones: OpcionesDeEjecucion): FuncionFetch {
  if (opciones.fetchImpl !== undefined) return opciones.fetchImpl;
  if (typeof globalThis.fetch !== 'function') {
    throw new Error('Este entorno no dispone de fetch.');
  }
  return globalThis.fetch.bind(globalThis);
}

/**
 * Serializa a texto las filas de un `form_urlencoded`.
 *
 * Sólo las de texto: una fila de fichero **no se puede** urlencodear, y
 * fabricar `campo=nombre-del-fichero.pdf` sería exactamente la «equivalencia
 * falsa» que el prompt maestro prohíbe. Las de fichero se declaran en
 * `limitacionesDeEnvioDelCuerpo()`.
 */
export function serializarUrlencoded(cuerpo: CuerpoDeSolicitud): string {
  const partes: string[] = [];
  for (const campo of camposActivosDeCuerpo(cuerpo)) {
    if (campo.tipo !== 'texto') continue;
    partes.push(
      `${encodeURIComponent(campo.nombre.trim())}=${encodeURIComponent(campo.valor)}`,
    );
  }
  return partes.join('&');
}

function cuerpoParaEnviar(solicitud: SolicitudPreparada): string | undefined {
  const cuerpo = solicitud.cuerpo;
  if (cuerpo.modo === 'none') return undefined;
  if (!metodoAdmiteCuerpo(solicitud.metodo)) return undefined;
  if (cuerpo.modo === 'form_urlencoded') {
    const texto = serializarUrlencoded(cuerpo);
    return texto.length === 0 ? undefined : texto;
  }
  /*
   * `multipart_form_data` y `binary_file` NO se serializan aquí y eso no es
   * una carencia que se tape: los bytes del fichero viven en el servidor
   * (`files.storage_key`), no en la pestaña del usuario, así que el navegador
   * **no los tiene**. Mandar el nombre del fichero como si fuese su contenido
   * sería enviar algo distinto de lo que el usuario ve. Se devuelve
   * `undefined` y la limitación se dice en pantalla.
   */
  if (esModoDeFormulario(cuerpo.modo) || cuerpo.modo === 'binary_file') return undefined;
  if (cuerpo.contenido.length === 0) return undefined;
  return cuerpo.contenido;
}

/** Tipo de contenido efectivo: el explícito, o el que implica el modo. */
export function tipoDeContenidoDe(cuerpo: CuerpoDeSolicitud): string | null {
  if (cuerpo.modo === 'none') return null;
  const explicito = cuerpo.tipoContenido?.trim() ?? '';
  if (explicito.length > 0) return explicito;
  switch (cuerpo.modo) {
    case 'json':
      return 'application/json';
    case 'form_urlencoded':
      return 'application/x-www-form-urlencoded';
    /*
     * Sin `boundary`. El `boundary` lo tiene que poner quien compone de
     * verdad el cuerpo —el motor— porque forma parte de los bytes. Escribir
     * aquí uno inventado haría que la cabecera y el cuerpo no coincidiesen.
     */
    case 'multipart_form_data':
      return 'multipart/form-data';
    case 'binary_file':
      return cuerpo.ficheroBinario?.contentType ?? 'application/octet-stream';
    default:
      return 'text/plain';
  }
}

/**
 * Lo que este cuerpo NO podrá enviarse tal cual, dicho antes de pulsar Enviar.
 *
 * §18 del prompt maestro y §2.4 del `BRIEF-FASE6`: cuando algo no se puede
 * representar, se declara. Aquí es literal — el usuario adjunta un fichero que
 * vive en el servidor y el navegador no puede subírselo al destino por sí
 * mismo— y callarlo produciría un envío silenciosamente incompleto.
 */
export function limitacionesDeEnvioDelCuerpo(
  cuerpo: CuerpoDeSolicitud,
  adaptador: IdDeAdaptador,
): string[] {
  const notas: string[] = [];
  const conFichero = camposActivosDeCuerpo(cuerpo).filter((c) => c.tipo === 'fichero');

  if (cuerpo.modo === 'form_urlencoded' && conFichero.length > 0) {
    notas.push(
      `Un cuerpo urlencoded no puede llevar ficheros: ${conFichero
        .map((c) => c.nombre.trim())
        .join(', ')} no se enviará. Cambia a formulario multiparte.`,
    );
  }

  if (adaptador === 'navegador' && (esModoDeFormulario(cuerpo.modo) || cuerpo.modo === 'binary_file')) {
    notas.push(
      'El modo directo del navegador no puede componer este cuerpo: los ficheros ' +
        'adjuntos están guardados en el servidor y la pestaña no tiene sus bytes. ' +
        'Usa «A través del motor de CEIBA».',
    );
  }

  if (cuerpo.modo === 'binary_file' && (cuerpo.ficheroBinario ?? null) === null) {
    notas.push('El cuerpo binario no tiene ningún fichero seleccionado todavía.');
  }

  return notas;
}

/**
 * Traduce un fallo de `fetch` al vocabulario cerrado del motor.
 *
 * POR QUÉ TODO CAE EN `CONNECTION_REFUSED`: el navegador colapsa DNS fallido,
 * conexión rechazada, TLS inválido, bloqueo por CORS y bloqueo por extensión
 * en **un único `TypeError: Failed to fetch`**, sin causa ni código. Es
 * deliberado del Fetch Standard (no filtrar información de la red interna del
 * usuario a la página). Como el contrato exige un código del vocabulario y
 * `DNS_FAILURE` afirmaría algo que no sabemos, se usa `CONNECTION_REFUSED` y
 * el **mensaje** sí enumera las causas posibles en vez de fingir precisión.
 */
function errorDesdeFalloDeFetch(causa: unknown): ErrorDeEjecucion {
  const nombre = causa instanceof Error ? causa.name : '';
  if (nombre === 'AbortError' || nombre === 'TimeoutError') {
    return { code: 'TIMEOUT', message: MENSAJES_DE_ERROR.TIMEOUT };
  }
  return {
    code: 'CONNECTION_REFUSED',
    message:
      'El navegador no pudo completar la petición. Puede ser que el destino no ' +
      'exista, que rechace la conexión, que el certificado TLS no sea válido o ' +
      'que CORS la haya bloqueado: el navegador devuelve el mismo error para ' +
      'todos esos casos y no permite distinguirlos.',
  };
}

function recogerCabeceras(cabeceras: Headers | undefined): CabeceraDeRespuesta[] {
  const recogidas: CabeceraDeRespuesta[] = [];
  if (cabeceras === undefined || typeof cabeceras.forEach !== 'function') return recogidas;
  cabeceras.forEach((valor, nombre) => {
    recogidas.push({ name: nombre, value: valor });
  });
  return recogidas;
}

/**
 * Lee el cuerpo y devuelve texto + tamaño real en bytes.
 *
 * Se prefiere `arrayBuffer()` porque da el tamaño EXACTO; `text()` sólo
 * permite recontar los bytes de la decodificación, que no coincide si la
 * respuesta no es UTF-8 válido. Se deja el camino de `text()` por si el doble
 * de pruebas de alguien no implementa `arrayBuffer`.
 */
async function leerCuerpo(
  respuesta: Response,
): Promise<{ texto: string; bytes: number; truncado: boolean }> {
  let texto: string;
  let bytes: number;

  if (typeof respuesta.arrayBuffer === 'function') {
    const binario = await respuesta.arrayBuffer();
    bytes = binario.byteLength;
    texto = new TextDecoder('utf-8').decode(binario);
  } else {
    texto = await respuesta.text();
    bytes = tamanoEnBytes(texto);
  }

  if (bytes > LIMITE_DE_CUERPO_BYTES) {
    return { texto: texto.slice(0, LIMITE_DE_CUERPO_BYTES), bytes, truncado: true };
  }
  return { texto, bytes, truncado: false };
}

/**
 * Adaptador directo: ejecuta con el `fetch` del navegador del usuario.
 *
 * Lo único que funciona hoy. Ver la cabecera del fichero para las cuatro
 * limitaciones; la interfaz las repite en pantalla.
 */
export async function ejecutar(
  solicitud: SolicitudPreparada,
  opciones: OpcionesDeEjecucion = {},
): Promise<ResultadoDeEjecucion> {
  const executionId = opciones.idDeEjecucion ?? nuevoIdDeEjecucion();
  const reloj = opciones.ahora ?? relojPorDefecto;
  const urlEfectiva = construirUrl(solicitud.url, solicitud.parametros);

  const cabeceras: Record<string, string> = {};
  const cabecerasIgnoradas: string[] = [];
  for (const par of solicitud.cabeceras) {
    const nombre = par.nombre.trim();
    if (!par.activo || nombre.length === 0) continue;
    if (esCabeceraProhibidaPorElNavegador(nombre)) {
      cabecerasIgnoradas.push(nombre);
      continue;
    }
    cabeceras[nombre] = par.valor;
  }

  const cuerpo = cuerpoParaEnviar(solicitud);
  if (cuerpo !== undefined) {
    const tipo = tipoDeContenidoDe(solicitud.cuerpo);
    const yaPuesto = Object.keys(cabeceras).some((n) => n.toLowerCase() === 'content-type');
    if (tipo !== null && !yaPuesto) cabeceras['content-type'] = tipo;
  }

  const peticion: RequestInit = {
    method: solicitud.metodo,
    headers: cabeceras,
    // NUNCA `include`. La solicitud del usuario va a un destino ARBITRARIO:
    // mandarle las cookies de CEIBA (incluida la de sesión `__Host-`) sería
    // una fuga de credenciales a un tercero, y además convertiría cualquier
    // destino en un punto de CSRF contra el propio CEIBA. `omit` también evita
    // que el destino reciba cookies suyas previas sin que el usuario lo sepa.
    credentials: 'omit',
    redirect: 'follow',
    mode: 'cors',
  };
  if (cuerpo !== undefined) peticion.body = cuerpo;
  if (opciones.senal !== undefined) peticion.signal = opciones.senal;

  const inicio = reloj();
  let respuesta: Response;
  try {
    respuesta = await obtenerFetch(opciones)(urlEfectiva, peticion);
  } catch (causa) {
    const transcurrido = reloj() - inicio;
    return {
      executionId,
      outcome: 'failed',
      response: null,
      timings: { ...TIEMPOS_EN_CERO, totalMs: transcurrido },
      redirects: [],
      error: errorDesdeFalloDeFetch(causa),
      adaptador: 'navegador',
      urlEfectiva,
      cabecerasIgnoradas,
    };
  }

  const ttfbMs = reloj() - inicio;

  let leido: { texto: string; bytes: number; truncado: boolean };
  try {
    leido = await leerCuerpo(respuesta);
  } catch (causa) {
    const transcurrido = reloj() - inicio;
    return {
      executionId,
      outcome: 'failed',
      response: null,
      timings: { ...TIEMPOS_EN_CERO, ttfbMs, totalMs: transcurrido },
      redirects: [],
      error: {
        code: 'CONNECTION_RESET',
        message: `${MENSAJES_DE_ERROR.CONNECTION_RESET} Se recibieron las cabeceras, pero el cuerpo quedó incompleto.`,
      },
      adaptador: 'navegador',
      urlEfectiva,
      cabecerasIgnoradas,
    };
  }

  const totalMs = reloj() - inicio;

  return {
    executionId,
    outcome: leido.truncado ? 'too_large' : 'completed',
    response: {
      status: respuesta.status,
      statusText: textoDeEstado(respuesta.status, respuesta.statusText ?? ''),
      // El navegador no expone la versión del protocolo. Vacío, no inventado.
      httpVersion: '',
      headers: recogerCabeceras(respuesta.headers),
      bodyEncoding: 'utf8',
      body: leido.texto,
      bodyTruncated: leido.truncado,
      sizeBytes: leido.bytes,
    },
    timings: { ...TIEMPOS_EN_CERO, ttfbMs, totalMs },
    // El navegador sigue las redirecciones pero NO expone los saltos
    // intermedios (sólo `response.redirected` y la URL final). Se deja vacío
    // en lugar de fabricar un salto que no se ha observado.
    redirects: [],
    error: null,
    adaptador: 'navegador',
    urlEfectiva,
    cabecerasIgnoradas,
  };
}

export const adaptadorDirectoDelNavegador: PuertoDeEjecucion = {
  id: 'navegador',
  etiqueta: 'Directo desde el navegador',
  disponible: true,
  advertencia:
    'La solicitud sale del navegador: está sujeta a CORS, el navegador descarta ' +
    'cabeceras como Host o Connection, y NO pasa por los controles SSRF del motor.',
  ejecutar,
};

/** Ruta del endpoint de ejecución previsto. Ver el HUECO de abajo. */
export const RUTA_DE_EJECUCION_EN_API = '/api/v1/requests/execute';

/**
 * ESTE ES EL CAMINO BUENO, Y YA EXISTE.
 *
 * La API recibe la solicitud, resuelve las variables del entorno, llama al
 * motor con `CEIBA_ENGINE_TOKEN` —que **nunca toca el navegador**— y devuelve
 * el resultado. Por el camino la petición pasa por los **12 controles SSRF**
 * del motor, que es justo lo que el modo directo se saltaba.
 *
 * Rutas reales del controlador (`studio.controller.ts`):
 *   `POST /api/v1/workspaces/:workspaceId/execute`
 *   `POST /api/v1/requests/execute`  ← la que usamos: acepta `workspaceId` en
 *   el cuerpo y, si no va, lo deduce del primer workspace del usuario.
 *
 * Diferencias reales frente al modo directo, y son a favor:
 *   - **Se envían TODAS las cabeceras.** El navegador descartaba `Host`,
 *     `Origin`, `Referer`, `Cookie` y el resto de *forbidden header names*;
 *     aquí las pone el motor, que no tiene esa restricción.
 *   - **Hay tiempos y redirecciones de verdad.** El navegador no los expone y
 *     se devolvían en cero; el motor los mide.
 *   - **No hay CORS.** La petición sale del servidor, no de la pestaña.
 */
export const adaptadorDeApi: PuertoDeEjecucion = {
  id: 'api',
  etiqueta: 'A través del motor de CEIBA',
  disponible: true,
  advertencia: '',
  async ejecutar(solicitud, opciones = {}) {
    const urlEfectiva = construirUrl(solicitud.url, solicitud.parametros);
    const idEjecucion = opciones.idDeEjecucion ?? nuevoIdDeEjecucion();

    // El contrato del controlador usa `key`/`value`/`enabled`. Se mandan los
    // pares TAL CUAL, sin filtrar los prohibidos del navegador: el motor sí
    // puede ponerlos, y filtrarlos aquí sería arrastrar una limitación que ya
    // no aplica.
    const aPares = (pares: readonly Par[]) =>
      pares
        .filter((p) => p.nombre.trim() !== '')
        .map((p) => ({ key: p.nombre, value: p.valor, enabled: p.activo }));

    /*
     * FASE 7, P5. Los modos nuevos no caben en un `body` de texto, así que
     * viajan en los campos del §2.1 del `BRIEF-FASE7` (`bodyFields`,
     * `binaryFileId`). Van **además** de `body`, no en su lugar, y sólo cuando
     * el modo los pide: un servidor que todavía no los conozca los ignora
     * (el DTO de la API valida con Zod sin `.strict()`, comprobado), y uno que
     * sí los conozca compone el cuerpo de verdad.
     *
     * DEUDA DECLARADA: el §2.1 fija estos campos para `POST
     * /collections/:id/requests` y `PATCH /requests/:id`, **no** para la ruta
     * de ejecución. Se mandan igualmente porque son aditivos e inocuos; va
     * escrito en el informe como petición al ámbito A.
     */
    const cuerpo = solicitud.cuerpo;
    const cuerpoEnviado =
      cuerpo.modo === 'none'
        ? null
        : cuerpo.modo === 'form_urlencoded'
          ? serializarUrlencoded(cuerpo)
          : esModoDeFormulario(cuerpo.modo) || cuerpo.modo === 'binary_file'
            ? null
            : (cuerpo.contenido ?? null);

    const camposDelCuerpo = esModoDeFormulario(cuerpo.modo)
      ? camposActivosDeCuerpo(cuerpo).map((campo) => ({
          key: campo.nombre.trim(),
          kind: campo.tipo === 'fichero' ? 'file' : 'text',
          ...(campo.tipo === 'fichero'
            ? { fileId: campo.fichero?.id ?? null }
            : { value: campo.valor }),
          enabled: true,
        }))
      : undefined;

    try {
      const respuesta = await peticionApi<RespuestaDeEjecucionApi>(
        RUTA_DE_EJECUCION_EN_API.replace(BASE_API, ''),
        {
          metodo: 'POST',
          cuerpo: {
            workspaceId: opciones.workspaceId ?? undefined,
            requestId: opciones.requestId ?? null,
            environmentId: opciones.environmentId ?? null,
            method: solicitud.metodo,
            url: solicitud.url,
            headers: aPares(solicitud.cabeceras),
            queryParams: aPares(solicitud.parametros),
            bodyType: cuerpo.modo,
            body: cuerpoEnviado,
            bodyFields: camposDelCuerpo,
            binaryFileId:
              cuerpo.modo === 'binary_file' ? (cuerpo.ficheroBinario?.id ?? null) : undefined,
          },
          senal: opciones.senal,
        },
      );

      // TRADUCCION DEL SOBRE REAL DE LA API, QUE VIENE EN ESPANOL.
      //
      // Este mapeo estaba mal y es la causa del fallo que reporto el cliente:
      // «sin respuesta del destino, 0 ms, codigo desconocido» aunque el motor
      // SI alcanzaba el destino. El adaptador leia `outcome`, `response` y
      // `timings`, y la API devuelve `desenlace`, `codigoEstado`, `cabeceras`,
      // `cuerpoTexto` y `tiempos`. Todo salia `undefined`, de ahi el 0 ms y el
      // «desconocido». Se escribio contra un contrato supuesto en vez de contra
      // la respuesta real.
      const tot = Math.max(0, Number(respuesta.tiempos?.totalMs ?? 0));
      const carga: CargaDeRespuesta | null = respuesta.exito
        ? {
            status: Number(respuesta.codigoEstado ?? 0),
            statusText: String(respuesta.textoEstado ?? ''),
            // El motor no lo expone todavia; se declara vacio en vez de inventarlo.
            httpVersion: '',
            headers: (respuesta.cabeceras ?? []).map((c) => ({
              name: c.clave,
              value: c.valor,
            })),
            bodyEncoding: 'utf8',
            body: String(respuesta.cuerpoTexto ?? ''),
            bodyTruncated: Boolean(respuesta.truncado),
            sizeBytes: Number(respuesta.tamanoBytes ?? 0),
          }
        : null;

      const resultado: ResultadoDeEjecucion = {
        executionId: String(respuesta.historyId ?? idEjecucion),
        outcome: (respuesta.desenlace ?? (respuesta.exito ? 'completed' : 'failed')) as Desenlace,
        response: carga,
        // La API sólo publica el total. El resto se deja en cero EXPLÍCITAMENTE
        // en vez de repartirlo a ojo: un desglose inventado es peor que uno
        // ausente.
        timings: { dnsMs: 0, tcpMs: 0, tlsMs: 0, ttfbMs: 0, totalMs: tot },
        // Sólo llega el recuento, no el detalle de cada salto.
        redirects: [],
        error: respuesta.exito
          ? null
          : {
              code: (respuesta.errorCodigo ?? 'INVALID_REQUEST') as CodigoDeError,
              message: String(respuesta.errorMensaje ?? 'La ejecución falló.'),
            },
        adaptador: 'api',
        urlEfectiva: String(respuesta.urlFinal ?? urlEfectiva),
        // El motor no descarta ninguna: esa limitación era del navegador.
        cabecerasIgnoradas: [],
      };
      return resultado;
    } catch (e) {
      // Un fallo de transporte contra NUESTRA API no es un fallo del destino.
      // Se distingue, porque confundirlos manda a depurar al sitio equivocado.
      const fallo: ResultadoDeEjecucion = {
        executionId: idEjecucion,
        outcome: 'failed',
        response: null,
        timings: TIEMPOS_EN_CERO,
        redirects: [],
        error: {
          code: 'API_INALCANZABLE',
          message: `No se pudo hablar con la API de CEIBA: ${mensajeLegible(e)}`,
        },
        adaptador: 'api',
        urlEfectiva,
        cabecerasIgnoradas: [],
      };
      return fallo;
    }
  },
};

/**
 * Forma REAL que devuelve `POST /api/v1/requests/execute`.
 *
 * Está en español porque así la emite `studio-core.service.ts`. Se transcribe
 * tal cual en vez de renombrarla aquí: inventar un alias inglés fue justo el
 * error que dejó la ejecución por motor devolviendo 0 ms y «desconocido».
 */
interface RespuestaDeEjecucionApi {
  readonly historyId?: string;
  readonly exito?: boolean;
  readonly codigoEstado?: number;
  readonly textoEstado?: string;
  readonly cabeceras?: readonly { readonly clave: string; readonly valor: string }[];
  readonly cuerpoTexto?: string;
  readonly tipoContenido?: string;
  readonly tamanoBytes?: number;
  readonly truncado?: boolean;
  readonly tiempos?: { readonly totalMs?: number };
  readonly urlFinal?: string;
  readonly redirecciones?: number;
  readonly desenlace?: string;
  readonly errorCodigo?: string;
  readonly errorMensaje?: string;
}

function mensajeLegible(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * Adaptadores conocidos. **El del motor va primero y es el predeterminado.**
 * El directo del navegador se conserva sólo como diagnóstico: no pasa por los
 * controles SSRF, descarta cabeceras y no mide tiempos.
 */
export const ADAPTADORES: readonly PuertoDeEjecucion[] = Object.freeze([
  adaptadorDeApi,
  adaptadorDirectoDelNavegador,
]);

export function adaptadorPorId(id: IdDeAdaptador): PuertoDeEjecucion {
  return id === 'navegador' ? adaptadorDirectoDelNavegador : adaptadorDeApi;
}
