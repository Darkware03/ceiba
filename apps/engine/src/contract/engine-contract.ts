/**
 * Contrato v1 del motor (ADR-0002).
 *
 * HUECO: el ADR-0002 sitúa estos esquemas en `packages/contracts/src/engine/`
 * como fuente única de verdad para la API y el motor. El BRIEF-FASE1 §3.C
 * restringe mi escritura a `apps/engine/`, así que viven aquí de momento y
 * habrá que moverlos sin cambiar la forma. Creo que pertenece a
 * `software-architect` decidir cuándo se crea `packages/contracts`.
 *
 * Todos los objetos son ESTRICTOS: un campo desconocido es un error. Eso es
 * también el control C-SSRF-10 (a) — el DTO rechaza cualquier campo `proxy`.
 */
import { z } from 'zod';

/** Códigos cerrados de error del contrato v1. */
export const ENGINE_ERROR_CODES = [
  'SSRF_BLOCKED',
  'DNS_FAILURE',
  'CONNECTION_REFUSED',
  'CONNECTION_RESET',
  'TLS_ERROR',
  'TIMEOUT',
  'TOO_MANY_REDIRECTS',
  'RESPONSE_TOO_LARGE',
  'SCRIPT_ERROR',
  'SCRIPT_TIMEOUT',
  'INVALID_REQUEST',
  'ENGINE_OVERLOADED',
] as const;

export type EngineErrorCode = (typeof ENGINE_ERROR_CODES)[number];

export const ENGINE_OUTCOMES = ['completed', 'failed', 'blocked', 'timeout', 'too_large'] as const;
export type EngineOutcome = (typeof ENGINE_OUTCOMES)[number];

/**
 * Métodos permitidos. `CONNECT` y `TRACE` quedan fuera a propósito: el
 * primero es un túnel (anularía la política de destino) y el segundo es un
 * reflejo que facilita el descubrimiento interno.
 */
export const ALLOWED_METHODS = [
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
] as const;

const headerSchema = z.strictObject({
  name: z.string().min(1).max(256),
  value: z.string().max(32768),
  secret: z.boolean().optional().default(false),
});

const bodySchema = z.strictObject({
  mode: z.enum(['none', 'raw', 'json', 'form', 'urlencoded', 'binary', 'graphql']),
  contentType: z.string().max(256).nullable().optional(),
  /** Cuerpo literal. En `binary` se interpreta como base64. */
  raw: z.string().nullable().optional(),
  parts: z
    .array(
      z.strictObject({
        name: z.string().min(1),
        type: z.enum(['text', 'file']),
        /** Valor literal de una parte `text`. Se ignora en las partes `file`. */
        value: z.string().nullable().optional(),
        /**
         * Bytes del fichero en base64. La API los envía INLINE porque el motor
         * es sin estado (ADR-0002): no comparte sistema de ficheros con la API
         * y no puede resolver `fileRef` por su cuenta. Es el único camino
         * soportado para `type: 'file'`.
         */
        content: z.string().nullable().optional(),
        /** Referencia opaca a un fichero subido. NO resoluble por el motor. */
        fileRef: z.string().nullable().optional(),
        filename: z.string().nullable().optional(),
        contentType: z.string().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
  /** Referencia opaca a un fichero subido. NO implementada en v1. */
  fileRef: z.string().nullable().optional(),
  /** GraphQL: variables ya resueltas por la API. */
  variables: z.string().nullable().optional(),
});

const policySchema = z.strictObject({
  timeoutMs: z.number().int().positive().optional(),
  maxRedirects: z.number().int().min(0).optional(),
  maxResponseBytes: z.number().int().positive().optional(),
  followRedirects: z.boolean().optional().default(true),
  /** NUNCA "off": la protección no se desactiva por petición (C-SSRF-11). */
  ssrfProfile: z.enum(['default', 'allowlisted']).optional().default('default'),
  allowedDestinations: z
    .array(
      z.strictObject({
        cidr: z.string().min(1),
        port: z.number().int().min(1).max(65535).nullable().optional(),
        scheme: z.enum(['http:', 'https:']).nullable().optional(),
        expiresAt: z.number().int().positive(),
        id: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
  tls: z
    .strictObject({
      rejectUnauthorized: z.boolean().optional().default(true),
      clientCertRef: z.string().nullable().optional(),
    })
    .optional(),
});

const scriptsSchema = z.strictObject({
  preRequest: z.string().nullable().optional(),
  postResponse: z.string().nullable().optional(),
  limits: z
    .strictObject({
      cpuMs: z.number().int().positive().optional(),
      memoryMb: z.number().int().positive().optional(),
      wallMs: z.number().int().positive().optional(),
    })
    .optional(),
});

export const executeRequestSchema = z.strictObject({
  executionId: z.string().min(1).max(64),
  request: z.strictObject({
    method: z.enum(ALLOWED_METHODS),
    /** YA RESUELTA: el motor no interpola `{{variables}}` (ADR-0002). */
    url: z.string().min(1).max(8192),
    headers: z.array(headerSchema).max(200).optional().default([]),
    body: bodySchema.nullable().optional(),
  }),
  // `.default(() => schema.parse({}))` rellena los valores por defecto cuando
  // la API omite el bloque entero.
  policy: policySchema.optional().default(() => policySchema.parse({})),
  scripts: scriptsSchema.nullable().optional(),
  capture: z
    .strictObject({
      storeBody: z.boolean().optional().default(true),
      maxStoredBytes: z.number().int().positive().optional(),
    })
    .optional()
    .default(() => ({ storeBody: true }) as { storeBody: boolean; maxStoredBytes?: number }),
});

export type ExecuteRequestInput = z.infer<typeof executeRequestSchema>;
export type EngineHeader = z.infer<typeof headerSchema>;
export type EngineBody = z.infer<typeof bodySchema>;

export interface EngineTimings {
  dnsMs: number;
  tcpMs: number;
  tlsMs: number;
  ttfbMs: number;
  totalMs: number;
}

export interface EngineRedirectHop {
  status: number;
  from: string;
  to: string;
}

export interface EngineResponsePayload {
  status: number;
  statusText: string;
  httpVersion: string;
  headers: Array<{ name: string; value: string }>;
  bodyEncoding: 'utf8' | 'base64';
  body: string;
  bodyTruncated: boolean;
  sizeBytes: number;
}

export interface EngineTlsInfo {
  protocol: string | null;
  cipher: string | null;
  peerCN: string | null;
  validTo: string | null;
}

export interface ExecuteResponse {
  executionId: string;
  outcome: EngineOutcome;
  response: EngineResponsePayload | null;
  timings: EngineTimings;
  redirects: EngineRedirectHop[];
  tls: EngineTlsInfo | null;
  resolvedAddresses: string[];
  scriptResults: null;
  error: { code: EngineErrorCode; message: string } | null;
}

/**
 * Mensajes de error que ven la API y el usuario final.
 *
 * C-SSRF: `SSRF_BLOCKED` **no revela** qué IP ni qué regla disparó el bloqueo.
 * El detalle va al log estructurado del motor, nunca a la respuesta.
 */
export const PUBLIC_ERROR_MESSAGES: Readonly<Record<EngineErrorCode, string>> = Object.freeze({
  SSRF_BLOCKED: 'El destino está fuera de la política de red permitida.',
  DNS_FAILURE: 'No se pudo resolver el nombre del destino.',
  CONNECTION_REFUSED: 'El destino rechazó la conexión.',
  CONNECTION_RESET: 'El destino cerró la conexión.',
  TLS_ERROR: 'Falló la negociación TLS con el destino.',
  TIMEOUT: 'El destino agotó el tiempo máximo de la petición.',
  TOO_MANY_REDIRECTS: 'Se superó el número máximo de redirecciones.',
  RESPONSE_TOO_LARGE: 'La respuesta supera el tamaño máximo permitido.',
  SCRIPT_ERROR: 'Los scripts de usuario no están disponibles en esta versión del motor.',
  SCRIPT_TIMEOUT: 'El script agotó su tiempo máximo.',
  INVALID_REQUEST: 'La petición no cumple el contrato del motor.',
  ENGINE_OVERLOADED: 'El motor está saturado; inténtalo de nuevo.',
});
