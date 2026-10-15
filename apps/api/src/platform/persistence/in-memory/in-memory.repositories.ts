import { randomUUID } from 'node:crypto';
import type { RolDeWorkspace } from '../../guards/roles.ts';
import type {
  FilaColeccion,
  FilaMiembroDeWorkspace,
  FilaSesion,
  FilaUsuario,
  FilaWorkspace,
  MotivoDeRevocacion,
} from '../records.ts';
import type {
  DatosNuevaColeccion,
  DatosNuevaSesion,
  DatosNuevoUsuario,
  DatosNuevoWorkspace,
  RepositorioDeColecciones,
  RepositorioDeSesiones,
  RepositorioDeUsuarios,
  RepositorioDeWorkspaces,
} from '../repositories.ts';

/**
 * Repositorios en memoria.
 *
 * **Qué son y qué no son.** Son el doble que permite ejecutar de verdad, en
 * este contenedor y sin PostgreSQL, la lógica de sesiones, rotación, detección
 * de reutilización y autorización. **No** demuestran nada sobre el
 * comportamiento de PostgreSQL: ni `citext`, ni índices parciales, ni la
 * atomicidad de la revocación de familia bajo concurrencia. Allí donde el
 * comportamiento depende del motor, el informe lo dice.
 */

function normalizarCorreo(correo: string): string {
  // Aproximación a `citext`: minúsculas. PostgreSQL con `citext` usa reglas de
  // cotejo que esto NO reproduce; es suficiente para la lógica, no es prueba
  // del comportamiento real del motor.
  return correo.trim().toLowerCase();
}

// ---------------------------------------------------------------------------

export class RepositorioDeUsuariosEnMemoria implements RepositorioDeUsuarios {
  readonly #porId = new Map<string, FilaUsuario>();

  /** Siembra directa, sólo para pruebas y arranque en modo memoria. */
  sembrar(fila: FilaUsuario): FilaUsuario {
    this.#porId.set(fila.id, fila);
    return fila;
  }

  async buscarPorCorreo(correo: string): Promise<FilaUsuario | null> {
    const objetivo = normalizarCorreo(correo);
    for (const fila of this.#porId.values()) {
      if (fila.deletedAt === null && normalizarCorreo(fila.email) === objetivo) return fila;
    }
    return null;
  }

  async buscarPorId(id: string): Promise<FilaUsuario | null> {
    const fila = this.#porId.get(id);
    return fila !== undefined && fila.deletedAt === null ? fila : null;
  }

  async crear(datos: DatosNuevoUsuario, ahora: Date): Promise<FilaUsuario> {
    const fila: FilaUsuario = {
      id: randomUUID(),
      email: datos.email.trim(),
      emailVerifiedAt: null,
      passwordHash: datos.passwordHash,
      passwordUpdatedAt: ahora,
      displayName: datos.displayName,
      locale: datos.locale ?? 'es',
      timezone: datos.timezone ?? 'UTC',
      status: datos.status ?? 'active',
      mfaEnabled: false,
      mfaSecretId: null,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: null,
      createdAt: ahora,
      updatedAt: ahora,
      deletedAt: null,
    };
    this.#porId.set(fila.id, fila);
    return fila;
  }

  async registrarFalloDeAcceso(
    id: string,
    fallosConsecutivos: number,
    bloqueadoHasta: Date | null,
    ahora: Date,
  ): Promise<void> {
    const fila = this.#porId.get(id);
    if (fila === undefined) return;
    this.#porId.set(id, {
      ...fila,
      failedLoginCount: fallosConsecutivos,
      lockedUntil: bloqueadoHasta,
      updatedAt: ahora,
    });
  }

  async registrarAccesoCorrecto(id: string, ahora: Date): Promise<void> {
    const fila = this.#porId.get(id);
    if (fila === undefined) return;
    this.#porId.set(id, {
      ...fila,
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: ahora,
      updatedAt: ahora,
    });
  }

  async actualizarContrasena(id: string, hashPhc: string, ahora: Date): Promise<void> {
    const fila = this.#porId.get(id);
    if (fila === undefined) return;
    this.#porId.set(id, {
      ...fila,
      passwordHash: hashPhc,
      passwordUpdatedAt: ahora,
      updatedAt: ahora,
    });
  }
}

// ---------------------------------------------------------------------------

export class RepositorioDeSesionesEnMemoria implements RepositorioDeSesiones {
  readonly #porId = new Map<string, FilaSesion>();
  readonly #porSelector = new Map<string, string>();

  async crear(datos: DatosNuevaSesion): Promise<FilaSesion> {
    if (this.#porSelector.has(datos.tokenSelector)) {
      throw new Error('uq_sessions_selector: selector duplicado');
    }
    const fila: FilaSesion = {
      id: randomUUID(),
      userId: datos.userId,
      tokenSelector: datos.tokenSelector,
      tokenVerifierHash: datos.tokenVerifierHash,
      parentSessionId: datos.parentSessionId,
      userAgent: datos.userAgent,
      clientIp: datos.clientIp,
      deviceLabel: datos.deviceLabel,
      issuedAt: datos.issuedAt,
      lastSeenAt: datos.issuedAt,
      absoluteExpiresAt: datos.absoluteExpiresAt,
      idleExpiresAt: datos.idleExpiresAt,
      revokedAt: null,
      revokedReason: null,
    };
    this.#porId.set(fila.id, fila);
    this.#porSelector.set(fila.tokenSelector, fila.id);
    return fila;
  }

  async buscarPorSelector(selector: string): Promise<FilaSesion | null> {
    const id = this.#porSelector.get(selector);
    if (id === undefined) return null;
    return this.#porId.get(id) ?? null;
  }

  async buscarPorId(id: string): Promise<FilaSesion | null> {
    return this.#porId.get(id) ?? null;
  }

  async buscarHijaViva(idPadre: string): Promise<FilaSesion | null> {
    for (const fila of this.#porId.values()) {
      if (fila.parentSessionId === idPadre && fila.revokedAt === null) return fila;
    }
    return null;
  }

  async listarVivasDeUsuario(usuarioId: string, ahora: Date): Promise<readonly FilaSesion[]> {
    const vivas: FilaSesion[] = [];
    for (const fila of this.#porId.values()) {
      if (fila.userId !== usuarioId) continue;
      if (fila.revokedAt !== null) continue;
      if (fila.absoluteExpiresAt.getTime() <= ahora.getTime()) continue;
      if (fila.idleExpiresAt.getTime() <= ahora.getTime()) continue;
      vivas.push(fila);
    }
    return vivas.sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
  }

  async tocarUltimaActividad(id: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<void> {
    const fila = this.#porId.get(id);
    if (fila === undefined) return;
    this.#porId.set(id, { ...fila, lastSeenAt, idleExpiresAt });
  }

  async revocar(id: string, ahora: Date, motivo: MotivoDeRevocacion): Promise<void> {
    const fila = this.#porId.get(id);
    if (fila === undefined || fila.revokedAt !== null) return;
    this.#porId.set(id, { ...fila, revokedAt: ahora, revokedReason: motivo });
  }

  /** Traducción fiel del `WITH RECURSIVE` del ADR-0009 §4. */
  async revocarFamilia(
    sesionId: string,
    usuarioId: string,
    ahora: Date,
    motivo: MotivoDeRevocacion,
  ): Promise<number> {
    // (1) Subir: de la sesión presentada hacia sus padres.
    const ancestros = new Set<string>();
    let cursor: FilaSesion | undefined = this.#porId.get(sesionId);
    while (cursor !== undefined && !ancestros.has(cursor.id)) {
      ancestros.add(cursor.id);
      cursor = cursor.parentSessionId === null ? undefined : this.#porId.get(cursor.parentSessionId);
    }

    // (2) La raíz es la única SIN padre. No «la de menor id»: apoyarse en el
    //     orden de UUIDv7 sería un acoplamiento silencioso al formato de clave.
    let raiz: string | null = null;
    for (const id of ancestros) {
      const fila = this.#porId.get(id);
      if (fila !== undefined && fila.parentSessionId === null) {
        raiz = fila.id;
        break;
      }
    }

    // (3) Bajar: la raíz y toda su descendencia. Conjunto -> deduplica y corta
    //     cualquier ciclo accidental (equivale al UNION, no UNION ALL).
    const familia = new Set<string>();
    if (raiz !== null) {
      const pendientes = [raiz];
      while (pendientes.length > 0) {
        const actual = pendientes.pop() as string;
        if (familia.has(actual)) continue;
        familia.add(actual);
        for (const fila of this.#porId.values()) {
          if (fila.parentSessionId === actual && !familia.has(fila.id)) pendientes.push(fila.id);
        }
      }
    }

    // Fallo CERRADO: familia vacía -> se revoca todo lo vivo del usuario.
    const objetivo: Iterable<string> =
      familia.size > 0
        ? familia
        : [...this.#porId.values()].filter((f) => f.userId === usuarioId).map((f) => f.id);

    let revocadas = 0;
    for (const id of objetivo) {
      const fila = this.#porId.get(id);
      if (fila === undefined || fila.revokedAt !== null) continue;
      this.#porId.set(id, { ...fila, revokedAt: ahora, revokedReason: motivo });
      revocadas += 1;
    }
    return revocadas;
  }

  async revocarTodasDeUsuario(
    usuarioId: string,
    ahora: Date,
    motivo: MotivoDeRevocacion,
    exceptoId?: string,
  ): Promise<number> {
    let revocadas = 0;
    for (const fila of [...this.#porId.values()]) {
      if (fila.userId !== usuarioId) continue;
      if (fila.revokedAt !== null) continue;
      if (exceptoId !== undefined && fila.id === exceptoId) continue;
      this.#porId.set(fila.id, { ...fila, revokedAt: ahora, revokedReason: motivo });
      revocadas += 1;
    }
    return revocadas;
  }

  /** Sólo para aserciones de prueba. */
  todas(): readonly FilaSesion[] {
    return [...this.#porId.values()];
  }
}

// ---------------------------------------------------------------------------

export class RepositorioDeWorkspacesEnMemoria implements RepositorioDeWorkspaces {
  readonly #workspaces = new Map<string, FilaWorkspace>();
  readonly #miembros = new Map<string, FilaMiembroDeWorkspace>();

  #claveMiembro(workspaceId: string, usuarioId: string): string {
    return `${workspaceId}::${usuarioId}`;
  }

  async crearConPropietario(datos: DatosNuevoWorkspace, ahora: Date): Promise<FilaWorkspace> {
    const fila: FilaWorkspace = {
      id: randomUUID(),
      slug: datos.slug,
      name: datos.name,
      description: datos.description,
      ownerUserId: datos.ownerUserId,
      allowPublicSharing: true,
      status: 'active',
      createdAt: ahora,
      updatedAt: ahora,
      deletedAt: null,
    };
    this.#workspaces.set(fila.id, fila);
    const miembro: FilaMiembroDeWorkspace = {
      id: randomUUID(),
      workspaceId: fila.id,
      userId: datos.ownerUserId,
      role: 'owner',
      status: 'active',
      invitedByUserId: null,
      joinedAt: ahora,
      updatedAt: ahora,
      removedAt: null,
    };
    this.#miembros.set(this.#claveMiembro(fila.id, datos.ownerUserId), miembro);
    return fila;
  }

  async buscarPorId(id: string): Promise<FilaWorkspace | null> {
    const fila = this.#workspaces.get(id);
    return fila !== undefined && fila.deletedAt === null ? fila : null;
  }

  async buscarPorSlug(slug: string): Promise<FilaWorkspace | null> {
    for (const fila of this.#workspaces.values()) {
      if (fila.deletedAt === null && fila.slug === slug) return fila;
    }
    return null;
  }

  async listarDeUsuario(usuarioId: string): Promise<readonly FilaWorkspace[]> {
    const salida: FilaWorkspace[] = [];
    for (const miembro of this.#miembros.values()) {
      if (miembro.userId !== usuarioId || miembro.status !== 'active') continue;
      const ws = this.#workspaces.get(miembro.workspaceId);
      if (ws !== undefined && ws.deletedAt === null) salida.push(ws);
    }
    return salida.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async actualizar(
    id: string,
    cambios: { readonly name?: string; readonly description?: string | null },
    ahora: Date,
  ): Promise<FilaWorkspace | null> {
    const fila = this.#workspaces.get(id);
    if (fila === undefined || fila.deletedAt !== null) return null;
    const actualizada: FilaWorkspace = {
      ...fila,
      name: cambios.name ?? fila.name,
      description: cambios.description === undefined ? fila.description : cambios.description,
      updatedAt: ahora,
    };
    this.#workspaces.set(id, actualizada);
    return actualizada;
  }

  async borrarLogicamente(id: string, _porUsuarioId: string, ahora: Date): Promise<boolean> {
    const fila = this.#workspaces.get(id);
    if (fila === undefined || fila.deletedAt !== null) return false;
    this.#workspaces.set(id, { ...fila, deletedAt: ahora, updatedAt: ahora });
    return true;
  }

  async buscarMembresia(
    workspaceId: string,
    usuarioId: string,
  ): Promise<FilaMiembroDeWorkspace | null> {
    return this.#miembros.get(this.#claveMiembro(workspaceId, usuarioId)) ?? null;
  }

  async listarMiembros(workspaceId: string): Promise<readonly FilaMiembroDeWorkspace[]> {
    return [...this.#miembros.values()].filter(
      (m) => m.workspaceId === workspaceId && m.status !== 'removed',
    );
  }

  async altaDeMiembro(
    workspaceId: string,
    usuarioId: string,
    rol: RolDeWorkspace,
    invitadoPorUsuarioId: string,
    ahora: Date,
  ): Promise<FilaMiembroDeWorkspace> {
    const miembro: FilaMiembroDeWorkspace = {
      id: randomUUID(),
      workspaceId,
      userId: usuarioId,
      role: rol,
      status: 'active',
      invitedByUserId: invitadoPorUsuarioId,
      joinedAt: ahora,
      updatedAt: ahora,
      removedAt: null,
    };
    this.#miembros.set(this.#claveMiembro(workspaceId, usuarioId), miembro);
    return miembro;
  }

  async cambiarRol(
    workspaceId: string,
    usuarioId: string,
    rol: RolDeWorkspace,
    ahora: Date,
  ): Promise<FilaMiembroDeWorkspace | null> {
    const clave = this.#claveMiembro(workspaceId, usuarioId);
    const actual = this.#miembros.get(clave);
    if (actual === undefined || actual.status === 'removed') return null;
    const actualizado: FilaMiembroDeWorkspace = { ...actual, role: rol, updatedAt: ahora };
    this.#miembros.set(clave, actualizado);
    return actualizado;
  }

  async expulsarMiembro(workspaceId: string, usuarioId: string, ahora: Date): Promise<boolean> {
    const clave = this.#claveMiembro(workspaceId, usuarioId);
    const actual = this.#miembros.get(clave);
    if (actual === undefined || actual.status === 'removed') return false;
    this.#miembros.set(clave, {
      ...actual,
      status: 'removed',
      removedAt: ahora,
      updatedAt: ahora,
    });
    return true;
  }
}

// ---------------------------------------------------------------------------

export class RepositorioDeColeccionesEnMemoria implements RepositorioDeColecciones {
  readonly #porId = new Map<string, FilaColeccion>();

  async crear(datos: DatosNuevaColeccion, ahora: Date): Promise<FilaColeccion> {
    const fila: FilaColeccion = {
      id: randomUUID(),
      workspaceId: datos.workspaceId,
      projectId: null,
      slug: datos.slug,
      name: datos.name,
      description: datos.description,
      visibility: 'private',
      sortKey: ahora.getTime().toString(36),
      status: 'active',
      lockVersion: 0,
      createdByUserId: datos.createdByUserId,
      createdAt: ahora,
      updatedAt: ahora,
      deletedAt: null,
      deletedByUserId: null,
    };
    this.#porId.set(fila.id, fila);
    return fila;
  }

  async buscarPorId(id: string): Promise<FilaColeccion | null> {
    const fila = this.#porId.get(id);
    return fila !== undefined && fila.deletedAt === null ? fila : null;
  }

  async buscarPorSlug(workspaceId: string, slug: string): Promise<FilaColeccion | null> {
    for (const fila of this.#porId.values()) {
      if (fila.deletedAt === null && fila.workspaceId === workspaceId && fila.slug === slug) {
        return fila;
      }
    }
    return null;
  }

  async listarPorWorkspace(workspaceId: string): Promise<readonly FilaColeccion[]> {
    return [...this.#porId.values()]
      .filter((f) => f.workspaceId === workspaceId && f.deletedAt === null)
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }

  async actualizar(
    id: string,
    cambios: { readonly name?: string; readonly description?: string | null },
    ahora: Date,
  ): Promise<FilaColeccion | null> {
    const fila = this.#porId.get(id);
    if (fila === undefined || fila.deletedAt !== null) return null;
    const actualizada: FilaColeccion = {
      ...fila,
      name: cambios.name ?? fila.name,
      description: cambios.description === undefined ? fila.description : cambios.description,
      lockVersion: fila.lockVersion + 1,
      updatedAt: ahora,
    };
    this.#porId.set(id, actualizada);
    return actualizada;
  }

  async borrarLogicamente(id: string, porUsuarioId: string, ahora: Date): Promise<boolean> {
    const fila = this.#porId.get(id);
    if (fila === undefined || fila.deletedAt !== null) return false;
    this.#porId.set(id, {
      ...fila,
      deletedAt: ahora,
      deletedByUserId: porUsuarioId,
      updatedAt: ahora,
    });
    return true;
  }

  async workspaceIdDe(coleccionId: string): Promise<string | null> {
    const fila = this.#porId.get(coleccionId);
    if (fila === undefined || fila.deletedAt !== null) return null;
    return fila.workspaceId;
  }
}
