import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent } from 'vue';
import { aplicarTitulo, destinoDeVuelta, guardaDeSesion } from '../src/router/guardas';
import { usarFetch } from '../src/api/cliente';
import { usarAlmacenDeSesion } from '../src/stores/sesion';

/**
 * Requisito del cliente: **una ruta protegida sin sesión redirige al login, y
 * después se vuelve al destino**.
 *
 * Se ejercita el enrutador de verdad (con `createMemoryHistory`) y el guard
 * real, no una imitación: si el guard cambia, esta prueba lo nota.
 *
 * El 401 de `GET /auth/me` se simula con un doble de `fetch`, que es
 * exactamente lo que responde la API cuando no hay cookie de sesión válida.
 */

const Vacio = defineComponent({ name: 'Vacio', template: '<div />' });

function construirEnrutador(): Router {
  const enrutador = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', redirect: '/workspaces' },
      { path: '/entrar', name: 'login', component: Vacio, meta: { requiereSesion: false } },
      { path: '/registro', name: 'registro', component: Vacio, meta: { requiereSesion: false } },
      { path: '/workspaces', name: 'workspaces', component: Vacio, meta: { requiereSesion: true } },
      {
        path: '/workspaces/:workspaceId',
        name: 'workspace',
        component: Vacio,
        meta: { requiereSesion: true },
      },
      // A propósito SIN `meta`: debe comportarse como protegida.
      { path: '/sin-declarar', name: 'sin-declarar', component: Vacio },
    ],
  });
  enrutador.beforeEach(guardaDeSesion);
  enrutador.afterEach(aplicarTitulo);
  return enrutador;
}

function respuestaJson(estado: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'content-type': 'application/json' },
  });
}

const PERFIL = {
  id: 'usr_1',
  email: 'ana@ejemplo.sv',
  displayName: 'Ana Rivas',
};

/** Doble de `fetch` que devuelve 401 en `/auth/me`: no hay sesión. */
function fetchSinSesion(): typeof globalThis.fetch {
  return (async (entrada: RequestInfo | URL) => {
    const url = String(entrada);
    if (url.endsWith('/auth/me')) {
      return respuestaJson(401, {
        error: 'no_autenticado',
        mensaje: 'Credenciales inválidas o sesión no válida.',
      });
    }
    throw new Error(`petición inesperada en la prueba: ${url}`);
  }) as typeof globalThis.fetch;
}

/** Doble de `fetch` que devuelve el perfil: hay sesión válida. */
function fetchConSesion(): typeof globalThis.fetch {
  return (async (entrada: RequestInfo | URL) => {
    const url = String(entrada);
    if (url.endsWith('/auth/me')) return respuestaJson(200, { usuario: PERFIL });
    throw new Error(`petición inesperada en la prueba: ${url}`);
  }) as typeof globalThis.fetch;
}

describe('rutas protegidas', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('sin sesión, una ruta protegida redirige al login conservando el destino', async () => {
    usarFetch(fetchSinSesion());
    const enrutador = construirEnrutador();

    await enrutador.push('/workspaces/ws_42');
    await enrutador.isReady();

    expect(enrutador.currentRoute.value.name).toBe('login');
    expect(enrutador.currentRoute.value.query['redirect']).toBe('/workspaces/ws_42');
  });

  it('una ruta sin `meta.requiereSesion` se trata como protegida (deniega por omisión)', async () => {
    usarFetch(fetchSinSesion());
    const enrutador = construirEnrutador();

    await enrutador.push('/sin-declarar');
    await enrutador.isReady();

    expect(enrutador.currentRoute.value.name).toBe('login');
    expect(enrutador.currentRoute.value.query['redirect']).toBe('/sin-declarar');
  });

  it('con sesión, la misma ruta protegida se abre sin redirección', async () => {
    usarFetch(fetchConSesion());
    const enrutador = construirEnrutador();

    await enrutador.push('/workspaces/ws_42');
    await enrutador.isReady();

    expect(enrutador.currentRoute.value.name).toBe('workspace');
    expect(usarAlmacenDeSesion().autenticado).toBe(true);
  });

  it('tras iniciar sesión se vuelve al destino que había en `?redirect=`', async () => {
    usarFetch(fetchSinSesion());
    const enrutador = construirEnrutador();

    await enrutador.push('/workspaces/ws_42');
    await enrutador.isReady();
    expect(enrutador.currentRoute.value.name).toBe('login');

    // La sesión se abre (lo que haría `POST /auth/login`).
    usarAlmacenDeSesion().aplicarInicio({ usuario: PERFIL });

    // Y se navega al destino guardado, tal como hace la vista de acceso.
    const vuelta = destinoDeVuelta(enrutador.currentRoute.value.query['redirect']);
    expect(vuelta).toBe('/workspaces/ws_42');
    await enrutador.replace(vuelta as string);

    expect(enrutador.currentRoute.value.fullPath).toBe('/workspaces/ws_42');
  });

  it('con sesión, el login redirige fuera en vez de volver a pedir credenciales', async () => {
    usarFetch(fetchConSesion());
    const enrutador = construirEnrutador();

    await enrutador.push('/entrar');
    await enrutador.isReady();

    expect(enrutador.currentRoute.value.name).toBe('workspaces');
  });

  it('`?redirect=` no admite destinos externos: es un redirector abierto', () => {
    expect(destinoDeVuelta('/workspaces')).toBe('/workspaces');
    expect(destinoDeVuelta('//evil.example/x')).toBeNull();
    expect(destinoDeVuelta('https://evil.example/x')).toBeNull();
    expect(destinoDeVuelta('javascript:alert(1)')).toBeNull();
    expect(destinoDeVuelta(undefined)).toBeNull();
    expect(destinoDeVuelta(['/a', '/b'])).toBeNull();
  });
});
