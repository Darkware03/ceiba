/**
 * Caso de uso `POST /v1/execute` (ADR-0002, contrato v1).
 *
 * C-SSRF-07 — bucle de redirecciones con la política COMPLETA en cada salto.
 * C-SSRF-08 — límites de recurso aplicados en streaming.
 *
 * Invariantes:
 *  - El motor es SIN ESTADO: todo (dispatcher, auditoría, contadores) se crea
 *    y se destruye dentro de esta función.
 *  - Un fallo de red, un bloqueo SSRF o un timeout son **HTTP 200 con
 *    `outcome != "completed"`**, nunca un 5xx.
 *  - `SSRF_BLOCKED` no revela la IP ni la regla al llamante.
 */
import { request as undiciRequest } from 'undici';
import type { Dispatcher } from 'undici';
import { EgressError, EngineRequestError, isEgressError } from '../net/errors.ts';
import { normalizeTarget } from '../net/normalize-target.ts';
import type { CanonicalTarget } from '../net/normalize-target.ts';
import { assertAllowRuleIsLegal } from '../net/egress-policy.ts';
import type { EgressPolicy, EgressAllowRule } from '../net/egress-policy.ts';
import { createExecutionAudit } from '../net/audit.ts';
import type { ExecutionAudit } from '../net/audit.ts';
import { createGuardedAgent } from '../net/guarded-dispatcher.ts';
import type { LookupAllResolver } from '../net/guarded-connector.ts';
import { buildBody } from './build-body.ts';
import { sanitizeRequestHeaders, headersForRedirect, isCrossOrigin } from './header-policy.ts';
import type { SanitizedHeaders } from './header-policy.ts';
import { statusText } from './status-text.ts';
import { PUBLIC_ERROR_MESSAGES } from '../contract/engine-contract.ts';
import type {
  EngineErrorCode,
  EngineOutcome,
  EngineRedirectHop,
  EngineResponsePayload,
  ExecuteRequestInput,
  ExecuteResponse,
} from '../contract/engine-contract.ts';
import type { EngineConfig } from '../config.ts';

const REDIRECT_STATUSES: ReadonlySet<number> = Object.freeze(new Set([301, 302, 303, 307, 308]));

export interface ExecuteDependencies {
  readonly config: EngineConfig;
  /** Política base. En producción se construye una vez al arrancar. */
  readonly policy: EgressPolicy;
  /** Resolutor inyectable: las pruebas no usan DNS real. */
  readonly resolver?: LookupAllResolver;
  /** CA extra para las pruebas con TLS local autofirmado. */
  readonly ca?: string | Buffer | Array<string | Buffer>;
  /** Progreso de bytes para el endpoint SSE. */
  readonly onProgress?: (receivedBytes: number) => void;
  /** Aviso de cabeceras recibidas, para el endpoint SSE. */
  readonly onHeaders?: (status: number, headers: Array<{ name: string; value: string }>) => void;
}

interface EffectiveLimits {
  readonly timeoutMs: number;
  readonly maxRedirects: number;
  readonly maxResponseBytes: number;
  readonly maxStoredBytes: number;
}

export async function executeRequest(
  input: ExecuteRequestInput,
  deps: ExecuteDependencies,
): Promise<ExecuteResponse> {
  const started = performance.now();
  const audit = createExecutionAudit();
  const redirects: EngineRedirectHop[] = [];
  let ttfbMs = 0;

  const finish = (
    outcome: EngineOutcome,
    response: EngineResponsePayload | null,
    code: EngineErrorCode | null,
  ): ExecuteResponse => buildResult(input, outcome, response, code, audit, redirects, started, ttfbMs);

  // --- Scripts: declarados en el contrato, NO implementados en v1 ----------
  if (input.scripts != null && (nonEmpty(input.scripts.preRequest) || nonEmpty(input.scripts.postResponse))) {
    return finish('failed', null, 'SCRIPT_ERROR');
  }

  const limits = resolveLimits(input, deps.config);

  // --- Política efectiva de esta ejecución (C-SSRF-11) --------------------
  let policy: EgressPolicy;
  try {
    policy = resolvePolicy(input, deps.policy);
  } catch (err) {
    if (isEgressError(err)) return finish('blocked', null, 'SSRF_BLOCKED');
    return finish('failed', null, 'INVALID_REQUEST');
  }

  // --- Cuerpo ya resuelto --------------------------------------------------
  let built;
  try {
    built = buildBody(input.request.body ?? null);
  } catch (err) {
    if (err instanceof EngineRequestError) return finish('failed', null, 'INVALID_REQUEST');
    throw err;
  }

  let headers = sanitizeRequestHeaders(input.request.headers);
  if (built.contentType !== null && !hasHeader(headers, 'content-type')) {
    headers = { entries: [...headers.entries, ['content-type', built.contentType]], stripped: headers.stripped };
  }

  const rejectUnauthorized = input.policy.tls?.rejectUnauthorized ?? true;
  if (input.policy.tls?.clientCertRef != null && input.policy.tls.clientCertRef !== '') {
    // Certificado de cliente: declarado en el contrato, NO implementado en v1.
    return finish('failed', null, 'INVALID_REQUEST');
  }

  const agent = createGuardedAgent({
    policy,
    audit,
    ...(deps.resolver === undefined ? {} : { resolver: deps.resolver }),
    connectTimeoutMs: Math.min(deps.config.connectTimeoutMs, limits.timeoutMs),
    headersTimeoutMs: Math.min(deps.config.headersTimeoutMs, limits.timeoutMs),
    bodyTimeoutMs: Math.min(deps.config.bodyTimeoutMs, limits.timeoutMs),
    rejectUnauthorized,
    ...(deps.ca === undefined ? {} : { ca: deps.ca }),
  });

  // Presupuesto TOTAL de la ejecución, redirecciones incluidas. Los timeouts
  // de undici son por fase; una respuesta que gotea dentro de `bodyTimeout`
  // podría durar indefinidamente sin este corte (C-SSRF-08).
  const abort = AbortSignal.timeout(limits.timeoutMs);

  try {
    let method: string = input.request.method;
    let bodyBuffer: Buffer | null = built.buffer;
    let currentHeaders: SanitizedHeaders = headers;
    let target: CanonicalTarget;

    try {
      target = normalizeTarget(input.request.url, undefined, 'preflight-url');
      policy.assertSchemeAndPort(target, 'preflight-url');
      await preflight(target, policy, audit, deps.resolver, 0);
    } catch (err) {
      return mapError(err, finish);
    }

    const visited = new Set<string>([target.href]);

    for (let hop = 0; ; hop += 1) {
      let response: Dispatcher.ResponseData;
      const hopStart = performance.now();
      try {
        response = await undiciRequest(target.href, {
          dispatcher: agent,
          method: method as Dispatcher.HttpMethod,
          // undici exige una lista PLANA de longitud par (o un objeto). Un
          // array de pares produce `UND_ERR_INVALID_ARG: headers array must be
          // even`. Se usa la lista plana para no perder cabeceras repetidas.
          headers: flattenRequestHeaders(currentHeaders),
          ...(bodyBuffer === null || method === 'GET' || method === 'HEAD' ? {} : { body: bodyBuffer }),
          signal: abort,
          // Sin `maxRedirections`: en undici 8.x esa opción de petición está
          // retirada y el agente no compone el interceptor de redirección, así
          // que undici nunca sigue un 3xx. El bucle de saltos es de este
          // fichero (C-SSRF-07, opción A).
        });
      } catch (err) {
        return mapError(err, finish);
      }
      if (ttfbMs === 0) ttfbMs = round(performance.now() - hopStart);

      const responseHeaders = flattenHeaders(response.headers);
      deps.onHeaders?.(response.statusCode, responseHeaders);

      // ---- ¿Redirección? ---------------------------------------------------
      const location = headerValue(responseHeaders, 'location');
      const followRedirects = input.policy.followRedirects;
      if (followRedirects && REDIRECT_STATUSES.has(response.statusCode) && location !== null) {
        await dumpBody(response);

        if (hop >= limits.maxRedirects) {
          return finish('failed', null, 'TOO_MANY_REDIRECTS');
        }

        let next: CanonicalTarget;
        try {
          next = normalizeTarget(location, target.href, 'redirect-url');
          policy.assertSchemeAndPort(next, 'redirect-url');
          // POLÍTICA COMPLETA EN CADA SALTO: no basta con validar la URL.
          await preflight(next, policy, audit, deps.resolver, hop + 1);
        } catch (err) {
          return mapError(err, finish);
        }

        if (visited.has(next.href)) {
          return finish('failed', null, 'TOO_MANY_REDIRECTS');
        }
        visited.add(next.href);

        redirects.push({ status: response.statusCode, from: redact(target), to: redact(next) });
        currentHeaders = headersForRedirect(currentHeaders, target, next);

        if (response.statusCode === 303 || ((response.statusCode === 301 || response.statusCode === 302) && method !== 'GET' && method !== 'HEAD')) {
          // 303 siempre, y 301/302 sobre métodos con cuerpo: se convierte a GET
          // y se descarta el cuerpo (comportamiento de los clientes reales).
          method = 'GET';
          bodyBuffer = null;
          currentHeaders = {
            entries: currentHeaders.entries.filter(([name]) => name.toLowerCase() !== 'content-type'),
            stripped: currentHeaders.stripped,
          };
        }
        // 307/308 conservan método y cuerpo: por eso la revalidación anterior
        // es imprescindible, el cuerpo con secretos viajaría al nuevo destino.

        if (isCrossOrigin(target, next)) {
          // Nada más que hacer: `headersForRedirect` ya quitó las credenciales.
        }
        target = next;
        continue;
      }

      // ---- Respuesta final: lectura con tope duro en streaming -------------
      try {
        const payload = await readBody(response, limits, input.capture.storeBody, deps.onProgress);
        return finish('completed', payload, null);
      } catch (err) {
        if (err instanceof ResponseTooLargeError) return finish('too_large', null, 'RESPONSE_TOO_LARGE');
        return mapError(err, finish);
      }
    }
  } finally {
    await agent.close().catch(() => agent.destroy());
  }
}

// ---------------------------------------------------------------------------
// Capa 1 — preflight (UX + fallo rápido). Su veredicto NO autoriza nada.
// ---------------------------------------------------------------------------

async function preflight(
  target: CanonicalTarget,
  policy: EgressPolicy,
  audit: ExecutionAudit,
  resolver: LookupAllResolver | undefined,
  hop: number,
): Promise<void> {
  if (target.hostKind !== 'dns') {
    policy.assertAddressAllowed(target.host, null, hop === 0 ? 'preflight-literal' : 'redirect-literal');
    return;
  }
  if (resolver === undefined) return; // sin resolutor inyectado, decide la capa 2

  const where = hop === 0 ? 'preflight-dns' : 'redirect-dns';
  const addresses = await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
    resolver(target.host, { all: true, verbatim: true, family: 0 }, (err, addrs) => {
      if (err) reject(new EgressError('EGRESS_DNS_FAILURE', where, target.host));
      else resolve(addrs);
    });
  });

  let firstBlocked: EgressError | null = null;
  let anyAllowed = false;
  for (const entry of addresses) {
    try {
      policy.assertAddressAllowed(entry?.address, entry?.family, where);
      anyAllowed = true;
    } catch (err) {
      if (isEgressError(err) && firstBlocked === null) firstBlocked = err;
      audit.blocked({
        host: target.host,
        address: String(entry?.address),
        where,
        reason: isEgressError(err) ? err.code : 'EGRESS_BAD_ADDRESS',
      });
    }
  }
  if (!anyAllowed) {
    throw firstBlocked ?? new EgressError('EGRESS_BLOCKED_ALL_ADDRESSES', where, target.host);
  }
}

// ---------------------------------------------------------------------------
// C-SSRF-08 — lectura del cuerpo con tope duro
// ---------------------------------------------------------------------------

class ResponseTooLargeError extends Error {}

async function readBody(
  response: Dispatcher.ResponseData,
  limits: EffectiveLimits,
  storeBody: boolean,
  onProgress?: (bytes: number) => void,
): Promise<EngineResponsePayload> {
  const chunks: Buffer[] = [];
  let received = 0;
  let stored = 0;
  let truncated = false;

  try {
    for await (const chunk of response.body) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as ArrayBufferLike);
      received += buf.length;
      // El tope NO se comprueba sobre `Content-Length`: es una declaración del
      // atacante. Se cuenta lo que realmente llega y se corta el socket.
      if (received > limits.maxResponseBytes) {
        response.body.destroy();
        throw new ResponseTooLargeError();
      }
      onProgress?.(received);
      if (storeBody && stored < limits.maxStoredBytes) {
        const room = limits.maxStoredBytes - stored;
        if (buf.length <= room) {
          chunks.push(buf);
          stored += buf.length;
        } else {
          chunks.push(buf.subarray(0, room));
          stored += room;
          truncated = true;
        }
      } else if (storeBody) {
        truncated = true;
      }
    }
  } catch (err) {
    if (err instanceof ResponseTooLargeError) throw err;
    throw err;
  }

  const headers = flattenHeaders(response.headers);
  const contentType = headerValue(headers, 'content-type') ?? '';
  const buffer = Buffer.concat(chunks);
  const encoding = chooseEncoding(contentType, buffer);

  return {
    status: response.statusCode,
    statusText: statusText(response.statusCode),
    httpVersion: '1.1',
    headers,
    bodyEncoding: encoding,
    body: storeBody ? buffer.toString(encoding) : '',
    bodyTruncated: truncated,
    sizeBytes: received,
  };
}

const TEXTUAL = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|graphql)|application\/[a-z0-9.+-]*\+(json|xml))/i;

function chooseEncoding(contentType: string, buffer: Buffer): 'utf8' | 'base64' {
  const declared = contentType.trim();
  if (declared === '') {
    // Sin `Content-Type` se husmea: UTF-8 válido y sin bytes de control => texto.
    if (buffer.includes(0)) return 'base64';
    return Buffer.byteLength(buffer.toString('utf8'), 'utf8') === buffer.length ? 'utf8' : 'base64';
  }
  if (!TEXTUAL.test(declared)) return 'base64';
  // Round-trip: si el cuerpo declarado textual no es UTF-8 válido, se devuelve
  // en base64 en vez de corromperlo con U+FFFD.
  const text = buffer.toString('utf8');
  return Buffer.byteLength(text, 'utf8') === buffer.length ? 'utf8' : 'base64';
}

async function dumpBody(response: Dispatcher.ResponseData): Promise<void> {
  try {
    await response.body.dump({ limit: 64 * 1024 });
  } catch {
    response.body.destroy();
  }
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function resolveLimits(input: ExecuteRequestInput, config: EngineConfig): EffectiveLimits {
  // El usuario sólo puede REDUCIR los topes administrativos, nunca subirlos.
  const timeoutMs = Math.min(input.policy.timeoutMs ?? config.timeoutMs, config.timeoutMs);
  const maxRedirects = Math.min(input.policy.maxRedirects ?? config.maxRedirects, config.maxRedirects);
  const maxResponseBytes = Math.min(
    input.policy.maxResponseBytes ?? config.maxResponseBytes,
    config.maxResponseBytes,
  );
  const maxStoredBytes = Math.min(
    input.capture.maxStoredBytes ?? config.defaultMaxStoredBytes,
    maxResponseBytes,
  );
  return { timeoutMs, maxRedirects, maxResponseBytes, maxStoredBytes };
}

function resolvePolicy(input: ExecuteRequestInput, base: EgressPolicy): EgressPolicy {
  const destinations = input.policy.allowedDestinations;
  if (input.policy.ssrfProfile !== 'allowlisted') {
    if (destinations.length > 0) {
      throw new EngineRequestError('allowedDestinations exige ssrfProfile="allowlisted"', 'policy');
    }
    return base;
  }
  const rules: EgressAllowRule[] = destinations.map((d) => ({
    cidr: d.cidr,
    port: d.port ?? null,
    scheme: d.scheme ?? null,
    expiresAt: d.expiresAt,
    ...(d.id === undefined ? {} : { id: d.id }),
  }));
  for (const rule of rules) assertAllowRuleIsLegal(rule); // C-SSRF-11
  return base.withAllowRules(rules);
}

function nonEmpty(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

function hasHeader(headers: SanitizedHeaders, name: string): boolean {
  return headers.entries.some(([key]) => key.toLowerCase() === name);
}

function flattenRequestHeaders(headers: SanitizedHeaders): string[] {
  const flat: string[] = [];
  for (const [name, value] of headers.entries) {
    flat.push(name, value);
  }
  return flat;
}

/**
 * Busca una `EgressError` en la cadena de causas y dentro de un
 * `AggregateError`. undici envuelve los errores del connector, y un bloqueo
 * NO puede degradarse a «fallo de red genérico» por el camino.
 */
function findEgressError(err: unknown, depth = 0): EgressError | null {
  if (depth > 6 || err === null || err === undefined) return null;
  if (isEgressError(err)) return err;
  if (err instanceof AggregateError) {
    for (const inner of err.errors) {
      const found = findEgressError(inner, depth + 1);
      if (found !== null) return found;
    }
  }
  return findEgressError((err as { cause?: unknown }).cause, depth + 1);
}

/** Igual, para el corte de la capa 3 (`net.BlockList` en `net.connect`). */
function hasIpBlocked(err: unknown, depth = 0): boolean {
  if (depth > 6 || err === null || err === undefined) return false;
  if ((err as { code?: string }).code === 'ERR_IP_BLOCKED') return true;
  if (err instanceof AggregateError && err.errors.some((e) => hasIpBlocked(e, depth + 1))) return true;
  return hasIpBlocked((err as { cause?: unknown }).cause, depth + 1);
}

function headerValue(headers: Array<{ name: string; value: string }>, name: string): string | null {
  for (const header of headers) {
    if (header.name.toLowerCase() === name) return header.value;
  }
  return null;
}

function flattenHeaders(raw: Dispatcher.ResponseData['headers']): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) out.push({ name, value: String(item) });
    } else {
      out.push({ name, value: String(value) });
    }
  }
  return out;
}

/** Sin query string: ADR-0002 prohíbe registrar la URL completa. */
function redact(target: CanonicalTarget): string {
  return `${target.scheme}//${target.host}:${target.port}${target.url.pathname}`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function mapError(
  err: unknown,
  finish: (outcome: EngineOutcome, response: null, code: EngineErrorCode) => ExecuteResponse,
): ExecuteResponse {
  const egress = findEgressError(err);
  if (egress !== null) {
    if (egress.code === 'EGRESS_DNS_FAILURE') return finish('failed', null, 'DNS_FAILURE');
    return finish('blocked', null, 'SSRF_BLOCKED');
  }
  if (hasIpBlocked(err)) return finish('blocked', null, 'SSRF_BLOCKED');
  if (err instanceof EngineRequestError) return finish('failed', null, 'INVALID_REQUEST');

  const code = (err as { code?: string } | null)?.code;
  const name = (err as { name?: string } | null)?.name;
  const cause = (err as { cause?: { code?: string } } | null)?.cause?.code;

  if (name === 'TimeoutError' || name === 'AbortError' || code === 'UND_ERR_ABORTED') {
    return finish('timeout', null, 'TIMEOUT');
  }
  if (code === 'UND_ERR_HEADERS_TIMEOUT' || code === 'UND_ERR_BODY_TIMEOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    return finish('timeout', null, 'TIMEOUT');
  }
  if (code === 'ECONNREFUSED' || cause === 'ECONNREFUSED') return finish('failed', null, 'CONNECTION_REFUSED');
  if (code === 'ECONNRESET' || cause === 'ECONNRESET' || code === 'UND_ERR_SOCKET') {
    return finish('failed', null, 'CONNECTION_RESET');
  }
  if (code === 'UND_ERR_INVALID_ARG') return finish('failed', null, 'INVALID_REQUEST');
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || cause === 'ENOTFOUND' || cause === 'EAI_AGAIN') {
    return finish('failed', null, 'DNS_FAILURE');
  }
  if (typeof code === 'string' && (code.startsWith('ERR_TLS') || code.startsWith('ERR_SSL') || code === 'CERT_HAS_EXPIRED' || code === 'DEPTH_ZERO_SELF_SIGNED_CERT')) {
    return finish('failed', null, 'TLS_ERROR');
  }
  if (typeof cause === 'string' && (cause.startsWith('ERR_TLS') || cause.startsWith('ERR_SSL') || cause === 'DEPTH_ZERO_SELF_SIGNED_CERT' || cause === 'SELF_SIGNED_CERT_IN_CHAIN')) {
    return finish('failed', null, 'TLS_ERROR');
  }
  return finish('failed', null, 'CONNECTION_RESET');
}

function buildResult(
  input: ExecuteRequestInput,
  outcome: EngineOutcome,
  response: EngineResponsePayload | null,
  code: EngineErrorCode | null,
  audit: ExecutionAudit,
  redirects: EngineRedirectHop[],
  started: number,
  ttfbMs: number,
): ExecuteResponse {
  const connection = audit.connections.at(-1);
  return {
    executionId: input.executionId,
    outcome,
    response,
    timings: {
      dnsMs: round(connection?.dnsMs ?? 0),
      tcpMs: round(connection?.tcpMs ?? 0),
      tlsMs: round(connection?.tlsMs ?? 0),
      ttfbMs,
      totalMs: round(performance.now() - started),
    },
    redirects,
    tls: audit.tlsInfo,
    resolvedAddresses: [...audit.resolvedAddresses],
    scriptResults: null,
    error: code === null ? null : { code, message: PUBLIC_ERROR_MESSAGES[code] },
  };
}
