/**
 * ════════════════════════════════════════════════════════════════════════════
 * GENERACIÓN DE cURL — `C-LEAK-03` de `CONTROLES.md`.
 *
 * Módulo **puro**: ni Nest, ni Prisma, ni red, ni `eval`. Recibe una petición
 * ya proyectada y devuelve `{ curl, advertencias }`. Que sea puro no es
 * estética: es lo que permite probar la tabla de escape con valores hostiles
 * «por análisis del texto generado, y no ejecutando una shell», que es
 * literalmente lo que pide `T-LEAK-03 (c)`.
 *
 * LAS CUATRO REGLAS DEL `BRIEF-FASE6` §2, Y DÓNDE SE CUMPLE CADA UNA
 * ------------------------------------------------------------------
 *  1. **Los secretos NO se materializan.** `valorDeCabecera()` jamás lee el
 *     valor de una cabecera con `esSecreto`: en el esquema ese valor **ni
 *     siquiera está** (`ck_header_secret_xor` obliga a `value IS NULL` cuando
 *     `is_secret`), y el criptograma vive en `secrets`, cifrado con una clave
 *     que esta capa no tiene ni debe tener. Sale `$CEIBA_SECRETO_<NOMBRE>`.
 *     Además, por `C-LEAK-05`, una cabecera de credencial escrita a mano
 *     (`Authorization`, `Cookie`, `X-Api-Key`, …) se trata **también** como
 *     secreto aunque nadie la haya clasificado: «es barato y acierta casi
 *     siempre». Se avisa en `advertencias[]` para que no parezca magia.
 *  2. **Las `{{...}}` se conservan.** No hay resolución de variables en este
 *     fichero. `url_template` entra tal cual y sale tal cual. La codificación
 *     percent de los parámetros respeta los marcadores (`codificarValor`).
 *  3. **Comillas correctas.** Todo valor va entre comillas simples POSIX con
 *     `'` escapada como `'\''` (`entrecomillar`). Dentro de comillas simples
 *     **nada** se expande: ni `$(id)`, ni backticks, ni `;rm -rf /`. La única
 *     excepción son los marcadores de secreto, que van entre comillas dobles
 *     **precisamente para que la shell los expanda**, y ahí se escapa el resto
 *     del segmento (`entrecomillarConMarcador`).
 *  4. **Lo no representable se declara.** Cada limitación añade una línea a
 *     `advertencias[]` en vez de inventar una equivalencia falsa (prompt
 *     maestro L479). Fichero binario del almacén, adjuntos multipart, mTLS,
 *     scripts de pre/post proceso y autenticación heredada están cubiertos.
 *
 * POR QUÉ UNA SOLA LÍNEA Y NO CONTINUACIONES CON `\`
 * ---------------------------------------------------
 * «Un cURL que se rompe al pegarlo en una terminal no vale». La continuación
 * con barra invertida depende de que el pegado conserve el salto de línea y de
 * que la shell sea POSIX; PowerShell, los clientes de chat y los campos de
 * texto de una sola línea la rompen. Una línea única se pega en cualquier
 * sitio. Los saltos de línea que haya **dentro** de un valor (un cuerpo JSON
 * con formato) se conservan dentro de sus comillas simples, que es donde son
 * inofensivos.
 *
 * DIALECTO: **Bash/POSIX**. `C-LEAK-03` advierte de que PowerShell tiene otras
 * reglas de escape. No se emite PowerShell aquí: generar un dialecto con las
 * reglas del otro sería justo la inyección que la tabla señala. Queda como
 * HUECO declarado en el informe.
 * ════════════════════════════════════════════════════════════════════════════
 */

export type ModoCuerpoCurl =
  | 'none'
  | 'raw_json'
  | 'raw_text'
  | 'raw_xml'
  | 'raw_html'
  | 'graphql'
  | 'form_urlencoded'
  | 'multipart_form_data'
  | 'binary_file'
  | 'custom';

export interface CabeceraParaCurl {
  readonly nombre: string;
  /** `null` cuando es secreta: el esquema no guarda el valor. */
  readonly valor: string | null;
  readonly esSecreto: boolean;
  readonly habilitada: boolean;
}

export interface ParametroParaCurl {
  readonly tipo: 'query' | 'path';
  readonly nombre: string;
  readonly valor: string | null;
  readonly esSecreto: boolean;
  readonly habilitado: boolean;
}

export interface CampoDeFormularioParaCurl {
  readonly nombre: string;
  readonly valor: string | null;
  readonly esSecreto: boolean;
  readonly habilitado: boolean;
  readonly esFichero: boolean;
  /**
   * Nombre original del adjunto (`files.original_filename`). Es lo único que
   * permite emitir un `--form 'campo=@fichero.pdf'` con una ruta que el
   * usuario reconozca. `null` si no se conoce.
   */
  readonly nombreDelFichero?: string | null | undefined;
  readonly contentType: string | null;
}

export interface PeticionParaCurl {
  readonly nombre: string;
  readonly metodo: string;
  readonly metodoPersonalizado: string | null;
  readonly urlPlantilla: string;
  readonly cabeceras: readonly CabeceraParaCurl[];
  readonly parametros: readonly ParametroParaCurl[];
  readonly modoCuerpo: ModoCuerpoCurl;
  readonly cuerpoCrudo: string | null;
  readonly contentTypeDelCuerpo: string | null;
  readonly variablesGraphql: unknown;
  readonly camposDeFormulario: readonly CampoDeFormularioParaCurl[];
  readonly tieneFicheroBinario: boolean;
  readonly nombreDelFicheroBinario?: string | null | undefined;
  readonly timeoutMs: number | null;
  readonly politicaDeRedireccion: string | null;
  readonly maxRedirecciones: number | null;
  readonly verificarTls: boolean | null;
  readonly tieneCertificadoDeCliente: boolean;
  readonly modoAutenticacion: string | null;
  readonly tieneConfiguracionDeAutenticacion: boolean;
  readonly tienePreScript: boolean;
  readonly tienePostScript: boolean;
}

export interface ResultadoCurl {
  readonly curl: string;
  readonly advertencias: readonly string[];
}

/** Prefijo de los marcadores. Se exporta porque las pruebas lo afirman. */
export const PREFIJO_DE_SECRETO = 'CEIBA_SECRETO_';

/**
 * `C-LEAK-05`: cabeceras que se tratan **siempre** como credencial, estén o no
 * clasificadas. Comparación en minúsculas, porque RFC 9110 hace el nombre de
 * cabecera insensible a mayúsculas.
 */
export const CABECERAS_DE_CREDENCIAL: ReadonlySet<string> = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'apikey',
  'x-auth-token',
  'x-access-token',
  'x-session-token',
  'x-amz-security-token',
  'x-csrf-token',
  'x-ceiba-csrf',
  'private-token',
  'x-secret',
  'x-secret-key',
]);

/**
 * Un valor compuesto **sólo** por marcadores y texto estructural (`Bearer
 * {{token}}`) ya es un marcador: no hay nada que filtrar y conservarlo es la
 * regla 2. Se detecta que NO queda ningún tramo de más de 8 caracteres
 * seguidos fuera de un `{{...}}`.
 */
function esSoloMarcadores(valor: string): boolean {
  const sinMarcadores = valor.replace(/\{\{[^{}]*\}\}/gu, '\u0000');
  for (const tramo of sinMarcadores.split('\u0000')) {
    if (tramo.trim().length > 8) return false;
  }
  return sinMarcadores.includes('\u0000');
}

/** Nombre de variable de entorno a partir de un nombre de cabecera o campo. */
export function nombreDeMarcador(nombre: string): string {
  const limpio = nombre
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
  return `${PREFIJO_DE_SECRETO}${limpio === '' ? 'VALOR' : limpio}`;
}

/**
 * Entrecomillado POSIX con comillas simples. Dentro de ellas **no existe**
 * ninguna expansión de la shell: ni `$VAR`, ni `$(cmd)`, ni `` `cmd` ``, ni
 * `\`. El único carácter que hay que tratar es la propia comilla simple, que
 * se cierra, se escapa y se reabre: `'\''`.
 */
export function entrecomillar(valor: string): string {
  return `'${valor.split("'").join(`'\\''`)}'`;
}

/**
 * Entrecomillado con comillas **dobles** para los segmentos que llevan un
 * marcador de secreto y que, por tanto, tienen que expandirse al pegarlos.
 * Se escapa todo lo que la shell interpretaría dentro de comillas dobles
 * (`\`, `"`, `` ` ``, `$`) **salvo** los marcadores `$CEIBA_SECRETO_*`, que se
 * reinsertan después de escapar. `!` no se escapa: sólo lo expande la
 * *historia interactiva* de bash, no un script, y escaparlo con `\!` dejaría
 * la barra en el texto.
 */
export function entrecomillarConMarcador(segmento: string): string {
  const marcadores: string[] = [];
  const conHuecos = segmento.replace(
    new RegExp(`\\$${PREFIJO_DE_SECRETO}[A-Z0-9_]+`, 'gu'),
    (encontrado) => {
      marcadores.push(encontrado);
      return '\u0001';
    },
  );
  const escapado = conHuecos.replace(/[\\"`$]/gu, (c) => `\\${c}`);
  let indice = 0;
  const restaurado = escapado.replace(/\u0001/gu, () => marcadores[indice++] ?? '');
  return `"${restaurado}"`;
}

/**
 * Codificación percent que **respeta los marcadores `{{var}}`** (regla 2). Se
 * codifica el valor entero y luego se devuelven a su forma literal las llaves
 * de los marcadores: así `{{base}}` sigue siendo `{{base}}` y un `&` hostil
 * sigue saliendo como `%26`.
 */
export function codificarValor(valor: string): string {
  return encodeURIComponent(valor).replace(/%7B%7B([^%]*?)%7D%7D/giu, (_todo, dentro: string) => {
    const nombre = decodeURIComponent(dentro);
    return /^[A-Za-z0-9_.\- ]*$/u.test(nombre) ? `{{${nombre}}}` : `{{${dentro}}}`;
  });
}

/** Content-Type implícito de cada modo. `null` = cURL lo pone o no hace falta. */
function contentTypePorModo(modo: ModoCuerpoCurl): string | null {
  switch (modo) {
    case 'raw_json':
      return 'application/json';
    case 'raw_xml':
      return 'application/xml';
    case 'raw_html':
      return 'text/html';
    case 'raw_text':
      return 'text/plain';
    case 'graphql':
      return 'application/json';
    case 'form_urlencoded':
      return 'application/x-www-form-urlencoded';
    default:
      // `multipart_form_data` NO lleva Content-Type explícito: cURL calcula el
      // `boundary` y ponerlo a mano rompe la petición.
      return null;
  }
}

const CONTROL_PROHIBIDO = /[\u0000-\u0008\u000A-\u001F\u007F]/u;

/**
 * `C-LEAK-05`, detección por patrón. Sólo formatos de **alta confianza**: un
 * JWT, una clave de AWS o una clave privada PEM no son un identificador largo
 * por casualidad.
 *
 * **No se implementa el criterio de entropía de Shannon > 4,5 bits/carácter**
 * que también menciona el control: tiene falsos positivos conocidos (hashes
 * públicos, identificadores opacos) y aquí se traduciría en una advertencia
 * ruidosa en cada exportación. Queda declarado como HUECO.
 *
 * Lo que se hace al detectar es **avisar, no bloquear ni enmascarar**: el
 * cuerpo de una petición es la carga útil que el usuario escribió y vaciarlo
 * dejaría un comando inservible. El control dice literalmente «al detectar: no
 * bloquear; avisar».
 */
const PATRONES_DE_SECRETO: ReadonlyArray<{ readonly nombre: string; readonly patron: RegExp }> = [
  { nombre: 'un JWT', patron: /eyJ[A-Za-z0-9_-]{10,}\./u },
  { nombre: 'una clave de acceso de AWS', patron: /AKIA[0-9A-Z]{16}/u },
  { nombre: 'un token de GitHub', patron: /(?:ghp_|gho_|github_pat_)[A-Za-z0-9_]{20,}/u },
  { nombre: 'una clave de Stripe u OpenAI', patron: /(?:sk-|sk_live_|rk_live_)[A-Za-z0-9_-]{16,}/u },
  { nombre: 'una clave privada PEM', patron: /-----BEGIN [A-Z ]*PRIVATE KEY-----/u },
];

/**
 * ¿Este par nombre/valor parece una credencial sin clasificar? Lo consume
 * también la proyección de la API (`looksSecret`) para que la interfaz pueda
 * ofrecer «convertir en variable secreta», que es lo que `C-LEAK-05` pide:
 * avisar, no bloquear.
 */
export function pareceCredencial(nombre: string, valor: string | null): boolean {
  if (CABECERAS_DE_CREDENCIAL.has(nombre.trim().toLowerCase())) return true;
  if (valor === null || valor === '') return false;
  return PATRONES_DE_SECRETO.some(({ patron }) => patron.test(valor));
}

/**
 * Revisa los textos que SÍ se materializan en el comando. No devuelve el valor
 * encontrado: sólo dice dónde y de qué formato, que es lo que hace falta para
 * decidir y lo único que puede ir a un informe sin convertirse en la fuga.
 */
function avisosDeSecretoNoClasificado(
  textos: ReadonlyArray<{ readonly donde: string; readonly texto: string }>,
): string[] {
  const avisos: string[] = [];
  const vistos = new Set<string>();
  for (const { donde, texto } of textos) {
    for (const { nombre, patron } of PATRONES_DE_SECRETO) {
      if (!patron.test(texto)) continue;
      const clave = `${donde}|${nombre}`;
      if (vistos.has(clave)) continue;
      vistos.add(clave);
      avisos.push(
        `${donde} contiene algo con forma de ${nombre} y NO está clasificado como secreto, así que el comando lo lleva en claro (C-LEAK-05). Conviértelo en variable secreta antes de compartir este cURL.`,
      );
    }
  }
  return avisos;
}

/**
 * Genera el comando. Nunca lanza: una petición rota produce un comando parcial
 * **y** la advertencia que lo explica, que es más útil que un 500.
 */
export function generarCurl(peticion: PeticionParaCurl): ResultadoCurl {
  const advertencias: string[] = [];
  const partes: string[] = ['curl'];

  // --- Verbo ---------------------------------------------------------------
  const verbo =
    peticion.metodo === 'CUSTOM'
      ? (peticion.metodoPersonalizado ?? '').trim()
      : peticion.metodo.trim();
  if (verbo === '' || !/^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/u.test(verbo)) {
    advertencias.push(
      `El verbo HTTP «${verbo}» no es un token válido de RFC 9110; el comando se genera con GET. Corrige el método de la petición.`,
    );
    partes.push('--request', 'GET');
  } else {
    partes.push('--request', verbo.toUpperCase());
  }

  // --- URL + parámetros de consulta ---------------------------------------
  const { url, advertenciasUrl } = construirUrl(peticion);
  advertencias.push(...advertenciasUrl);
  partes.push('--url', url.contieneMarcadorDeSecreto ? entrecomillarConMarcador(url.texto) : entrecomillar(url.texto));

  // --- Cabeceras -----------------------------------------------------------
  const cabecerasEmitidas = new Set<string>();
  for (const cabecera of peticion.cabeceras) {
    if (!cabecera.habilitada) continue;
    const nombre = cabecera.nombre.trim();
    if (nombre === '') continue;
    if (!/^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/u.test(nombre)) {
      advertencias.push(
        `La cabecera «${recortar(nombre)}» tiene un nombre que no es un token de RFC 9110 y se ha omitido del comando.`,
      );
      continue;
    }
    cabecerasEmitidas.add(nombre.toLowerCase());

    const clasificacion = clasificarValor(nombre, cabecera.valor, cabecera.esSecreto);
    if (clasificacion.motivo === 'secreto_declarado') {
      advertencias.push(
        `La cabecera «${nombre}» está marcada como secreta: el comando lleva el marcador \`$${clasificacion.marcador}\`, nunca el valor. Expórtalo antes de ejecutar: \`export ${clasificacion.marcador}='…'\`.`,
      );
    } else if (clasificacion.motivo === 'credencial_detectada') {
      advertencias.push(
        `La cabecera «${nombre}» transporta credenciales (C-LEAK-05) y su valor NO se ha materializado aunque no esté clasificada como secreta. Usa \`export ${clasificacion.marcador}='…'\` o conviértela en variable secreta.`,
      );
    }
    if (clasificacion.texto === null) {
      advertencias.push(
        `La cabecera «${nombre}» contiene caracteres de control y no se puede representar en una línea de comandos; se ha omitido.`,
      );
      continue;
    }
    const segmento = `${nombre}: ${clasificacion.texto}`;
    partes.push(
      '--header',
      clasificacion.enmascarado ? entrecomillarConMarcador(segmento) : entrecomillar(segmento),
    );
  }

  // --- Cuerpo --------------------------------------------------------------
  const cuerpo = construirCuerpo(peticion, advertencias);
  if (cuerpo.contentType !== null && !cabecerasEmitidas.has('content-type')) {
    partes.push('--header', entrecomillar(`Content-Type: ${cuerpo.contentType}`));
  }
  partes.push(...cuerpo.partes);

  // --- Opciones de transporte ---------------------------------------------
  if (peticion.politicaDeRedireccion === 'follow') {
    partes.push('--location');
    if (typeof peticion.maxRedirecciones === 'number') {
      partes.push('--max-redirs', String(Math.max(0, Math.trunc(peticion.maxRedirecciones))));
    }
  }
  if (typeof peticion.timeoutMs === 'number' && peticion.timeoutMs > 0) {
    partes.push('--max-time', recortarDecimales(peticion.timeoutMs / 1000));
  }
  if (peticion.verificarTls === false) {
    partes.push('--insecure');
    advertencias.push(
      'La petición desactiva la verificación del certificado TLS; el comando lleva `--insecure`. Úsalo sólo contra entornos de prueba.',
    );
  }

  // --- Lo que cURL no puede reproducir (regla 4) ---------------------------
  if (peticion.tieneCertificadoDeCliente) {
    advertencias.push(
      'La petición usa un certificado de cliente (mTLS) guardado en el almacén del servidor. cURL necesita los ficheros en local: añade `--cert ruta.pem --key ruta.key`. La clave privada no se entrega.',
    );
  }
  if (peticion.modoAutenticacion === 'explicit' && peticion.tieneConfiguracionDeAutenticacion) {
    advertencias.push(
      'La petición usa una configuración de autenticación del workspace: sus credenciales viven cifradas y no se materializan en el comando. Añade la cabecera de autenticación a mano si necesitas ejecutarlo.',
    );
  } else if (peticion.modoAutenticacion === 'inherit') {
    advertencias.push(
      'La autenticación es heredada (de la carpeta, la colección o el workspace): el comando no la incluye porque se resuelve en el momento de ejecutar, y sus credenciales no se materializan.',
    );
  }
  if (peticion.tienePreScript || peticion.tienePostScript) {
    advertencias.push(
      'La petición tiene scripts de pre/post proceso. cURL no ejecuta scripts: el comando reproduce únicamente la llamada HTTP.',
    );
  }

  // --- C-LEAK-05: lo que SÍ se materializa, revisado por patrón ------------
  const materializados: Array<{ donde: string; texto: string }> = [];
  for (const cabecera of peticion.cabeceras) {
    if (!cabecera.habilitada || cabecera.esSecreto || cabecera.valor === null) continue;
    if (CABECERAS_DE_CREDENCIAL.has(cabecera.nombre.trim().toLowerCase())) continue;
    materializados.push({ donde: `La cabecera «${cabecera.nombre}»`, texto: cabecera.valor });
  }
  for (const parametro of peticion.parametros) {
    if (!parametro.habilitado || parametro.esSecreto || parametro.valor === null) continue;
    materializados.push({
      donde: `El parámetro «${parametro.nombre}»`,
      texto: parametro.valor,
    });
  }
  for (const campo of peticion.camposDeFormulario) {
    if (!campo.habilitado || campo.esSecreto || campo.valor === null) continue;
    materializados.push({ donde: `El campo «${campo.nombre}» del formulario`, texto: campo.valor });
  }
  if (peticion.cuerpoCrudo !== null && peticion.cuerpoCrudo !== '') {
    materializados.push({ donde: 'El cuerpo de la petición', texto: peticion.cuerpoCrudo });
  }
  advertencias.push(...avisosDeSecretoNoClasificado(materializados));

  return { curl: partes.join(' '), advertencias };
}

// ---------------------------------------------------------------------------
// Piezas internas
// ---------------------------------------------------------------------------

interface Clasificacion {
  /** Texto que se emite, o `null` si no es representable. */
  readonly texto: string | null;
  readonly enmascarado: boolean;
  readonly marcador: string;
  readonly motivo: 'claro' | 'secreto_declarado' | 'credencial_detectada' | 'solo_marcadores';
}

/**
 * Única puerta por la que puede salir el valor de una cabecera o de un
 * parámetro. Si devuelve enmascarado, **el valor original no se ha leído**.
 */
function clasificarValor(nombre: string, valor: string | null, esSecreto: boolean): Clasificacion {
  const marcador = nombreDeMarcador(nombre);
  if (esSecreto) {
    return { texto: `$${marcador}`, enmascarado: true, marcador, motivo: 'secreto_declarado' };
  }
  const bruto = valor ?? '';
  if (CABECERAS_DE_CREDENCIAL.has(nombre.trim().toLowerCase()) && !esSoloMarcadores(bruto)) {
    // C-LEAK-05: credencial escrita a mano. No se materializa.
    return { texto: `$${marcador}`, enmascarado: true, marcador, motivo: 'credencial_detectada' };
  }
  if (CONTROL_PROHIBIDO.test(bruto)) {
    return { texto: null, enmascarado: false, marcador, motivo: 'claro' };
  }
  return {
    texto: bruto,
    enmascarado: false,
    marcador,
    motivo: esSoloMarcadores(bruto) ? 'solo_marcadores' : 'claro',
  };
}

function construirUrl(peticion: PeticionParaCurl): {
  url: { texto: string; contieneMarcadorDeSecreto: boolean };
  advertenciasUrl: string[];
} {
  const advertenciasUrl: string[] = [];
  const base = peticion.urlPlantilla.trim();
  const trozos: string[] = [];
  let contieneMarcadorDeSecreto = false;

  for (const parametro of peticion.parametros) {
    if (parametro.tipo !== 'query') continue;
    if (!parametro.habilitado) continue;
    const nombre = parametro.nombre.trim();
    if (nombre === '') continue;
    if (parametro.esSecreto) {
      const marcador = nombreDeMarcador(`query_${nombre}`);
      contieneMarcadorDeSecreto = true;
      trozos.push(`${codificarValor(nombre)}=$${marcador}`);
      advertenciasUrl.push(
        `El parámetro de consulta «${nombre}» está marcado como secreto: la URL lleva el marcador \`$${marcador}\`, nunca el valor. Expórtalo antes de ejecutar.`,
      );
      continue;
    }
    const valor = parametro.valor ?? '';
    if (CONTROL_PROHIBIDO.test(valor)) {
      advertenciasUrl.push(
        `El parámetro de consulta «${nombre}» contiene caracteres de control y se ha omitido de la URL.`,
      );
      continue;
    }
    trozos.push(`${codificarValor(nombre)}=${codificarValor(valor)}`);
  }

  const parametrosDeRuta = peticion.parametros.filter((p) => p.tipo === 'path' && p.habilitado);
  if (parametrosDeRuta.length > 0) {
    advertenciasUrl.push(
      `La petición define ${parametrosDeRuta.length} parámetro(s) de ruta (${parametrosDeRuta
        .map((p) => p.nombre)
        .join(', ')}). La URL se exporta SIN resolver: cURL no sustituye marcadores.`,
    );
  }

  let texto = base;
  if (trozos.length > 0) {
    const separador = base.includes('?') ? '&' : '?';
    texto = `${base}${separador}${trozos.join('&')}`;
  }

  if (CONTROL_PROHIBIDO.test(texto)) {
    advertenciasUrl.push(
      'La URL contiene caracteres de control; se han eliminado del comando porque romperían la línea.',
    );
    texto = texto.replace(new RegExp(CONTROL_PROHIBIDO.source, 'gu'), '');
  }

  const marcadores = contarMarcadores(peticion.urlPlantilla);
  if (marcadores.length > 0) {
    advertenciasUrl.push(
      `La URL conserva ${marcadores.length} marcador(es) de variable sin resolver (${marcadores
        .map((m) => `\`${m}\``)
        .join(', ')}). Es deliberado: \`url_template\` jamás se guarda resuelta. Sustitúyelos o exporta el entorno antes de ejecutar.`,
    );
  }

  return { url: { texto, contieneMarcadorDeSecreto }, advertenciasUrl };
}

function construirCuerpo(
  peticion: PeticionParaCurl,
  advertencias: string[],
): { partes: string[]; contentType: string | null } {
  const partes: string[] = [];
  const contentTypeExplicito = peticion.contentTypeDelCuerpo?.trim();
  const contentType =
    contentTypeExplicito !== undefined && contentTypeExplicito !== ''
      ? contentTypeExplicito
      : contentTypePorModo(peticion.modoCuerpo);

  switch (peticion.modoCuerpo) {
    case 'none':
      return { partes, contentType: null };

    case 'raw_json':
    case 'raw_text':
    case 'raw_xml':
    case 'raw_html': {
      const crudo = peticion.cuerpoCrudo ?? '';
      if (crudo === '') return { partes, contentType: null };
      // `--data-raw` y no `--data`: `--data` interpreta un `@` inicial como
      // «lee de este fichero» y descarta los saltos de línea. Con `--data-raw`
      // el cuerpo viaja byte a byte tal y como está guardado.
      partes.push('--data-raw', entrecomillar(crudo));
      return { partes, contentType };
    }

    case 'graphql': {
      const consulta = peticion.cuerpoCrudo ?? '';
      const sobre: Record<string, unknown> = { query: consulta };
      if (peticion.variablesGraphql !== null && peticion.variablesGraphql !== undefined) {
        sobre['variables'] = peticion.variablesGraphql;
      }
      partes.push('--data-raw', entrecomillar(JSON.stringify(sobre)));
      advertencias.push(
        'El cuerpo GraphQL se exporta como el sobre JSON `{"query":…,"variables":…}`, que es la forma en que viaja por HTTP. El editor de GraphQL no se puede reproducir en cURL.',
      );
      return { partes, contentType };
    }

    case 'form_urlencoded': {
      for (const campo of peticion.camposDeFormulario) {
        if (!campo.habilitado) continue;
        const nombre = campo.nombre.trim();
        if (nombre === '') continue;

        // DEFECTO CORREGIDO EN LA FASE 7. `--data-urlencode` tiene CINCO
        // sintaxis, y `name@filename` gana sobre `name=content`: un campo
        // llamado `correo@dominio` hacía que cURL **leyera un fichero local**
        // en lugar de enviar el valor. Las comillas de la shell no protegen,
        // porque quien interpreta el `@` es cURL. Cuando el nombre lleva `@`
        // se codifica aquí y se emite por `--data-raw`, que cURL concatena con
        // `&` igual que los demás datos.
        const nombreAmbiguo = nombre.includes('@');

        if (campo.esSecreto) {
          const marcador = nombreDeMarcador(`form_${nombre}`);
          partes.push(
            '--data-urlencode',
            entrecomillarConMarcador(`${nombreAmbiguo ? codificarValor(nombre) : nombre}=$${marcador}`),
          );
          advertencias.push(
            `El campo «${nombre}» del formulario está marcado como secreto: el comando lleva el marcador \`$${marcador}\`, nunca el valor.`,
          );
          continue;
        }
        if (campo.esFichero) {
          advertencias.push(
            `El campo «${nombre}» es un fichero y el modo del cuerpo es \`form_urlencoded\`, que no admite adjuntos. Se ha omitido.`,
          );
          continue;
        }
        if (nombreAmbiguo) {
          partes.push(
            '--data-raw',
            entrecomillar(`${codificarValor(nombre)}=${codificarValor(campo.valor ?? '')}`),
          );
          continue;
        }
        // `--data-urlencode` deja que cURL codifique: así un `&` dentro de un
        // valor no parte el cuerpo en dos campos.
        partes.push('--data-urlencode', entrecomillar(`${nombre}=${campo.valor ?? ''}`));
      }
      if (partes.length === 0) return { partes, contentType: null };
      // Con `--data-urlencode` cURL ya pone el Content-Type correcto; fijarlo
      // a mano sólo hace falta si el usuario puso uno distinto.
      return {
        partes,
        contentType: contentTypeExplicito !== undefined && contentTypeExplicito !== '' ? contentTypeExplicito : null,
      };
    }

    case 'multipart_form_data': {
      for (const campo of peticion.camposDeFormulario) {
        if (!campo.habilitado) continue;
        const nombre = campo.nombre.trim();
        if (nombre === '') continue;

        if (campo.esFichero) {
          // FASE 7 §3.3: se emite `--form 'f=@fichero'` DE VERDAD, en vez de
          // omitir el campo. El fichero vive en el servidor, así que la ruta
          // es una **ruta local relativa explícita** (`./nombre`) y va
          // acompañada de advertencia: eso es declarar la limitación, no
          // inventar una equivalencia. Un `--form` sin el campo produciría un
          // cuerpo distinto del guardado y el usuario no se enteraría.
          const nombreFichero = nombreLocalDeAdjunto(campo);
          if (nombreFichero === null) {
            advertencias.push(
              `El campo «${nombre}» es un fichero adjunto del que no se conoce el nombre original. No se puede escribir un \`--form '${nombre}=@…'\` honesto y se ha omitido.`,
            );
            continue;
          }
          const tipo = tipoDeAdjunto(campo);
          partes.push('--form', entrecomillar(`${nombre}=@./${nombreFichero}${tipo}`));
          advertencias.push(
            `El campo «${nombre}» adjunta un fichero que está GUARDADO EN EL SERVIDOR, no en tu máquina. El comando lleva \`@./${nombreFichero}\`: cURL leerá ese fichero del directorio desde el que lo ejecutes. Descárgalo ahí antes, o cambia la ruta.`,
          );
          continue;
        }

        if (campo.esSecreto) {
          const marcador = nombreDeMarcador(`form_${nombre}`);
          // `--form-string` y no `--form`: ver el bloque de abajo. Si el
          // secreto expandido empezara por `@`, `--form` subiría un fichero
          // de la máquina del usuario en su lugar.
          partes.push('--form-string', entrecomillarConMarcador(`${nombre}=$${marcador}`));
          advertencias.push(
            `El campo «${nombre}» del formulario está marcado como secreto: el comando lleva el marcador \`$${marcador}\`, nunca el valor.`,
          );
          continue;
        }

        // DEFECTO CORREGIDO EN LA FASE 7. En `--form`, cURL interpreta un
        // valor que empiece por `@` como «léelo de este fichero» y uno que
        // empiece por `<` como «léelo de este fichero, sin adjuntarlo». Un
        // campo de texto cuyo valor fuera `@/etc/passwd` hacía que el
        // comando **subiera un fichero de la máquina de quien lo pega**. Las
        // comillas simples NO protegen: quien interpreta el `@` es cURL.
        // `--form-string` envía el valor literal y no mira el primer carácter.
        const valor = campo.valor ?? '';
        const tipo = tipoDeAdjunto(campo);
        if (tipo === '') {
          partes.push('--form-string', entrecomillar(`${nombre}=${valor}`));
          continue;
        }
        // `--form-string` no admite `;type=`. Con un Content-Type por campo
        // hay que usar `--form`, y entonces el valor tiene que ser inocuo.
        if (/^[@<]/u.test(valor) || valor.includes(';') || valor.includes(',')) {
          partes.push('--form-string', entrecomillar(`${nombre}=${valor}`));
          advertencias.push(
            `El campo «${nombre}» lleva un Content-Type propio (\`${tipo.slice(6)}\`) pero su valor contiene caracteres que cURL interpretaría (\`@\`, \`<\`, \`;\` o \`,\`). Se emite con \`--form-string\` para no cambiar el contenido, y el Content-Type del campo NO se conserva.`,
          );
          continue;
        }
        partes.push('--form', entrecomillar(`${nombre}=${valor}${tipo}`));
      }
      // Nunca se fija `Content-Type` en multipart: cURL calcula el `boundary`.
      return { partes, contentType: null };
    }

    case 'binary_file': {
      // FASE 7 §3.3: `--data-binary @fichero`. Mismo criterio que en multipart:
      // se emite el comando con una ruta local explícita **y** se advierte de
      // que los bytes están en el servidor.
      const nombreFichero = sanearNombreLocal(peticion.nombreDelFicheroBinario ?? null);
      if (!peticion.tieneFicheroBinario || nombreFichero === null) {
        advertencias.push(
          'El cuerpo es un fichero binario guardado en el servidor y no se conoce su nombre original. El comando se genera SIN cuerpo en vez de inventar una equivalencia falsa: descárgalo y añade `--data-binary @fichero`.',
        );
        return { partes, contentType: null };
      }
      partes.push('--data-binary', entrecomillar(`@./${nombreFichero}`));
      advertencias.push(
        `El cuerpo es un fichero binario GUARDADO EN EL SERVIDOR, no en tu máquina. El comando lleva \`--data-binary '@./${nombreFichero}'\`: cURL leerá ese fichero del directorio desde el que lo ejecutes. Descárgalo ahí antes, o cambia la ruta.`,
      );
      return { partes, contentType };
    }

    case 'custom':
    default: {
      if (peticion.cuerpoCrudo !== null && peticion.cuerpoCrudo !== '') {
        partes.push('--data-raw', entrecomillar(peticion.cuerpoCrudo));
      }
      advertencias.push(
        `El modo de cuerpo \`${peticion.modoCuerpo}\` no tiene una representación estándar en cURL. Revisa el comando antes de usarlo.`,
      );
      return { partes, contentType };
    }
  }
}

/**
 * Sufijo `;type=…` de un campo de formulario, vacío si no hay Content-Type.
 * Se sanea: un `;` o una `,` dentro del tipo partirían los parámetros que lee
 * cURL y cambiarían el significado del campo.
 */
function tipoDeAdjunto(campo: CampoDeFormularioParaCurl): string {
  const bruto = campo.contentType?.trim() ?? '';
  if (bruto === '') return '';
  if (!/^[A-Za-z0-9!#$%&'*+\-.^_`|~]+\/[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/u.test(bruto)) return '';
  return `;type=${bruto}`;
}

/** Nombre de fichero utilizable como ruta local en el comando. */
function nombreLocalDeAdjunto(campo: CampoDeFormularioParaCurl): string | null {
  return sanearNombreLocal(campo.nombreDelFichero ?? null);
}

/**
 * El nombre original viene de `files.original_filename`, que es **dato del
 * cliente**. Aquí se convierte en un trozo de línea de comandos, así que se
 * le quitan los separadores de ruta, los caracteres de control y los que cURL
 * interpreta dentro de un `--form` (`;` y `,`). El entrecomillado POSIX hace
 * el resto; esto es la capa de cURL, que el entrecomillado no cubre.
 */
function sanearNombreLocal(bruto: string | null): string | null {
  if (bruto === null) return null;
  const limpio = (bruto.split(/[/\\]/u).pop() ?? '')
    .replace(new RegExp(CONTROL_PROHIBIDO.source, 'gu'), '')
    .replace(/[;,]/gu, '_')
    .trim();
  if (limpio === '' || limpio === '.' || limpio === '..') return null;
  return limpio.slice(0, 255);
}

function contarMarcadores(texto: string): string[] {
  const encontrados = texto.match(/\{\{[^{}]*\}\}/gu);
  if (encontrados === null) return [];
  return [...new Set(encontrados)];
}

function recortar(texto: string, maximo = 60): string {
  return texto.length <= maximo ? texto : `${texto.slice(0, maximo)}…`;
}

function recortarDecimales(segundos: number): string {
  const redondeado = Math.round(segundos * 1000) / 1000;
  return Number.isInteger(redondeado) ? String(redondeado) : redondeado.toFixed(3);
}
