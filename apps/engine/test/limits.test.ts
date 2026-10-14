/**
 * T-SSRF-08 — Límites de recurso de la respuesta (C-SSRF-08).
 *
 * (a) respuesta enorme en streaming, (b) goteo de bytes, (c) cabeceras que no
 * llegan, (d) `Content-Length` mentiroso, (e) el usuario no puede subir los
 * topes administrativos. Servidores locales, sin red.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { createEgressPolicy } from '../src/net/egress-policy.ts';
import { executeRequest } from '../src/http/execute-request.use-case.ts';
import { executeRequestSchema } from '../src/contract/engine-contract.ts';
import { startServer, staticResolver, TEST_DENY_RULES, testConfig, executeInput } from './helpers/local-net.ts';

const policy = () => createEgressPolicy({ denyRules: TEST_DENY_RULES });

function parse(input: Record<string, unknown>) {
  const parsed = executeRequestSchema.safeParse(input);
  assert.ok(parsed.success, `contrato inválido: ${JSON.stringify(parsed.error?.issues)}`);
  return parsed.data;
}

test('T-SSRF-08 (a) — una respuesta mayor que el tope se corta: RESPONSE_TOO_LARGE', async (t) => {
  const bloque = Buffer.alloc(64 * 1024, 0x61);
  let enviados = 0;
  const servidor = await startServer('127.0.0.1', (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' }); // sin content-length: chunked
    const empujar = (): void => {
      while (enviados < 50 * 1024 * 1024) {
        enviados += bloque.length;
        if (!res.write(bloque)) {
          res.once('drain', empujar);
          return;
        }
      }
      res.end();
    };
    empujar();
  });
  t.after(async () => await servidor.close());

  const inicio = Date.now();
  const result = await executeRequest(parse(executeInput(`${servidor.origin}/grande`)), {
    config: testConfig({ maxResponseBytes: 1024 * 1024, timeoutMs: 10_000 }),
    policy: policy(),
    resolver: staticResolver({}),
  });
  const transcurrido = Date.now() - inicio;

  assert.equal(result.outcome, 'too_large', JSON.stringify(result.error));
  assert.equal(result.error?.code, 'RESPONSE_TOO_LARGE');
  assert.ok(transcurrido < 9_000, `debe cortar pronto, tardó ${transcurrido} ms`);
  assert.ok(enviados < 50 * 1024 * 1024, `el servidor no llegó a enviarlo todo: ${enviados} bytes`);
});

test('T-SSRF-08 (a2) — el cuerpo se trunca a maxStoredBytes sin perder sizeBytes real', async (t) => {
  const cuerpo = Buffer.alloc(200 * 1024, 0x62);
  const servidor = await startServer('127.0.0.1', (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain', 'content-length': String(cuerpo.length) });
    res.end(cuerpo);
  });
  t.after(async () => await servidor.close());

  const result = await executeRequest(
    parse(executeInput(`${servidor.origin}/x`, { capture: { storeBody: true, maxStoredBytes: 1024 } })),
    { config: testConfig(), policy: policy(), resolver: staticResolver({}) },
  );

  assert.equal(result.outcome, 'completed', JSON.stringify(result.error));
  assert.equal(result.response?.sizeBytes, 200 * 1024, 'sizeBytes es lo recibido de verdad');
  assert.equal(result.response?.body.length, 1024, 'el cuerpo devuelto se trunca');
  assert.equal(result.response?.bodyTruncated, true);
});

test('T-SSRF-08 (b) — goteo de bytes: corta el presupuesto TOTAL de la ejecución', async (t) => {
  const servidor = await startServer('127.0.0.1', (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    const temporizador = setInterval(() => res.write('.'), 100);
    res.on('close', () => clearInterval(temporizador));
  });
  t.after(async () => await servidor.close());

  const inicio = Date.now();
  const result = await executeRequest(parse(executeInput(`${servidor.origin}/gotea`)), {
    // bodyTimeout (300 ms entre bytes) NO salta: llegan bytes cada 100 ms.
    // Lo que corta es el presupuesto total.
    config: testConfig({ timeoutMs: 700, bodyTimeoutMs: 300, headersTimeoutMs: 300 }),
    policy: policy(),
    resolver: staticResolver({}),
  });
  const transcurrido = Date.now() - inicio;

  assert.equal(result.outcome, 'timeout', JSON.stringify(result.error));
  assert.equal(result.error?.code, 'TIMEOUT');
  assert.ok(transcurrido < 3_000, `cortó en ${transcurrido} ms`);
});

test('T-SSRF-08 (c) — un destino que nunca envía cabeceras: TIMEOUT', async (t) => {
  const servidor = await startServer('127.0.0.1', () => {
    /* silencio absoluto */
  });
  t.after(async () => await servidor.close());

  const result = await executeRequest(parse(executeInput(`${servidor.origin}/mudo`)), {
    config: testConfig({ timeoutMs: 1_000, headersTimeoutMs: 400 }),
    policy: policy(),
    resolver: staticResolver({}),
  });

  assert.equal(result.outcome, 'timeout', JSON.stringify(result.error));
  assert.equal(result.error?.code, 'TIMEOUT');
});

test('T-SSRF-08 (d) — un Content-Length mentiroso NO dispara el tope por sí solo', async (t) => {
  // Servidor TCP crudo: declara 99.999.999 bytes y envía 50.
  const crudo = net.createServer((socket) => {
    socket.once('data', () => {
      socket.write(
        'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 99999999\r\n\r\n' + 'x'.repeat(50),
      );
      setTimeout(() => socket.destroy(), 50);
    });
  });
  await new Promise<void>((resolve) => crudo.listen(0, '127.0.0.1', () => resolve()));
  const puerto = (crudo.address() as AddressInfo).port;
  t.after(() => crudo.close());

  const result = await executeRequest(parse(executeInput(`http://127.0.0.1:${puerto}/mentira`)), {
    config: testConfig({ maxResponseBytes: 1024, timeoutMs: 2_000, bodyTimeoutMs: 1_000 }),
    policy: policy(),
    resolver: staticResolver({}),
  });

  // Lo importante: el tope se aplica sobre los bytes REALES. Con 50 bytes
  // recibidos no puede declararse RESPONSE_TOO_LARGE por lo que diga la
  // cabecera.
  assert.notEqual(result.error?.code, 'RESPONSE_TOO_LARGE', JSON.stringify(result));
  assert.notEqual(result.outcome, 'too_large');
});

test('T-SSRF-08 (e) — el usuario puede REDUCIR los topes, nunca subirlos', async (t) => {
  const cuerpo = Buffer.alloc(5000, 0x63);
  const servidor = await startServer('127.0.0.1', (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain', 'content-length': String(cuerpo.length) });
    res.end(cuerpo);
  });
  t.after(async () => await servidor.close());

  const config = testConfig({ maxResponseBytes: 2048, maxRedirects: 2, timeoutMs: 3_000 });

  // El usuario pide MUCHO más de lo que permite el administrador.
  const subiendo = await executeRequest(
    parse(
      executeInput(`${servidor.origin}/x`, {
        policy: { maxResponseBytes: 10_000_000, timeoutMs: 600_000, maxRedirects: 50 },
      }),
    ),
    { config, policy: policy(), resolver: staticResolver({}) },
  );
  assert.equal(subiendo.outcome, 'too_large', 'el tope administrativo manda');

  // El usuario REDUCE: se respeta su valor, más estricto.
  const bajando = await executeRequest(
    parse(executeInput(`${servidor.origin}/x`, { policy: { maxResponseBytes: 100 } })),
    { config: testConfig({ maxResponseBytes: 1_000_000 }), policy: policy(), resolver: staticResolver({}) },
  );
  assert.equal(bajando.outcome, 'too_large', 'el usuario sí puede ser más estricto');
});

test('T-SSRF-08 — una respuesta normal dentro de los topes se completa con timings', async (t) => {
  const servidor = await startServer('127.0.0.1', (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
  t.after(async () => await servidor.close());

  const result = await executeRequest(parse(executeInput(`${servidor.origin}/ok`)), {
    config: testConfig(),
    policy: policy(),
    resolver: staticResolver({}),
  });

  assert.equal(result.outcome, 'completed', JSON.stringify(result.error));
  assert.equal(result.response?.status, 200);
  assert.equal(result.response?.statusText, 'OK');
  assert.equal(result.response?.bodyEncoding, 'utf8');
  assert.equal(result.response?.body, '{"ok":true}');
  assert.equal(result.response?.sizeBytes, 11);
  assert.equal(result.response?.bodyTruncated, false);
  assert.ok(result.timings.totalMs > 0);
  assert.ok(result.timings.ttfbMs >= 0);
  assert.deepEqual(result.resolvedAddresses, ['127.0.0.1']);
  assert.equal(result.error, null);
});

test('una respuesta binaria vuelve en base64', async (t) => {
  const binario = Buffer.from([0x00, 0x01, 0xff, 0xfe, 0x80]);
  const servidor = await startServer('127.0.0.1', (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/octet-stream' });
    res.end(binario);
  });
  t.after(async () => await servidor.close());

  const result = await executeRequest(parse(executeInput(`${servidor.origin}/bin`)), {
    config: testConfig(),
    policy: policy(),
    resolver: staticResolver({}),
  });

  assert.equal(result.outcome, 'completed');
  assert.equal(result.response?.bodyEncoding, 'base64');
  assert.deepEqual(Buffer.from(result.response?.body ?? '', 'base64'), binario);
});
