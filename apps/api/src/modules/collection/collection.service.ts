import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { RELOJ, type Reloj } from '../../platform/time/clock.ts';
import { Conflicto, RecursoNoEncontrado } from '../../platform/errors/domain-errors.ts';
import { PUERTO_DE_AUDITORIA, type PuertoDeAuditoria } from '../../platform/audit/ports.ts';
import type { ResolutorDeRecurso } from '../../platform/auth/ports.ts';
import { RegistroDeResolutores } from '../../platform/auth/resource-resolver.registry.ts';
import {
  REPOSITORIO_DE_COLECCIONES,
  type RepositorioDeColecciones,
} from '../../platform/persistence/repositories.ts';
import type { FilaColeccion } from '../../platform/persistence/records.ts';

/**
 * CRUD mínimo de colecciones, con el permiso aplicado **en el servidor**.
 *
 * El servicio es además el `ResolutorDeRecurso` de tipo `collection`: traduce
 * `collectionId -> workspace_id` para el guard (ADR-0009 §7.4). Se registra a
 * sí mismo en `onModuleInit`, así que `app.module.ts` sigue con una sola línea
 * por módulo (protocolo de costura del ADR-0004 §3).
 */
@Injectable()
export class ServicioDeColecciones implements ResolutorDeRecurso, OnModuleInit {
  readonly tipo = 'collection';

  constructor(
    @Inject(REPOSITORIO_DE_COLECCIONES) private readonly repo: RepositorioDeColecciones,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(PUERTO_DE_AUDITORIA) private readonly auditoria: PuertoDeAuditoria,
    private readonly resolutores: RegistroDeResolutores,
  ) {}

  onModuleInit(): void {
    this.resolutores.registrar(this);
  }

  async resolverWorkspaceId(coleccionId: string): Promise<string | null> {
    return this.repo.workspaceIdDe(coleccionId);
  }

  // -------------------------------------------------------------------------

  async crear(
    workspaceId: string,
    datos: { slug: string; name: string; description: string | null },
    actorId: string,
    ip: string,
  ): Promise<FilaColeccion> {
    if ((await this.repo.buscarPorSlug(workspaceId, datos.slug)) !== null) {
      throw new Conflicto('Ya existe una colección con ese identificador en el workspace.');
    }
    const fila = await this.repo.crear(
      { ...datos, workspaceId, createdByUserId: actorId },
      this.reloj.ahora(),
    );
    this.auditoria.registrar({
      accion: 'collection.created',
      actorUserId: actorId,
      sessionId: null,
      workspaceId,
      recursoTipo: 'collection',
      recursoId: fila.id,
      clientIp: ip,
      detalles: { name: fila.name, slug: fila.slug },
    });
    return fila;
  }

  async listar(workspaceId: string): Promise<readonly FilaColeccion[]> {
    return this.repo.listarPorWorkspace(workspaceId);
  }

  async obtener(coleccionId: string): Promise<FilaColeccion> {
    const fila = await this.repo.buscarPorId(coleccionId);
    if (fila === null) throw new RecursoNoEncontrado('Colección no encontrada.');
    return fila;
  }

  async actualizar(
    coleccionId: string,
    cambios: { name?: string; description?: string | null },
    actorId: string,
    ip: string,
  ): Promise<FilaColeccion> {
    const fila = await this.repo.actualizar(coleccionId, cambios, this.reloj.ahora());
    if (fila === null) throw new RecursoNoEncontrado('Colección no encontrada.');
    this.auditoria.registrar({
      accion: 'collection.updated',
      actorUserId: actorId,
      sessionId: null,
      workspaceId: fila.workspaceId,
      recursoTipo: 'collection',
      recursoId: fila.id,
      clientIp: ip,
      detalles: { name: fila.name, cambios },
    });
    return fila;
  }

  async borrar(coleccionId: string, actorId: string, ip: string): Promise<void> {
    const fila = await this.repo.buscarPorId(coleccionId);
    if (fila === null) throw new RecursoNoEncontrado('Colección no encontrada.');
    await this.repo.borrarLogicamente(coleccionId, actorId, this.reloj.ahora());
    this.auditoria.registrar({
      accion: 'collection.deleted',
      actorUserId: actorId,
      sessionId: null,
      workspaceId: fila.workspaceId,
      recursoTipo: 'collection',
      recursoId: coleccionId,
      clientIp: ip,
      detalles: { name: fila.name, slug: fila.slug },
    });
  }
}
