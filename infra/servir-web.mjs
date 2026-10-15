#!/usr/bin/env node
/**
 * Sirve `apps/web/dist` y hace de proxy hacia la API en el MISMO ORIGEN.
 *
 * Por qué el proxy, y no servir la web y la API en puertos distintos
 * ------------------------------------------------------------------
 * La decisión C-31 fija la sesión en una cookie `HttpOnly` con
 * `SameSite=Lax`. Con dos orígenes distintos el navegador no manda esa cookie
 * en las llamadas de la interfaz, y haría falta `SameSite=None` —que exige
 * HTTPS— más CORS con credenciales. Un mismo origen lo evita entero y es,
 * además, la topología que monta Nginx en `infra/compose.yaml`: esto imita en
 * local lo que allí hace el proxy inverso.
 *
 * No pretende sustituir a Nginx. Es lo mínimo para tener el producto usable
 * en una máquina sin Docker.
 *
 * Uso: node infra/servir-web.mjs [puertoWeb] [puertoApi]
 */
import { createServer as crearServidorPlano, request as peticion } from 'node:http';
import { createServer as crearServidorTls } from 'node:https';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, '..');
const DIST = resolve(RAIZ, 'apps', 'web', 'dist');
const PUERTO_WEB = Number(process.argv[2] ?? 8443);
const PUERTO_API = Number(process.argv[3] ?? 3000);

/* ------------------------------------------------------------------ TLS
 * SE SIRVE POR HTTPS, Y NO ES UN LUJO DE DESARROLLO.
 *
 * Las cookies de CEIBA se llaman `__Host-ceiba_session` y `__Host-ceiba_csrf`.
 * El prefijo `__Host-` es **normativo**: el cliente (navegador o curl) sólo
 * acepta la cookie si viene con `Secure`, y `Secure` exige HTTPS. Sobre HTTP
 * plano la cookie se emite y **nadie la guarda**, así que el registro falla con
 * `csrf_invalido: Falta el testigo CSRF` y no hay forma de iniciar sesión.
 * Comprobado: con HTTP el tarro de cookies queda vacío.
 *
 * Por eso por defecto aquí se termina TLS con un certificado autofirmado de
 * desarrollo. En producción lo hace Nginx (`infra/compose.yaml`); esto imita
 * esa capa.
 *
 * CUANDO NO HAY TLS (`CEIBA_WEB_TLS=0`). Se admite servir en claro porque el
 * portal del Gateway sólo sabe proxyar HTTP: contra un upstream HTTPS devuelve
 * 502. En ese modo la API arranca con `CEIBA_COOKIE_SECURE=false` y las
 * cookies pierden el prefijo `__Host-` para seguir siendo almacenables. Es
 * exclusivo de desarrollo: en producción manda Nginx con TLS y los nombres
 * normativos.
 */
const USAR_TLS = process.env['CEIBA_WEB_TLS'] !== '0';
const TLS_DIR = resolve(RAIZ, '.run', 'tls');
const CLAVE = join(TLS_DIR, 'dev.key');
const CERT = join(TLS_DIR, 'dev.crt');
if (USAR_TLS && (!existsSync(CLAVE) || !existsSync(CERT))) {
  console.error(`No hay certificado en ${TLS_DIR}. Generalo con:`);
  console.error(
    `  openssl req -x509 -newkey rsa:2048 -nodes -keyout ${CLAVE} -out ${CERT} \\\n` +
      `    -days 365 -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"`,
  );
  process.exit(1);
}

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

/** Rutas que pertenecen a la API y no al enrutador de la interfaz. */
const esApi = (ruta) =>
  ruta.startsWith('/v1/') ||
  ruta === '/v1' ||
  ruta.startsWith('/api/') ||
  ruta === '/healthz' ||
  ruta === '/readyz';

function haciaApi(req, res) {
  const salida = peticion(
    {
      host: '127.0.0.1',
      port: PUERTO_API,
      method: req.method,
      path: req.url,
      // Se reenvían las cabeceras tal cual (incluida `cookie`) y se añaden las
      // de proxy que la API necesita para resolver la IP real y saber que el
      // origen público es el de la web. Sin esto, el límite por IP y la
      // auditoría registrarían siempre 127.0.0.1.
      headers: {
        ...req.headers,
        host: `127.0.0.1:${PUERTO_API}`,
        'x-forwarded-for': req.socket.remoteAddress ?? '127.0.0.1',
        // TLS termina aquí: la API debe creer que el origen público es https,
        // porque es lo que ve el navegador y lo que exige la cookie `Secure`.
        'x-forwarded-proto': USAR_TLS ? 'https' : 'http',
        'x-forwarded-host': req.headers.host ?? `127.0.0.1:${PUERTO_WEB}`,
      },
    },
    (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    },
  );
  salida.on('error', (e) => {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'api_inalcanzable', detalle: e.message }));
  });
  req.pipe(salida);
}

function estatico(req, res) {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const rel = normalize(url).replace(/^(\.\.[/\\])+/, '');
  let fichero = join(DIST, rel);

  // SPA: cualquier ruta que no sea un fichero existente devuelve index.html,
  // para que el enrutador de Vue resuelva en cliente y un refresco en
  // /workspaces/algo no dé 404.
  if (!existsSync(fichero) || statSync(fichero).isDirectory()) {
    fichero = join(DIST, 'index.html');
  }
  if (!existsSync(fichero)) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('La interfaz no está construida. Ejecuta: npm --prefix apps/web run build');
    return;
  }
  res.writeHead(200, {
    'content-type': TIPOS[extname(fichero)] ?? 'application/octet-stream',
    'cache-control': fichero.endsWith('index.html') ? 'no-store' : 'public, max-age=3600',
  });
  createReadStream(fichero).pipe(res);
}

const manejador = (req, res) => {
  if (esApi((req.url ?? '/').split('?')[0])) haciaApi(req, res);
  else estatico(req, res);
};

const servidor = USAR_TLS
  ? crearServidorTls({ key: readFileSync(CLAVE), cert: readFileSync(CERT) }, manejador)
  : crearServidorPlano(manejador);

servidor.listen(PUERTO_WEB, '0.0.0.0', () => {
  const esquema = USAR_TLS ? 'https' : 'http';
  console.log(`CEIBA web  ${esquema}://127.0.0.1:${PUERTO_WEB}/   (proxy /api -> :${PUERTO_API})`);
  console.log(`dist       ${DIST}`);
});
