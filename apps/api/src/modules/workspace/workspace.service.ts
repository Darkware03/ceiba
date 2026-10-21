import { Inject, Injectable } from '@nestjs/common';
import { RELOJ, type Reloj } from '../../platform/time/clock.ts';
import { Conflicto, Prohibido, RecursoNoEncontrado } from '../../platform/errors/domain-errors.ts';
import { PUERTO_DE_AUDITORIA, type PuertoDeAuditoria } from '../../platform/audit/ports.ts';
import {
  REPOSITORIO_DE_USUARIOS,
  REPOSITORIO_DE_WORKSPACES,
  type RepositorioDeUsuarios,
  type RepositorioDeWorkspaces,
} from '../../platform/persistence/repositories.ts';
import type {
  FilaMiembroDeWorkspace,
  FilaWorkspace,
} from '../../platform/persistence/records.ts';
import type { RolDeWorkspace } from '../../platform/guards/roles.ts';

@Injectable()
export class ServicioDeWorkspaces {
  constructor(
    @Inject(REPOSITORIO_DE_WORKSPACES) private readonly repo: RepositorioDeWorkspaces,
    @Inject(REPOSITORIO_DE_USUARIOS) private readonly usuarios: RepositorioDeUsuarios,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(PUERTO_DE_AUDITORIA) private readonly auditoria: PuertoDeAuditoria,
  ) {}

  async crear(
    propietarioId: string,
    datos: { slug: string; name: string; description: string | null },
    ip: string,
  ): Promise<FilaWorkspace> {
    const ahora = this.reloj.ahora();
    if ((await this.repo.buscarPorSlug(datos.slug)) !== null) {
      throw new Conflicto('Ya existe un workspace con ese identificador.');
    }
    const workspace = await this.repo.crearConPropietario(
      { ...datos, ownerUserId: propietarioId },
      ahora,
    );
    this.auditoria.registrar({
      accion: 'workspace.created',
      actorUserId: propietarioId,
      sessionId: null,
      workspaceId: workspace.id,
      recursoTipo: 'workspace',
      recursoId: workspace.id,
      clientIp: ip,
      detalles: { name: workspace.name, slug: workspace.slug },
    });
    return workspace;
  }

  async listarDeUsuario(usuarioId: string): Promise<readonly FilaWorkspace[]> {
    return this.repo.listarDeUsuario(usuarioId);
  }

  async obtener(workspaceId: string): Promise<FilaWorkspace> {
    const fila = await this.repo.buscarPorId(workspaceId);
    if (fila === null) throw new RecursoNoEncontrado('Workspace no encontrado.');
    return fila;
  }

  async actualizar(
    workspaceId: string,
    actorId: string,
    cambios: { name?: string; description?: string | null },
    ip: string,
  ): Promise<FilaWorkspace> {
    const fila = await this.repo.actualizar(workspaceId, cambios, this.reloj.ahora());
    if (fila === null) throw new RecursoNoEncontrado('Workspace no encontrado.');
    this.auditoria.registrar({
      accion: 'workspace.updated',
      actorUserId: actorId,
      sessionId: null,
      workspaceId,
      recursoTipo: 'workspace',
      recursoId: workspaceId,
      clientIp: ip,
      detalles: { name: fila.name, cambios },
    });
    return fila;
  }

  async borrar(workspaceId: string, actorId: string, ip: string): Promise<void> {
    const borrado = await this.repo.borrarLogicamente(workspaceId, actorId, this.reloj.ahora());
    if (!borrado) throw new RecursoNoEncontrado('Workspace no encontrado.');
    this.auditoria.registrar({
      accion: 'workspace.deleted',
      actorUserId: actorId,
      sessionId: null,
      workspaceId,
      recursoTipo: 'workspace',
      recursoId: workspaceId,
      clientIp: ip,
    });
  }

  // -------------------------------------------------------------------------
  // Miembros
  // -------------------------------------------------------------------------

  async listarMiembros(workspaceId: string): Promise<readonly FilaMiembroDeWorkspace[]> {
    return this.repo.listarMiembros(workspaceId);
  }

  /**
   * Alta directa de miembro por correo.
   *
   * NO es «invitar»: el flujo de invitación por enlace vive en la tabla
   * `invitations` y necesita correo saliente, que esta ronda no cubre. Esto es
   * el mínimo que permite demostrar la autorización de punta a punta, y así se
   * declara.
   */
  async anadirMiembro(
    workspaceId: string,
    correo: string,
    rol: RolDeWorkspace,
    actorId: string,
    ip: string,
  ): Promise<FilaMiembroDeWorkspace> {
    const usuario = await this.usuarios.buscarPorCorreo(correo);
    if (usuario === null) throw new RecursoNoEncontrado('Usuario no encontrado.');
    const existente = await this.repo.buscarMembresia(workspaceId, usuario.id);
    if (existente !== null && existente.status === 'active') {
      throw new Conflicto('Ese usuario ya es miembro del workspace.');
    }
    const miembro = await this.repo.altaDeMiembro(
      workspaceId,
      usuario.id,
      rol,
      actorId,
      this.reloj.ahora(),
    );
    this.auditoria.registrar({
      accion: 'member.invited',
      actorUserId: actorId,
      sessionId: null,
      workspaceId,
      recursoTipo: 'workspace_member',
      recursoId: miembro.id,
      clientIp: ip,
      metadata: { rol },
    });
    return miembro;
  }

  async cambiarRol(
    workspaceId: string,
    usuarioId: string,
    rol: RolDeWorkspace,
    actorId: string,
    ip: string,
  ): Promise<FilaMiembroDeWorkspace> {
    const workspace = await this.obtener(workspaceId);
    // Invariante del esquema: «cada workspace no borrado tiene al menos un
    // miembro activo con role='owner'». Degradar al propietario la rompería.
    if (workspace.ownerUserId === usuarioId && rol !== 'owner') {
      throw new Prohibido(
        'No se puede quitar el rol de propietario sin transferir antes la propiedad.',
      );
    }
    const miembro = await this.repo.cambiarRol(workspaceId, usuarioId, rol, this.reloj.ahora());
    if (miembro === null) throw new RecursoNoEncontrado('Miembro no encontrado.');
    this.auditoria.registrar({
      accion: 'member.role_changed',
      actorUserId: actorId,
      sessionId: null,
      workspaceId,
      recursoTipo: 'workspace_member',
      recursoId: miembro.id,
      clientIp: ip,
      metadata: { rol },
    });
    return miembro;
  }

  async expulsar(
    workspaceId: string,
    usuarioId: string,
    actorId: string,
    ip: string,
  ): Promise<void> {
    const workspace = await this.obtener(workspaceId);
    if (workspace.ownerUserId === usuarioId) {
      throw new Prohibido('No se puede expulsar al propietario del workspace.');
    }
    const expulsado = await this.repo.expulsarMiembro(workspaceId, usuarioId, this.reloj.ahora());
    if (!expulsado) throw new RecursoNoEncontrado('Miembro no encontrado.');
    // ADR-0009 §9: al expulsar a un miembro NO se revoca su sesión (puede
    // pertenecer a otros workspaces). El guard deniega en la siguiente
    // operación porque ya no hay fila activa en `workspace_members`.
    this.auditoria.registrar({
      accion: 'member.removed',
      actorUserId: actorId,
      sessionId: null,
      workspaceId,
      recursoTipo: 'workspace_member',
      recursoId: usuarioId,
      clientIp: ip,
    });
  }
}
