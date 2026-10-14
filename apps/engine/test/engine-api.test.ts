/**
 * Contrato HTTP del motor (ADR-0002) y autenticación API ↔ motor.
 *
 * El testigo `CEIBA_ENGINE_TOKEN` es lo único que impide que cualquier
 * proceso de la red de contenedores use el motor como proxy de salida.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, tokensMatch, ENGINE_TOKEN_HEADER } from '../src/server.ts';
import { createEgressPolicy } from '../src/net/egress-policy.ts';
import { startServer, staticResolver, TEST_DENY_RULES, testConfig, executeInput } from './helpers/local-net.ts';

const config = testConfig();
const TOKEN = config.engineToken;
const policy = () => createEgressPolicy({ denyRules: TEST_DENY_RULES });

function app() {
  return buildServer({ config, policy: policy(), resolver: staticResolver({}), logger: false });
}

test('el motor RECHAZA toda petición sin testigo', async (t) => {
  const servidor = app();
  t.after(async () => await servidor.close());

  for (const ruta of ['/v1/execute', '/v1/execute/stream']) {
    const res = await servidor.inject({
      method: 'POST',
      url: ruta,
      payload: executeInput('http://ejemplo.test/'),
    });
    assert.equal(res.statusCode, 401, `${ruta} sin testigo`);
    assert.equal(JSON.parse(res.body).error.code, 'UNAUTHORIZED');
  }
});

test('el motor RECHAZA un testigo equivocado, vacío o de longitud distinta', async (t) => {
  const servidor = app();
  t.after(async () => await servidor.close());

  const malos = ['', 'x', `${TOKEN}x`, TOKEN.slice(0, -1), TOKEN.toUpperCase(), 'Bearer ' + TOKEN];
  for (const malo of malos) {
    const res = await servidor.inject({
      method: 'POST',
      url: '/v1/execute',
      headers: { [ENGINE_TOKEN_HEADER]: malo },
      payload: executeInput('http://ejemplo.test/'),
    });
    assert.equal(res.statusCode, 401, `testigo ${JSON.stringify(malo)} no puede valer`);
  }
});

test('/healthz responde SIN testigo y no toca la red de salida', async (t) => {
  const servidor = app();
  t.after(async () => await servidor.close());

  const res = await servidor.inject({ method: 'GET', url: '/healthz' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { status: 'ok', engine: 'ceiba', contract: 'v1' });
});

test('tokensMatch compara en tiempo constante y no revienta con basura', () => {
  assert.equal(tokensMatch(TOKEN, TOKEN), true);
  assert.equal(tokensMatch('otro', TOKEN), false);
  assert.equal(tokensMatch('', TOKEN), false);
  assert.equal(tokensMatch(undefined, TOKEN), false);
  assert.equal(tokensMatch(null, TOKEN), false);
  assert.equal(tokensMatch(['a'], TOKEN), false);
  assert.equal(tokensMatch(123, TOKEN), false);
});

test('ADR-0002: sólo existen TRES rutas', async (t) => {
  const servidor = app();
  t.after(async () => await servidor.close());
  await servidor.ready();

  const rutas = servidor
    .printRoutes({ commonPrefix: false })
    .split('\n')
    .filter((l) => l.includes('('))
    .map((l) => l.trim());

  for (const prohibida of ['/v1/proxy', '/metrics', '/v1/execute/batch', '/debug']) {
    const res = await servidor.inject({
      method: 'POST',
      url: prohibida,
      headers: { [ENGINE_TOKEN_HEADER]: TOKEN },
      payload: {},
    });
    assert.equal(res.statusCode, 404, `${prohibida} no debe existir`);
  }
  assert.ok(rutas.length >= 3, `rutas declaradas: ${rutas.join(' | ')}`);
});

test('POST /v1/execute ejecuta de verdad contra un servidor local', async (t) => {
  const destino = await startServer('127.0.0.1', (req, res) => {
    res.writeHead(201, { 'content-type': 'application/json', 'x-eco': req.headers['x-prueba'] ?? '' });
    res.end(JSON.stringify({ metodo: req.method, cuerpo: req.headers['content-type'] }));
  });
  const servidor = app();
  t.after(async () => {
    await servidor.close();
    await destino.close();
  });

  const res = await servidor.inject({
    method: 'POST',
    url: '/v1/execute',
    headers: { [ENGINE_TOKEN_HEADER]: TOKEN },
    payload: {
      executionId: '01JB2XAPI0001',
      request: {
        method: 'POST',
        url: `${destino.origin}/recurso`,
        headers: [{ name: 'X-Prueba', value: 'hola' }],
        body: { mode: 'json', raw: '{"a":1}' },
      },
    },
  });

  assert.equal(res.statusCode, 200);
  const cuerpo = JSON.parse(res.body);
  assert.equal(cuerpo.outcome, 'completed', JSON.stringify(cuerpo.error));
  assert.equal(cuerpo.executionId, '01JB2XAPI0001');
  assert.equal(cuerpo.response.status, 201);
  assert.equal(cuerpo.response.statusText, 'Created');
  assert.deepEqual(JSON.parse(cuerpo.response.body), { metodo: 'POST', cuerpo: 'application/json' });
  assert.equal(destino.requests[0]?.body, '{"a":1}');
  assert.equal(cuerpo.scriptResults, null);
  assert.deepEqual(cuerpo.resolvedAddresses, ['127.0.0.1']);
});

test('un bloqueo SSRF es HTTP 200 con outcome=blocked, no un 5xx', async (t) => {
  const servidor = app();
  t.after(async () => await servidor.close());

  const res = await servidor.inject({
    method: 'POST',
    url: '/v1/execute',
    headers: { [ENGINE_TOKEN_HEADER]: TOKEN },
    payload: executeInput('http://169.254.169.254/computeMetadata/v1/'),
  });

  assert.equal(res.statusCode, 200, 'el transporte no falla: el dominio sí');
  const cuerpo = JSON.parse(res.body);
  assert.equal(cuerpo.outcome, 'blocked');
  assert.equal(cuerpo.error.code, 'SSRF_BLOCKED');
  assert.ok(!res.body.includes('169.254.169.254'), 'la respuesta no revela la IP bloqueada');
});

test('C-SSRF-10 (a): el DTO rechaza cualquier campo desconocido, incluido `proxy`', async (t) => {
  const servidor = app();
  t.after(async () => await servidor.close());

  const payloads: Array<Record<string, unknown>> = [
    { ...executeInput('http://ejemplo.test/'), proxy: 'http://malo:8080' },
    {
      executionId: '01JB2X',
      request: { method: 'GET', url: 'http://ejemplo.test/', proxy: 'http://malo:8080' },
    },
    {
      executionId: '01JB2X',
      request: { method: 'GET', url: 'http://ejemplo.test/' },
      policy: { proxy: 'http://malo:8080' },
    },
    {
      executionId: '01JB2X',
      request: { method: 'GET', url: 'http://ejemplo.test/' },
      policy: { ssrfProfile: 'off' },
    },
    { executionId: '01JB2X', request: { method: 'CONNECT', url: 'http://ejemplo.test/' } },
    { executionId: '01JB2X', request: { method: 'TRACE', url: 'http://ejemplo.test/' } },
    { executionId: '01JB2X', request: { method: 'GET', url: 'http://ejemplo.test/' }, socketPath: '/var/run/docker.sock' },
  ];

  for (const payload of payloads) {
    const res = await servidor.inject({
      method: 'POST',
      url: '/v1/execute',
      headers: { [ENGINE_TOKEN_HEADER]: TOKEN },
      payload,
    });
    assert.equal(res.statusCode, 400, `debería rechazarse: ${JSON.stringify(payload)}`);
    assert.equal(JSON.parse(res.body).error.code, 'INVALID_REQUEST');
  }
});

test('los scripts se declaran NO IMPLEMENTADOS en lugar de ignorarse en silencio', async (t) => {
  const servidor = app();
  t.after(async () => await servidor.close());

  const res = await servidor.inject({
    method: 'POST',
    url: '/v1/execute',
    headers: { [ENGINE_TOKEN_HEADER]: TOKEN },
    payload: {
      ...executeInput('http://ejemplo.test/'),
      scripts: { preRequest: 'pm.test()', postResponse: null },
    },
  });

  assert.equal(res.statusCode, 200);
  const cuerpo = JSON.parse(res.body);
  assert.equal(cuerpo.outcome, 'failed');
  assert.equal(cuerpo.error.code, 'SCRIPT_ERROR');
});

test('C-SSRF-12: la cabecera Metadata-Flavor del usuario se elimina de la petición saliente', async (t) => {
  const destino = await startServer('127.0.0.1', (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  const servidor = app();
  t.after(async () => {
    await servidor.close();
    await destino.close();
  });

  const res = await servidor.inject({
    method: 'POST',
    url: '/v1/execute',
    headers: { [ENGINE_TOKEN_HEADER]: TOKEN },
    payload: {
      executionId: '01JB2XMETA',
      request: {
        method: 'GET',
        url: `${destino.origin}/`,
        headers: [
          { name: 'Metadata-Flavor', value: 'Google' },
          { name: 'Metadata', value: 'true' },
          { name: 'X-aws-ec2-metadata-token', value: 'abc' },
          { name: 'Host', value: 'otra-cosa.test' },
          { name: 'X-Legitima', value: 'sí' },
        ],
      },
    },
  });

  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).outcome, 'completed');
  const recibida = destino.requests[0];
  assert.ok(recibida);
  assert.equal(recibida.headers['metadata-flavor'], undefined);
  assert.equal(recibida.headers['metadata'], undefined);
  assert.equal(recibida.headers['x-aws-ec2-metadata-token'], undefined);
  assert.equal(recibida.headers['x-legitima'], 'sí');
  assert.notEqual(recibida.headers.host, 'otra-cosa.test', 'el Host lo fija la URL canónica');
});

test('una cabecera con CRLF no puede inyectar otra cabecera', async (t) => {
  const destino = await startServer('127.0.0.1', (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  const servidor = app();
  t.after(async () => {
    await servidor.close();
    await destino.close();
  });

  const res = await servidor.inject({
    method: 'POST',
    url: '/v1/execute',
    headers: { [ENGINE_TOKEN_HEADER]: TOKEN },
    payload: {
      executionId: '01JB2XCRLF',
      request: {
        method: 'GET',
        url: `${destino.origin}/`,
        headers: [{ name: 'X-Malo', value: 'a\r\nX-Inyectada: sí' }],
      },
    },
  });

  assert.equal(JSON.parse(res.body).outcome, 'completed');
  assert.equal(destino.requests[0]?.headers['x-inyectada'], undefined);
  assert.equal(destino.requests[0]?.headers['x-malo'], undefined);
});

test('POST /v1/execute/stream emite eventos SSE y termina con el resultado', async (t) => {
  const destino = await startServer('127.0.0.1', (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"sse":true}');
  });
  const servidor = app();
  t.after(async () => {
    await servidor.close();
    await destino.close();
  });

  const res = await servidor.inject({
    method: 'POST',
    url: '/v1/execute/stream',
    headers: { [ENGINE_TOKEN_HEADER]: TOKEN },
    payload: executeInput(`${destino.origin}/sse`),
  });

  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'] as string, /text\/event-stream/);
  assert.match(res.body, /^event: started\n/);
  assert.match(res.body, /\nevent: headers\n/);
  assert.match(res.body, /\nevent: result\n/);

  const bloqueResultado = res.body.split('event: result\ndata: ')[1] ?? '';
  const resultado = JSON.parse(bloqueResultado.split('\n')[0] ?? '{}');
  assert.equal(resultado.outcome, 'completed');
  assert.equal(resultado.response.body, '{"sse":true}');
});
