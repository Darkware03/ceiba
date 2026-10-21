#!/usr/bin/env node
/**
 * Arnés de ejercicio HTTP de las 27 rutas del módulo `studio`.
 *
 * POR QUÉ EXISTE: las pruebas de integración montan la aplicación en proceso.
 * Esto es lo contrario: golpea una API **ya arrancada** por la red, igual que
 * lo haría la SPA, para detectar lo que sólo falla en el camino real (prefijo
 * global, cookies, CSRF, orden de dependencias entre recursos).
 *
 * POR QUÉ SIN DEPENDENCIAS: vive en `apps/api/scripts`, fuera del grafo de
 * compilación, y debe poder ejecutarse contra un contenedor recién levantado
 * sin `pnpm install` previo. Node 24 ya trae `fetch`, `getSetCookie()` y
 * `AbortSignal.timeout`, que es todo lo que hace falta.
 *
 * Uso:
 *   node apps/api/scripts/ejercitar-studio.mjs
 *   CEIBA_API_BASE=http://127.0.0.1:3000 CEIBA_PUBLIC_URL=http://localhost:8080 node ...
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Configuración
// ---------------------------------------------------------------------------

const BASE = (process.env.CEIBA_API_BASE ?? 'http://127.0.0.1:3000').replace(/\/+$/u, '');

/** §19 del prompt maestro: toda la API vive bajo `/api/v1` (`healthz` queda fuera). */
const PREFIJO = 'api/v1';

/**
 * El `GuardCsrf` aplica la barrera 3 del ADR-0009 §5: en TODO método mutante
 * exige `Origin` (o `Referer`) y lo compara con `CEIBA_PUBLIC_URL`. Falla
 * CERRADO: si no llega ninguna de las dos cabeceras, deniega. `fetch` de Node
 * no envía `Origin` por su cuenta, así que hay que ponerlo a mano o TODOS los
 * POST/PUT/PATCH/DELETE responderían 403 por CSRF y el informe sería inútil.
 *
 * Si la API corre detrás de Nginx, hay que pasar el mismo valor que tenga el
 * servidor en `CEIBA_PUBLIC_URL`; por omisión se asume despliegue directo.
 */
const ORIGEN = origenDe(process.env.CEIBA_PUBLIC_URL ?? BASE);

/**
 * Destino de las dos rutas de ejecución. Se apunta al propio `healthz` local:
 * es inocuo, siempre está si la API está, y evita que el arnés se convierta en
 * un probador de SSRF contra terceros.
 */
const DESTINO_EJECUCION = process.env.CEIBA_EXEC_TARGET ?? `${BASE}/healthz`;

/** Un fallo de red no debe colgar el arnés: todas las peticiones llevan tope. */
const TIEMPO_LIMITE_MS = Number(process.env.CEIBA_TIMEOUT_MS ?? 20000);

const DIRECTORIO = dirname(fileURLToPath(import.meta.url));
const FICHERO_RESUMEN = join(DIRECTORIO, '.ultimo-ejercicio.json');

/** Marca de ejecución: hace únicos correos y slugs, para poder repetir el arnés. */
const MARCA = Date.now().toString(36);

const USUARIO_1 = {
  email: `f4-${MARCA}@ceiba.local`,
  // Fuerte a propósito: >=12 caracteres con mayúscula, minúscula, dígito y símbolo.
  password: `Ceiba-F4#${MARCA}aZ9`,
  displayName: 'Arnés F4 Principal',
  id: null,
};

const USUARIO_2 = {
  email: `f4-${MARCA}-dos@ceiba.local`,
  password: `Ceiba-F4#${MARCA}bK7`,
  displayName: 'Arnés F4 Invitado',
  id: null,
};

/** Id de relleno para que la URL siga siendo válida si la preparación falló. */
const ID_AUSENTE = '00000000-0000-0000-0000-000000000000';

// ---------------------------------------------------------------------------
// Tarro de cookies
// ---------------------------------------------------------------------------

/**
 * `fetch` de Node no tiene almacén de cookies (no es un navegador), así que la
 * sesión se perdería entre peticiones. Esto es el mínimo imprescindible para
 * sostenerla: guardar lo que llega en `set-cookie` y devolverlo en `Cookie`.
 */
class TarroDeCookies {
  #cookies = new Map();

  /** `getSetCookie()` es la única forma correcta de leer varias `set-cookie`. */
  absorber(respuesta) {
    const crudas =
      typeof respuesta.headers.getSetCookie === 'function' ? respuesta.headers.getSetCookie() : [];
    for (const cruda of crudas) this.#absorberUna(cruda);
  }

  #absorberUna(cruda) {
    const [par, ...atributos] = String(cruda).split(';');
    const corte = par.indexOf('=');
    if (corte < 1) return;

    const nombre = par.slice(0, corte).trim();
    const valor = par.slice(corte + 1).trim();

    // `clearCookie` del cierre de sesión borra poniendo la cookie vacía y
    // caducada. Si no se interpretase, el arnés seguiría mandando una sesión
    // muerta y los fallos posteriores serían 401 sin explicación.
    let caducada = valor === '';
    for (const atributo of atributos) {
      const sep = atributo.indexOf('=');
      const clave = (sep < 0 ? atributo : atributo.slice(0, sep)).trim().toLowerCase();
      const dato = sep < 0 ? '' : atributo.slice(sep + 1).trim();
      if (clave === 'max-age' && Number(dato) <= 0) caducada = true;
      if (clave === 'expires') {
        const instante = Date.parse(dato);
        if (Number.isFinite(instante) && instante <= Date.now()) caducada = true;
      }
    }

    if (caducada) this.#cookies.delete(nombre);
    else this.#cookies.set(nombre, valor);
  }

  cabeceraCookie() {
    if (this.#cookies.size === 0) return null;
    return [...this.#cookies].map(([nombre, valor]) => `${nombre}=${valor}`).join('; ');
  }

  /**
   * Se busca por SUFIJO y no por nombre exacto a propósito: `app-config.ts`
   * deriva el nombre de `CEIBA_COOKIE_SECURE`. Sobre HTTP plano son
   * `ceiba_session`/`ceiba_csrf`; con TLS llevan el prefijo `__Host-`, que el
   * cliente impone junto con `Secure`. El arnés debe valer en los dos montajes.
   */
  porSufijo(sufijo) {
    for (const [nombre, valor] of this.#cookies) {
      if (nombre === sufijo || nombre.endsWith(sufijo)) return valor;
    }
    return undefined;
  }

  get csrf() {
    return this.porSufijo('ceiba_csrf');
  }

  get sesion() {
    return this.porSufijo('ceiba_session');
  }
}

// ---------------------------------------------------------------------------
// Cliente HTTP
// ---------------------------------------------------------------------------

const METODOS_MUTANTES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Cada usuario lleva su propio tarro. Compartir uno solo obligaría a cerrar y
 * reabrir sesión cada vez que el invitado interviene, y una rotación de testigo
 * a destiempo dejaría al principal sin CSRF válido.
 */
function crearSesion(etiqueta) {
  return { etiqueta, tarro: new TarroDeCookies() };
}

const sesion1 = crearSesion('usuario-1');
const sesion2 = crearSesion('usuario-2');

async function pedir(sesion, metodo, ruta, cuerpo) {
  const url = `${BASE}/${PREFIJO}/${String(ruta).replace(/^\/+/u, '')}`;
  const cabeceras = { accept: 'application/json', origin: ORIGEN };

  const galletas = sesion.tarro.cabeceraCookie();
  if (galletas) cabeceras.cookie = galletas;

  if (METODOS_MUTANTES.has(metodo)) {
    // Barrera 2 del ADR-0009 §5: doble envío. La cabecera debe repetir el valor
    // exacto de la cookie; el guard además verifica su firma HMAC.
    const testigo = sesion.tarro.csrf;
    if (testigo) cabeceras['x-ceiba-csrf'] = testigo;
  }

  const opciones = { method: metodo, headers: cabeceras, redirect: 'manual' };
  if (cuerpo !== undefined) {
    cabeceras['content-type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }
  if (Number.isFinite(TIEMPO_LIMITE_MS) && TIEMPO_LIMITE_MS > 0) {
    opciones.signal = AbortSignal.timeout(TIEMPO_LIMITE_MS);
  }

  try {
    const respuesta = await fetch(url, opciones);
    sesion.tarro.absorber(respuesta);
    const texto = await respuesta.text();
    let datos = null;
    try {
      datos = texto ? JSON.parse(texto) : null;
    } catch {
      datos = null; // Respuesta no JSON: se conserva el texto para el recorte.
    }
    return { status: respuesta.status, datos, texto, url, error: null };
  } catch (err) {
    // Conexión rechazada, DNS, tiempo agotado... se trata como un fallo más de
    // la ruta para que el resumen salga completo igualmente.
    const motivo = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { status: 0, datos: null, texto: '', url, error: motivo };
  }
}

// ---------------------------------------------------------------------------
// Registro de resultados
// ---------------------------------------------------------------------------

const rutas = [];
const preparacion = [];

function recortar(resultado) {
  const bruto = resultado.error ? `<sin respuesta> ${resultado.error}` : resultado.texto;
  const limpio = String(bruto ?? '').replace(/\s+/gu, ' ').trim();
  return limpio.length > 300 ? `${limpio.slice(0, 300)}…` : limpio;
}

function veredictoDe(status, esperados) {
  if (!status) return 'falla';
  if (Array.isArray(esperados) && esperados.length > 0) {
    return esperados.includes(status) ? 'funciona' : 'falla';
  }
  return status >= 200 && status < 300 ? 'funciona' : 'falla';
}

/**
 * Ejercita UNA de las 27 rutas y la anota. Nunca lanza: un fallo aquí no puede
 * impedir que se prueben las demás ni que se imprima el resumen.
 */
async function ejercitar({ metodo, plantilla, ruta, cuerpo, esperados, sesion = sesion1, nota }) {
  const resultado = await pedir(sesion, metodo, ruta, cuerpo);
  const veredicto = veredictoDe(resultado.status, esperados);
  const fila = {
    numero: rutas.length + 1,
    metodo,
    plantilla,
    rutaConcreta: `/${PREFIJO}/${String(ruta).replace(/^\/+/u, '')}`,
    status: resultado.status,
    esperados: esperados ?? '2xx',
    veredicto,
    como: sesion.etiqueta,
    nota: nota ?? null,
    cuerpoRecortado: veredicto === 'falla' ? recortar(resultado) : null,
  };
  rutas.push(fila);

  console.log([metodo, plantilla, resultado.status || 'ERR', veredicto].join('\t'));
  if (veredicto === 'falla') console.log(`\t\t↳ ${recortar(resultado)}`);

  return resultado;
}

/**
 * Paso de preparación: no es una de las 27, pero sin él no hay ids que encadenar.
 * Se anota aparte para que el informe distinga «la ruta falla» de «el arnés no
 * llegó a tener con qué probarla».
 */
async function preparar(descripcion, { metodo, ruta, cuerpo, esperados, sesion = sesion1 }) {
  const resultado = await pedir(sesion, metodo, ruta, cuerpo);
  const veredicto = veredictoDe(resultado.status, esperados);
  preparacion.push({
    descripcion,
    metodo,
    ruta: `/${PREFIJO}/${String(ruta).replace(/^\/+/u, '')}`,
    status: resultado.status,
    veredicto,
    como: sesion.etiqueta,
    cuerpoRecortado: veredicto === 'falla' ? recortar(resultado) : null,
  });

  console.log(['prep', metodo, ruta, resultado.status || 'ERR', veredicto].join('\t'));
  if (veredicto === 'falla') console.log(`\t\t↳ ${recortar(resultado)}`);

  return resultado;
}

/** Evita `undefined` incrustado en una URL cuando la preparación ha fallado. */
function oAusente(valor) {
  return typeof valor === 'string' && valor.length > 0 ? valor : ID_AUSENTE;
}

// ---------------------------------------------------------------------------
// Preparación: identidad, workspace y colección
// ---------------------------------------------------------------------------

const ids = {
  workspaceId: null,
  collectionId: null,
  invitacionAceptadaId: null,
  invitacionRevocableId: null,
  tokenInvitacion: null,
  memberId: null,
  entornoA: null,
  entornoB: null,
  coleccionImportadaId: null,
};

let bundleExportado = null;

async function prepararContexto() {
  console.log('── Preparación ────────────────────────────────────────────────');

  // (a) Testigo CSRF antes de cualquier mutación: es el endpoint explícito del
  //     ADR-0009 §5 para que el cliente tenga cookie antes de su primer envío.
  await preparar('acuñar CSRF (usuario 1)', { metodo: 'GET', ruta: 'auth/csrf' });

  // (b) Registro. Devuelve 201 y NO abre sesión: el controlador no emite cookie
  //     de sesión aquí, sólo crea el usuario.
  const registro1 = await preparar('registrar usuario 1', {
    metodo: 'POST',
    ruta: 'auth/register',
    cuerpo: { email: USUARIO_1.email, password: USUARIO_1.password, displayName: USUARIO_1.displayName },
    esperados: [201],
  });
  USUARIO_1.id = registro1.datos?.usuario?.id ?? null;

  // (c) Por eso hay que iniciar sesión explícitamente después de registrarse.
  await preparar('iniciar sesión usuario 1', {
    metodo: 'POST',
    ruta: 'auth/login',
    cuerpo: { email: USUARIO_1.email, password: USUARIO_1.password },
    esperados: [200],
  });

  // (d) Segundo usuario: hace falta alguien distinto del propietario para que
  //     la invitación y el cambio/expulsión de miembro sean reales. El
  //     propietario no sirve: el servicio rechaza tocar su propio rol.
  const registro2 = await preparar('registrar usuario 2', {
    metodo: 'POST',
    ruta: 'auth/register',
    cuerpo: { email: USUARIO_2.email, password: USUARIO_2.password, displayName: USUARIO_2.displayName },
    esperados: [201],
  });
  USUARIO_2.id = registro2.datos?.usuario?.id ?? null;

  await preparar('acuñar CSRF (usuario 2)', { metodo: 'GET', ruta: 'auth/csrf', sesion: sesion2 });
  await preparar('iniciar sesión usuario 2', {
    metodo: 'POST',
    ruta: 'auth/login',
    cuerpo: { email: USUARIO_2.email, password: USUARIO_2.password },
    esperados: [200],
    sesion: sesion2,
  });

  // Se vuelve a iniciar sesión con el principal: el resto del arnés actúa como
  // propietario del espacio, y así queda explícito aunque cada tarro sea propio.
  await preparar('reiniciar sesión usuario 1', {
    metodo: 'POST',
    ruta: 'auth/login',
    cuerpo: { email: USUARIO_1.email, password: USUARIO_1.password },
    esperados: [200],
  });

  // (e) Workspace y colección: son el contexto que exigen casi todas las rutas
  //     de studio, que resuelven el rol del principal sobre el espacio.
  const ws = await preparar('crear workspace', {
    metodo: 'POST',
    ruta: 'workspaces',
    cuerpo: {
      slug: `f4-${MARCA}`,
      name: `Arnés F4 ${MARCA}`,
      description: 'Espacio creado por ejercitar-studio.mjs',
    },
    esperados: [201],
  });
  ids.workspaceId = ws.datos?.workspace?.id ?? null;

  const col = await preparar('crear colección', {
    metodo: 'POST',
    ruta: `workspaces/${oAusente(ids.workspaceId)}/collections`,
    cuerpo: {
      slug: `col-f4-${MARCA}`,
      name: `Colección F4 ${MARCA}`,
      description: 'Colección creada por ejercitar-studio.mjs',
    },
    esperados: [201],
  });
  ids.collectionId = col.datos?.coleccion?.id ?? null;

  // Invitación adicional que nunca se acepta: es la que se revocará, para que
  // `DELETE invitations/:invitationId` ejercite la transición pending→revoked
  // de verdad y no la de una invitación ya consumida.
  const invRevocable = await preparar('crear invitación revocable', {
    metodo: 'POST',
    ruta: `workspaces/${oAusente(ids.workspaceId)}/invitations`,
    cuerpo: { email: `f4-${MARCA}-revocar@ceiba.local`, role: 'viewer', expiresInDays: 7 },
    esperados: [201],
  });
  ids.invitacionRevocableId = invRevocable.datos?.id ?? invRevocable.datos?.invitation?.id ?? null;

  // Segundo entorno: hay DOS rutas distintas de borrado de entorno (anidada y
  // directa) y cada una necesita su propia víctima.
  const entB = await preparar('crear entorno B (para borrado directo)', {
    metodo: 'POST',
    ruta: `workspaces/${oAusente(ids.workspaceId)}/environments`,
    cuerpo: {
      name: `Entorno B ${MARCA}`,
      description: 'Entorno sacrificable del arnés',
      color: '#f59e0b',
      isDefault: false,
      variables: [],
    },
    esperados: [201],
  });
  ids.entornoB = entB.datos?.id ?? entB.datos?.environment?.id ?? null;
}

// ---------------------------------------------------------------------------
// Las 27 rutas de studio, en orden de dependencia
// ---------------------------------------------------------------------------

async function ejercitarStudio() {
  const ws = () => oAusente(ids.workspaceId);

  console.log('');
  console.log('── 27 rutas de studio ─────────────────────────────────────────');

  // --- Ajustes del espacio -------------------------------------------------
  await ejercitar({
    metodo: 'GET',
    plantilla: 'workspaces/:workspaceId/settings',
    ruta: `workspaces/${ws()}/settings`,
  });

  await ejercitar({
    metodo: 'PATCH',
    plantilla: 'workspaces/:workspaceId/settings',
    ruta: `workspaces/${ws()}/settings`,
    cuerpo: {
      name: `Arnés F4 ${MARCA} (ajustado)`,
      description: 'Descripción actualizada por el arnés',
      retention: {
        requestHistoryDays: 30,
        collectionRunsDays: 30,
        auditLogsDays: 90,
        versionSnapshotsKeep: 20,
      },
    },
  });

  // --- Colaboración e invitaciones ----------------------------------------
  await ejercitar({
    metodo: 'GET',
    plantilla: 'workspaces/:workspaceId/collaboration',
    ruta: `workspaces/${ws()}/collaboration`,
  });

  await ejercitar({
    metodo: 'GET',
    plantilla: 'workspaces/:workspaceId/invitations',
    ruta: `workspaces/${ws()}/invitations`,
  });

  // La respuesta de creación SÍ expone el testigo en claro (`inviteToken`), que
  // es la única vez que se puede leer: en base de datos sólo queda su SHA-256.
  const invitacion = await ejercitar({
    metodo: 'POST',
    plantilla: 'workspaces/:workspaceId/invitations',
    ruta: `workspaces/${ws()}/invitations`,
    cuerpo: { email: USUARIO_2.email, role: 'editor', expiresInDays: 7 },
    esperados: [201],
    nota: 'devuelve inviteToken en claro; de ahí salen las dos rutas por token',
  });
  ids.tokenInvitacion =
    invitacion.datos?.inviteToken ?? invitacion.datos?.invitation?.inviteToken ?? null;
  ids.invitacionAceptadaId = invitacion.datos?.id ?? invitacion.datos?.invitation?.id ?? null;

  const token = oAusente(ids.tokenInvitacion);

  await ejercitar({
    metodo: 'GET',
    plantilla: 'invitations/:token',
    ruta: `invitations/${encodeURIComponent(token)}`,
  });

  // Acepta el INVITADO, no el propietario: aceptar con el dueño del espacio
  // devolvería rol `owner` y no crearía el miembro que luego hay que degradar
  // y expulsar.
  await ejercitar({
    metodo: 'POST',
    plantilla: 'invitations/:token/accept',
    ruta: `invitations/${encodeURIComponent(token)}/accept`,
    cuerpo: {},
    esperados: [200, 201],
    sesion: sesion2,
    nota: 'ejecutada como usuario 2 (el invitado)',
  });

  // `:memberId` es, pese al nombre, el **userId**: el servicio busca por la
  // clave compuesta (workspaceId, userId), no por el id de la fila de membresía.
  // Se relee la colaboración para obtenerlo del servidor en vez de suponerlo.
  const colaboracion = await preparar('releer colaboración para resolver memberId', {
    metodo: 'GET',
    ruta: `workspaces/${ws()}/collaboration`,
  });
  const miembros = Array.isArray(colaboracion.datos?.members?.members)
    ? colaboracion.datos.members.members
    : Array.isArray(colaboracion.datos?.members)
      ? colaboracion.datos.members
      : [];
  const miembroInvitado = miembros.find(
    (m) => String(m?.email ?? '').toLowerCase() === USUARIO_2.email.toLowerCase(),
  );
  ids.memberId = miembroInvitado?.userId ?? USUARIO_2.id ?? null;

  await ejercitar({
    metodo: 'PUT',
    plantilla: 'workspaces/:workspaceId/members/:memberId/role',
    ruta: `workspaces/${ws()}/members/${oAusente(ids.memberId)}/role`,
    cuerpo: { role: 'viewer' },
    nota: ':memberId es en realidad el userId del miembro',
  });

  await ejercitar({
    metodo: 'DELETE',
    plantilla: 'workspaces/:workspaceId/collaboration/members/:memberId',
    ruta: `workspaces/${ws()}/collaboration/members/${oAusente(ids.memberId)}`,
    nota: ':memberId es en realidad el userId del miembro',
  });

  await ejercitar({
    metodo: 'DELETE',
    plantilla: 'workspaces/:workspaceId/invitations/:invitationId',
    ruta: `workspaces/${ws()}/invitations/${oAusente(ids.invitacionRevocableId)}`,
    nota: 'revoca la invitación pendiente creada en preparación',
  });

  // --- Entornos ------------------------------------------------------------
  await ejercitar({
    metodo: 'GET',
    plantilla: 'workspaces/:workspaceId/environments',
    ruta: `workspaces/${ws()}/environments`,
  });

  const entornoA = await ejercitar({
    metodo: 'POST',
    plantilla: 'workspaces/:workspaceId/environments',
    ruta: `workspaces/${ws()}/environments`,
    cuerpo: {
      name: `Entorno A ${MARCA}`,
      description: 'Entorno principal del arnés',
      color: '#0ea5e9',
      isDefault: true,
      variables: [
        { key: 'base_url', value: BASE, enabled: true, isSecret: false },
        { key: 'saludo', value: 'hola', enabled: true, isSecret: false },
      ],
    },
    esperados: [201],
  });
  ids.entornoA = entornoA.datos?.id ?? entornoA.datos?.environment?.id ?? null;

  await ejercitar({
    metodo: 'PUT',
    plantilla: 'workspaces/:workspaceId/environments/:environmentId',
    ruta: `workspaces/${ws()}/environments/${oAusente(ids.entornoA)}`,
    cuerpo: {
      name: `Entorno A ${MARCA} (PUT)`,
      description: 'Actualizado por la ruta anidada',
      variables: [{ key: 'base_url', value: BASE, enabled: true, isSecret: false }],
    },
  });

  await ejercitar({
    metodo: 'PATCH',
    plantilla: 'environments/:environmentId',
    ruta: `environments/${oAusente(ids.entornoA)}`,
    cuerpo: { description: 'Actualizado por la ruta directa' },
  });

  // --- Ejecución -----------------------------------------------------------
  // Destino local e inocuo: la política anti-SSRF del §19 prohíbe usar el
  // ejecutor como proxy hacia terceros, y `healthz` siempre está disponible.
  await ejercitar({
    metodo: 'POST',
    plantilla: 'workspaces/:workspaceId/execute',
    ruta: `workspaces/${ws()}/execute`,
    cuerpo: {
      method: 'GET',
      url: DESTINO_EJECUCION,
      environmentId: ids.entornoA,
      headers: [{ key: 'accept', value: 'application/json', enabled: true }],
      queryParams: [],
      bodyType: 'none',
      body: null,
      timeoutMs: 5000,
    },
    esperados: [200, 201],
  });

  await ejercitar({
    metodo: 'POST',
    plantilla: 'requests/execute',
    ruta: 'requests/execute',
    cuerpo: {
      workspaceId: ids.workspaceId,
      method: 'GET',
      url: DESTINO_EJECUCION,
      environmentId: ids.entornoA,
      headers: [],
      queryParams: [],
      bodyType: 'none',
      body: null,
      timeoutMs: 5000,
    },
    esperados: [200, 201],
    nota: 'variante heredada; acepta además claves en español',
  });

  // --- Historiales ---------------------------------------------------------
  // Van después de ejecutar: así el historial tiene algo que devolver y no se
  // confunde «lista vacía» con «ruta rota».
  await ejercitar({
    metodo: 'GET',
    plantilla: 'workspaces/:workspaceId/history/requests',
    ruta: `workspaces/${ws()}/history/requests?limit=20`,
  });

  await ejercitar({
    metodo: 'GET',
    plantilla: 'workspaces/:workspaceId/history/changes',
    ruta: `workspaces/${ws()}/history/changes?limit=20`,
  });

  await ejercitar({
    metodo: 'GET',
    plantilla: 'workspaces/:workspaceId/history',
    ruta: `workspaces/${ws()}/history?limit=20`,
  });

  // --- Siembra: una colección CON carpetas y peticiones ---------------------
  //
  // POR QUÉ ESTE PASO EXISTE. La primera versión del arnés daba 27/27 en verde
  // y sin embargo `api_requests`, `collection_folders`, `request_headers`,
  // `request_params` y `request_bodies` se quedaban a CERO filas: la colección
  // recién creada no tenía peticiones, así que `import` importaba un paquete
  // vacío y `runs` recorría una lista vacía. Tres de los caminos más profundos
  // del módulo —crear carpetas con `materialized_path`, crear peticiones con
  // sus tablas hijas, y enlazar cada ejecución de la tirada con su entrada de
  // historial— devolvían 2xx sin ejecutar una sola línea útil.
  //
  // Un 2xx sobre un bucle vacío no prueba nada. Se importa un paquete Postman
  // v2.1 real con 2 carpetas y 3 peticiones, y sobre ÉSA se ejecutan la tirada
  // y la exportación.
  const paqueteSembrado = {
    info: { name: `Semilla CEIBA ${MARCA}`, schema: 'postman/v2.1.0' },
    item: [
      {
        name: 'Salud',
        item: [
          {
            name: 'healthz',
            request: {
              method: 'GET',
              url: { raw: DESTINO_EJECUCION },
              header: [{ key: 'x-ceiba-prueba', value: 'semilla' }],
            },
          },
          {
            name: 'healthz con cabecera desactivada',
            request: {
              method: 'GET',
              url: { raw: DESTINO_EJECUCION },
              header: [{ key: 'accept', value: 'application/json' }],
            },
          },
        ],
      },
      {
        name: 'Escritura',
        item: [
          {
            name: 'eco con cuerpo',
            request: {
              method: 'POST',
              url: { raw: DESTINO_EJECUCION },
              header: [{ key: 'content-type', value: 'application/json' }],
              body: { mode: 'raw', raw: '{"hola":"mundo"}' },
            },
          },
        ],
      },
    ],
  };
  // Va por `preparar`, no por `ejercitar`: es siembra, no una de las 27. Asi el
  // recuento sigue siendo exacto.
  const sembrada = await preparar('siembra: Postman v2.1 con 2 carpetas y 3 peticiones', {
    metodo: 'POST',
    ruta: `workspaces/${ws()}/collections/import`,
    cuerpo: paqueteSembrado,
    esperados: [201],
  });
  ids.coleccionSembradaId = sembrada.datos?.id ?? ids.collectionId;

  // --- Ejecuciones de colección -------------------------------------------
  await ejercitar({
    metodo: 'GET',
    plantilla: 'workspaces/:workspaceId/runs',
    ruta: `workspaces/${ws()}/runs`,
  });

  await ejercitar({
    metodo: 'POST',
    plantilla: 'workspaces/:workspaceId/runs',
    ruta: `workspaces/${ws()}/runs`,
    cuerpo: { collectionId: ids.coleccionSembradaId, environmentId: ids.entornoA },
    esperados: [201],
  });

  // --- Documentación, exportación e importación ----------------------------
  await ejercitar({
    metodo: 'GET',
    plantilla: 'workspaces/:workspaceId/documentation',
    ruta: `workspaces/${ws()}/documentation`,
  });

  // Se exporta la colección SEMBRADA, no la vacía: así el JSON lleva carpetas
  // y peticiones de verdad y el viaje de ida y vuelta prueba algo.
  const exportado = await ejercitar({
    metodo: 'GET',
    plantilla: 'workspaces/:workspaceId/collections/:collectionId/export',
    ruta: `workspaces/${ws()}/collections/${oAusente(ids.coleccionSembradaId)}/export`,
  });
  if (exportado.datos && typeof exportado.datos === 'object') bundleExportado = exportado.datos;

  await ejercitar({
    metodo: 'GET',
    plantilla: 'collections/:collectionId/export',
    ruta: `collections/${oAusente(ids.coleccionSembradaId)}/export`,
  });

  // La importación consume el paquete que acaba de devolver la exportación:
  // así se comprueba el viaje de ida y vuelta, no sólo que la ruta responda.
  // El servicio desduplica el nombre por su cuenta, así que no hay colisión.
  const paquete = bundleExportado ?? {
    schemaVersion: 'ceiba.collection.v1',
    collection: { name: `Importación de rescate ${MARCA}`, description: null },
    folders: [],
    requests: [],
  };
  const importado = await ejercitar({
    metodo: 'POST',
    plantilla: 'workspaces/:workspaceId/collections/import',
    ruta: `workspaces/${ws()}/collections/import`,
    cuerpo: paquete,
    esperados: [201],
    nota: bundleExportado
      ? 'usa el JSON devuelto por la exportación previa'
      : 'la exportación falló: se usa un paquete mínimo de rescate',
  });
  ids.coleccionImportadaId = importado.datos?.id ?? null;

  // --- Borrado de entornos (al final: antes hacían falta vivos) ------------
  await ejercitar({
    metodo: 'DELETE',
    plantilla: 'workspaces/:workspaceId/environments/:environmentId',
    ruta: `workspaces/${ws()}/environments/${oAusente(ids.entornoA)}`,
  });

  await ejercitar({
    metodo: 'DELETE',
    plantilla: 'environments/:environmentId',
    ruta: `environments/${oAusente(ids.entornoB)}`,
    nota: 'usa el entorno B creado en preparación',
  });
}

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

function imprimirResumen() {
  const funcionan = rutas.filter((r) => r.veredicto === 'funciona').length;
  const fallan = rutas.length - funcionan;
  const prepFallidos = preparacion.filter((p) => p.veredicto === 'falla').length;

  console.log('');
  console.log('── Resumen ────────────────────────────────────────────────────');
  console.log('');
  console.log('| # | Metodo | Ruta | HTTP | Veredicto |');
  console.log('| --: | :-- | :-- | --: | :-- |');
  for (const fila of rutas) {
    console.log(
      `| ${fila.numero} | ${fila.metodo} | \`${fila.plantilla}\` | ${fila.status || 'ERR'} | ${fila.veredicto} |`,
    );
  }
  console.log('');
  console.log(`Rutas de studio probadas: ${rutas.length} · funcionan: ${funcionan} · fallan: ${fallan}`);
  console.log(`Pasos de preparación: ${preparacion.length} · fallidos: ${prepFallidos}`);

  const resumen = {
    generadoEn: new Date().toISOString(),
    base: BASE,
    origen: ORIGEN,
    prefijo: PREFIJO,
    destinoEjecucion: DESTINO_EJECUCION,
    // Sin contraseñas: el fichero queda en el árbol de trabajo y no tiene por
    // qué guardar credenciales, aunque sean de usar y tirar.
    usuarios: {
      primario: { email: USUARIO_1.email, id: USUARIO_1.id },
      secundario: { email: USUARIO_2.email, id: USUARIO_2.id },
    },
    ids,
    preparacion,
    rutas,
    resumen: { total: rutas.length, funcionan, fallan, preparacionFallida: prepFallidos },
  };

  try {
    writeFileSync(FICHERO_RESUMEN, `${JSON.stringify(resumen, null, 2)}\n`, 'utf8');
    console.log(`Resumen JSON: ${FICHERO_RESUMEN}`);
  } catch (err) {
    console.log(`No se pudo escribir el resumen JSON: ${err instanceof Error ? err.message : err}`);
  }

  if (fallan > 0 || prepFallidos > 0) process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

function origenDe(valor) {
  try {
    return new URL(valor).origin;
  } catch {
    return String(valor).replace(/\/+$/u, '');
  }
}

async function principal() {
  console.log(`CEIBA · arnés de studio`);
  console.log(`  base   : ${BASE}/${PREFIJO}`);
  console.log(`  origin : ${ORIGEN}  (debe coincidir con CEIBA_PUBLIC_URL o el CSRF deniega)`);
  console.log(`  usuario: ${USUARIO_1.email}`);
  console.log('');

  try {
    await prepararContexto();
    await ejercitarStudio();
  } catch (err) {
    // Red de seguridad: ni un fallo imprevisto puede saltarse el resumen, que
    // es el único entregable del arnés.
    console.log('');
    console.log(`Error inesperado fuera de una ruta: ${err instanceof Error ? err.stack : err}`);
    process.exitCode = 1;
  } finally {
    imprimirResumen();
  }
}

await principal();
