import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Logger } from '@nestjs/common';

/**
 * Acceso al cliente Prisma generado desde `prisma/schema/*.prisma`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ESTADO REAL, SIN ADORNOS — **[NO VERIFICADO]**
 *
 * El cliente **no está generado** en este árbol. El generador de
 * `prisma/schema/schema.prisma` emite a `../generated/client`, es decir
 * `prisma/generated/client`, y **`prisma/` no es mi ámbito de escritura**: el
 * `database-engineer` está trabajando ahí ahora mismo. Tampoco hay PostgreSQL
 * en este contenedor y las migraciones están prohibidas.
 *
 * Consecuencias que asumo y declaro:
 *   - El código de `prisma.repositories.ts` está **escrito, no ejecutado**.
 *     Ninguna prueba de este entregable lo toca.
 *   - Los tipos se declaran aquí **a mano** y son estructurales, no los
 *     generados: hasta que exista el cliente, `tsc` no puede comprobar que los
 *     `where`/`data` encajan con el esquema.
 *   - La carga es **dinámica** y **falla cerrado**: si el cliente no existe, el
 *     arranque con `CEIBA_PERSISTENCE_DRIVER=prisma` aborta con un mensaje que
 *     dice exactamente qué falta y quién debe generarlo.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * Dónde se busca el cliente generado, en orden.
 *
 * El generador emite a `prisma/generated/client` (`output = "../generated/client"`
 * en `prisma/schema/schema.prisma`), que está **fuera** de `apps/api`. Hay dos
 * disposiciones reales y ambas tienen que funcionar:
 *
 *  - **Imagen de producción**: `infra/docker/api.Dockerfile` copia el árbol de
 *    `pnpm deploy` a `/app` y, en una capa aparte, `/app/prisma/generated`.
 *    Con `WORKDIR /app`, el cliente queda en `<cwd>/prisma/generated/client`.
 *  - **Árbol de desarrollo**: ejecutando desde `apps/api`, queda en
 *    `<cwd>/../../prisma/generated/client`.
 *
 * `CEIBA_PRISMA_CLIENT_PATH` permite fijarlo a mano si alguna vez difiere.
 */
export function rutasCandidatasDelCliente(
  cwd: string = process.cwd(),
  override: string | undefined = process.env['CEIBA_PRISMA_CLIENT_PATH'],
): readonly string[] {
  const candidatas: string[] = [];
  if (override !== undefined && override.trim() !== '') {
    candidatas.push(isAbsolute(override) ? override : resolve(cwd, override));
  }
  candidatas.push(resolve(cwd, 'prisma/generated/client/index.js'));
  candidatas.push(resolve(cwd, '../../prisma/generated/client/index.js'));
  return candidatas;
}

export interface DelegadoPrisma<TFila> {
  findFirst(args: unknown): Promise<TFila | null>;
  findUnique(args: unknown): Promise<TFila | null>;
  findMany(args: unknown): Promise<TFila[]>;
  create(args: unknown): Promise<TFila>;
  update(args: unknown): Promise<TFila>;
  updateMany(args: unknown): Promise<{ count: number }>;
}

export interface FilaUsuarioPrisma {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  passwordHash: string | null;
  passwordUpdatedAt: Date | null;
  displayName: string;
  locale: string;
  timezone: string;
  status: string;
  mfaEnabled: boolean;
  mfaSecretId: string | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface FilaSesionPrisma {
  id: string;
  userId: string;
  tokenSelector: string;
  tokenVerifierHash: Uint8Array;
  parentSessionId: string | null;
  userAgent: string | null;
  clientIp: string | null;
  deviceLabel: string | null;
  issuedAt: Date;
  lastSeenAt: Date;
  absoluteExpiresAt: Date;
  idleExpiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
}

export interface FilaWorkspacePrisma {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  ownerUserId: string;
  allowPublicSharing: boolean;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface FilaMiembroPrisma {
  id: string;
  workspaceId: string;
  userId: string;
  role: string;
  status: string;
  invitedByUserId: string | null;
  joinedAt: Date;
  updatedAt: Date;
  removedAt: Date | null;
}

export interface FilaColeccionPrisma {
  id: string;
  workspaceId: string;
  projectId: string | null;
  slug: string;
  name: string;
  description: string | null;
  visibility: string;
  sortKey: string;
  status: string;
  lockVersion: number;
  createdByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedByUserId: string | null;
}

export interface ClientePrismaCeiba {
  user: DelegadoPrisma<FilaUsuarioPrisma>;
  session: DelegadoPrisma<FilaSesionPrisma>;
  workspace: DelegadoPrisma<FilaWorkspacePrisma>;
  workspaceMember: DelegadoPrisma<FilaMiembroPrisma>;
  collection: DelegadoPrisma<FilaColeccionPrisma>;
  $transaction<T>(fn: (tx: ClientePrismaCeiba) => Promise<T>): Promise<T>;
  $executeRawUnsafe(sql: string, ...parametros: unknown[]): Promise<number>;
  $disconnect(): Promise<void>;
}

export const CLIENTE_PRISMA = Symbol('CLIENTE_PRISMA');

export class ClientePrismaNoGenerado extends Error {
  override readonly name = 'ClientePrismaNoGenerado';
}

/**
 * Carga el cliente generado. **Falla cerrado**: si no existe, lanza con el
 * comando exacto que hay que ejecutar y quién es su dueño.
 */
export async function cargarClientePrisma(urlBaseDeDatos: string): Promise<ClientePrismaCeiba> {
  const log = new Logger('prisma');
  const candidatas = rutasCandidatasDelCliente();
  const fallos: string[] = [];
  let modulo: Record<string, unknown> | undefined;
  let rutaUsada = '';

  for (const ruta of candidatas) {
    try {
      modulo = (await import(pathToFileURL(ruta).href)) as Record<string, unknown>;
      rutaUsada = ruta;
      break;
    } catch (error) {
      fallos.push(`  - ${ruta}: ${(error as Error).message}`);
    }
  }

  if (modulo === undefined) {
    throw new ClientePrismaNoGenerado(
      'El cliente Prisma no está generado. Rutas probadas:\n' +
        `${fallos.join('\n')}\n` +
        'Para generarlo, desde la raíz del repositorio:\n' +
        '  pnpm exec prisma generate --config prisma/prisma.config.ts\n' +
        'OJO: eso ESCRIBE dentro de `prisma/`, que pertenece a `database-engineer`. ' +
        'Pídeselo o autorízalo explícitamente; no lo hago por mi cuenta.\n' +
        'Para desarrollo sin base de datos: CEIBA_PERSISTENCE_DRIVER=memory.',
    );
  }

  const Constructor = modulo['PrismaClient'] as
    | (new (opciones: unknown) => ClientePrismaCeiba)
    | undefined;
  if (Constructor === undefined) {
    throw new ClientePrismaNoGenerado(`El módulo ${rutaUsada} no exporta PrismaClient.`);
  }
  log.log(`cliente Prisma cargado desde ${rutaUsada}`);

  // PRISMA 7 YA NO ACEPTA UNA CADENA DE CONEXION EN EL CONSTRUCTOR.
  // Ni `datasources: { db: { url } }` (Prisma 5-6) ni `datasourceUrl`
  // (transitoria): las dos revientan con
  // `PrismaClientConstructorValidationError: Unknown property ...` y la API no
  // llega a arrancar. Comprobadas las dos contra el cliente generado antes de
  // escribir esto.
  //
  // La via valida es un ADAPTADOR DE DRIVER: Prisma deja de abrir la conexion y
  // la delega en un cliente de PostgreSQL que le pasamos ya construido. El
  // adaptador se importa de forma dinamica, igual que el propio cliente, para
  // que un despliegue con `CEIBA_PERSISTENCE_DRIVER=memory` no tenga que
  // llevarse `@prisma/adapter-pg` ni `pg` en la imagen.
  const { PrismaPg } = (await import('@prisma/adapter-pg')) as {
    PrismaPg: new (config: { connectionString: string }) => unknown;
  };
  const adaptador = new PrismaPg({ connectionString: urlBaseDeDatos });
  const instancia = new Constructor({ adapter: adaptador }) as ClientePrismaCeiba & {
    client?: ClientePrismaCeiba;
  };
  instancia.client = instancia;
  return instancia;
}

export type InstanciaClientePrisma = any;

export class PrismaClientService {
  readonly client!: InstanciaClientePrisma;
  constructor(client: InstanciaClientePrisma) {
    this.client = client;
  }
}


