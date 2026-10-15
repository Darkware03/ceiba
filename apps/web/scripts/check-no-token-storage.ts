/**
 * Comprobación automatizada de la prohibición 1 del ADR-0009 §11:
 *
 *   «Tokens de sesión en `localStorage` o `sessionStorage` (C-31). Es
 *    verificable: una prueba recorre `apps/web` y falla si aparece
 *    `localStorage.setItem` con algo marcado como credencial.»
 *
 * Este fichero **es** esa prueba. Se ejecuta de dos maneras, a propósito:
 *   - como CLI:   `node scripts/check-no-token-storage.ts`
 *   - desde Vitest: `test/sin-credenciales-en-almacenamiento.test.ts`
 * Una sola implementación, para que no haya dos reglas que puedan divergir.
 *
 * POSTURA: **lista blanca**. Cualquier escritura en `localStorage` o
 * `sessionStorage` es un hallazgo salvo que su clave esté explícitamente
 * permitida abajo. Una lista negra de palabras («token», «session»…) se
 * esquiva renombrando la variable; una lista blanca, no.
 *
 * Se escribe en TypeScript sin sintaxis no borrable para que Node 24 lo
 * ejecute directamente, igual que hace `apps/engine`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Hallazgo {
  readonly fichero: string;
  readonly linea: number;
  readonly texto: string;
  readonly motivo: string;
}

/**
 * Claves que SÍ pueden persistirse. Ninguna es una credencial:
 * `ceiba.tema` es la preferencia de tema (claro/oscuro).
 */
export const CLAVES_PERMITIDAS: readonly string[] = ['ceiba.tema'];

const EXTENSIONES = new Set(['.ts', '.vue', '.js', '.mjs', '.html']);

/**
 * `test` se excluye **a propósito y con motivo**: contiene fixtures negativos
 * que escriben credenciales falsas justamente para demostrar que este escáner
 * las detecta. Si se incluyera, la prueba que verifica el escáner haría fallar
 * al escáner, y la salida sería inútil. Lo que se audita es el código que se
 * envía al navegador: `src/`, `index.html` y `scripts/`.
 */
const DIRECTORIOS_IGNORADOS = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.vite',
  'test',
]);

/** `localStorage.setItem(...)`, `sessionStorage.setItem(...)`, `.clear()`, etc. */
const ESCRITURA = /\b(?:local|session)Storage(?:\s*\?\.)?\s*\.\s*(setItem|removeItem|clear)\s*\(/u;
/** Acceso por índice: `localStorage['x'] = …`. */
const ESCRITURA_INDICE = /\b(?:local|session)Storage\s*\[\s*['"`]/u;

/** Primera cadena literal del fragmento, que es la clave en `setItem`. */
function claveDe(fragmento: string): string | null {
  const comillas = /['"`]([^'"`]*)['"`]/u.exec(fragmento);
  return comillas?.[1] ?? null;
}

function listarFicheros(raiz: string): string[] {
  const encontrados: string[] = [];
  const pendientes: string[] = [raiz];

  while (pendientes.length > 0) {
    const actual = pendientes.pop();
    if (actual === undefined) break;

    let entradas: string[];
    try {
      entradas = readdirSync(actual);
    } catch {
      continue;
    }

    for (const entrada of entradas) {
      if (DIRECTORIOS_IGNORADOS.has(entrada)) continue;
      const ruta = join(actual, entrada);
      const info = statSync(ruta);
      if (info.isDirectory()) pendientes.push(ruta);
      else if (EXTENSIONES.has(extname(ruta))) encontrados.push(ruta);
    }
  }

  return encontrados.sort();
}

/**
 * Recorre un árbol y devuelve las escrituras de almacenamiento persistente
 * que no están en la lista blanca.
 */
export function buscarCredencialesPersistidas(raiz: string): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];

  for (const fichero of listarFicheros(raiz)) {
    // El propio comprobador habla de `localStorage` por definición.
    if (fichero.endsWith('check-no-token-storage.ts')) continue;

    const lineas = readFileSync(fichero, 'utf8').split('\n');

    lineas.forEach((linea, indice) => {
      const porIndice = ESCRITURA_INDICE.test(linea);
      const coincidencia = ESCRITURA.exec(linea);
      if (coincidencia === null && !porIndice) return;

      const resto = linea.slice((coincidencia?.index ?? 0) + (coincidencia?.[0]?.length ?? 0));
      const clave = claveDe(porIndice ? linea.slice(linea.indexOf('[')) : resto);

      // Una clave calculada no se puede auditar leyéndola: se rechaza.
      if (clave === null) {
        hallazgos.push({
          fichero: relative(raiz, fichero),
          linea: indice + 1,
          texto: linea.trim(),
          motivo: 'escritura en almacenamiento con clave no literal (no auditable)',
        });
        return;
      }

      if (!CLAVES_PERMITIDAS.includes(clave)) {
        hallazgos.push({
          fichero: relative(raiz, fichero),
          linea: indice + 1,
          texto: linea.trim(),
          motivo: `clave «${clave}» no está en la lista blanca`,
        });
      }
    });
  }

  return hallazgos;
}

/**
 * Raíz de `apps/web`.
 *
 * No es una constante porque bajo Vitest `import.meta.url` **no** es una URL
 * `file:` —el ejecutor sirve los módulos por su propio transporte— y
 * `fileURLToPath` revienta con `ERR_INVALID_URL_SCHEME`. Medido, no supuesto.
 * En ese caso se cae al directorio de trabajo, y se comprueba que de verdad
 * es `apps/web` en vez de confiar a ciegas.
 */
export function raizDeWeb(): string {
  const url = import.meta.url;
  if (url.startsWith('file:')) return fileURLToPath(new URL('..', url));

  const trabajo = process.cwd();
  const manifiesto = join(trabajo, 'package.json');
  const nombre = JSON.parse(readFileSync(manifiesto, 'utf8')) as { name?: unknown };
  if (nombre.name !== '@ceiba/web') {
    throw new Error(
      `No se puede resolver la raíz de apps/web: ${trabajo} no es @ceiba/web (${String(nombre.name)}).`,
    );
  }
  return trabajo;
}

function esEjecucionDirecta(): boolean {
  const argumento = process.argv[1];
  if (argumento === undefined) return false;
  if (!import.meta.url.startsWith('file:')) return false;
  return fileURLToPath(import.meta.url) === argumento;
}

if (esEjecucionDirecta()) {
  const RAIZ_WEB = raizDeWeb();
  const hallazgos = buscarCredencialesPersistidas(RAIZ_WEB);
  if (hallazgos.length === 0) {
    process.stdout.write(
      'OK: ninguna credencial en localStorage/sessionStorage (ADR-0009 §11.1, C-31).\n' +
        `Ámbito: ${RAIZ_WEB} (excluidos: ${[...DIRECTORIOS_IGNORADOS].join(', ')})\n` +
        `Claves permitidas: ${CLAVES_PERMITIDAS.join(', ')}\n`,
    );
    process.exit(0);
  }
  process.stderr.write('FALLO: escrituras no permitidas en almacenamiento persistente\n');
  for (const hallazgo of hallazgos) {
    process.stderr.write(
      `  ${hallazgo.fichero}:${hallazgo.linea}  ${hallazgo.motivo}\n    ${hallazgo.texto}\n`,
    );
  }
  process.exit(1);
}
