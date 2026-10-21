import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

// Mismo preámbulo que `peticiones-fase6`: el proxy de egreso del contenedor se
// aparta antes de importar nada, porque `undici` fija su dispatcher en el
// primer uso y con `NODE_USE_ENV_PROXY=1` manda hasta el tráfico a 127.0.0.1
// por el proxy. `pg` y Prisma comparten entorno.
for (const clave of [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
  'NODE_USE_ENV_PROXY',
]) {
  delete process.env[clave];
}
process.env['NO_PROXY'] = '127.0.0.1,localhost';

import {
  contrasenaDePrueba,
  crearAppDePruebaPostgres,
  marcaDeEjecucion,
  pedir,
  registrarYEntrar,
  type AppDePruebaPg,
  type Credenciales,
} from './helpers/app-de-prueba-postgres.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * FASE 7 · §1.1 — «P4 no es lo que parece».
 *
 * El cliente dice que «cuando se copie el curl no se copia el body, los
 * encabezados, etc.». El brief plantea una hipótesis: el defecto **no** está
 * en `curl.ts`, sino en que sin autoguardado la fila está vacía.
 *
 * Esta suite **no** opina: mide. Hace peticiones reales contra el PostgreSQL
 * de `127.0.0.1:55432` y comprueba, en el mismo recorrido que hace la interfaz:
 *
 *  A. Una petición **guardada** con cabeceras y cuerpo → ¿el cURL los lleva?
 *  B. Una petición **creada sin guardar** cabeceras ni cuerpo (lo que pasa hoy
 *     en el constructor sin P1) → ¿qué sale?
 *
 * Si A sale completo y B sale pelado, la hipótesis del brief queda
 * **confirmada** y el generador no tiene defecto en esa dimensión.
 * ════════════════════════════════════════════════════════════════════════════
 */

describe('F7 §1.1 · diagnóstico de P4 contra PostgreSQL real', () => {
  let entorno: AppDePruebaPg;
  let duena: Credenciales;
  let coleccionId: string;

  before(async () => {
    entorno = await crearAppDePruebaPostgres();
    const marca = marcaDeEjecucion();
    const clave = contrasenaDePrueba(marca);
    duena = await registrarYEntrar(entorno, `diag-${marca}@ceiba.test`, clave, 'Diagnóstico');

    const ws = await pedir(entorno, {
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { slug: `f7d-${marca}`, name: `WS diagnóstico ${marca}`, description: null },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(ws.statusCode, 201, ws.body);
    const workspaceId = (ws.json() as { workspace: { id: string } }).workspace.id;

    const col = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/collections`,
      payload: { slug: `cold-${marca}`, name: 'Colección diagnóstico', description: null },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(col.statusCode, 201, col.body);
    coleccionId = (col.json() as { coleccion: { id: string } }).coleccion.id;
  });

  after(async () => {
    await entorno?.cerrar();
  });

  it('A · con la fila GUARDADA, el cURL SÍ lleva cabeceras, cuerpo, query y Content-Type', async () => {
    const creada = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/collections/${coleccionId}/requests`,
      payload: {
        name: 'Crear cliente',
        method: 'POST',
        url: '{{base_url}}/v1/clientes',
        headers: [
          { key: 'Accept', value: 'application/json', enabled: true },
          { key: 'X-Tenant', value: 'acme', enabled: true },
        ],
        queryParams: [{ key: 'dry_run', value: 'true', enabled: true }],
        bodyType: 'raw_json',
        body: '{"nombre":"Ada"}',
      },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(creada.statusCode, 201, creada.body);
    const id = (creada.json() as { request: { id: string } }).request.id;

    const exportado = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/requests/${id}/curl`,
      cookies: duena.cookies,
    });
    assert.equal(exportado.statusCode, 200, exportado.body);
    const { curl } = exportado.json() as { curl: string };

    // Prueba literal de que el generador NO está roto.
    assert.ok(curl.includes("'Accept: application/json'"), curl);
    assert.ok(curl.includes("'X-Tenant: acme'"), curl);
    assert.ok(curl.includes('--data-raw'), curl);
    assert.ok(curl.includes('{"nombre":"Ada"}'), curl);
    assert.ok(curl.includes('dry_run=true'), curl);
    assert.ok(curl.includes("'Content-Type: application/json'"), curl);
    assert.ok(curl.includes('{{base_url}}'), curl); // regla 2 del §2 FASE6

    process.stderr.write(`\n[DIAGNÓSTICO A · fila guardada]\n${curl}\n`);
  });

  it('B · sin guardar cabeceras ni cuerpo (lo que pasa hoy sin P1), el cURL sale PELADO', async () => {
    const creada = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/collections/${coleccionId}/requests`,
      payload: {
        // Exactamente lo que la web manda al pulsar «nueva petición»: nombre,
        // método y URL. El usuario escribe luego cabeceras y cuerpo en el
        // constructor y NUNCA pulsa guardar, porque no hay autoguardado.
        name: 'Crear cliente (sin guardar)',
        method: 'POST',
        url: '{{base_url}}/v1/clientes',
      },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(creada.statusCode, 201, creada.body);
    const id = (creada.json() as { request: { id: string } }).request.id;

    const exportado = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/requests/${id}/curl`,
      cookies: duena.cookies,
    });
    assert.equal(exportado.statusCode, 200, exportado.body);
    const { curl } = exportado.json() as { curl: string };

    assert.ok(!curl.includes('--data'), curl);
    assert.ok(!curl.includes('--header'), curl);

    process.stderr.write(`\n[DIAGNÓSTICO B · fila sin guardar]\n${curl}\n`);
  });

  it('C · los modos que faltan NO se pueden crear hoy: `binary_file` y `custom` dan 422', async () => {
    for (const modo of ['binary_file', 'custom', 'multipart_form_data']) {
      const respuesta = await pedir(entorno, {
        method: 'POST',
        url: `/api/v1/collections/${coleccionId}/requests`,
        payload: {
          name: `Modo ${modo}`,
          method: 'POST',
          url: 'https://api.example.com/subir',
          bodyType: modo,
        },
        cookies: duena.cookies,
        csrf: duena.csrf,
      });
      process.stderr.write(`\n[DIAGNÓSTICO C · bodyType=${modo}] ${respuesta.statusCode}\n`);
    }
  });
});
