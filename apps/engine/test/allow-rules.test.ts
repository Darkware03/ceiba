/**
 * T-SSRF-12 — Excepciones administrativas (C-SSRF-11).
 *
 * (a) una regla que intenta autorizar metadata/loopback se rechaza al crearse;
 * (b) una regla válida permite ese destino concreto y sólo ese;
 * (c) al caducar (reloj inyectado) vuelve a bloquearse, sin reiniciar nada.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEgressPolicy, assertAllowRuleIsLegal, NON_EXCEPTIONABLE_RANGES } from '../src/net/egress-policy.ts';
import { EgressError } from '../src/net/errors.ts';
import { executeRequest } from '../src/http/execute-request.use-case.ts';
import { executeRequestSchema } from '../src/contract/engine-contract.ts';
import { staticResolver, TEST_DENY_RULES, testConfig, executeInput } from './helpers/local-net.ts';

const MANANA = Date.now() + 86_400_000;

test('T-SSRF-12 (a) — las reglas sobre destinos no excepcionables se rechazan', () => {
  const ilegales = [
    '169.254.169.254/32',
    '169.254.0.0/16',
    '169.254.170.2/32',
    '127.0.0.1/32',
    '127.0.0.0/8',
    '0.0.0.0/32',
    '100.100.100.200/32',
    '::1/128',
    'fd20:ce::254/128',
    'fd00:ec2::254/128',
    // Un rango ancho que CONTIENE un destino prohibido tampoco vale.
    '169.0.0.0/8',
    '0.0.0.0/0',
  ];
  for (const cidr of ilegales) {
    assert.throws(
      () => assertAllowRuleIsLegal({ cidr, expiresAt: MANANA }),
      (err: unknown) => err instanceof EgressError && err.code === 'EGRESS_BAD_ALLOW_RULE',
      `${cidr} no puede autorizarse`,
    );
  }
  assert.ok(NON_EXCEPTIONABLE_RANGES.length >= 7);
});

test('T-SSRF-12 (a2) — una regla sin caducidad o con destino ilegible se rechaza', () => {
  assert.throws(() => assertAllowRuleIsLegal({ cidr: 'ejemplo.test', expiresAt: MANANA }), EgressError);
  assert.throws(() => assertAllowRuleIsLegal({ cidr: '10.1.2.3/32', expiresAt: Number.NaN }), EgressError);
});

test('T-SSRF-12 (b) — una regla válida abre ese destino y sólo ese', () => {
  const base = createEgressPolicy({ denyRules: TEST_DENY_RULES });
  // Sin excepción: bloqueado.
  assert.throws(() => base.assertAddressAllowed('10.1.2.3', 4, 'preflight-literal'), EgressError);

  const conRegla = base.withAllowRules([{ cidr: '10.1.2.3/32', port: 8080, expiresAt: MANANA, id: 'r1' }]);
  assert.doesNotThrow(() => conRegla.assertAddressAllowed('10.1.2.3', 4, 'preflight-literal'));
  // Vecinos del mismo /24: siguen bloqueados.
  assert.throws(() => conRegla.assertAddressAllowed('10.1.2.4', 4, 'preflight-literal'), EgressError);
  assert.throws(() => conRegla.assertAddressAllowed('10.1.3.3', 4, 'preflight-literal'), EgressError);
  // Y la política base NO queda contaminada (el motor es sin estado).
  assert.throws(() => base.assertAddressAllowed('10.1.2.3', 4, 'preflight-literal'), EgressError);
});

test('T-SSRF-12 (c) — al caducar la regla, vuelve a bloquearse sin reiniciar', () => {
  let ahora = 1_000_000;
  const base = createEgressPolicy({ denyRules: TEST_DENY_RULES, now: () => ahora });
  const conRegla = base.withAllowRules([{ cidr: '10.1.2.3/32', expiresAt: 1_000_500 }]);

  assert.doesNotThrow(() => conRegla.assertAddressAllowed('10.1.2.3', 4, 'preflight-literal'));
  ahora = 1_000_499;
  assert.doesNotThrow(() => conRegla.assertAddressAllowed('10.1.2.3', 4, 'preflight-literal'));
  ahora = 1_000_500;
  assert.throws(() => conRegla.assertAddressAllowed('10.1.2.3', 4, 'preflight-literal'), EgressError);
  ahora = 2_000_000;
  assert.throws(() => conRegla.assertAddressAllowed('10.1.2.3', 4, 'preflight-literal'), EgressError);
});

test('T-SSRF-12 (d) — ni con excepción se alcanza un destino de la lista no excepcionable', () => {
  const base = createEgressPolicy({ denyRules: TEST_DENY_RULES });
  // Se fuerza una regla ancha pero legal (no solapa la lista prohibida)…
  const conRegla = base.withAllowRules([{ cidr: '10.0.0.0/8', expiresAt: MANANA }]);
  assert.doesNotThrow(() => conRegla.assertAddressAllowed('10.5.5.5', 4, 'preflight-literal'));
  // …y los destinos prohibidos siguen cerrados.
  for (const prohibida of ['169.254.169.254', '127.0.0.2', '100.100.100.200', '::1']) {
    assert.throws(
      () => conRegla.assertAddressAllowed(prohibida, null, 'preflight-literal'),
      EgressError,
      prohibida,
    );
  }
});

test('el contrato: allowedDestinations exige ssrfProfile="allowlisted"', async () => {
  const config = testConfig();
  const policy = createEgressPolicy({ denyRules: TEST_DENY_RULES });
  const parsed = executeRequestSchema.safeParse(
    executeInput('http://10.1.2.3:8080/', {
      policy: { allowedDestinations: [{ cidr: '10.1.2.3/32', expiresAt: MANANA }] },
    }),
  );
  assert.ok(parsed.success);

  const result = await executeRequest(parsed.data, { config, policy, resolver: staticResolver({}) });
  assert.equal(result.outcome, 'failed');
  assert.equal(result.error?.code, 'INVALID_REQUEST');
});

test('el contrato: una excepción ilegal por petición se BLOQUEA, no se aplica', async () => {
  const config = testConfig();
  const policy = createEgressPolicy({ denyRules: TEST_DENY_RULES });
  const parsed = executeRequestSchema.safeParse(
    executeInput('http://169.254.169.254/', {
      policy: {
        ssrfProfile: 'allowlisted',
        allowedDestinations: [{ cidr: '169.254.169.254/32', expiresAt: MANANA }],
      },
    }),
  );
  assert.ok(parsed.success);

  const result = await executeRequest(parsed.data, { config, policy, resolver: staticResolver({}) });
  assert.equal(result.outcome, 'blocked');
  assert.equal(result.error?.code, 'SSRF_BLOCKED');
});
