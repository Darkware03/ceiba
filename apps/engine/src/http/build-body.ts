/**
 * Construcción del cuerpo saliente a partir del contrato v1.
 *
 * El motor recibe el cuerpo YA RESUELTO (ADR-0002): no interpola
 * `{{variables}}` ni resuelve secretos. Aquí sólo se serializa.
 */
import { randomBytes } from 'node:crypto';
import { EngineRequestError } from '../net/errors.ts';
import type { EngineBody } from '../contract/engine-contract.ts';

export interface BuiltBody {
  readonly buffer: Buffer | null;
  readonly contentType: string | null;
}

const EMPTY: BuiltBody = Object.freeze({ buffer: null, contentType: null });

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
      if (parts.some((p) => p.type === 'file')) {
        throw new EngineRequestError(
          'multipart con ficheros no está implementado en el motor v1',
          'body.parts[].type=file',
        );
      }
      const boundary = `ceiba${randomBytes(16).toString('hex')}`;
      const chunks: Buffer[] = [];
      for (const part of parts) {
        chunks.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${escapeQuotes(part.name)}"\r\n\r\n`,
            'utf8',
          ),
        );
        chunks.push(Buffer.from(part.value ?? '', 'utf8'));
        chunks.push(Buffer.from('\r\n', 'utf8'));
      }
      chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
      return {
        buffer: Buffer.concat(chunks),
        contentType: `multipart/form-data; boundary=${boundary}`,
      };
    }

    default:
      throw new EngineRequestError(`modo de cuerpo no soportado: ${String(body.mode)}`, 'body.mode');
  }
}

function escapeQuotes(value: string): string {
  return value.replace(/["\\\r\n]/g, '');
}
