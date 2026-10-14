/**
 * Servidor del motor. Fastify 5 desnudo, TRES rutas (ADR-0002):
 *
 *   POST /v1/execute          ejecuta una solicitud, síncrono
 *   POST /v1/execute/stream   igual, con SSE
 *   GET  /healthz             liveness, sin autenticación, sin red de salida
 *
 * Cualquier cuarta ruta necesita un ADR nuevo.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { executeRequestSchema } from './contract/engine-contract.ts';
import type { ExecuteResponse } from './contract/engine-contract.ts';
import { executeRequest } from './http/execute-request.use-case.ts';
import type { ExecuteDependencies } from './http/execute-request.use-case.ts';
import { createEgressPolicy } from './net/egress-policy.ts';
import type { EgressPolicy } from './net/egress-policy.ts';
import type { LookupAllResolver } from './net/guarded-connector.ts';
import type { EngineConfig } from './config.ts';

export const ENGINE_TOKEN_HEADER = 'x-ceiba-engine-token';

export interface BuildServerOptions {
  readonly config: EngineConfig;
  /** Política base. Por defecto, el conjunto denegado completo de CEIBA. */
  readonly policy?: EgressPolicy;
  /** Resolutor inyectable para las pruebas. */
  readonly resolver?: LookupAllResolver;
  readonly ca?: string | Buffer | Array<string | Buffer>;
  readonly logger?: boolean;
}

/** Comparación en tiempo constante, tolerante a longitudes distintas. */
export function tokensMatch(received: unknown, expected: string): boolean {
  if (typeof received !== 'string' || received === '') return false;
  const a = createHash('sha256').update(received, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b);
}

export function buildServer(options: BuildServerOptions): FastifyInstance {
  const { config } = options;
  const policy = options.policy ?? createEgressPolicy();

  const app = Fastify({
    logger: options.logger === false ? false : { level: config.logLevel },
    bodyLimit: 8 * 1024 * 1024,
    // No se usa `disableRequestLogging` (obsoleta en Fastify 5.12.7, avisa
    // FSTDEP023). El registro de entrada sólo ve `/v1/execute`, que no lleva
    // dato del usuario; el log de la ejecución lo emite `logOutcome`.
    // El motor va detrás de la API en una red interna; no se confía en
    // cabeceras de proxy para nada de seguridad.
    trustProxy: false,
  });

  // ---- Autenticación API -> motor ---------------------------------------
  // Es lo único que impide que cualquier proceso de la red de contenedores
  // use el motor como proxy de salida. `/healthz` queda fuera a propósito
  // (ADR-0002): es liveness y no toca la red de salida.
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.url === '/healthz' || req.url.startsWith('/healthz?')) return;
    if (!tokensMatch(req.headers[ENGINE_TOKEN_HEADER], config.engineToken)) {
      req.log.warn({ route: req.url, method: req.method }, 'testigo de motor ausente o inválido');
      await reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Testigo de motor requerido.' } });
    }
  });

  app.get('/healthz', async () => ({ status: 'ok', engine: 'ceiba', contract: 'v1' }));

  app.post('/v1/execute', async (req, reply) => {
    const parsed = executeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'INVALID_REQUEST', message: 'La petición no cumple el contrato del motor.' },
      });
    }
    const deps: ExecuteDependencies = {
      config,
      policy,
      ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
      ...(options.ca === undefined ? {} : { ca: options.ca }),
    };
    const result = await executeRequest(parsed.data, deps);
    logOutcome(req, result);
    return reply.code(200).send(result);
  });

  app.post('/v1/execute/stream', async (req, reply) => {
    const parsed = executeRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: { code: 'INVALID_REQUEST', message: 'La petición no cumple el contrato del motor.' },
      });
    }

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'close',
      'x-accel-buffering': 'no',
    });

    const send = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    send('started', { executionId: parsed.data.executionId });

    let lastReported = 0;
    const deps: ExecuteDependencies = {
      config,
      policy,
      ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
      ...(options.ca === undefined ? {} : { ca: options.ca }),
      onHeaders: (status, headers) => send('headers', { status, headers }),
      onProgress: (bytes) => {
        // Un evento cada 64 KiB: no se emite un SSE por chunk.
        if (bytes - lastReported >= 65_536) {
          lastReported = bytes;
          send('progress', { receivedBytes: bytes });
        }
      },
    };

    const result = await executeRequest(parsed.data, deps);
    logOutcome(req, result);
    send('result', result);
    reply.raw.end();
    return reply;
  });

  return app;
}

/**
 * ADR-0002, reglas transversales: se registra `executionId`, método, host,
 * `outcome`, timings y tamaños. Nunca cabeceras secretas, cuerpos ni la URL
 * con query string.
 */
function logOutcome(req: FastifyRequest, result: ExecuteResponse): void {
  req.log.info(
    {
      executionId: result.executionId,
      outcome: result.outcome,
      status: result.response?.status ?? null,
      sizeBytes: result.response?.sizeBytes ?? 0,
      totalMs: result.timings.totalMs,
      redirects: result.redirects.length,
      resolvedAddresses: result.resolvedAddresses,
      errorCode: result.error?.code ?? null,
    },
    'ejecución terminada',
  );
}
