/**
 * Cuerpo `multipart/form-data` con ficheros (RFC 7578).
 *
 * El motor es SIN ESTADO (ADR-0002): los bytes del fichero llegan inline en
 * `parts[].content` codificados en base64. Una referencia opaca `fileRef` no
 * es resoluble aquí y debe fallar con un error claro — eso no es un hueco,
 * es la frontera del componente.
 *
 * Unitarias puras: ni red ni disco.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBody } from '../src/http/build-body.ts';
import { executeRequestSchema } from '../src/contract/engine-contract.ts';
import { EngineRequestError } from '../src/net/errors.ts';

type Parte = NonNullable<Parameters<typeof buildBody>[0]>['parts'];

function form(parts: Parte): ReturnType<typeof buildBody> {
  return buildBody({ mode: 'form', parts });
}

/** Saca el boundary de la cabecera y comprueba su forma. */
function boundaryDe(contentType: string | null): string {
  assert.ok(contentType !== null, 'el motor debe declarar Content-Type');
  const m = /^multipart\/form-data; boundary=(ceiba[0-9a-f]{32})$/.exec(contentType);
  assert.ok(m, `Content-Type inesperado: ${contentType}`);
  return m[1] as string;
}

/** Trocea el cuerpo en partes crudas, sin delimitadores ni CRLF de cierre. */
function trocear(cuerpo: Buffer, boundary: string): Buffer[] {
  const delim = Buffer.from(`--${boundary}`, 'utf8');
  assert.equal(cuerpo.indexOf(delim), 0, 'el cuerpo debe empezar por el delimitador');
  const trozos: Buffer[] = [];
  let i = 0;
  for (;;) {
    const inicio = i + delim.length;
    if (cuerpo.subarray(inicio, inicio + 2).toString('latin1') === '--') break;
    assert.equal(cuerpo.subarray(inicio, inicio + 2).toString('latin1'), '\r\n');
    const siguiente = cuerpo.indexOf(delim, inicio);
    assert.ok(siguiente > inicio, 'falta el delimitador de cierre');
    // +2 salta el CRLF de apertura; -2 descarta el CRLF que cierra la parte.
    trozos.push(cuerpo.subarray(inicio + 2, siguiente - 2));
    i = siguiente;
  }
  // El cuerpo termina en `--<boundary>--CRLF`.
  assert.equal(cuerpo.subarray(cuerpo.length - 4).toString('latin1'), '--\r\n');
  return trozos;
}

function dividir(parte: Buffer): { cabeceras: string[]; carga: Buffer } {
  const corte = parte.indexOf('\r\n\r\n');
  assert.ok(corte > 0, 'la parte no tiene línea en blanco separadora');
  return {
    cabeceras: parte.subarray(0, corte).toString('utf8').split('\r\n'),
    carga: parte.subarray(corte + 4),
  };
}

function fallo(fn: () => unknown): EngineRequestError {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof EngineRequestError, `se esperaba EngineRequestError, llegó ${String(err)}`);
    return err;
  }
  assert.fail('no lanzó');
}

// --------------------------------------------------------------------------
// 1. Camino feliz: texto + fichero
// --------------------------------------------------------------------------

test('multipart con un campo de texto y un fichero: ambas partes, boundary correcto y bytes intactos', () => {
  // Bytes que NO son UTF-8 válido: si algo los pasa por una cadena, se rompen.
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0xfe, 0x80]);

  const built = form([
    { name: 'titulo', type: 'text', value: 'informe anual' },
    {
      name: 'adjunto',
      type: 'file',
      content: bytes.toString('base64'),
      filename: 'x.pdf',
      contentType: 'application/pdf',
    },
  ]);

  const boundary = boundaryDe(built.contentType);
  assert.ok(built.buffer !== null);
  const partes = trocear(built.buffer, boundary);
  assert.equal(partes.length, 2);

  const texto = dividir(partes[0] as Buffer);
  assert.deepEqual(texto.cabeceras, ['Content-Disposition: form-data; name="titulo"']);
  assert.equal(texto.carga.toString('utf8'), 'informe anual');

  const fichero = dividir(partes[1] as Buffer);
  assert.deepEqual(fichero.cabeceras, [
    'Content-Disposition: form-data; name="adjunto"; filename="x.pdf"',
    'Content-Type: application/pdf',
  ]);
  assert.deepEqual(fichero.carga, bytes, 'los bytes del fichero deben llegar intactos');

  // El boundary no puede aparecer dentro del contenido.
  assert.equal(
    built.buffer.toString('latin1').split(`--${boundary}`).length - 1,
    3,
    'sólo dos aperturas y un cierre',
  );
});

test('una parte file sin contentType declara application/octet-stream', () => {
  const built = form([{ name: 'f', type: 'file', content: Buffer.from('hola').toString('base64') }]);
  const partes = trocear(built.buffer as Buffer, boundaryDe(built.contentType));
  const { cabeceras, carga } = dividir(partes[0] as Buffer);
  // Sin `filename` no se inventa el parámetro (RFC 7578 §4.2 lo hace SHOULD).
  assert.deepEqual(cabeceras, [
    'Content-Disposition: form-data; name="f"',
    'Content-Type: application/octet-stream',
  ]);
  assert.equal(carga.toString('utf8'), 'hola');
});

test('content vacío es un fichero de 0 bytes, no un error', () => {
  const built = form([{ name: 'f', type: 'file', content: '', filename: 'vacio.bin' }]);
  const partes = trocear(built.buffer as Buffer, boundaryDe(built.contentType));
  assert.equal(dividir(partes[0] as Buffer).carga.length, 0);
});

test('si llegan content y fileRef, mandan los bytes inline', () => {
  const built = form([
    { name: 'f', type: 'file', content: Buffer.from('ok').toString('base64'), fileRef: 'upload_123' },
  ]);
  const partes = trocear(built.buffer as Buffer, boundaryDe(built.contentType));
  const { cabeceras, carga } = dividir(partes[0] as Buffer);
  assert.equal(carga.toString('utf8'), 'ok');
  assert.ok(!cabeceras.join('\n').includes('upload_123'), 'fileRef no se filtra a las cabeceras');
});

test('el base64 partido en líneas (MIME) se acepta', () => {
  const bytes = Buffer.alloc(120, 0x41);
  const envuelto = (bytes.toString('base64').match(/.{1,16}/g) ?? []).join('\r\n');
  const built = form([{ name: 'f', type: 'file', content: envuelto }]);
  const partes = trocear(built.buffer as Buffer, boundaryDe(built.contentType));
  assert.deepEqual(dividir(partes[0] as Buffer).carga, bytes);
});

// --------------------------------------------------------------------------
// 2. Errores de la frontera sin estado
// --------------------------------------------------------------------------

test('type file sin content ni fileRef: error claro apuntando a content', () => {
  const err = fallo(() => form([{ name: 'adjunto', type: 'file', filename: 'x.pdf' }]));
  assert.equal(err.detail, 'body.parts[0].content');
  assert.match(err.message, /adjunto/);
  assert.match(err.message, /content/);
  assert.match(err.message, /base64/);
});

test('type file con fileRef y sin content: el error dice que el motor es sin estado', () => {
  const err = fallo(() =>
    form([
      { name: 'a', type: 'text', value: '1' },
      { name: 'adjunto', type: 'file', fileRef: 'upload_9f3c', filename: 'x.pdf' },
    ]),
  );
  assert.equal(err.detail, 'body.parts[1].fileRef');
  assert.match(err.message, /SIN ESTADO/i);
  assert.match(err.message, /fileRef/);
  assert.match(err.message, /base64/);
  // No se filtra el identificador opaco en el mensaje de error.
  assert.ok(!err.message.includes('upload_9f3c'));
});

test('content que no es base64 válido: error en parts[].content', () => {
  for (const basura of ['no-es-base64!!', 'QQ=QQ', '****', 'YWJj=', 'YWJjZA=']) {
    const err = fallo(() => form([{ name: 'f', type: 'file', content: basura }]));
    assert.equal(err.detail, 'body.parts[0].content', `no detectó ${basura}`);
    assert.match(err.message, /base64/);
  }
});

test('Buffer.from(x, "base64") no vale como validación: descarta basura en silencio', () => {
  // Hecho medido que justifica la comprobación explícita del motor.
  assert.equal(Buffer.from('no-es-base64!!', 'base64').toString('hex'), '9e8f9eb3e6dab1eeb8');
  assert.doesNotThrow(() => Buffer.from('****', 'base64'));
  assert.equal(Buffer.from('****', 'base64').length, 0, 'basura pura se vuelve 0 bytes sin avisar');
});

// --------------------------------------------------------------------------
// 3. Escapado RFC 7578 de name y filename
// --------------------------------------------------------------------------

test('un filename con comillas no rompe la cabecera Content-Disposition', () => {
  const built = form([
    { name: 'adjunto', type: 'file', content: '', filename: 'fac"tura".pdf', contentType: 'application/pdf' },
  ]);
  const partes = trocear(built.buffer as Buffer, boundaryDe(built.contentType));
  const { cabeceras } = dividir(partes[0] as Buffer);
  const disposition = cabeceras[0] as string;

  assert.equal(disposition, 'Content-Disposition: form-data; name="adjunto"; filename="fac%22tura%22.pdf"');
  // Cuatro comillas exactas: las dos de `name` y las dos de `filename`.
  assert.equal((disposition.match(/"/g) ?? []).length, 4);
  assert.equal(cabeceras.length, 2, 'no aparecen cabeceras de más');
  // Y es reversible: el receptor recupera el nombre original.
  assert.equal(decodeURIComponent('fac%22tura%22.pdf'), 'fac"tura".pdf');
});

test('CRLF y barras en name y filename no inyectan cabeceras', () => {
  const built = form([
    {
      name: 'a\r\nX-Colada: 1',
      type: 'file',
      content: '',
      filename: 'x.pdf\\"\r\nContent-Type: text/html',
    },
  ]);
  const partes = trocear(built.buffer as Buffer, boundaryDe(built.contentType));
  const { cabeceras } = dividir(partes[0] as Buffer);

  assert.equal(cabeceras.length, 2, `cabeceras inyectadas: ${JSON.stringify(cabeceras)}`);
  assert.equal(
    cabeceras[0],
    'Content-Disposition: form-data; name="a%0D%0AX-Colada: 1"; ' +
      'filename="x.pdf%5C%22%0D%0AContent-Type: text/html"',
  );
  assert.equal(cabeceras[1], 'Content-Type: application/octet-stream');
});

test('el nombre NO se borra como en v1: percent-encoding reversible', () => {
  const built = form([{ name: 'cam"po', type: 'text', value: 'v' }]);
  const partes = trocear(built.buffer as Buffer, boundaryDe(built.contentType));
  const { cabeceras } = dividir(partes[0] as Buffer);
  // v1 emitía name="campo" (carácter borrado). Ahora es recuperable.
  assert.equal(cabeceras[0], 'Content-Disposition: form-data; name="cam%22po"');
});

test('los nombres no ASCII viajan en UTF-8 crudo, sin filename* (RFC 7578 §4.2 lo prohíbe)', () => {
  const built = form([
    { name: 'año', type: 'file', content: '', filename: 'ñandú – copia.pdf' },
  ]);
  const partes = trocear(built.buffer as Buffer, boundaryDe(built.contentType));
  const { cabeceras } = dividir(partes[0] as Buffer);
  assert.equal(cabeceras[0], 'Content-Disposition: form-data; name="año"; filename="ñandú – copia.pdf"');
  assert.ok(!(cabeceras[0] as string).includes('filename*'));
});

// --------------------------------------------------------------------------
// 4. Content-Type por parte de texto
// --------------------------------------------------------------------------

test('una parte de texto con contentType lo emite (antes se ignoraba)', () => {
  const built = form([
    { name: 'meta', type: 'text', value: '{"a":1}', contentType: 'application/json; charset=utf-8' },
    { name: 'plano', type: 'text', value: 'sin tipo' },
  ]);
  const partes = trocear(built.buffer as Buffer, boundaryDe(built.contentType));
  assert.deepEqual(dividir(partes[0] as Buffer).cabeceras, [
    'Content-Disposition: form-data; name="meta"',
    'Content-Type: application/json; charset=utf-8',
  ]);
  assert.deepEqual(dividir(partes[1] as Buffer).cabeceras, [
    'Content-Disposition: form-data; name="plano"',
  ]);
});

test('un contentType con CRLF se rechaza en vez de inyectar cabeceras', () => {
  const err = fallo(() =>
    form([{ name: 'm', type: 'text', value: 'x', contentType: 'text/plain\r\nX-Colada: 1' }]),
  );
  assert.equal(err.detail, 'body.parts[0].contentType');
  assert.match(err.message, /control/);
});

// --------------------------------------------------------------------------
// 5. Regresión: el multipart SIN ficheros no cambia
// --------------------------------------------------------------------------

test('el multipart sólo de texto produce exactamente lo mismo que antes', () => {
  const built = form([
    { name: 'a', type: 'text', value: '1' },
    { name: 'b', type: 'text', value: 'zz' },
  ]);
  const boundary = boundaryDe(built.contentType);
  const esperado =
    `--${boundary}\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="b"\r\n\r\nzz\r\n` +
    `--${boundary}--\r\n`;
  assert.equal((built.buffer as Buffer).toString('utf8'), esperado);
});

test('una parte de texto sin value sigue saliendo vacía, y form sin partes sólo lleva el cierre', () => {
  const built = form([{ name: 'vacia', type: 'text' }]);
  const boundary = boundaryDe(built.contentType);
  assert.equal(
    (built.buffer as Buffer).toString('utf8'),
    `--${boundary}\r\nContent-Disposition: form-data; name="vacia"\r\n\r\n\r\n--${boundary}--\r\n`,
  );

  const vacio = buildBody({ mode: 'form' });
  const b2 = boundaryDe(vacio.contentType);
  assert.equal((vacio.buffer as Buffer).toString('utf8'), `--${b2}--\r\n`);
});

test('los otros modos de cuerpo no se tocan', () => {
  assert.equal(buildBody({ mode: 'none' }).buffer, null);
  assert.equal(buildBody({ mode: 'json', raw: '{"a":1}' }).contentType, 'application/json');
  assert.equal(buildBody({ mode: 'raw', raw: 'x' }).contentType, 'text/plain; charset=utf-8');
  assert.equal(buildBody({ mode: 'binary', raw: 'AAEC' }).buffer?.toString('hex'), '000102');
  const err = fallo(() => buildBody({ mode: 'binary', fileRef: 'u1' }));
  assert.equal(err.detail, 'body.fileRef');
});

// --------------------------------------------------------------------------
// 6. Contrato: la API tiene que poder enviar `content`
// --------------------------------------------------------------------------

test('el contrato acepta parts[].content y sigue rechazando campos desconocidos', () => {
  const entrada = (parte: Record<string, unknown>) => ({
    executionId: 'e1',
    request: {
      method: 'POST',
      url: 'https://ejemplo.test/subir',
      body: { mode: 'form', parts: [parte] },
    },
  });

  const ok = executeRequestSchema.safeParse(
    entrada({
      name: 'adjunto',
      type: 'file',
      content: Buffer.from('hola').toString('base64'),
      filename: 'x.pdf',
      contentType: 'application/pdf',
    }),
  );
  assert.ok(ok.success, JSON.stringify(ok.error?.issues));

  const nulo = executeRequestSchema.safeParse(entrada({ name: 'a', type: 'file', content: null }));
  assert.ok(nulo.success, 'content nullable');

  const malo = executeRequestSchema.safeParse(entrada({ name: 'a', type: 'file', contenido: 'x' }));
  assert.ok(!malo.success, 'strictObject debe rechazar un campo desconocido');
});

test('camino completo contrato → buildBody con un fichero real', () => {
  const bytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0xff]);
  const parsed = executeRequestSchema.safeParse({
    executionId: 'e2',
    request: {
      method: 'POST',
      url: 'https://ejemplo.test/subir',
      body: {
        mode: 'form',
        parts: [
          { name: 'nota', type: 'text', value: 'con acentos: ñ' },
          {
            name: 'fichero',
            type: 'file',
            content: bytes.toString('base64'),
            filename: 'informe final.pdf',
            contentType: 'application/pdf',
          },
        ],
      },
    },
  });
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));

  const built = buildBody(parsed.data.request.body);
  const partes = trocear(built.buffer as Buffer, boundaryDe(built.contentType));
  assert.equal(partes.length, 2);
  assert.equal(dividir(partes[0] as Buffer).carga.toString('utf8'), 'con acentos: ñ');
  assert.deepEqual(dividir(partes[1] as Buffer).carga, bytes);
});
