/**
 * Política de cabeceras de la petición saliente.
 *
 * C-SSRF-07  — al cambiar de origen en una redirección se eliminan
 *              `Authorization`, `Cookie`, `Proxy-Authorization` y las cabeceras
 *              tipo `X-Api-Key`.
 * C-SSRF-12  — `Metadata-Flavor` puesta a mano por el usuario se elimina
 *              SIEMPRE: GCP la exige para servir la metadata del nodo.
 */
import type { CanonicalTarget } from '../net/normalize-target.ts';
import type { EngineHeader } from '../contract/engine-contract.ts';

/**
 * Cabeceras que el usuario no controla nunca: o las fija el transporte, o
 * permiten confundir al destino sobre quién es.
 */
export const REJECTED_REQUEST_HEADERS: ReadonlySet<string> = Object.freeze(
  new Set([
    'host', // confusión de virtual host; lo fija la URL canónica
    'content-length', // lo calcula el motor
    'connection',
    'proxy-connection',
    'proxy-authorization', // C-SSRF-10
    'transfer-encoding',
    'upgrade',
    'te',
    'trailer',
    'expect',
    'keep-alive',
    'metadata-flavor', // C-SSRF-12
    'metadata', // Azure IMDS usa `Metadata: true`
    'x-aws-ec2-metadata-token', // IMDSv2
    'x-aws-ec2-metadata-token-ttl-seconds',
  ]),
);

/** Cabeceras que no cruzan un cambio de origen (C-SSRF-07). */
export const CROSS_ORIGIN_STRIPPED_HEADERS: ReadonlySet<string> = Object.freeze(
  new Set(['authorization', 'cookie', 'proxy-authorization', 'www-authenticate']),
);

/** Patrón de cabeceras tipo clave de API, también eliminadas al cambiar de origen. */
const API_KEY_LIKE = /^(x-)?(api|auth|access|session|secret|private)[-_]?(key|token|secret|id)$/i;

export interface SanitizedHeaders {
  /** Pares listos para undici, con el nombre tal y como lo escribió el usuario. */
  readonly entries: Array<[string, string]>;
  /** Nombres eliminados, para el log estructurado. Nunca lleva valores. */
  readonly stripped: readonly string[];
}

export function sanitizeRequestHeaders(headers: readonly EngineHeader[]): SanitizedHeaders {
  const entries: Array<[string, string]> = [];
  const stripped: string[] = [];
  for (const header of headers) {
    const lower = header.name.trim().toLowerCase();
    if (lower === '') continue;
    // Inyección de cabecera por CR/LF: se rechaza el par completo.
    if (/[\r\n\0]/.test(header.name) || /[\r\n\0]/.test(header.value)) {
      stripped.push(lower);
      continue;
    }
    if (REJECTED_REQUEST_HEADERS.has(lower)) {
      stripped.push(lower);
      continue;
    }
    entries.push([header.name.trim(), header.value]);
  }
  return { entries, stripped };
}

export function isCrossOrigin(from: CanonicalTarget, to: CanonicalTarget): boolean {
  return from.scheme !== to.scheme || from.host.toLowerCase() !== to.host.toLowerCase() || from.port !== to.port;
}

/**
 * Cabeceras que se reenvían en el siguiente salto. Si el origen cambia, se
 * eliminan las que llevan credenciales.
 */
export function headersForRedirect(
  current: SanitizedHeaders,
  from: CanonicalTarget,
  to: CanonicalTarget,
): SanitizedHeaders {
  if (!isCrossOrigin(from, to)) return current;
  const entries: Array<[string, string]> = [];
  const stripped: string[] = [...current.stripped];
  for (const [name, value] of current.entries) {
    const lower = name.toLowerCase();
    if (CROSS_ORIGIN_STRIPPED_HEADERS.has(lower) || API_KEY_LIKE.test(lower)) {
      stripped.push(lower);
      continue;
    }
    entries.push([name, value]);
  }
  return { entries, stripped };
}
