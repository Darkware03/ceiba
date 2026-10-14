/**
 * T-SSRF-04 — DNS rebinding (TOCTOU) con resolutor inyectado (C-SSRF-04).
 * T-SSRF-05 — Happy Eyeballs desactivado y una sola dirección (C-SSRF-05).
 *
 * Servidores locales, sin red real y sin DNS real:
 *   127.0.0.1 = destino "público" permitido
 *   127.0.0.2 = "servicio interno" prohibido, sirve SECRET-INTERNAL-DATA
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Agent, buildConnector, request as undiciRequest } from 'undici';
import { createEgressPolicy } from '../src/net/egress-policy.ts';
import type { EgressPolicy } from '../src/net/egress-policy.ts';
import { createGuardedConnector } from '../src/net/guarded-connector.ts';
import { createExecutionAudit } from '../src/net/audit.ts';
import { executeRequest } from '../src/http/execute-request.use-case.ts';
import { EgressError } from '../src/net/errors.ts';
import { executeRequestSchema } from '../src/contract/engine-contract.ts';
import { startServer, sequenceResolver, staticResolver, v4, TEST_DENY_RULES, testConfig, executeInput } from './helpers/local-net.ts';

const config = testConfig();

function policyForTests(): EgressPolicy {
  return createEgressPolicy({ denyRules: TEST_DENY_RULES });
}

function parse(input: Record<string, unknown>) {
  const parsed = executeRequestSchema.safeParse(input);
  assert.ok(parsed.success, `contrato inválido: ${JSON.stringify(parsed.error?.issues)}`);
  return parsed.data;
}

test('T-SSRF-04 — DNS rebinding: A) sin control al conectar SE ALCANZA el dato interno', async (t) => {
  const publico = await startServer('127.0.0.1', (_req, res) => res.end('PUBLIC-OK'));
  const interno = await startServer('127.0.0.2', (_req, res) => res.end('SECRET-INTERNAL-DATA'));
  t.after(async () => {
    await publico.close();
    await interno.close();
  });

  // El atacante controla el DNS: la primera consulta (la de la validación)
  // devuelve la dirección permitida; la segunda (la de la conexión) la prohibida.
  const resolver = sequenceResolver({
    'rebind.test': [v4('127.0.0.1'), v4('127.0.0.2')],
  });

  const policy = policyForTests();

  // --- Capa 1 sola: se valida la URL resolviendo una vez. Veredicto: PERMITIDO.
  const primera = await new Promise<string>((resolve, reject) => {
    resolver('rebind.test', { all: true, verbatim: true, family: 0 }, (err, addrs) => {
      if (err) reject(err);
      else resolve(addrs[0]?.address ?? '');
    });
  });
  assert.equal(primera, '127.0.0.1');
  assert.doesNotThrow(() => policy.assertAddressAllowed(primera, 4, 'preflight-dns'), 'la capa 1 aprueba');

  // --- Y ahora se conecta con un connector SIN política (sólo validación de URL).
  const sinControl = new Agent({
    connect: buildConnector({
      autoSelectFamily: false,
      lookup(hostname: string, options: { all?: boolean }, cb: (e: Error | null, a?: unknown, f?: number) => void) {
        resolver(hostname, { all: true, verbatim: true, family: 0 }, (err, addrs) => {
          if (err) return cb(err);
          const pick = addrs[0] as { address: string; family: number };
          return options.all === true ? cb(null, [pick]) : cb(null, pick.address, pick.family);
        });
      },
    } as Parameters<typeof buildConnector>[0]),
  });

  const res = await undiciRequest(`http://rebind.test:${interno.port}/`, { dispatcher: sinControl });
  const body = await res.body.text();
  await sinControl.close();

  assert.equal(body, 'SECRET-INTERNAL-DATA', 'A) la validación de URL sola NO protege: el ataque llega');
  assert.equal(interno.requests.length, 1, 'el servicio interno recibió la petición');
});

test('T-SSRF-04 — DNS rebinding: B) el motor lo BLOQUEA y el servicio interno no recibe nada', async (t) => {
  const publico = await startServer('127.0.0.1', (_req, res) => res.end('PUBLIC-OK'));
  const interno = await startServer('127.0.0.2', (_req, res) => res.end('SECRET-INTERNAL-DATA'));
  t.after(async () => {
    await publico.close();
    await interno.close();
  });

  const resolver = sequenceResolver({
    'rebind.test': [v4('127.0.0.1'), v4('127.0.0.2')],
  });

  const result = await executeRequest(
    parse(
      executeInput(`http://rebind.test:${interno.port}/`, {
        request: {
          method: 'GET',
          url: `http://rebind.test:${interno.port}/`,
          headers: [{ name: 'Authorization', value: 'Bearer secreto-del-usuario', secret: true }],
        },
      }),
    ),
    { config, policy: policyForTests(), resolver },
  );

  assert.equal(result.outcome, 'blocked', `outcome inesperado: ${JSON.stringify(result)}`);
  assert.equal(result.error?.code, 'SSRF_BLOCKED');
  assert.equal(interno.requests.length, 0, 'el servicio interno NO debe recibir ni un byte');
  // El mensaje público no revela la IP ni la regla.
  assert.ok(!/127\.0\.0\.2/.test(result.error?.message ?? ''), 'el mensaje público no revela la IP');
  assert.ok(!/BlockList|127\.0\.0/.test(result.error?.message ?? ''));
  // Se consultó dos veces: la del preflight y la autoritativa del connector.
  assert.ok(resolver.calls.length >= 2, `consultas DNS: ${resolver.calls.length}`);
});

test('T-SSRF-05 — con [permitida, prohibida] sólo se usa la permitida', async (t) => {
  const publico = await startServer('127.0.0.1', (_req, res) => res.end('PUBLIC-OK'));
  const interno = await startServer('127.0.0.2', (_req, res) => res.end('SECRET-INTERNAL-DATA'));
  t.after(async () => {
    await publico.close();
    await interno.close();
  });

  // Mismo puerto en ambos servidores no es posible; se usa el del público y se
  // comprueba que la prohibida nunca se intenta.
  const resolver = staticResolver({
    'dual.test': [
      { address: '127.0.0.1', family: 4 },
      { address: '127.0.0.2', family: 4 },
    ],
  });

  const result = await executeRequest(
    parse(executeInput(`http://dual.test:${publico.port}/`)),
    { config, policy: policyForTests(), resolver },
  );

  assert.equal(result.outcome, 'completed', JSON.stringify(result.error));
  assert.equal(result.response?.body, 'PUBLIC-OK');
  assert.deepEqual(result.resolvedAddresses, ['127.0.0.1'], 'sólo se resolvió/usó la permitida');
  assert.equal(interno.requests.length, 0);
  assert.equal(publico.requests.length, 1);
});

test('T-SSRF-05 — si TODAS las direcciones están prohibidas, se bloquea', async () => {
  const resolver = staticResolver({
    'malo.test': [
      { address: '127.0.0.2', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ],
  });

  const result = await executeRequest(parse(executeInput('http://malo.test:8080/')), {
    config,
    policy: policyForTests(),
    resolver,
  });

  assert.equal(result.outcome, 'blocked');
  assert.equal(result.error?.code, 'SSRF_BLOCKED');
});

test('capa 4 (post-connect): el peer se revisa ANTES de escribir un byte', async (t) => {
  const interno = await startServer('127.0.0.1', (_req, res) => res.end('NO-DEBERIA-LLEGAR'));
  t.after(async () => await interno.close());

  // Política de dos caras: aprueba en el lookup y rechaza al conectar. Aísla
  // la capa 4, que es la que tiene que destruir el socket.
  const base = createEgressPolicy({ denyRules: TEST_DENY_RULES });
  const dosCaras: EgressPolicy = {
    denyList: new (await import('node:net')).BlockList(), // capa 3 inerte a propósito
    allowRules: [],
    assertSchemeAndPort: base.assertSchemeAndPort.bind(base),
    assertAddressAllowed(address, family, where) {
      if (where === 'post-connect') {
        throw new EgressError('EGRESS_BLOCKED', 'post-connect', String(address));
      }
      base.assertAddressAllowed(address, family, where);
    },
    withAllowRules: () => dosCaras,
  };

  const audit = createExecutionAudit();
  const connector = createGuardedConnector({ policy: dosCaras, audit, connectTimeoutMs: 2000 });
  const agent = new Agent({ connect: connector });

  await assert.rejects(
    () => undiciRequest(`http://127.0.0.1:${interno.port}/`, { dispatcher: agent }),
    (err: unknown) => {
      const flat = err instanceof AggregateError ? err.errors : [err];
      return flat.some((e) => e instanceof EgressError && e.where === 'post-connect');
    },
  );
  await agent.close().catch(() => agent.destroy());

  assert.equal(interno.requests.length, 0, 'no se envió la petición: el socket se destruyó antes');
  assert.equal(audit.blocks.length, 1);
  assert.equal(audit.blocks[0]?.where, 'post-connect');
});

test('capa 3 (blockList del socket): net.connect corta aunque el lookup no se invoque', async (t) => {
  const interno = await startServer('127.0.0.2', (_req, res) => res.end('SECRET-INTERNAL-DATA'));
  t.after(async () => await interno.close());

  // Política que NO comprueba nada en el lookup ni en post-connect: sólo queda
  // la capa 3, el net.BlockList pasado a net.connect.
  const real = createEgressPolicy({ denyRules: TEST_DENY_RULES });
  const soloCapa3: EgressPolicy = {
    denyList: real.denyList,
    allowRules: [],
    assertSchemeAndPort: real.assertSchemeAndPort.bind(real),
    assertAddressAllowed: () => undefined,
    withAllowRules: () => soloCapa3,
  };

  const audit = createExecutionAudit();
  const connector = createGuardedConnector({ policy: soloCapa3, audit, connectTimeoutMs: 2000 });
  const agent = new Agent({ connect: connector });

  await assert.rejects(
    () => undiciRequest(`http://127.0.0.2:${interno.port}/`, { dispatcher: agent }),
    (err: unknown) => {
      const flat = err instanceof AggregateError ? err.errors : [err];
      return flat.some((e) => (e as { code?: string })?.code === 'ERR_IP_BLOCKED');
    },
  );
  await agent.close().catch(() => agent.destroy());
  assert.equal(interno.requests.length, 0);
});

test('un nombre que no resuelve devuelve DNS_FAILURE, no un bloqueo silencioso', async () => {
  const result = await executeRequest(parse(executeInput('http://no-existe.test/')), {
    config,
    policy: policyForTests(),
    resolver: staticResolver({}),
  });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.error?.code, 'DNS_FAILURE');
});
