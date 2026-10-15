/**
 * Modelo de roles del ADR-0009 §7.5. **Es normativo**: la tabla del ADR se
 * traduce aquí sin interpretar nada, y la prueba parametrizada
 * `test/roles-matrix.test.ts` recorre las 5 filas × todas las operaciones.
 *
 * Los nombres de rol son los del enum `workspace_role` del esquema
 * (`prisma/schema/01-enums.prisma`), no los de ningún documento: manda el
 * esquema, por la cláusula de deferencia del ADR-0004.
 */

export const ROLES_DE_WORKSPACE = ['owner', 'admin', 'editor', 'executor', 'viewer'] as const;
export type RolDeWorkspace = (typeof ROLES_DE_WORKSPACE)[number];

/** Jerarquía: `owner > admin > editor > executor > viewer`. Mayor = más poder. */
const RANGO: Readonly<Record<RolDeWorkspace, number>> = Object.freeze({
  owner: 5,
  admin: 4,
  editor: 3,
  executor: 2,
  viewer: 1,
});

export function rangoDe(rol: RolDeWorkspace): number {
  return RANGO[rol];
}

/** `true` si `rol` alcanza o supera a `rolMinimo`. */
export function alcanza(rol: RolDeWorkspace, rolMinimo: RolDeWorkspace): boolean {
  return RANGO[rol] >= RANGO[rolMinimo];
}

/**
 * Operaciones de la matriz del §7.5. `null` significa **nadie**: ningún rol de
 * workspace la permite. No son erratas; el ADR lo dice expresamente.
 */
export const OPERACIONES = [
  'workspace.delete',
  'workspace.transfer_ownership',
  'workspace.settings.update',
  'member.manage',
  'audit.read',
  'share.manage',
  'collection.write',
  'environment.write',
  'secret.write',
  'request.execute',
  'secret.use_in_execution',
  'collection.read',
  'secret.reveal',
  'variable.global.write',
] as const;
export type Operacion = (typeof OPERACIONES)[number];

export const MATRIZ_PERMISOS: Readonly<Record<Operacion, RolDeWorkspace | null>> = Object.freeze({
  // Borrar el workspace · transferir propiedad
  'workspace.delete': 'owner',
  'workspace.transfer_ownership': 'owner',
  // Ajustes del workspace
  'workspace.settings.update': 'admin',
  // Invitar · cambiar rol · expulsar miembros
  'member.manage': 'admin',
  // Leer la auditoría del workspace
  'audit.read': 'admin',
  // Crear · revocar enlaces compartidos y códigos
  'share.manage': 'admin',
  // Crear/modificar/borrar colecciones, carpetas, solicitudes
  'collection.write': 'editor',
  // Crear/modificar entornos, variables y configuraciones de auth
  'environment.write': 'editor',
  // Crear/rotar secretos
  'secret.write': 'editor',
  // Ejecutar solicitudes, ejecuciones de colección y tests
  'request.execute': 'executor',
  // Usar un secreto dentro de una ejecución (sin verlo)
  'secret.use_in_execution': 'executor',
  // Leer colecciones, entornos (valores no secretos) e historial propio
  'collection.read': 'viewer',

  // --- Las dos filas que NINGÚN rol satisface -----------------------------
  // «Ningún rol de workspace revela un secreto en claro.»
  'secret.reveal': null,
  // `scoped_variables` con scope='global' es «Solo administradores de
  // plataforma», y ese rol NO EXISTE en el esquema. HUECO declarado por el
  // ADR-0009 y asignado a `database-engineer`. Hasta que exista, la escritura
  // global no es alcanzable desde la API: aquí se deniega, no se simula.
  'variable.global.write': null,
});

/** Rol mínimo exigido por una operación, o `null` si no la permite nadie. */
export function rolMinimoPara(operacion: Operacion): RolDeWorkspace | null {
  return MATRIZ_PERMISOS[operacion];
}

/**
 * Lista de permitidos: **lo que no está, se deniega**. Un rol desconocido o una
 * operación sin entrada devuelven `false` sin excepción: fallar abierto en una
 * comprobación de permisos es inaceptable.
 */
export function puedeOperar(rol: RolDeWorkspace | null | undefined, operacion: Operacion): boolean {
  if (rol === null || rol === undefined) return false;
  if (!Object.hasOwn(RANGO, rol)) return false;
  const minimo = MATRIZ_PERMISOS[operacion];
  if (minimo === null || minimo === undefined) return false;
  return alcanza(rol, minimo);
}

export function esRolDeWorkspace(valor: unknown): valor is RolDeWorkspace {
  return typeof valor === 'string' && (ROLES_DE_WORKSPACE as readonly string[]).includes(valor);
}
