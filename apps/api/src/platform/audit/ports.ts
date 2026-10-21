export const ACCION_AUDITORIA = {
  AUTH_REGISTRO: 'auth.register',
  AUTH_LOGIN_EXITOSO: 'auth.login.succeeded',
  AUTH_LOGIN_FALLIDO: 'auth.login.failed',
  AUTH_MFA_REQUERIDO: 'auth.mfa.challenged',
  AUTH_MFA_EXITOSO: 'auth.mfa.succeeded',
  AUTH_MFA_FALLIDO: 'auth.mfa.failed',
  AUTH_LOGOUT: 'auth.logout',
  SESION_CREADA: 'session.created',
  SESION_REVOCADA: 'session.revoked',
  SESION_REFRESCADA: 'session.refreshed',
  AUTORIZACION_DENEGADA: 'authz.denied',
  WORKSPACE_CREADO: 'workspace.created',
  WORKSPACE_ACTUALIZADO: 'workspace.updated',
  WORKSPACE_RENOMBRADO: 'workspace.renamed',
  WORKSPACE_ELIMINADO: 'workspace.deleted',
  WORKSPACE_INVITACION_CREADA: 'workspace.invitation.created',
  WORKSPACE_INVITACION_ACEPTADA: 'workspace.invitation.accepted',
  WORKSPACE_INVITACION_REVOCADA: 'workspace.invitation.revoked',
  WORKSPACE_MIEMBRO_ROL_CAMBIADO: 'workspace.member.role_changed',
  WORKSPACE_MIEMBRO_ELIMINADO: 'workspace.member.removed',
  INVITACION_CREADA: 'workspace.invitation.created',
  INVITACION_ACEPTADA: 'workspace.invitation.accepted',
  INVITACION_REVOCADA: 'workspace.invitation.revoked',
  MIEMBRO_ROL_CAMBIADO: 'workspace.member.role_changed',
  MIEMBRO_ELIMINADO: 'workspace.member.removed',
  COLECCION_CREADA: 'collection.created',
  COLECCION_ACTUALIZADA: 'collection.updated',
  COLECCION_ELIMINADA: 'collection.deleted',
  COLECCION_IMPORTADA: 'collection.imported',
  COLECCION_EXPORTADA: 'collection.exported',
  COLECCION_EJECUTADA: 'collection.run.executed',
  CARPETA_CREADA: 'folder.created',
  CARPETA_ACTUALIZADA: 'folder.updated',
  CARPETA_ELIMINADA: 'folder.deleted',
  PETICION_CREADA: 'request.created',
  PETICION_ACTUALIZADA: 'request.updated',
  PETICION_ELIMINADA: 'request.deleted',
  PETICION_EJECUTADA: 'request.executed',
  ENTORNO_CREADO: 'environment.created',
  ENTORNO_ACTUALIZADO: 'environment.updated',
  ENTORNO_ELIMINADO: 'environment.deleted',
} as const;

export const ACCIONES_AUDITORIA = ACCION_AUDITORIA;

export type AccionDeAuditoria =
  | (typeof ACCION_AUDITORIA)[keyof typeof ACCION_AUDITORIA]
  | (string & {});

export interface RecursoDeAuditoria {
  readonly type: string;
  readonly id?: string | null;
}

export interface EventoDeAuditoria {
  readonly accion?: AccionDeAuditoria;
  readonly action?: string;
  readonly actorUsuarioId?: string | null;
  readonly actorUserId?: string | null;
  readonly actorEmail?: string | null;
  readonly sessionId?: string | null;
  readonly workspaceId?: string | null;
  readonly recursoTipo?: string;
  readonly recursoId?: string | null;
  readonly resource?: RecursoDeAuditoria;
  readonly resultado?: 'exito' | 'fallo' | 'denegado';
  readonly outcome?: 'success' | 'failure' | 'denied';
  readonly ipOrigen?: string | null;
  readonly clientIp?: string | null;
  readonly agenteUsuario?: string | null;
  readonly userAgent?: string | null;
  readonly metadatos?: Readonly<Record<string, unknown>>;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly detalles?: Readonly<Record<string, unknown>>;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface PuertoDeAuditoria {
  registrar(evento: EventoDeAuditoria): void;
}

export type ServicioDeAuditoria = PuertoDeAuditoria;

export const PUERTO_DE_AUDITORIA = Symbol('ceiba.AuditPort');
export const SERVICIO_DE_AUDITORIA = PUERTO_DE_AUDITORIA;
export const TOKEN_SERVICIO_AUDITORIA = PUERTO_DE_AUDITORIA;
