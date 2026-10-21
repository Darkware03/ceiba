import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { configurarAplicacion } from '../src/bootstrap.ts';
import { ModuloDePlataforma } from '../src/platform/platform.module.ts';
import { ModuloDeColecciones } from '../src/modules/collection/collection.public.ts';
import { ModuloDeIdentidad } from '../src/modules/identity/identity.public.ts';
import { ModuloDeWorkspaces } from '../src/modules/workspace/workspace.public.ts';
import { ModuloDePeticiones } from '../src/modules/request/request.public.ts';
import { ModuloDeFicheros } from '../src/modules/file/file.public.ts';
import { GUARDS_GLOBALES_DE_LA_RAIZ } from '../src/root-guards.ts';
import {
  CONFIGURACION_APP,
  cargarConfiguracion,
  type ConfiguracionApp,
} from '../src/platform/config/app-config.ts';
import { RELOJ, RelojFalso } from '../src/platform/time/clock.ts';
import {
  CLIENTE_PRISMA,
  type ClientePrismaCeiba,
} from '../src/platform/persistence/prisma/prisma-client.ts';
import {
  entornoDePruebaPostgres,
  type AppDePruebaPg,
} from './helpers/app-de-prueba-postgres.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ARNÉS DE LA FASE 7 — el de `helpers/app-de-prueba-postgres.ts` **más**
 * `ModuloDeFicheros`.
 *
 * POR QUÉ HAY UN ARNÉS NUEVO EN VEZ DE AMPLIAR EL QUE YA EXISTE
 * -------------------------------------------------------------
 * `crearAppDePruebaPostgres` fija la lista de módulos en su propio cuerpo, y
 * `test/helpers/` **no está en mi ámbito de escritura** en la fase 7 (sólo
 * puedo crear ficheros de `test/` cuyo nombre empiece por `peticiones`,
 * `cuerpo`, `curl` o `ficheros`). Así que se **importa** todo lo reutilizable
 * —el entorno, `pedir`, `registrarYEntrar`, los tipos— y sólo se rehace la
 * composición del módulo. Cero duplicación de semántica: lo único que cambia
 * es un elemento en la lista de `imports`.
 *
 * Cada suite usa su **propio directorio de almacén**, bajo `os.tmpdir()`, para
 * que dos pruebas en paralelo no se pisen los ficheros.
 * ════════════════════════════════════════════════════════════════════════════
 */

export async function crearAppDeFicheros(
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<AppDePruebaPg> {
  const entorno = entornoDePruebaPostgres(extraEnv);
  const config = cargarConfiguracion(entorno);
  const reloj = new RelojFalso(new Date());

  // `cargarConfiguracionDeFicheros()` lee de `process.env` (ver el comentario
  // de `file.config.ts`), así que el arnés fija ahí las variables antes de
  // construir el módulo y las deja puestas mientras la app vive.
  for (const [clave, valor] of Object.entries(extraEnv)) {
    if (clave.startsWith('CEIBA_FILE_') && valor !== undefined) {
      process.env[clave] = valor;
    }
  }

  const moduleRef = await Test.createTestingModule({
    imports: [
      ModuloDePlataforma.forRoot(entorno),
      ModuloDeColecciones,
      ModuloDePeticiones,
      ModuloDeFicheros,
      ModuloDeIdentidad,
      ModuloDeWorkspaces,
    ],
    providers: [...GUARDS_GLOBALES_DE_LA_RAIZ],
  })
    .overrideProvider(RELOJ)
    .useValue(reloj)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ trustProxy: config.proxiesDeConfianza }),
    { logger: false },
  );
  await configurarAplicacion(app, app.get<ConfiguracionApp>(CONFIGURACION_APP));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const prisma = app.get<ClientePrismaCeiba>(CLIENTE_PRISMA);

  return {
    app,
    config: app.get<ConfiguracionApp>(CONFIGURACION_APP),
    reloj,
    prisma,
    cerrar: async () => {
      await app.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Construcción de cuerpos multipart para `fastify.inject`
// ---------------------------------------------------------------------------

export interface ParteDeFormulario {
  readonly nombre: string;
  readonly contenido: Buffer | string;
  readonly nombreDeFichero?: string;
  readonly contentType?: string;
}

export interface CuerpoMultipart {
  readonly payload: Buffer;
  readonly contentType: string;
}

/**
 * Serializa un `multipart/form-data` a mano. Se hace aquí, en la prueba, en
 * vez de usar una biblioteca, por el mismo motivo por el que el analizador del
 * servidor está escrito a mano: no hay dependencia que añadir y así la prueba
 * ejercita el formato **real** del cable, byte a byte, incluidos los casos
 * hostiles (comillas en el nombre, nombre con ruta, etc.).
 */
export function construirMultipart(
  partes: readonly ParteDeFormulario[],
  boundary = `----ceibaprueba${Math.random().toString(36).slice(2)}`,
): CuerpoMultipart {
  const trozos: Buffer[] = [];
  for (const parte of partes) {
    let disposicion = `form-data; name="${parte.nombre}"`;
    if (parte.nombreDeFichero !== undefined) {
      disposicion += `; filename="${parte.nombreDeFichero}"`;
    }
    let cabeceras = `--${boundary}\r\nContent-Disposition: ${disposicion}\r\n`;
    if (parte.contentType !== undefined) {
      cabeceras += `Content-Type: ${parte.contentType}\r\n`;
    }
    cabeceras += '\r\n';
    trozos.push(Buffer.from(cabeceras, 'utf8'));
    trozos.push(
      Buffer.isBuffer(parte.contenido) ? parte.contenido : Buffer.from(parte.contenido, 'utf8'),
    );
    trozos.push(Buffer.from('\r\n', 'utf8'));
  }
  trozos.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return {
    payload: Buffer.concat(trozos),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
