import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { META_RECURSO, META_ROL_MINIMO, type RecursoProtegido } from '../auth/decorators.ts';
import { CLAVE_PRINCIPAL, type Principal } from '../auth/principal.ts';
import {
  PUERTO_AUTORIZACION_WORKSPACE,
  type PuertoDeAutorizacionDeWorkspace,
} from '../auth/ports.ts';
import { RegistroDeResolutores } from '../auth/resource-resolver.registry.ts';
import { NoAutenticado, Prohibido, RecursoNoEncontrado } from '../errors/domain-errors.ts';
import { alcanza, type RolDeWorkspace } from './roles.ts';
import type { PeticionHttp } from '../http/http-types.ts';

/**
 * Autorización por **propiedad del recurso**, resuelta en el servidor
 * (ADR-0009 §7.3 y §7.4; §5 y §19 del prompt maestro).
 *
 * Secuencia, sin atajos:
 *   1. Toda ruta protegida declara `@Recurso({ tipo, parametro })`.
 *   2. El recurso se resuelve **a su `workspace_id`**. No existe ninguna ruta
 *      que autorice por posesión del identificador.
 *   3. Se consulta `workspace_members (workspace_id, user_id)` con
 *      `status = 'active'` a través del puerto. **No se toca Prisma aquí.**
 *   4. Sin fila activa -> **404**, no 403: revelar la existencia del recurso ya
 *      sería una fuga (§7.4). Con fila pero rol insuficiente -> **403**, porque
 *      el usuario ya sabe que el recurso existe.
 *
 * El guard **no importa nada de `modules/`**: recibe el puerto y los resolutores
 * por testigo de DI. Es la inversión de dependencia obligatoria del §7.3; sin
 * ella `madge --circular` dejaría de salir en verde.
 */
@Injectable()
export class GuardDeAutorizacion implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(PUERTO_AUTORIZACION_WORKSPACE)
    private readonly autorizacion: PuertoDeAutorizacionDeWorkspace,
    private readonly resolutores: RegistroDeResolutores,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    if (contexto.getType() !== 'http') return true;

    const rolMinimo = this.reflector.getAllAndOverride<RolDeWorkspace | undefined>(
      META_ROL_MINIMO,
      [contexto.getHandler(), contexto.getClass()],
    );
    if (rolMinimo === undefined) return true; // Ruta no acotada a workspace.

    const recurso = this.reflector.getAllAndOverride<RecursoProtegido | undefined>(META_RECURSO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (recurso === undefined) {
      // Configuración incompleta: se deniega. Fallar abierto por un decorador
      // que falta sería exactamente el agujero que este guard existe para tapar.
      throw new Prohibido('Ruta mal configurada: falta @Recurso.');
    }

    const peticion = contexto.switchToHttp().getRequest<PeticionHttp>();
    const principal = (peticion as Record<string, unknown>)[CLAVE_PRINCIPAL] as
      | Principal
      | undefined;
    if (principal === undefined) {
      throw new NoAutenticado('autorizacion_sin_principal');
    }

    const identificador = peticion.params?.[recurso.parametro];
    if (typeof identificador !== 'string' || identificador.length === 0) {
      throw new RecursoNoEncontrado();
    }

    const workspaceId = await this.#resolverWorkspace(recurso, identificador);
    if (workspaceId === null) throw new RecursoNoEncontrado();

    const rol = await this.autorizacion.resolverRol(workspaceId, principal.usuarioId);
    if (rol === null) throw new RecursoNoEncontrado(); // §7.4: 404, no 403.
    if (!alcanza(rol, rolMinimo)) {
      throw new Prohibido('Tu rol en este workspace no permite esta operación.');
    }

    (peticion as Record<string, unknown>)['ceibaWorkspaceId'] = workspaceId;
    (peticion as Record<string, unknown>)['ceibaRol'] = rol;
    return true;
  }

  async #resolverWorkspace(recurso: RecursoProtegido, identificador: string): Promise<string | null> {
    if (recurso.tipo === 'workspace') return identificador;
    const resolutor = this.resolutores.obtener(recurso.tipo);
    if (resolutor === undefined) {
      // Tipo sin resolutor registrado: se deniega. Nunca se asume el workspace.
      throw new Prohibido(`Tipo de recurso sin resolutor: ${recurso.tipo}`);
    }
    return resolutor.resolverWorkspaceId(identificador);
  }
}
