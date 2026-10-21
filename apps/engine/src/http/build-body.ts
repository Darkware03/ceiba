/**
 * Construcción del cuerpo saliente a partir del contrato v1.
 *
 * El motor recibe el cuerpo YA RESUELTO (ADR-0002): no interpola
 * `{{variables}}` ni resuelve secretos. Aquí sólo se serializa.
 *
 * MULTIPART (RFC 7578). Dos decisiones que conviene leer antes de tocar nada:
 *
 * 1. Los bytes de un fichero viajan INLINE en `parts[].content` codificados en
 *    base64. El motor es sin estado: no comparte sistema de ficheros con la
 *    API, así que una referencia opaca (`parts[].fileRef`) es irresoluble aquí.
 *    No es un hueco de implementación, es la frontera del componente.
 * 2. `name` y `filename` se escapan con percent-encoding de `"`, `\`, CR, LF y
 *    los demás controles C0/DEL, igual que el algoritmo de multipart/form-data
 *    de WHATWG que implementan los navegadores. Los caracteres no ASCII salen
 *    en UTF-8 crudo: RFC 7578 §4.2 dice literalmente que `filename*` (RFC 5987)
 *    NO debe usarse en multipart/form-data, así que no se emite.
 */
import { randomBytes } from 'node:crypto';
import { EngineRequestError } from '../net/errors.ts';
import type { EngineBody } from '../contract/engine-contract.ts';

export interface BuiltBody {
  readonly buffer: Buffer | null;
  readonly contentType: string | null;
}

type EngineBodyPart = NonNullable<EngineBody['parts']>[number];

/** Una parte ya serializada, todavía sin delimitadores. */
interface RenderedPart {
  readonly headers: string;
  readonly payload: Buffer;
}

const EMPTY: BuiltBody = Object.freeze({ buffer: null, contentType: null });

const CRLF = '\r\n';

/** Base64 estándar canónico, con relleno opcional. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const DEFAULT_PART_CONTENT_TYPE = 'application/octet-stream';

/** Intentos de boundary antes de rendirse. Con 128 bits de entropía, 1 basta. */
const BOUNDARY_ATTEMPTS = 16;

export function buildBody(body: EngineBody | null | undefined): BuiltBody {
  if (body === null || body === undefined || body.mode === 'none') return EMPTY;

  const declared = body.contentType ?? null;
  const raw = body.raw ?? '';

  switch (body.mode) {
    case 'raw':
      return { buffer: Buffer.from(raw, 'utf8'), contentType: declared ?? 'text/plain; charset=utf-8' };

    case 'json':
      return { buffer: Buffer.from(raw, 'utf8'), contentType: declared ?? 'application/json' };

    case 'urlencoded':
      return {
        buffer: Buffer.from(raw, 'utf8'),
        contentType: declared ?? 'application/x-www-form-urlencoded',
      };

    case 'graphql': {
      const payload: { query: string; variables?: unknown } = { query: raw };
      if (body.variables != null && body.variables !== '') {
        try {
          payload.variables = JSON.parse(body.variables) as unknown;
        } catch {
          throw new EngineRequestError('graphql.variables no es JSON válido', 'body.variables');
        }
      }
      return { buffer: Buffer.from(JSON.stringify(payload), 'utf8'), contentType: declared ?? 'application/json' };
    }

    case 'binary': {
      if (body.fileRef != null && body.fileRef !== '') {
        // El motor es SIN ESTADO y no tiene sistema de ficheros compartido con
        // la API: no puede resolver una referencia opaca. NO IMPLEMENTADO en v1.
        throw new EngineRequestError(
          'body.fileRef no está implementado en el motor v1: la API debe enviar los bytes en base64',
          'body.fileRef',
        );
      }
      const buffer = Buffer.from(raw, 'base64');
      if (raw !== '' && buffer.length === 0) {
        throw new EngineRequestError('body.raw no es base64 válido en modo binary', 'body.raw');
      }
      return { buffer, contentType: declared ?? 'application/octet-stream' };
    }

    case 'form': {
      const parts = body.parts ?? [];
      const rendered = parts.map((part, index) => renderPart(part, index));
      const boundary = chooseBoundary(rendered);
      const chunks: Buffer[] = [];
      for (const part of rendered) {
        chunks.push(Buffer.from(`--${boundary}${CRLF}${part.headers}${CRLF}`, 'utf8'));
        chunks.push(part.payload);
        chunks.push(Buffer.from(CRLF, 'utf8'));
      }
      chunks.push(Buffer.from(`--${boundary}--${CRLF}`, 'utf8'));
      return {
        buffer: Buffer.concat(chunks),
        contentType: `multipart/form-data; boundary=${boundary}`,
      };
    }

    default:
      throw new EngineRequestError(`modo de cuerpo no soportado: ${String(body.mode)}`, 'body.mode');
  }
}

/**
 * Serializa una parte: sus cabeceras (con el CRLF de cada una, sin la línea
 * en blanco que las cierra) y su carga útil.
 */
function renderPart(part: EngineBodyPart, index: number): RenderedPart {
  const at = `body.parts[${index}]`;
  const name = escapeHeaderParam(part.name);
  const declared = emptyToNull(part.contentType);
  if (declared !== null) assertHeaderValue(declared, `${at}.contentType`);

  if (part.type === 'file') {
    const payload = decodeFileContent(part, index);
    const filename = emptyToNull(part.filename);
    // RFC 7578 §4.2: `filename` es un SHOULD para contenido de fichero; si la
    // API no lo manda se omite el parámetro, no se inventa uno.
    const disposition =
      filename === null
        ? `Content-Disposition: form-data; name="${name}"`
        : `Content-Disposition: form-data; name="${name}"; filename="${escapeHeaderParam(filename)}"`;
    return {
      headers: `${disposition}${CRLF}Content-Type: ${declared ?? DEFAULT_PART_CONTENT_TYPE}${CRLF}`,
      payload,
    };
  }

  // Parte de texto. Sin `contentType` sale byte a byte igual que en v1.
  const disposition = `Content-Disposition: form-data; name="${name}"${CRLF}`;
  const contentType = declared === null ? '' : `Content-Type: ${declared}${CRLF}`;
  return { headers: `${disposition}${contentType}`, payload: Buffer.from(part.value ?? '', 'utf8') };
}

/** Bytes de una parte `file`. El motor sólo entiende base64 inline. */
function decodeFileContent(part: EngineBodyPart, index: number): Buffer {
  const at = `body.parts[${index}]`;
  const etiqueta = escapeHeaderParam(part.name);
  const content = part.content ?? null;

  if (content === null) {
    if (emptyToNull(part.fileRef) !== null) {
      throw new EngineRequestError(
        `la parte "${etiqueta}" trae fileRef: el motor es SIN ESTADO (ADR-0002), no comparte ` +
          'sistema de ficheros con la API y no puede resolver una referencia opaca. ' +
          'La API debe enviar los bytes en base64 en parts[].content',
        `${at}.fileRef`,
      );
    }
    throw new EngineRequestError(
      `la parte "${etiqueta}" es de tipo file pero no trae parts[].content con los bytes en base64`,
      `${at}.content`,
    );
  }

  // `Buffer.from(x, 'base64')` NO lanza: descarta en silencio lo que no encaja.
  // Sin esta comprobación un cuerpo corrupto se enviaría truncado y en silencio.
  const compacto = content.replace(/[\r\n\t ]/g, '');
  if (!BASE64.test(compacto)) {
    throw new EngineRequestError(
      `la parte "${etiqueta}" no trae base64 válido en parts[].content`,
      `${at}.content`,
    );
  }
  return Buffer.from(compacto, 'base64');
}

/**
 * Escapado RFC 7578 §5.1 de los parámetros `name` y `filename`.
 *
 * El v1 BORRABA `"`, `\`, CR y LF, con lo que cambiaba el nombre del campo sin
 * avisar. Aquí se escapan en percent-encoding, que es reversible y es lo que
 * hacen los navegadores. Se añaden los controles C0 y DEL (inyección de
 * cabecera) y la barra `\`, que dentro de una cadena entre comillas abre un
 * quoted-pair y permitiría tragarse la comilla de cierre.
 *
 * El `%` NO se escapa, igual que en WHATWG: un nombre que ya contenga `%22`
 * literal queda ambiguo al decodificar. Es el precio de emitir exactamente lo
 * que los servidores reales esperan recibir.
 */
function escapeHeaderParam(value: string): string {
  return value.replace(/["\\\u0000-\u001f\u007f]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return `%${code.toString(16).toUpperCase().padStart(2, '0')}`;
  });
}

/** Un `Content-Type` con CR, LF o controles inyectaría cabeceras en la parte. */
function assertHeaderValue(value: string, at: string): void {
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new EngineRequestError(`${at} contiene caracteres de control`, at);
  }
  if (value.length > 256) {
    throw new EngineRequestError(`${at} supera los 256 caracteres`, at);
  }
}

/**
 * Elige un boundary que no aparezca dentro de ninguna parte. Con 128 bits
 * aleatorios la colisión es teórica, pero comprobarla no cuesta nada y
 * convierte «improbable» en «imposible»: una parte que contuviera el
 * delimitador partiría el cuerpo en el receptor.
 */
function chooseBoundary(parts: readonly RenderedPart[]): string {
  for (let intento = 0; intento < BOUNDARY_ATTEMPTS; intento += 1) {
    const boundary = `ceiba${randomBytes(16).toString('hex')}`;
    const aguja = Buffer.from(boundary, 'utf8');
    const choca = parts.some((p) => p.headers.includes(boundary) || p.payload.includes(aguja));
    if (!choca) return boundary;
  }
  throw new EngineRequestError('no se pudo generar un boundary libre de colisiones', 'body.parts');
}

function emptyToNull(value: string | null | undefined): string | null {
  return value === null || value === undefined || value === '' ? null : value;
}
