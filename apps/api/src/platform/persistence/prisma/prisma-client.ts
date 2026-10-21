import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Logger } from '@nestjs/common';

import type {
  Collection as FilaColeccionGenerada,
  PrismaClient as ClientePrismaGenerado,
  Session as FilaSesionGenerada,
  User as FilaUsuarioGenerada,
  Workspace as FilaWorkspaceGenerada,
  WorkspaceMember as FilaMiembroGenerada,
} from '../../../../../../prisma/generated/client/index.js';

/**
 * Acceso al cliente Prisma generado desde `prisma/schema/*.prisma`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * FASE 4 — DE DÓNDE SALEN AHORA LOS TIPOS, Y POR QUÉ SE CAMBIÓ
 *
 * Hasta la fase 3 este fichero declaraba **a mano** la forma del cliente: una
 * interfaz `ClientePrismaCeiba` con 5 modelos y un `DelegadoPrisma<TFila>` con
 * 6 operaciones y `args: unknown`. Esa fachada era falsa en tres sentidos a la
 * vez, y los tres costaron caro:
 *
 *   1. **Faltaban 11 de los 15 modelos** que usa `modules/studio`. Lo no
 *      declarado caía a `any`, y de ahí los 23 `TS7006` que impedían compilar
 *      las pruebas (`pretest`) y el `typecheck`.
 *   2. **Faltaban 3 operaciones**: `upsert`, `delete` y `deleteMany`.
 *   3. Y lo peor: con `args: unknown` **ningún `where`/`data`/`select` estaba
 *      comprobado**. Un `prisma.folder` (el modelo se llama `CollectionFolder`)
 *      o un `where: { ownerId }` (el campo se llama `ownerUserId`) compilaban
 *      sin una queja y reventaban en tiempo de ejecución.
 *
 * Se eligió la **opción (b) del BRIEF-FASE4 §3.A.1**: tipar desde el cliente
 * generado, que es la fuente real y no se puede desincronizar del esquema. La
 * alternativa —completar la fachada a mano con los 15 modelos y los tipos de
 * fila escritos a dedo— habría silenciado los `TS7006` sin recuperar la
 * comprobación del punto 3, que es justo donde vivían los defectos reales.
 *
 * **PRECIO QUE SE PAGA, DECLARADO:** `prisma/generated/` está en `.gitignore`,
 * así que **compilar `apps/api` exige haber generado el cliente antes**:
 *
 *     pnpm exec prisma generate --config prisma/prisma.config.ts
 *
 * El `prebuild` y el `pretest` de `apps/api` ejecutan
 * `scripts/comprobar-cliente-prisma.mjs`, que **falla cerrado** con ese comando
 * exacto si el cliente no está. No se genera automáticamente: `prisma/` es
 * ámbito del `database-engineer` y generar es escribir allí.
 *
 * La **carga sigue siendo dinámica** (`import()` con ruta calculada) para que
 * un despliegue con `CEIBA_PERSISTENCE_DRIVER=memory` no necesite el cliente en
 * la imagen. El `import type` de arriba desaparece en el emitido: no crea
 * dependencia en tiempo de ejecución, sólo en tiempo de compilación.
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

/**
 * El cliente, con **los 41 modelos y las 9 operaciones reales** del esquema.
 *
 * No es un alias cosmético: es el punto exacto donde `tsc` empieza a comprobar
 * los nombres de modelo, de campo, de relación y los valores de enum de cada
 * consulta del árbol. Ensanchar esto a `any` vuelve a abrir el agujero entero.
 */
export type ClientePrismaCeiba = ClientePrismaGenerado;

/**
 * Cliente **dentro de una transacción interactiva**. Prisma le retira ahí
 * `$transaction`, `$connect` y compañía, así que NO es el mismo tipo que el
 * cliente de fuera; derivarlo del propio `$transaction` evita escribir esa
 * lista a mano y que se quede obsoleta en la siguiente versión de Prisma.
 */
export type TransaccionPrismaCeiba = Parameters<
  Parameters<ClientePrismaCeiba['$transaction']>[0]
>[0];

/**
 * Tipos de fila. Son los generados; se reexportan con el nombre que ya usaba
 * `prisma.repositories.ts` para no tocar sus importaciones, y porque el nombre
 * en castellano en la frontera deja claro que es la fila CRUDA del motor y no
 * la proyección de la aplicación (`FilaUsuario`, `FilaWorkspace`, … de
 * `persistence/records.ts`).
 */
export type FilaUsuarioPrisma = FilaUsuarioGenerada;
export type FilaSesionPrisma = FilaSesionGenerada;
export type FilaWorkspacePrisma = FilaWorkspaceGenerada;
export type FilaMiembroPrisma = FilaMiembroGenerada;
export type FilaColeccionPrisma = FilaColeccionGenerada;

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

  // El especificador del `import()` se calcula en tiempo de ejecución, así que
  // TypeScript no puede tiparlo: la aserción es inherente a la carga dinámica,
  // no un atajo para callar un error. Lo que se afirma aquí queda comprobado en
  // `test/prisma-fachada.test.ts`, que carga el cliente real y verifica que los
  // 15 modelos y las 9 operaciones existen de verdad en él.
  const Constructor = modulo['PrismaClient'] as
    | (new (opciones: { adapter: unknown }) => ClientePrismaCeiba)
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

/**
 * ERA `any`. Ese `any` era el verdadero conducto del problema: `StudioService`
 * y `StudioCollaborationService` acceden por `this.prisma.client.<modelo>`, de
 * modo que con `client: any` TODA consulta del módulo studio quedaba sin
 * comprobar aunque la fachada estuviese bien. Ahora es el cliente real.
 */
export type InstanciaClientePrisma = ClientePrismaCeiba;

export class PrismaClientService {
  readonly client!: InstanciaClientePrisma;
  constructor(client: InstanciaClientePrisma) {
    this.client = client;
  }
}


