/**
 * Auditoría de operaciones sensibles (ADR-0009 §10).
 *
 * Verbos conformes al `CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')`
 * de `audit_logs`. La lista está cerrada aquí para que un verbo nuevo sea un
 * error de compilación y no una fila que el CHECK rechaza en producción.
 *
 * DESVIACIÓN DECLARADA respecto al ADR-0009 §10, que pide que esto viaje «por
 * **evento de dominio** hacia `audit`, nunca por llamada directa». Aquí es un
 * puerto inyectado: `identity` depende de una interfaz de `platform`, no de
 * `modules/audit`, así que la propiedad que el ADR-0004 protege (que `audit` no
 * dependa de nadie y nadie importe `audit`) se mantiene. Falta el bus:
 * `@nestjs/event-emitter` **no está en la lista de versiones fijadas del
 * ADR-0008** y no voy a añadir una dependencia no fijada por mi cuenta. Pido
 * que se fije en el ADR-0008 y lo cambio.
 */

export const ACCIONES_DE_AUDITORIA = [
  'auth.register',
  'auth.login',
  'auth.login_failed',
  'auth.locked_out',
  'auth.logout',
  'auth.logout_all',
  'auth.mfa_enabled',
  'auth.password_changed',
  'session.rotated',
  'session.revoked',
  'session.reuse_detected',
  'member.invited',
  'member.role_changed',
  'member.removed',
  'workspace.created',
  'workspace.updated',
  'workspace.deleted',
  'collection.created',
  'collection.updated',
  'collection.deleted',
] as const;

export type AccionDeAuditoria = (typeof ACCIONES_DE_AUDITORIA)[number];

export interface EventoDeAuditoria {
  readonly accion: AccionDeAuditoria;
  readonly actorUserId: string | null;
  readonly sessionId: string | null;
  readonly workspaceId: string | null;
  readonly recursoTipo: string | null;
  readonly recursoId: string | null;
  readonly clientIp: string | null;
  /**
   * NUNCA contiene contraseñas, testigos, selectores ni verificadores
   * (ADR-0009 §10). `ServicioDeAuditoria` lo vuelve a filtrar por si acaso.
   */
  readonly metadata?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface PuertoDeAuditoria {
  registrar(evento: EventoDeAuditoria): void;
}

export const PUERTO_DE_AUDITORIA = Symbol('PUERTO_DE_AUDITORIA');
