import { peticionApi } from './cliente';
import type {
  EntradaActualizarWorkspace,
  EntradaCrearWorkspace,
  MiembroDeWorkspace,
  Workspace,
} from './tipos';

/**
 * Familia «Workspaces» (`/api/v1/workspaces`), transcrita de
 * `apps/api/src/modules/workspace/workspace.controller.ts`.
 *
 * Nota sobre los roles mínimos que exige el servidor (ADR-0009 §7.5), porque
 * condicionan lo que la interfaz debe mostrar deshabilitado:
 *   listar/obtener -> viewer · actualizar -> admin · borrar -> owner.
 * La autorización **no** se decide aquí: ocultar un botón no es un control
 * (§5 del prompt maestro). Esto es sólo cortesía de interfaz.
 */

export function listarWorkspaces(): Promise<{ workspaces: Workspace[] }> {
  return peticionApi<{ workspaces: Workspace[] }>('/workspaces');
}

export function obtenerWorkspace(workspaceId: string): Promise<{ workspace: Workspace }> {
  return peticionApi<{ workspace: Workspace }>(`/workspaces/${encodeURIComponent(workspaceId)}`);
}

export function crearWorkspace(entrada: EntradaCrearWorkspace): Promise<{ workspace: Workspace }> {
  return peticionApi<{ workspace: Workspace }>('/workspaces', { metodo: 'POST', cuerpo: entrada });
}

/** Renombrar y cambiar descripción. Exige rol `admin` en el servidor. */
export function actualizarWorkspace(
  workspaceId: string,
  entrada: EntradaActualizarWorkspace,
): Promise<{ workspace: Workspace }> {
  return peticionApi<{ workspace: Workspace }>(`/workspaces/${encodeURIComponent(workspaceId)}`, {
    metodo: 'PATCH',
    cuerpo: entrada,
  });
}

/** 204. Exige rol `owner` en el servidor. */
export function borrarWorkspace(workspaceId: string): Promise<void> {
  return peticionApi<void>(`/workspaces/${encodeURIComponent(workspaceId)}`, { metodo: 'DELETE' });
}

export function listarMiembros(workspaceId: string): Promise<{ miembros: MiembroDeWorkspace[] }> {
  return peticionApi<{ miembros: MiembroDeWorkspace[] }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/members`,
  );
}
