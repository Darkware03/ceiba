import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

// El proxy de egreso del contenedor se aparta antes de nada: `undici` fija su
// dispatcher en el primer uso y, con `NODE_USE_ENV_PROXY=1`, manda por el proxy
// hasta el tráfico a 127.0.0.1. `pg` y Prisma comparten entorno y el síntoma
// sería un fallo de red inexplicable. Mismo preámbulo que `sharing-fase5`.
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
  CABECERAS_DE_CREDENCIAL,
  PREFIJO_DE_SECRETO,
  codificarValor,
  entrecomillar,
  generarCurl,
  nombreDeMarcador,
  type PeticionParaCurl,
} from '../src/modules/request/curl.ts';
import { construirCuerpo, filasDeCabecera } from '../src/modules/request/request.repository.ts';
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
 * FASE 6 — PETICIONES DENTRO DE LA COLECCIÓN Y EXPORTACIÓN A cURL.
 *
 * Dos bloques:
 *
 *  1. **Unitario puro** sobre el generador de cURL. `T-LEAK-03 (c)` exige que
 *     la tabla de escape se verifique «por análisis del texto generado, y no
 *     ejecutando una shell». Aquí no se ejecuta ninguna shell.
 *  2. **Integración contra el PostgreSQL REAL** (`127.0.0.1:55432`, base
 *     `ceiba`). `api_requests` no tiene repositorio en memoria y no se simula
 *     ninguno: lo que hay que demostrar —que un ajeno recibe 404 y no una
 *     lista vacía, que el borrado es lógico, que el duplicado no rompe
 *     `uq_requests_external_ref`— sólo es demostrable con el motor delante.
 * ════════════════════════════════════════════════════════════════════════════
 */

/** Centinela de `T-LEAK-02/03`. Si aparece en una salida, hay fuga. */
const CENTINELA = 'SENTINEL-c0ffee';

// ===========================================================================
// 1. Generador de cURL. Unitario puro.
// ===========================================================================

function peticionBase(parcial: Partial<PeticionParaCurl> = {}): PeticionParaCurl {
  return {
    nombre: 'Petición',
    metodo: 'GET',
    metodoPersonalizado: null,
    urlPlantilla: 'https://api.example.com/v1/clientes',
    cabeceras: [],
    parametros: [],
    modoCuerpo: 'none',
    cuerpoCrudo: null,
    contentTypeDelCuerpo: null,
    variablesGraphql: null,
    camposDeFormulario: [],
    tieneFicheroBinario: false,
    timeoutMs: null,
    politicaDeRedireccion: null,
    maxRedirecciones: null,
    verificarTls: null,
    tieneCertificadoDeCliente: false,
    modoAutenticacion: 'none',
    tieneConfiguracionDeAutenticacion: false,
    tienePreScript: false,
    tienePostScript: false,
    ...parcial,
  };
}

describe('F6 · regla 1 — los secretos NO se materializan en el comando', () => {
  it('una cabecera marcada como secreta sale con marcador, nunca con valor', () => {
    const { curl, advertencias } = generarCurl(
      peticionBase({
        cabeceras: [
          // Así está en el esquema: `ck_header_secret_xor` obliga a value NULL.
          { nombre: 'X-Api-Key', valor: null, esSecreto: true, habilitada: true },
          { nombre: 'Accept', valor: 'application/json', esSecreto: false, habilitada: true },
        ],
      }),
    );
    assert.ok(curl.includes(`$${PREFIJO_DE_SECRETO}X_API_KEY`), curl);
    assert.ok(!curl.includes(CENTINELA), curl);
    // Una cabecera normal SÍ sale literal: no se enmascara todo a ciegas.
    assert.ok(curl.includes("'Accept: application/json'"), curl);
    assert.ok(
      advertencias.some((a) => a.includes('X-Api-Key') && a.includes('secreta')),
      JSON.stringify(advertencias),
    );
  });

  it('C-LEAK-05: una credencial escrita a mano tampoco se materializa aunque NO esté clasificada', () => {
    // El valor SÍ está disponible para el generador (la fila lo lleva en claro).
    // La prueba es que, aun teniéndolo, se niega a escribirlo.
    for (const nombre of ['Authorization', 'Cookie', 'X-Api-Key', 'proxy-authorization']) {
      const { curl, advertencias } = generarCurl(
        peticionBase({
          cabeceras: [
            { nombre, valor: `Bearer ${CENTINELA}`, esSecreto: false, habilitada: true },
          ],
        }),
      );
      assert.ok(!curl.includes(CENTINELA), `${nombre} filtró el centinela: ${curl}`);
      assert.ok(curl.includes(`$${nombreDeMarcador(nombre)}`), curl);
      assert.ok(advertencias.some((a) => a.includes('C-LEAK-05')), JSON.stringify(advertencias));
    }
  });

  it('la lista de cabeceras de credencial se compara sin distinguir mayúsculas', () => {
    for (const nombre of CABECERAS_DE_CREDENCIAL) {
      assert.equal(nombre, nombre.toLowerCase(), `${nombre} debe estar en minúsculas`);
    }
    const { curl } = generarCurl(
      peticionBase({
        cabeceras: [{ nombre: 'AUTHORIZATION', valor: CENTINELA, esSecreto: false, habilitada: true }],
      }),
    );
    assert.ok(!curl.includes(CENTINELA), curl);
  });

  it('un parámetro de consulta secreto sale con marcador y la URL no lleva el valor', () => {
    const { curl, advertencias } = generarCurl(
      peticionBase({
        parametros: [
          { tipo: 'query', nombre: 'token', valor: null, esSecreto: true, habilitado: true },
          { tipo: 'query', nombre: 'page', valor: '2', esSecreto: false, habilitado: true },
        ],
      }),
    );
    assert.ok(curl.includes(`$${PREFIJO_DE_SECRETO}QUERY_TOKEN`), curl);
    assert.ok(curl.includes('page=2'), curl);
    assert.ok(advertencias.some((a) => a.includes('token')), JSON.stringify(advertencias));
  });

  it('un campo de formulario secreto sale con marcador', () => {
    const { curl } = generarCurl(
      peticionBase({
        metodo: 'POST',
        modoCuerpo: 'form_urlencoded',
        camposDeFormulario: [
          {
            nombre: 'client_secret',
            valor: null,
            esSecreto: true,
            habilitado: true,
            esFichero: false,
            contentType: null,
          },
        ],
      }),
    );
    assert.ok(curl.includes(`$${PREFIJO_DE_SECRETO}FORM_CLIENT_SECRET`), curl);
    assert.ok(!curl.includes(CENTINELA), curl);
  });
});

describe('F6 · regla 2 — las variables {{...}} se conservan sin resolver', () => {
  it('la URL sale literal, con sus marcadores, y se avisa de ello', () => {
    const { curl, advertencias } = generarCurl(
      peticionBase({ urlPlantilla: '{{base_url}}/v1/clientes/{{id}}' }),
    );
    assert.ok(curl.includes("'{{base_url}}/v1/clientes/{{id}}'"), curl);
    assert.ok(
      advertencias.some((a) => a.includes('{{base_url}}') && a.includes('sin resolver')),
      JSON.stringify(advertencias),
    );
  });

  it('la codificación percent de un parámetro respeta el marcador y sí escapa lo hostil', () => {
    assert.equal(codificarValor('{{token}}'), '{{token}}');
    assert.equal(codificarValor('a&b=c'), 'a%26b%3Dc');
    assert.equal(codificarValor('{{a}}&{{b}}'), '{{a}}%26{{b}}');
  });

  it('un valor compuesto sólo de marcadores no se trata como credencial filtrada', () => {
    const { curl } = generarCurl(
      peticionBase({
        cabeceras: [
          { nombre: 'Authorization', valor: 'Bearer {{token}}', esSecreto: false, habilitada: true },
        ],
      }),
    );
    // Es ya un marcador: conservarlo es la regla 2, y no hay nada que filtrar.
    assert.ok(curl.includes('Bearer {{token}}'), curl);
  });
});

const HOSTILES = [
  "valor'con'comillas",
  'valor"con"dobles',
  'back`tick`',
  '$(id)',
  '`id`',
  '${HOME}',
  ';rm -rf /',
  '&& whoami',
  '| cat /etc/passwd',
  'ñ áé 漢字 🙂',
  'a\\b',
];

describe('F6 · regla 3 — comillas correctas, sin inyección de comandos', () => {
  it('todo valor hostil queda entrecomillado y literal', () => {
    for (const hostil of HOSTILES) {
      const citado = entrecomillar(hostil);
      assert.ok(citado.startsWith("'") && citado.endsWith("'"), citado);
      // Dentro de comillas simples POSIX la ÚNICA secuencia especial posible
      // es el cierre; la comilla simple tiene que haber salido como '\''.
      const interior = citado.slice(1, -1);
      assert.ok(
        !interior.includes("'") || interior.includes(`'\\''`),
        `comilla sin escapar en ${citado}`,
      );
      // Reconstrucción: deshaciendo el escape se recupera el original exacto.
      assert.equal(interior.split(`'\\''`).join("'"), hostil);
    }
  });

  it('el comando completo con valores hostiles no deja una expansión suelta', () => {
    const { curl } = generarCurl(
      peticionBase({
        metodo: 'POST',
        urlPlantilla: 'https://api.example.com/x',
        cabeceras: [
          { nombre: 'X-Nota', valor: "it's $(id) `whoami`", esSecreto: false, habilitada: true },
          { nombre: 'X-Api-Key', valor: null, esSecreto: true, habilitada: true },
        ],
        modoCuerpo: 'raw_json',
        cuerpoCrudo: '{"cmd":"; rm -rf / #","q":"it\'s"}',
      }),
    );
    const analisis = analizarComoShell(curl);
    assert.deepEqual(analisis.peligros, [], `${curl}\n→ ${analisis.peligros.join(' / ')}`);
    // La única expansión que queda viva es el marcador de secreto, y es
    // deliberada: se expande para que el comando funcione tras `export`.
    assert.deepEqual(analisis.expansiones, [`$${PREFIJO_DE_SECRETO}X_API_KEY`]);
    assert.ok(curl.includes('--data-raw'), curl);
  });

  it('todos los valores hostiles pasan el analizador léxico de shell', () => {
    for (const hostil of HOSTILES) {
      const { curl } = generarCurl(
        peticionBase({
          metodo: 'POST',
          urlPlantilla: `https://api.example.com/${hostil}`,
          cabeceras: [{ nombre: 'X-Nota', valor: hostil, esSecreto: false, habilitada: true }],
          parametros: [
            { tipo: 'query', nombre: 'q', valor: hostil, esSecreto: false, habilitado: true },
          ],
          modoCuerpo: 'raw_text',
          cuerpoCrudo: hostil,
        }),
      );
      const analisis = analizarComoShell(curl);
      assert.deepEqual(analisis.peligros, [], `«${hostil}» → ${curl}`);
      assert.deepEqual(analisis.expansiones, [], `«${hostil}» → ${curl}`);
    }
  });

  it('un valor de cabecera con salto de línea no se puede representar y se declara', () => {
    const { curl, advertencias } = generarCurl(
      peticionBase({
        cabeceras: [
          { nombre: 'X-Roto', valor: `a\r\nX-Inyectada: ${CENTINELA}`, esSecreto: false, habilitada: true },
        ],
      }),
    );
    assert.ok(!curl.includes(CENTINELA), curl);
    assert.ok(!curl.includes('X-Inyectada'), curl);
    assert.ok(
      advertencias.some((a) => a.includes('caracteres de control')),
      JSON.stringify(advertencias),
    );
  });

  it('el comando es UNA sola línea: se pega en cualquier terminal', () => {
    const { curl } = generarCurl(
      peticionBase({
        metodo: 'POST',
        cabeceras: [{ nombre: 'Accept', valor: 'application/json', esSecreto: false, habilitada: true }],
        modoCuerpo: 'raw_text',
        cuerpoCrudo: 'sin saltos',
      }),
    );
    assert.ok(!curl.includes('\n'), curl);
    assert.ok(curl.startsWith('curl --request POST '), curl);
  });

  it('el marcador de secreto va entre comillas DOBLES para que la shell lo expanda', () => {
    const { curl } = generarCurl(
      peticionBase({
        cabeceras: [{ nombre: 'X-Api-Key', valor: null, esSecreto: true, habilitada: true }],
      }),
    );
    assert.ok(curl.includes(`--header "X-Api-Key: $${PREFIJO_DE_SECRETO}X_API_KEY"`), curl);
  });
});

/**
 * Analizador léxico de shell POSIX, **sin ejecutar nada** (`T-LEAK-03 (c)`:
 * «se verifica por análisis del texto generado, no ejecutando una shell»).
 *
 * Recorre el comando con los tres estados reales del troceado de `sh`
 * —fuera de comillas, dentro de comillas simples, dentro de comillas dobles—
 * y anota:
 *
 *  - `peligros`: cualquier metacarácter que la shell interpretaría y que no
 *    debería estar ahí (sustitución de comando, redirección, encadenado…).
 *  - `expansiones`: las expansiones de variable que SÍ sobreviven. Deben ser
 *    exactamente los marcadores de secreto y nada más.
 *
 * Dentro de comillas simples no hay ninguna interpretación, ni siquiera de la
 * barra invertida: por eso ese estado sólo busca la comilla de cierre.
 */
function analizarComoShell(comando: string): { peligros: string[]; expansiones: string[] } {
  const peligros: string[] = [];
  const expansiones: string[] = [];
  const PELIGROSOS_FUERA = new Set(['`', ';', '|', '&', '<', '>', '(', ')', '*', '?', '~']);
  let estado: 'fuera' | 'simple' | 'doble' = 'fuera';
  let i = 0;

  while (i < comando.length) {
    const c = comando[i] as string;
    if (estado === 'simple') {
      if (c === "'") estado = 'fuera';
      i += 1;
      continue;
    }
    if (estado === 'doble') {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '"') {
        estado = 'fuera';
        i += 1;
        continue;
      }
      if (c === '`') peligros.push(`backtick dentro de comillas dobles en ${i}`);
      if (c === '$') {
        const encontrado = new RegExp(`^\\$${PREFIJO_DE_SECRETO}[A-Z0-9_]+`, 'u').exec(
          comando.slice(i),
        );
        if (encontrado === null) {
          peligros.push(`expansión no autorizada dentro de comillas dobles en ${i}`);
        } else {
          expansiones.push(encontrado[0]);
          i += encontrado[0].length;
          continue;
        }
      }
      i += 1;
      continue;
    }
    // Fuera de comillas.
    if (c === "'") {
      estado = 'simple';
      i += 1;
      continue;
    }
    if (c === '"') {
      estado = 'doble';
      i += 1;
      continue;
    }
    if (c === '\\') {
      // Barra invertida: escapa el carácter siguiente. Es como sale `'\''`.
      i += 2;
      continue;
    }
    if (c === '$') {
      peligros.push(`expansión fuera de comillas en ${i}`);
    } else if (PELIGROSOS_FUERA.has(c)) {
      peligros.push(`metacarácter «${c}» fuera de comillas en ${i}`);
    }
    i += 1;
  }
  if (estado !== 'fuera') peligros.push('el comando termina con comillas sin cerrar');
  return { peligros, expansiones };
}

describe('F6 · C-LEAK-05 — lo que sí se materializa se revisa por patrón', () => {
  it('un JWT en el cuerpo no se borra, pero se avisa de que viaja en claro', () => {
    const { curl, advertencias } = generarCurl(
      peticionBase({
        metodo: 'POST',
        modoCuerpo: 'raw_json',
        cuerpoCrudo: '{"token":"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.firma"}',
      }),
    );
    // El cuerpo es la carga útil que escribió el usuario: vaciarlo dejaría un
    // comando inservible. El control dice «avisar, no bloquear».
    assert.ok(curl.includes('eyJhbGciOiJIUzI1NiJ9'), curl);
    assert.ok(
      advertencias.some((a) => a.includes('JWT') && a.includes('C-LEAK-05')),
      JSON.stringify(advertencias),
    );
  });

  it('una clave de AWS en una cabecera normal dispara el aviso, y el aviso no lleva el valor', () => {
    const { advertencias } = generarCurl(
      peticionBase({
        cabeceras: [
          { nombre: 'X-Config', valor: 'AKIAIOSFODNN7EXAMPLE', esSecreto: false, habilitada: true },
        ],
      }),
    );
    const aviso = advertencias.find((a) => a.includes('AWS'));
    assert.ok(aviso !== undefined, JSON.stringify(advertencias));
    assert.ok(!aviso.includes('AKIAIOSFODNN7EXAMPLE'), aviso);
  });

  it('un valor normal no dispara ningún falso positivo', () => {
    const { advertencias } = generarCurl(
      peticionBase({
        cabeceras: [
          { nombre: 'X-Request-Id', valor: '7f3c1b2a-0000-7000-8000-abcdefabcdef', esSecreto: false, habilitada: true },
        ],
      }),
    );
    assert.ok(!advertencias.some((a) => a.includes('C-LEAK-05')), JSON.stringify(advertencias));
  });
});

describe('F6 · regla 4 — lo que no se puede representar se declara', () => {
  it('un cuerpo binario del almacén no se inventa', () => {
    const { curl, advertencias } = generarCurl(
      peticionBase({ metodo: 'POST', modoCuerpo: 'binary_file', tieneFicheroBinario: true }),
    );
    assert.ok(!curl.includes('--data'), curl);
    assert.ok(
      advertencias.some((a) => a.includes('fichero binario')),
      JSON.stringify(advertencias),
    );
  });

  it('un adjunto multipart declara que cURL necesita la ruta local', () => {
    const { advertencias } = generarCurl(
      peticionBase({
        metodo: 'POST',
        modoCuerpo: 'multipart_form_data',
        camposDeFormulario: [
          {
            nombre: 'factura',
            valor: null,
            esSecreto: false,
            habilitado: true,
            esFichero: true,
            contentType: 'application/pdf',
          },
        ],
      }),
    );
    assert.ok(
      advertencias.some((a) => a.includes('factura') && a.includes('--form')),
      JSON.stringify(advertencias),
    );
  });

  it('mTLS, scripts y autenticación heredada se declaran en vez de fingirse', () => {
    const { advertencias } = generarCurl(
      peticionBase({
        tieneCertificadoDeCliente: true,
        tienePreScript: true,
        modoAutenticacion: 'inherit',
      }),
    );
    const texto = advertencias.join(' | ');
    assert.ok(texto.includes('mTLS'), texto);
    assert.ok(texto.includes('scripts'), texto);
    assert.ok(texto.includes('heredada'), texto);
  });

  it('timeout, redirecciones y TLS sí son representables y se emiten', () => {
    const { curl } = generarCurl(
      peticionBase({
        timeoutMs: 4500,
        politicaDeRedireccion: 'follow',
        maxRedirecciones: 3,
        verificarTls: false,
      }),
    );
    assert.ok(curl.includes('--max-time 4.5'), curl);
    assert.ok(curl.includes('--location --max-redirs 3'), curl);
    assert.ok(curl.includes('--insecure'), curl);
  });

  it('un verbo CUSTOM se emite tal cual', () => {
    const { curl } = generarCurl(peticionBase({ metodo: 'CUSTOM', metodoPersonalizado: 'PURGE' }));
    assert.ok(curl.startsWith('curl --request PURGE '), curl);
  });
});

describe('F6 · traducción contrato → filas del esquema', () => {
  it('una cabecera sin valor se guarda como cadena vacía, nunca como NULL', () => {
    // NULL está reservado por `ck_header_secret_xor` a las secretas.
    const filas = filasDeCabecera([{ key: 'X-Vacia' }]);
    assert.equal(filas[0]?.value, '');
  });

  it('los modos de formulario NO escriben raw_content (ck_body_mode_shape)', () => {
    const cuerpo = construirCuerpo('form_urlencoded', 'a=1&b=dos');
    assert.equal(cuerpo?.rawContent, null);
    assert.deepEqual(
      cuerpo?.requestBodyFields?.create.map((c) => [c.fieldName, c.fieldValue]),
      [
        ['a', '1'],
        ['b', 'dos'],
      ],
    );
  });

  it('los modos crudos escriben raw_content y `none` no crea fila', () => {
    assert.equal(construirCuerpo('raw_json', '{"a":1}')?.rawContent, '{"a":1}');
    assert.equal(construirCuerpo('none', null), null);
  });
});

// ===========================================================================
// 2. Integración contra el PostgreSQL REAL.
// ===========================================================================

describe('F6 · las 7 rutas contra PostgreSQL real', () => {
  let entorno: AppDePruebaPg;
  let marca: string;
  let duena: Credenciales;
  let ajena: Credenciales;
  let espectadora: Credenciales;
  let workspaceId: string;
  let coleccionId: string;

  before(async () => {
    entorno = await crearAppDePruebaPostgres();
    marca = marcaDeEjecucion();
    const clave = contrasenaDePrueba(marca);

    duena = await registrarYEntrar(entorno, `duena-${marca}@ceiba.test`, clave, 'Dueña');
    ajena = await registrarYEntrar(entorno, `ajena-${marca}@ceiba.test`, clave, 'Ajena');
    espectadora = await registrarYEntrar(
      entorno,
      `espectadora-${marca}@ceiba.test`,
      clave,
      'Espectadora',
    );

    const ws = await pedir(entorno, {
      method: 'POST',
      url: '/api/v1/workspaces',
      payload: { slug: `f6-${marca}`, name: `Workspace F6 ${marca}`, description: null },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(ws.statusCode, 201, ws.body);
    workspaceId = (ws.json() as { workspace: { id: string } }).workspace.id;

    const col = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/collections`,
      payload: { slug: `col-${marca}`, name: 'Colección F6', description: null },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(col.statusCode, 201, col.body);
    coleccionId = (col.json() as { coleccion: { id: string } }).coleccion.id;

    const alta = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/members`,
      payload: { email: `espectadora-${marca}@ceiba.test`, role: 'viewer' },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(alta.statusCode, 201, alta.body);
  });

  after(async () => {
    await entorno?.cerrar();
  });

  // -------------------------------------------------------------------------

  it('EL FALLO DEL CLIENTE: una colección recién creada ya admite peticiones y las lista', async () => {
    const vacia = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/collections/${coleccionId}/requests`,
      cookies: duena.cookies,
    });
    assert.equal(vacia.statusCode, 200, vacia.body);
    assert.deepEqual((vacia.json() as { requests: unknown[] }).requests, []);

    const creada = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/collections/${coleccionId}/requests`,
      payload: {
        name: 'Listar clientes',
        method: 'GET',
        url: '{{base_url}}/v1/clientes',
        folderId: null,
        description: null,
        headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
        queryParams: [{ key: 'page', value: '2', enabled: true }],
        bodyType: 'none',
        body: null,
        sortKey: null,
      },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(creada.statusCode, 201, creada.body);
    const peticion = (creada.json() as { request: Record<string, unknown> }).request;
    assert.equal(peticion['name'], 'Listar clientes');
    // `url_template` JAMÁS se guarda resuelta.
    assert.equal(peticion['url'], '{{base_url}}/v1/clientes');
    assert.equal(peticion['urlTemplate'], '{{base_url}}/v1/clientes');
    assert.equal(peticion['sortKey'], '000000');

    const lista = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/collections/${coleccionId}/requests`,
      cookies: duena.cookies,
    });
    assert.equal(lista.statusCode, 200, lista.body);
    const cuerpo = lista.json() as { requests: Array<Record<string, unknown>>; total: number };
    assert.equal(cuerpo.total, 1);
    assert.equal(cuerpo.requests[0]?.['id'], peticion['id']);
  });

  it('el marcador {{var}} llega sin resolver a la columna url_template', async () => {
    const fila = await entorno.prisma.apiRequest.findFirst({
      where: { collectionId: coleccionId, name: 'Listar clientes' },
      select: { urlTemplate: true },
    });
    assert.equal(fila?.urlTemplate, '{{base_url}}/v1/clientes');
  });

  it('crea con verbo CUSTOM y rechaza la combinación incoherente con 422', async () => {
    const malo = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/collections/${coleccionId}/requests`,
      payload: { name: 'Sin verbo', method: 'CUSTOM', url: 'https://x.test' },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(malo.statusCode, 422, malo.body);

    const bueno = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/collections/${coleccionId}/requests`,
      payload: {
        name: 'Purgar caché',
        method: 'CUSTOM',
        methodCustom: 'PURGE',
        url: 'https://cdn.example.test/{{ruta}}',
      },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(bueno.statusCode, 201, bueno.body);
    assert.equal(
      (bueno.json() as { request: Record<string, unknown> }).request['methodCustom'],
      'PURGE',
    );
  });

  it('una carpeta de otra colección se rechaza con 422 en vez de colarse', async () => {
    const otra = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/collections`,
      payload: { slug: `otra-${marca}`, name: 'Otra colección', description: null },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    const otraId = (otra.json() as { coleccion: { id: string } }).coleccion.id;
    const carpeta = await entorno.prisma.collectionFolder.create({
      data: {
        collectionId: otraId,
        parentFolderId: null,
        name: 'Carpeta ajena',
        materializedPath: '/',
        depth: 0,
        sortKey: '000000',
      },
      select: { id: true },
    });

    const respuesta = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/collections/${coleccionId}/requests`,
      payload: { name: 'Mal ubicada', url: 'https://x.test', folderId: carpeta.id },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(respuesta.statusCode, 422, respuesta.body);
  });

  // -------------------------------------------------------------------------
  // Autorización por recurso
  // -------------------------------------------------------------------------

  it('UN AJENO NO RECIBE UNA LISTA VACÍA: recibe 404 en todas las rutas', async () => {
    const peticionId = await primerIdDePeticion(entorno, coleccionId);

    const casos: Array<{ metodo: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: unknown }> =
      [
        { metodo: 'GET', url: `/api/v1/collections/${coleccionId}/requests` },
        {
          metodo: 'POST',
          url: `/api/v1/collections/${coleccionId}/requests`,
          payload: { name: 'Intrusa', url: 'https://x.test' },
        },
        { metodo: 'GET', url: `/api/v1/requests/${peticionId}` },
        { metodo: 'GET', url: `/api/v1/requests/${peticionId}/curl` },
        { metodo: 'PATCH', url: `/api/v1/requests/${peticionId}`, payload: { name: 'Secuestrada' } },
        { metodo: 'DELETE', url: `/api/v1/requests/${peticionId}` },
        { metodo: 'POST', url: `/api/v1/requests/${peticionId}/duplicate`, payload: {} },
      ];

    for (const caso of casos) {
      const respuesta = await pedir(entorno, {
        method: caso.metodo,
        url: caso.url,
        payload: caso.payload,
        cookies: ajena.cookies,
        csrf: ajena.csrf,
      });
      assert.equal(respuesta.statusCode, 404, `${caso.metodo} ${caso.url} → ${respuesta.body}`);
      assert.ok(!respuesta.body.includes('Listar clientes'), respuesta.body);
    }
  });

  it('un miembro con rol viewer lee pero NO escribe: 200 en lectura, 403 en mutación', async () => {
    const peticionId = await primerIdDePeticion(entorno, coleccionId);

    const lectura = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/collections/${coleccionId}/requests`,
      cookies: espectadora.cookies,
    });
    assert.equal(lectura.statusCode, 200, lectura.body);
    assert.ok((lectura.json() as { total: number }).total > 0);

    const escritura = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/collections/${coleccionId}/requests`,
      payload: { name: 'No debería', url: 'https://x.test' },
      cookies: espectadora.cookies,
      csrf: espectadora.csrf,
    });
    assert.equal(escritura.statusCode, 403, escritura.body);

    const borrado = await pedir(entorno, {
      method: 'DELETE',
      url: `/api/v1/requests/${peticionId}`,
      cookies: espectadora.cookies,
      csrf: espectadora.csrf,
    });
    assert.equal(borrado.statusCode, 403, borrado.body);
  });

  it('sin sesión es 401, y una mutación sin testigo CSRF es 403', async () => {
    const sinSesion = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/collections/${coleccionId}/requests`,
    });
    assert.equal(sinSesion.statusCode, 401, sinSesion.body);

    const sinCsrf = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/collections/${coleccionId}/requests`,
      payload: { name: 'Sin testigo', url: 'https://x.test' },
      cookies: duena.cookies,
    });
    assert.equal(sinCsrf.statusCode, 403, sinCsrf.body);
  });

  it('un identificador inventado no revela nada: 404, no 500', async () => {
    for (const id of ['00000000-0000-7000-8000-000000000000', 'no-es-un-uuid']) {
      const respuesta = await pedir(entorno, {
        method: 'GET',
        url: `/api/v1/requests/${id}`,
        cookies: duena.cookies,
      });
      assert.equal(respuesta.statusCode, 404, `${id} → ${respuesta.statusCode} ${respuesta.body}`);
    }
  });

  // -------------------------------------------------------------------------
  // cURL contra datos reales
  // -------------------------------------------------------------------------

  it('EL cURL DE UNA PETICIÓN CON CABECERA SECRETA NO CONTIENE EL VALOR', async () => {
    const coleccion = await entorno.prisma.collection.findUniqueOrThrow({
      where: { id: coleccionId },
      select: { workspaceId: true },
    });

    const creada = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/collections/${coleccionId}/requests`,
      payload: {
        name: 'Con secreto',
        method: 'POST',
        url: '{{base_url}}/v1/pagos',
        headers: [
          { key: 'Accept', value: 'application/json', enabled: true },
          // Credencial escrita a mano, SIN clasificar: el valor sí está en la
          // base. C-LEAK-05 obliga a tratarla como secreto igualmente.
          { key: 'Authorization', value: `Bearer ${CENTINELA}`, enabled: true },
        ],
        bodyType: 'raw_json',
        body: `{"nota":"${CENTINELA}-en-el-cuerpo"}`,
      },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(creada.statusCode, 201, creada.body);
    const peticionId = (creada.json() as { request: { id: string } }).request.id;

    // Cabecera CLASIFICADA como secreta: el esquema obliga a `value IS NULL` y
    // a un `secret_id`. El criptograma vive en `secrets`; aquí se crea uno
    // sintético porque no hay bóveda todavía (HUECO declarado en el informe).
    const secreto = await entorno.prisma.secret.create({
      data: {
        workspaceId: coleccion.workspaceId,
        scope: 'api_request',
        scopeId: peticionId,
        label: 'Clave de pagos (etiqueta NO sensible)',
        ciphertext: Buffer.from('criptograma-sintetico-de-prueba'),
        nonce: Buffer.from('000000000000'),
        aadFingerprint: Buffer.from('huella-aad'),
        kekReference: 'kms://prueba/f6',
      },
      select: { id: true },
    });
    await entorno.prisma.requestHeader.create({
      data: {
        apiRequestId: peticionId,
        name: 'X-Api-Key',
        value: null,
        secretId: secreto.id,
        isSecret: true,
        isEnabled: true,
        sortOrder: 9,
      },
    });

    const respuesta = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/requests/${peticionId}/curl`,
      cookies: duena.cookies,
    });
    assert.equal(respuesta.statusCode, 200, respuesta.body);
    const { curl, advertencias } = respuesta.json() as { curl: string; advertencias: string[] };

    // 1. NINGUNA cabecera de credencial lleva su valor.
    assert.ok(!curl.includes(`Bearer ${CENTINELA}`), curl);
    assert.ok(!/Authorization: (?!\$CEIBA_SECRETO_)/u.test(curl), curl);
    // 2. Salen los dos marcadores: la clasificada y la detectada.
    assert.ok(curl.includes(`$${PREFIJO_DE_SECRETO}AUTHORIZATION`), curl);
    assert.ok(curl.includes(`$${PREFIJO_DE_SECRETO}X_API_KEY`), curl);
    // 3. Lo que no es credencial sí viaja: no se enmascara a ciegas.
    assert.ok(curl.includes("'Accept: application/json'"), curl);
    // 4. El marcador de variable se conserva sin resolver.
    assert.ok(curl.includes('{{base_url}}/v1/pagos'), curl);
    // 5. El CUERPO SÍ se materializa, y es correcto: es la carga útil que
    //    escribió el usuario, no un secreto clasificado. Queda declarado.
    assert.ok(curl.includes(`${CENTINELA}-en-el-cuerpo`), curl);
    // 6. Se informa de ambas limitaciones.
    assert.ok(advertencias.length >= 2, JSON.stringify(advertencias));
    // 7. El comando resiste el analizador léxico.
    const analisis = analizarComoShell(curl);
    assert.deepEqual(analisis.peligros, [], `${curl}\n→ ${analisis.peligros.join(' / ')}`);

    // Y el detalle de la API tampoco devuelve el valor del secreto.
    const detalle = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/requests/${peticionId}`,
      cookies: duena.cookies,
    });
    const cabeceras = (
      detalle.json() as { request: { headers: Array<Record<string, unknown>> } }
    ).request.headers;
    const secreta = cabeceras.find((h) => h['key'] === 'X-Api-Key');
    assert.equal(secreta?.['value'], null);
    assert.equal(secreta?.['secret'], true);
    assert.ok(!detalle.body.includes('criptograma'), detalle.body);

    // C-LEAK-05 en la proyección: la `Authorization` escrita a mano SÍ se
    // devuelve (la interfaz tiene que poder editarla) pero va marcada, para
    // que la interfaz ofrezca convertirla en variable secreta. Es la
    // limitación declarada del control: detección, no clasificación.
    const aMano = cabeceras.find((h) => h['key'] === 'Authorization');
    assert.equal(aMano?.['secret'], false);
    assert.equal(aMano?.['looksSecret'], true);
    const normal = cabeceras.find((h) => h['key'] === 'Accept');
    assert.equal(normal?.['looksSecret'], false);
  });

  it('el cURL de la petición con {{var}} conserva el marcador sin resolver', async () => {
    const peticionId = await primerIdDePeticion(entorno, coleccionId);
    const respuesta = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/requests/${peticionId}/curl`,
      cookies: duena.cookies,
    });
    assert.equal(respuesta.statusCode, 200, respuesta.body);
    const { curl, advertencias } = respuesta.json() as { curl: string; advertencias: string[] };
    assert.ok(curl.includes('{{base_url}}/v1/clientes'), curl);
    assert.ok(curl.includes('page=2'), curl);
    assert.ok(
      advertencias.some((a) => a.includes('{{base_url}}')),
      JSON.stringify(advertencias),
    );
  });

  // -------------------------------------------------------------------------
  // Actualizar · duplicar · borrar
  // -------------------------------------------------------------------------

  it('PATCH cambia lo enviado, respeta lo demás y no destruye las cabeceras secretas', async () => {
    const conSecreto = await entorno.prisma.apiRequest.findFirstOrThrow({
      where: { collectionId: coleccionId, name: 'Con secreto', deletedAt: null },
      select: { id: true, lockVersion: true },
    });

    const respuesta = await pedir(entorno, {
      method: 'PATCH',
      url: `/api/v1/requests/${conSecreto.id}`,
      payload: {
        name: 'Con secreto (renombrada)',
        // El cliente devuelve la lista que vio, y la secreta venía con value
        // null. Si la aplicáramos tal cual, perderíamos el enlace al secreto.
        headers: [{ key: 'Accept', value: 'application/xml', enabled: true }],
      },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(respuesta.statusCode, 200, respuesta.body);
    const vista = (respuesta.json() as { request: Record<string, unknown> }).request;
    assert.equal(vista['name'], 'Con secreto (renombrada)');
    assert.equal(vista['url'], '{{base_url}}/v1/pagos');
    assert.equal((vista['lockVersion'] as number) > conSecreto.lockVersion, true);

    const cabeceras = vista['headers'] as Array<Record<string, unknown>>;
    assert.ok(cabeceras.some((h) => h['key'] === 'Accept' && h['value'] === 'application/xml'));
    assert.ok(
      cabeceras.some((h) => h['key'] === 'X-Api-Key' && h['secret'] === true),
      'se perdió la cabecera secreta en el PATCH',
    );
  });

  it('PATCH a method distinto de CUSTOM limpia method_custom (ck_request_custom_verb)', async () => {
    const purga = await entorno.prisma.apiRequest.findFirstOrThrow({
      where: { collectionId: coleccionId, name: 'Purgar caché', deletedAt: null },
      select: { id: true },
    });
    const respuesta = await pedir(entorno, {
      method: 'PATCH',
      url: `/api/v1/requests/${purga.id}`,
      payload: { method: 'GET' },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(respuesta.statusCode, 200, respuesta.body);
    const fila = await entorno.prisma.apiRequest.findUniqueOrThrow({
      where: { id: purga.id },
      select: { method: true, methodCustom: true },
    });
    assert.equal(fila.method, 'GET');
    assert.equal(fila.methodCustom, null);
  });

  it('duplicar copia cabeceras y secretos por referencia, con external_ref a NULL', async () => {
    const conSecreto = await entorno.prisma.apiRequest.findFirstOrThrow({
      where: { collectionId: coleccionId, name: 'Con secreto (renombrada)', deletedAt: null },
      select: { id: true },
    });
    const respuesta = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/requests/${conSecreto.id}/duplicate`,
      payload: {},
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(respuesta.statusCode, 201, respuesta.body);
    const copia = (respuesta.json() as { request: Record<string, unknown> }).request;
    assert.equal(copia['name'], 'Con secreto (renombrada) (copia)');
    assert.notEqual(copia['id'], conSecreto.id);
    assert.equal(copia['externalRef'], null);

    const cabeceras = copia['headers'] as Array<Record<string, unknown>>;
    assert.ok(cabeceras.some((h) => h['key'] === 'X-Api-Key' && h['secret'] === true));
    assert.ok(cabeceras.every((h) => h['key'] !== 'X-Api-Key' || h['value'] === null));

    // Y el cURL de la copia tampoco materializa la credencial.
    const curl = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/requests/${copia['id'] as string}/curl`,
      cookies: duena.cookies,
    });
    const comando = (curl.json() as { curl: string }).curl;
    assert.ok(!comando.includes(`Bearer ${CENTINELA}`), comando);
    assert.ok(comando.includes(`$${PREFIJO_DE_SECRETO}X_API_KEY`), comando);

    // El secreto se comparte POR REFERENCIA: misma fila de `secrets`, dos
    // cabeceras. Ni se descifra, ni se duplica el criptograma.
    const secretos = await entorno.prisma.requestHeader.findMany({
      where: { name: 'X-Api-Key', isSecret: true, apiRequestId: { in: [conSecreto.id, copia['id'] as string] } },
      select: { apiRequestId: true, secretId: true, value: true },
    });
    assert.equal(secretos.length, 2);
    assert.equal(new Set(secretos.map((s) => s.secretId)).size, 1);
    assert.ok(secretos.every((s) => s.value === null));
  });

  it('DELETE es lógico: 204, desaparece del listado, 404 después, y la fila sigue ahí', async () => {
    const creada = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/collections/${coleccionId}/requests`,
      payload: { name: 'Efímera', url: 'https://x.test/efimera' },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    const id = (creada.json() as { request: { id: string } }).request.id;

    const borrado = await pedir(entorno, {
      method: 'DELETE',
      url: `/api/v1/requests/${id}`,
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(borrado.statusCode, 204, borrado.body);

    const despues = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/requests/${id}`,
      cookies: duena.cookies,
    });
    assert.equal(despues.statusCode, 404, despues.body);

    const lista = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/collections/${coleccionId}/requests`,
      cookies: duena.cookies,
    });
    const ids = (lista.json() as { requests: Array<{ id: string }> }).requests.map((r) => r.id);
    assert.ok(!ids.includes(id));

    const fila = await entorno.prisma.apiRequest.findUnique({
      where: { id },
      select: { deletedAt: true, deletedByUserId: true },
    });
    assert.notEqual(fila?.deletedAt, null);
    assert.equal(fila?.deletedByUserId, duena.usuarioId);
  });

  it('el contador request_count de la colección lo mantiene el trigger del esquema', async () => {
    const filas = (await entorno.prisma.$queryRawUnsafe(
      'SELECT request_count FROM collections WHERE id = $1::uuid',
      coleccionId,
    )) as Array<{ request_count: number }>;
    const contador = filas[0]?.request_count ?? -1;
    const vivas = await entorno.prisma.apiRequest.count({
      where: { collectionId: coleccionId, deletedAt: null },
    });
    assert.equal(Number(contador), vivas);
  });

  it('el cuerpo de formulario se guarda en request_body_fields, no en raw_content', async () => {
    // ACTUALIZADO EN LA FASE 7. Hasta la fase 6 el contenido de un formulario
    // viajaba como texto urlencoded en `body`. El §2.1 del BRIEF-FASE7 lo
    // cambia: el contenido va en `bodyFields`, y mandar `body` con un
    // `bodyType` de formulario es **422, no un silencio**. Lo que esta prueba
    // afirma —que `raw_content` queda NULL y el contenido se desgrana en
    // `request_body_fields`— no ha cambiado; sólo la puerta de entrada.
    const creada = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/collections/${coleccionId}/requests`,
      payload: {
        name: 'Formulario',
        method: 'POST',
        url: 'https://x.test/form',
        bodyType: 'form_urlencoded',
        bodyFields: [
          { key: 'grant_type', kind: 'text', value: 'client_credentials' },
          { key: 'scope', kind: 'text', value: 'lectura' },
        ],
      },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(creada.statusCode, 201, creada.body);
    const id = (creada.json() as { request: { id: string } }).request.id;

    const cuerpo = await entorno.prisma.requestBody.findFirstOrThrow({
      where: { apiRequestId: id },
      select: { mode: true, rawContent: true, requestBodyFields: { select: { fieldName: true } } },
    });
    assert.equal(cuerpo.mode, 'form_urlencoded');
    assert.equal(cuerpo.rawContent, null);
    assert.deepEqual(
      cuerpo.requestBodyFields.map((c) => c.fieldName).sort(),
      ['grant_type', 'scope'],
    );

    const curl = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/requests/${id}/curl`,
      cookies: duena.cookies,
    });
    assert.ok(
      (curl.json() as { curl: string }).curl.includes(
        "--data-urlencode 'grant_type=client_credentials'",
      ),
      curl.body,
    );
  });

  it('`binary_file` sin fichero sigue siendo 422; `custom` ya se acepta (cambio de la fase 7)', async () => {
    // ACTUALIZADO EN LA FASE 7. La fase 6 rechazaba los dos modos porque no
    // había subida de ficheros y `custom` no tenía forma definida. El §2.1 del
    // BRIEF-FASE7 abre los dos:
    //  - `binary_file` **con** `binaryFileId` se guarda; **sin** él sigue
    //    siendo 422, que es lo que esta prueba defendía de verdad: que el
    //    CHECK del motor no reviente con un 500.
    //  - `custom` se guarda con `raw_content` y `binary_file_id` a NULL, que
    //    es la única forma que `ck_body_mode_shape` le permite.
    const sinFichero = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/collections/${coleccionId}/requests`,
      payload: { name: 'Modo binary_file', url: 'https://x.test', bodyType: 'binary_file' },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(sinFichero.statusCode, 422, sinFichero.body);

    const custom = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/collections/${coleccionId}/requests`,
      payload: { name: 'Modo custom', url: 'https://x.test', bodyType: 'custom' },
      cookies: duena.cookies,
      csrf: duena.csrf,
    });
    assert.equal(custom.statusCode, 201, custom.body);
    assert.equal(
      (custom.json() as { request: { bodyType: string } }).request.bodyType,
      'custom',
    );
  });
});

async function primerIdDePeticion(entorno: AppDePruebaPg, coleccionId: string): Promise<string> {
  const fila = await entorno.prisma.apiRequest.findFirstOrThrow({
    where: { collectionId: coleccionId, name: 'Listar clientes', deletedAt: null },
    select: { id: true },
  });
  return fila.id;
}
