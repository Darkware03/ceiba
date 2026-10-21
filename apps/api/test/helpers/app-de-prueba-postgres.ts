import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { configurarAplicacion } from '../../src/bootstrap.ts';
import { ModuloDePlataforma } from '../../src/platform/platform.module.ts';
import { ModuloDeColecciones } from '../../src/modules/collection/collection.public.ts';
import { ModuloDeIdentidad } from '../../src/modules/identity/identity.public.ts';
import { ModuloDeWorkspaces } from '../../src/modules/workspace/workspace.public.ts';
import { ModuloDeComparticion } from '../../src/modules/sharing/sharing.public.ts';
import { GUARDS_GLOBALES_DE_LA_RAIZ } from '../../src/root-guards.ts';
import {
  CONFIGURACION_APP,
  cargarConfiguracion,
  type ConfiguracionApp,
} from '../../src/platform/config/app-config.ts';
import { RELOJ, RelojFalso } from '../../src/platform/time/clock.ts';
import {
  CLIENTE_PRISMA,
  type ClientePrismaCeiba,
} from '../../src/platform/persistence/prisma/prisma-client.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ARNÉS CONTRA EL PostgreSQL **REAL**.
 *
 * El ayudante que ya existía (`app-de-prueba.ts`) monta la aplicación con
 * `CEIBA_PERSISTENCE_DRIVER=memory`, y para `sharing` eso no serviría de nada:
 * las cuatro tablas del bloque 5 **no tienen** implementación en memoria, el
 * módulo habla con Prisma directamente, y lo que hay que demostrar —que el
 * código en claro no cabe en ninguna columna, que la revocación tiene efecto
 * inmediato, que la cascada es transaccional— **sólo es demostrable con el
 * motor delante**.
 *
 * Por lo demás es la misma aplicación: mismos módulos, mismos guards globales,
 * mismo `bootstrap`. Sólo cambian la persistencia (PostgreSQL real) y el reloj
 * (inyectado, para poder saltar al futuro sin dormir).
 *
 * El reloj falso arranca en la hora REAL del sistema a propósito: las filas que
 * escriben otros módulos usan `CURRENT_TIMESTAMP` del servidor, y arrancar el
 * reloj en 1970 dejaría unas fechas en el pasado remoto y otras en el presente.
 * ════════════════════════════════════════════════════════════════════════════
 */

export const URL_BASE_DE_DATOS =
  process.env['CEIBA_TEST_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgresql://ceiba:ceiba@127.0.0.1:55432/ceiba';

export const SECRETO_CSRF_DE_PRUEBA = 'secreto-csrf-de-prueba-con-mas-de-32-caracteres';
export const ORIGEN_DE_PRUEBA = 'http://localhost:8080';

export function entornoDePruebaPostgres(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    CEIBA_PUBLIC_URL: ORIGEN_DE_PRUEBA,
    CEIBA_CSRF_SECRET: SECRETO_CSRF_DE_PRUEBA,
    CEIBA_COOKIE_SECURE: 'false',
    CEIBA_TRUSTED_PROXIES: '127.0.0.1/32',
    CEIBA_PERSISTENCE_DRIVER: 'prisma',
    DATABASE_URL: URL_BASE_DE_DATOS,
    ...extra,
  };
}

export interface AppDePruebaPg {
  readonly app: NestFastifyApplication;
  readonly config: ConfiguracionApp;
  readonly reloj: RelojFalso;
  readonly prisma: ClientePrismaCeiba;
  cerrar(): Promise<void>;
}

export async function crearAppDePruebaPostgres(
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<AppDePruebaPg> {
  const entorno = entornoDePruebaPostgres(extraEnv);
  const config = cargarConfiguracion(entorno);
  const reloj = new RelojFalso(new Date());

  const moduleRef = await Test.createTestingModule({
    imports: [
      ModuloDePlataforma.forRoot(entorno),
      ModuloDeColecciones,
      ModuloDeIdentidad,
      ModuloDeWorkspaces,
      ModuloDeComparticion,
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
// Utilidades HTTP (mismas que el ayudante en memoria, sin duplicar semántica)
// ---------------------------------------------------------------------------

export interface RespuestaInyectada {
  readonly statusCode: number;
  readonly body: string;
  readonly headers: Record<string, unknown>;
  readonly cookies: ReadonlyArray<Record<string, unknown>>;
  json<T = unknown>(): T;
}

export interface OpcionesPeticion {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  readonly url: string;
  readonly payload?: unknown;
  readonly cookies?: Record<string, string>;
  readonly headers?: Record<string, string>;
  readonly origen?: string | null;
  readonly csrf?: string | null;
  readonly remoteAddress?: string;
}

export async function pedir(
  entorno: AppDePruebaPg,
  opciones: OpcionesPeticion,
): Promise<RespuestaInyectada> {
  const cabeceras: Record<string, string> = { ...(opciones.headers ?? {}) };
  if (opciones.origen !== null) {
    cabeceras['origin'] = opciones.origen ?? ORIGEN_DE_PRUEBA;
  }
  if (typeof opciones.csrf === 'string') {
    cabeceras['x-ceiba-csrf'] = opciones.csrf;
  }
  const instancia = entorno.app.getHttpAdapter().getInstance() as {
    inject(opciones: unknown): Promise<RespuestaInyectada>;
  };
  return instancia.inject({
    method: opciones.method,
    url: opciones.url,
    payload: opciones.payload,
    cookies: opciones.cookies ?? {},
    headers: cabeceras,
    remoteAddress: opciones.remoteAddress ?? '127.0.0.1',
  });
}

export function cookieDe(respuesta: RespuestaInyectada, nombre: string): string | undefined {
  for (const cookie of respuesta.cookies) {
    if (cookie['name'] === nombre) return cookie['value'] as string;
  }
  return undefined;
}

export interface Credenciales {
  readonly cookies: Record<string, string>;
  readonly csrf: string;
  readonly usuarioId: string;
}

export async function obtenerCsrf(entorno: AppDePruebaPg): Promise<string> {
  const respuesta = await pedir(entorno, { method: 'GET', url: '/api/v1/auth/csrf' });
  const valor = cookieDe(respuesta, entorno.config.cookies.nombreCsrf);
  if (valor === undefined) throw new Error('la respuesta no trajo cookie CSRF');
  return valor;
}

/**
 * Registrarse **no** inicia sesión en este producto: hay que llamar a `login`
 * después. Está medido y documentado en el encargo de fase 5.
 */
export async function registrarYEntrar(
  entorno: AppDePruebaPg,
  correo: string,
  contrasena: string,
  nombre = 'Usuario de prueba',
): Promise<Credenciales> {
  const csrfInicial = await obtenerCsrf(entorno);

  const alta = await pedir(entorno, {
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email: correo, password: contrasena, displayName: nombre },
    cookies: { [entorno.config.cookies.nombreCsrf]: csrfInicial },
    csrf: csrfInicial,
  });
  if (alta.statusCode !== 201) {
    throw new Error(`registro falló: ${alta.statusCode} ${alta.body}`);
  }

  const entrada = await pedir(entorno, {
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email: correo, password: contrasena },
    cookies: { [entorno.config.cookies.nombreCsrf]: csrfInicial },
    csrf: csrfInicial,
  });
  if (entrada.statusCode !== 200) {
    throw new Error(`login falló: ${entrada.statusCode} ${entrada.body}`);
  }

  const cookieSesion = cookieDe(entrada, entorno.config.cookies.nombreSesion);
  const cookieCsrf = cookieDe(entrada, entorno.config.cookies.nombreCsrf);
  if (cookieSesion === undefined) throw new Error('el login no emitió cookie de sesión');
  if (cookieCsrf === undefined) throw new Error('el login no rotó la cookie CSRF');

  return {
    cookies: {
      [entorno.config.cookies.nombreSesion]: cookieSesion,
      [entorno.config.cookies.nombreCsrf]: cookieCsrf,
    },
    csrf: cookieCsrf,
    usuarioId: (alta.json() as { usuario: { id: string } }).usuario.id,
  };
}

/** Marca única por ejecución: permite repetir las pruebas sin limpiar la base. */
export function marcaDeEjecucion(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function contrasenaDePrueba(marca: string): string {
  return `Ceiba-F5#${marca}aZ9`;
}
