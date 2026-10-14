/**
 * C-SSRF-02 — Lista de esquemas, puertos y métodos.
 * C-SSRF-03 — Conjunto de redes denegadas.
 * C-SSRF-11 — Excepciones administrativas sobre destinos privados.
 *
 * REGLA DURA DE ESTE FICHERO: **fallar cerrado**. `net.BlockList.check()` no
 * lanza nunca; devuelve `false` (= "permitido") con el `type` equivocado y con
 * basura. Verificado en este contenedor:
 *
 *   bl.check('127.0.0.1','ipv6')               -> false   (tipo equivocado)
 *   bl.check('no-una-ip','ipv4')               -> false   (basura)
 *   bl.check('::ffff:169.254.169.254','ipv4')  -> false   (familia equivocada)
 *
 * Por eso la familia se deriva SIEMPRE de `net.isIP()` y una dirección no
 * parseable es un error, nunca un permiso.
 */
import net from 'node:net';
import { EgressError } from './errors.ts';
import type { EgressCheckPoint } from './errors.ts';
import { unmapIpv4 } from './normalize-target.ts';
import type { CanonicalTarget } from './normalize-target.ts';

// ---------------------------------------------------------------------------
// C-SSRF-03 — Conjunto de redes denegadas
// ---------------------------------------------------------------------------

/**
 * `net.BlockList.PRIVATE_RANGES` de Node 24.21.0 es:
 *   10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8,
 *   ::1/128, 169.254.0.0/16, fe80::/10, fc00::/7
 *
 * NO cubre `0.0.0.0` (que alcanza loopback en Linux) ni `100.64.0.0/10`
 * (CGNAT, donde vive la metadata de Alibaba en 100.100.100.200). Los dos
 * agujeros están reproducidos en la suite de pruebas. Por eso CEIBA construye
 * su lista explícitamente y no usa la constante de conveniencia.
 */
export const CEIBA_DENY_RANGES_V4: readonly string[] = Object.freeze([
  // Equivalente explícito de PRIVATE_RANGES (no se importa la constante)
  '10.0.0.0/8', // RFC 1918
  '172.16.0.0/12', // RFC 1918
  '192.168.0.0/16', // RFC 1918
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local: metadata de nube, 169.254.170.2 (ECS task roles)
  // Añadidos obligatorios de CEIBA
  '0.0.0.0/8', // "esta red"; 0.0.0.0 alcanza loopback — AGUJERO 1
  '100.64.0.0/10', // CGNAT RFC 6598; metadata de Alibaba 100.100.100.200 — AGUJERO 2
  '192.0.0.0/24', // asignaciones de protocolo IETF
  '192.0.2.0/24', // TEST-NET-1
  '198.51.100.0/24', // TEST-NET-2
  '203.0.113.0/24', // TEST-NET-3
  '192.88.99.0/24', // 6to4 relay anycast (obsoleto)
  '198.18.0.0/15', // benchmarking entre redes
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reservado + 255.255.255.255 broadcast
]);

export const CEIBA_DENY_RANGES_V6: readonly string[] = Object.freeze([
  '::1/128', // loopback
  'fe80::/10', // link-local
  'fc00::/7', // ULA: incluye fd20:ce::254 (GCP) y fd00:ec2::254 (AWS)
  '::/128', // no especificada
  '::/96', // IPv4-compatible (obsoleta): ::127.0.0.1
  // OJO: `::ffff:0:0/96` NO se mete aquí. Ver TRAMPA DE FALLO CERRADO abajo.
  '64:ff9b::/96', // NAT64: ruta directa a cualquier IPv4 interna
  '64:ff9b:1::/48', // NAT64 local-use
  '100::/64', // discard-only
  '2001::/32', // Teredo
  '2001:db8::/32', // documentación
  '2002::/16', // 6to4: 2002:a9fe:a9fe:: encapsula 169.254.169.254
  'ff00::/8', // multicast
]);

/**
 * Destinos de metadata declarados uno a uno. Redundantes con los rangos de
 * arriba a propósito: si una futura edición de la lista pierde un rango, estos
 * siguen cerrados y la auditoría lo ve explícito.
 */
export const CEIBA_DENY_ADDRESSES: readonly string[] = Object.freeze([
  '169.254.169.254', // GCP / AWS / Azure / Oracle / DigitalOcean / Hetzner
  '100.100.100.200', // Alibaba
  'fd20:ce::254', // GCP IPv6 (NO es la de AWS)
  'fd00:ec2::254', // AWS IMDS IPv6
]);

/**
 * TRAMPA DE FALLO CERRADO descubierta al implementar este control, verificada
 * en Node 24.21.0 y que NO estaba en el documento de controles:
 *
 *   const bl = new net.BlockList();
 *   bl.addSubnet('::ffff:0:0', 96, 'ipv6');
 *   bl.check('93.184.216.34', 'ipv4')   ->  TRUE
 *
 * `net.BlockList` convierte internamente la IPv4 a su forma mapeada para
 * compararla con las reglas IPv6, de modo que `::ffff:0:0/96` bloquea
 * **TODO Internet IPv4**. Meter ese rango en la lista, como sugiere la tabla
 * de C-SSRF-03, deja el producto sin destinos válidos.
 *
 * Tratamiento correcto, y el que exige C-SSRF-01: las IPv4 encapsuladas se
 * resuelven por DESMAPEO explícito en `assertAddressAllowed`, evaluando la
 * IPv4 embebida contra las reglas IPv4. Resultado idéntico para los destinos
 * peligrosos (`::ffff:127.0.0.1`, `::ffff:169.254.169.254`) y sin el falso
 * positivo masivo.
 */
export const IPV4_MAPPED_RANGE_IS_HANDLED_BY_UNMAPPING = true;

/**
 * C-SSRF-11 — Lista NO excepcionable. Ninguna regla administrativa puede
 * autorizar estos destinos. Se comprueba *después* de aplicar la excepción.
 */
export const NON_EXCEPTIONABLE_RANGES: readonly string[] = Object.freeze([
  '169.254.0.0/16',
  '127.0.0.0/8',
  '0.0.0.0/8',
  '100.100.100.200/32',
  '::1/128',
  '::/128',
  'fd20:ce::254/128',
  'fd00:ec2::254/128',
]);

/** Conjunto por defecto: rangos + direcciones nombradas. */
export const CEIBA_DEFAULT_DENY_RULES: readonly string[] = Object.freeze([
  ...CEIBA_DENY_RANGES_V4,
  ...CEIBA_DENY_RANGES_V6,
  ...CEIBA_DENY_ADDRESSES.map((a) => `${a}/${net.isIP(a) === 6 ? 128 : 32}`),
]);

// ---------------------------------------------------------------------------
// C-SSRF-02 — Esquemas y puertos
// ---------------------------------------------------------------------------

export const ALLOWED_SCHEMES: readonly string[] = Object.freeze(['http:', 'https:']);

/**
 * Puertos de servicio interno. Se deniegan siempre, también en destinos
 * públicos: un Postgres expuesto a Internet sigue sin ser un destino legítimo
 * para un cliente de APIs.
 */
export const BLOCKED_SERVICE_PORTS: ReadonlySet<number> = Object.freeze(
  new Set([
    5432, // PostgreSQL
    6379, // Redis
    11211, // memcached
    2375, // Docker (sin TLS)
    2376, // Docker (TLS)
    10250, // kubelet
    10255, // kubelet read-only
    2379, // etcd cliente
    2380, // etcd peer
    9200, // Elasticsearch
    9300, // Elasticsearch transporte
    27017, // MongoDB
    8500, // Consul
    4848, // GlassFish admin
    9090, // Prometheus
    9093, // Alertmanager
  ]),
);

// ---------------------------------------------------------------------------
// C-SSRF-11 — Reglas de excepción
// ---------------------------------------------------------------------------

export interface EgressAllowRule {
  /** IP literal o CIDR. El nombre NO vale: la excepción se evalúa sobre la IP resuelta. */
  readonly cidr: string;
  /** Puerto exacto autorizado. `null` = cualquiera de los permitidos por C-SSRF-02. */
  readonly port?: number | null;
  /** Esquema autorizado. `null` = `http:` y `https:`. */
  readonly scheme?: string | null;
  /** Caducidad obligatoria en epoch ms. C-SSRF-11: máximo 90 días, lo valida la API. */
  readonly expiresAt: number;
  /** Identificador de la regla, para la auditoría. */
  readonly id?: string;
}

export interface EgressPolicyOptions {
  /**
   * Conjunto denegado. Por defecto `CEIBA_DEFAULT_DENY_RULES`.
   *
   * Sólo se sobreescribe en las PRUEBAS de red, donde hace falta que un
   * loopback (`127.0.0.1`) haga de "destino público" y otro (`127.0.0.2`) de
   * "servicio interno". En producción NUNCA se pasa este parámetro: el motor
   * lo construye desde la constante y el arranque falla si se intenta
   * desactivar el control global (ver `config.ts`).
   */
  readonly denyRules?: readonly string[];
  /** Excepciones administrativas vigentes (C-SSRF-11). */
  readonly allowRules?: readonly EgressAllowRule[];
  /** Reloj inyectable, para probar la caducidad de las reglas. */
  readonly now?: () => number;
}

export interface EgressPolicy {
  /** `net.BlockList` listo para pasarlo como capa 3 en las opciones del socket. */
  readonly denyList: net.BlockList;
  readonly allowRules: readonly EgressAllowRule[];
  /** C-SSRF-02 sobre el destino ya canonizado. */
  assertSchemeAndPort(target: CanonicalTarget, where: EgressCheckPoint): void;
  /** C-SSRF-03 sobre una dirección IP concreta. Falla cerrado. */
  assertAddressAllowed(address: unknown, family: unknown, where: EgressCheckPoint): void;
  /** Deriva una política con excepciones adicionales para UNA ejecución. */
  withAllowRules(rules: readonly EgressAllowRule[]): EgressPolicy;
}

function buildBlockList(rules: readonly string[]): net.BlockList {
  const list = new net.BlockList();
  for (const rule of rules) {
    const slash = rule.lastIndexOf('/');
    if (slash === -1) {
      const version = net.isIP(rule);
      if (version === 0) throw new TypeError(`regla de denegación inválida: ${rule}`);
      list.addAddress(rule, version === 6 ? 'ipv6' : 'ipv4');
      continue;
    }
    const address = rule.slice(0, slash);
    const prefix = Number(rule.slice(slash + 1));
    const version = net.isIP(address);
    if (version === 0 || !Number.isInteger(prefix)) {
      throw new TypeError(`regla de denegación inválida: ${rule}`);
    }
    list.addSubnet(address, prefix, version === 6 ? 'ipv6' : 'ipv4');
  }
  return list;
}

/**
 * Comprobación de pertenencia de una IP a un CIDR, usando `net.BlockList` como
 * emparejador. Seguro porque la dirección ya se validó con `net.isIP()`.
 */
function cidrMatches(cidr: string, address: string, version: 4 | 6): boolean {
  let matcher: net.BlockList;
  try {
    matcher = buildBlockList([cidr]);
  } catch {
    return false; // una regla ilegible NO autoriza nada
  }
  return matcher.check(address, version === 6 ? 'ipv6' : 'ipv4');
}

/**
 * Valida una regla de excepción contra la lista no excepcionable (C-SSRF-11).
 * Lanza si la regla intenta autorizar un destino prohibido.
 */
export function assertAllowRuleIsLegal(rule: EgressAllowRule): void {
  const slash = rule.cidr.lastIndexOf('/');
  const bare = slash === -1 ? rule.cidr : rule.cidr.slice(0, slash);
  const version = net.isIP(bare);
  if (version === 0) {
    throw new EgressError('EGRESS_BAD_ALLOW_RULE', 'allow-rule', `destino no es IP ni CIDR: ${rule.cidr}`);
  }
  if (!Number.isFinite(rule.expiresAt)) {
    throw new EgressError('EGRESS_BAD_ALLOW_RULE', 'allow-rule', 'la caducidad es obligatoria');
  }
  // Se comprueba la dirección base del CIDR y, para rangos, también que el
  // rango no contenga ningún destino prohibido.
  for (const forbidden of NON_EXCEPTIONABLE_RANGES) {
    const forbiddenSlash = forbidden.lastIndexOf('/');
    const forbiddenBase = forbidden.slice(0, forbiddenSlash);
    const forbiddenVersion = net.isIP(forbiddenBase) === 6 ? 6 : 4;
    if (forbiddenVersion !== version) continue;
    // ¿la regla cae dentro de un rango prohibido?  ¿o lo contiene?
    if (
      cidrMatches(forbidden, bare, version) ||
      cidrMatches(rule.cidr, forbiddenBase, version)
    ) {
      throw new EgressError(
        'EGRESS_BAD_ALLOW_RULE',
        'allow-rule',
        `${rule.cidr} solapa el rango no excepcionable ${forbidden}`,
      );
    }
  }
}

export function createEgressPolicy(options: EgressPolicyOptions = {}): EgressPolicy {
  const denyRules = options.denyRules ?? CEIBA_DEFAULT_DENY_RULES;
  const now = options.now ?? Date.now;
  const allowRules = options.allowRules ?? [];
  for (const rule of allowRules) assertAllowRuleIsLegal(rule);

  const denyList = buildBlockList(denyRules);

  function allowRuleCovers(address: string, version: 4 | 6, port: number | null): boolean {
    const current = now();
    for (const rule of allowRules) {
      if (rule.expiresAt <= current) continue;
      if (rule.port != null && port != null && rule.port !== port) continue;
      if (!cidrMatches(rule.cidr, address, version)) continue;
      // La lista no excepcionable se vuelve a comprobar DESPUÉS de aplicar la
      // excepción: defensa en profundidad frente a una regla mal validada en
      // el alta.
      for (const forbidden of NON_EXCEPTIONABLE_RANGES) {
        const forbiddenBase = forbidden.slice(0, forbidden.lastIndexOf('/'));
        if ((net.isIP(forbiddenBase) === 6 ? 6 : 4) !== version) continue;
        if (cidrMatches(forbidden, address, version)) return false;
      }
      return true;
    }
    return false;
  }

  const policy: EgressPolicy = {
    denyList,
    allowRules,

    assertSchemeAndPort(target: CanonicalTarget, where: EgressCheckPoint): void {
      if (!ALLOWED_SCHEMES.includes(target.scheme)) {
        throw new EgressError('EGRESS_SCHEME', where, `esquema no permitido: ${target.scheme}`);
      }
      // Credenciales embebidas: vector de confusión de parsers y fuga a logs.
      if (target.url.username !== '' || target.url.password !== '') {
        throw new EgressError('EGRESS_CREDENTIALS_IN_URL', where, 'credenciales en la URL');
      }
      if (!Number.isInteger(target.port) || target.port < 1 || target.port > 65535) {
        throw new EgressError('EGRESS_PORT', where, `puerto inválido: ${String(target.port)}`);
      }
      if (BLOCKED_SERVICE_PORTS.has(target.port)) {
        throw new EgressError('EGRESS_PORT', where, `puerto de servicio interno: ${target.port}`);
      }
    },

    assertAddressAllowed(address: unknown, family: unknown, where: EgressCheckPoint): void {
      // ---- FALLO CERRADO 1: la entrada tiene que ser una cadena no vacía ----
      if (typeof address !== 'string' || address === '') {
        throw new EgressError('EGRESS_BAD_ADDRESS', where, `dirección no textual: ${describe(address)}`);
      }
      // ---- FALLO CERRADO 2: la familia se DERIVA, nunca se acepta ----
      const version = net.isIP(address);
      if (version === 0) {
        throw new EgressError('EGRESS_BAD_ADDRESS', where, `no es una IP: ${address}`);
      }
      const derived: 4 | 6 = version === 6 ? 6 : 4;

      // ---- FALLO CERRADO 3: si llega una familia declarada y no cuadra, se corta ----
      if (family !== undefined && family !== null) {
        const declared = normalizeFamily(family);
        if (declared === null) {
          throw new EgressError('EGRESS_BAD_FAMILY', where, `familia ilegible: ${describe(family)}`);
        }
        if (declared !== derived) {
          throw new EgressError(
            'EGRESS_FAMILY_MISMATCH',
            where,
            `familia declarada ${declared} != real ${derived} (${address})`,
          );
        }
      }

      const type = derived === 6 ? 'ipv6' : 'ipv4';
      const blocked = denyList.check(address, type);
      const mapped = derived === 6 ? unmapIpv4(address) : null;
      const mappedBlocked = mapped !== null && denyList.check(mapped, 'ipv4');

      if (blocked || mappedBlocked) {
        if (allowRuleCovers(address, derived, null)) return; // C-SSRF-11
        const detail = mappedBlocked && mapped !== null ? `${address} (desmapeada: ${mapped})` : address;
        throw new EgressError('EGRESS_BLOCKED', where, detail);
      }
    },

    withAllowRules(rules: readonly EgressAllowRule[]): EgressPolicy {
      const merged = [...allowRules, ...rules];
      const next: EgressPolicyOptions = {
        denyRules,
        allowRules: merged,
        now,
      };
      return createEgressPolicy(next);
    },
  };

  return policy;
}

/** Acepta 4/6, 'ipv4'/'ipv6', 'IPv4'/'IPv6'. Cualquier otra cosa es `null`. */
function normalizeFamily(family: unknown): 4 | 6 | null {
  if (family === 4 || family === 6) return family;
  if (typeof family === 'string') {
    const lower = family.toLowerCase();
    if (lower === 'ipv4' || lower === '4') return 4;
    if (lower === 'ipv6' || lower === '6') return 6;
  }
  return null;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value === '' ? '(cadena vacía)' : value;
  return Object.prototype.toString.call(value);
}
