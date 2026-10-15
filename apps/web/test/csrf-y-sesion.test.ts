import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { peticionApi, usarFetch } from '../src/api/cliente';
import { NOMBRE_CABECERA_CSRF, NOMBRE_COOKIE_CSRF, leerCookie } from '../src/api/csrf';
import { ErrorDeApi, ErrorDeRed } from '../src/api/errores';
import { usarAlmacenDeSesion } from '../src/stores/sesion';

/**
 * Requisito del cliente: **toda operación mutante lleva el testigo CSRF**.
 *
 * Esta prueba vigila las tres reglas de `api/cliente.ts` a la vez:
 *   1. `credentials: "include"` en todas las peticiones (sin eso la cookie
 *      `HttpOnly` de sesión no viaja y C-31 no funcionaría).
 *   2. Cabecera `x-ceiba-csrf` en `POST`, `PUT`, `PATCH` y `DELETE`.
 *   3. Si no hay cookie, se acuña con `GET /auth/csrf` antes de mutar.
 */

const TESTIGO = 'nonce-de-prueba.firma-de-prueba';

interface PeticionCapturada {
  readonly url: string;
  readonly metodo: string;
  readonly credenciales: RequestCredentials | undefined;
  readonly cabeceras: Record<string, string>;
  readonly cuerpo: string | null;
}

function capturador(
  responder: (url: string, metodo: string) => Response,
): { llamadas: PeticionCapturada[]; fetch: typeof globalThis.fetch } {
  const llamadas: PeticionCapturada[] = [];
  const fetch = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = String(entrada);
    const metodo = (init?.method ?? 'GET').toUpperCase();
    const cabeceras: Record<string, string> = {};
    for (const [clave, valor] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      cabeceras[clave.toLowerCase()] = valor;
    }
    llamadas.push({
      url,
      metodo,
      credenciales: init?.credentials,
      cabeceras,
      cuerpo: typeof init?.body === 'string' ? init.body : null,
    });
    return responder(url, metodo);
  }) as typeof globalThis.fetch;
  return { llamadas, fetch };
}

function json(estado: number, cuerpo: unknown): Response {
  return new Response(estado === 204 ? null : JSON.stringify(cuerpo), {
    status: estado,
    headers: estado === 204 ? {} : { 'content-type': 'application/json' },
  });
}

describe('cliente de API: CSRF y cookies', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('acuña el testigo con GET /auth/csrf y lo manda en la cabecera de un POST', async () => {
    const { llamadas, fetch } = capturador((url) => {
      if (url.endsWith('/auth/csrf')) {
        // La API real pone también la cookie; aquí se refleja en jsdom.
        document.cookie = `${NOMBRE_COOKIE_CSRF}=${TESTIGO}; path=/; secure`;
        return json(200, { csrfToken: TESTIGO });
      }
      return json(201, { workspace: { id: 'ws_1' } });
    });
    usarFetch(fetch);

    await peticionApi('/workspaces', { metodo: 'POST', cuerpo: { slug: 'eq', name: 'Equipo' } });

    expect(llamadas.map((l) => `${l.metodo} ${l.url}`)).toEqual([
      'GET /api/v1/auth/csrf',
      'POST /api/v1/workspaces',
    ]);

    const mutante = llamadas[1];
    expect(mutante?.cabeceras[NOMBRE_CABECERA_CSRF]).toBe(TESTIGO);
    expect(mutante?.credenciales).toBe('include');
    expect(mutante?.cabeceras['content-type']).toBe('application/json');
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'] as const)(
    '%s lleva siempre el testigo CSRF',
    async (metodo) => {
      document.cookie = `${NOMBRE_COOKIE_CSRF}=${TESTIGO}; path=/; secure`;
      const { llamadas, fetch } = capturador(() => json(200, { ok: true }));
      usarFetch(fetch);

      await peticionApi('/recurso', { metodo });

      expect(llamadas).toHaveLength(1); // no hace falta acuñar: ya hay cookie
      expect(llamadas[0]?.cabeceras[NOMBRE_CABECERA_CSRF]).toBe(TESTIGO);
      expect(llamadas[0]?.credenciales).toBe('include');
    },
  );

  it('GET no manda testigo CSRF pero sí las credenciales', async () => {
    document.cookie = `${NOMBRE_COOKIE_CSRF}=${TESTIGO}; path=/; secure`;
    const { llamadas, fetch } = capturador(() => json(200, { workspaces: [] }));
    usarFetch(fetch);

    await peticionApi('/workspaces');

    expect(llamadas[0]?.cabeceras[NOMBRE_CABECERA_CSRF]).toBeUndefined();
    expect(llamadas[0]?.credenciales).toBe('include');
  });

  it('traduce el cuerpo de error de la API a ErrorDeApi con su código', async () => {
    document.cookie = `${NOMBRE_COOKIE_CSRF}=${TESTIGO}; path=/; secure`;
    const { fetch } = capturador(() =>
      json(403, { error: 'csrf_invalido', mensaje: 'Testigo CSRF no coincidente.' }),
    );
    usarFetch(fetch);

    const fallo = await peticionApi('/workspaces', { metodo: 'POST', cuerpo: {} }).catch(
      (e: unknown) => e,
    );

    expect(fallo).toBeInstanceOf(ErrorDeApi);
    expect((fallo as ErrorDeApi).estado).toBe(403);
    expect((fallo as ErrorDeApi).esCsrf).toBe(true);
    expect((fallo as ErrorDeApi).message).toBe('Testigo CSRF no coincidente.');
  });

  it('un 204 no intenta interpretar cuerpo', async () => {
    document.cookie = `${NOMBRE_COOKIE_CSRF}=${TESTIGO}; path=/; secure`;
    const { fetch } = capturador(() => json(204, null));
    usarFetch(fetch);

    await expect(peticionApi<void>('/workspaces/ws_1', { metodo: 'DELETE' })).resolves.toBeUndefined();
  });

  it('un fallo de red se convierte en ErrorDeRed, no en un 500 falso', async () => {
    usarFetch((async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof globalThis.fetch);

    const fallo = await peticionApi('/workspaces').catch((e: unknown) => e);
    expect(fallo).toBeInstanceOf(ErrorDeRed);
  });

  it('lee la cookie CSRF sin confundirla con otra de prefijo parecido', () => {
    const cadena = `otra_${NOMBRE_COOKIE_CSRF}=basura; ${NOMBRE_COOKIE_CSRF}=${TESTIGO}; x=1`;
    expect(leerCookie(NOMBRE_COOKIE_CSRF, cadena)).toBe(TESTIGO);
    expect(leerCookie('inexistente', cadena)).toBeNull();
  });
});

describe('almacén de sesión', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('un 401 en /auth/me deja la sesión cerrada y NO lo trata como error', async () => {
    usarFetch((async () =>
      json(401, {
        error: 'no_autenticado',
        mensaje: 'Credenciales inválidas o sesión no válida.',
      })) as typeof globalThis.fetch);

    const sesion = usarAlmacenDeSesion();
    await sesion.comprobar();

    expect(sesion.autenticado).toBe(false);
    expect(sesion.comprobada).toBe(true);
    expect(sesion.error).toBeNull();
  });

  it('el inicio con segundo factor NO abre sesión y guarda el reto', async () => {
    usarFetch((async (entrada: RequestInfo | URL) => {
      const url = String(entrada);
      if (url.endsWith('/auth/csrf')) return json(200, { csrfToken: TESTIGO });
      return json(200, {
        mfaRequerido: true,
        retoId: 'reto_1',
        retoTestigo: 'abc',
        expiraEn: '2026-10-15T19:00:00.000Z',
      });
    }) as typeof globalThis.fetch);

    const sesion = usarAlmacenDeSesion();
    const dentro = await sesion.iniciar('ana@ejemplo.sv', 'contrasena-larga-1');

    expect(dentro).toBe(false);
    expect(sesion.autenticado).toBe(false);
    expect(sesion.reto?.retoId).toBe('reto_1');
  });

  it('cerrar sesión limpia el estado local aunque la API falle', async () => {
    const sesion = usarAlmacenDeSesion();
    sesion.aplicarInicio({
      usuario: { id: 'u1', email: 'ana@ejemplo.sv', displayName: 'Ana Rivas' },
    });
    expect(sesion.autenticado).toBe(true);

    usarFetch((async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof globalThis.fetch);

    await sesion.cerrar();
    expect(sesion.autenticado).toBe(false);
    expect(sesion.usuario).toBeNull();
  });

  it('las iniciales salen del nombre visible, no del correo', () => {
    const sesion = usarAlmacenDeSesion();
    sesion.aplicarInicio({
      usuario: { id: 'u1', email: 'ana@ejemplo.sv', displayName: 'Ana Rivas' },
    });
    expect(sesion.iniciales).toBe('AR');
  });
});
