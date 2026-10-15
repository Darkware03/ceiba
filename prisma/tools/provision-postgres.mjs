#!/usr/bin/env node
/**
 * Levanta un PostgreSQL 16 REAL sin Docker, sin root y sin gestor de paquetes.
 *
 * Por qué existe
 * --------------
 * El entorno de construcción no tiene `docker`, ni demonio, ni socket, ni
 * `psql`, ni permisos de root. Durante toda la fase 1 eso dejó el esquema en
 * «validado sintácticamente»: el SQL estaba bien escrito y **nadie lo había
 * ejecutado nunca**. Este script elimina esa excusa.
 *
 * Descarga los binarios relocalizables que publica Zonky en Maven Central —el
 * mismo artefacto que usa `embedded-postgres` en el mundo JVM—, los extrae en
 * espacio de usuario y arranca un cluster en un puerto alto. No necesita
 * privilegios: PostgreSQL funciona perfectamente como usuario normal mientras
 * el directorio de datos sea suyo.
 *
 * Nota sobre la extracción: el artefacto es un `.jar` (zip) que contiene un
 * `.txz`. La imagen no trae `xz`, pero Python sí trae `lzma`, así que se
 * delega en él.
 *
 * Uso:
 *   node provision-postgres.mjs            # descarga, initdb y arranca
 *   node provision-postgres.mjs --stop     # para el cluster
 *   node provision-postgres.mjs --purge    # para y borra los datos
 *
 * Después:
 *   npm --prefix prisma/tools install
 *   node prisma/tools/verify-integridad.mjs
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const VERSION = '16.15.0';
const PUERTO = process.env.CEIBA_PG_PORT ?? '55432';
const USUARIO = 'ceiba';
const BASE = 'ceiba';
const RAIZ = process.env.CEIBA_PG_HOME ?? '/software-factory/.toolchain/pg';
const DIST = join(RAIZ, 'dist');
const DATA = join(RAIZ, 'data');
const LOG = join(RAIZ, 'pg.log');
const URL_MAVEN =
  `https://repo1.maven.org/maven2/io/zonky/test/postgres/embedded-postgres-binaries-linux-amd64/` +
  `${VERSION}/embedded-postgres-binaries-linux-amd64-${VERSION}.jar`;

const bin = (n) => join(DIST, 'bin', n);
const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

function parar() {
  if (!existsSync(bin('pg_ctl')) || !existsSync(DATA)) return false;
  const r = spawnSync(bin('pg_ctl'), ['-D', DATA, '-m', 'fast', '-w', 'stop'], { encoding: 'utf8' });
  return r.status === 0;
}

if (process.argv.includes('--stop')) {
  console.log(parar() ? 'cluster detenido' : 'no habia cluster en marcha');
  process.exit(0);
}
if (process.argv.includes('--purge')) {
  parar();
  rmSync(DATA, { recursive: true, force: true });
  console.log('cluster detenido y datos borrados');
  process.exit(0);
}

/* ---------- 1. binarios ---------- */
if (!existsSync(bin('postgres'))) {
  console.log(`descargando PostgreSQL ${VERSION} (binarios relocalizables)...`);
  mkdirSync(RAIZ, { recursive: true });
  const jar = join(RAIZ, 'pg.jar');
  sh('curl', ['-sSL', '--max-time', '600', '-o', jar, URL_MAVEN]);

  // zip -> .txz -> tar, con lzma de Python porque la imagen no trae xz.
  const py = `
import zipfile, lzma, tarfile, io, os
os.chdir(${JSON.stringify(RAIZ)})
z = zipfile.ZipFile("pg.jar")
tx = [n for n in z.namelist() if n.endswith(".txz")][0]
t = tarfile.open(fileobj=io.BytesIO(lzma.decompress(z.read(tx))))
os.makedirs("dist", exist_ok=True)
try:
    t.extractall("dist", filter="tar")
except TypeError:
    t.extractall("dist")
print("extraido")
`;
  sh('python3', ['-c', py]);
  console.log(`  ${sh(bin('postgres'), ['--version']).trim()}`);
} else {
  console.log(`binarios ya presentes: ${sh(bin('postgres'), ['--version']).trim()}`);
}

/* ---------- 2. cluster ---------- */
if (!existsSync(join(DATA, 'PG_VERSION'))) {
  console.log('creando cluster (initdb)...');
  mkdirSync(DATA, { recursive: true });
  sh(bin('initdb'), ['-D', DATA, '-U', USUARIO, '--auth=trust', '-E', 'UTF8']);
}

/* ---------- 3. arranque ---------- */
const vivo = spawnSync(bin('pg_ctl'), ['-D', DATA, 'status'], { encoding: 'utf8' }).status === 0;
if (vivo) {
  console.log(`ya estaba en marcha en el puerto ${PUERTO}`);
} else {
  console.log(`arrancando en 127.0.0.1:${PUERTO}...`);
  sh(bin('pg_ctl'), [
    '-D', DATA,
    '-o', `-p ${PUERTO} -k ${DATA} -c listen_addresses=127.0.0.1`,
    '-l', LOG,
    '-w', 'start',
  ]);
}

/* ---------- 4. base de datos ---------- */
const { Client } = await import('pg');
const admin = new Client({ host: '127.0.0.1', port: Number(PUERTO), user: USUARIO, database: 'postgres' });
await admin.connect();
const existe = await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [BASE]);
if (existe.rowCount === 0) {
  await admin.query(`CREATE DATABASE ${BASE}`);
  console.log(`base de datos "${BASE}" creada`);
} else {
  console.log(`base de datos "${BASE}" ya existe`);
}
await admin.end();

const url = `postgresql://${USUARIO}@127.0.0.1:${PUERTO}/${BASE}`;
console.log(`\nlisto.  DATABASE_URL=${url}`);
console.log('\naplicar las migraciones:');
console.log('  node prisma/tools/apply-migrations.mjs');
console.log('verificar la integridad:');
console.log('  node prisma/tools/verify-integridad.mjs');
