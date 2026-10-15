import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { CLAVE_PRINCIPAL, type Principal } from './principal.ts';
import type { RolDeWorkspace } from '../guards/roles.ts';

/**
 * Metadatos declarativos. El ADR-0001 §3 lo exige así: «que el control sea
 * declarativo es lo que permite escribir una prueba que recorra todas las rutas
 * y falle si alguna carece de guard. Un control que no se puede enumerar no se
 * puede auditar». `test/route-inventory.test.ts` hace exactamente eso.
 */

export const META_PUBLICO = 'ceiba:publico';
export const META_ROL_MINIMO = 'ceiba:rol-minimo';
export const META_RECURSO = 'ceiba:recurso';

/** Marca una ruta como accesible sin sesión. Por defecto, TODAS la exigen. */
export const Publico = (): MethodDecorator & ClassDecorator => SetMetadata(META_PUBLICO, true);

/**
 * Rol mínimo exigido en el workspace del recurso.
 * Equivale al `@RequireWorkspaceRole('editor')` del ADR-0009 §7.3.
 */
export const RequiereRolDeWorkspace = (rol: RolDeWorkspace): MethodDecorator & ClassDecorator =>
  SetMetadata(META_ROL_MINIMO, rol);

export interface RecursoProtegido {
  /**
   * Tipo registrado en `RESOLUTORES_DE_RECURSO`, o `'workspace'` para indicar
   * que el parámetro YA es el identificador del workspace.
   */
  readonly tipo: string;
  /** Nombre del parámetro de ruta que contiene el identificador. */
  readonly parametro: string;
}

/** Declara de qué parámetro sale el recurso que hay que resolver a workspace. */
export const Recurso = (recurso: RecursoProtegido): MethodDecorator & ClassDecorator =>
  SetMetadata(META_RECURSO, recurso);

/** Inyecta el principal que dejó `GuardDeSesion`. */
export const Usuario = createParamDecorator((_dato: unknown, contexto: ExecutionContext) => {
  const peticion = contexto.switchToHttp().getRequest<Record<string, unknown>>();
  return peticion[CLAVE_PRINCIPAL] as Principal | undefined;
});
