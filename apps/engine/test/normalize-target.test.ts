/**
 * T-SSRF-01 — Normalización canónica del destino (C-SSRF-01).
 *
 * Tabla parametrizada: las formas alternativas de IPv4, los literales IPv6
 * mapeados y las entradas que el parser WHATWG debe rechazar. Unitaria pura,
 * sin red.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTarget, unmapIpv4, stripBrackets } from '../src/net/normalize-target.ts';
import { EgressError } from '../src/net/errors.ts';

interface Caso {
  readonly entrada: string;
  readonly host: string;
  readonly tipo: 'ipv4' | 'ipv6' | 'dns';
  readonly puerto?: number;
}

const CASOS: readonly Caso[] = [
  // Formas alternativas de IPv4 — todas colapsan a 127.0.0.1
  { entrada: 'http://0177.0.0.1/', host: '127.0.0.1', tipo: 'ipv4' },
  { entrada: 'http://2130706433/', host: '127.0.0.1', tipo: 'ipv4' },
  { entrada: 'http://0x7f.1/', host: '127.0.0.1', tipo: 'ipv4' },
  { entrada: 'http://127.1/', host: '127.0.0.1', tipo: 'ipv4' },
  { entrada: 'http://0x7f000001/', host: '127.0.0.1', tipo: 'ipv4' },
  { entrada: 'http://127.0.0.1./', host: '127.0.0.1', tipo: 'ipv4' },
  // Octal: 010 -> 8. El control NO puede asumir decimal.
  { entrada: 'http://010.0.0.1/', host: '8.0.0.1', tipo: 'ipv4' },
  // "0" es 0.0.0.0, que alcanza loopback en Linux
  { entrada: 'http://0/', host: '0.0.0.0', tipo: 'ipv4' },
  { entrada: 'http://0.0.0.0:8080/', host: '0.0.0.0', tipo: 'ipv4', puerto: 8080 },
  // Metadata de nube
  { entrada: 'http://169.254.169.254/computeMetadata/v1/', host: '169.254.169.254', tipo: 'ipv4' },
  { entrada: 'http://metadata.google.internal/', host: 'metadata.google.internal', tipo: 'dns' },
  { entrada: 'http://100.100.100.200/', host: '100.100.100.200', tipo: 'ipv4' },
  // IPv6: corchetes fuera, minúsculas, forma comprimida
  { entrada: 'http://[::1]/', host: '::1', tipo: 'ipv6' },
  { entrada: 'http://[0:0:0:0:0:0:0:1]/', host: '::1', tipo: 'ipv6' },
  { entrada: 'http://[::FFFF:127.0.0.1]/', host: '::ffff:7f00:1', tipo: 'ipv6' },
  { entrada: 'http://[0:0:0:0:0:ffff:169.254.169.254]/', host: '::ffff:a9fe:a9fe', tipo: 'ipv6' },
  { entrada: 'http://[fd20:ce::254]/', host: 'fd20:ce::254', tipo: 'ipv6' },
  { entrada: 'http://[fd00:ec2::254]/', host: 'fd00:ec2::254', tipo: 'ipv6' },
  { entrada: 'http://[64:ff9b::a9fe:a9fe]/', host: '64:ff9b::a9fe:a9fe', tipo: 'ipv6' },
  { entrada: 'http://[2002:a9fe:a9fe::]/', host: '2002:a9fe:a9fe::', tipo: 'ipv6' },
  // Nombres
  { entrada: 'http://LOCALHOST/', host: 'localhost', tipo: 'dns' },
  { entrada: 'https://API.Example.COM/v1', host: 'api.example.com', tipo: 'dns', puerto: 443 },
  { entrada: 'http://ejemplo.test:3001/x?y=1', host: 'ejemplo.test', tipo: 'dns', puerto: 3001 },
  // Puertos por defecto
  { entrada: 'http://ejemplo.test/', host: 'ejemplo.test', tipo: 'dns', puerto: 80 },
];

test('T-SSRF-01: la forma canónica coincide con la esperada', () => {
  for (const caso of CASOS) {
    const target = normalizeTarget(caso.entrada);
    assert.equal(target.host, caso.host, `host de ${caso.entrada}`);
    assert.equal(target.hostKind, caso.tipo, `tipo de ${caso.entrada}`);
    if (caso.puerto !== undefined) {
      assert.equal(target.port, caso.puerto, `puerto de ${caso.entrada}`);
    }
  }
  assert.equal(CASOS.length, 24, 'la tabla debe tener 24 entradas');
});

test('T-SSRF-01: entradas no parseables fallan CERRADAS', () => {
  const malas = ['', '   ', 'no-es-una-url', 'http://', '://nada', 'http://[::1', '①②⑦.0.0.1'];
  for (const mala of malas) {
    assert.throws(
      () => normalizeTarget(mala),
      (err: unknown) => err instanceof EgressError,
      `debería rechazar ${JSON.stringify(mala)}`,
    );
  }
});

test('T-SSRF-01: los dígitos Unicode SÍ canonizan, y por eso el filtro va sobre la forma canónica', () => {
  // MEDIDO: el parser WHATWG normaliza ①②⑦ a 127. Un filtro por expresión
  // regular sobre la cadena original no vería loopback aquí; sobre la forma
  // canónica sí. Es exactamente la razón de la prohibición de C-SSRF-01.
  const target = normalizeTarget('http://①②⑦.0.0.1/');
  assert.equal(target.host, '127.0.0.1');
  assert.equal(target.hostKind, 'ipv4');
});

test('T-SSRF-01: la zona IPv6 (%eth0) se rechaza en el parser', () => {
  // MEDIDO: `new URL('http://[fe80::1%25eth0]/')` lanza. Fallo cerrado por
  // construcción: no hay que confiar en net.isIP para este caso.
  assert.throws(
    () => normalizeTarget('http://[fe80::1%25eth0]/'),
    (err: unknown) => err instanceof EgressError && err.code === 'EGRESS_BAD_URL',
  );
});

test('stripBrackets quita sólo los corchetes externos', () => {
  assert.equal(stripBrackets('[::1]'), '::1');
  assert.equal(stripBrackets('127.0.0.1'), '127.0.0.1');
  assert.equal(stripBrackets('[]'), '');
});

test('unmapIpv4 desmapea las dos codificaciones de la misma dirección', () => {
  assert.equal(unmapIpv4('::ffff:169.254.169.254'), '169.254.169.254');
  assert.equal(unmapIpv4('::ffff:a9fe:a9fe'), '169.254.169.254');
  assert.equal(unmapIpv4('::ffff:127.0.0.1'), '127.0.0.1');
  assert.equal(unmapIpv4('::ffff:7f00:1'), '127.0.0.1');
  assert.equal(unmapIpv4('::ffff:0.0.0.0'), '0.0.0.0');
  // IPv4-compatible (obsoleta)
  assert.equal(unmapIpv4('::127.0.0.1'), '127.0.0.1');
  // No son IPv4 encapsuladas
  assert.equal(unmapIpv4('::1'), null);
  assert.equal(unmapIpv4('::'), null);
  assert.equal(unmapIpv4('fd20:ce::254'), null);
  assert.equal(unmapIpv4('127.0.0.1'), null);
  assert.equal(unmapIpv4('basura'), null);
});

test('las credenciales embebidas sobreviven al parser y se ven en el objetivo', () => {
  const target = normalizeTarget('http://usuario:secreto@ejemplo.test/');
  assert.equal(target.url.username, 'usuario');
  // El rechazo lo hace la política (C-SSRF-02); aquí sólo se comprueba que la
  // información llega para poder rechazarla.
});
