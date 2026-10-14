/**
 * T-SSRF-02 — esquemas, puertos y credenciales (C-SSRF-02).
 * T-SSRF-03 — conjunto de redes denegadas (C-SSRF-03).
 * T-SSRF-09 — confusión de familia y fallo abierto de `net.BlockList`.
 *
 * Unitarias puras, sin red.
 *
 * Los dos agujeros que esta suite existe para cerrar, reproducidos primero
 * sobre `net.BlockList` desnudo y después contra la política de CEIBA.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createEgressPolicy, CEIBA_DEFAULT_DENY_RULES } from '../src/net/egress-policy.ts';
import { normalizeTarget } from '../src/net/normalize-target.ts';
import { EgressError } from '../src/net/errors.ts';

const policy = createEgressPolicy();

function bloqueada(address: string, family: unknown = null): EgressError | null {
  try {
    policy.assertAddressAllowed(address, family, 'preflight-literal');
    return null;
  } catch (err) {
    assert.ok(err instanceof EgressError, `error inesperado para ${address}: ${String(err)}`);
    return err;
  }
}

// ---------------------------------------------------------------------------
// Los dos agujeros de net.BlockList, demostrados y después cerrados
// ---------------------------------------------------------------------------

test('AGUJERO 1 — net.BlockList con los rangos privados clásicos NO cubre 0.0.0.0, y CEIBA sí', () => {
  const ingenua = new net.BlockList();
  for (const [addr, prefix, type] of [
    ['10.0.0.0', 8, 'ipv4'],
    ['172.16.0.0', 12, 'ipv4'],
    ['192.168.0.0', 16, 'ipv4'],
    ['127.0.0.0', 8, 'ipv4'],
    ['169.254.0.0', 16, 'ipv4'],
    ['::1', 128, 'ipv6'],
    ['fe80::', 10, 'ipv6'],
    ['fc00::', 7, 'ipv6'],
  ] as Array<[string, number, 'ipv4' | 'ipv6']>) {
    ingenua.addSubnet(addr, prefix, type);
  }

  // Reproducción del agujero: la lista ingenua deja pasar 0.0.0.0, que en
  // Linux alcanza el loopback.
  assert.equal(ingenua.check('0.0.0.0', 'ipv4'), false, 'la lista ingenua NO bloquea 0.0.0.0');

  // La política de CEIBA sí lo bloquea.
  const err = bloqueada('0.0.0.0');
  assert.ok(err, 'CEIBA debe bloquear 0.0.0.0');
  assert.equal(err.code, 'EGRESS_BLOCKED');
});

test('AGUJERO 2 — net.BlockList con los rangos privados clásicos NO cubre 100.64.0.0/10, y CEIBA sí', () => {
  const ingenua = new net.BlockList();
  ingenua.addSubnet('10.0.0.0', 8, 'ipv4');
  ingenua.addSubnet('172.16.0.0', 12, 'ipv4');
  ingenua.addSubnet('192.168.0.0', 16, 'ipv4');
  ingenua.addSubnet('127.0.0.0', 8, 'ipv4');
  ingenua.addSubnet('169.254.0.0', 16, 'ipv4');

  assert.equal(ingenua.check('100.64.0.1', 'ipv4'), false, 'la lista ingenua NO bloquea CGNAT');
  assert.equal(ingenua.check('100.100.100.200', 'ipv4'), false, 'la lista ingenua NO bloquea la metadata de Alibaba');

  assert.ok(bloqueada('100.64.0.1'), 'CEIBA debe bloquear 100.64.0.1');
  assert.ok(bloqueada('100.100.100.200'), 'CEIBA debe bloquear 100.100.100.200');
  assert.ok(bloqueada('100.127.255.254'), 'CEIBA debe bloquear el final del rango CGNAT');
});

test('T-SSRF-09 — check() FALLA ABIERTO; assertAddressAllowed falla CERRADO', () => {
  const bl = new net.BlockList();
  bl.addSubnet('127.0.0.0', 8, 'ipv4');
  bl.addSubnet('169.254.0.0', 16, 'ipv4');

  // Comportamiento real de Node 24.21.0, verificado: `false` significa
  // "permitido", y es lo que devuelve con el tipo equivocado o con basura.
  assert.equal(bl.check('127.0.0.1', 'ipv6'), false, 'tipo equivocado => falla abierto');
  assert.equal(bl.check('no-una-ip', 'ipv4'), false, 'basura => falla abierto');
  assert.equal(bl.check('', 'ipv4'), false, 'cadena vacía => falla abierto');
  assert.equal(bl.check('127.0.0.1', 'bogus' as 'ipv4'), false, 'familia inventada => falla abierto');
  assert.equal(bl.check('0177.0.0.1', 'ipv4'), false, 'forma octal => falla abierto');

  // CEIBA: cada una de esas entradas es un ERROR, nunca un permiso.
  const casos: Array<[unknown, unknown, string]> = [
    ['127.0.0.1', 'ipv6', 'EGRESS_FAMILY_MISMATCH'],
    ['127.0.0.1', 6, 'EGRESS_FAMILY_MISMATCH'],
    ['::ffff:169.254.169.254', 'ipv4', 'EGRESS_FAMILY_MISMATCH'],
    ['no-una-ip', 'ipv4', 'EGRESS_BAD_ADDRESS'],
    ['', 'ipv4', 'EGRESS_BAD_ADDRESS'],
    ['0177.0.0.1', 'ipv4', 'EGRESS_BAD_ADDRESS'],
    ['2130706433', 'ipv4', 'EGRESS_BAD_ADDRESS'],
    ['127.0.0.1 ', 'ipv4', 'EGRESS_BAD_ADDRESS'],
    [null, 'ipv4', 'EGRESS_BAD_ADDRESS'],
    [undefined, 'ipv4', 'EGRESS_BAD_ADDRESS'],
    [2130706433, 'ipv4', 'EGRESS_BAD_ADDRESS'],
    [{ address: '1.1.1.1' }, 'ipv4', 'EGRESS_BAD_ADDRESS'],
    ['1.1.1.1', 'bogus', 'EGRESS_BAD_FAMILY'],
    ['1.1.1.1', {}, 'EGRESS_BAD_FAMILY'],
  ];
  for (const [address, family, esperado] of casos) {
    let code: string | null = null;
    try {
      policy.assertAddressAllowed(address, family, 'dns-lookup');
    } catch (err) {
      code = err instanceof EgressError ? err.code : 'OTRO';
    }
    assert.equal(code, esperado, `entrada ${JSON.stringify(String(address))}/${String(family)}`);
  }
});

test('T-SSRF-09 — la familia se deriva de net.isIP, no del parámetro recibido', () => {
  // Una dirección legítima con la familia correcta pasa…
  assert.doesNotThrow(() => policy.assertAddressAllowed('93.184.216.34', 4, 'dns-lookup'));
  assert.doesNotThrow(() => policy.assertAddressAllowed('93.184.216.34', 'ipv4', 'dns-lookup'));
  assert.doesNotThrow(() => policy.assertAddressAllowed('93.184.216.34', null, 'dns-lookup'));
  // …y una prohibida NO se salva mintiendo sobre la familia.
  assert.ok(bloqueada('169.254.169.254', 4));
  assert.ok(bloqueada('169.254.169.254', null));
  assert.ok(bloqueada('169.254.169.254', 'ipv4'));
  assert.ok(bloqueada('169.254.169.254', 6));
});

// ---------------------------------------------------------------------------
// T-SSRF-03 — tabla de rangos denegados
// ---------------------------------------------------------------------------

const DENEGADAS: readonly string[] = [
  // Loopback y "esta red"
  '127.0.0.1', '127.0.0.2', '127.255.255.254', '0.0.0.0', '0.1.2.3',
  // RFC 1918
  '10.0.0.1', '10.255.255.254', '172.16.0.1', '172.31.255.254', '192.168.0.1', '192.168.255.254',
  // Link-local y metadata
  '169.254.169.254', '169.254.170.2', '169.254.0.1', '169.254.255.254',
  // CGNAT
  '100.64.0.1', '100.100.100.200', '100.127.255.254',
  // Asignaciones especiales
  '192.0.0.1', '192.0.2.5', '198.51.100.5', '203.0.113.5', '192.88.99.1',
  '198.18.0.1', '198.19.255.254',
  // Multicast y reservado
  '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
  // IPv6
  '::1', '::', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe',
  '::ffff:10.0.0.1', '::ffff:0.0.0.0', '::127.0.0.1',
  'fe80::1', 'febf::1', 'fc00::1', 'fd00::1', 'fd20:ce::254', 'fd00:ec2::254', 'fdff::1',
  '64:ff9b::a9fe:a9fe', '64:ff9b::7f00:1', '64:ff9b:1::1',
  '100::1', '2001::1', '2001:db8::1', '2002:a9fe:a9fe::', '2002::1',
  'ff00::1', 'ff02::1',
];

const PERMITIDAS: readonly string[] = [
  '93.184.216.34', '1.1.1.1', '8.8.8.8', '151.101.1.69', '99.84.0.1',
  '172.15.255.254', '172.32.0.1', '192.167.255.254', '192.169.0.1',
  '100.63.255.254', '100.128.0.1', '198.17.255.254', '198.20.0.1',
  '223.255.255.254', '11.0.0.1',
  '2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4001:80e::200e',
  '2001:1::1', '2003::1',
];

test('T-SSRF-03 — todas las redes denegadas se bloquean (IPv4, IPv6 y mapeadas)', () => {
  const fallos: string[] = [];
  for (const address of DENEGADAS) {
    if (bloqueada(address) === null) fallos.push(address);
  }
  assert.deepEqual(fallos, [], `direcciones que NO se bloquearon: ${fallos.join(', ')}`);
  assert.ok(DENEGADAS.length >= 55, `la tabla tiene ${DENEGADAS.length} entradas`);
});

test('T-SSRF-03 — los destinos públicos legítimos NO se bloquean', () => {
  const fallos: string[] = [];
  for (const address of PERMITIDAS) {
    if (bloqueada(address) !== null) fallos.push(address);
  }
  assert.deepEqual(fallos, [], `falsos positivos: ${fallos.join(', ')}`);
});

test('TRAMPA DE FALLO CERRADO — ::ffff:0:0/96 en el BlockList bloquearía TODO Internet IPv4', () => {
  // Reproducción del hallazgo (Node 24.21.0): net.BlockList compara las IPv4
  // contra las reglas IPv6 en forma mapeada.
  const trampa = new net.BlockList();
  trampa.addSubnet('::ffff:0:0', 96, 'ipv6');
  assert.equal(trampa.check('93.184.216.34', 'ipv4'), true, 'bloquearía un destino público legítimo');
  assert.equal(trampa.check('1.1.1.1', 'ipv4'), true);

  // Por eso CEIBA NO incluye ese rango y desmapea explícitamente.
  assert.ok(
    !CEIBA_DEFAULT_DENY_RULES.includes('::ffff:0:0/96'),
    'la lista por defecto no puede contener ::ffff:0:0/96',
  );
  // Y aun así las mapeadas peligrosas siguen bloqueadas, por desmapeo:
  assert.ok(bloqueada('::ffff:127.0.0.1'));
  assert.ok(bloqueada('::ffff:169.254.169.254'));
  assert.ok(bloqueada('::ffff:a9fe:a9fe'));
  // …y una mapeada pública no es un falso positivo:
  assert.equal(bloqueada('::ffff:93.184.216.34'), null);
});

test('T-SSRF-03 — la lista por defecto no tiene reglas inválidas', () => {
  assert.ok(CEIBA_DEFAULT_DENY_RULES.length >= 30);
  assert.doesNotThrow(() => createEgressPolicy({ denyRules: CEIBA_DEFAULT_DENY_RULES }));
  assert.throws(() => createEgressPolicy({ denyRules: ['no-es-un-cidr'] }));
});

// ---------------------------------------------------------------------------
// T-SSRF-02 — esquemas, puertos y credenciales
// ---------------------------------------------------------------------------

test('T-SSRF-02 — sólo http: y https:', () => {
  const prohibidos = [
    'file:///etc/passwd',
    'ftp://ejemplo.test/x',
    'gopher://ejemplo.test/x',
    'dict://ejemplo.test/x',
    'ws://ejemplo.test/x',
    'wss://ejemplo.test/x',
    'jar:http://ejemplo.test!/x',
  ];
  for (const url of prohibidos) {
    let code: string | null = null;
    try {
      const target = normalizeTarget(url);
      policy.assertSchemeAndPort(target, 'preflight-url');
    } catch (err) {
      code = err instanceof EgressError ? err.code : 'OTRO';
    }
    assert.ok(code === 'EGRESS_SCHEME' || code === 'EGRESS_PORT' || code === 'EGRESS_BAD_URL', `${url} -> ${code}`);
  }

  for (const url of ['http://ejemplo.test/', 'https://ejemplo.test/']) {
    assert.doesNotThrow(() => policy.assertSchemeAndPort(normalizeTarget(url), 'preflight-url'));
  }
});

test('T-SSRF-02 — data: y blob: no llegan ni a tener host', () => {
  for (const url of ['data:text/plain,hola', 'blob:http://x/y']) {
    assert.throws(() => normalizeTarget(url), (err: unknown) => err instanceof EgressError);
  }
});

test('T-SSRF-02 — los puertos de servicio interno se rechazan', () => {
  const puertos = [5432, 6379, 11211, 2375, 2376, 10250, 10255, 2379, 2380, 9200, 9300, 27017, 8500, 4848, 9090, 9093];
  for (const port of puertos) {
    let code: string | null = null;
    try {
      policy.assertSchemeAndPort(normalizeTarget(`http://ejemplo.test:${port}/`), 'preflight-url');
    } catch (err) {
      code = err instanceof EgressError ? err.code : 'OTRO';
    }
    assert.equal(code, 'EGRESS_PORT', `puerto ${port}`);
  }
  for (const port of [80, 443, 3001, 8443, 65535]) {
    assert.doesNotThrow(
      () => policy.assertSchemeAndPort(normalizeTarget(`http://ejemplo.test:${port}/`), 'preflight-url'),
      `puerto ${port}`,
    );
  }
});

test('T-SSRF-02 — las credenciales embebidas en la URL se rechazan', () => {
  let code: string | null = null;
  try {
    policy.assertSchemeAndPort(normalizeTarget('http://usuario:secreto@ejemplo.test/'), 'preflight-url');
  } catch (err) {
    code = err instanceof EgressError ? err.code : 'OTRO';
  }
  assert.equal(code, 'EGRESS_CREDENTIALS_IN_URL');
});

test('el mensaje de EgressError no se usa como mensaje público', () => {
  const err = bloqueada('169.254.169.254');
  assert.ok(err);
  // El detalle interno SÍ lleva la IP: va al log del motor, no a la respuesta.
  assert.match(err.message, /169\.254\.169\.254/);
  assert.equal(err.where, 'preflight-literal');
});
