import { randomBytes } from 'node:crypto';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * C-CODE-01 — Generación criptográfica del código de acceso.
 *
 * Alfabeto **Base32 Crockford** (sin `I`, `L`, `O`, `U`), para que el código se
 * pueda dictar por teléfono sin ambigüedad, y con guiones cada 4 caracteres.
 *
 * ── POR QUÉ 24 CARACTERES Y NO LOS 16 QUE DIBUJA C-CODE-01 ──────────────────
 *
 * El boceto de C-CODE-01 es de **antes** de que el esquema existiera. Ese
 * boceto genera 16 caracteres (80 bits) y los hashea enteros, y por tanto
 * asume la variante que C-CODE-02 describe al final: *«el enlace identifica el
 * recurso … el código sólo se verifica contra la fila ya localizada»*.
 *
 * El esquema **aplicado** no permite eso: `share_access_codes.code_selector`
 * existe, es `NOT NULL` y tiene índice **único global** (`uq_sharecode_selector`),
 * y su comentario lo declara explícitamente como *«parte NO secreta del código»*.
 * Es decir: el selector **viaja dentro del código** y es lo que localiza la fila
 * en **una** lectura indexada. Ése es justo el punto que el encargo marca como
 * innegociable: con un único hash habría que ejecutar Argon2id contra cada
 * código vivo en cada intento, y eso convierte la página de acceso en un
 * amplificador de denegación de servicio.
 *
 * Partir 16 caracteres en selector + verificador dejaría el **secreto** por
 * debajo de los 80 bits que la propia justificación de C-CODE-01 declara
 * necesarios. Así que se suman, no se reparten:
 *
 *      selector     8 caracteres  = 40 bits   público, indexado, no secreto
 *      verificador 16 caracteres  = 80 bits   secreto, Argon2id en reposo
 *      ──────────────────────────────────────────────────────────────────
 *      código      24 caracteres  = 120 bits  → `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`
 *
 * El precio es un código más largo de dictar (29 caracteres con guiones, como
 * una clave de producto). Se asume a conciencia: la alternativa era rebajar el
 * secreto a 40-60 bits, que es lo único que C-CODE-01 prohíbe de verdad.
 *
 * Los 40 bits del selector **no son un secreto** y no hace falta que lo sean:
 * conocer el selector no permite entrar, sólo permite señalar una fila. La
 * colisión global es el único riesgo real y está acotada: con 10⁶ códigos vivos
 * la probabilidad de choque es ≈4·10⁻⁷, y aun así la creación reintenta cuando
 * el índice único la rechaza.
 *
 * **Prohibido por §6 y no usado aquí:** `Math.random()`, `Date.now()`, UUIDv1,
 * el `id` de la fila, secuencias, y cualquier derivación del identificador de
 * la colección. La única fuente es `crypto.randomBytes`.
 * ════════════════════════════════════════════════════════════════════════════
 */

/** Crockford Base32: 32 símbolos, sin `I`, `L`, `O` ni `U`. */
export const ALFABETO_CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const CARACTERES_SELECTOR = 8;
export const CARACTERES_VERIFICADOR = 16;
export const CARACTERES_CODIGO = CARACTERES_SELECTOR + CARACTERES_VERIFICADOR;
export const TAMANO_DE_GRUPO = 4;

/** Bits de secreto que el verificador aporta. Lo usa la prueba T-CODE-01. */
export const BITS_DE_VERIFICADOR = CARACTERES_VERIFICADOR * 5;

export interface CodigoDeAccesoGenerado {
  /** Con guiones. **Se entrega UNA vez y no se persiste en ninguna parte.** */
  readonly codigoEnClaro: string;
  /** Sin guiones, normalizado. Útil sólo para pruebas y para el QR. */
  readonly codigoCrudo: string;
  /** Mitad pública. Va a `share_access_codes.code_selector`. */
  readonly selector: string;
  /** Mitad secreta. **Sólo** se guarda su hash Argon2id. */
  readonly verificador: string;
  /**
   * Últimos 4 caracteres, para que el propietario distinga entre varios códigos
   * en la interfaz. El CHECK `ck_code_hint_len` lo limita a 4. Son 20 bits del
   * verificador: queda en 60 bits de secreto efectivo **si y sólo si** el
   * propietario decide guardar la pista, y por eso es opcional en la creación.
   */
  readonly pista: string;
}

/**
 * `bytes[i] & 31` es uniforme **sin sesgo de módulo**: 256 es múltiplo exacto
 * de 32, así que cada símbolo recibe exactamente 8 de los 256 valores posibles.
 * Un `% 32` sobre un alfabeto que no dividiera a 256 sí lo tendría.
 */
export function generarCodigoDeAcceso(): CodigoDeAccesoGenerado {
  const bytes = randomBytes(CARACTERES_CODIGO);
  let crudo = '';
  for (const byte of bytes) {
    crudo += ALFABETO_CROCKFORD.charAt(byte & 31);
  }
  return {
    codigoEnClaro: conGuiones(crudo),
    codigoCrudo: crudo,
    selector: crudo.slice(0, CARACTERES_SELECTOR),
    verificador: crudo.slice(CARACTERES_SELECTOR),
    pista: crudo.slice(-4),
  };
}

/** `XXXXXXXX…` → `XXXX-XXXX-…`. */
export function conGuiones(crudo: string): string {
  return crudo.replace(/(.{4})(?=.)/gu, '$1-');
}

/**
 * Confusiones que Crockford manda aceptar al **leer**: el alfabeto no contiene
 * `I`, `L` ni `O`, así que quien los teclea quería `1`, `1` y `0`.
 *
 * `U` no se mapea: Crockford lo excluye para evitar palabrotas accidentales, no
 * por parecido, y no hay un destino evidente.
 */
const CONFUSIONES: ReadonlyMap<string, string> = new Map([
  ['I', '1'],
  ['L', '1'],
  ['O', '0'],
]);

/** Separadores que se descartan: guiones de todo tipo, espacios y subrayado. */
const SEPARADORES = /[\s\u2010\u2011\u2012\u2013\u2014\u2015_.-]/gu;

/**
 * Normaliza lo que teclea el visitante. Devuelve `null` si, tras normalizar, no
 * es un código **con la forma correcta**.
 *
 * `null` NO es un atajo de respuesta: quien llama sigue obligado a pagar el
 * hash señuelo y a responder exactamente igual que ante un código incorrecto
 * (C-CODE-04). Si la forma inválida respondiera antes, el tiempo lo delataría.
 */
export function normalizarCodigo(entrada: unknown): string | null {
  if (typeof entrada !== 'string') return null;
  // Tope defensivo: normalizar 10 MB de basura es trabajo regalado al atacante.
  if (entrada.length > 512) return null;

  const sinSeparadores = entrada.toUpperCase().replace(SEPARADORES, '');
  if (sinSeparadores.length !== CARACTERES_CODIGO) return null;

  let normalizado = '';
  for (const caracter of sinSeparadores) {
    const corregido = CONFUSIONES.get(caracter) ?? caracter;
    if (!ALFABETO_CROCKFORD.includes(corregido)) return null;
    normalizado += corregido;
  }
  return normalizado;
}

export interface CodigoDescompuesto {
  readonly selector: string;
  readonly verificador: string;
}

/** Normaliza y parte en selector + verificador. `null` ante cualquier anomalía. */
export function descomponerCodigo(entrada: unknown): CodigoDescompuesto | null {
  const normalizado = normalizarCodigo(entrada);
  if (normalizado === null) return null;
  return {
    selector: normalizado.slice(0, CARACTERES_SELECTOR),
    verificador: normalizado.slice(CARACTERES_SELECTOR),
  };
}

/**
 * Identificador público del enlace (`shared_links.public_slug`).
 *
 * 128 bits de `randomBytes` en base64url (22 caracteres). El esquema exige
 * *«aleatorio (>=128 bits), NO derivado del nombre ni del id interno»*. No es un
 * secreto —aparece en la URL— y por eso **no** sustituye al código: un enlace
 * privado exige las dos cosas.
 */
export function generarSlugPublico(): string {
  return randomBytes(16).toString('base64url');
}

/** Forma admisible de un slug, para rechazar basura sin tocar la base de datos. */
export const PATRON_SLUG = /^[A-Za-z0-9_-]{16,64}$/u;

export function esSlugAdmisible(valor: unknown): valor is string {
  return typeof valor === 'string' && PATRON_SLUG.test(valor);
}
