import { Inject, Injectable } from '@nestjs/common';
import type { PuertoDeAutorizacionDeWorkspace } from '../../platform/auth/ports.ts';
import type { RolDeWorkspace } from '../../platform/guards/roles.ts';
import { esRolDeWorkspace } from '../../platform/guards/roles.ts';
import {
  REPOSITORIO_DE_WORKSPACES,
  type RepositorioDeWorkspaces,
} from '../../platform/persistence/repositories.ts';

/**
 * Implementación del puerto que declara `platform/auth/ports.ts`.
 *
 * Es la **tabla de autorización canónica** del esquema: «TODA comprobación de
 * permiso del backend resuelve contra esta fila, no contra el frontend». Sólo
 * cuenta la membresía con `status = 'active'`; `suspended` y `removed` no
 * autorizan nada.
 *
 * SIN CACHÉ, a propósito. El ADR-0009 §7.3 **permite** una caché de ≤ 30 s
 * «con invalidación por el evento `permission.changed`». El bus de eventos no
 * existe todavía en `apps/api` (ver la desviación declarada en
 * `platform/audit/ports.ts`), así que una caché aquí no tendría cómo
 * invalidarse y un cambio de rol tardaría hasta 30 s en aplicarse. Prefiero la
 * lectura por petición y decirlo, a una caché que se queda obsoleta en
 * silencio. El techo del ADR es un máximo, no una obligación.
 */
@Injectable()
export class AdaptadorDeAutorizacionDeWorkspace implements PuertoDeAutorizacionDeWorkspace {
  constructor(
    @Inject(REPOSITORIO_DE_WORKSPACES) private readonly repo: RepositorioDeWorkspaces,
  ) {}

  async resolverRol(workspaceId: string, usuarioId: string): Promise<RolDeWorkspace | null> {
    const workspace = await this.repo.buscarPorId(workspaceId);
    if (workspace === null) return null; // borrado lógico -> no existe para nadie

    const miembro = await this.repo.buscarMembresia(workspaceId, usuarioId);
    if (miembro === null) return null;
    if (miembro.status !== 'active') return null;
    // Un valor de rol fuera del enum se trata como «sin rol». Fallo cerrado.
    if (!esRolDeWorkspace(miembro.role)) return null;
    return miembro.role;
  }
}
