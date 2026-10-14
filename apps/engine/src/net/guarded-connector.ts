/**
 * C-SSRF-04 — Resolución DNS autoritativa dentro del connector (cierra el TOCTOU).
 * C-SSRF-05 — Happy Eyeballs desactivado y UNA sola dirección entregada.
 *
 * Las cuatro capas del control, y las tres últimas viven aquí:
 *
 *   Capa 2  LOOKUP        resolución única dentro del connector
 *   Capa 3  BLOCKLIST     net.BlockList en las opciones de net.connect
 *   Capa 4  POST-CONNECT  socket.remoteAddress antes del primer byte
 *
 * Por qué cierra el rebinding: la resolución que valida la política **es la
 * misma** cuyo resultado se pasa a `net.connect`. No hay dos resoluciones, así
 * que no hay ventana entre comprobar y conectar.
 */
import dns from 'node:dns';
import type { TLSSocket } from 'node:tls';
import { buildConnector } from 'undici';
import { EgressError } from './errors.ts';
import type { EgressPolicy } from './egress-policy.ts';
import type { EgressAudit } from './audit.ts';

/** Firma compatible con `dns.lookup` en modo `all: true`. Inyectable en pruebas. */
export interface LookupAllResolver {
  (
    hostname: string,
    options: { all: true; verbatim: boolean; family: 0 | 4 | 6 },
    callback: (err: NodeJS.ErrnoException | null, addresses: Array<{ address: string; family: number }>) => void,
  ): void;
}

export interface GuardedConnectorOptions {
  readonly policy: EgressPolicy;
  readonly audit: EgressAudit;
  /** Por defecto `dns.lookup`. Las pruebas inyectan un doble: sin DNS real. */
  readonly resolver?: LookupAllResolver;
  /** Tiempo máximo para establecer la conexión (C-SSRF-08). */
  readonly connectTimeoutMs: number;
  /** Verificación del certificado del destino. Por defecto `true`. */
  readonly rejectUnauthorized?: boolean;
  /** CA adicional. Sólo lo usan las pruebas con un TLS local autofirmado. */
  readonly ca?: string | Buffer | Array<string | Buffer>;
}

type UndiciConnector = ReturnType<typeof buildConnector>;

export function createGuardedConnector(options: GuardedConnectorOptions): UndiciConnector {
  const { policy, audit, connectTimeoutMs } = options;
  const resolver: LookupAllResolver = options.resolver ?? (dns.lookup as unknown as LookupAllResolver);
  let lastDnsMs = 0;

  const base = buildConnector({
    // Nunca se acepta un socket de dominio UNIX desde la entrada del usuario:
    // daría acceso a /var/run/docker.sock (C-SSRF-02, AM-SSRF-17).
    socketPath: null,
    timeout: connectTimeoutMs,
    // C-SSRF-05: en Node 24.21.0 autoSelectFamily viene ACTIVADO por defecto.
    // Con Happy Eyeballs, Node puede intentar direcciones que la política no
    // eligió. Se desactiva sin excepción.
    autoSelectFamily: false,
    // Sin reutilizar sesiones TLS entre destinos.
    maxCachedSessions: 0,
    // Capa 3: red de seguridad en el propio kernel de sockets de Node.
    blockList: policy.denyList,
    // TLS: por defecto se verifica el certificado del destino.
    rejectUnauthorized: options.rejectUnauthorized ?? true,
    ...(options.ca === undefined ? {} : { ca: options.ca }),

    // Capa 2: la ÚNICA resolución DNS del camino de conexión.
    lookup(
      hostname: string,
      lookupOptions: { all?: boolean },
      callback: (
        err: NodeJS.ErrnoException | null,
        addressOrList?: string | Array<{ address: string; family: number }>,
        family?: number,
      ) => void,
    ) {
      const dnsStart = performance.now();
      resolver(hostname, { all: true, verbatim: true, family: 0 }, (err, addresses) => {
        const dnsMs = performance.now() - dnsStart;
        if (err) {
          callback(err);
          return;
        }
        if (!Array.isArray(addresses) || addresses.length === 0) {
          callback(new EgressError('EGRESS_DNS_FAILURE', 'dns-lookup', `sin direcciones para ${hostname}`));
          return;
        }

        const allowed: Array<{ address: string; family: number }> = [];
        for (const entry of addresses) {
          const address = entry?.address;
          try {
            // La familia declarada por el resolutor se pasa sólo para que la
            // política la contraste; la real se deriva de net.isIP().
            policy.assertAddressAllowed(address, entry?.family, 'dns-lookup');
            allowed.push(entry);
          } catch (cause) {
            audit.blocked({
              host: hostname,
              address: typeof address === 'string' ? address : String(address),
              where: 'dns-lookup',
              reason: cause instanceof EgressError ? cause.code : 'EGRESS_BAD_ADDRESS',
            });
          }
        }

        if (allowed.length === 0) {
          callback(
            new EgressError('EGRESS_BLOCKED_ALL_ADDRESSES', 'dns-lookup', `${hostname}: todas las direcciones bloqueadas`),
          );
          return;
        }

        // C-SSRF-05: se entrega UNA sola dirección, ya validada. No se dejan
        // alternativas sin usar ni margen al reintento automático.
        const pick = allowed[0] as { address: string; family: number };
        audit.resolved(pick.address);
        lastDnsMs = dnsMs;
        if (lookupOptions.all === true) {
          callback(null, [pick]);
        } else {
          callback(null, pick.address, pick.family);
        }
      });
    },
  } as Parameters<typeof buildConnector>[0]);

  // Capa 4: último testigo del peer real, antes de escribir un solo byte.
  const guarded: UndiciConnector = (connectOptions, callback) => {
    const tcpStart = performance.now();
    lastDnsMs = 0;
    return base(connectOptions, (err, socket) => {
      if (err !== null && err !== undefined) {
        callback(err, null);
        return;
      }
      if (socket === null || socket === undefined) {
        callback(new EgressError('EGRESS_DNS_FAILURE', 'post-connect', 'socket vacío'), null);
        return;
      }

      const hostname = String((connectOptions as { hostname?: string }).hostname ?? '');
      try {
        policy.assertAddressAllowed(socket.remoteAddress, socket.remoteFamily, 'post-connect');
      } catch (cause) {
        audit.blocked({
          host: hostname,
          address: String(socket.remoteAddress),
          where: 'post-connect',
          reason: cause instanceof EgressError ? cause.code : 'EGRESS_BLOCKED',
        });
        socket.destroy();
        callback(cause as Error, null);
        return;
      }

      const elapsed = performance.now() - tcpStart;
      const isTls = 'getProtocol' in socket && typeof (socket as TLSSocket).getProtocol === 'function';
      if (isTls) {
        const tlsSocket = socket as TLSSocket;
        const cert = tlsSocket.getPeerCertificate?.();
        const commonName = cert && typeof cert === 'object' && 'subject' in cert ? cert.subject?.CN : undefined;
        audit.tls({
          protocol: tlsSocket.getProtocol?.() ?? null,
          cipher: tlsSocket.getCipher?.()?.name ?? null,
          peerCN: Array.isArray(commonName) ? (commonName[0] ?? null) : (commonName ?? null),
          validTo: cert && typeof cert === 'object' && 'valid_to' in cert ? (cert.valid_to ?? null) : null,
        });
      }

      if (socket.remoteAddress !== undefined) audit.resolved(socket.remoteAddress);
      audit.connected({
        address: socket.remoteAddress ?? '',
        port: Number(socket.remotePort ?? 0),
        dnsMs: Math.round(lastDnsMs * 1000) / 1000,
        tcpMs: Math.round(Math.max(elapsed - lastDnsMs, 0) * 1000) / 1000,
        tlsMs: 0,
      });

      callback(null, socket);
      return;
    });
  };

  return guarded;
}
