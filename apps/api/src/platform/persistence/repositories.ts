import type { RolDeWorkspace } from '../guards/roles.ts';
import type {
  EstadoDeUsuario,
  FilaColeccion,
  FilaMiembroDeWorkspace,
  FilaSesion,
  FilaUsuario,
  FilaWorkspace,
  MotivoDeRevocacion,
} from './records.ts';

/**
 * Puertos de persistencia.
 *
 * El BRIEF-FASE1 §2 dice que aquí **no hay PostgreSQL** y que está prohibido
 * ejecutar migraciones. Por eso la persistencia está detrás de interfaces y
 * tiene **dos** implementaciones:
 *
 *   - `in-memory/`  — la que ejecutan las pruebas de verdad en este contenedor.
 *   - `prisma/`     — adaptadores escritos contra el cliente generado desde
 *                     `prisma/schema/*.prisma`. **[NO VERIFICADO]**: el cliente
 *                     no está generado (generarlo escribe en `prisma/`, que no
 *                     es mi ámbito) y no hay motor contra el que ejecutarlos.
 *
 * Ninguna prueba de este entregable afirma haber tocado una base de datos.
 */

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

export interface DatosNuevoUsuario {
  readonly email: string;
  readonly passwordHash: string;
  readonly displayName: string;
  readonly locale?: string;
  readonly timezone?: string;
  readonly status?: EstadoDeUsuario;
}

export interface RepositorioDeUsuarios {
  /** Búsqueda insensible a mayúsculas (la columna es `citext`) y sólo viva. */
  buscarPorCorreo(correo: string): Promise<FilaUsuario | null>;
  buscarPorId(id: string): Promise<FilaUsuario | null>;
  crear(datos: DatosNuevoUsuario, ahora: Date): Promise<FilaUsuario>;
  registrarFalloDeAcceso(
    id: string,
    fallosConsecutivos: number,
    bloqueadoHasta: Date | null,
    ahora: Date,
  ): Promise<void>;
  registrarAccesoCorrecto(id: string, ahora: Date): Promise<void>;
  actualizarContrasena(id: string, hashPhc: string, ahora: Date): Promise<void>;
}

export const REPOSITORIO_DE_USUARIOS = Symbol('REPOSITORIO_DE_USUARIOS');

// ---------------------------------------------------------------------------
// Sesiones
// ---------------------------------------------------------------------------

export interface DatosNuevaSesion {
  readonly userId: string;
  readonly tokenSelector: string;
  readonly tokenVerifierHash: Uint8Array;
  readonly parentSessionId: string | null;
  readonly userAgent: string | null;
  readonly clientIp: string | null;
  readonly deviceLabel: string | null;
  readonly issuedAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly idleExpiresAt: Date;
}

export interface RepositorioDeSesiones {
  crear(datos: DatosNuevaSesion): Promise<FilaSesion>;
  buscarPorSelector(selector: string): Promise<FilaSesion | null>;
  buscarPorId(id: string): Promise<FilaSesion | null>;
  /** Hija viva de una sesión rotada (`parent_session_id = :id`, sin revocar). */
  buscarHijaViva(idPadre: string): Promise<FilaSesion | null>;
  listarVivasDeUsuario(usuarioId: string, ahora: Date): Promise<readonly FilaSesion[]>;
  tocarUltimaActividad(id: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<void>;
  revocar(id: string, ahora: Date, motivo: MotivoDeRevocacion): Promise<void>;
  /**
   * Revocación de la **familia** completa del ADR-0009 §4: se sube hasta la raíz
   * (`parent_session_id IS NULL`, nunca «el id más bajo») y se baja por toda su
   * descendencia, deduplicando para cortar ciclos. Si la familia saliera vacía,
   * **se revoca todo lo vivo del usuario**: fallo CERRADO, nunca 0 filas ante
   * una reutilización. Devuelve el número de filas revocadas.
   */
  revocarFamilia(
    sesionId: string,
    usuarioId: string,
    ahora: Date,
    motivo: MotivoDeRevocacion,
  ): Promise<number>;
  /** Cierre en todos los dispositivos. `exceptoId` permite conservar la actual. */
  revocarTodasDeUsuario(
    usuarioId: string,
    ahora: Date,
    motivo: MotivoDeRevocacion,
    exceptoId?: string,
  ): Promise<number>;
}

export const REPOSITORIO_DE_SESIONES = Symbol('REPOSITORIO_DE_SESIONES');

// ---------------------------------------------------------------------------
// Workspaces y membresías
// ---------------------------------------------------------------------------

export interface DatosNuevoWorkspace {
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly ownerUserId: string;
}

export interface RepositorioDeWorkspaces {
  /**
   * Crea el workspace **y** la fila `workspace_members` con `role='owner'` en la
   * misma operación. El esquema declara la invariante «cada workspace no borrado
   * tiene al menos un miembro activo con role='owner'»; crear sólo el workspace
   * la rompería desde el primer instante.
   */
  crearConPropietario(datos: DatosNuevoWorkspace, ahora: Date): Promise<FilaWorkspace>;
  buscarPorId(id: string): Promise<FilaWorkspace | null>;
  buscarPorSlug(slug: string): Promise<FilaWorkspace | null>;
  listarDeUsuario(usuarioId: string): Promise<readonly FilaWorkspace[]>;
  actualizar(
    id: string,
    cambios: { readonly name?: string; readonly description?: string | null },
    ahora: Date,
  ): Promise<FilaWorkspace | null>;
  borrarLogicamente(id: string, porUsuarioId: string, ahora: Date): Promise<boolean>;

  buscarMembresia(workspaceId: string, usuarioId: string): Promise<FilaMiembroDeWorkspace | null>;
  listarMiembros(workspaceId: string): Promise<readonly FilaMiembroDeWorkspace[]>;
  altaDeMiembro(
    workspaceId: string,
    usuarioId: string,
    rol: RolDeWorkspace,
    invitadoPorUsuarioId: string,
    ahora: Date,
  ): Promise<FilaMiembroDeWorkspace>;
  cambiarRol(
    workspaceId: string,
    usuarioId: string,
    rol: RolDeWorkspace,
    ahora: Date,
  ): Promise<FilaMiembroDeWorkspace | null>;
  expulsarMiembro(workspaceId: string, usuarioId: string, ahora: Date): Promise<boolean>;
}

export const REPOSITORIO_DE_WORKSPACES = Symbol('REPOSITORIO_DE_WORKSPACES');

// ---------------------------------------------------------------------------
// Colecciones
// ---------------------------------------------------------------------------

export interface DatosNuevaColeccion {
  readonly workspaceId: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdByUserId: string;
}

export interface RepositorioDeColecciones {
  crear(datos: DatosNuevaColeccion, ahora: Date): Promise<FilaColeccion>;
  buscarPorId(id: string): Promise<FilaColeccion | null>;
  buscarPorSlug(workspaceId: string, slug: string): Promise<FilaColeccion | null>;
  listarPorWorkspace(workspaceId: string): Promise<readonly FilaColeccion[]>;
  actualizar(
    id: string,
    cambios: { readonly name?: string; readonly description?: string | null },
    ahora: Date,
  ): Promise<FilaColeccion | null>;
  borrarLogicamente(id: string, porUsuarioId: string, ahora: Date): Promise<boolean>;
  /** Resolución recurso -> workspace para el guard (ADR-0009 §7.4). */
  workspaceIdDe(coleccionId: string): Promise<string | null>;
}

export const REPOSITORIO_DE_COLECCIONES = Symbol('REPOSITORIO_DE_COLECCIONES');
