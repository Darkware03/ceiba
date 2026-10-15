import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { configurarAplicacion } from '../../src/bootstrap.ts';
import { ModuloDePlataforma } from '../../src/platform/platform.module.ts';
import { ModuloDeColecciones } from '../../src/modules/collection/collection.public.ts';
import { ModuloDeIdentidad } from '../../src/modules/identity/identity.public.ts';
import { ModuloDeWorkspaces } from '../../src/modules/workspace/workspace.public.ts';
import { GUARDS_GLOBALES_DE_LA_RAIZ } from '../../src/root-guards.ts';
import {
  CONFIGURACION_APP,
  cargarConfiguracion,
  type ConfiguracionApp,
} from '../../src/platform/config/app-config.ts';
import { RELOJ, RelojFalso } from '../../src/platform/time/clock.ts';
import { TESTIGO_CSRF, TestigoCsrf } from '../../src/platform/csrf/csrf-token.ts';
import {
  HASHER_DE_CONTRASENA,
  type HasherDeContrasena,
} from '../../src/platform/crypto/password-hasher.ts';
import { REPOSITORIO_DE_SESIONES } from '../../src/platform/persistence/repositories.ts';
import type { RepositorioDeSesionesEnMemoria } from '../../src/platform/persistence/in-memory/in-memory.repositories.ts';
import { ServicioDeSesiones } from '../../src/modules/identity/session.service.ts';

/**
 * Construye **la aplicación real** —los mismos módulos, los mismos guards
 * globales, el mismo filtro de errores y el mismo `bootstrap`— con los
 * repositorios en memoria y un reloj falso.
 *
 * Es deliberado que no sea una maqueta: si las pruebas montaran un Nest
 * distinto del que arranca `main.ts`, demostrarían el comportamiento de otra
 * aplicación. Lo único que cambia es la persistencia y el reloj, que es
 * exactamente lo que el BRIEF-FASE1 §2 manda sustituir por dobles.
 *
 * Las peticiones van por `inject()` de Fastify (light-my-request): no se abre
 * ningún puerto ni se usa red real.
 */

export const SECRETO_CSRF_DE_PRUEBA = 'secreto-csrf-de-prueba-con-mas-de-32-caracteres';
export const ORIGEN_DE_PRUEBA = 'http://localhost:8080';

export function entornoDePrueba(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    CEIBA_PUBLIC_URL: ORIGEN_DE_PRUEBA,
    CEIBA_CSRF_SECRET: SECRETO_CSRF_DE_PRUEBA,
    CEIBA_COOKIE_SECURE: 'false',
    CEIBA_TRUSTED_PROXIES: '127.0.0.1/32',
    CEIBA_PERSISTENCE_DRIVER: 'memory',
    ...extra,
  };
}

export interface AppDePrueba {
  readonly app: NestFastifyApplication;
  readonly config: ConfiguracionApp;
  readonly reloj: RelojFalso;
  readonly sesionesRepo: RepositorioDeSesionesEnMemoria;
  readonly servicioDeSesiones: ServicioDeSesiones;
  readonly hasher: HasherDeContrasena;
  readonly testigos: TestigoCsrf;
  cerrar(): Promise<void>;
}

export async function crearAppDePrueba(
  extraEnv: NodeJS.ProcessEnv = {},
  inicioDelReloj = new Date('2026-10-14T12:00:00.000Z'),
): Promise<AppDePrueba> {
  const entorno = entornoDePrueba(extraEnv);
  const config = cargarConfiguracion(entorno);
  const reloj = new RelojFalso(inicioDelReloj);

  const moduleRef = await Test.createTestingModule({
    imports: [
      ModuloDePlataforma.forRoot(entorno),
      ModuloDeColecciones,
      ModuloDeIdentidad,
      ModuloDeWorkspaces,
    ],
    // Los mismos guards que registra `AppModule`, importados de alli y no
    // reescritos: si se anade uno en la raiz, estas pruebas lo ejercen solo.
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

  return {
    app,
    config: app.get<ConfiguracionApp>(CONFIGURACION_APP),
    reloj,
    sesionesRepo: app.get(REPOSITORIO_DE_SESIONES),
    servicioDeSesiones: app.get(ServicioDeSesiones),
    hasher: app.get<HasherDeContrasena>(HASHER_DE_CONTRASENA),
    testigos: app.get<TestigoCsrf>(TESTIGO_CSRF),
    cerrar: async () => {
      await app.close();
    },
  };
}

// ---------------------------------------------------------------------------
// Utilidades HTTP
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
  entorno: AppDePrueba,
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

/** Devuelve el valor de una cookie emitida en la respuesta, si la hay. */
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

/** Pide un testigo CSRF válido sin sesión, como haría la SPA al arrancar. */
export async function obtenerCsrf(entorno: AppDePrueba): Promise<string> {
  const respuesta = await pedir(entorno, { method: 'GET', url: '/api/v1/auth/csrf' });
  const valor = cookieDe(respuesta, entorno.config.cookies.nombreCsrf);
  if (valor === undefined) throw new Error('la respuesta no trajo cookie CSRF');
  return valor;
}

/** Registra un usuario y abre sesión. Devuelve cookies y testigo CSRF vigentes. */
export async function registrarYEntrar(
  entorno: AppDePrueba,
  correo: string,
  contrasena = 'contrasena-de-prueba-larga',
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
