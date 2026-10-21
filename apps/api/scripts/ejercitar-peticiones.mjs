#!/usr/bin/env node
/**
 * Ejercita por HTTP REAL las 7 rutas de peticiones de la fase 6 contra una API
 * ya levantada (`./infra/levantar-local.sh --sin-web`).
 *
 * Mismo papel que `ejercitar-studio.mjs` y `ejercitar-comparticion.mjs`: las
 * pruebas de `test/` inyectan en Fastify, que es la misma aplicación pero sin
 * pila de red. Esto mete sockets, cabeceras y cookies de verdad por medio y
 * deja una salida literal pegable en el informe.
 *
 *   node scripts/ejercitar-peticiones.mjs
 *
 * Variables: CEIBA_API_BASE (por defecto http://127.0.0.1:3000),
 *            CEIBA_ORIGEN   (por defecto http://127.0.0.1:8444).
 */

// El proxy de egreso del contenedor manda hasta el tráfico a 127.0.0.1 cuando
// `NODE_USE_ENV_PROXY=1`. Se aparta antes del primer `fetch`.
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

const BASE = process.env.CEIBA_API_BASE ?? 'http://127.0.0.1:3000';
const ORIGEN = process.env.CEIBA_ORIGEN ?? 'http://127.0.0.1:8444';
const MARCA = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const CLAVE = `Ceiba-F6#${MARCA}aZ9`;
const CENTINELA = 'SENTINEL-c0ffee';

let fallos = 0;

function afirmar(condicion, mensaje) {
  if (condicion) {
    console.log(`    ok   · ${mensaje}`);
  } else {
    fallos += 1;
    console.log(`    FALLO· ${mensaje}`);
  }
}

class Sesion {
  constructor(nombre) {
    this.nombre = nombre;
    this.cookies = new Map();
  }

  cabeceraCookie() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  guardarCookies(respuesta) {
    for (const bruta of respuesta.headers.getSetCookie?.() ?? []) {
      const [par] = bruta.split(';');
      const indice = par.indexOf('=');
      if (indice > 0) this.cookies.set(par.slice(0, indice), par.slice(indice + 1));
    }
  }

  testigoCsrf() {
    for (const [nombre, valor] of this.cookies) {
      if (nombre.toLowerCase().includes('csrf')) return valor;
    }
    return '';
  }

  async pedir(metodo, ruta, cuerpo) {
    const cabeceras = { origin: ORIGEN, accept: 'application/json' };
    const galletas = this.cabeceraCookie();
    if (galletas !== '') cabeceras.cookie = galletas;
    if (metodo !== 'GET' && metodo !== 'HEAD') {
      cabeceras['x-ceiba-csrf'] = this.testigoCsrf();
      if (cuerpo !== undefined) cabeceras['content-type'] = 'application/json';
    }
    const respuesta = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      headers: cabeceras,
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      redirect: 'manual',
    });
    this.guardarCookies(respuesta);
    const texto = await respuesta.text();
    let json = null;
    try {
      json = texto === '' ? null : JSON.parse(texto);
    } catch {
      json = null;
    }
    return { estado: respuesta.status, texto, json };
  }

  async entrar(correo) {
    await this.pedir('GET', '/api/v1/auth/csrf');
    const alta = await this.pedir('POST', '/api/v1/auth/register', {
      email: correo,
      password: CLAVE,
      displayName: this.nombre,
    });
    if (alta.estado !== 201) throw new Error(`registro de ${correo}: ${alta.estado} ${alta.texto}`);
    // Registrarse NO inicia sesión: hay que llamar a login.
    const entrada = await this.pedir('POST', '/api/v1/auth/login', {
      email: correo,
      password: CLAVE,
    });
    if (entrada.estado !== 200) throw new Error(`login de ${correo}: ${entrada.estado} ${entrada.texto}`);
    this.usuarioId = alta.json.usuario.id;
    return this;
  }
}

function titulo(texto) {
  console.log(`\n── ${texto} ${'─'.repeat(Math.max(0, 68 - texto.length))}`);
}

const main = async () => {
  console.log(`CEIBA · fase 6 · ejercicio HTTP real de las 7 rutas de peticiones`);
  console.log(`API ${BASE} · origen ${ORIGEN} · marca ${MARCA}`);

  const duena = await new Sesion('Dueña').entrar(`f6-duena-${MARCA}@ceiba.test`);
  const ajena = await new Sesion('Ajena').entrar(`f6-ajena-${MARCA}@ceiba.test`);

  titulo('preparación: workspace y colección');
  const ws = await duena.pedir('POST', '/api/v1/workspaces', {
    slug: `f6http-${MARCA}`,
    name: 'Workspace F6 HTTP',
    description: null,
  });
  afirmar(ws.estado === 201, `POST /workspaces → ${ws.estado}`);
  const workspaceId = ws.json.workspace.id;

  const col = await duena.pedir('POST', `/api/v1/workspaces/${workspaceId}/collections`, {
    slug: `f6http-${MARCA}`,
    name: 'Colección F6 HTTP',
    description: null,
  });
  afirmar(col.estado === 201, `POST /workspaces/:id/collections → ${col.estado}`);
  const coleccionId = col.json.coleccion.id;
  console.log(`    workspace ${workspaceId}`);
  console.log(`    colección ${coleccionId}`);

  titulo('1/7 · GET /collections/:collectionId/requests (recién creada)');
  const vacia = await duena.pedir('GET', `/api/v1/collections/${coleccionId}/requests`);
  afirmar(vacia.estado === 200, `estado ${vacia.estado}`);
  afirmar(Array.isArray(vacia.json?.requests) && vacia.json.requests.length === 0, 'lista vacía, pero EXISTE');
  console.log(`    ${vacia.texto}`);

  titulo('2/7 · POST /collections/:collectionId/requests');
  const creada = await duena.pedir('POST', `/api/v1/collections/${coleccionId}/requests`, {
    name: 'Listar clientes',
    method: 'GET',
    methodCustom: null,
    url: '{{base_url}}/v1/clientes',
    folderId: null,
    description: null,
    headers: [
      { key: 'Accept', value: 'application/json', enabled: true },
      { key: 'Authorization', value: `Bearer ${CENTINELA}`, enabled: true },
    ],
    queryParams: [{ key: 'page', value: '2', enabled: true }],
    bodyType: 'none',
    body: null,
    sortKey: null,
  });
  afirmar(creada.estado === 201, `estado ${creada.estado}`);
  const peticionId = creada.json.request.id;
  afirmar(creada.json.request.url === '{{base_url}}/v1/clientes', 'url_template SIN resolver');
  console.log(`    id ${peticionId}`);

  titulo('3/7 · GET /requests/:requestId');
  const detalle = await duena.pedir('GET', `/api/v1/requests/${peticionId}`);
  afirmar(detalle.estado === 200, `estado ${detalle.estado}`);
  console.log(`    ${JSON.stringify(detalle.json.request.headers)}`);

  titulo('4/7 · PATCH /requests/:requestId');
  const parcheada = await duena.pedir('PATCH', `/api/v1/requests/${peticionId}`, {
    name: 'Listar clientes (v2)',
    queryParams: [
      { key: 'page', value: '3', enabled: true },
      { key: 'limit', value: '50', enabled: true },
    ],
  });
  afirmar(parcheada.estado === 200, `estado ${parcheada.estado}`);
  afirmar(parcheada.json.request.name === 'Listar clientes (v2)', 'nombre actualizado');
  afirmar(parcheada.json.request.url === '{{base_url}}/v1/clientes', 'url intacta');

  titulo('6/7 · POST /requests/:requestId/duplicate');
  const copia = await duena.pedir('POST', `/api/v1/requests/${peticionId}/duplicate`, {});
  afirmar(copia.estado === 201, `estado ${copia.estado}`);
  afirmar(copia.json.request.name === 'Listar clientes (v2) (copia)', copia.json.request.name);
  const copiaId = copia.json.request.id;

  titulo('7/7 · GET /requests/:requestId/curl');
  const curl = await duena.pedir('GET', `/api/v1/requests/${peticionId}/curl`);
  afirmar(curl.estado === 200, `estado ${curl.estado}`);
  console.log(`    ${curl.json.curl}`);
  for (const aviso of curl.json.advertencias) console.log(`    · ${aviso}`);
  afirmar(!curl.texto.includes(CENTINELA), 'el comando NO contiene el valor de la credencial');
  afirmar(curl.json.curl.includes('$CEIBA_SECRETO_AUTHORIZATION'), 'lleva el marcador');
  afirmar(curl.json.curl.includes('{{base_url}}'), 'conserva el marcador de variable');

  titulo('listado con las tres peticiones vivas');
  const lista = await duena.pedir('GET', `/api/v1/collections/${coleccionId}/requests`);
  afirmar(lista.estado === 200, `estado ${lista.estado}`);
  console.log(
    `    ${lista.json.requests.map((r) => `${r.method} ${r.name} [${r.sortKey}]`).join(' | ')}`,
  );

  titulo('5/7 · DELETE /requests/:requestId (lógico)');
  const borrada = await duena.pedir('DELETE', `/api/v1/requests/${copiaId}`);
  afirmar(borrada.estado === 204, `estado ${borrada.estado}`);
  const tras = await duena.pedir('GET', `/api/v1/requests/${copiaId}`);
  afirmar(tras.estado === 404, `GET tras borrar → ${tras.estado}`);
  const lista2 = await duena.pedir('GET', `/api/v1/collections/${coleccionId}/requests`);
  afirmar(!lista2.texto.includes(copiaId), 'la copia ya no aparece en el listado');

  titulo('autorización por recurso: un AJENO no ve nada');
  for (const [metodo, ruta] of [
    ['GET', `/api/v1/collections/${coleccionId}/requests`],
    ['GET', `/api/v1/requests/${peticionId}`],
    ['GET', `/api/v1/requests/${peticionId}/curl`],
    ['DELETE', `/api/v1/requests/${peticionId}`],
  ]) {
    const r = await ajena.pedir(metodo, ruta);
    afirmar(r.estado === 404, `${metodo} ${ruta.replace('/api/v1', '')} → ${r.estado} (y NO 200 vacío)`);
  }

  titulo('resultado');
  console.log(fallos === 0 ? '  TODO OK' : `  ${fallos} COMPROBACIONES FALLIDAS`);
  process.exit(fallos === 0 ? 0 : 1);
};

main().catch((error) => {
  console.error(`\nERROR: ${error.message}`);
  process.exit(2);
});
