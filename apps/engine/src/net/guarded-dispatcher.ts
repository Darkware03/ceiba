/**
 * C-SSRF-09 — La política se aplica a TODOS los clientes HTTP salientes.
 * C-SSRF-10 — El proxy del usuario está prohibido por defecto.
 *
 * Un único constructor de dispatchers, y es el único sitio del motor donde se
 * abre una conexión de salida. `fetch` global, `node:http` y `node:https`
 * están prohibidos: `process.versions.undici` en Node 24.21.0 es **7.29.1**,
 * una copia interna distinta de la dependencia declarada, y sale por un
 * dispatcher que NO tiene esta política. Hay una prueba de arquitectura que
 * falla si alguien los importa (`test/architecture.test.ts`).
 *
 * Se construye **un dispatcher por ejecución** y se destruye al terminar. Es
 * deliberado: el motor es sin estado (ADR-0002, regla 5) y así ningún socket
 * se reutiliza entre ejecuciones de usuarios distintos. El coste es perder el
 * keep-alive entre ejecuciones; frente a la latencia de un destino externo es
 * irrelevante.
 */
import { Agent } from 'undici';
import { createGuardedConnector } from './guarded-connector.ts';
import type { LookupAllResolver } from './guarded-connector.ts';
import type { EgressPolicy } from './egress-policy.ts';
import type { EgressAudit } from './audit.ts';

export interface GuardedAgentOptions {
  readonly policy: EgressPolicy;
  readonly audit: EgressAudit;
  readonly resolver?: LookupAllResolver;
  readonly connectTimeoutMs: number;
  /** Tiempo máximo hasta recibir las cabeceras de respuesta. */
  readonly headersTimeoutMs: number;
  /** Tiempo máximo entre dos bytes del cuerpo. */
  readonly bodyTimeoutMs: number;
  /** Verificación del certificado del destino. */
  readonly rejectUnauthorized: boolean;
  /** CA adicional, sólo para las pruebas con TLS local. */
  readonly ca?: string | Buffer | Array<string | Buffer>;
}

export function createGuardedAgent(options: GuardedAgentOptions): Agent {
  const connector = createGuardedConnector({
    policy: options.policy,
    audit: options.audit,
    ...(options.resolver === undefined ? {} : { resolver: options.resolver }),
    connectTimeoutMs: options.connectTimeoutMs,
    rejectUnauthorized: options.rejectUnauthorized,
    ...(options.ca === undefined ? {} : { ca: options.ca }),
  });

  return new Agent({
    connect: connector,
    headersTimeout: options.headersTimeoutMs,
    bodyTimeout: options.bodyTimeoutMs,
    // NO se compone `interceptors.redirect`: sin él, undici NUNCA sigue una
    // redirección por su cuenta y el bucle de saltos es del motor (C-SSRF-07,
    // opción A). En undici 8.x `maxRedirections` como opción de petición está
    // retirado y sólo se acepta el valor 0, así que no se pasa en absoluto.
    // Sin reintentos automáticos: reenviar un POST del usuario puede duplicar
    // efectos (ADR-0002, reglas transversales).
    pipelining: 0,
    connections: 1,
    // HTTP/2 desactivado en v1: una superficie menos en el proceso que ejecuta
    // entrada hostil. Declarado en MOTOR-HTTP.md.
    allowH2: false,
    // Se exige coherencia entre Content-Length y el cuerpo recibido.
    strictContentLength: true,
  });
}

/**
 * C-SSRF-10: el proceso del motor debe arrancar SIN variables de proxy. Si un
 * cambio de despliegue las define, la política de destino se evaluaría contra
 * el proxy y no contra el destino final. Se falla cerrado en el arranque en
 * vez de ignorarlas en silencio.
 */
export const PROXY_ENV_VARS: readonly string[] = Object.freeze([
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
]);

export function assertNoProxyEnvironment(env: NodeJS.ProcessEnv): void {
  const found = PROXY_ENV_VARS.filter((name) => {
    const value = env[name];
    return typeof value === 'string' && value.trim() !== '';
  });
  if (found.length > 0) {
    throw new Error(
      `C-SSRF-10: el motor no puede arrancar con variables de proxy definidas (${found.join(', ')}). ` +
        'Un proxy anula la política de destino. Quítalas del despliegue.',
    );
  }
}
