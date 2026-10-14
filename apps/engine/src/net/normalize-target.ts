/**
 * C-SSRF-01 — Normalización canónica del destino.
 *
 * Toda decisión de política se toma sobre la forma **canónica**, nunca sobre el
 * texto que escribió el usuario.
 *
 * Prohibición explícita del control: queda prohibido implementar el filtro con
 * expresiones regulares sobre la cadena original. Aquí se usa exclusivamente el
 * parser WHATWG (`new URL`) y `net.isIP()`.
 */
import net from 'node:net';
import { EgressError } from './errors.ts';
import type { EgressCheckPoint } from './errors.ts';

export type HostKind = 'ipv4' | 'ipv6' | 'dns';

export interface CanonicalTarget {
  /** URL canónica completa, tal y como la serializa el parser WHATWG. */
  readonly href: string;
  readonly scheme: string;
  /** `url.hostname` SIN los corchetes de los literales IPv6. */
  readonly host: string;
  readonly hostKind: HostKind;
  /** Puerto efectivo: el explícito o el por defecto del esquema. */
  readonly port: number;
  readonly url: URL;
}

const DEFAULT_PORTS: Readonly<Record<string, number>> = Object.freeze({
  'http:': 80,
  'https:': 443,
});

/** Quita los corchetes de un literal IPv6: `[::1]` -> `::1`. */
export function stripBrackets(hostname: string): string {
  if (hostname.length >= 2 && hostname.startsWith('[') && hostname.endsWith(']')) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

/**
 * Desmapea una IPv6 que en realidad transporta una IPv4.
 *
 * Cubre las dos codificaciones textuales de la misma dirección:
 *   `::ffff:169.254.169.254`  y  `::ffff:a9fe:a9fe`   (IPv4-mapped, ::ffff:0:0/96)
 *   `::169.254.169.254`       y  `::a9fe:a9fe`        (IPv4-compatible, ::/96, obsoleta)
 *
 * Devuelve la IPv4 en notación decimal con puntos, o `null` si la entrada no es
 * una IPv6 que contenga una IPv4.
 */
export function unmapIpv4(address: string): string | null {
  if (net.isIP(address) !== 6) return null;
  const groups = expandIpv6(address);
  if (groups === null) return null;
  const firstFiveAreZero = groups.slice(0, 5).every((g) => g === 0);
  if (!firstFiveAreZero) return null;
  const marker = groups[5];
  if (marker !== 0xffff && marker !== 0x0000) return null;
  const high = groups[6] ?? 0;
  const low = groups[7] ?? 0;
  // `::` y `::1` no son direcciones IPv4 encapsuladas; se tratan por sus
  // propias reglas (`::/128`, `::1/128`) y no deben desmaparse a 0.0.0.0 ni
  // a 0.0.0.1.
  if (marker === 0x0000 && high === 0 && low <= 1) return null;
  const v4 = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
  return net.isIP(v4) === 4 ? v4 : null;
}

/**
 * Expande una IPv6 textual a sus ocho grupos de 16 bits.
 * Devuelve `null` si no se puede interpretar (fail closed: quien llama trata
 * `null` como "no desmapeable", nunca como "permitida").
 */
function expandIpv6(address: string): number[] | null {
  let text = address;
  // Identificador de zona (`fe80::1%eth0`): net.isIP ya lo rechaza, pero si
  // alguna ruta lo dejara pasar, se corta aquí.
  if (text.includes('%')) return null;

  // Cola IPv4 embebida: `::ffff:1.2.3.4`
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (net.isIP(tail) !== 4) return null;
    const octets = tail.split('.').map((o) => Number(o));
    const hi = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const lo = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    text = `${text.slice(0, lastColon + 1)}${hi.toString(16)}:${lo.toString(16)}`;
  }

  const doubleColon = text.indexOf('::');
  let headText: string;
  let tailText: string;
  if (doubleColon === -1) {
    headText = text;
    tailText = '';
  } else {
    headText = text.slice(0, doubleColon);
    tailText = text.slice(doubleColon + 2);
  }

  const head = headText === '' ? [] : headText.split(':');
  const tailParts = tailText === '' ? [] : tailText.split(':');
  if (doubleColon === -1 && head.length !== 8) return null;
  if (head.length + tailParts.length > 8) return null;

  const fill = new Array<string>(8 - head.length - tailParts.length).fill('0');
  const all = [...head, ...fill, ...tailParts];
  if (all.length !== 8) return null;

  const groups: number[] = [];
  for (const part of all) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
    groups.push(Number.parseInt(part, 16));
  }
  return groups;
}

/**
 * Normaliza un destino a su forma canónica.
 *
 * @param input URL escrita por el usuario (ya resuelta por la API: el motor no
 *              interpola `{{variables}}`, ADR-0002).
 * @param base  URL base para resolver una `Location` relativa de redirección.
 * @param where Punto de aplicación, para la auditoría.
 */
export function normalizeTarget(
  input: string,
  base?: string,
  where: EgressCheckPoint = 'preflight-url',
): CanonicalTarget {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new EgressError('EGRESS_BAD_URL', where, 'url vacía');
  }

  let url: URL;
  try {
    url = base === undefined ? new URL(input) : new URL(input, base);
  } catch {
    // Fail closed: lo que el parser WHATWG no entiende, no se visita.
    throw new EgressError('EGRESS_BAD_URL', where, 'url no parseable');
  }

  const host = stripBrackets(url.hostname);
  if (host === '') {
    throw new EgressError('EGRESS_BAD_URL', where, 'host vacío');
  }

  const ipVersion = net.isIP(host);
  const hostKind: HostKind = ipVersion === 4 ? 'ipv4' : ipVersion === 6 ? 'ipv6' : 'dns';

  const explicitPort = url.port === '' ? undefined : Number(url.port);
  const defaultPort = DEFAULT_PORTS[url.protocol];
  const port = explicitPort ?? defaultPort;
  if (port === undefined || !Number.isInteger(port) || port <= 0 || port > 65535) {
    // Un esquema sin puerto por defecto conocido llega aquí; el control de
    // esquemas (C-SSRF-02) lo rechazará igualmente, pero no se devuelve un
    // puerto inventado.
    throw new EgressError('EGRESS_PORT', where, `puerto no determinable para ${url.protocol}`);
  }

  return {
    href: url.href,
    scheme: url.protocol,
    host,
    hostKind,
    port,
    url,
  };
}
