/**
 * Configuración del motor. Lee EXCLUSIVAMENTE las variables que el motor
 * puede ver (ADR-0002, reglas 1 y 2):
 *
 *  - NO lee `DATABASE_URL` ni nada de PostgreSQL.
 *  - NO lee `CEIBA_SECRETS_MASTER_KEY`.
 *  - NO lee `REDIS_URL` ni `CEIBA_JWT_SECRET`.
 *
 * Y falla CERRADO: sin `CEIBA_ENGINE_TOKEN` el motor no arranca, y
 * `CEIBA_SSRF_PROTECTION` distinto de `on` es un error de arranque, no un
 * interruptor. Las excepciones se autorizan por destino concreto (C-SSRF-11),
 * nunca desactivando el control global.
 */
import { assertNoProxyEnvironment } from './net/guarded-dispatcher.ts';

export interface EngineConfig {
  readonly nodeEnv: string;
  readonly host: string;
  readonly port: number;
  readonly logLevel: string;
  /** Testigo compartido API -> motor. Nunca se registra. */
  readonly engineToken: string;
  readonly maxResponseBytes: number;
  readonly timeoutMs: number;
  readonly maxRedirects: number;
  readonly connectTimeoutMs: number;
  readonly headersTimeoutMs: number;
  readonly bodyTimeoutMs: number;
  /** Tope de cuerpo devuelto a la API si la petición no lo acota. */
  readonly defaultMaxStoredBytes: number;
}

/** Variables que el motor tiene PROHIBIDO usar (ADR-0002, reglas 1 y 2). */
export const FORBIDDEN_ENV_VARS: readonly string[] = Object.freeze([
  'DATABASE_URL',
  'POSTGRES_PASSWORD',
  'CEIBA_SECRETS_MASTER_KEY',
  'CEIBA_JWT_SECRET',
  'CEIBA_SHARE_CODE_PEPPER',
]);

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function readInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`${name} debe ser un entero positivo; se recibió ${JSON.stringify(raw)}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): EngineConfig {
  // C-SSRF-10: ninguna variable de proxy, o el motor no arranca.
  assertNoProxyEnvironment(env);

  // ADR-0002 regla 1 y 2: si el despliegue le pasa credenciales al motor, es
  // un fallo de topología. Se falla ruidosamente en vez de aceptarlo.
  const leaked = FORBIDDEN_ENV_VARS.filter((name) => {
    const value = env[name];
    return typeof value === 'string' && value.trim() !== '';
  });
  if (leaked.length > 0) {
    throw new ConfigError(
      `ADR-0002: el motor no puede recibir ${leaked.join(', ')}. ` +
        'Revisa la topología de despliegue: el motor va en su propia red, sin credenciales.',
    );
  }

  const token = env.CEIBA_ENGINE_TOKEN;
  if (token === undefined || token.trim().length < 32) {
    throw new ConfigError(
      'CEIBA_ENGINE_TOKEN es obligatorio y debe tener al menos 32 caracteres. ' +
        'Es lo único que impide que cualquier proceso de la red de contenedores use el motor como proxy de salida.',
    );
  }

  const protection = (env.CEIBA_SSRF_PROTECTION ?? 'on').trim().toLowerCase();
  if (protection !== 'on') {
    throw new ConfigError(
      `CEIBA_SSRF_PROTECTION sólo admite "on"; se recibió ${JSON.stringify(protection)}. ` +
        'La protección no se desactiva globalmente: las excepciones se autorizan por destino (C-SSRF-11).',
    );
  }

  const timeoutMs = readInt(env, 'CEIBA_ENGINE_TIMEOUT_MS', 30_000);
  const maxResponseBytes = readInt(env, 'CEIBA_ENGINE_MAX_RESPONSE_BYTES', 26_214_400);

  const maxRedirectsRaw = env.CEIBA_ENGINE_MAX_REDIRECTS;
  let maxRedirects = 5;
  if (maxRedirectsRaw !== undefined && maxRedirectsRaw.trim() !== '') {
    const value = Number(maxRedirectsRaw);
    if (!Number.isInteger(value) || value < 0) {
      throw new ConfigError('CEIBA_ENGINE_MAX_REDIRECTS debe ser un entero >= 0');
    }
    // C-SSRF-07: máximo administrativo 10.
    if (value > 10) {
      throw new ConfigError('CEIBA_ENGINE_MAX_REDIRECTS no puede superar 10 (C-SSRF-07)');
    }
    maxRedirects = value;
  }

  return Object.freeze({
    nodeEnv: env.NODE_ENV ?? 'development',
    host: env.CEIBA_ENGINE_HOST ?? '0.0.0.0',
    port: readInt(env, 'CEIBA_ENGINE_PORT', 3001),
    logLevel: env.LOG_LEVEL ?? 'info',
    engineToken: token,
    maxResponseBytes,
    timeoutMs,
    maxRedirects,
    connectTimeoutMs: readInt(env, 'CEIBA_ENGINE_CONNECT_TIMEOUT_MS', 5_000),
    headersTimeoutMs: readInt(env, 'CEIBA_ENGINE_HEADERS_TIMEOUT_MS', 10_000),
    bodyTimeoutMs: readInt(env, 'CEIBA_ENGINE_BODY_TIMEOUT_MS', 30_000),
    defaultMaxStoredBytes: readInt(env, 'CEIBA_ENGINE_MAX_STORED_BYTES', 1_048_576),
  });
}
