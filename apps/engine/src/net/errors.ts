/**
 * Errores de la política de egreso del motor.
 *
 * ADR-0002 fija los códigos cerrados de `error.code` del contrato v1. Aquí
 * vive el error interno, mucho más detallado, que **nunca** sale tal cual al
 * cliente: C-SSRF del documento de controles exige que `SSRF_BLOCKED` no revele
 * qué IP ni qué regla disparó el bloqueo. El detalle va al log estructurado.
 */

/** Motivos internos de bloqueo. No se exponen al llamante de la API. */
export type EgressErrorCode =
  | 'EGRESS_BAD_URL'
  | 'EGRESS_SCHEME'
  | 'EGRESS_PORT'
  | 'EGRESS_CREDENTIALS_IN_URL'
  | 'EGRESS_BAD_ADDRESS'
  | 'EGRESS_BAD_FAMILY'
  | 'EGRESS_FAMILY_MISMATCH'
  | 'EGRESS_BLOCKED'
  | 'EGRESS_BLOCKED_ALL_ADDRESSES'
  | 'EGRESS_DNS_FAILURE'
  | 'EGRESS_BAD_ALLOW_RULE';

/**
 * Punto exacto en el que se aplicó el control. Las cuatro capas de C-SSRF más
 * los puntos de redirección. Se registra en auditoría para poder demostrar
 * *dónde* se cortó.
 */
export type EgressCheckPoint =
  | 'preflight-url'
  | 'preflight-literal'
  | 'preflight-dns'
  | 'dns-lookup'
  | 'post-connect'
  | 'redirect-url'
  | 'redirect-literal'
  | 'redirect-dns'
  | 'allow-rule';

export class EgressError extends Error {
  readonly code: EgressErrorCode;
  readonly where: EgressCheckPoint;
  /** Dirección, host o puerto implicado. Sólo para el log del motor. */
  readonly detail: string;

  constructor(code: EgressErrorCode, where: EgressCheckPoint, detail: string) {
    super(`SSRF_BLOCKED at ${where}: ${detail}`);
    this.name = 'EgressError';
    this.code = code;
    this.where = where;
    this.detail = detail;
  }
}

export function isEgressError(err: unknown): err is EgressError {
  return err instanceof EgressError;
}

/**
 * Errores de uso del motor que no son de red (contrato inválido, función no
 * implementada). Se traducen a `INVALID_REQUEST` en el contrato v1.
 */
export class EngineRequestError extends Error {
  readonly detail: string;

  constructor(message: string, detail = '') {
    super(message);
    this.name = 'EngineRequestError';
    this.detail = detail;
  }
}
