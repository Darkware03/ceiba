import { Module } from '@nestjs/common';
import { PUERTO_AUTORIZACION_WORKSPACE } from '../../platform/auth/ports.ts';
import { ControladorDeWorkspaces } from './workspace.controller.ts';
import { ServicioDeWorkspaces } from './workspace.service.ts';
import { AdaptadorDeAutorizacionDeWorkspace } from './workspace-authorization.adapter.ts';

/**
 * `workspace` — Workspaces, WorkspaceMembers, Projects (ADR-0004 §6).
 *
 * **Es quien implementa `PUERTO_AUTORIZACION_WORKSPACE`.** Esta línea es la
 * inversión de dependencia del ADR-0009 §7.3: el código que conoce
 * `workspace_members` sigue siendo sólo el de este módulo, pero la flecha de
 * compilación apunta al revés que la flecha de llamada, y el grafo
 * `platform → identity → workspace → collection` se queda sin ciclos.
 */
@Module({
  controllers: [ControladorDeWorkspaces],
  providers: [
    ServicioDeWorkspaces,
    AdaptadorDeAutorizacionDeWorkspace,
    {
      provide: PUERTO_AUTORIZACION_WORKSPACE,
      useExisting: AdaptadorDeAutorizacionDeWorkspace,
    },
  ],
  exports: [PUERTO_AUTORIZACION_WORKSPACE, ServicioDeWorkspaces],
})
export class ModuloDeWorkspaces {}
