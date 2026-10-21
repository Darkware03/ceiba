/**
 * Comprobación automatizada del ESTÁNDAR VISUAL de CEIBA
 * (`BRIEF-FASE4.md` §2.3, `docs/BRAND.md`).
 *
 * El cliente pidió «que todas las vistas sean bajo el estándar que definiste».
 * Afirmarlo no vale: esto **es** la comprobación. Recorre `src/**`, lista
 * fichero y línea de cada infracción y termina con código 1 si encuentra
 * alguna.
 *
 * Se ejecuta de dos maneras, a propósito, igual que
 * `check-no-token-storage.ts`:
 *   - como CLI:    `node scripts/check-estandar-visual.ts`
 *   - desde Vitest: `test/estandar-visual.test.ts`
 * Una sola implementación, para que no haya dos reglas que puedan divergir.
 *
 * REGLAS COMPROBADAS
 * ------------------
 *  R1 `color-literal`    `#rrggbb`, `rgb(…)`, `hsl(…)` en `src/**`.
 *                        Todo color sale de un token `--ceiba-*`.
 *  R2 `color-nombrado`   `color: red`, `background: white`… en propiedades de
 *                        color. Un nombre CSS es un color literal con otra
 *                        sintaxis, y además no tiene variante de tema claro.
 *  R3 `token-fantasma`   `var(--x)` donde `--x` no existe en
 *                        `@ceiba/brand/tokens.css` ni en `loader.css` ni está
 *                        definida en el propio fichero. Un token inexistente
 *                        no falla ruidosamente: el navegador descarta la
 *                        declaración y la vista se queda sin estilo.
 *  R4 `spinner-ajeno`    `@keyframes` de giro propios, `animation` que apunte
 *                        a una animación que no sea la de la marca, o clases
 *                        `.spinner` / `.loader` que no sean `ceiba-spinner`.
 *                        «Está prohibido escribir otro spinner» (§2.2.3).
 *  R5 `espera-sin-marca` Texto de espera («Cargando…», «Procesando…») en una
 *                        plantilla sin la marca girando cerca.
 *  R6 `boton-crudo`      `<button>` escrito a mano en `src/views/**`. Las
 *                        vistas componen con `CeibaBoton`; sólo se admite un
 *                        `<button>` con `role` ARIA propio (una pestaña no es
 *                        un botón y `CeibaBoton` no la representa).
 *
 * Se escribe en TypeScript sin sintaxis no borrable para que Node 24 lo
 * ejecute directamente, igual que `check-no-token-storage.ts`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Regla =
  | 'color-literal'
  | 'color-nombrado'
  | 'token-fantasma'
  | 'spinner-ajeno'
  | 'espera-sin-marca'
  | 'boton-crudo';

export interface Hallazgo {
  readonly fichero: string;
  readonly linea: number;
  readonly regla: Regla;
  readonly texto: string;
  readonly motivo: string;
}

/** Extensiones que pintan interfaz. */
const EXTENSIONES = new Set(['.ts', '.vue', '.css']);

/**
 * `test` queda fuera **con motivo**: contiene fixtures negativos que escriben
 * colores literales a propósito para demostrar que este escáner los detecta.
 * Incluirlo haría que la prueba del escáner hiciese fallar al escáner.
 */
const DIRECTORIOS_IGNORADOS = new Set(['node_modules', 'dist', 'coverage', '.vite', 'test']);

/* ------------------------------------------------------------------ R1 */

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. */
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z])/u;
/** `rgb(`, `rgba(`, `hsl(`, `hsla(`, `color(`, `lab(`, `oklch(`… */
const FUNCION_COLOR = /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\s*\(/u;

/* ------------------------------------------------------------------ R2 */

const PROPIEDADES_DE_COLOR =
  '(?:color|background|background-color|border-color|border-top-color|border-right-color|' +
  'border-bottom-color|border-left-color|outline-color|fill|stroke|caret-color|' +
  'text-decoration-color|column-rule-color|accent-color)';
const COLORES_NOMBRADOS =
  '(?:red|blue|green|white|black|gray|grey|orange|yellow|purple|pink|brown|cyan|magenta|' +
  'silver|gold|navy|teal|olive|maroon|lime|aqua|fuchsia|indigo|violet|crimson|salmon|' +
  'khaki|beige|ivory|coral|tomato|orchid|plum|tan|azure|lavender)';
const COLOR_NOMBRADO = new RegExp(
  `${PROPIEDADES_DE_COLOR}\\s*:[^;{]*?\\b${COLORES_NOMBRADOS}\\b`,
  'iu',
);

/* ------------------------------------------------------------------ R3 */

const USO_DE_VARIABLE = /var\(\s*(--[A-Za-z0-9_-]+)/gu;
const DEFINICION_DE_VARIABLE = /(^|[;{\s])(--[A-Za-z0-9_-]+)\s*:/gu;

/* ------------------------------------------------------------------ R4 */

const DECLARACION_KEYFRAMES = /@keyframes\s+([A-Za-z0-9_-]+)/u;
const USO_DE_ANIMACION = /\banimation(?:-name)?\s*:\s*([^;]+)/u;
/** Animaciones que SÍ son de la marca (`packages/brand/src/loader.css`). */
const ANIMACIONES_DE_MARCA = new Set(['ceiba-spin', 'ceiba-seed-pulse']);
/** Nombres de animación que delatan una espera propia. */
const NOMBRE_DE_GIRO = /spin|rota|rotate|gir|load|carg|throb|pulse/iu;
/** `.spinner`, `.loader`, `.mi-spinner`… que no sean `ceiba-spinner`. */
const CLASE_DE_SPINNER = /(?<![\w-])(?!ceiba-)(?:[\w-]*-)?(spinner|loader|cargador)(?![\w-])/iu;

/* ------------------------------------------------------------------ R5 */

const PALABRAS_DE_ESPERA =
  /(?:^|[>\s¡¿("'])(cargando|loading|procesando|ejecutando|enviando|importando|exportando|guardando|espere|aguarde)(?:[\s.,…!?)"':]|$)/iu;
/** Lo que acredita que la espera lleva la marca girando. */
const MARCA_DE_ESPERA = /CeibaSpinner|CeibaLoadingScreen|ceiba-spinner|ceiba-loading|:cargando=/u;
/** Líneas arriba y abajo donde se admite encontrar la marca. */
const VENTANA_DE_MARCA = 6;
/**
 * Un indicador de espera es una **etiqueta corta** («Cargando…»), no un
 * párrafo. Sin este límite, cualquier texto explicativo que empiece por un
 * gerundio («Ejecutando desde el navegador sólo se leen las cabeceras…»)
 * sería un falso positivo y el ruido haría inútil la comprobación.
 */
const LARGO_MAXIMO_DE_ETIQUETA = 60;

/* ------------------------------------------------------------------ R6 */

const BOTON_CRUDO = /<button(?![\w-])/u;
const ROL_PROPIO = /\brole\s*=\s*"(?!button")[a-z]+"/u;
/** Líneas de la etiqueta de apertura donde se busca el `role`. */
const VENTANA_DE_ROL = 8;

/* --------------------------------------------------------------- utilidades */

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
 * Tokens declarados por el paquete de marca.
 *
 * Se leen del paquete real (`packages/brand`), que es la fuente única del
 * §2.1 y **no se edita desde aquí**. Si el paquete no estuviese disponible la
 * comprobación no puede decidir, y callar sería peor que fallar: se avisa.
 */
export function tokensDeMarca(raizWeb: string): Set<string> {
  const tokens = new Set<string>();
  const base = resolve(raizWeb, '..', '..', 'packages', 'brand', 'src');
  const ficheros = ['tokens.css', 'loader.css'];
  let leidoAlguno = false;

  for (const nombre of ficheros) {
    const ruta = join(base, nombre);
    if (!existsSync(ruta)) continue;
    leidoAlguno = true;
    const contenido = readFileSync(ruta, 'utf8');
    for (const coincidencia of contenido.matchAll(DEFINICION_DE_VARIABLE)) {
      const token = coincidencia[2];
      if (token !== undefined) tokens.add(token);
    }
  }

  if (!leidoAlguno) {
    throw new Error(
      `No se encontró @ceiba/brand en ${base}: sin la lista de tokens esta ` +
        'comprobación no puede distinguir un token real de uno inventado.',
    );
  }
  return tokens;
}

/** Variables `--x: …` definidas en el propio fichero (alias locales). */
function variablesLocales(contenido: string): Set<string> {
  const locales = new Set<string>();
  for (const coincidencia of contenido.matchAll(DEFINICION_DE_VARIABLE)) {
    const token = coincidencia[2];
    if (token !== undefined) locales.add(token);
  }
  return locales;
}

/** Rango `[inicio, fin)` de líneas del bloque `<template>` de una SFC. */
function rangoDePlantilla(lineas: readonly string[]): [number, number] {
  const inicio = lineas.findIndex((l) => /^\s*<template(?:[\s>]|$)/u.test(l));
  if (inicio < 0) return [0, 0];
  const fin = lineas.findIndex((l, i) => i > inicio && /^\s*<\/template>/u.test(l));
  return [inicio, fin < 0 ? lineas.length : fin];
}

/** Rango `[inicio, fin)` del bloque `<style>` de una SFC. */
function rangoDeEstilo(lineas: readonly string[]): [number, number] {
  const inicio = lineas.findIndex((l) => /^\s*<style(?:[\s>]|$)/u.test(l));
  if (inicio < 0) return [0, 0];
  const fin = lineas.findIndex((l, i) => i > inicio && /^\s*<\/style>/u.test(l));
  return [inicio, fin < 0 ? lineas.length : fin];
}

/**
 * Texto visible de una línea de plantilla: sin atributos ni interpolaciones.
 *
 * `:cargando="x"` es una propiedad, no un texto que lea el usuario; y
 * `{{ cargando }}` es una expresión. Compararlos como texto daría falsos
 * positivos y haría la comprobación inútil a base de ruido.
 */
function textoVisible(linea: string): string {
  return linea
    .replace(/\{\{[^}]*\}\}/gu, ' ')
    .replace(/[:@#v]?[\w.-]+\s*=\s*"[^"]*"/gu, ' ')
    .replace(/[:@#v]?[\w.-]+\s*=\s*'[^']*'/gu, ' ');
}

/** ¿Es una línea de comentario? Un comentario no pinta nada. */
function esComentario(linea: string): boolean {
  const limpia = linea.trim();
  return (
    limpia.startsWith('*') ||
    limpia.startsWith('//') ||
    limpia.startsWith('/*') ||
    limpia.startsWith('<!--')
  );
}

/* ------------------------------------------------------------------ escáner */

/**
 * Recorre `<raizWeb>/src` y devuelve las infracciones del estándar.
 *
 * `tokensConocidos` se puede inyectar para analizar un árbol que no cuelga del
 * repositorio —las pruebas montan árboles temporales con infracciones a
 * propósito—. Omitido, se leen del paquete de marca, que es lo que hace el
 * CLI y lo único correcto para el código real.
 */
export function buscarInfraccionesDeEstandar(
  raizWeb: string,
  tokensConocidos?: ReadonlySet<string>,
): Hallazgo[] {
  const hallazgos: Hallazgo[] = [];
  const tokens = tokensConocidos ?? tokensDeMarca(raizWeb);
  const raizSrc = join(raizWeb, 'src');

  for (const fichero of listarFicheros(raizSrc)) {
    const contenido = readFileSync(fichero, 'utf8');
    const lineas = contenido.split('\n');
    const relativo = relative(raizWeb, fichero);
    const esVue = extname(fichero) === '.vue';
    const esVista = relativo.replace(/\\/gu, '/').startsWith('src/views/');
    const locales = variablesLocales(contenido);
    const [plantillaInicio, plantillaFin] = esVue ? rangoDePlantilla(lineas) : [0, 0];
    const [estiloInicio, estiloFin] = esVue ? rangoDeEstilo(lineas) : [0, lineas.length];

    const anotar = (linea: number, regla: Regla, motivo: string): void => {
      hallazgos.push({
        fichero: relativo,
        linea: linea + 1,
        regla,
        texto: (lineas[linea] ?? '').trim(),
        motivo,
      });
    };

    lineas.forEach((linea, i) => {
      if (esComentario(linea)) return;

      const enEstilo = esVue ? i >= estiloInicio && i < estiloFin : extname(fichero) === '.css';
      const enPlantilla = esVue && i >= plantillaInicio && i < plantillaFin;

      /* R1 — color literal, en cualquier parte del fichero. */
      const hex = HEX.exec(linea);
      if (hex !== null) {
        anotar(
          i,
          'color-literal',
          `color literal «${hex[0]}»: usa un token var(--ceiba-…) (BRIEF §2.2.1)`,
        );
      }
      const funcion = FUNCION_COLOR.exec(linea);
      if (funcion !== null) {
        anotar(
          i,
          'color-literal',
          `función de color «${funcion[0].trim()}»: usa un token var(--ceiba-…) (BRIEF §2.2.1)`,
        );
      }

      /* R2 — color nombrado en una propiedad de color. */
      if (enEstilo && COLOR_NOMBRADO.test(linea)) {
        anotar(
          i,
          'color-nombrado',
          'color CSS nombrado: no tiene variante de tema claro, usa var(--ceiba-…)',
        );
      }

      /* R3 — token inexistente. */
      for (const uso of linea.matchAll(USO_DE_VARIABLE)) {
        const token = uso[1];
        if (token === undefined) continue;
        if (tokens.has(token) || locales.has(token)) continue;
        anotar(
          i,
          'token-fantasma',
          `var(${token}) no existe en @ceiba/brand ni se define aquí: la ` +
            'declaración se descarta y el elemento queda sin estilo',
        );
      }

      /* R4 — spinner ajeno. */
      const keyframes = DECLARACION_KEYFRAMES.exec(linea);
      if (keyframes !== null) {
        anotar(
          i,
          'spinner-ajeno',
          `@keyframes «${keyframes[1]}» propio: el giro de la marca lo define ` +
            '@ceiba/brand/loader.css (BRIEF §2.2.3)',
        );
      }
      const animacion = USO_DE_ANIMACION.exec(linea);
      if (animacion !== null) {
        const nombres = (animacion[1] ?? '')
          .split(/[\s,]+/u)
          .filter((p) => /^[A-Za-z][\w-]*$/u.test(p));
        for (const nombre of nombres) {
          if (ANIMACIONES_DE_MARCA.has(nombre)) continue;
          if (!NOMBRE_DE_GIRO.test(nombre)) continue;
          anotar(
            i,
            'spinner-ajeno',
            `animación de espera «${nombre}» ajena a la marca: usa ` +
              'CeibaSpinner o CeibaLoadingScreen (BRIEF §2.2.3)',
          );
        }
      }
      if (CLASE_DE_SPINNER.test(linea)) {
        anotar(
          i,
          'spinner-ajeno',
          'clase de spinner propia: el indicador de actividad es CeibaSpinner',
        );
      }

      /* R5 — texto de espera sin la marca cerca. */
      if (enPlantilla) {
        const visible = textoVisible(linea);
        const espera = PALABRAS_DE_ESPERA.exec(visible);
        if (espera !== null && visible.trim().length <= LARGO_MAXIMO_DE_ETIQUETA) {
          const desde = Math.max(0, i - VENTANA_DE_MARCA);
          const hasta = Math.min(lineas.length, i + VENTANA_DE_MARCA + 1);
          const ventana = lineas.slice(desde, hasta).join('\n');
          if (!MARCA_DE_ESPERA.test(ventana)) {
            anotar(
              i,
              'espera-sin-marca',
              `espera «${(espera[1] ?? '').trim()}» sin el logo girando: usa ` +
                'CeibaLoadingScreen o CeibaSpinner (BRIEF §2.2.3)',
            );
          }
        }
      }

      /* R6 — botón crudo en una vista. */
      if (enPlantilla && esVista && BOTON_CRUDO.test(linea)) {
        const ventana = lineas.slice(i, Math.min(lineas.length, i + VENTANA_DE_ROL)).join('\n');
        if (!ROL_PROPIO.test(ventana)) {
          anotar(
            i,
            'boton-crudo',
            '<button> escrito a mano en una vista: reutiliza CeibaBoton (BRIEF §2.2.5)',
          );
        }
      }
    });
  }

  return hallazgos;
}

/**
 * Raíz de `apps/web`.
 *
 * Misma cautela que en `check-no-token-storage.ts`: bajo Vitest
 * `import.meta.url` no es una URL `file:`, así que `fileURLToPath` revienta.
 * Medido, no supuesto.
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
  const hallazgos = buscarInfraccionesDeEstandar(RAIZ_WEB);

  if (hallazgos.length === 0) {
    const total = tokensDeMarca(RAIZ_WEB).size;
    process.stdout.write(
      'OK: todas las vistas cumplen el estándar visual (BRIEF-FASE4 §2, docs/BRAND.md).\n' +
        `Ámbito: ${join(RAIZ_WEB, 'src')} (excluidos: ${[...DIRECTORIOS_IGNORADOS].join(', ')})\n` +
        `Tokens de @ceiba/brand reconocidos: ${total}\n` +
        'Reglas: color-literal, color-nombrado, token-fantasma, spinner-ajeno, ' +
        'espera-sin-marca, boton-crudo\n',
    );
    process.exit(0);
  }

  const porRegla = new Map<Regla, number>();
  for (const hallazgo of hallazgos) {
    porRegla.set(hallazgo.regla, (porRegla.get(hallazgo.regla) ?? 0) + 1);
  }

  process.stderr.write(`FALLO: ${hallazgos.length} infracciones del estándar visual\n`);
  for (const hallazgo of hallazgos) {
    process.stderr.write(
      `  ${hallazgo.fichero}:${hallazgo.linea}  [${hallazgo.regla}] ${hallazgo.motivo}\n` +
        `    ${hallazgo.texto}\n`,
    );
  }
  process.stderr.write('\nResumen por regla:\n');
  for (const [regla, cuantos] of [...porRegla].sort((a, b) => b[1] - a[1])) {
    process.stderr.write(`  ${regla}: ${cuantos}\n`);
  }
  process.exit(1);
}
