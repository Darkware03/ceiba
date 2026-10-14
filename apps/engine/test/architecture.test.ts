/**
 * Pruebas de ARQUITECTURA. No comprueban comportamiento: comprueban que las
 * reglas duras del ADR-0002 y de C-SSRF-09 siguen vivas en el código.
 *
 * ADR-0002 §Verificación: «Prueba que lee `apps/engine/package.json` y falla
 * si aparece `@prisma/client`, `pg` o `DATABASE_URL` en el código.»
 * C-SSRF-09 (2): prohibido `fetch`, `node:http`, `node:https`, `axios` y
 * `node-fetch` en todo el paquete del motor.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(RAIZ, 'src');

function ficherosFuente(dir: string): string[] {
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...ficherosFuente(ruta));
    else if (nombre.endsWith('.ts')) salida.push(ruta);
  }
  return salida;
}

const FUENTES = ficherosFuente(SRC).map((ruta) => ({
  ruta: relative(RAIZ, ruta),
  texto: readFileSync(ruta, 'utf8'),
}));

/** Quita comentarios de línea y de bloque para no dar falsos positivos. */
function sinComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('hay ficheros fuente que analizar', () => {
  assert.ok(FUENTES.length >= 10, `sólo se encontraron ${FUENTES.length} ficheros`);
});

test('ADR-0002 regla 1 — el motor NO declara dependencias de base de datos', () => {
  const pkg = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const todas = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const prohibidas = ['@prisma/client', 'prisma', 'pg', 'postgres', 'mysql2', 'ioredis', 'redis', 'knex', 'typeorm', 'drizzle-orm'];
  for (const mala of prohibidas) {
    assert.ok(!todas.includes(mala), `apps/engine no puede depender de ${mala}`);
  }

  // Lista blanca: cada dependencia nueva es superficie de ataque en el proceso
  // que ejecuta entrada hostil. Si se añade una, hay que tocar esta prueba a
  // conciencia.
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}).sort(), ['fastify', 'undici', 'zod']);
  assert.deepEqual(Object.keys(pkg.devDependencies ?? {}).sort(), ['@types/node', 'typescript']);
});

test('ADR-0002 reglas 1 y 2 — ni DATABASE_URL ni la clave maestra aparecen como lectura', () => {
  const secretos = ['CEIBA_SECRETS_MASTER_KEY', 'CEIBA_JWT_SECRET', 'POSTGRES_PASSWORD', 'REDIS_URL'];
  for (const { ruta, texto } of FUENTES) {
    for (const secreto of secretos) {
      const lecturas = new RegExp(`env(\\.|\\[['"\`])${secreto}`, 'g');
      assert.ok(!lecturas.test(texto), `${ruta} no puede leer ${secreto}`);
    }
    assert.ok(!/env(\.|\[['"`])DATABASE_URL/.test(texto), `${ruta} no puede leer DATABASE_URL`);
  }
  // La única mención permitida es la lista de variables PROHIBIDAS de config.ts.
  const config = FUENTES.find((f) => f.ruta.endsWith('src/config.ts'));
  assert.ok(config);
  assert.ok(config.texto.includes('FORBIDDEN_ENV_VARS'));
});

test('ADR-0002 regla 3 — el motor no conoce usuarios, workspaces ni permisos', () => {
  const conceptos = [/\buserId\b/, /\bworkspaceId\b/, /\bpermission\b/i, /\brole\b/i, /\bsessionId\b/];
  for (const { ruta, texto } of FUENTES) {
    const limpio = sinComentarios(texto);
    for (const concepto of conceptos) {
      assert.ok(!concepto.test(limpio), `${ruta} menciona un concepto de negocio: ${concepto}`);
    }
  }
});

test('C-SSRF-09 — ningún cliente HTTP no autorizado en src/', () => {
  const prohibidos: Array<[RegExp, string]> = [
    [/from\s+['"]node:https?['"]/, 'node:http / node:https'],
    [/require\(\s*['"]node:https?['"]\s*\)/, 'require node:http'],
    [/from\s+['"]axios['"]/, 'axios'],
    [/from\s+['"]node-fetch['"]/, 'node-fetch'],
    [/from\s+['"]got['"]/, 'got'],
    [/from\s+['"]superagent['"]/, 'superagent'],
    [/\bEnvHttpProxyAgent\b/, 'EnvHttpProxyAgent (C-SSRF-10)'],
    [/\bsetGlobalDispatcher\b/, 'setGlobalDispatcher sin revisión'],
  ];
  for (const { ruta, texto } of FUENTES) {
    const limpio = sinComentarios(texto);
    for (const [patron, nombre] of prohibidos) {
      assert.ok(!patron.test(limpio), `${ruta} usa ${nombre}`);
    }
  }
});

test('C-SSRF-09 — `fetch` global prohibido: Node 24.21.0 lo sirve con su undici interno', () => {
  // Hecho medido: process.versions.undici = 7.29.1, distinto de la dependencia
  // declarada. `fetch(url)` saldría por un dispatcher SIN nuestra política.
  assert.equal(process.versions.undici, '7.29.1', 'si cambia la versión interna, revisa esta prueba');

  for (const { ruta, texto } of FUENTES) {
    const limpio = sinComentarios(texto);
    assert.ok(!/(^|[^.\w])fetch\s*\(/.test(limpio), `${ruta} llama a fetch()`);
    assert.ok(!/globalThis\.fetch/.test(limpio), `${ruta} usa globalThis.fetch`);
  }
});

test('C-SSRF-02 — socketPath nunca se toma de la entrada: se fija a null', () => {
  const connector = FUENTES.find((f) => f.ruta.endsWith('src/net/guarded-connector.ts'));
  assert.ok(connector);
  assert.match(connector.texto, /socketPath:\s*null/);

  // Y en ningún otro sitio se asigna socketPath.
  for (const { ruta, texto } of FUENTES) {
    if (ruta.endsWith('guarded-connector.ts')) continue;
    assert.ok(!/socketPath\s*:/.test(sinComentarios(texto)), `${ruta} asigna socketPath`);
  }
});

test('C-SSRF-05 — autoSelectFamily queda desactivado explícitamente', () => {
  const connector = FUENTES.find((f) => f.ruta.endsWith('src/net/guarded-connector.ts'));
  assert.ok(connector);
  assert.match(connector.texto, /autoSelectFamily:\s*false/);
  // Hecho medido que justifica la línea anterior.
  assert.equal(net.getDefaultAutoSelectFamily(), true, 'Happy Eyeballs sigue activado por defecto en Node');
  assert.equal(net.getDefaultAutoSelectFamilyAttemptTimeout(), 250);
});

test('toda salida de red pasa por el dispatcher guardado', () => {
  const usanUndici = FUENTES.filter((f) => /from\s+['"]undici['"]/.test(f.texto)).map((f) => f.ruta);
  assert.deepEqual(
    usanUndici.sort(),
    ['src/http/execute-request.use-case.ts', 'src/net/guarded-connector.ts', 'src/net/guarded-dispatcher.ts'].sort(),
    `sólo estos ficheros pueden importar undici; encontrados: ${usanUndici.join(', ')}`,
  );
});

test('la sintaxis es BORRABLE: nada de enum, namespace ni propiedades de parámetro', () => {
  // `node src/index.ts` y `node --test` funcionan por borrado de tipos; un
  // `enum` rompe el arranque en tiempo de ejecución (medido).
  for (const { ruta, texto } of FUENTES) {
    const limpio = sinComentarios(texto);
    assert.ok(!/^\s*(export\s+)?(const\s+)?enum\s+/m.test(limpio), `${ruta} usa enum`);
    assert.ok(!/^\s*(export\s+)?namespace\s+/m.test(limpio), `${ruta} usa namespace`);
    assert.ok(!/constructor\s*\([^)]*\b(private|public|readonly)\s+\w/.test(limpio), `${ruta} usa propiedades de parámetro`);
  }
});
