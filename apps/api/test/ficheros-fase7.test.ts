import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

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
  analizarMultipart,
  ErrorMultipart,
  extraerBoundary,
  parametroDeDisposicion,
  sanearNombreDeFichero,
} from '../src/modules/file/multipart.ts';
import { normalizarContentType } from '../src/modules/file/file.service.ts';
import {
  cargarConfiguracionDeFicheros,
  LIMITE_POR_DEFECTO_BYTES,
} from '../src/modules/file/file.config.ts';
import {
  contrasenaDePrueba,
  marcaDeEjecucion,
  pedir,
  registrarYEntrar,
  type AppDePruebaPg,
  type Credenciales,
} from './helpers/app-de-prueba-postgres.ts';
import { construirMultipart, crearAppDeFicheros } from './ficheros-arnes.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * FASE 7 · §2.2 — SUBIDA DE FICHEROS.
 *
 * Bloque 1: el lector de multipart, **unitario y puro**. Un analizador de
 * formato que sólo se prueba por HTTP deja sin cubrir justo los casos
 * hostiles, que es donde vive el riesgo.
 *
 * Bloque 2: las tres rutas contra el PostgreSQL REAL de `127.0.0.1:55432`.
 * ════════════════════════════════════════════════════════════════════════════
 */

// ===========================================================================
// 1. Lector de multipart. Unitario puro.
// ===========================================================================

describe('F7 · lector de multipart/form-data', () => {
  it('extrae el boundary, con y sin comillas, y rechaza lo que no es multipart', () => {
    assert.equal(extraerBoundary('multipart/form-data; boundary=abc123'), 'abc123');
    assert.equal(extraerBoundary('multipart/form-data; boundary="a b c"'), 'a b c');
    assert.throws(() => extraerBoundary('application/json'), ErrorMultipart);
    assert.throws(() => extraerBoundary('multipart/form-data'), ErrorMultipart);
    assert.throws(() => extraerBoundary(undefined), ErrorMultipart);
    // Un boundary con caracteres fuera del juego de RFC 2046 no se acepta.
    assert.throws(() => extraerBoundary('multipart/form-data; boundary=a\u0000b'), ErrorMultipart);
  });

  it('trocea un formulario con un campo de texto y uno de fichero', () => {
    const { payload, contentType } = construirMultipart([
      { nombre: 'purpose', contenido: 'form_field_file' },
      {
        nombre: 'file',
        contenido: Buffer.from([0x00, 0x01, 0xff, 0xfe]),
        nombreDeFichero: 'datos.bin',
        contentType: 'application/octet-stream',
      },
    ]);
    const partes = analizarMultipart(payload, contentType);
    assert.equal(partes.length, 2);
    assert.equal(partes[0]?.nombre, 'purpose');
    assert.equal(partes[0]?.contenido.toString('utf8'), 'form_field_file');
    assert.equal(partes[1]?.nombre, 'file');
    assert.equal(partes[1]?.nombreDeFichero, 'datos.bin');
    assert.equal(partes[1]?.contentType, 'application/octet-stream');
    assert.deepEqual([...(partes[1]?.contenido ?? [])], [0x00, 0x01, 0xff, 0xfe]);
  });

  it('los bytes del fichero sobreviven intactos, incluidos CRLF y el propio boundary dentro', () => {
    // Un contenido que incluye `\r\n--` es justo lo que rompe un troceado
    // ingenuo por `split`.
    const contenido = Buffer.from('línea1\r\n--no-soy-el-boundary\r\nlínea2\r\n', 'utf8');
    const { payload, contentType } = construirMultipart([
      { nombre: 'file', contenido, nombreDeFichero: 'x.txt' },
    ]);
    const partes = analizarMultipart(payload, contentType);
    assert.deepEqual(partes[0]?.contenido, contenido);
  });

  it('un cuerpo con más partes del tope se rechaza en vez de asignarlas', () => {
    const { payload, contentType } = construirMultipart(
      Array.from({ length: 5 }, (_, i) => ({ nombre: `c${i}`, contenido: 'x' })),
    );
    assert.throws(
      () => analizarMultipart(payload, contentType, { maxPartes: 3 }),
      /más de 3 partes/u,
    );
  });

  it('rechaza un cuerpo truncado y uno sin Content-Disposition', () => {
    const { payload, contentType } = construirMultipart([{ nombre: 'file', contenido: 'hola' }]);
    assert.throws(() => analizarMultipart(payload.subarray(0, 40), contentType), ErrorMultipart);

    const boundary = 'xyz';
    const sinDisposicion = Buffer.from(
      `--${boundary}\r\nContent-Type: text/plain\r\n\r\nhola\r\n--${boundary}--\r\n`,
      'utf8',
    );
    assert.throws(
      () => analizarMultipart(sinDisposicion, `multipart/form-data; boundary=${boundary}`),
      /Content-Disposition/u,
    );
  });

  it('rechaza content-transfer-encoding en vez de adivinar la decodificación', () => {
    const boundary = 'xyz';
    const cuerpo = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"\r\nContent-Transfer-Encoding: base64\r\n\r\naG9sYQ==\r\n--${boundary}--\r\n`,
      'utf8',
    );
    assert.throws(
      () => analizarMultipart(cuerpo, `multipart/form-data; boundary=${boundary}`),
      /content-transfer-encoding/u,
    );
  });

  it('lee la forma extendida filename* de RFC 5987 (UTF-8, percent-encoding)', () => {
    const disposicion = "form-data; name=\"file\"; filename*=UTF-8''informe%20a%C3%B1o.pdf";
    assert.equal(parametroDeDisposicion(disposicion, 'filename'), 'informe año.pdf');
  });

  it('EL NOMBRE DEL CLIENTE NO ES UNA RUTA: se le quitan separadores y controles', () => {
    assert.equal(sanearNombreDeFichero('../../etc/passwd'), 'passwd');
    assert.equal(sanearNombreDeFichero('C:\\Windows\\system32\\drivers\\etc\\hosts'), 'hosts');
    assert.equal(sanearNombreDeFichero('a\u0000b.txt'), 'ab.txt');
    assert.equal(sanearNombreDeFichero('..'), null);
    assert.equal(sanearNombreDeFichero('   '), null);
    assert.equal(sanearNombreDeFichero(null), null);
  });

  it('el Content-Type declarado por el cliente se normaliza o se descarta', () => {
    assert.equal(normalizarContentType('application/PDF; charset=utf-8'), 'application/pdf');
    assert.equal(normalizarContentType('no-es-un-tipo'), 'application/octet-stream');
    assert.equal(normalizarContentType('text/plain\r\nX-Inyectada: 1'), 'application/octet-stream');
    assert.equal(normalizarContentType(null), 'application/octet-stream');
  });

  it('el límite por defecto es 10 MiB y un valor por encima del CHECK se rechaza', () => {
    assert.equal(LIMITE_POR_DEFECTO_BYTES, 10 * 1024 * 1024);
    assert.equal(cargarConfiguracionDeFicheros({}, '/tmp').maxBytes, LIMITE_POR_DEFECTO_BYTES);
    assert.equal(cargarConfiguracionDeFicheros({ CEIBA_FILE_MAX_BYTES: '4096' }, '/tmp').maxBytes, 4096);
    assert.throws(
      () => cargarConfiguracionDeFicheros({ CEIBA_FILE_MAX_BYTES: '999999999' }, '/tmp'),
      /ck_file_size/u,
    );
    assert.throws(
      () => cargarConfiguracionDeFicheros({ CEIBA_FILE_MAX_BYTES: 'muchos' }, '/tmp'),
      /entero positivo/u,
    );
  });
});

// ===========================================================================
// 2. Las tres rutas del §2.2 contra PostgreSQL real.
// ===========================================================================

describe('F7 · §2.2 subida de ficheros contra PostgreSQL real', () => {
  let entorno: AppDePruebaPg;
  let duena: Credenciales;
  let ajena: Credenciales;
  let workspaceId: string;
  let almacen: string;

  /** Límite pequeño a propósito: probar 10 MiB de verdad sería malgastar E/S. */
  const LIMITE = 4096;

  before(async () => {
    almacen = mkdtempSync(join(tmpdir(), 'ceiba-ficheros-'));
    entorno = await crearAppDeFicheros({
      CEIBA_FILE_STORAGE_DIR: almacen,
      CEIBA_FILE_MAX_BYTES: String(LIMITE),
    });
    const marca = marcaDeEjecucion();
    const clave = contrasenaDePrueba(marca);
    duena = await registrarYEntrar(entorno, `fdue-${marca}@ceiba.test`, clave, 'Dueña');
    ajena = await registrarYEntrar(entorno, `faje-${marca}@ceiba.test`, clave, 'Ajena');

    const ws = await pedir(entorno, {
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { slug: `f7f-${marca}`, name: `WS ficheros ${marca}`, description: null },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(ws.statusCode, 201, ws.body);
    workspaceId = (ws.json() as { workspace: { id: string } }).workspace.id;
  });

  after(async () => {
    await entorno?.cerrar();
  });

  async function subir(
    quien: Credenciales,
    contenido: Buffer | string,
    opciones: { nombre?: string; tipo?: string; purpose?: string; ws?: string } = {},
  ) {
    const partes = [
      {
        nombre: 'file',
        contenido,
        nombreDeFichero: opciones.nombre ?? 'adjunto.txt',
        contentType: opciones.tipo ?? 'text/plain',
      },
      ...(opciones.purpose === undefined
        ? []
        : [{ nombre: 'purpose', contenido: opciones.purpose }]),
    ];
    const { payload, contentType } = construirMultipart(partes);
    return pedir(entorno, {
      method: 'POST',
      url: `/api/v1/workspaces/${opciones.ws ?? workspaceId}/files`,
      payload,
      headers: { 'content-type': contentType },
      cookies: quien.cookies,
      csrf: quien.csrf,
    });
  }

  it('sube un fichero y devuelve id, nombre, tipo, tamaño, checksum y propósito', async () => {
    const contenido = Buffer.from('contenido de prueba', 'utf8');
    const respuesta = await subir(duena, contenido, { nombre: 'informe.pdf', tipo: 'application/pdf' });
    assert.equal(respuesta.statusCode, 201, respuesta.body);

    const { file } = respuesta.json() as {
      file: {
        id: string;
        fileName: string;
        contentType: string;
        sizeBytes: number;
        checksumSha256: string;
        purpose: string;
      };
    };
    assert.match(file.id, /^[0-9a-f-]{36}$/u);
    assert.equal(file.fileName, 'informe.pdf');
    assert.equal(file.contentType, 'application/pdf');
    assert.equal(file.sizeBytes, contenido.length);
    assert.equal(file.checksumSha256, createHash('sha256').update(contenido).digest('hex'));
    assert.equal(file.purpose, 'form_field_file');
  });

  it('`purpose` acepta los dos valores del §2.2 y rechaza cualquier otro con 422', async () => {
    const binario = await subir(duena, 'x', { purpose: 'request_body_binary' });
    assert.equal(binario.statusCode, 201, binario.body);
    assert.equal((binario.json() as { file: { purpose: string } }).file.purpose, 'request_body_binary');

    const malo = await subir(duena, 'x', { purpose: 'user_avatar' });
    assert.equal(malo.statusCode, 422, malo.body);
  });

  it('413 por encima del límite, y NO 500 ni 201', async () => {
    const grande = Buffer.alloc(LIMITE + 1, 0x41);
    const respuesta = await subir(duena, grande);
    assert.equal(respuesta.statusCode, 413, respuesta.body);
  });

  it('EL NOMBRE DEL CLIENTE NO DECIDE LA RUTA: `storage_key` es generada y no sale nunca', async () => {
    const respuesta = await subir(duena, 'x', { nombre: '../../../../etc/passwd' });
    assert.equal(respuesta.statusCode, 201, respuesta.body);
    assert.ok(!respuesta.body.includes('storageKey'), respuesta.body);
    assert.ok(!respuesta.body.includes('storage_key'), respuesta.body);

    const id = (respuesta.json() as { file: { id: string } }).file.id;
    const fila = await entorno.prisma.file.findUnique({
      where: { id },
      select: { storageKey: true, originalFilename: true, isPublic: true, storage: true },
    });
    // El nombre original se conserva como METADATO, saneado…
    assert.equal(fila?.originalFilename, 'passwd');
    // …y la clave de almacenamiento no lo contiene en absoluto.
    assert.ok(fila?.storageKey.startsWith(`workspaces/${workspaceId}/`), fila?.storageKey);
    assert.ok(!fila!.storageKey.includes('passwd'), fila?.storageKey);
    assert.ok(!fila!.storageKey.includes('..'), fila?.storageKey);
    assert.equal(fila?.isPublic, false);
    assert.equal(fila?.storage, 'local_fs');
  });

  it('sin el campo «file», 422 con mensaje; con un Content-Type que no es multipart, 415', async () => {
    const { payload, contentType } = construirMultipart([{ nombre: 'otro', contenido: 'x' }]);
    const sinFichero = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/files`,
      payload,
      headers: { 'content-type': contentType },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(sinFichero.statusCode, 422, sinFichero.body);

    const comoJson = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/files`,
      payload: { file: 'hola' },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.ok(
      comoJson.statusCode === 415 || comoJson.statusCode === 400,
      `esperaba 415/400, llegó ${comoJson.statusCode}: ${comoJson.body}`,
    );
  });

  it('sin testigo CSRF no se sube nada', async () => {
    const { payload, contentType } = construirMultipart([
      { nombre: 'file', contenido: 'x', nombreDeFichero: 'a.txt' },
    ]);
    const respuesta = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/files`,
      payload,
      headers: { 'content-type': contentType },
      cookies: duena.cookies,
    });
    assert.equal(respuesta.statusCode, 403, respuesta.body);
  });

  it('UN AJENO recibe 403/404 al subir, al leer y al borrar — nunca un 200', async () => {
    const subida = await subir(duena, 'secreto del workspace');
    assert.equal(subida.statusCode, 201, subida.body);
    const id = (subida.json() as { file: { id: string } }).file.id;

    const subeAjena = await subir(ajena, 'x');
    assert.ok([403, 404].includes(subeAjena.statusCode), `${subeAjena.statusCode}: ${subeAjena.body}`);

    const leeAjena = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/files/${id}`,
      cookies: ajena.cookies,
    });
    assert.ok([403, 404].includes(leeAjena.statusCode), `${leeAjena.statusCode}: ${leeAjena.body}`);
    assert.ok(!leeAjena.body.includes('secreto'), leeAjena.body);

    const borraAjena = await pedir(entorno, {
      method: 'DELETE',
      url: `/api/v1/files/${id}`,
      cookies: ajena.cookies,
      csrf: ajena.csrf,
    });
    assert.ok([403, 404].includes(borraAjena.statusCode), borraAjena.body);
  });

  it('GET devuelve metadatos y NUNCA bytes; DELETE es lógico y luego da 404', async () => {
    const subida = await subir(duena, 'CONTENIDO-CENTINELA', { nombre: 'c.txt' });
    const id = (subida.json() as { file: { id: string } }).file.id;

    const lectura = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/files/${id}`,
      cookies: duena.cookies,
    });
    assert.equal(lectura.statusCode, 200, lectura.body);
    assert.ok(!lectura.body.includes('CONTENIDO-CENTINELA'), lectura.body);
    assert.ok(!lectura.body.includes('storageKey'), lectura.body);
    assert.equal((lectura.json() as { file: { fileName: string } }).file.fileName, 'c.txt');

    const borrado = await pedir(entorno, {
      method: 'DELETE',
      url: `/api/v1/files/${id}`,
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(borrado.statusCode, 204, borrado.body);

    const despues = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/files/${id}`,
      cookies: duena.cookies,
    });
    assert.equal(despues.statusCode, 404, despues.body);

    // Borrado LÓGICO: la fila sigue, con `deleted_at` puesto.
    const fila = await entorno.prisma.file.findUnique({
      where: { id },
      select: { deletedAt: true, purgedAt: true },
    });
    assert.notEqual(fila?.deletedAt, null);
    assert.notEqual(fila?.purgedAt, null);
  });

  it('un identificador que no es UUID da 404, no un error del motor', async () => {
    const respuesta = await pedir(entorno, {
      method: 'GET',
      url: '/api/v1/files/no-soy-un-uuid',
      cookies: duena.cookies,
    });
    assert.ok([400, 403, 404].includes(respuesta.statusCode), `${respuesta.statusCode}: ${respuesta.body}`);
    assert.ok(respuesta.statusCode !== 500, respuesta.body);
  });
});
