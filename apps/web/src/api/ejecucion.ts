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
 * Modos de cuerpo que la interfaz sabe componer hoy. El contrato del motor
 * admite además `form`, `urlencoded`, `binary` y `graphql`; esos quedan fuera
 * de esta entrega y por eso NO están en la unión: un modo que la interfaz no
 * sabe serializar no debe ser seleccionable.
 */
export const MODOS_DE_CUERPO = ['none', 'raw', 'json'] as const;
export type ModoDeCuerpo = (typeof MODOS_DE_CUERPO)[number];

export interface CuerpoDeSolicitud {
  modo: ModoDeCuerpo;
  contenido: string;
  /** `null` = se deduce del modo (`json` → `application/json`). */
  tipoContenido: string | null;
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

function cuerpoParaEnviar(solicitud: SolicitudPreparada): string | undefined {
  if (solicitud.cuerpo.modo === 'none') return undefined;
  if (!metodoAdmiteCuerpo(solicitud.metodo)) return undefined;
  if (solicitud.cuerpo.contenido.length === 0) return undefined;
  return solicitud.cuerpo.contenido;
}

/** Tipo de contenido efectivo: el explícito, o el que implica el modo. */
export function tipoDeContenidoDe(cuerpo: CuerpoDeSolicitud): string | null {
  if (cuerpo.modo === 'none') return null;
  const explicito = cuerpo.tipoContenido?.trim() ?? '';
  if (explicito.length > 0) return explicito;
  return cuerpo.modo === 'json' ? 'application/json' : 'text/plain';
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

    const cuerpoEnviado =
      solicitud.cuerpo.modo === 'none' ? null : (solicitud.cuerpo.contenido ?? null);

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
            bodyType: solicitud.cuerpo.modo,
            body: cuerpoEnviado,
          },
          senal: opciones.senal,
        },
      );

      const resultado: ResultadoDeEjecucion = {
        executionId: respuesta.executionId ?? idEjecucion,
        outcome: (respuesta.outcome ?? 'failed') as Desenlace,
        response: respuesta.response ?? null,
        timings: respuesta.timings ?? TIEMPOS_EN_CERO,
        redirects: respuesta.redirects ?? [],
        error: respuesta.error ?? null,
        adaptador: 'api',
        urlEfectiva,
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

/** Forma que devuelve `POST /api/v1/requests/execute`. */
interface RespuestaDeEjecucionApi {
  readonly executionId?: string;
  readonly outcome?: string;
  readonly response?: CargaDeRespuesta | null;
  readonly timings?: TiemposDeEjecucion;
  readonly redirects?: readonly SaltoDeRedireccion[];
  readonly error?: ErrorDeEjecucion | null;
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
