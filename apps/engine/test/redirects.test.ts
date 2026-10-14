/**
 * T-SSRF-07 — Redirecciones: política completa en CADA salto (C-SSRF-07).
 *
 * Dos servidores locales: `127.0.0.1` = "público", `127.0.0.2` = "interno".
 * Sin red real.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEgressPolicy } from '../src/net/egress-policy.ts';
import { executeRequest } from '../src/http/execute-request.use-case.ts';
import { executeRequestSchema } from '../src/contract/engine-contract.ts';
import { startServer, staticResolver, TEST_DENY_RULES, testConfig, executeInput } from './helpers/local-net.ts';

const config = testConfig();
const policy = () => createEgressPolicy({ denyRules: TEST_DENY_RULES });

function parse(input: Record<string, unknown>) {
  const parsed = executeRequestSchema.safeParse(input);
  assert.ok(parsed.success, `contrato inválido: ${JSON.stringify(parsed.error?.issues)}`);
  return parsed.data;
}

test('T-SSRF-07 — redirección a un literal prohibido: BLOQUEADA', async (t) => {
  const interno = await startServer('127.0.0.2', (_req, res) => res.end('SECRET-INTERNAL-DATA'));
  const publico = await startServer('127.0.0.1', (_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.2:${interno.port}/` });
    res.end();
  });
  t.after(async () => {
    await publico.close();
    await interno.close();
  });

  const result = await executeRequest(parse(executeInput(`${publico.origin}/salta`)), {
    config,
    policy: policy(),
    resolver: staticResolver({}),
  });

  assert.equal(result.outcome, 'blocked', JSON.stringify(result.error));
  assert.equal(result.error?.code, 'SSRF_BLOCKED');
  assert.equal(interno.requests.length, 0, 'el servicio interno no recibe nada');
  assert.ok(!/127\.0\.0\.2/.test(result.error?.message ?? ''));
});

test('T-SSRF-07 — redirección a un NOMBRE que resuelve a prohibido: BLOQUEADA', async (t) => {
  const interno = await startServer('127.0.0.2', (_req, res) => res.end('SECRET-INTERNAL-DATA'));
  const publico = await startServer('127.0.0.1', (_req, res) => {
    res.writeHead(302, { location: `http://interno.test:${interno.port}/` });
    res.end();
  });
  t.after(async () => {
    await publico.close();
    await interno.close();
  });

  const result = await executeRequest(parse(executeInput(`${publico.origin}/salta`)), {
    config,
    policy: policy(),
    resolver: staticResolver({ 'interno.test': [{ address: '127.0.0.2', family: 4 }] }),
  });

  assert.equal(result.outcome, 'blocked', JSON.stringify(result.error));
  assert.equal(result.error?.code, 'SSRF_BLOCKED');
  assert.equal(interno.requests.length, 0);
});

test('T-SSRF-07 — cadena de 6 saltos: se corta en el 5.º', async (t) => {
  const servidor = await startServer('127.0.0.1', (req, res) => {
    const n = Number((req.url ?? '/0').slice(1)) || 0;
    if (n >= 8) {
      res.end('FINAL');
      return;
    }
    res.writeHead(302, { location: `/${n + 1}` });
    res.end();
  });
  t.after(async () => await servidor.close());

  const result = await executeRequest(parse(executeInput(`${servidor.origin}/0`)), {
    config,
    policy: policy(),
    resolver: staticResolver({}),
  });

  assert.equal(result.outcome, 'failed');
  assert.equal(result.error?.code, 'TOO_MANY_REDIRECTS');
  assert.equal(result.redirects.length, 5, 'exactamente 5 saltos registrados antes de cortar');
});

test('T-SSRF-07 — 5 saltos exactos SÍ completan', async (t) => {
  const servidor = await startServer('127.0.0.1', (req, res) => {
    const n = Number((req.url ?? '/0').slice(1)) || 0;
    if (n >= 5) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('FINAL');
      return;
    }
    res.writeHead(302, { location: `/${n + 1}` });
    res.end();
  });
  t.after(async () => await servidor.close());

  const result = await executeRequest(parse(executeInput(`${servidor.origin}/0`)), {
    config,
    policy: policy(),
    resolver: staticResolver({}),
  });

  assert.equal(result.outcome, 'completed', JSON.stringify(result.error));
  assert.equal(result.response?.body, 'FINAL');
  assert.equal(result.redirects.length, 5);
});

test('T-SSRF-07 — al cambiar de origen NO viaja Authorization (ni cookies ni claves de API)', async (t) => {
  const destino = await startServer('127.0.0.1', (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('DESTINO');
  });
  const origen = await startServer('127.0.0.1', (_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.1:${destino.port}/final` });
    res.end();
  });
  t.after(async () => {
    await origen.close();
    await destino.close();
  });

  const result = await executeRequest(
    parse({
      executionId: '01JB2XREDIR',
      request: {
        method: 'GET',
        url: `${origen.origin}/salta`,
        headers: [
          { name: 'Authorization', value: 'Bearer SECRETO-DEL-USUARIO', secret: true },
          { name: 'Cookie', value: 'sid=abc' },
          { name: 'X-Api-Key', value: 'CLAVE-SECRETA' },
          { name: 'Accept', value: 'application/json' },
        ],
      },
    }),
    { config, policy: policy(), resolver: staticResolver({}) },
  );

  assert.equal(result.outcome, 'completed', JSON.stringify(result.error));
  const recibida = destino.requests[0];
  assert.ok(recibida, 'el destino recibió la petición');
  assert.equal(recibida.headers.authorization, undefined, 'Authorization NO puede cruzar de origen');
  assert.equal(recibida.headers.cookie, undefined, 'Cookie NO puede cruzar de origen');
  assert.equal(recibida.headers['x-api-key'], undefined, 'X-Api-Key NO puede cruzar de origen');
  assert.equal(recibida.headers.accept, 'application/json', 'las cabeceras no sensibles sí siguen');
  // Y el primer salto SÍ las llevaba: la prueba sería vacua si no.
  assert.equal(origen.requests[0]?.headers.authorization, 'Bearer SECRETO-DEL-USUARIO');
  assert.equal(origen.requests[0]?.headers.cookie, 'sid=abc');
  assert.equal(origen.requests[0]?.headers['x-api-key'], 'CLAVE-SECRETA');
});

test('T-SSRF-07 — en el mismo origen Authorization se conserva', async (t) => {
  const servidor = await startServer('127.0.0.1', (req, res) => {
    if (req.url === '/salta') {
      res.writeHead(302, { location: '/final' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('MISMO-ORIGEN');
  });
  t.after(async () => await servidor.close());

  const result = await executeRequest(
    parse({
      executionId: '01JB2XSAMEORIGIN',
      request: {
        method: 'GET',
        url: `${servidor.origin}/salta`,
        headers: [{ name: 'Authorization', value: 'Bearer TOKEN', secret: true }],
      },
    }),
    { config, policy: policy(), resolver: staticResolver({}) },
  );

  assert.equal(result.outcome, 'completed');
  assert.equal(servidor.requests[1]?.headers.authorization, 'Bearer TOKEN');
});

test('T-SSRF-07 — 307 conserva método y cuerpo, y revalida el destino', async (t) => {
  const destino = await startServer('127.0.0.1', (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('307-OK');
  });
  const origen = await startServer('127.0.0.1', (_req, res) => {
    res.writeHead(307, { location: `http://127.0.0.1:${destino.port}/final` });
    res.end();
  });
  t.after(async () => {
    await origen.close();
    await destino.close();
  });

  const result = await executeRequest(
    parse({
      executionId: '01JB2X307',
      request: {
        method: 'POST',
        url: `${origen.origin}/salta`,
        headers: [],
        body: { mode: 'json', raw: '{"dato":"valor"}' },
      },
    }),
    { config, policy: policy(), resolver: staticResolver({}) },
  );

  assert.equal(result.outcome, 'completed', JSON.stringify(result.error));
  assert.equal(destino.requests[0]?.method, 'POST', '307 conserva el método');
  assert.equal(destino.requests[0]?.body, '{"dato":"valor"}', '307 reenvía el cuerpo');
});

test('T-SSRF-07 — 303 se convierte en GET y descarta el cuerpo', async (t) => {
  const destino = await startServer('127.0.0.1', (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('303-OK');
  });
  const origen = await startServer('127.0.0.1', (_req, res) => {
    res.writeHead(303, { location: `http://127.0.0.1:${destino.port}/final` });
    res.end();
  });
  t.after(async () => {
    await origen.close();
    await destino.close();
  });

  const result = await executeRequest(
    parse({
      executionId: '01JB2X303',
      request: {
        method: 'POST',
        url: `${origen.origin}/salta`,
        headers: [],
        body: { mode: 'json', raw: '{"dato":"valor"}' },
      },
    }),
    { config, policy: policy(), resolver: staticResolver({}) },
  );

  assert.equal(result.outcome, 'completed', JSON.stringify(result.error));
  assert.equal(destino.requests[0]?.method, 'GET');
  assert.equal(destino.requests[0]?.body, '');
  assert.equal(destino.requests[0]?.headers['content-type'], undefined);
});

test('T-SSRF-07 — Location con esquema no permitido: BLOQUEADA', async (t) => {
  const servidor = await startServer('127.0.0.1', (_req, res) => {
    res.writeHead(302, { location: 'file:///etc/passwd' });
    res.end();
  });
  t.after(async () => await servidor.close());

  const result = await executeRequest(parse(executeInput(`${servidor.origin}/salta`)), {
    config,
    policy: policy(),
    resolver: staticResolver({}),
  });
  assert.equal(result.outcome, 'blocked');
  assert.equal(result.error?.code, 'SSRF_BLOCKED');
});

test('T-SSRF-07 — Location con credenciales embebidas: BLOQUEADA', async (t) => {
  const destino = await startServer('127.0.0.1', (_req, res) => res.end('NO'));
  const servidor = await startServer('127.0.0.1', (_req, res) => {
    res.writeHead(302, { location: `http://usuario:clave@127.0.0.1:${destino.port}/` });
    res.end();
  });
  t.after(async () => {
    await servidor.close();
    await destino.close();
  });

  const result = await executeRequest(parse(executeInput(`${servidor.origin}/salta`)), {
    config,
    policy: policy(),
    resolver: staticResolver({}),
  });
  assert.equal(result.outcome, 'blocked');
  assert.equal(destino.requests.length, 0);
});

test('T-SSRF-07 — bucle de redirecciones detectado', async (t) => {
  const servidor = await startServer('127.0.0.1', (req, res) => {
    const destino = req.url === '/a' ? '/b' : '/a';
    res.writeHead(302, { location: destino });
    res.end();
  });
  t.after(async () => await servidor.close());

  const result = await executeRequest(parse(executeInput(`${servidor.origin}/a`)), {
    config,
    policy: policy(),
    resolver: staticResolver({}),
  });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.error?.code, 'TOO_MANY_REDIRECTS');
});

test('T-SSRF-07 — followRedirects=false devuelve el 3xx tal cual', async (t) => {
  const interno = await startServer('127.0.0.2', (_req, res) => res.end('SECRET-INTERNAL-DATA'));
  const servidor = await startServer('127.0.0.1', (_req, res) => {
    res.writeHead(302, { location: `http://127.0.0.2:${interno.port}/` });
    res.end();
  });
  t.after(async () => {
    await servidor.close();
    await interno.close();
  });

  const result = await executeRequest(
    parse(executeInput(`${servidor.origin}/salta`, { policy: { followRedirects: false } })),
    { config, policy: policy(), resolver: staticResolver({}) },
  );

  assert.equal(result.outcome, 'completed');
  assert.equal(result.response?.status, 302);
  assert.equal(interno.requests.length, 0, 'no se sigue la redirección');
});

test('T-SSRF-07 — la cadena de saltos queda registrada sin query string', async (t) => {
  const destino = await startServer('127.0.0.1', (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('FIN');
  });
  const origen = await startServer('127.0.0.1', (_req, res) => {
    res.writeHead(301, { location: `http://127.0.0.1:${destino.port}/final?token=SECRETO` });
    res.end();
  });
  t.after(async () => {
    await origen.close();
    await destino.close();
  });

  const result = await executeRequest(parse(executeInput(`${origen.origin}/salta?clave=SECRETO`)), {
    config,
    policy: policy(),
    resolver: staticResolver({}),
  });

  assert.equal(result.outcome, 'completed');
  assert.equal(result.redirects.length, 1);
  assert.equal(result.redirects[0]?.status, 301);
  const serializado = JSON.stringify(result.redirects);
  assert.ok(!serializado.includes('SECRETO'), `la auditoría no puede llevar la query: ${serializado}`);
});
