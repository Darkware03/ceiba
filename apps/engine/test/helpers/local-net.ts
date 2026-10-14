/**
 * Utilidades de prueba: servidores HTTP locales y resolutor DNS inyectado.
 *
 * NADA de esto toca la red real ni el DNS real. El `appsec-engineer` demostró
 * en fase 0 que con `127.0.0.1` haciendo de "destino público", `127.0.0.2`
 * haciendo de "servicio interno" y un `lookup` inyectado se reproduce el
 * ataque completo y su bloqueo.
 *
 * `node:http` se usa AQUÍ, en las pruebas, para levantar los destinos. En
 * `src/` está prohibido (C-SSRF-09) y hay una prueba de arquitectura que lo
 * comprueba.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { CEIBA_DEFAULT_DENY_RULES } from '../../src/net/egress-policy.ts';
import type { LookupAllResolver } from '../../src/net/guarded-connector.ts';
import type { EngineConfig } from '../../src/config.ts';

/**
 * Conjunto denegado DE PRUEBA.
 *
 * En producción jamás se usa: el motor construye `CEIBA_DEFAULT_DENY_RULES`.
 * Aquí se parte el loopback en dos para poder tener a la vez un destino
 * legítimo y un "servicio interno" prohibido sin red real:
 *
 *   127.0.0.1  -> destino "público" permitido
 *   127.0.0.2  -> "servicio interno" prohibido
 */
export const TEST_DENY_RULES: readonly string[] = Object.freeze([
  ...CEIBA_DEFAULT_DENY_RULES.filter((rule) => rule !== '127.0.0.0/8' && rule !== '0.0.0.0/8'),
  '127.0.0.2/32',
]);

export interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface TestServer {
  readonly port: number;
  readonly host: string;
  readonly origin: string;
  readonly requests: RecordedRequest[];
  close(): Promise<void>;
}

export async function startServer(
  host: string,
  handler: (req: http.IncomingMessage, res: http.ServerResponse, recorded: RecordedRequest) => void,
): Promise<TestServer> {
  const requests: RecordedRequest[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const recorded: RecordedRequest = {
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(recorded);
      handler(req, res, recorded);
    });
  });
  server.on('clientError', (_err, socket) => socket.destroy());

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => resolve());
  });

  const port = (server.address() as AddressInfo).port;
  return {
    port,
    host,
    origin: `http://${host}:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** Resolutor que devuelve siempre lo mismo para cada nombre. */
export function staticResolver(table: Record<string, Array<{ address: string; family: number }>>): LookupAllResolver {
  return (hostname, _options, callback) => {
    const entry = table[hostname];
    if (entry === undefined) {
      const err = new Error(`getaddrinfo ENOTFOUND ${hostname}`) as NodeJS.ErrnoException;
      err.code = 'ENOTFOUND';
      queueMicrotask(() => callback(err, []));
      return;
    }
    queueMicrotask(() => callback(null, entry));
  };
}

export interface SequenceResolver extends LookupAllResolver {
  readonly calls: string[];
}

/**
 * Resolutor de DNS REBINDING: devuelve respuestas distintas en llamadas
 * sucesivas para el mismo nombre. Es el doble que reproduce el TOCTOU sin DNS
 * real.
 */
export function sequenceResolver(
  table: Record<string, Array<Array<{ address: string; family: number }>>>,
): SequenceResolver {
  const counters = new Map<string, number>();
  const calls: string[] = [];
  const fn = ((hostname, _options, callback) => {
    calls.push(hostname);
    const answers = table[hostname];
    if (answers === undefined || answers.length === 0) {
      const err = new Error(`getaddrinfo ENOTFOUND ${hostname}`) as NodeJS.ErrnoException;
      err.code = 'ENOTFOUND';
      queueMicrotask(() => callback(err, []));
      return;
    }
    const index = counters.get(hostname) ?? 0;
    counters.set(hostname, index + 1);
    const answer = answers[Math.min(index, answers.length - 1)] as Array<{ address: string; family: number }>;
    queueMicrotask(() => callback(null, answer));
  }) as SequenceResolver;
  Object.defineProperty(fn, 'calls', { get: () => calls });
  return fn;
}

export function v4(address: string): Array<{ address: string; family: number }> {
  return [{ address, family: 4 }];
}

/** Configuración de motor para pruebas. No lee `process.env`. */
export function testConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  return Object.freeze({
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    logLevel: 'silent',
    engineToken: 'token-de-pruebas-con-mas-de-32-caracteres-xyz',
    maxResponseBytes: 26_214_400,
    timeoutMs: 5_000,
    maxRedirects: 5,
    connectTimeoutMs: 2_000,
    headersTimeoutMs: 2_000,
    bodyTimeoutMs: 2_000,
    defaultMaxStoredBytes: 1_048_576,
    ...overrides,
  });
}

/** Petición mínima válida del contrato v1. */
export function executeInput(url: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    executionId: '01JB2XTESTEXECUTION0001',
    request: { method: 'GET', url },
    ...overrides,
  };
}
