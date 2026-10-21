/**
 * ════════════════════════════════════════════════════════════════════════════
 * LECTOR DE `multipart/form-data` (RFC 7578) — módulo **puro**.
 *
 * POR QUÉ ESTÁ ESCRITO A MANO Y NO ES `@fastify/multipart`
 * -------------------------------------------------------
 * `apps/api/package.json` **no** declara `@fastify/multipart` (medido:
 * `apps/api/node_modules/@fastify/` sólo contiene `cookie` y `helmet`), y en
 * la fase 7 el fichero `package.json` de la API está **fuera de mi ámbito de
 * escritura**: añadir una dependencia exigiría tocarlo. Las opciones eran
 * pararse y no entregar P5, o leer el formato aquí. El formato es pequeño,
 * está completamente especificado y el cuerpo ya viene **acotado** por
 * `bodyLimit` antes de llegar, así que se lee aquí.
 *
 * Esto NO es un analizador de uso general: es deliberadamente restrictivo.
 *
 *  - **Trabaja sobre un `Buffer` ya completo**, no sobre un flujo. El límite de
 *    tamaño lo impone Fastify con `bodyLimit` *antes* de que se asigne memoria
 *    aquí, así que no hay forma de que un cuerpo enorme entre por esta puerta:
 *    el 413 se decide arriba, no abajo.
 *  - **Número de partes acotado** (`maxPartes`), para que un cuerpo pequeño con
 *    cien mil delimitadores no se convierta en cien mil objetos.
 *  - **Cabeceras de parte acotadas** (`MAX_CABECERAS_BYTES`). Una parte cuyo
 *    bloque de cabeceras no termine dentro de ese margen es un error, no una
 *    búsqueda infinita.
 *  - **No decodifica `content-transfer-encoding`.** RFC 7578 §4.7 dice que no
 *    se debe usar en HTTP; si llega, se rechaza en vez de adivinar.
 *  - **El nombre que manda el cliente NUNCA se usa como ruta.** Aquí sólo se
 *    extrae y se limpia de separadores y de caracteres de control; quien decide
 *    dónde se escribe es el almacén, con un nombre generado.
 * ════════════════════════════════════════════════════════════════════════════
 */

/** Tope del bloque de cabeceras de UNA parte. 16 KiB es holgadísimo. */
const MAX_CABECERAS_BYTES = 16 * 1024;

export interface ParteMultipart {
  /** Valor de `name=` en `Content-Disposition`. Siempre presente. */
  readonly nombre: string;
  /**
   * Valor de `filename=` / `filename*=`, ya saneado: sin separadores de ruta,
   * sin caracteres de control y recortado. `null` si la parte no es fichero.
   */
  readonly nombreDeFichero: string | null;
  readonly contentType: string | null;
  readonly contenido: Buffer;
}

export class ErrorMultipart extends Error {
  override readonly name = 'ErrorMultipart';
}

/**
 * Extrae el `boundary` de la cabecera `Content-Type`.
 *
 * RFC 2046 §5.1.1: entre 1 y 70 caracteres del juego `bcharsnospace` más el
 * espacio, y puede venir entrecomillado. Se valida de verdad: un `boundary`
 * con caracteres fuera del juego permitido haría que la búsqueda del
 * delimitador no coincidiese con lo que el cliente creyó enviar.
 */
export function extraerBoundary(contentType: string | undefined): string {
  if (contentType === undefined || contentType.trim() === '') {
    throw new ErrorMultipart('falta la cabecera Content-Type');
  }
  const [tipo, ...parametros] = contentType.split(';');
  if ((tipo ?? '').trim().toLowerCase() !== 'multipart/form-data') {
    throw new ErrorMultipart('el Content-Type no es multipart/form-data');
  }
  for (const parametro of parametros) {
    const separador = parametro.indexOf('=');
    if (separador < 0) continue;
    const clave = parametro.slice(0, separador).trim().toLowerCase();
    if (clave !== 'boundary') continue;
    let valor = parametro.slice(separador + 1).trim();
    if (valor.startsWith('"') && valor.endsWith('"') && valor.length >= 2) {
      valor = valor.slice(1, -1);
    }
    if (valor === '' || valor.length > 70) {
      throw new ErrorMultipart('el boundary tiene una longitud inválida');
    }
    if (!/^[A-Za-z0-9'()+_,\-./:=? ]+$/u.test(valor)) {
      throw new ErrorMultipart('el boundary contiene caracteres no permitidos');
    }
    return valor;
  }
  throw new ErrorMultipart('el Content-Type no trae boundary');
}

export interface OpcionesMultipart {
  /** Tope de partes. Por encima se rechaza en vez de seguir asignando. */
  readonly maxPartes?: number;
}

/**
 * Trocea el cuerpo en partes.
 *
 * El recorrido es el canónico: se antepone un `\r\n` virtual para que el
 * primer delimitador se busque igual que los demás, y cada delimitador va
 * seguido de `--` (fin) o de `\r\n` (sigue otra parte). Cualquier otra cosa es
 * un cuerpo mal formado y se rechaza; **no se intenta recuperar**, porque
 * «recuperarse» de un multipart ambiguo es justo como se cuelan las
 * discrepancias de interpretación entre dos lectores.
 */
export function analizarMultipart(
  cuerpo: Buffer,
  contentType: string | undefined,
  opciones: OpcionesMultipart = {},
): ParteMultipart[] {
  const boundary = extraerBoundary(contentType);
  const maxPartes = opciones.maxPartes ?? 64;

  const delimitador = Buffer.from(`\r\n--${boundary}`, 'utf8');
  // El `\r\n` de cabeza es virtual: no se copia el cuerpo entero, se compensa
  // el desplazamiento al buscar.
  const conPrologo = Buffer.concat([Buffer.from('\r\n', 'utf8'), cuerpo]);

  let posicion = conPrologo.indexOf(delimitador);
  if (posicion !== 0) {
    // Algunos clientes anteponen un preámbulo (RFC 2046 lo permite). Se tolera
    // sólo si el primer delimitador aparece en algún sitio.
    if (posicion < 0) throw new ErrorMultipart('no se encontró el delimitador inicial');
  }

  const partes: ParteMultipart[] = [];
  while (true) {
    const inicioMarca = posicion + delimitador.length;
    if (inicioMarca + 2 > conPrologo.length) {
      throw new ErrorMultipart('el cuerpo termina dentro de un delimitador');
    }
    const marca = conPrologo.subarray(inicioMarca, inicioMarca + 2).toString('latin1');
    if (marca === '--') return partes; // delimitador de cierre
    if (marca !== '\r\n') {
      throw new ErrorMultipart('delimitador mal formado');
    }

    const inicioParte = inicioMarca + 2;
    const siguiente = conPrologo.indexOf(delimitador, inicioParte);
    if (siguiente < 0) throw new ErrorMultipart('falta el delimitador de cierre');

    if (partes.length >= maxPartes) {
      throw new ErrorMultipart(`el formulario trae más de ${maxPartes} partes`);
    }
    partes.push(analizarParte(conPrologo.subarray(inicioParte, siguiente)));
    posicion = siguiente;
  }
}

const FIN_DE_CABECERAS = Buffer.from('\r\n\r\n', 'utf8');

function analizarParte(bruto: Buffer): ParteMultipart {
  const limite = Math.min(bruto.length, MAX_CABECERAS_BYTES + FIN_DE_CABECERAS.length);
  const corte = bruto.subarray(0, limite).indexOf(FIN_DE_CABECERAS);
  if (corte < 0) {
    throw new ErrorMultipart('una parte no tiene un bloque de cabeceras válido');
  }

  const cabeceras = new Map<string, string>();
  const texto = bruto.subarray(0, corte).toString('utf8');
  for (const linea of texto.split('\r\n')) {
    if (linea === '') continue;
    const separador = linea.indexOf(':');
    if (separador < 0) throw new ErrorMultipart('cabecera de parte mal formada');
    cabeceras.set(
      linea.slice(0, separador).trim().toLowerCase(),
      linea.slice(separador + 1).trim(),
    );
  }

  const transferencia = cabeceras.get('content-transfer-encoding');
  if (transferencia !== undefined && transferencia.toLowerCase() !== 'binary') {
    // RFC 7578 §4.7: no se debe usar en HTTP. Adivinar la decodificación es
    // peor que rechazar.
    throw new ErrorMultipart('content-transfer-encoding no está soportado');
  }

  const disposicion = cabeceras.get('content-disposition');
  if (disposicion === undefined) {
    throw new ErrorMultipart('una parte no trae Content-Disposition');
  }
  const nombre = parametroDeDisposicion(disposicion, 'name');
  if (nombre === null) {
    throw new ErrorMultipart('una parte no trae el parámetro name');
  }

  return {
    nombre,
    nombreDeFichero: sanearNombreDeFichero(parametroDeDisposicion(disposicion, 'filename')),
    contentType: cabeceras.get('content-type') ?? null,
    contenido: Buffer.from(bruto.subarray(corte + FIN_DE_CABECERAS.length)),
  };
}

/**
 * Lee `name="…"` o `name=…` de un `Content-Disposition`, y también la forma
 * extendida `name*=UTF-8''…` de RFC 5987, que es la que usan los navegadores
 * para nombres no ASCII.
 */
export function parametroDeDisposicion(disposicion: string, clave: string): string | null {
  const extendida = new RegExp(`;\\s*${clave}\\*\\s*=\\s*([^;]+)`, 'iu').exec(disposicion);
  if (extendida?.[1] !== undefined) {
    const valor = extendida[1].trim();
    const partes = valor.split("'");
    const codificado = partes.length >= 3 ? partes.slice(2).join("'") : valor;
    try {
      return decodeURIComponent(codificado);
    } catch {
      return codificado;
    }
  }

  const entrecomillada = new RegExp(`;\\s*${clave}\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'iu').exec(
    disposicion,
  );
  if (entrecomillada?.[1] !== undefined) {
    return entrecomillada[1].replace(/\\(.)/gu, '$1');
  }

  const desnuda = new RegExp(`;\\s*${clave}\\s*=\\s*([^;"\\s]+)`, 'iu').exec(disposicion);
  return desnuda?.[1] ?? null;
}

/**
 * El nombre que manda el cliente es **dato**, no ruta.
 *
 * Se le quitan los separadores de ruta de los dos mundos (`/` y `\`), los
 * caracteres de control y el `NUL`, y se descartan `.` y `..`. Aun así **no se
 * usa para construir ninguna ruta**: el almacén genera su propio nombre. Esto
 * es la segunda línea, no la primera.
 */
export function sanearNombreDeFichero(bruto: string | null): string | null {
  if (bruto === null) return null;
  const limpio = bruto
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/gu, '')
    .split(/[/\\]/u)
    .pop()
    ?.trim();
  if (limpio === undefined || limpio === '' || limpio === '.' || limpio === '..') return null;
  return limpio.slice(0, 255);
}
