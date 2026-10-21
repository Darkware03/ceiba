#!/usr/bin/env node
/**
 * Arnés de ejercicio HTTP de las 14 rutas del módulo `sharing` (fase 5).
 *
 * POR QUÉ EXISTE, habiendo 36 pruebas automatizadas: las pruebas montan la
 * aplicación **en proceso** con `inject()`. Esto es lo contrario: golpea una
 * API ya arrancada **por la red**, igual que lo haría la SPA, y detecta lo que
 * sólo falla en el camino real — prefijo global, prefijo de cookie según TLS,
 * `Path` de la cookie de compartición, CSRF, orden de dependencias.
 *
 * Mismo estilo y mismas razones que `ejercitar-studio.mjs`: sin dependencias,
 * fuera del grafo de compilación, ejecutable contra un contenedor recién
 * levantado. Node 24 ya trae `fetch` y `getSetCookie()`.
 *
 * Uso:
 *   CEIBA_API_BASE=http://127.0.0.1:3010 node apps/api/scripts/ejercitar-comparticion.mjs
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
process.env.NO_PROXY = '127.0.0.1,localhost';

const BASE = (process.env.CEIBA_API_BASE ?? 'http://127.0.0.1:3010').replace(/\/+$/u, '');
const PREFIJO = 'api/v1';
const ORIGEN = origenDe(process.env.CEIBA_PUBLIC_URL ?? BASE);
const TIEMPO_LIMITE_MS = Number(process.env.CEIBA_TIMEOUT_MS ?? 20000);
const MARCA = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
const DIRECTORIO = dirname(fileURLToPath(import.meta.url));
const FICHERO_RESUMEN = join(DIRECTORIO, '.ultimo-ejercicio-comparticion.json');

function origenDe(valor) {
  try {
    return new URL(valor).origin;
  } catch {
    return valor;
  }
}

// --------------------------------------------------------------------------
// Tarro de cookies mínimo (dos tarros: el del propietario y el del visitante)
// --------------------------------------------------------------------------

function nuevoTarro() {
  return new Map();
}

function guardarCookies(tarro, respuesta) {
  for (const linea of respuesta.headers.getSetCookie?.() ?? []) {
    const [par] = linea.split(';');
    const indice = par.indexOf('=');
    if (indice <= 0) continue;
    const nombre = par.slice(0, indice).trim();
    const valor = par.slice(indice + 1).trim();
    if (valor === '' || /Max-Age=0/iu.test(linea)) tarro.delete(nombre);
    else tarro.set(nombre, valor);
  }
}

function cabeceraCookie(tarro) {
  return [...tarro.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

const resultados = [];

async function llamar(descripcion, metodo, ruta, { tarro, cuerpo, esperado } = {}) {
  const url = `${BASE}/${PREFIJO}${ruta}`;
  const cabeceras = { accept: 'application/json' };
  if (tarro !== undefined && tarro.size > 0) cabeceras.cookie = cabeceraCookie(tarro);
  if (!['GET', 'HEAD'].includes(metodo)) {
    cabeceras.origin = ORIGEN;
    const csrf = tarro?.get('ceiba_csrf') ?? tarro?.get('__Host-ceiba_csrf');
    if (csrf !== undefined) cabeceras['x-ceiba-csrf'] = csrf;
    if (cuerpo !== undefined) cabeceras['content-type'] = 'application/json';
  }

  let respuesta;
  let texto = '';
  try {
    respuesta = await fetch(url, {
      method: metodo,
      headers: cabeceras,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      redirect: 'manual',
      signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
    });
    texto = await respuesta.text();
  } catch (error) {
    resultados.push({ descripcion, metodo, ruta, status: null, veredicto: 'falla', error: String(error) });
    return { status: null, json: null, texto: '', respuesta: null };
  }

  if (tarro !== undefined) guardarCookies(tarro, respuesta);

  let json = null;
  try {
    json = texto === '' ? null : JSON.parse(texto);
  } catch {
    json = null;
  }

  const veredicto =
    esperado === undefined
      ? respuesta.status < 400
        ? 'funciona'
        : 'falla'
      : respuesta.status === esperado
        ? 'funciona'
        : 'falla';

  resultados.push({
    descripcion,
    metodo,
    ruta,
    status: respuesta.status,
    esperado: esperado ?? null,
    veredicto,
    cuerpoRecortado: texto.length > 180 ? `${texto.slice(0, 180)}…` : texto,
  });
  return { status: respuesta.status, json, texto, respuesta };
}

// --------------------------------------------------------------------------

async function principal() {
  const duena = nuevoTarro();
  const visitante = nuevoTarro();
  const correo = `f5-shr-${MARCA}@ceiba.local`;
  const contrasena = `Ceiba-F5#${MARCA}aZ9`;

  // --- Preparación -------------------------------------------------------
  await llamar('acuñar CSRF', 'GET', '/auth/csrf', { tarro: duena, esperado: 200 });
  await llamar('registrar propietaria', 'POST', '/auth/register', {
    tarro: duena,
    cuerpo: { email: correo, password: contrasena, displayName: 'Dueña SHR' },
    esperado: 201,
  });
  // Registrarse NO inicia sesión: hay que llamar a login.
  await llamar('iniciar sesión', 'POST', '/auth/login', {
    tarro: duena,
    cuerpo: { email: correo, password: contrasena },
    esperado: 200,
  });

  const ws = await llamar('crear workspace', 'POST', '/workspaces', {
    tarro: duena,
    cuerpo: { slug: `ws-shr-${MARCA}`, name: `WS SHR ${MARCA}` },
    esperado: 201,
  });
  const workspaceId = ws.json?.workspace?.id;

  // Se importa en vez de crear vacía: así la colección llega con solicitudes,
  // cabeceras, parámetros y cuerpo, y el contenido compartido se ejerce con
  // datos de verdad en lugar de con un árbol vacío.
  const col = await llamar(
    'importar colección con solicitudes',
    'POST',
    `/workspaces/${workspaceId}/collections/import`,
    {
      tarro: duena,
      cuerpo: {
        collection: { name: `Colección SHR ${MARCA}`, description: 'Sembrada por el arnés F5.' },
        folders: [{ id: 'f1', name: 'Facturación', sortOrder: 0 }],
        requests: [
          {
            name: 'Listar facturas',
            method: 'GET',
            url: 'https://api.ejemplo.test/{{version}}/facturas',
            folderId: 'f1',
            headers: [{ key: 'Accept', value: 'application/json' }],
            queryParams: [{ key: 'page', value: '1' }],
            sortOrder: 0,
          },
          {
            name: 'Crear factura',
            method: 'POST',
            url: 'https://api.ejemplo.test/{{version}}/facturas',
            bodyType: 'json',
            body: '{"importe": 100}',
            sortOrder: 1,
          },
        ],
      },
      esperado: 201,
    },
  );
  const collectionId =
    col.json?.coleccion?.id ?? col.json?.collection?.id ?? col.json?.id ?? null;

  // --- 1/14  crear enlace privado ---------------------------------------
  const creado = await llamar(
    'crear enlace privado con código',
    'POST',
    `/collections/${collectionId}/shares`,
    {
      tarro: duena,
      cuerpo: {
        permission: 'viewer_export',
        requiresAccessCode: true,
        allowExport: true,
        storeHint: true,
        codeLabel: 'cliente-piloto',
      },
      esperado: 201,
    },
  );
  const sharedLinkId = creado.json?.share?.id;
  const slug = creado.json?.share?.slug;
  const codigo = creado.json?.accessCode;
  const codigoPresente = typeof codigo === 'string' && codigo.length > 0;

  // --- 2/14  listar enlaces ---------------------------------------------
  const listado = await llamar('listar enlaces de la colección', 'GET', `/collections/${collectionId}/shares`, {
    tarro: duena,
    esperado: 200,
  });

  // --- 3/14  detalle del enlace -----------------------------------------
  await llamar('detalle del enlace', 'GET', `/shares/${sharedLinkId}`, {
    tarro: duena,
    esperado: 200,
  });

  // --- 4/14  página de acceso -------------------------------------------
  const pagina = await llamar('página de acceso (estado)', 'GET', `/share/${slug}`, {
    tarro: visitante,
    esperado: 200,
  });

  // --- 5/14  código en la URL: rechazado --------------------------------
  await llamar(
    'código en la URL → 400 code_in_url',
    'GET',
    `/share/${slug}?code=${encodeURIComponent(codigo ?? 'x')}`,
    { tarro: nuevoTarro(), esperado: 400 },
  );

  // --- 6/14  acceso con código incorrecto -------------------------------
  const fallo = await llamar('acceso con código incorrecto → 401 uniforme', 'POST', `/share/${slug}/access`, {
    tarro: visitante,
    cuerpo: { code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ' },
    esperado: 401,
  });

  // --- 7/14  acceso correcto --------------------------------------------
  const exito = await llamar('acceso con el código correcto', 'POST', `/share/${slug}/access`, {
    tarro: visitante,
    cuerpo: { code: codigo },
    esperado: 200,
  });
  const cookieCompartida = visitante.has('ceiba_share') || visitante.has('__Secure-ceiba_share');

  // --- 8/14  sesión de compartición -------------------------------------
  await llamar('sesión de compartición actual', 'GET', '/share/session/me', {
    tarro: visitante,
    esperado: 200,
  });

  // --- 9/14  contenido ---------------------------------------------------
  const contenido = await llamar('contenido: colección publicada', 'GET', '/share/content/collection', {
    tarro: visitante,
    esperado: 200,
  });
  const solicitudes = contenido.json?.collection?.requests ?? [];
  const primeraSolicitud = solicitudes[0]?.id ?? '00000000-0000-0000-0000-000000000000';

  // --- 10/14 solicitud ---------------------------------------------------
  await llamar('contenido: una solicitud', 'GET', `/share/content/requests/${primeraSolicitud}`, {
    tarro: visitante,
    esperado: solicitudes.length > 0 ? 200 : 401,
  });

  // Una solicitud INEXISTENTE no se sirve, aunque la sesión sea válida.
  await llamar(
    'contenido: solicitud ajena → 401',
    'GET',
    '/share/content/requests/00000000-0000-0000-0000-000000000000',
    { tarro: visitante, esperado: 401 },
  );

  // --- 11/14 exportación -------------------------------------------------
  const exportacion = await llamar('contenido: exportación', 'GET', '/share/content/export', {
    tarro: visitante,
    esperado: 200,
  });

  // --- 12/14 rotar código ------------------------------------------------
  const rotado = await llamar('rotar el código', 'POST', `/shares/${sharedLinkId}/codes`, {
    tarro: duena,
    cuerpo: { codeLabel: 'rotado' },
    esperado: 201,
  });
  const codigoNuevo = rotado.json?.accessCode;

  // La sesión abierta con el código viejo debe morir en el acto.
  const trasRotar = await llamar(
    'tras rotar: la sesión vieja ya no sirve',
    'GET',
    '/share/content/collection',
    { tarro: visitante, esperado: 401 },
  );

  // --- 13/14 revocar código ----------------------------------------------
  const codigoId = rotado.json?.code?.id;
  await llamar('revocar el código', 'DELETE', `/shares/${sharedLinkId}/codes/${codigoId}`, {
    tarro: duena,
    esperado: 200,
  });

  // --- 14/14 auditoría del propietario ------------------------------------
  const auditoria = await llamar('auditoría del propietario', 'GET', `/shares/${sharedLinkId}/audit`, {
    tarro: duena,
    esperado: 200,
  });

  // --- revocar enlace ------------------------------------------------------
  await llamar('revocar el enlace', 'POST', `/shares/${sharedLinkId}/revoke`, {
    tarro: duena,
    esperado: 200,
  });

  // --- enlace público + logout ---------------------------------------------
  const publico = await llamar('crear enlace público sin código', 'POST', `/collections/${collectionId}/shares`, {
    tarro: duena,
    cuerpo: { permission: 'viewer', requiresAccessCode: false },
    esperado: 201,
  });
  const visitante2 = nuevoTarro();
  await llamar('página de acceso del público', 'GET', `/share/${publico.json?.share?.slug}`, {
    tarro: visitante2,
    esperado: 200,
  });
  await llamar('acceso público sin código', 'POST', `/share/${publico.json?.share?.slug}/access`, {
    tarro: visitante2,
    cuerpo: {},
    esperado: 200,
  });
  await llamar('cerrar la sesión de compartición', 'POST', '/share/session/logout', {
    tarro: visitante2,
    esperado: 204,
  });

  // --- Comprobaciones transversales ---------------------------------------
  const comprobaciones = [
    ['el código se entrega UNA vez en la creación', codigoPresente],
    ['el listado NO devuelve el código', !JSON.stringify(listado.json ?? {}).includes(codigo ?? '@@')],
    ['la auditoría NO devuelve el código', !JSON.stringify(auditoria.json ?? {}).includes(codigo ?? '@@')],
    ['la página de acceso no expone la colección', pagina.texto.includes('estado') && !pagina.texto.includes('requests')],
    [
      'el 401 del código incorrecto es el canónico',
      fallo.texto === '{"error":"invalid_access","mensaje":"El enlace o el código no son válidos."}',
    ],
    ['el acceso correcto emite cookie de compartición', cookieCompartida],
    ['la cookie de compartición va acotada a /api/v1/share', (exito.respuesta?.headers.getSetCookie?.() ?? []).some((c) => c.includes('Path=/api/v1/share'))],
    ['la cookie de compartición es HttpOnly', (exito.respuesta?.headers.getSetCookie?.() ?? []).some((c) => /HttpOnly/iu.test(c))],
    ['Referrer-Policy: no-referrer en la página de acceso', pagina.respuesta?.headers.get('referrer-policy') === 'no-referrer'],
    ['Cache-Control: no-store en la página de acceso', (pagina.respuesta?.headers.get('cache-control') ?? '').includes('no-store')],
    ['la exportación no contiene "secretId"', !(exportacion.texto ?? '').includes('secretId')],
    ['la colección compartida trae solicitudes reales', solicitudes.length >= 2],
    [
      'la exportación no publica entornos',
      !(exportacion.texto ?? '').includes('"environments":'),
    ],
    ['rotar el código mata la sesión anterior', trasRotar.status === 401],
    ['el código rotado es distinto del original', typeof codigoNuevo === 'string' && codigoNuevo !== codigo],
  ];

  // --- Informe -------------------------------------------------------------
  const ancho = Math.max(...resultados.map((r) => r.descripcion.length));
  console.log('\n RUTA POR RUTA');
  console.log(' '.padEnd(ancho + 34, '─'));
  for (const r of resultados) {
    const marca = r.veredicto === 'funciona' ? 'OK  ' : 'FALLA';
    console.log(
      ` ${marca} ${r.metodo.padEnd(6)} ${r.descripcion.padEnd(ancho)}  ${String(r.status).padStart(3)}` +
        (r.esperado !== null && r.esperado !== undefined ? ` (esperado ${r.esperado})` : ''),
    );
  }

  console.log('\n COMPROBACIONES TRANSVERSALES');
  console.log(' '.padEnd(ancho + 34, '─'));
  let fallos = resultados.filter((r) => r.veredicto !== 'funciona').length;
  for (const [texto, ok] of comprobaciones) {
    console.log(` ${ok ? 'OK  ' : 'FALLA'} ${texto}`);
    if (!ok) fallos += 1;
  }

  console.log(
    `\n ${resultados.length} llamadas, ${comprobaciones.length} comprobaciones, ${fallos} fallos.\n`,
  );

  writeFileSync(
    FICHERO_RESUMEN,
    `${JSON.stringify(
      { generadoEn: new Date().toISOString(), base: BASE, resultados, comprobaciones },
      null,
      2,
    )}\n`,
    'utf8',
  );
  process.exitCode = fallos === 0 ? 0 : 1;
}

await principal();
