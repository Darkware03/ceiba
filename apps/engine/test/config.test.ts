/**
 * Arranque FALLANDO CERRADO.
 *
 * ADR-0002 reglas 1 y 2 (sin credenciales de base de datos ni clave maestra),
 * C-SSRF-10 (sin variables de proxy) y la regla del `.env.example`: el motor
 * RECHAZA toda petición sin `CEIBA_ENGINE_TOKEN`, y la protección SSRF no se
 * desactiva globalmente.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError, FORBIDDEN_ENV_VARS } from '../src/config.ts';
import { assertNoProxyEnvironment, PROXY_ENV_VARS } from '../src/net/guarded-dispatcher.ts';

const TOKEN_VALIDO = 'un-testigo-de-al-menos-32-caracteres-de-largo';

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { CEIBA_ENGINE_TOKEN: TOKEN_VALIDO, CEIBA_SSRF_PROTECTION: 'on', ...extra };
}

test('sin CEIBA_ENGINE_TOKEN el motor NO arranca', () => {
  assert.throws(() => loadConfig({}), ConfigError);
  assert.throws(() => loadConfig({ CEIBA_ENGINE_TOKEN: '' }), ConfigError);
  assert.throws(() => loadConfig({ CEIBA_ENGINE_TOKEN: '   ' }), ConfigError);
  assert.throws(() => loadConfig({ CEIBA_ENGINE_TOKEN: 'corto' }), ConfigError);
  assert.throws(() => loadConfig({ CEIBA_ENGINE_TOKEN: 'a'.repeat(31) }), ConfigError);
  assert.doesNotThrow(() => loadConfig({ CEIBA_ENGINE_TOKEN: 'a'.repeat(32) }));
});

test('CEIBA_SSRF_PROTECTION sólo admite "on"', () => {
  for (const valor of ['off', 'false', '0', 'no', 'disabled', 'ON=off', '']) {
    if (valor === '') continue;
    assert.throws(
      () => loadConfig(env({ CEIBA_SSRF_PROTECTION: valor })),
      ConfigError,
      `"${valor}" no puede aceptarse`,
    );
  }
  assert.doesNotThrow(() => loadConfig(env({ CEIBA_SSRF_PROTECTION: 'ON' })));
  assert.doesNotThrow(() => loadConfig(env({ CEIBA_SSRF_PROTECTION: ' on ' })));
  // Ausente = activada por defecto.
  assert.doesNotThrow(() => loadConfig({ CEIBA_ENGINE_TOKEN: TOKEN_VALIDO }));
});

test('ADR-0002: el motor se niega a arrancar si le pasan credenciales', () => {
  for (const prohibida of FORBIDDEN_ENV_VARS) {
    assert.throws(
      () => loadConfig(env({ [prohibida]: 'valor-cualquiera' })),
      (err: unknown) => err instanceof ConfigError && err.message.includes(prohibida),
      `${prohibida} debe abortar el arranque`,
    );
  }
  assert.ok(FORBIDDEN_ENV_VARS.includes('DATABASE_URL'));
  assert.ok(FORBIDDEN_ENV_VARS.includes('CEIBA_SECRETS_MASTER_KEY'));
});

test('C-SSRF-10: el motor se niega a arrancar con variables de proxy', () => {
  for (const variable of PROXY_ENV_VARS) {
    assert.throws(
      () => loadConfig(env({ [variable]: 'http://proxy:8080' })),
      (err: unknown) => err instanceof Error && err.message.includes(variable),
      `${variable} debe abortar el arranque`,
    );
  }
  assert.doesNotThrow(() => assertNoProxyEnvironment({}));
  assert.doesNotThrow(() => assertNoProxyEnvironment({ HTTP_PROXY: '' }));
});

test('los límites se leen del entorno y se validan', () => {
  const config = loadConfig(
    env({
      CEIBA_ENGINE_MAX_RESPONSE_BYTES: '26214400',
      CEIBA_ENGINE_TIMEOUT_MS: '30000',
      CEIBA_ENGINE_MAX_REDIRECTS: '5',
    }),
  );
  assert.equal(config.maxResponseBytes, 26_214_400);
  assert.equal(config.timeoutMs, 30_000);
  assert.equal(config.maxRedirects, 5);
  assert.equal(config.port, 3001);

  // Valores por defecto = los del `.env.example`.
  const porDefecto = loadConfig(env());
  assert.equal(porDefecto.maxResponseBytes, 26_214_400);
  assert.equal(porDefecto.timeoutMs, 30_000);
  assert.equal(porDefecto.maxRedirects, 5);

  // Basura: error, no un valor silencioso.
  assert.throws(() => loadConfig(env({ CEIBA_ENGINE_TIMEOUT_MS: 'pronto' })), ConfigError);
  assert.throws(() => loadConfig(env({ CEIBA_ENGINE_TIMEOUT_MS: '-1' })), ConfigError);
  assert.throws(() => loadConfig(env({ CEIBA_ENGINE_MAX_RESPONSE_BYTES: '0' })), ConfigError);
  assert.throws(() => loadConfig(env({ CEIBA_ENGINE_MAX_REDIRECTS: '-2' })), ConfigError);
  // C-SSRF-07: el máximo administrativo de saltos es 10.
  assert.throws(() => loadConfig(env({ CEIBA_ENGINE_MAX_REDIRECTS: '11' })), ConfigError);
  assert.doesNotThrow(() => loadConfig(env({ CEIBA_ENGINE_MAX_REDIRECTS: '0' })));
});

test('la configuración es inmutable y no arrastra el entorno real del proceso', () => {
  const config = loadConfig(env());
  assert.ok(Object.isFrozen(config));
  assert.equal(config.nodeEnv, 'development');
});
