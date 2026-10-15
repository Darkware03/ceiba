import { ErrorDeApi, ErrorDeRed } from './errores';
import {
  NOMBRE_CABECERA_CSRF,
  asegurarTestigoCsrf,
  recordarTestigoCsrf,
  testigoCsrfActual,
} from './csrf';

/**
 * Cliente HTTP único contra la API de CEIBA.
 *
 * Tres reglas que esta capa hace cumplir y que NO se pueden saltar desde las
 * vistas, porque las vistas no hacen `fetch` directamente:
 *
 *  1. **`credentials: "include"` siempre.** La sesión va en cookie `HttpOnly`
 *     (decisión C-31): sin esto el navegador no la manda y toda ruta protegida
 *     responde 401.
 *  2. **Testigo CSRF en TODA operación mutante.** `POST`, `PUT`, `PATCH` y
 *     `DELETE`, sin excepciones, incluido el inicio de sesión — el guard de la
 *     API no tiene decorador para saltárselo (ADR-0009 §5).
 *  3. **Ningún testigo en `localStorage`.** Aquí no se guarda nada: la cookie
 *     la gestiona el navegador.
 *
 * Mismo origen a propósito (ADR-0009 §6.3): la base es una ruta relativa, así
 * `Origin` coincide con `CEIBA_PUBLIC_URL` y no hace falta CORS con
 * credenciales. En desarrollo lo sostiene el `proxy` de `vite.config.ts`.
 */

export const BASE_API = import.meta.env?.VITE_CEIBA_API_BASE ?? '/api/v1';

export type MetodoHttp = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const METODOS_MUTANTES: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function esMetodoMutante(metodo: string): boolean {
  return METODOS_MUTANTES.has(metodo.toUpperCase());
}

export interface OpcionesDePeticion {
  readonly metodo?: MetodoHttp;
  readonly cuerpo?: unknown;
  readonly senal?: AbortSignal;
}

/** `fetch` inyectable: las pruebas pasan un doble y no tocan la red. */
export type FuncionFetch = typeof globalThis.fetch;

let fetchActual: FuncionFetch | null = null;

export function usarFetch(implementacion: FuncionFetch | null): void {
  fetchActual = implementacion;
}

function obtenerFetch(): FuncionFetch {
  if (fetchActual !== null) return fetchActual;
  if (typeof globalThis.fetch !== 'function') {
    throw new ErrorDeRed('Este entorno no dispone de fetch.');
  }
  return globalThis.fetch.bind(globalThis);
}

/**
 * Pide un testigo CSRF nuevo a la API.
 *
 * Es `GET`, así que no necesita testigo previo: es exactamente el endpoint que
 * el ADR-0009 §5 añade «para que la SPA lo pida antes de su primer envío».
 */
async function acunarTestigoCsrf(): Promise<string | null> {
  try {
    const respuesta = await obtenerFetch()(`${BASE_API}/auth/csrf`, {
      method: 'GET',
      credentials: 'include',
      headers: { accept: 'application/json' },
    });
    if (!respuesta.ok) return null;
    const cuerpo = (await respuesta.json()) as { csrfToken?: unknown };
    return typeof cuerpo.csrfToken === 'string' ? cuerpo.csrfToken : null;
  } catch {
    // Si no se puede acuñar, la operación mutante fallará con 403 y el usuario
    // verá un error claro. Fallar aquí en silencio sería peor.
    return null;
  }
}

async function interpretarError(respuesta: Response): Promise<never> {
  let codigo = 'error_http';
  let mensaje = `La API respondió ${respuesta.status}.`;
  let detalles: readonly string[] = [];

  try {
    const cuerpo = (await respuesta.json()) as {
      error?: unknown;
      mensaje?: unknown;
      detalles?: unknown;
    };
    if (typeof cuerpo.error === 'string') codigo = cuerpo.error;
    if (typeof cuerpo.mensaje === 'string') mensaje = cuerpo.mensaje;
    if (Array.isArray(cuerpo.detalles)) {
      detalles = cuerpo.detalles.filter((d): d is string => typeof d === 'string');
    }
  } catch {
    // Cuerpo no JSON (por ejemplo un 502 de Nginx): se queda el mensaje genérico.
  }

  throw new ErrorDeApi(respuesta.status, codigo, mensaje, detalles);
}

/**
 * Lanza una petición a la API y devuelve el cuerpo ya interpretado.
 *
 * `T = void` para los `204 No Content` (`logout`, borrados).
 */
export async function peticionApi<T>(
  ruta: string,
  opciones: OpcionesDePeticion = {},
): Promise<T> {
  const metodo = opciones.metodo ?? 'GET';
  const cabeceras: Record<string, string> = { accept: 'application/json' };

  if (opciones.cuerpo !== undefined) {
    cabeceras['content-type'] = 'application/json';
  }

  if (esMetodoMutante(metodo)) {
    const testigo = await asegurarTestigoCsrf(acunarTestigoCsrf);
    if (testigo !== null) {
      cabeceras[NOMBRE_CABECERA_CSRF] = testigo;
    }
    // Si sigue sin haber testigo se envía igual: el servidor responderá 403
    // `csrf_invalido` y el usuario verá el motivo. Inventarse un valor o
    // saltarse la cabecera «porque no hay» sería ocultar el fallo.
  }

  const peticion: RequestInit = {
    method: metodo,
    // C-31: sin esto la cookie `HttpOnly` de sesión no viaja.
    credentials: 'include',
    headers: cabeceras,
  };
  if (opciones.cuerpo !== undefined) peticion.body = JSON.stringify(opciones.cuerpo);
  if (opciones.senal !== undefined) peticion.signal = opciones.senal;

  let respuesta: Response;
  try {
    respuesta = await obtenerFetch()(`${BASE_API}${ruta}`, peticion);
  } catch (error) {
    throw new ErrorDeRed('No se pudo contactar con la API de CEIBA.', error);
  }

  // La API rota el testigo CSRF al iniciar sesión (ADR-0009 §5). Al releer la
  // cookie después de cada respuesta, la copia en memoria no se queda vieja.
  recordarTestigoCsrf(testigoCsrfActual());

  if (!respuesta.ok) await interpretarError(respuesta);

  if (respuesta.status === 204) return undefined as T;

  const tipo = respuesta.headers.get('content-type') ?? '';
  if (!tipo.includes('json')) return undefined as T;

  return (await respuesta.json()) as T;
}
