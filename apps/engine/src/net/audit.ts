/**
 * Auditoría de egreso.
 *
 * ADR-0002, reglas transversales: «El motor nunca registra cabeceras marcadas
 * `secret: true`, ni cuerpos completos, ni la URL con *query string*. Loguea
 * `executionId`, método, host, `outcome`, timings y tamaños.»
 *
 * Aquí sólo se define el contrato y una implementación en memoria que recoge
 * los eventos de UNA ejecución (el motor es sin estado: nada sobrevive a la
 * petición). El volcado al log estructurado lo hace el enrutador.
 */
import type { EgressCheckPoint } from './errors.ts';

export interface EgressBlockEvent {
  readonly host: string;
  readonly address: string;
  readonly where: EgressCheckPoint;
  readonly reason: string;
}

export interface ConnectionTiming {
  readonly address: string;
  readonly port: number;
  readonly dnsMs: number;
  readonly tcpMs: number;
  readonly tlsMs: number;
}

export interface TlsPeerInfo {
  readonly protocol: string | null;
  readonly cipher: string | null;
  readonly peerCN: string | null;
  readonly validTo: string | null;
}

export interface EgressAudit {
  blocked(event: EgressBlockEvent): void;
  resolved(address: string): void;
  connected(timing: ConnectionTiming): void;
  tls(info: TlsPeerInfo): void;
}

export interface ExecutionAudit extends EgressAudit {
  readonly blocks: readonly EgressBlockEvent[];
  readonly resolvedAddresses: readonly string[];
  readonly connections: readonly ConnectionTiming[];
  readonly tlsInfo: TlsPeerInfo | null;
}

/** Recolector por ejecución. Se crea y se tira con cada petición. */
export function createExecutionAudit(): ExecutionAudit {
  const blocks: EgressBlockEvent[] = [];
  const resolvedAddresses: string[] = [];
  const connections: ConnectionTiming[] = [];
  let tlsInfo: TlsPeerInfo | null = null;

  return {
    get blocks() {
      return blocks;
    },
    get resolvedAddresses() {
      return resolvedAddresses;
    },
    get connections() {
      return connections;
    },
    get tlsInfo() {
      return tlsInfo;
    },
    blocked(event: EgressBlockEvent) {
      blocks.push(event);
    },
    resolved(address: string) {
      if (!resolvedAddresses.includes(address)) resolvedAddresses.push(address);
    },
    connected(timing: ConnectionTiming) {
      connections.push(timing);
    },
    tls(info: TlsPeerInfo) {
      tlsInfo = info;
    },
  };
}
