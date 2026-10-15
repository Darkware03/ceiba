import type { ContextoDePeticion, Principal } from './principal.ts';
import type { RolDeWorkspace } from '../guards/roles.ts';

/**
 * Puertos que **declara `platform`** y que **implementan los módulos**.
 *
 * Esto es la inversión de dependencia obligatoria del ADR-0009 §7.3, citada
 * literalmente: «si `platform/guards` importara `workspace.public.ts`, el grafo
 * quedaría `platform → workspace → identity → platform`: **un ciclo**». Por eso
 * la interfaz y su testigo de inyección viven aquí, en `platform/auth/ports.ts`,
 * y `modules/workspace` los implementa. La flecha de compilación apunta al
 * revés que la flecha de llamada.
 */

// ---------------------------------------------------------------------------
// Sesión (lo implementa `modules/identity`)
// ---------------------------------------------------------------------------

export interface CookieEmitida {
  readonly nombre: string;
  readonly valor: string;
  readonly expiraEn: Date;
}

export interface ResultadoDeValidacionDeSesion {
  readonly principal: Principal;
  /**
   * Presente sólo cuando la sesión se ha **rotado** en esta misma petición
   * (ADR-0009 §4). La respuesta debe llevar la cookie nueva.
   */
  readonly cookieNueva?: CookieEmitida;
}

export interface PuertoDeSesion {
  /**
   * Valida el testigo de la cookie. Lanza `NoAutenticado` ante **cualquier**
   * fallo, con una respuesta 401 idéntica en todos los casos (ADR-0009 §2).
   */
  validar(
    valorCookie: string | undefined,
    contexto: ContextoDePeticion,
  ): Promise<ResultadoDeValidacionDeSesion>;
}

export const PUERTO_DE_SESION = Symbol('PUERTO_DE_SESION');

// ---------------------------------------------------------------------------
// Autorización de workspace (lo implementa `modules/workspace`)
// ---------------------------------------------------------------------------

export interface PuertoDeAutorizacionDeWorkspace {
  /**
   * Rol efectivo del usuario en el workspace, o `null` si no hay fila activa en
   * `workspace_members`. `null` significa «no existe para ti»: el guard
   * responde **404**, no 403 (ADR-0009 §7.4).
   */
  resolverRol(workspaceId: string, usuarioId: string): Promise<RolDeWorkspace | null>;
}

export const PUERTO_AUTORIZACION_WORKSPACE = Symbol('PUERTO_AUTORIZACION_WORKSPACE');

// ---------------------------------------------------------------------------
// Resolución recurso -> workspace (§7.4: conocer el ID no basta)
// ---------------------------------------------------------------------------

/**
 * «Todo recurso protegido resuelve **a su `workspace_id`** antes de autorizar».
 * Cada módulo dueño de un recurso registra aquí su resolutor; el guard no sabe
 * nada de tablas.
 */
export interface ResolutorDeRecurso {
  /** Identificador del tipo de recurso, p. ej. `'collection'`. */
  readonly tipo: string;
  /** `null` si el recurso no existe o está borrado lógicamente. */
  resolverWorkspaceId(recursoId: string): Promise<string | null>;
}
