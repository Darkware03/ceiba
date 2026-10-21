import { z } from 'zod';
import { parseDuracionAMs } from './duration.ts';

/**
 * Configuración de `apps/api`, con **fallo cerrado**.
 *
 * Reglas que esta capa hace cumplir y que no son negociables (ADR-0009):
 *
 *  - §6.4  `CEIBA_COOKIE_SECURE=false` SÓLO fuera de producción. En producción
 *          el intento **aborta el arranque**, no degrada en silencio.
 *  - §11.5 `trustProxy: true` está PROHIBIDO. `CEIBA_TRUSTED_PROXIES` debe ser
 *          una lista de CIDR/IP; `true`, `*` y la cadena vacía se rechazan.
 *  - §5    `CEIBA_CSRF_SECRET` es obligatorio siempre, porque el CSRF va
 *          siempre activo. Sin clave no hay arranque, tampoco en desarrollo.
 *  - §6.3  `CEIBA_PUBLIC_URL` es el origen único contra el que se compara
 *          `Origin`/`Referer`. En producción debe ser `https:`.
 *
 * Todas las variables leídas existen YA en el `.env.example` commiteado salvo
 * las dos declaradas en PETICIONES (ver README de este directorio y el informe
 * API-BACKEND.md §«Variables de entorno que pido»).
 */

const NIVELES_LOG = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const booleanoEstricto = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => v === 'true' || v === 'false', {
    message: 'debe ser exactamente "true" o "false"',
  })
  .transform((v) => v === 'true');

const duracion = z.string().trim().transform((v, ctx) => {
  try {
    return parseDuracionAMs(v);
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: (error as Error).message });
    return z.NEVER;
  }
});

const secretoFuerte = (nombre: string) =>
  z
    .string()
    .min(32, `${nombre} debe tener al menos 32 caracteres`)
    .refine((v) => !v.includes('<generar>'), {
      message: `${nombre} sigue con el marcador <generar> del .env.example`,
    });

/** Lista de proxies de confianza. Rechaza explícitamente el comodín. */
const proxiesDeConfianza = z
  .string()
  .trim()
  .min(1, 'CEIBA_TRUSTED_PROXIES es obligatorio: sin él no se puede resolver la IP real')
  .refine((v) => {
    const normalizado = v.toLowerCase();
    return normalizado !== 'true' && normalizado !== '*' && normalizado !== 'all';
  }, {
    message:
      'CEIBA_TRUSTED_PROXIES no admite "true"/"*"/"all": ADR-0009 §11.5 prohíbe trustProxy abierto ' +
      '(permitiría falsificar X-Forwarded-For y evadir el límite por IP)',
  });

export const esquemaEntorno = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(NIVELES_LOG).default('info'),

  CEIBA_API_PORT: z.coerce.number().int().min(1).max(65_535).prefault('3000'),
  CEIBA_API_HOST: z.string().trim().min(1).default('0.0.0.0'),
  CEIBA_PUBLIC_URL: z.url({ message: 'CEIBA_PUBLIC_URL debe ser una URL absoluta' }),

  // `prefault` y no `default`: estos campos transforman (texto -> ms), y en Zod
  // 4 `default` toma el valor de SALIDA mientras que `prefault` toma el de
  // ENTRADA. Queremos que el valor por defecto se lea igual que en el
  // `.env.example` (`7d`, `12h`, `1h`) y pase por el mismo parser.
  CEIBA_SESSION_ABSOLUTE_TTL: duracion.prefault('7d'),
  CEIBA_SESSION_IDLE_TTL: duracion.prefault('12h'),
  CEIBA_SESSION_ROTATE_AFTER: duracion.prefault('1h'),

  CEIBA_CSRF_SECRET: secretoFuerte('CEIBA_CSRF_SECRET'),
  CEIBA_COOKIE_SECURE: booleanoEstricto.prefault('true'),
  CEIBA_TRUSTED_PROXIES: proxiesDeConfianza,

  CEIBA_PERSISTENCE_DRIVER: z.enum(['prisma', 'memory']).default('prisma'),
  DATABASE_URL: z.string().trim().optional(),
});

export type EntornoValidado = z.infer<typeof esquemaEntorno>;

export interface ConfiguracionCookies {
  readonly nombreSesion: string;
  readonly nombreCsrf: string;
  readonly secure: boolean;
  readonly sameSite: 'lax';
  readonly path: '/';
}

export interface ConfiguracionSesion {
  readonly ttlAbsolutoMs: number;
  readonly ttlInactividadMs: number;
  readonly rotarTrasMs: number;
  /** §3: `last_seen_at` se escribe como mucho una vez cada 60 s por sesión. */
  readonly intervaloMinimoLastSeenMs: number;
  /** §4: ventana de gracia para la carrera de red tras una rotación. */
  readonly ventanaGraciaRotacionMs: number;
}

export interface ConfiguracionApp {
  readonly entorno: EntornoValidado['NODE_ENV'];
  readonly esProduccion: boolean;
  readonly nivelLog: EntornoValidado['LOG_LEVEL'];
  readonly puerto: number;
  readonly host: string;
  readonly urlPublica: string;
  /** Origen normalizado (`https://host:puerto`) para comparar con `Origin`. */
  readonly origenPublico: string;
  readonly proxiesDeConfianza: string;
  readonly cookies: ConfiguracionCookies;
  readonly sesion: ConfiguracionSesion;
  readonly csrfSecret: string;
  readonly driverPersistencia: EntornoValidado['CEIBA_PERSISTENCE_DRIVER'];
  readonly databaseUrl: string | undefined;
  readonly engine?: {
    readonly url: string;
    readonly token: string;
    readonly timeoutMs: number;
  };
}

export const CONFIGURACION_APP = Symbol('CONFIGURACION_APP');

/** Nombres fijados por el ADR-0009 §2 y §5. El prefijo `__Host-` es normativo. */
export const NOMBRE_COOKIE_SESION = '__Host-ceiba_session';
export const NOMBRE_COOKIE_CSRF = '__Host-ceiba_csrf';
export const NOMBRE_CABECERA_CSRF = 'x-ceiba-csrf';

/* EL PREFIJO `__Host-` Y `Secure` SON INSEPARABLES, Y AQUI NO LO ERAN.
 *
 * `__Host-` lo impone el CLIENTE, no el servidor: un navegador —y tambien
 * `curl`— DESCARTA una cookie con ese prefijo si no viene con `Secure`. La
 * validacion de mas abajo solo exigia `Secure` en produccion, asi que en
 * desarrollo la API arrancaba sin quejarse, emitia la cookie y NINGUN cliente
 * la guardaba: el registro moria con `csrf_invalido: Falta el testigo CSRF` y
 * no habia manera de iniciar sesion.
 *
 * Medido: sobre HTTP el tarro de cookies quedaba vacio; el mismo recorrido
 * sobre HTTPS devolvia 201 en registro y 200 en login.
 *
 * Se arregla derivando el nombre de `secure` en vez de fijarlo a ciegas. Con
 * TLS —siempre en produccion— los nombres son los normativos del ADR-0009.
 * Sin TLS, que solo se admite fuera de produccion, se cae el prefijo para que
 * la cookie sea almacenable; `HttpOnly`, `SameSite=Lax` y `Path=/` no cambian.
 */
export function nombresDeCookie(secure: boolean): {
  nombreSesion: string;
  nombreCsrf: string;
} {
  return secure
    ? { nombreSesion: NOMBRE_COOKIE_SESION, nombreCsrf: NOMBRE_COOKIE_CSRF }
    : { nombreSesion: 'ceiba_session', nombreCsrf: 'ceiba_csrf' };
}

export class ErrorDeConfiguracion extends Error {
  override readonly name = 'ErrorDeConfiguracion';
}

/**
 * Valida el entorno y devuelve la configuración. Lanza `ErrorDeConfiguracion`
 * con TODOS los problemas a la vez: arreglar el arranque de uno en uno es la
 * forma más rápida de que alguien acabe desactivando una comprobación.
 */
export function cargarConfiguracion(entorno: NodeJS.ProcessEnv): ConfiguracionApp {
  const analizado = esquemaEntorno.safeParse(entorno);
  if (!analizado.success) {
    const detalle = analizado.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(raíz)'}: ${issue.message}`)
      .join('\n');
    throw new ErrorDeConfiguracion(
      `Configuración inválida; el arranque se aborta (fallo cerrado):\n${detalle}`,
    );
  }

  const env = analizado.data;
  const esProduccion = env.NODE_ENV === 'production';
  const problemas: string[] = [];

  if (esProduccion && !env.CEIBA_COOKIE_SECURE) {
    problemas.push(
      'CEIBA_COOKIE_SECURE=false es inadmisible con NODE_ENV=production (ADR-0009 §6.4). ' +
        'La cookie de sesión lleva prefijo __Host-, que el navegador sólo acepta con Secure.',
    );
  }

  let origenPublico: string;
  try {
    const url = new URL(env.CEIBA_PUBLIC_URL);
    if (esProduccion && url.protocol !== 'https:') {
      problemas.push(
        `CEIBA_PUBLIC_URL debe ser https en producción; recibido ${url.protocol}//… (ADR-0009 §6.2).`,
      );
    }
    origenPublico = url.origin;
  } catch {
    problemas.push('CEIBA_PUBLIC_URL no es una URL válida.');
    origenPublico = '';
  }

  if (env.CEIBA_PERSISTENCE_DRIVER === 'memory' && esProduccion) {
    problemas.push(
      'CEIBA_PERSISTENCE_DRIVER=memory está prohibido en producción: el repositorio en memoria ' +
        'pierde todas las sesiones al reiniciar y no es una base de datos.',
    );
  }

  if (env.CEIBA_PERSISTENCE_DRIVER === 'prisma' && (env.DATABASE_URL ?? '') === '') {
    problemas.push('CEIBA_PERSISTENCE_DRIVER=prisma exige DATABASE_URL.');
  }

  if (env.CEIBA_SESSION_ROTATE_AFTER >= env.CEIBA_SESSION_ABSOLUTE_TTL) {
    problemas.push(
      'CEIBA_SESSION_ROTATE_AFTER debe ser menor que CEIBA_SESSION_ABSOLUTE_TTL: si no, la sesión ' +
        'caduca antes de rotar nunca y la detección de reutilización (ADR-0009 §4) no llega a actuar.',
    );
  }

  if (problemas.length > 0) {
    throw new ErrorDeConfiguracion(
      `Configuración inválida; el arranque se aborta (fallo cerrado):\n${problemas
        .map((p) => `  - ${p}`)
        .join('\n')}`,
    );
  }

  return Object.freeze({
    entorno: env.NODE_ENV,
    esProduccion,
    nivelLog: env.LOG_LEVEL,
    puerto: env.CEIBA_API_PORT,
    host: env.CEIBA_API_HOST,
    urlPublica: env.CEIBA_PUBLIC_URL,
    origenPublico,
    proxiesDeConfianza: env.CEIBA_TRUSTED_PROXIES,
    cookies: Object.freeze({
      ...nombresDeCookie(env.CEIBA_COOKIE_SECURE),
      secure: env.CEIBA_COOKIE_SECURE,
      sameSite: 'lax' as const,
      path: '/' as const,
    }),
    sesion: Object.freeze({
      ttlAbsolutoMs: env.CEIBA_SESSION_ABSOLUTE_TTL,
      ttlInactividadMs: env.CEIBA_SESSION_IDLE_TTL,
      rotarTrasMs: env.CEIBA_SESSION_ROTATE_AFTER,
      intervaloMinimoLastSeenMs: 60_000,
      ventanaGraciaRotacionMs: 10_000,
    }),
    csrfSecret: env.CEIBA_CSRF_SECRET,
    driverPersistencia: env.CEIBA_PERSISTENCE_DRIVER,
    databaseUrl: env.DATABASE_URL,
    engineUrl: process.env.CEIBA_ENGINE_URL ?? 'http://engine:3001',
    engineToken: process.env.CEIBA_ENGINE_TOKEN ?? '',
    engineTimeoutMs: Number(process.env.CEIBA_ENGINE_TIMEOUT_MS ?? 30000),
  });
}

export type ConfiguracionDeApp = ConfiguracionApp;
