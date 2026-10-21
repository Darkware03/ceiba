import assert from 'node:assert/strict';
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

import { MODOS_DE_CUERPO, problemasDeFormaDelCuerpo } from '../src/modules/request/dto/request.dto.ts';
import {
  construirCuerpoParaElMotor,
  modoDelMotor,
  MAX_BYTES_DEL_CUERPO_SALIENTE,
} from '../src/modules/request/engine-body.ts';
import { construirCuerpo } from '../src/modules/request/request.repository.ts';
import {
  contrasenaDePrueba,
  marcaDeEjecucion,
  pedir,
  registrarYEntrar,
  type AppDePruebaPg,
  type Credenciales,
} from './helpers/app-de-prueba-postgres.ts';
import { analizarMultipart } from '../src/modules/file/multipart.ts';
import { construirMultipart, crearAppDeFicheros } from './ficheros-arnes.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * FASE 7 · §2.1 y §3.5 — CUERPO COMPLETO (P5) CONTRA PostgreSQL REAL.
 *
 * Lo que el §3.5 del BRIEF-FASE7 exige como mínimo, punto por punto:
 *   · crear multipart con un campo de texto y uno de fichero y releerlo;
 *   · `binary_file` sin `binary_file_id` → 422 y NO un 500 del CHECK;
 *   · el cURL de un multipart contiene `--form`;
 *   · el cURL de una cabecera secreta NO contiene el valor;
 *   · un ajeno recibe 403/404.
 * ════════════════════════════════════════════════════════════════════════════
 */

/** Si aparece en una salida, hay fuga. */
const CENTINELA = 'SENTINEL-c0ffee';

// ===========================================================================
// 1. Forma del cuerpo. Unitario puro sobre `ck_body_mode_shape`.
// ===========================================================================

describe('F7 · el DTO acepta los 10 modos y hace cumplir `ck_body_mode_shape`', () => {
  it('son exactamente los 10 valores del enum, contados', () => {
    assert.equal(MODOS_DE_CUERPO.length, 10);
    assert.deepEqual([...MODOS_DE_CUERPO].sort(), [
      'binary_file',
      'custom',
      'form_urlencoded',
      'graphql',
      'multipart_form_data',
      'none',
      'raw_html',
      'raw_json',
      'raw_text',
      'raw_xml',
    ]);
  });

  it('`binary_file` sin `binaryFileId` es un problema declarado, no un CHECK', () => {
    assert.deepEqual(problemasDeFormaDelCuerpo({ bodyType: 'binary_file' }), [
      'binaryFileId: obligatorio con bodyType=binary_file (ck_body_mode_shape)',
    ]);
    assert.deepEqual(
      problemasDeFormaDelCuerpo({ bodyType: 'binary_file', binaryFileId: 'x', body: 'hola' }),
      ['body: con bodyType=binary_file el contenido crudo debe ir vacío'],
    );
  });

  it('`body` con un modo de formulario es un problema (§2.1: «422, no un silencio»)', () => {
    assert.deepEqual(problemasDeFormaDelCuerpo({ bodyType: 'multipart_form_data', body: 'a=1' }), [
      'body: con bodyType=multipart_form_data el contenido va en bodyFields, no en body (ck_body_mode_shape)',
    ]);
  });

  it('`bodyFields` fuera de los modos de formulario, y `binaryFileId` fuera de `binary_file`', () => {
    assert.deepEqual(problemasDeFormaDelCuerpo({ bodyType: 'raw_json', bodyFields: [{}] }), [
      'bodyFields: sólo valen en form_urlencoded y multipart_form_data',
    ]);
    assert.deepEqual(problemasDeFormaDelCuerpo({ bodyType: 'raw_json', binaryFileId: 'x' }), [
      'binaryFileId: sólo vale con bodyType=binary_file, no con raw_json',
    ]);
  });

  it('`construirCuerpo` respeta el CHECK en los cuatro grupos de modos', () => {
    // raw_*: raw_content sí, binary_file_id no.
    const crudo = construirCuerpo('raw_json', '{"a":1}');
    assert.equal(crudo?.rawContent, '{"a":1}');
    assert.equal(crudo?.binaryFileId, null);

    // binary_file: raw_content NULL, binary_file_id NOT NULL.
    const binario = construirCuerpo('binary_file', null, { binaryFileId: 'f-1' });
    assert.equal(binario?.rawContent, null);
    assert.equal(binario?.binaryFileId, 'f-1');
    // Sin fichero no se construye fila.
    assert.equal(construirCuerpo('binary_file', null), null);

    // formulario: los dos NULL, contenido en campos, con el XOR respetado.
    const multi = construirCuerpo('multipart_form_data', null, {
      campos: [
        { key: 'titulo', kind: 'text', value: 'hola' },
        { key: 'adjunto', kind: 'file', fileId: 'f-2', contentType: 'application/pdf' },
      ],
    });
    assert.equal(multi?.rawContent, null);
    assert.equal(multi?.binaryFileId, null);
    const campos = multi?.requestBodyFields?.create ?? [];
    assert.deepEqual(
      campos.map((c) => [c.fieldName, c.fieldValue, c.fileId]),
      [
        ['titulo', 'hola', null],
        ['adjunto', null, 'f-2'],
      ],
    );
    // `ck_bodyfield_xor`: como mucho UNA fuente de valor por fila.
    for (const c of campos) {
      const fuentes = [c.fieldValue, c.fileId].filter((v) => v !== null).length;
      assert.ok(fuentes <= 1, JSON.stringify(c));
    }

    // custom: los dos NULL.
    const custom = construirCuerpo('custom', null, { contentType: 'application/x-raro' });
    assert.equal(custom?.rawContent, null);
    assert.equal(custom?.binaryFileId, null);
    assert.equal(custom?.contentType, 'application/x-raro');

    // `form_urlencoded` no puede llevar ficheros: se descartan.
    const urlenc = construirCuerpo('form_urlencoded', null, {
      campos: [{ key: 'f', kind: 'file', fileId: 'f-3' }],
    });
    assert.deepEqual(urlenc?.requestBodyFields?.create ?? [], []);
  });

  it('la firma de la fase 6 sigue valiendo igual', () => {
    const cuerpo = construirCuerpo('form_urlencoded', 'a=1&b=dos');
    assert.equal(cuerpo?.rawContent, null);
    assert.deepEqual(
      cuerpo?.requestBodyFields?.create.map((c) => [c.fieldName, c.fieldValue]),
      [
        ['a', '1'],
        ['b', 'dos'],
      ],
    );
    assert.equal(construirCuerpo('none', null), null);
  });
});

// ===========================================================================
// 2. Integración contra PostgreSQL real.
// ===========================================================================

describe('F7 · §2.1 cuerpo completo contra PostgreSQL real', () => {
  let entorno: AppDePruebaPg;
  let duena: Credenciales;
  let ajena: Credenciales;
  let workspaceId: string;
  let coleccionId: string;
  let ficheroId: string;
  let ficheroBinarioId: string;
  let ficheroAjenoId: string;

  before(async () => {
    entorno = await crearAppDeFicheros({
      CEIBA_FILE_STORAGE_DIR: mkdtempSync(join(tmpdir(), 'ceiba-cuerpo-')),
    });
    const marca = marcaDeEjecucion();
    const clave = contrasenaDePrueba(marca);
    duena = await registrarYEntrar(entorno, `cdue-${marca}@ceiba.test`, clave, 'Dueña');
    ajena = await registrarYEntrar(entorno, `caje-${marca}@ceiba.test`, clave, 'Ajena');

    workspaceId = await crearWorkspace(duena, `f7c-${marca}`);
    coleccionId = await crearColeccion(duena, workspaceId, `colc-${marca}`);

    ficheroId = await subirFichero(duena, workspaceId, 'informe.pdf', 'application/pdf');
    ficheroBinarioId = await subirFichero(duena, workspaceId, 'carga.bin', 'application/octet-stream');

    const wsAjeno = await crearWorkspace(ajena, `f7x-${marca}`);
    ficheroAjenoId = await subirFichero(ajena, wsAjeno, 'ajeno.pdf', 'application/pdf');
  });

  after(async () => {
    await entorno?.cerrar();
  });

  async function crearWorkspace(quien: Credenciales, slug: string): Promise<string> {
    const ws = await pedir(entorno, {
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { slug, name: `WS ${slug}`, description: null },
      cookies: quien.cookies,
      csrf: quien.csrf,
    });
    assert.equal(ws.statusCode, 201, ws.body);
    return (ws.json() as { workspace: { id: string } }).workspace.id;
  }

  async function crearColeccion(quien: Credenciales, ws: string, slug: string): Promise<string> {
    const col = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/workspaces/${ws}/collections`,
      payload: { slug, name: `Colección ${slug}`, description: null },
      cookies: quien.cookies,
      csrf: quien.csrf,
    });
    assert.equal(col.statusCode, 201, col.body);
    return (col.json() as { coleccion: { id: string } }).coleccion.id;
  }

  async function subirFichero(
    quien: Credenciales,
    ws: string,
    nombre: string,
    tipo: string,
  ): Promise<string> {
    const { payload, contentType } = construirMultipart([
      { nombre: 'file', contenido: `bytes de ${nombre}`, nombreDeFichero: nombre, contentType: tipo },
    ]);
    const respuesta = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/workspaces/${ws}/files`,
      payload,
      headers: { 'content-type': contentType },
      cookies: quien.cookies,
      csrf: quien.csrf,
    });
    assert.equal(respuesta.statusCode, 201, respuesta.body);
    return (respuesta.json() as { file: { id: string } }).file.id;
  }

  async function crearPeticion(payload: Record<string, unknown>) {
    return pedir(entorno, {
      method: 'POST',
      url: `/api/v1/collections/${coleccionId}/requests`,
      payload,
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
  }

  // -------------------------------------------------------------------------

  it('§3.5 · crea multipart con un campo de texto y uno de fichero, y lo relee', async () => {
    const creada = await crearPeticion({
      name: 'Subir informe',
      method: 'POST',
      url: '{{base_url}}/v1/informes',
      bodyType: 'multipart_form_data',
      bodyFields: [
        { key: 'titulo', kind: 'text', value: 'hola', enabled: true },
        {
          key: 'adjunto',
          kind: 'file',
          fileId: ficheroId,
          contentType: 'application/pdf',
          enabled: true,
        },
      ],
    });
    assert.equal(creada.statusCode, 201, creada.body);
    const id = (creada.json() as { request: { id: string } }).request.id;

    const leida = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/requests/${id}`,
      cookies: duena.cookies,
    });
    assert.equal(leida.statusCode, 200, leida.body);
    const detalle = (leida.json() as { request: Record<string, unknown> }).request;

    assert.equal(detalle['bodyType'], 'multipart_form_data');
    const campos = detalle['bodyFields'] as Array<Record<string, unknown>>;
    assert.equal(campos.length, 2);
    assert.deepEqual(
      campos.map((c) => [c['key'], c['kind'], c['value']]),
      [
        ['titulo', 'text', 'hola'],
        ['adjunto', 'file', null],
      ],
    );
    assert.equal(campos[1]?.['fileId'], ficheroId);
    // Metadatos del adjunto, NUNCA bytes.
    assert.deepEqual(campos[1]?.['fileInfo'], {
      id: ficheroId,
      fileName: 'informe.pdf',
      contentType: 'application/pdf',
      sizeBytes: 'bytes de informe.pdf'.length,
    });
    assert.ok(!leida.body.includes('storageKey'), leida.body);
  });

  it('§3.5 · `binary_file` sin `binary_file_id` → 422, y NO un 500 del CHECK', async () => {
    const sinFichero = await crearPeticion({
      name: 'Binario sin fichero',
      method: 'PUT',
      url: 'https://api.example.com/subir',
      bodyType: 'binary_file',
    });
    // 422 exacto: si el CHECK hubiera reventado, esto sería un 500 y el
    // `assert.equal` lo diría con el cuerpo literal del error.
    assert.equal(sinFichero.statusCode, 422, sinFichero.body);
    // El 422 dice QUÉ falta, sin publicar el nombre de la restricción al azar.
    assert.ok(sinFichero.body.includes('binaryFileId'), sinFichero.body);
  });

  it('`binary_file` CON fichero se guarda y se relee con sus metadatos', async () => {
    const creada = await crearPeticion({
      name: 'Subida binaria',
      method: 'PUT',
      url: 'https://api.example.com/subir',
      bodyType: 'binary_file',
      binaryFileId: ficheroBinarioId,
      bodyContentType: 'application/octet-stream',
    });
    assert.equal(creada.statusCode, 201, creada.body);
    const detalle = (creada.json() as { request: Record<string, unknown> }).request;
    assert.equal(detalle['bodyType'], 'binary_file');
    assert.equal(detalle['binaryFileId'], ficheroBinarioId);
    assert.deepEqual(detalle['binaryFile'], {
      id: ficheroBinarioId,
      fileName: 'carga.bin',
      contentType: 'application/octet-stream',
      sizeBytes: 'bytes de carga.bin'.length,
    });
    assert.equal(detalle['bodyContentType'], 'application/octet-stream');
  });

  it('`custom` ya se puede crear (en la fase 6 era 422) y respeta el CHECK', async () => {
    const creada = await crearPeticion({
      name: 'Modo custom',
      method: 'POST',
      url: 'https://api.example.com/raro',
      bodyType: 'custom',
      bodyContentType: 'application/x-propietario',
    });
    assert.equal(creada.statusCode, 201, creada.body);
    const detalle = (creada.json() as { request: Record<string, unknown> }).request;
    assert.equal(detalle['bodyType'], 'custom');
    assert.equal(detalle['bodyContentType'], 'application/x-propietario');
    assert.equal(detalle['body'], null);
  });

  it('§2.1 · enviar `body` con un `bodyType` de formulario es 422, no un silencio', async () => {
    const respuesta = await crearPeticion({
      name: 'Formulario con body crudo',
      method: 'POST',
      url: 'https://api.example.com/x',
      bodyType: 'multipart_form_data',
      body: 'a=1&b=2',
    });
    assert.equal(respuesta.statusCode, 422, respuesta.body);
  });

  it('`kind: file` sin `fileId`, y `kind: text` con `fileId`, son 422 (ck_bodyfield_xor)', async () => {
    const sinId = await crearPeticion({
      name: 'Campo fichero sin id',
      method: 'POST',
      url: 'https://api.example.com/x',
      bodyType: 'multipart_form_data',
      bodyFields: [{ key: 'f', kind: 'file' }],
    });
    assert.equal(sinId.statusCode, 422, sinId.body);

    const ambos = await crearPeticion({
      name: 'Campo con los dos',
      method: 'POST',
      url: 'https://api.example.com/x',
      bodyType: 'multipart_form_data',
      bodyFields: [{ key: 'f', kind: 'file', fileId: ficheroId, value: 'texto' }],
    });
    assert.equal(ambos.statusCode, 422, ambos.body);
  });

  it('UN FICHERO DE OTRO WORKSPACE es 422, no una clave ajena ni un 500', async () => {
    const campo = await crearPeticion({
      name: 'Adjunto robado',
      method: 'POST',
      url: 'https://api.example.com/x',
      bodyType: 'multipart_form_data',
      bodyFields: [{ key: 'f', kind: 'file', fileId: ficheroAjenoId }],
    });
    assert.equal(campo.statusCode, 422, campo.body);
    assert.ok(campo.body.includes('workspace'), campo.body);

    const binario = await crearPeticion({
      name: 'Binario robado',
      method: 'PUT',
      url: 'https://api.example.com/x',
      bodyType: 'binary_file',
      binaryFileId: ficheroAjenoId,
    });
    assert.equal(binario.statusCode, 422, binario.body);
  });

  it('el PATCH cambia los campos sin perder el modo y sin romper el CHECK al cambiarlo', async () => {
    const creada = await crearPeticion({
      name: 'Formulario editable',
      method: 'POST',
      url: 'https://api.example.com/x',
      bodyType: 'multipart_form_data',
      bodyFields: [{ key: 'a', kind: 'text', value: '1' }],
    });
    const id = (creada.json() as { request: { id: string } }).request.id;

    const parche = await pedir(entorno, {
      method: 'PATCH',
      url: `/api/v1/requests/${id}`,
      payload: {
        bodyFields: [
          { key: 'a', kind: 'text', value: '2' },
          { key: 'b', kind: 'file', fileId: ficheroId },
        ],
      },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(parche.statusCode, 200, parche.body);
    const campos = (parche.json() as { request: { bodyFields: Array<Record<string, unknown>> } })
      .request.bodyFields;
    assert.deepEqual(
      campos.map((c) => [c['key'], c['value'], c['fileId']]),
      [
        ['a', '2', null],
        ['b', null, ficheroId],
      ],
    );

    // Cambiar a un modo crudo limpia los campos y escribe `raw_content`, sin
    // violar `ck_body_mode_shape`.
    const aCrudo = await pedir(entorno, {
      method: 'PATCH',
      url: `/api/v1/requests/${id}`,
      payload: { bodyType: 'raw_json', body: '{"x":1}' },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(aCrudo.statusCode, 200, aCrudo.body);
    const detalle = (aCrudo.json() as { request: Record<string, unknown> }).request;
    assert.equal(detalle['bodyType'], 'raw_json');
    assert.equal(detalle['body'], '{"x":1}');
    assert.deepEqual(detalle['bodyFields'], []);

    // Y volver a `binary_file` sin fichero sigue siendo 422 contra el estado final.
    const aBinario = await pedir(entorno, {
      method: 'PATCH',
      url: `/api/v1/requests/${id}`,
      payload: { bodyType: 'binary_file' },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(aBinario.statusCode, 422, aBinario.body);
  });

  it('un PATCH que sólo trae `bodyFields` sobre una fila cruda es 422 contra el ESTADO FINAL', async () => {
    const creada = await crearPeticion({
      name: 'Cruda',
      method: 'POST',
      url: 'https://api.example.com/x',
      bodyType: 'raw_json',
      body: '{"a":1}',
    });
    const id = (creada.json() as { request: { id: string } }).request.id;

    const parche = await pedir(entorno, {
      method: 'PATCH',
      url: `/api/v1/requests/${id}`,
      payload: { bodyFields: [{ key: 'a', kind: 'text', value: '1' }] },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(parche.statusCode, 422, parche.body);
  });

  it('duplicar una petición multipart conserva los campos y REFERENCIA el mismo fichero', async () => {
    const creada = await crearPeticion({
      name: 'Para duplicar',
      method: 'POST',
      url: 'https://api.example.com/x',
      bodyType: 'multipart_form_data',
      bodyFields: [
        { key: 'txt', kind: 'text', value: 'v' },
        { key: 'doc', kind: 'file', fileId: ficheroId },
      ],
    });
    const id = (creada.json() as { request: { id: string } }).request.id;

    const copia = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/requests/${id}/duplicate`,
      payload: {},
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(copia.statusCode, 201, copia.body);
    const campos = (copia.json() as { request: { bodyFields: Array<Record<string, unknown>> } })
      .request.bodyFields;
    assert.deepEqual(
      campos.map((c) => [c['key'], c['fileId']]),
      [
        ['txt', null],
        ['doc', ficheroId],
      ],
    );
  });

  it('§3.5 · el cURL de un multipart contiene `--form`', async () => {
    const creada = await crearPeticion({
      name: 'Multipart para cURL',
      method: 'POST',
      url: '{{base_url}}/v1/informes',
      bodyType: 'multipart_form_data',
      bodyFields: [
        { key: 'titulo', kind: 'text', value: 'hola' },
        { key: 'adjunto', kind: 'file', fileId: ficheroId, contentType: 'application/pdf' },
      ],
    });
    const id = (creada.json() as { request: { id: string } }).request.id;

    const exportado = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/requests/${id}/curl`,
      cookies: duena.cookies,
    });
    assert.equal(exportado.statusCode, 200, exportado.body);
    const { curl, advertencias } = exportado.json() as {
      curl: string;
      advertencias: string[];
    };
    assert.ok(curl.includes('--form'), curl);
    assert.ok(curl.includes("--form-string 'titulo=hola'"), curl);
    assert.ok(curl.includes("--form 'adjunto=@./informe.pdf;type=application/pdf'"), curl);
    assert.ok(curl.includes('{{base_url}}'), curl); // regla 2
    assert.ok(
      advertencias.some((a) => a.includes('GUARDADO EN EL SERVIDOR')),
      JSON.stringify(advertencias),
    );
    process.stderr.write(`\n[cURL MULTIPART]\n${curl}\n`);
  });

  it('el cURL de un `binary_file` contiene `--data-binary @fichero`', async () => {
    const creada = await crearPeticion({
      name: 'Binario para cURL',
      method: 'PUT',
      url: 'https://api.example.com/subir',
      bodyType: 'binary_file',
      binaryFileId: ficheroBinarioId,
    });
    const id = (creada.json() as { request: { id: string } }).request.id;

    const exportado = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/requests/${id}/curl`,
      cookies: duena.cookies,
    });
    const { curl } = exportado.json() as { curl: string };
    assert.ok(curl.includes("--data-binary '@./carga.bin'"), curl);
    process.stderr.write(`\n[cURL BINARIO]\n${curl}\n`);
  });

  it('§3.5 · el cURL de una cabecera de credencial NO contiene el valor (C-LEAK-05)', async () => {
    const creada = await crearPeticion({
      name: 'Con credencial',
      method: 'POST',
      url: 'https://api.example.com/x',
      headers: [
        { key: 'Authorization', value: `Bearer ${CENTINELA}`, enabled: true },
        { key: 'X-Api-Key', value: CENTINELA, enabled: true },
        { key: 'Accept', value: 'application/json', enabled: true },
      ],
      bodyType: 'multipart_form_data',
      bodyFields: [{ key: 'campo', kind: 'text', value: 'inocuo' }],
    });
    const id = (creada.json() as { request: { id: string } }).request.id;

    const exportado = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/requests/${id}/curl`,
      cookies: duena.cookies,
    });
    const { curl, advertencias } = exportado.json() as { curl: string; advertencias: string[] };
    assert.ok(!curl.includes(CENTINELA), curl);
    assert.ok(curl.includes('$CEIBA_SECRETO_AUTHORIZATION'), curl);
    assert.ok(curl.includes('$CEIBA_SECRETO_X_API_KEY'), curl);
    // Una cabecera normal sí sale literal: no se enmascara todo a ciegas.
    assert.ok(curl.includes("'Accept: application/json'"), curl);
    assert.ok(advertencias.length > 0, JSON.stringify(advertencias));
    // Y el centinela tampoco se cuela en las advertencias.
    assert.ok(!JSON.stringify(advertencias).includes(CENTINELA), JSON.stringify(advertencias));
  });

  it('§3.5 · un ajeno recibe 403/404 al leer, modificar y exportar — nunca un 200', async () => {
    const creada = await crearPeticion({
      name: 'Privada',
      method: 'POST',
      url: 'https://api.example.com/x',
      bodyType: 'multipart_form_data',
      bodyFields: [{ key: 'secreta', kind: 'text', value: CENTINELA }],
    });
    const id = (creada.json() as { request: { id: string } }).request.id;

    for (const caso of [
      { method: 'GET' as const, url: `/api/v1/requests/${id}` },
      { method: 'GET' as const, url: `/api/v1/requests/${id}/curl` },
    ]) {
      const respuesta = await pedir(entorno, { ...caso, cookies: ajena.cookies });
      assert.ok(
        [403, 404].includes(respuesta.statusCode),
        `${caso.url} → ${respuesta.statusCode}: ${respuesta.body}`,
      );
      assert.ok(!respuesta.body.includes(CENTINELA), respuesta.body);
    }

    const parche = await pedir(entorno, {
      method: 'PATCH',
      url: `/api/v1/requests/${id}`,
      payload: { bodyFields: [] },
      cookies: ajena.cookies,
      csrf: ajena.csrf,
    });
    assert.ok([403, 404].includes(parche.statusCode), parche.body);
  });

  it('un fichero adjunto a una petición viva NO se puede borrar (409), y sí cuando deja de estarlo', async () => {
    const otroFichero = await subirFichero(duena, workspaceId, 'temporal.txt', 'text/plain');
    const creada = await crearPeticion({
      name: 'Con adjunto temporal',
      method: 'POST',
      url: 'https://api.example.com/x',
      bodyType: 'multipart_form_data',
      bodyFields: [{ key: 'f', kind: 'file', fileId: otroFichero }],
    });
    const id = (creada.json() as { request: { id: string } }).request.id;

    const conflicto = await pedir(entorno, {
      method: 'DELETE',
      url: `/api/v1/files/${otroFichero}`,
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(conflicto.statusCode, 409, conflicto.body);

    await pedir(entorno, {
      method: 'DELETE',
      url: `/api/v1/requests/${id}`,
      cookies: duena.cookies,
      csrf: duena.csrf,
    });

    const ahoraSi = await pedir(entorno, {
      method: 'DELETE',
      url: `/api/v1/files/${otroFichero}`,
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(ahoraSi.statusCode, 204, ahoraSi.body);
  });
});

// ===========================================================================
// 3. El adaptador al MOTOR (§3.A.4). Unitario puro.
// ===========================================================================

describe('F7 · §3.A.4 el cuerpo que se le manda al motor', () => {
  const lector = async (id: string) =>
    id === 'ausente'
      ? null
      : { base64: Buffer.from(`bytes-${id}`).toString('base64'), fileName: `${id}.pdf`, contentType: 'application/pdf' };

  function entrada(parcial: Partial<Parameters<typeof construirCuerpoParaElMotor>[0]> = {}) {
    return {
      bodyMode: 'none',
      rawContent: null,
      contentType: null,
      binaryFileId: null,
      campos: [],
      ...parcial,
    };
  }

  it('traduce los 10 modos a los 7 del motor sin inventar ninguno', () => {
    assert.deepEqual(
      MODOS_DE_CUERPO.map((m) => [m, modoDelMotor(m)]),
      [
        ['none', 'none'],
        ['raw_json', 'json'],
        ['raw_text', 'raw'],
        ['raw_xml', 'raw'],
        ['raw_html', 'raw'],
        ['graphql', 'graphql'],
        ['form_urlencoded', 'urlencoded'],
        ['multipart_form_data', 'form'],
        ['binary_file', 'binary'],
        ['custom', 'raw'],
      ],
    );
  });

  it('multipart: emite `parts` con el texto y con los BYTES del fichero en base64', async () => {
    const { body, camposSecretosOmitidos, ficherosNoDisponibles } = await construirCuerpoParaElMotor(
      entrada({
        bodyMode: 'multipart_form_data',
        campos: [
          { fieldName: 'titulo', fieldValue: 'hola', fileId: null, contentType: null, isSecret: false, isEnabled: true },
          { fieldName: 'doc', fieldValue: null, fileId: 'f1', contentType: null, isSecret: false, isEnabled: true },
          { fieldName: 'off', fieldValue: 'no', fileId: null, contentType: null, isSecret: false, isEnabled: false },
        ],
      }),
      lector,
    );
    assert.equal(body?.mode, 'form');
    assert.deepEqual(body?.parts, [
      { name: 'titulo', type: 'text', value: 'hola' },
      {
        name: 'doc',
        type: 'file',
        content: Buffer.from('bytes-f1').toString('base64'),
        filename: 'f1.pdf',
        contentType: 'application/pdf',
      },
    ]);
    assert.deepEqual(camposSecretosOmitidos, []);
    assert.deepEqual(ficherosNoDisponibles, []);
  });

  it('un campo SECRETO no se materializa: sale listado para que lo resuelva quien ejecuta', async () => {
    const { body, camposSecretosOmitidos } = await construirCuerpoParaElMotor(
      entrada({
        bodyMode: 'multipart_form_data',
        campos: [
          { fieldName: 'token', fieldValue: null, fileId: null, contentType: null, isSecret: true, isEnabled: true },
        ],
      }),
      lector,
    );
    assert.deepEqual(body?.parts, []);
    assert.deepEqual(camposSecretosOmitidos, ['token']);
  });

  it('un fichero que ya no está se declara, no se envía un cuerpo truncado en silencio', async () => {
    const { body, ficherosNoDisponibles } = await construirCuerpoParaElMotor(
      entrada({ bodyMode: 'binary_file', binaryFileId: 'ausente' }),
      lector,
    );
    assert.equal(body, null);
    assert.deepEqual(ficherosNoDisponibles, ['ausente']);
  });

  it('binary: el motor recibe los bytes en base64 por `raw`, que es lo que su contrato dice', async () => {
    const { body } = await construirCuerpoParaElMotor(
      entrada({ bodyMode: 'binary_file', binaryFileId: 'f9' }),
      lector,
    );
    assert.equal(body?.mode, 'binary');
    assert.equal(Buffer.from(body?.raw ?? '', 'base64').toString('utf8'), 'bytes-f9');
  });

  it('urlencoded se serializa a texto, que es lo que el motor espera en `raw`', async () => {
    const { body } = await construirCuerpoParaElMotor(
      entrada({
        bodyMode: 'form_urlencoded',
        campos: [
          { fieldName: 'a', fieldValue: '1', fileId: null, contentType: null, isSecret: false, isEnabled: true },
          { fieldName: 'b', fieldValue: 'dos & medio', fileId: null, contentType: null, isSecret: false, isEnabled: true },
        ],
      }),
      lector,
    );
    assert.equal(body?.mode, 'urlencoded');
    assert.equal(body?.raw, 'a=1&b=dos+%26+medio');
  });

  it('INTEGRACIÓN REAL con el motor: lo que emite la API lo serializa `buildBody` sin tocar nada', async () => {
    const { body } = await construirCuerpoParaElMotor(
      entrada({
        bodyMode: 'multipart_form_data',
        campos: [
          { fieldName: 'titulo', fieldValue: 'hola', fileId: null, contentType: null, isSecret: false, isEnabled: true },
          { fieldName: 'doc', fieldValue: null, fileId: 'f1', contentType: null, isSecret: false, isEnabled: true },
        ],
      }),
      lector,
    );
    // El motor DE VERDAD, cargado desde `apps/engine/src`. El especificador es
    // una variable a propósito: con un literal, `tsc` intentaría compilar
    // `apps/engine` dentro del `rootDir` de `apps/api` y fallaría con TS6059.
    // Node 24 importa `.ts` directamente, que es como corre el propio motor.
    const ruta = new URL('../../../engine/src/http/build-body.ts', import.meta.url).href;
    const motor = (await import(ruta)) as {
      buildBody: (b: unknown) => { buffer: Buffer | null; contentType: string | null };
    };
    const construido = motor.buildBody(body);
    const texto = construido.buffer?.toString('utf8') ?? '';
    assert.match(construido.contentType ?? '', /^multipart\/form-data; boundary=ceiba[0-9a-f]{32}$/u);
    assert.ok(texto.includes('Content-Disposition: form-data; name="titulo"'), texto);
    assert.ok(texto.includes('Content-Disposition: form-data; name="doc"; filename="f1.pdf"'), texto);
    assert.ok(texto.includes('Content-Type: application/pdf'), texto);
    assert.ok(texto.includes('bytes-f1'), texto);
    assert.ok(texto.includes('hola'), texto);
  });
});

// ===========================================================================
// 4. Tope de memoria del cuerpo saliente (hallazgo de la revisión del motor).
// ===========================================================================

describe('F7 · el cuerpo saliente hacia el motor está acotado en memoria', () => {
  /** Un MiB de bytes por fichero, que en base64 son ~1,33 MiB. */
  const lectorGrande = async (id: string) => ({
    base64: Buffer.alloc(1024 * 1024, 0x41).toString('base64'),
    fileName: `${id}.bin`,
    contentType: 'application/octet-stream',
  });

  it('el límite por defecto existe y es de 25 MiB', () => {
    assert.equal(MAX_BYTES_DEL_CUERPO_SALIENTE, 25 * 1024 * 1024);
  });

  it('200 adjuntos NO se leen enteros: se corta en cuanto se pasa el tope', async () => {
    let lecturas = 0;
    const contador = async (id: string) => {
      lecturas += 1;
      return lectorGrande(id);
    };
    const campos = Array.from({ length: 200 }, (_, i) => ({
      fieldName: `f${i}`,
      fieldValue: null,
      fileId: `file-${i}`,
      contentType: null,
      isSecret: false,
      isEnabled: true,
    }));

    const resultado = await construirCuerpoParaElMotor(
      {
        bodyMode: 'multipart_form_data',
        rawContent: null,
        contentType: null,
        binaryFileId: null,
        campos,
      },
      contador,
      { maxBytesTotales: 4 * 1024 * 1024 },
    );

    assert.equal(resultado.limiteDeBytesSuperado, true);
    // NUNCA un cuerpo a medias: o entero o nada.
    assert.equal(resultado.body, null);
    // Lo que de verdad se protege: no se leyeron los 200 ficheros.
    assert.ok(lecturas <= 4, `se leyeron ${lecturas} ficheros antes de cortar`);
  });

  it('un binario por encima del tope tampoco pasa, y lo declara', async () => {
    const resultado = await construirCuerpoParaElMotor(
      {
        bodyMode: 'binary_file',
        rawContent: null,
        contentType: null,
        binaryFileId: 'grande',
        campos: [],
      },
      lectorGrande,
      { maxBytesTotales: 1024 },
    );
    assert.equal(resultado.limiteDeBytesSuperado, true);
    assert.equal(resultado.body, null);
  });

  it('por debajo del tope todo pasa y `limiteDeBytesSuperado` es false', async () => {
    const resultado = await construirCuerpoParaElMotor(
      {
        bodyMode: 'multipart_form_data',
        rawContent: null,
        contentType: null,
        binaryFileId: null,
        campos: [
          { fieldName: 'f', fieldValue: null, fileId: 'uno', contentType: null, isSecret: false, isEnabled: true },
        ],
      },
      lectorGrande,
    );
    assert.equal(resultado.limiteDeBytesSuperado, false);
    assert.equal(resultado.body?.parts?.length, 1);
  });
});

// ===========================================================================
// 5. IDA Y VUELTA: lo que serializa el MOTOR lo reparsea el lector de la API.
// ===========================================================================

describe('F7 · ida y vuelta motor → lector de multipart de la API', () => {
  /**
   * La revisión del motor dejó declarado que faltaba «una prueba de extremo a
   * extremo con un parser multipart real», y que añadir uno allí sería una
   * dependencia nueva que `architecture.test.ts` prohíbe.
   *
   * No hace falta ninguna dependencia: **la API ya tiene un lector de
   * multipart real**, el de `modules/file/multipart.ts`, escrito para la
   * subida de ficheros. Esta prueba cierra el círculo enfrentando los dos
   * lados, que además se escribieron por separado:
   *
   *     API (adaptador) → MOTOR (buildBody) → API (analizarMultipart)
   *
   * Si el emisor y el receptor discrepan en el escapado, el boundary o los
   * bytes, esto lo dice aquí y no en una integración con un tercero.
   */
  async function serializarConElMotor(body: unknown) {
    const ruta = new URL('../../../engine/src/http/build-body.ts', import.meta.url).href;
    const motor = (await import(ruta)) as {
      buildBody: (b: unknown) => { buffer: Buffer | null; contentType: string | null };
    };
    return motor.buildBody(body);
  }

  it('un multipart con texto y fichero sobrevive intacto a la ida y la vuelta', async () => {
    const bytesOriginales = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x0d, 0x0a, 0xfe]);
    const { body } = await construirCuerpoParaElMotor(
      {
        bodyMode: 'multipart_form_data',
        rawContent: null,
        contentType: null,
        binaryFileId: null,
        campos: [
          { fieldName: 'titulo', fieldValue: 'informe año', fileId: null, contentType: null, isSecret: false, isEnabled: true },
          { fieldName: 'adjunto', fieldValue: null, fileId: 'doc', contentType: null, isSecret: false, isEnabled: true },
        ],
      },
      async () => ({
        base64: bytesOriginales.toString('base64'),
        fileName: 'facturación año.pdf',
        contentType: 'application/pdf',
      }),
    );

    const construido = await serializarConElMotor(body);
    const partes = analizarMultipart(construido.buffer as Buffer, construido.contentType ?? undefined);

    assert.equal(partes.length, 2);
    assert.equal(partes[0]?.nombre, 'titulo');
    assert.equal(partes[0]?.contenido.toString('utf8'), 'informe año');
    assert.equal(partes[1]?.nombre, 'adjunto');
    assert.equal(partes[1]?.nombreDeFichero, 'facturación año.pdf');
    assert.equal(partes[1]?.contentType, 'application/pdf');
    // Los BYTES, no una representación de ellos.
    assert.deepEqual(partes[1]?.contenido, bytesOriginales);
  });

  it('un nombre de fichero con comillas y barras no desincroniza a los dos lados', async () => {
    const { body } = await construirCuerpoParaElMotor(
      {
        bodyMode: 'multipart_form_data',
        rawContent: null,
        contentType: null,
        binaryFileId: null,
        campos: [
          { fieldName: 'f', fieldValue: null, fileId: 'x', contentType: null, isSecret: false, isEnabled: true },
        ],
      },
      async () => ({
        base64: Buffer.from('contenido').toString('base64'),
        fileName: 'fac"tura"\\rara.pdf',
        contentType: 'application/pdf',
      }),
    );

    const construido = await serializarConElMotor(body);
    const partes = analizarMultipart(construido.buffer as Buffer, construido.contentType ?? undefined);

    // El motor hace percent-encoding de `"` y `\`; el lector lo recibe sin que
    // la cabecera se parta y sin tragarse la comilla de cierre. Lo que importa
    // es que SIGUE HABIENDO UNA SOLA PARTE y que el contenido llega entero.
    assert.equal(partes.length, 1);
    assert.equal(partes[0]?.nombre, 'f');
    assert.equal(partes[0]?.contenido.toString('utf8'), 'contenido');
    assert.ok(partes[0]?.nombreDeFichero !== null);
    // Y el escapado es reversible, que es justo lo que el v1 del motor rompía
    // al BORRAR los caracteres en vez de escaparlos.
    assert.equal(decodeURIComponent(partes[0]?.nombreDeFichero ?? ''), 'fac"tura"\\rara.pdf');
  });

  it('un contenido que incluye el delimitador NO parte el cuerpo en el receptor', async () => {
    // El motor elige un boundary que no aparezca en ninguna parte. Aquí se
    // comprueba desde el otro lado: el receptor ve UNA parte, no dos.
    const { body } = await construirCuerpoParaElMotor(
      {
        bodyMode: 'multipart_form_data',
        rawContent: null,
        contentType: null,
        binaryFileId: null,
        campos: [
          { fieldName: 'trampa', fieldValue: '\r\n--ceiba0000\r\nContent-Disposition: form-data; name="colado"\r\n\r\nmalo\r\n', fileId: null, contentType: null, isSecret: false, isEnabled: true },
        ],
      },
      async () => null,
    );

    const construido = await serializarConElMotor(body);
    const partes = analizarMultipart(construido.buffer as Buffer, construido.contentType ?? undefined);
    assert.equal(partes.length, 1);
    assert.equal(partes[0]?.nombre, 'trampa');
    assert.ok(!partes.some((p) => p.nombre === 'colado'));
  });
});
