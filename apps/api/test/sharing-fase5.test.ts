import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';

// El proxy de egreso del contenedor se aparta antes de nada: `undici` fija su
// dispatcher en el primer uso y, con `NODE_USE_ENV_PROXY=1`, manda por el proxy
// hasta el tráfico a 127.0.0.1. Aquí no hay `fetch`, pero `pg` y Prisma
// comparten entorno y el síntoma sería un fallo de red inexplicable.
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
  ALFABETO_CROCKFORD,
  BITS_DE_VERIFICADOR,
  CARACTERES_CODIGO,
  CARACTERES_SELECTOR,
  descomponerCodigo,
  generarCodigoDeAcceso,
  normalizarCodigo,
} from '../src/modules/sharing/access-code.ts';
import {
  BACKOFF_TECHO_MS,
  CLAVES,
  UMBRAL_POR_ENLACE,
  calcularBackoffDeEnlaceMs,
  permiteOperacion,
} from '../src/modules/sharing/share-policy.ts';
import {
  verificarFronteraDeSecretos,
  FugaDeSecretoDetectada,
} from '../src/modules/sharing/publication.ts';
import { PERFIL_ARGON2ID } from '../src/platform/crypto/password-hasher.ts';
import {
  RATE_LIMIT_STORE,
  type RateLimitStore,
} from '../src/platform/ratelimit/rate-limit-store.ts';
import {
  cookieDe,
  contrasenaDePrueba,
  crearAppDePruebaPostgres,
  marcaDeEjecucion,
  pedir,
  registrarYEntrar,
  type AppDePruebaPg,
  type Credenciales,
  type RespuestaInyectada,
} from './helpers/app-de-prueba-postgres.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * FASE 5 — COMPARTICIÓN PÚBLICA Y PRIVADA. Familia C-CODE completa.
 *
 * Contra el **PostgreSQL real** (`127.0.0.1:55432`, base `ceiba`). No hay
 * repositorio en memoria para las cuatro tablas del bloque 5 y no se simula
 * ninguno: lo que hay que demostrar —que el código en claro no cabe en ninguna
 * columna, que la revocación en cascada es transaccional, que publicar no
 * arrastra un secreto— sólo es demostrable con el motor delante.
 * ════════════════════════════════════════════════════════════════════════════
 */

const AQUI = dirname(fileURLToPath(import.meta.url));

/**
 * Las revisiones estáticas leen el **código fuente**, no el emitido: lo que hay
 * que afirmar es que nadie escribió `@Query('code')`, y eso sólo se ve en `.ts`.
 * Las pruebas se ejecutan desde `dist-test/test/`, así que la ruta se resuelve
 * probando las dos disposiciones posibles en vez de fijar una a ojo.
 */
const DIRECTORIO_SHARING = [
  join(AQUI, '..', '..', 'src', 'modules', 'sharing'), // desde dist-test/test
  join(AQUI, '..', 'src', 'modules', 'sharing'), // ejecutando desde test/
].find((candidata) => existsSync(join(candidata, 'access-code.ts')));
const FUENTES_SHARING = [
  'access-code.ts',
  'share-access.service.ts',
  'share-content.service.ts',
  'share-policy.ts',
  'share-principal.ts',
  'share-public.controller.ts',
  'share-session.guard.ts',
  'share-session.service.ts',
  'sharing-admin.controller.ts',
  'sharing-admin.service.ts',
  'sharing.errors.ts',
  'sharing.repository.ts',
  'publication.ts',
];

function leerFuente(nombre: string): string {
  if (DIRECTORIO_SHARING === undefined) {
    throw new Error('no se encontró el código fuente de src/modules/sharing');
  }
  return readFileSync(join(DIRECTORIO_SHARING, nombre), 'utf8');
}

// ---------------------------------------------------------------------------
// 1. C-CODE-01 — Generación criptográfica. Unitaria pura.
// ---------------------------------------------------------------------------

describe('C-CODE-01 · generación del código de acceso', () => {
  it('100 000 códigos: cero colisiones y distribución uniforme (χ², α=0,01)', () => {
    const total = 100_000;
    const vistos = new Set<string>();
    const frecuencias = new Map<string, number>();
    for (const simbolo of ALFABETO_CROCKFORD) frecuencias.set(simbolo, 0);

    for (let i = 0; i < total; i += 1) {
      const generado = generarCodigoDeAcceso();
      vistos.add(generado.codigoCrudo);
      for (const simbolo of generado.codigoCrudo) {
        frecuencias.set(simbolo, (frecuencias.get(simbolo) ?? 0) + 1);
      }
    }

    assert.equal(vistos.size, total, 'hubo colisiones entre códigos generados');

    const observaciones = total * CARACTERES_CODIGO;
    const esperado = observaciones / ALFABETO_CROCKFORD.length;
    let chiCuadrado = 0;
    for (const simbolo of ALFABETO_CROCKFORD) {
      const observado = frecuencias.get(simbolo) ?? 0;
      chiCuadrado += (observado - esperado) ** 2 / esperado;
    }
    // 31 grados de libertad, α=0,01 → valor crítico 52,191.
    assert.ok(
      chiCuadrado < 52.191,
      `χ²=${chiCuadrado.toFixed(3)} supera el crítico 52,191 con 31 gl y α=0,01`,
    );
  });

  it('el módulo NO importa Math.random, Date.now ni UUIDv1', () => {
    const fuente = leerFuente('access-code.ts');
    const codigo = fuente.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gmu, '');
    assert.ok(!codigo.includes('Math.random'), 'access-code.ts usa Math.random');
    assert.ok(!codigo.includes('Date.now'), 'access-code.ts usa Date.now');
    assert.ok(codigo.includes('randomBytes'), 'access-code.ts debe usar crypto.randomBytes');
  });

  it('la normalización acepta i/l/o y sigue rechazando un código incorrecto', () => {
    const generado = generarCodigoDeAcceso();
    const conConfusiones = generado.codigoEnClaro
      .toLowerCase()
      .replaceAll('1', 'l')
      .replaceAll('0', 'o')
      .replace(/-/gu, ' ');
    assert.equal(normalizarCodigo(conConfusiones), generado.codigoCrudo);

    const otro = generarCodigoDeAcceso();
    assert.notEqual(normalizarCodigo(otro.codigoEnClaro), generado.codigoCrudo);
    assert.equal(normalizarCodigo('demasiado-corto'), null);
    assert.equal(normalizarCodigo(123), null);
    assert.equal(normalizarCodigo('U'.repeat(CARACTERES_CODIGO)), null);
  });

  it('el verificador aporta 80 bits y el selector no es secreto', () => {
    assert.equal(BITS_DE_VERIFICADOR, 80);
    const generado = generarCodigoDeAcceso();
    const partes = descomponerCodigo(generado.codigoEnClaro);
    assert.ok(partes !== null);
    assert.equal(partes.selector, generado.codigoCrudo.slice(0, CARACTERES_SELECTOR));
    assert.equal(partes.verificador, generado.codigoCrudo.slice(CARACTERES_SELECTOR));
  });
});

// ---------------------------------------------------------------------------
// 2. C-CODE-03 — Backoff. Unitaria pura.
// ---------------------------------------------------------------------------

describe('C-CODE-03 · backoff exponencial, no bloqueo binario', () => {
  it('los primeros 10 fallos no penalizan y después dobla hasta el techo', () => {
    for (let fallos = 0; fallos <= UMBRAL_POR_ENLACE; fallos += 1) {
      assert.equal(calcularBackoffDeEnlaceMs(fallos), 0, `fallo ${fallos} no debe penalizar`);
    }
    assert.equal(calcularBackoffDeEnlaceMs(11), 1_000);
    assert.equal(calcularBackoffDeEnlaceMs(12), 2_000);
    assert.equal(calcularBackoffDeEnlaceMs(13), 4_000);
    assert.equal(calcularBackoffDeEnlaceMs(16), 32_000);
    assert.equal(calcularBackoffDeEnlaceMs(17), BACKOFF_TECHO_MS);
    // NUNCA bloqueo permanente: por mucho que insista el atacante, el techo es
    // 60 s y el destinatario legítimo entra al minuto siguiente.
    assert.equal(calcularBackoffDeEnlaceMs(10_000), BACKOFF_TECHO_MS);
  });
});

// ---------------------------------------------------------------------------
// 3. C-CODE-07 — Matriz de permisos. Unitaria pura.
// ---------------------------------------------------------------------------

describe('C-CODE-07 · lista de permitidos por permiso', () => {
  it('matriz completa permiso × operación, con las dos banderas del enlace', () => {
    const casos: ReadonlyArray<
      [
        'viewer' | 'viewer_export' | 'executor',
        boolean,
        boolean,
        'leer_coleccion' | 'leer_solicitud' | 'exportar' | 'ejecutar',
        boolean,
      ]
    > = [
      ['viewer', false, false, 'leer_coleccion', true],
      ['viewer', false, false, 'leer_solicitud', true],
      ['viewer', true, false, 'exportar', false], // el permiso no alcanza
      ['viewer', false, true, 'ejecutar', false],
      ['viewer_export', true, false, 'leer_coleccion', true],
      ['viewer_export', true, false, 'exportar', true],
      ['viewer_export', false, false, 'exportar', false], // bandera apagada
      ['viewer_export', false, true, 'ejecutar', false],
      ['executor', true, true, 'exportar', true],
      ['executor', true, true, 'ejecutar', true],
      ['executor', true, false, 'ejecutar', false], // ejecución desactivada
      ['executor', false, true, 'exportar', false],
    ];
    for (const [permiso, permiteExportar, permiteEjecutar, operacion, esperado] of casos) {
      assert.equal(
        permiteOperacion({ permiso, permiteExportar, permiteEjecutar }, operacion),
        esperado,
        `${permiso} export=${permiteExportar} exec=${permiteEjecutar} → ${operacion}`,
      );
    }
  });

  it('no existe ninguna operación de escritura en la política', () => {
    const fuente = leerFuente('share-policy.ts');
    for (const prohibida of ['crear', 'editar', 'borrar', 'escribir', 'write', 'delete']) {
      assert.ok(
        !new RegExp(`OperacionCompartida[\\s\\S]{0,400}'${prohibida}'`, 'u').test(fuente),
        `la unión OperacionCompartida no puede contener "${prohibida}"`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 4. C-CODE-05 — El código no cabe en una URL ni en un @Query. Estática.
// ---------------------------------------------------------------------------

describe('C-CODE-05 · el código nunca viaja por un canal que lo persista', () => {
  it('ningún @Query() del módulo se llama `code`', () => {
    for (const nombre of FUENTES_SHARING) {
      const fuente = leerFuente(nombre);
      const sospechas = fuente.match(/@Query\(\s*['"]([^'"]*)['"]/gu) ?? [];
      for (const sospecha of sospechas) {
        const parametro = /@Query\(\s*['"]([^'"]*)['"]/u.exec(sospecha)?.[1] ?? '';
        assert.ok(
          !['code', 'access_code', 'codigo', 'password', 'secret'].includes(
            parametro.toLowerCase(),
          ),
          `${nombre} declara @Query('${parametro}')`,
        );
      }
    }
  });

  it('el código sólo se lee del cuerpo, nunca de params ni de headers', () => {
    const controlador = leerFuente('share-public.controller.ts');
    assert.ok(
      /@Body\(new PipeZod\(esquemaAcceder\)\)/u.test(controlador),
      'el código debe llegar por @Body con su esquema',
    );
    assert.ok(!/@Param\(\s*['"]code['"]/u.test(controlador));
    assert.ok(!/@Headers\(\s*['"].*code.*['"]/u.test(controlador));
  });
});

// ---------------------------------------------------------------------------
// 5. Frontera de secretos — red de seguridad. Unitaria pura.
// ---------------------------------------------------------------------------

describe('frontera de secretos · la red salta ante una clave prohibida', () => {
  it('detecta secretId anidado y aborta', () => {
    assert.throws(
      () =>
        verificarFronteraDeSecretos({
          collection: { requests: [{ headers: [{ name: 'X', secretId: 'abc' }] }] },
        }),
      FugaDeSecretoDetectada,
    );
  });

  it('acepta una proyección sin punteros', () => {
    verificarFronteraDeSecretos({
      collection: { requests: [{ headers: [{ name: 'X', value: null, secret: true }] }] },
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BLOQUE CONTRA PostgreSQL REAL
// ═══════════════════════════════════════════════════════════════════════════

interface Escenario {
  readonly entorno: AppDePruebaPg;
  readonly duena: Credenciales;
  readonly workspaceId: string;
  readonly collectionId: string;
  readonly secretoLabel: string;
  readonly marcadorSecreto: string;
  readonly requestId: string;
}

let entorno: AppDePruebaPg;
let escenario: Escenario;
let limites: RateLimitStore;

/** Deja los contadores a cero para que una prueba no herede el abuso de otra. */
async function limpiarLimites(slug?: string): Promise<void> {
  await limites.reiniciar('global:127.0.0.1');
  await limites.reiniciar(CLAVES.fallosPorIp('127.0.0.1'));
  if (slug !== undefined) {
    await limites.reiniciar(CLAVES.fallosPorEnlace(slug));
    await limites.reiniciar(CLAVES.esperaPorEnlace(slug));
  }
}

async function crearWorkspaceYColeccion(
  app: AppDePruebaPg,
  credenciales: Credenciales,
  marca: string,
): Promise<{ workspaceId: string; collectionId: string }> {
  const ws = await pedir(app, {
    method: 'POST',
    url: '/api/v1/workspaces',
    payload: { slug: `ws-f5-${marca}`, name: `Workspace F5 ${marca}` },
    cookies: credenciales.cookies,
    csrf: credenciales.csrf,
  });
  if (ws.statusCode !== 201) throw new Error(`crear workspace: ${ws.statusCode} ${ws.body}`);
  const workspaceId = (ws.json() as { workspace: { id: string } }).workspace.id;

  const col = await pedir(app, {
    method: 'POST',
    url: `/api/v1/workspaces/${workspaceId}/collections`,
    payload: { slug: `col-f5-${marca}`, name: `Colección F5 ${marca}` },
    cookies: credenciales.cookies,
    csrf: credenciales.csrf,
  });
  if (col.statusCode !== 201) throw new Error(`crear colección: ${col.statusCode} ${col.body}`);
  const collectionId = (col.json() as { coleccion: { id: string } }).coleccion.id;
  return { workspaceId, collectionId };
}

/**
 * Siembra la colección con TODO lo que podría filtrarse: un `secrets` real, una
 * cabecera secreta que lo apunta, una variable de entorno secreta y scripts
 * pre/post. Si la publicación arrastra algo, aquí se verá.
 */
async function sembrarContenidoConSecretos(
  app: AppDePruebaPg,
  workspaceId: string,
  collectionId: string,
  usuarioId: string,
  marca: string,
): Promise<{ secretoLabel: string; marcadorSecreto: string; requestId: string }> {
  const prisma = app.prisma;
  const secretoLabel = `TOKEN-PROD-${marca}`;
  const marcadorSecreto = `VALOR-SECRETISIMO-${marca}`;

  const secreto = await prisma.secret.create({
    data: {
      workspaceId,
      scope: 'collection',
      scopeId: collectionId,
      label: secretoLabel,
      // El cifrado real es ámbito de C-SEC; aquí basta con que los bytes
      // contengan el marcador para poder afirmar que NO salen.
      ciphertext: new Uint8Array(Buffer.from(marcadorSecreto, 'utf8')),
      nonce: new Uint8Array(Buffer.from('012345678901', 'utf8')),
      aadFingerprint: new Uint8Array(Buffer.from('aad-de-prueba-32-bytes-exactos!!', 'utf8')),
      kekReference: 'env://CEIBA_SECRETS_MASTER_KEY',
      algorithm: 'AES-256-GCM',
      keyVersion: 1,
      state: 'active',
      createdByUserId: usuarioId,
    },
  });

  const solicitud = await prisma.apiRequest.create({
    data: {
      collectionId,
      name: 'Listar facturas',
      description: 'Endpoint de ejemplo con cabecera secreta.',
      method: 'GET',
      urlTemplate: 'https://api.ejemplo.test/{{version}}/facturas',
      bodyMode: 'none',
      authMode: 'inherit',
      sortKey: 'a0',
      preRequestScript: `// ojo: aqui hay un token ${marcadorSecreto}`,
      postResponseScript: `console.log("${marcadorSecreto}")`,
      createdByUserId: usuarioId,
    },
  });

  await prisma.requestHeader.create({
    data: {
      apiRequestId: solicitud.id,
      name: 'Authorization',
      value: null, // `ck_header_secret_xor`: si is_secret, value NULL y secret_id presente.
      secretId: secreto.id,
      isSecret: true,
      isEnabled: true,
      sortOrder: 0,
    },
  });
  await prisma.requestHeader.create({
    data: {
      apiRequestId: solicitud.id,
      name: 'Accept',
      value: 'application/json',
      isSecret: false,
      isEnabled: true,
      sortOrder: 1,
    },
  });

  const entornoFila = await prisma.environment.create({
    data: {
      workspaceId,
      collectionId,
      name: `Producción ${marca}`,
      kind: 'production',
      sortKey: 'a0',
      createdByUserId: usuarioId,
    },
  });
  await prisma.environmentVariable.create({
    data: {
      environmentId: entornoFila.id,
      key: 'api_token',
      valueKind: 'secret',
      initialValue: null,
      currentValue: null,
      secretId: secreto.id,
      isEnabled: true,
    },
  });
  await prisma.environmentVariable.create({
    data: {
      environmentId: entornoFila.id,
      key: 'base_url',
      valueKind: 'string',
      initialValue: 'https://api.ejemplo.test',
      currentValue: 'https://api.ejemplo.test',
      isEnabled: true,
    },
  });

  return { secretoLabel, marcadorSecreto, requestId: solicitud.id };
}

interface EnlaceCreado {
  readonly sharedLinkId: string;
  readonly slug: string;
  readonly accessCode: string | null;
}

async function crearEnlace(
  app: AppDePruebaPg,
  credenciales: Credenciales,
  collectionId: string,
  cuerpo: Record<string, unknown>,
): Promise<EnlaceCreado> {
  const respuesta = await pedir(app, {
    method: 'POST',
    url: `/api/v1/collections/${collectionId}/shares`,
    payload: cuerpo,
    cookies: credenciales.cookies,
    csrf: credenciales.csrf,
  });
  if (respuesta.statusCode !== 201) {
    throw new Error(`crear enlace: ${respuesta.statusCode} ${respuesta.body}`);
  }
  const datos = respuesta.json() as {
    share: { id: string; slug: string };
    accessCode: string | null;
  };
  return { sharedLinkId: datos.share.id, slug: datos.share.slug, accessCode: datos.accessCode };
}

async function accederA(
  app: AppDePruebaPg,
  slug: string,
  code: string | null,
): Promise<RespuestaInyectada> {
  // El CSRF se acuña en el GET de la página de acceso, igual que haría la SPA.
  const pagina = await pedir(app, { method: 'GET', url: `/api/v1/share/${slug}` });
  const csrf = cookieDe(pagina, app.config.cookies.nombreCsrf) ?? '';
  return pedir(app, {
    method: 'POST',
    url: `/api/v1/share/${slug}/access`,
    payload: code === null ? {} : { code },
    cookies: { [app.config.cookies.nombreCsrf]: csrf },
    csrf,
  });
}

function cookieDeComparticion(app: AppDePruebaPg, respuesta: RespuestaInyectada): string {
  const nombre = app.config.cookies.secure ? '__Secure-ceiba_share' : 'ceiba_share';
  const valor = cookieDe(respuesta, nombre);
  if (valor === undefined) throw new Error('no se emitió la cookie de compartición');
  return valor;
}

function nombreCookieShare(app: AppDePruebaPg): string {
  return app.config.cookies.secure ? '__Secure-ceiba_share' : 'ceiba_share';
}

before(async () => {
  const marca = marcaDeEjecucion();
  entorno = await crearAppDePruebaPostgres();
  limites = entorno.app.get<RateLimitStore>(RATE_LIMIT_STORE);

  const duena = await registrarYEntrar(
    entorno,
    `f5-${marca}@ceiba.local`,
    contrasenaDePrueba(marca),
    'Dueña F5',
  );
  const { workspaceId, collectionId } = await crearWorkspaceYColeccion(entorno, duena, marca);
  const sembrado = await sembrarContenidoConSecretos(
    entorno,
    workspaceId,
    collectionId,
    duena.usuarioId,
    marca,
  );

  escenario = { entorno, duena, workspaceId, collectionId, ...sembrado };
});

after(async () => {
  await entorno?.cerrar();
});

// ---------------------------------------------------------------------------
// 6. C-CODE-02 — Hash en reposo, contra el motor
// ---------------------------------------------------------------------------

describe('C-CODE-02 · hash en reposo (PostgreSQL real)', () => {
  it('ninguna columna de la fila contiene el código en claro', async () => {
    await limpiarLimites();
    const enlace = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      permission: 'viewer',
      requiresAccessCode: true,
      storeHint: true,
    });
    assert.ok(enlace.accessCode !== null, 'la creación debe devolver el código UNA vez');
    const codigo = enlace.accessCode;
    const crudo = codigo.replace(/-/gu, '');

    // Lectura CRUDA de la fila, columna a columna, directamente del motor.
    const filas = (await entorno.prisma.$queryRawUnsafe(
      'select * from share_access_codes where shared_link_id = $1::uuid',
      enlace.sharedLinkId,
    )) as ReadonlyArray<Record<string, unknown>>;
    assert.equal(filas.length, 1);
    const fila = filas[0] as Record<string, unknown>;

    const serializada = JSON.stringify(fila, (_clave, valor: unknown) =>
      typeof valor === 'bigint' ? valor.toString() : valor,
    );
    assert.ok(!serializada.includes(codigo), 'la fila contiene el código con guiones');
    assert.ok(!serializada.includes(crudo), 'la fila contiene el código sin guiones');
    // El verificador es la mitad secreta: tampoco puede estar.
    assert.ok(
      !serializada.includes(crudo.slice(CARACTERES_SELECTOR)),
      'la fila contiene el verificador en claro',
    );
    // El selector SÍ está, y es correcto: es público por diseño.
    assert.equal(fila['code_selector'], crudo.slice(0, CARACTERES_SELECTOR));
    // La pista son como mucho 4 caracteres y sólo porque se pidió.
    assert.equal(fila['code_hint'], crudo.slice(-4));

    const phc = Buffer.from(fila['code_verifier_hash'] as Uint8Array).toString('utf8');
    assert.match(
      phc,
      /^\$argon2id\$v=19\$m=19456,(p=1,t=2|t=2,p=1)\$/u,
      `el hash no tiene el perfil del registro: ${phc.slice(0, 48)}`,
    );
    assert.equal(fila['hash_algorithm'], 'argon2id');
    assert.deepEqual(fila['hash_params'], {
      m: PERFIL_ARGON2ID.memoryCost,
      t: PERFIL_ARGON2ID.timeCost,
      p: PERFIL_ARGON2ID.parallelism,
      saltLength: PERFIL_ARGON2ID.saltLength,
    });
  });

  it('la tabla no tiene ninguna columna capaz de contener el código en claro', async () => {
    const columnas = (await entorno.prisma.$queryRawUnsafe(
      "select column_name from information_schema.columns where table_name = 'share_access_codes'",
    )) as ReadonlyArray<{ column_name: string }>;
    const nombres = columnas.map((c) => c.column_name).sort();
    // `code_hint` existe pero el CHECK `ck_code_hint_len` la limita a 4.
    for (const prohibida of ['code', 'code_plain', 'plaintext', 'access_code', 'code_value']) {
      assert.ok(!nombres.includes(prohibida), `apareció la columna ${prohibida}`);
    }
    assert.ok(nombres.includes('code_selector'));
    assert.ok(nombres.includes('code_verifier_hash'));
  });

  it('dos códigos distintos producen hashes distintos (sal por fila)', async () => {
    await limpiarLimites();
    const a = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      requiresAccessCode: true,
    });
    const b = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      requiresAccessCode: true,
    });
    const hashes = (await entorno.prisma.$queryRawUnsafe(
      'select encode(code_verifier_hash, \'escape\') as phc from share_access_codes where shared_link_id in ($1::uuid, $2::uuid)',
      a.sharedLinkId,
      b.sharedLinkId,
    )) as ReadonlyArray<{ phc: string }>;
    assert.equal(hashes.length, 2);
    assert.notEqual(hashes[0]?.phc, hashes[1]?.phc);
  });
});

// ---------------------------------------------------------------------------
// 7. C-CODE-04 — INDISTINGUIBILIDAD. El corazón del encargo.
// ---------------------------------------------------------------------------

describe('C-CODE-04 · las tres causas de rechazo son indistinguibles', () => {
  it('mismo estado, mismo cuerpo byte a byte y mismo conjunto de cabeceras', async () => {
    const marca = marcaDeEjecucion();

    // (a) código incorrecto sobre un enlace sano
    await limpiarLimites();
    const sano = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      requiresAccessCode: true,
      codeLabel: `sano-${marca}`,
    });
    const codigoAjeno = generarCodigoDeAcceso().codigoEnClaro;

    // (b) enlace caducado
    const caducado = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      requiresAccessCode: true,
      codeLabel: `caducado-${marca}`,
    });
    await entorno.prisma.sharedLink.update({
      where: { id: caducado.sharedLinkId },
      data: { expiresAt: new Date(entorno.reloj.ahora().getTime() - 60_000) },
    });

    // (c) enlace revocado
    const revocado = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      requiresAccessCode: true,
      codeLabel: `revocado-${marca}`,
    });
    const revocacion = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/shares/${revocado.sharedLinkId}/revoke`,
      cookies: escenario.duena.cookies,
      csrf: escenario.duena.csrf,
    });
    assert.equal(revocacion.statusCode, 200);

    // (d) enlace inexistente, por si acaso
    const inexistente = 'noexisteestelink0000000';

    const casos: ReadonlyArray<[string, string, string | null]> = [
      ['codigo_incorrecto', sano.slug, codigoAjeno],
      ['caducado', caducado.slug, caducado.accessCode],
      ['revocado', revocado.slug, revocado.accessCode],
      ['inexistente', inexistente, codigoAjeno],
    ];

    const respuestas: Array<{ nombre: string; r: RespuestaInyectada }> = [];
    for (const [nombre, slug, code] of casos) {
      await limpiarLimites(slug);
      respuestas.push({ nombre, r: await accederA(entorno, slug, code) });
    }

    const referencia = respuestas[0]?.r;
    assert.ok(referencia !== undefined);
    for (const { nombre, r } of respuestas) {
      assert.equal(r.statusCode, 401, `${nombre}: el estado debe ser 401`);
      assert.equal(r.body, referencia.body, `${nombre}: el cuerpo difiere`);
      assert.equal(
        r.body,
        '{"error":"invalid_access","mensaje":"El enlace o el código no son válidos."}',
        `${nombre}: el cuerpo no es el canónico`,
      );
      const cabeceras = Object.keys(r.headers)
        .filter((c) => c !== 'date')
        .sort()
        .join(',');
      const cabecerasRef = Object.keys(referencia.headers)
        .filter((c) => c !== 'date')
        .sort()
        .join(',');
      assert.equal(cabeceras, cabecerasRef, `${nombre}: el conjunto de cabeceras difiere`);
      assert.equal(
        cookieDe(r, nombreCookieShare(entorno)),
        undefined,
        `${nombre}: no puede emitirse cookie de compartición en un fallo`,
      );
    }
  });

  it('los tiempos no distinguen las causas (medianas dentro de 15 ms)', async () => {
    const marca = marcaDeEjecucion();
    await limpiarLimites();

    const sano = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      requiresAccessCode: true,
      codeLabel: `t-sano-${marca}`,
    });
    const caducado = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      requiresAccessCode: true,
      codeLabel: `t-caducado-${marca}`,
    });
    await entorno.prisma.sharedLink.update({
      where: { id: caducado.sharedLinkId },
      data: { expiresAt: new Date(entorno.reloj.ahora().getTime() - 60_000) },
    });
    const revocado = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      requiresAccessCode: true,
      codeLabel: `t-revocado-${marca}`,
    });
    await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/shares/${revocado.sharedLinkId}/revoke`,
      cookies: escenario.duena.cookies,
      csrf: escenario.duena.csrf,
    });

    const escenarios: ReadonlyArray<[string, string, string | null]> = [
      ['inexistente', 'noexisteestelink0000001', generarCodigoDeAcceso().codigoEnClaro],
      ['codigo_incorrecto', sano.slug, generarCodigoDeAcceso().codigoEnClaro],
      ['caducado', caducado.slug, caducado.accessCode],
      ['revocado', revocado.slug, revocado.accessCode],
    ];

    const MUESTRAS = 15;
    const medianas = new Map<string, number>();

    for (const [nombre, slug, code] of escenarios) {
      const tiempos: number[] = [];
      for (let i = 0; i < MUESTRAS; i += 1) {
        await limpiarLimites(slug);
        // El mirror durable también se limpia, y el de LOS TRES enlaces: cada
        // intento incrementa `failed_attempt_count` de la fila del código que
        // localizó, incluso cuando la causa la puso el enlace. Si no se
        // reinicia, a la undécima muestra el escenario recibe 429 y la medida
        // estaría midiendo el rate limiting, no la igualación de tiempos.
        await entorno.prisma.shareAccessCode.updateMany({
          where: {
            sharedLinkId: {
              in: [sano.sharedLinkId, caducado.sharedLinkId, revocado.sharedLinkId],
            },
          },
          data: { failedAttemptCount: 0, lockedUntil: null },
        });
        const t0 = process.hrtime.bigint();
        const r = await accederA(entorno, slug, code);
        const t1 = process.hrtime.bigint();
        assert.equal(r.statusCode, 401, `${nombre}: se esperaba 401`);
        tiempos.push(Number(t1 - t0) / 1e6);
      }
      tiempos.sort((a, b) => a - b);
      const mediana = tiempos[Math.floor(tiempos.length / 2)] ?? 0;
      medianas.set(nombre, mediana);
      // eslint-disable-next-line no-console
      console.log(
        `    tiempos ${nombre.padEnd(18)} mediana=${mediana.toFixed(1)}ms ` +
          `min=${(tiempos[0] ?? 0).toFixed(1)} max=${(tiempos[tiempos.length - 1] ?? 0).toFixed(1)}`,
      );
    }

    const valores = [...medianas.values()];
    const maximo = Math.max(...valores);
    const minimo = Math.min(...valores);
    // C-CODE-04 marca esta parte como no bloqueante por el ruido de CPU de un
    // contenedor compartido. Aquí sí se afirma, porque el piso de 150 ms
    // absorbe la varianza del motor; el umbral es el de la especificación.
    assert.ok(
      maximo - minimo < 15,
      `las medianas difieren ${(maximo - minimo).toFixed(1)} ms: ` +
        [...medianas].map(([k, v]) => `${k}=${v.toFixed(1)}`).join(' '),
    );
  });

  it('la causa REAL sí se distingue en la auditoría del propietario', async () => {
    const marca = marcaDeEjecucion();
    await limpiarLimites();

    const enlace = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      requiresAccessCode: true,
      codeLabel: `audit-${marca}`,
    });

    // 1) código incorrecto
    await limpiarLimites(enlace.slug);
    assert.equal(
      (await accederA(entorno, enlace.slug, generarCodigoDeAcceso().codigoEnClaro)).statusCode,
      401,
    );

    // 2) código caducado
    await entorno.prisma.shareAccessCode.updateMany({
      where: { sharedLinkId: enlace.sharedLinkId },
      data: { expiresAt: new Date(entorno.reloj.ahora().getTime() - 1_000) },
    });
    await limpiarLimites(enlace.slug);
    assert.equal((await accederA(entorno, enlace.slug, enlace.accessCode)).statusCode, 401);

    // 3) código revocado
    await entorno.prisma.shareAccessCode.updateMany({
      where: { sharedLinkId: enlace.sharedLinkId },
      data: {
        expiresAt: null,
        state: 'revoked',
        revokedAt: entorno.reloj.ahora(),
      },
    });
    await limpiarLimites(enlace.slug);
    assert.equal((await accederA(entorno, enlace.slug, enlace.accessCode)).statusCode, 401);

    const auditoria = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/shares/${enlace.sharedLinkId}/audit`,
      cookies: escenario.duena.cookies,
    });
    assert.equal(auditoria.statusCode, 200);
    const cuerpo = auditoria.json() as {
      attempts: Array<{ result: string }>;
      summary: Record<string, number>;
    };
    const resultados = cuerpo.attempts.map((a) => a.result).sort();
    assert.deepEqual(
      resultados,
      ['expired', 'invalid_code', 'revoked'],
      `la auditoría debe distinguir las tres causas; recibido ${JSON.stringify(resultados)}`,
    );
    assert.equal(cuerpo.summary['invalid_code'], 1);
    assert.equal(cuerpo.summary['expired'], 1);
    assert.equal(cuerpo.summary['revoked'], 1);

    // Y la auditoría tampoco guarda el código: ni entero ni parcial.
    const bruto = JSON.stringify(cuerpo);
    assert.ok(!bruto.includes(enlace.accessCode ?? '@@'));
    assert.ok(!bruto.includes((enlace.accessCode ?? '@@').replace(/-/gu, '')));
  });
});

// ---------------------------------------------------------------------------
// 8. C-CODE-06 — Revocación y expiración con efecto inmediato
// ---------------------------------------------------------------------------

describe('C-CODE-06 · revocación con efecto inmediato y en cascada', () => {
  it('un enlace revocado deja de servir en la PETICIÓN SIGUIENTE', async () => {
    await limpiarLimites();
    const enlace = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      permission: 'viewer',
      requiresAccessCode: true,
    });

    const acceso = await accederA(entorno, enlace.slug, enlace.accessCode);
    assert.equal(acceso.statusCode, 200, acceso.body);
    const cookie = cookieDeComparticion(entorno, acceso);

    const antes = await pedir(entorno, {
      method: 'GET',
      url: '/api/v1/share/content/collection',
      cookies: { [nombreCookieShare(entorno)]: cookie },
    });
    assert.equal(antes.statusCode, 200, antes.body);

    const revocacion = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/shares/${enlace.sharedLinkId}/revoke`,
      cookies: escenario.duena.cookies,
      csrf: escenario.duena.csrf,
    });
    assert.equal(revocacion.statusCode, 200);
    assert.ok(
      (revocacion.json() as { revokedSessions: number }).revokedSessions >= 1,
      'la revocación debe cancelar en cascada las sesiones abiertas',
    );

    // Sin esperas, sin reinicio, sin avanzar el reloj.
    const despues = await pedir(entorno, {
      method: 'GET',
      url: '/api/v1/share/content/collection',
      cookies: { [nombreCookieShare(entorno)]: cookie },
    });
    assert.equal(despues.statusCode, 401);
    assert.equal(
      despues.body,
      '{"error":"invalid_access","mensaje":"El enlace o el código no son válidos."}',
    );
  });

  it('revocar el enlace invalida DOS sesiones distintas abiertas desde él', async () => {
    await limpiarLimites();
    const enlace = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      requiresAccessCode: true,
    });
    const cookieA = cookieDeComparticion(
      entorno,
      await accederA(entorno, enlace.slug, enlace.accessCode),
    );
    const cookieB = cookieDeComparticion(
      entorno,
      await accederA(entorno, enlace.slug, enlace.accessCode),
    );
    assert.notEqual(cookieA, cookieB);

    await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/shares/${enlace.sharedLinkId}/revoke`,
      cookies: escenario.duena.cookies,
      csrf: escenario.duena.csrf,
    });

    for (const cookie of [cookieA, cookieB]) {
      const r = await pedir(entorno, {
        method: 'GET',
        url: '/api/v1/share/content/collection',
        cookies: { [nombreCookieShare(entorno)]: cookie },
      });
      assert.equal(r.statusCode, 401);
    }
  });

  it('la expiración se evalúa con la hora del SERVIDOR (reloj inyectado)', async () => {
    await limpiarLimites();
    const enlace = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      requiresAccessCode: true,
    });
    const cookie = cookieDeComparticion(
      entorno,
      await accederA(entorno, enlace.slug, enlace.accessCode),
    );
    assert.equal(
      (
        await pedir(entorno, {
          method: 'GET',
          url: '/api/v1/share/content/collection',
          cookies: { [nombreCookieShare(entorno)]: cookie },
        })
      ).statusCode,
      200,
    );

    entorno.reloj.avanzarMs(3 * 3_600_000); // más allá del TTL de 2 h
    const despues = await pedir(entorno, {
      method: 'GET',
      url: '/api/v1/share/content/collection',
      cookies: { [nombreCookieShare(entorno)]: cookie },
    });
    assert.equal(despues.statusCode, 401);
    entorno.reloj.avanzarMs(-3 * 3_600_000);
  });

  it('rotar el código cierra las sesiones que ese código había abierto', async () => {
    await limpiarLimites();
    const enlace = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      requiresAccessCode: true,
    });
    const cookie = cookieDeComparticion(
      entorno,
      await accederA(entorno, enlace.slug, enlace.accessCode),
    );

    const rotacion = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/shares/${enlace.sharedLinkId}/codes`,
      payload: {},
      cookies: escenario.duena.cookies,
      csrf: escenario.duena.csrf,
    });
    assert.equal(rotacion.statusCode, 201, rotacion.body);
    const nuevo = rotacion.json() as { accessCode: string; closedSessions: number };
    assert.ok(nuevo.closedSessions >= 1);
    assert.notEqual(nuevo.accessCode, enlace.accessCode);

    const despues = await pedir(entorno, {
      method: 'GET',
      url: '/api/v1/share/content/collection',
      cookies: { [nombreCookieShare(entorno)]: cookie },
    });
    assert.equal(despues.statusCode, 401);

    // El código viejo ya no entra; el nuevo sí.
    await limpiarLimites(enlace.slug);
    assert.equal((await accederA(entorno, enlace.slug, enlace.accessCode)).statusCode, 401);
    await limpiarLimites(enlace.slug);
    assert.equal((await accederA(entorno, enlace.slug, nuevo.accessCode)).statusCode, 200);
  });
});

// ---------------------------------------------------------------------------
// 9. Requisito 6 — publicar NO arrastra secretos
// ---------------------------------------------------------------------------

describe('publicar una colección no arrastra secretos', () => {
  it('ni el contenido compartido ni la exportación contienen el secreto', async () => {
    await limpiarLimites();
    const enlace = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      permission: 'viewer_export',
      requiresAccessCode: true,
      allowExport: true,
    });
    const cookie = cookieDeComparticion(
      entorno,
      await accederA(entorno, enlace.slug, enlace.accessCode),
    );

    const coleccion = await pedir(entorno, {
      method: 'GET',
      url: '/api/v1/share/content/collection',
      cookies: { [nombreCookieShare(entorno)]: cookie },
    });
    assert.equal(coleccion.statusCode, 200, coleccion.body);

    const exportacion = await pedir(entorno, {
      method: 'GET',
      url: '/api/v1/share/content/export',
      cookies: { [nombreCookieShare(entorno)]: cookie },
    });
    assert.equal(exportacion.statusCode, 200, exportacion.body);

    const secretoId = (
      (await entorno.prisma.secret.findFirst({
        where: { label: escenario.secretoLabel },
        select: { id: true },
      })) ?? { id: '@@sin-secreto@@' }
    ).id;

    for (const [nombre, respuesta] of [
      ['contenido', coleccion],
      ['exportación', exportacion],
    ] as const) {
      const texto = respuesta.body;
      assert.ok(
        !texto.includes(escenario.marcadorSecreto),
        `${nombre}: contiene el valor del secreto`,
      );
      assert.ok(
        !texto.includes(escenario.secretoLabel),
        `${nombre}: contiene la etiqueta del secreto`,
      );
      assert.ok(!texto.includes(secretoId), `${nombre}: contiene el id del secreto`);
      assert.ok(!texto.includes('secretId'), `${nombre}: contiene la clave secretId`);
      assert.ok(!texto.includes('api_token'), `${nombre}: contiene una variable de entorno`);
      assert.ok(!texto.includes('base_url'), `${nombre}: contiene un valor de entorno`);
      // El sobre de exportación DECLARA en `excludes` que no lleva entornos, así
      // que no vale buscar la palabra suelta: lo que no puede aparecer es una
      // CLAVE `environments` con contenido detrás.
      assert.ok(!texto.includes('"environments":'), `${nombre}: publica entornos`);
      assert.ok(
        !texto.includes('preRequestScript":"'),
        `${nombre}: contiene el cuerpo de un script`,
      );
    }

    // Lo que SÍ debe publicarse: la cabecera marcada como secreta aparece con
    // el nombre y sin valor, para que el consumidor sepa que tiene que aportarlo.
    const datos = coleccion.json() as {
      collection: {
        requests: Array<{
          headers: Array<{ name: string; value: string | null; secret: boolean }>;
          hasPreRequestScript: boolean;
        }>;
      };
    };
    const solicitud = datos.collection.requests.find((r) =>
      r.headers.some((h) => h.name === 'Authorization'),
    );
    assert.ok(solicitud !== undefined, 'la solicitud sembrada debe publicarse');
    const autorizacion = solicitud.headers.find((h) => h.name === 'Authorization');
    assert.deepEqual(autorizacion, {
      name: 'Authorization',
      value: null,
      description: null,
      enabled: true,
      secret: true,
    });
    const accept = solicitud.headers.find((h) => h.name === 'Accept');
    assert.equal(accept?.value, 'application/json');
    assert.equal(accept?.secret, false);
    assert.equal(solicitud.hasPreRequestScript, true);
  });
});

// ---------------------------------------------------------------------------
// 10. C-CODE-03 contra el motor — backoff real, no bloqueo binario
// ---------------------------------------------------------------------------

describe('C-CODE-03 · límite de intentos contra el motor', () => {
  it('10 fallos → 429 con Retry-After; el correcto también espera; luego entra', async () => {
    await limpiarLimites();
    const enlace = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      requiresAccessCode: true,
    });
    await limpiarLimites(enlace.slug);

    for (let intento = 1; intento <= UMBRAL_POR_ENLACE; intento += 1) {
      const r = await accederA(entorno, enlace.slug, generarCodigoDeAcceso().codigoEnClaro);
      assert.equal(r.statusCode, 401, `intento ${intento}: se esperaba 401, no ${r.statusCode}`);
    }

    const limitado = await accederA(entorno, enlace.slug, generarCodigoDeAcceso().codigoEnClaro);
    assert.equal(limitado.statusCode, 429, limitado.body);
    assert.ok(
      Number(limitado.headers['retry-after']) >= 1,
      `falta Retry-After: ${JSON.stringify(limitado.headers['retry-after'])}`,
    );

    // El intento con el código CORRECTO también se rechaza durante el backoff.
    const correctoEnEspera = await accederA(entorno, enlace.slug, enlace.accessCode);
    assert.equal(correctoEnEspera.statusCode, 429, correctoEnEspera.body);

    // Al avanzar el reloj más allá del backoff y de la ventana, vuelve a entrar.
    entorno.reloj.avanzarMs(3_600_001);
    await entorno.prisma.shareAccessCode.updateMany({
      where: { sharedLinkId: enlace.sharedLinkId },
      data: { failedAttemptCount: 0, lockedUntil: null },
    });
    const tras = await accederA(entorno, enlace.slug, enlace.accessCode);
    assert.equal(tras.statusCode, 200, tras.body);
    entorno.reloj.avanzarMs(-3_600_001);
  });

  it('el bloqueo NUNCA es permanente: el mirror durable guarda locked_until acotado', async () => {
    const filas = (await entorno.prisma.$queryRawUnsafe(
      'select max(extract(epoch from (locked_until - now()))) as segundos from share_access_codes where locked_until is not null',
    )) as ReadonlyArray<{ segundos: number | null }>;
    const segundos = filas[0]?.segundos;
    if (segundos !== null && segundos !== undefined) {
      assert.ok(
        Number(segundos) <= BACKOFF_TECHO_MS / 1000 + 5,
        `locked_until llega a ${segundos}s, por encima del techo de 60 s`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 11. C-CODE-05 contra el motor — el código no aparece en ningún registro
// ---------------------------------------------------------------------------

describe('C-CODE-05 · el código no aparece en logs, auditoría ni URLs', () => {
  it('el flujo completo no escribe el código en ninguna salida del logger', async () => {
    await limpiarLimites();
    const capturado: string[] = [];
    const original = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    };
    const captura =
      (previa: (...args: unknown[]) => void) =>
      (...args: unknown[]): void => {
        capturado.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
        previa(...args);
      };
    console.log = captura(original.log) as typeof console.log;
    console.info = captura(original.info) as typeof console.info;
    console.warn = captura(original.warn) as typeof console.warn;
    console.error = captura(original.error) as typeof console.error;
    console.debug = captura(original.debug) as typeof console.debug;

    let codigo = '';
    try {
      const enlace = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
        requiresAccessCode: true,
      });
      codigo = enlace.accessCode ?? '';
      await limpiarLimites(enlace.slug);
      await accederA(entorno, enlace.slug, generarCodigoDeAcceso().codigoEnClaro); // fallo
      await limpiarLimites(enlace.slug);
      await accederA(entorno, enlace.slug, codigo); // éxito
    } finally {
      console.log = original.log;
      console.info = original.info;
      console.warn = original.warn;
      console.error = original.error;
      console.debug = original.debug;
    }

    const todo = capturado.join('\n');
    assert.ok(codigo.length > 0);
    assert.ok(!todo.includes(codigo), 'el código apareció en la salida del logger');
    assert.ok(
      !todo.includes(codigo.replace(/-/gu, '')),
      'el código sin guiones apareció en la salida del logger',
    );
  });

  it('el código en la URL se rechaza con 400 y NO se valida', async () => {
    await limpiarLimites();
    const enlace = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      requiresAccessCode: true,
    });
    const r = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/share/${enlace.slug}?code=${encodeURIComponent(enlace.accessCode ?? '')}`,
    });
    assert.equal(r.statusCode, 400, r.body);
    assert.equal(
      (r.json() as { error: string }).error,
      'code_in_url',
      'debe decir explícitamente que el código no puede ir en la URL',
    );
    assert.equal(cookieDe(r, nombreCookieShare(entorno)), undefined);
  });

  it('`audit_logs` no guarda el código en su metadata', async () => {
    await limpiarLimites();
    const enlace = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      requiresAccessCode: true,
    });
    await limpiarLimites(enlace.slug);
    assert.equal((await accederA(entorno, enlace.slug, enlace.accessCode)).statusCode, 200);
    // La persistencia de auditoría es `void`-asíncrona: se le da margen.
    await new Promise((resolver) => setTimeout(resolver, 300));

    const filas = (await entorno.prisma.$queryRawUnsafe(
      "select action, metadata::text as meta from audit_logs where action like 'share.%' order by occurred_at desc limit 50",
    )) as ReadonlyArray<{ action: string; meta: string }>;
    assert.ok(filas.length > 0, 'debería haberse auditado al menos un evento de compartición');
    const crudo = (enlace.accessCode ?? '@@').replace(/-/gu, '');
    for (const fila of filas) {
      assert.ok(!fila.meta.includes(enlace.accessCode ?? '@@'), `${fila.action} filtró el código`);
      assert.ok(!fila.meta.includes(crudo), `${fila.action} filtró el código sin guiones`);
    }
  });
});

// ---------------------------------------------------------------------------
// 12. C-CODE-07 contra el motor — el permiso se aplica en el servidor
// ---------------------------------------------------------------------------

describe('C-CODE-07 · el permiso del enlace se aplica en el servidor', () => {
  it('viewer no exporta, viewer_export sin bandera tampoco, y con bandera sí', async () => {
    await limpiarLimites();

    const soloLectura = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      permission: 'viewer',
      requiresAccessCode: true,
      allowExport: true, // la bandera no basta: el permiso no alcanza
    });
    const cookieLectura = cookieDeComparticion(
      entorno,
      await accederA(entorno, soloLectura.slug, soloLectura.accessCode),
    );
    const exportaLectura = await pedir(entorno, {
      method: 'GET',
      url: '/api/v1/share/content/export',
      cookies: { [nombreCookieShare(entorno)]: cookieLectura },
    });
    assert.equal(exportaLectura.statusCode, 401);

    const sinBandera = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      permission: 'viewer_export',
      requiresAccessCode: true,
      allowExport: false,
    });
    const cookieSinBandera = cookieDeComparticion(
      entorno,
      await accederA(entorno, sinBandera.slug, sinBandera.accessCode),
    );
    assert.equal(
      (
        await pedir(entorno, {
          method: 'GET',
          url: '/api/v1/share/content/export',
          cookies: { [nombreCookieShare(entorno)]: cookieSinBandera },
        })
      ).statusCode,
      401,
    );
    // Pero sí lee, que es lo que su permiso permite.
    assert.equal(
      (
        await pedir(entorno, {
          method: 'GET',
          url: '/api/v1/share/content/collection',
          cookies: { [nombreCookieShare(entorno)]: cookieSinBandera },
        })
      ).statusCode,
      200,
    );
  });

  it('una sesión de compartición NO alcanza ninguna ruta del workspace', async () => {
    await limpiarLimites();
    const enlace = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      requiresAccessCode: true,
    });
    const cookie = cookieDeComparticion(
      entorno,
      await accederA(entorno, enlace.slug, enlace.accessCode),
    );
    const cookies = { [nombreCookieShare(entorno)]: cookie };

    const rutas: ReadonlyArray<[string, string]> = [
      ['GET', `/api/v1/workspaces/${escenario.workspaceId}`],
      ['GET', `/api/v1/workspaces/${escenario.workspaceId}/members`],
      ['GET', `/api/v1/collections/${escenario.collectionId}`],
      ['GET', `/api/v1/collections/${escenario.collectionId}/shares`],
      ['GET', `/api/v1/shares/${enlace.sharedLinkId}/audit`],
      ['GET', '/api/v1/auth/me'],
    ];
    for (const [metodo, url] of rutas) {
      const r = await pedir(entorno, {
        method: metodo as 'GET',
        url,
        cookies,
      });
      assert.equal(r.statusCode, 401, `${metodo} ${url} devolvió ${r.statusCode}`);
    }
  });

  it('no hay ninguna ruta de escritura alcanzable con sesión de compartición', async () => {
    const controlador = leerFuente('share-public.controller.ts');
    const mutantes = controlador.match(/@(Post|Put|Patch|Delete)\(([^)]*)\)/gu) ?? [];
    // Las únicas mutaciones admitidas son canjear el código y cerrar sesión.
    const admitidas = ["@Post(':slug/access')", "@Post('session/logout')"];
    for (const mutante of mutantes) {
      assert.ok(
        admitidas.includes(mutante),
        `ruta mutante no admitida en la superficie compartida: ${mutante}`,
      );
    }
  });

  it('una solicitud de OTRA colección no se sirve, aunque se conozca su id', async () => {
    await limpiarLimites();
    const marca = marcaDeEjecucion();
    const otra = await crearWorkspaceYColeccion(entorno, escenario.duena, `otra-${marca}`);
    const ajena = await entorno.prisma.apiRequest.create({
      data: {
        collectionId: otra.collectionId,
        name: 'Ajena',
        method: 'GET',
        urlTemplate: 'https://ajena.test/',
        bodyMode: 'none',
        authMode: 'inherit',
        sortKey: 'a0',
        createdByUserId: escenario.duena.usuarioId,
      },
    });

    const enlace = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      requiresAccessCode: true,
    });
    const cookie = cookieDeComparticion(
      entorno,
      await accederA(entorno, enlace.slug, enlace.accessCode),
    );

    const propia = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/share/content/requests/${escenario.requestId}`,
      cookies: { [nombreCookieShare(entorno)]: cookie },
    });
    assert.equal(propia.statusCode, 200, propia.body);

    const cruzada = await pedir(entorno, {
      method: 'GET',
      url: `/api/v1/share/content/requests/${ajena.id}`,
      cookies: { [nombreCookieShare(entorno)]: cookie },
    });
    assert.equal(cruzada.statusCode, 401);
  });
});

// ---------------------------------------------------------------------------
// 13. Modos de visibilidad y página de acceso
// ---------------------------------------------------------------------------

describe('modos de visibilidad y página de acceso', () => {
  it('la visibilidad de la colección se deriva de los enlaces vivos', async () => {
    await limpiarLimites();
    const marca = marcaDeEjecucion();
    const propia = await crearWorkspaceYColeccion(entorno, escenario.duena, `vis-${marca}`);

    const leerVisibilidad = async (): Promise<string | null> => {
      const r = await pedir(entorno, {
        method: 'GET',
        url: `/api/v1/collections/${propia.collectionId}/shares`,
        cookies: escenario.duena.cookies,
      });
      return (r.json() as { visibility: string | null }).visibility;
    };

    assert.equal(await leerVisibilidad(), 'private');

    const privado = await crearEnlace(entorno, escenario.duena, propia.collectionId, {
      requiresAccessCode: true,
    });
    assert.equal(await leerVisibilidad(), 'link_private');

    const publico = await crearEnlace(entorno, escenario.duena, propia.collectionId, {
      requiresAccessCode: false,
    });
    assert.equal(await leerVisibilidad(), 'link_public');

    for (const id of [privado.sharedLinkId, publico.sharedLinkId]) {
      await pedir(entorno, {
        method: 'POST',
        url: `/api/v1/shares/${id}/revoke`,
        cookies: escenario.duena.cookies,
        csrf: escenario.duena.csrf,
      });
    }
    assert.equal(await leerVisibilidad(), 'private');
  });

  it('la página de acceso no permite enumerar slugs', async () => {
    await limpiarLimites();
    const privado = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      requiresAccessCode: true,
    });
    const publico = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      requiresAccessCode: false,
    });
    const revocado = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      requiresAccessCode: true,
    });
    await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/shares/${revocado.sharedLinkId}/revoke`,
      cookies: escenario.duena.cookies,
      csrf: escenario.duena.csrf,
    });

    const estadoDe = async (slug: string): Promise<string> => {
      const r = await pedir(entorno, { method: 'GET', url: `/api/v1/share/${slug}` });
      assert.equal(r.statusCode, 200);
      assert.equal(r.headers['referrer-policy'], 'no-referrer');
      assert.equal(r.headers['cache-control'], 'no-store');
      return (r.json() as { estado: string }).estado;
    };

    assert.equal(await estadoDe(privado.slug), 'code_required');
    assert.equal(await estadoDe(revocado.slug), 'code_required');
    assert.equal(await estadoDe('slugquenoexisteenabsoluto00'), 'code_required');
    assert.equal(await estadoDe(publico.slug), 'open');
  });

  it('un enlace público abre sesión sin código, y sólo con los permisos del enlace', async () => {
    await limpiarLimites();
    const publico = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      permission: 'viewer',
      requiresAccessCode: false,
    });
    assert.equal(publico.accessCode, null, 'un enlace público no emite código');

    const acceso = await accederA(entorno, publico.slug, null);
    assert.equal(acceso.statusCode, 200, acceso.body);
    const cookie = cookieDeComparticion(entorno, acceso);

    const sesion = await pedir(entorno, {
      method: 'GET',
      url: '/api/v1/share/session/me',
      cookies: { [nombreCookieShare(entorno)]: cookie },
    });
    assert.equal(sesion.statusCode, 200);
    assert.deepEqual(
      { ...(sesion.json() as Record<string, unknown>), expiresAt: '<fecha>' },
      { permission: 'viewer', expiresAt: '<fecha>', canExport: false, canExecute: false },
    );
  });

  it('cerrar sesión de compartición la revoca de inmediato', async () => {
    await limpiarLimites();
    const publico = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      requiresAccessCode: false,
    });
    const acceso = await accederA(entorno, publico.slug, null);
    const cookie = cookieDeComparticion(entorno, acceso);
    const pagina = await pedir(entorno, { method: 'GET', url: `/api/v1/share/${publico.slug}` });
    const csrf = cookieDe(pagina, entorno.config.cookies.nombreCsrf) ?? '';

    const salida = await pedir(entorno, {
      method: 'POST',
      url: '/api/v1/share/session/logout',
      cookies: {
        [nombreCookieShare(entorno)]: cookie,
        [entorno.config.cookies.nombreCsrf]: csrf,
      },
      csrf,
    });
    assert.equal(salida.statusCode, 204);

    assert.equal(
      (
        await pedir(entorno, {
          method: 'GET',
          url: '/api/v1/share/content/collection',
          cookies: { [nombreCookieShare(entorno)]: cookie },
        })
      ).statusCode,
      401,
    );
  });

  it('C-CODE-08: la ejecución compartida está desactivada y falla cerrado', async () => {
    await limpiarLimites();
    const r = await pedir(entorno, {
      method: 'POST',
      url: `/api/v1/collections/${escenario.collectionId}/shares`,
      payload: { permission: 'executor', requiresAccessCode: true, allowExecution: true },
      cookies: escenario.duena.cookies,
      csrf: escenario.duena.csrf,
    });
    assert.equal(r.statusCode, 422, r.body);

    // Y no existe ninguna ruta de ejecución compartida.
    const enlace = await crearEnlace(entorno, escenario.duena, escenario.collectionId, {
      permission: 'executor',
      requiresAccessCode: true,
    });
    const cookie = cookieDeComparticion(
      entorno,
      await accederA(entorno, enlace.slug, enlace.accessCode),
    );
    const ejecucion = await pedir(entorno, {
      method: 'POST',
      url: '/api/v1/share/content/execute',
      payload: {},
      cookies: { [nombreCookieShare(entorno)]: cookie },
    });
    assert.ok(
      ejecucion.statusCode === 404 || ejecucion.statusCode === 403,
      `la ruta de ejecución compartida no debe existir; devolvió ${ejecucion.statusCode}`,
    );
  });
});
