import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import {
  cookieDe,
  crearAppDePrueba,
  obtenerCsrf,
  pedir,
  registrarYEntrar,
  type AppDePrueba,
  type Credenciales,
} from './helpers/app-de-prueba.ts';

/**
 * CSRF siempre activo en toda operación mutante (C-31 y ADR-0009 §5).
 *
 * Prueba exigida literalmente por el encargo: «que una operación mutante sin
 * testigo CSRF sea rechazada».
 */
describe('CSRF — toda operación mutante', () => {
  let entorno: AppDePrueba;
  let credenciales: Credenciales;

  before(async () => {
    entorno = await crearAppDePrueba();
    credenciales = await registrarYEntrar(entorno, 'csrf@ejemplo.test');
  });

  after(async () => {
    await entorno.cerrar();
  });

  it('un GET sin cookie CSRF recibe una acuñada en la respuesta', async () => {
    const respuesta = await pedir(entorno, { method: 'GET', url: '/api/v1/auth/csrf' });
    assert.equal(respuesta.statusCode, 200);
    const cookie = cookieDe(respuesta, entorno.config.cookies.nombreCsrf);
    assert.ok(cookie !== undefined, 'debe emitir la cookie CSRF');
    assert.ok(entorno.testigos.esValido(cookie), 'el testigo debe llevar firma válida');
  });

  it('la cookie CSRF NO es HttpOnly (la SPA tiene que leerla) y la de sesión SÍ', async () => {
    const respuesta = await pedir(entorno, { method: 'GET', url: '/api/v1/auth/csrf' });
    const cookieCsrf = respuesta.cookies.find(
      (c) => c['name'] === entorno.config.cookies.nombreCsrf,
    );
    assert.ok(cookieCsrf !== undefined);
    assert.notEqual(cookieCsrf['httpOnly'], true);
    assert.equal(cookieCsrf['sameSite'], 'Lax');
    assert.equal(cookieCsrf['path'], '/');
    assert.equal(cookieCsrf['domain'], undefined, '__Host- exige que NO haya Domain');
  });

  it('POST sin cabecera ni cookie CSRF -> 403', async () => {
    const respuesta = await pedir(entorno, {
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { slug: 'sin-csrf', name: 'Sin CSRF' },
      cookies: {
        [entorno.config.cookies.nombreSesion]:
          credenciales.cookies[entorno.config.cookies.nombreSesion] as string,
      },
    });
    assert.equal(respuesta.statusCode, 403);
    assert.equal(respuesta.json<{ error: string }>().error, 'csrf_invalido');
  });

  it('POST con cookie CSRF pero SIN cabecera -> 403', async () => {
    const respuesta = await pedir(entorno, {
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { slug: 'solo-cookie', name: 'Solo cookie' },
      cookies: credenciales.cookies,
    });
    assert.equal(respuesta.statusCode, 403);
  });

  it('POST con cabecera que no coincide con la cookie -> 403', async () => {
    const otro = await obtenerCsrf(entorno);
    const respuesta = await pedir(entorno, {
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { slug: 'desparejado', name: 'Desparejado' },
      cookies: credenciales.cookies,
      csrf: otro,
    });
    assert.equal(respuesta.statusCode, 403);
  });

  it('POST con un testigo sin firma válida -> 403', async () => {
    const falsificado = 'nonce-inventado.firma-inventada';
    const respuesta = await pedir(entorno, {
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { slug: 'firma-mala', name: 'Firma mala' },
      cookies: {
        ...credenciales.cookies,
        [entorno.config.cookies.nombreCsrf]: falsificado,
      },
      csrf: falsificado,
    });
    assert.equal(respuesta.statusCode, 403);
  });

  it('POST con Origin ajeno -> 403 aunque el testigo CSRF sea correcto', async () => {
    const respuesta = await pedir(entorno, {
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { slug: 'origen-ajeno', name: 'Origen ajeno' },
      cookies: credenciales.cookies,
      csrf: credenciales.csrf,
      origen: 'https://atacante.example',
    });
    assert.equal(respuesta.statusCode, 403);
  });

  it('POST sin Origin ni Referer -> 403 (falla CERRADO)', async () => {
    const respuesta = await pedir(entorno, {
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { slug: 'sin-origen', name: 'Sin origen' },
      cookies: credenciales.cookies,
      csrf: credenciales.csrf,
      origen: null,
    });
    assert.equal(respuesta.statusCode, 403);
  });

  it('POST con Referer del origen correcto y sin Origin -> pasa', async () => {
    const respuesta = await pedir(entorno, {
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { slug: 'con-referer', name: 'Con referer' },
      cookies: credenciales.cookies,
      csrf: credenciales.csrf,
      origen: null,
      headers: { referer: 'http://localhost:8080/workspaces/nuevo' },
    });
    assert.equal(respuesta.statusCode, 201);
  });

  it('POST con cookie + cabecera + Origin correctos -> 201', async () => {
    const respuesta = await pedir(entorno, {
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { slug: 'con-csrf', name: 'Con CSRF' },
      cookies: credenciales.cookies,
      csrf: credenciales.csrf,
    });
    assert.equal(respuesta.statusCode, 201);
  });

  it('el propio login exige CSRF: el login CSRF es real', async () => {
    const respuesta = await pedir(entorno, {
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'csrf@ejemplo.test', password: 'contrasena-de-prueba-larga' },
    });
    assert.equal(respuesta.statusCode, 403, 'POST /auth/login sin CSRF debe rechazarse');
  });

  it('al iniciar sesión se ROTA el testigo CSRF previo (§5)', async () => {
    const anterior = await obtenerCsrf(entorno);
    const entrada = await pedir(entorno, {
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'csrf@ejemplo.test', password: 'contrasena-de-prueba-larga' },
      cookies: { [entorno.config.cookies.nombreCsrf]: anterior },
      csrf: anterior,
    });
    assert.equal(entrada.statusCode, 200);
    const nuevo = cookieDe(entrada, entorno.config.cookies.nombreCsrf);
    assert.ok(nuevo !== undefined);
    assert.notEqual(nuevo, anterior, 'el testigo anterior a la autenticación no debe sobrevivir');
  });

  it('DELETE y PATCH también exigen CSRF, no sólo POST', async () => {
    const creado = await pedir(entorno, {
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { slug: 'para-borrar', name: 'Para borrar' },
      cookies: credenciales.cookies,
      csrf: credenciales.csrf,
    });
    assert.equal(creado.statusCode, 201);
    const id = creado.json<{ workspace: { id: string } }>().workspace.id;

    const parche = await pedir(entorno, {
      method: 'PATCH',
      url: `/api/v1/workspaces/${id}`,
      payload: { name: 'Renombrado' },
      cookies: credenciales.cookies,
    });
    assert.equal(parche.statusCode, 403);

    const borrado = await pedir(entorno, {
      method: 'DELETE',
      url: `/api/v1/workspaces/${id}`,
      cookies: credenciales.cookies,
    });
    assert.equal(borrado.statusCode, 403);
  });
});
