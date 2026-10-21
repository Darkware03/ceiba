import { z } from 'zod';

/**
 * Contrato de entrada de las 7 rutas del `BRIEF-FASE6` §1.
 *
 * Los nombres son **los que ya usa la web** (`name`, `method`, `methodCustom`,
 * `url`, `folderId`, `description`, `headers`, `queryParams`, `bodyType`,
 * `body`, `sortKey`), no los de las columnas. La traducción a columnas la hace
 * el repositorio: `url` → `url_template`, `bodyType` → `body_mode`, etc.
 *
 * Validación **siempre en el servidor** (`PipeZod` → 422 con la lista de
 * campos, nunca con el valor recibido).
 */

/** `http_method` del esquema, sin inventar ningún verbo. */
export const METODOS_HTTP = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'TRACE',
  'CUSTOM',
] as const;
export type MetodoHttp = (typeof METODOS_HTTP)[number];

/**
 * `body_mode` del esquema. El enum de PostgreSQL tiene dos valores más
 * (`binary_file` y `custom`) que **no se aceptan por esta ruta**:
 *
 *  - `binary_file` exige una fila en `files` (`ck_body_mode_shape` obliga a
 *    `binary_file_id IS NOT NULL`), y no hay subida de ficheros en la API.
 *  - `custom` no tiene forma definida.
 *
 * Aceptarlos produciría una violación de CHECK en el motor o una fila
 * inconsistente. Se rechazan con 422 y se declaran como HUECO en el informe.
 * Las filas que ya existan con esos modos **sí** se leen y se exportan a cURL
 * con su advertencia; lo que no se permite es crearlas desde aquí.
 */
export const MODOS_DE_CUERPO = [
  'none',
  'raw_json',
  'raw_text',
  'raw_xml',
  'raw_html',
  'graphql',
  'form_urlencoded',
  'multipart_form_data',
] as const;
export type ModoDeCuerpo = (typeof MODOS_DE_CUERPO)[number];

/** Modos cuyo contenido va a `request_bodies.raw_content`. */
export const MODOS_CRUDOS: ReadonlySet<string> = new Set([
  'raw_json',
  'raw_text',
  'raw_xml',
  'raw_html',
  'graphql',
]);

/** Modos cuyo contenido va a `request_body_fields`. */
export const MODOS_DE_FORMULARIO: ReadonlySet<string> = new Set([
  'form_urlencoded',
  'multipart_form_data',
]);

/** Token de RFC 9110. Vale igual para nombres de cabecera y para verbos. */
const TOKEN_RFC9110 = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/u;

export const esquemaParejaClaveValor = z.object({
  key: z.string().trim().min(1).max(256),
  value: z.string().max(16384).nullable().optional(),
  enabled: z.boolean().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
});
export type ParejaClaveValor = z.infer<typeof esquemaParejaClaveValor>;

const esquemaCabecera = esquemaParejaClaveValor.refine(
  (h) => TOKEN_RFC9110.test(h.key),
  { message: 'el nombre de cabecera debe ser un token de RFC 9110' },
);

const camposComunes = {
  name: z.string().trim().min(1).max(200),
  method: z.enum(METODOS_HTTP),
  methodCustom: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(TOKEN_RFC9110, 'el verbo personalizado debe ser un token de RFC 9110')
    .nullable()
    .optional(),
  url: z.string().trim().min(1).max(4096),
  folderId: z.uuid().nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  headers: z.array(esquemaCabecera).max(200).optional(),
  queryParams: z.array(esquemaParejaClaveValor).max(200).optional(),
  bodyType: z.enum(MODOS_DE_CUERPO).optional(),
  body: z.string().max(1_048_576).nullable().optional(),
  sortKey: z.string().trim().max(64).nullable().optional(),
};

/**
 * `ck_request_custom_verb`: `(method = 'CUSTOM') = (method_custom IS NOT NULL)`.
 * Se comprueba aquí para devolver un 422 legible en vez de dejar que reviente
 * el CHECK del motor con un 500.
 */
function verboCoherente(v: {
  method?: string | undefined;
  methodCustom?: string | null | undefined;
}): boolean {
  if (v.method === undefined) {
    // En el PATCH se valida contra el estado final, en el servicio.
    return true;
  }
  const tienePersonalizado = typeof v.methodCustom === 'string' && v.methodCustom.trim() !== '';
  return v.method === 'CUSTOM' ? tienePersonalizado : !tienePersonalizado;
}

const MENSAJE_VERBO =
  'con method=CUSTOM hay que enviar methodCustom, y con cualquier otro método methodCustom debe ir vacío';

export const esquemaCrearPeticion = z
  .object({
    ...camposComunes,
    method: camposComunes.method.optional(),
  })
  .refine((v) => verboCoherente({ method: v.method ?? 'GET', methodCustom: v.methodCustom }), {
    message: MENSAJE_VERBO,
    path: ['methodCustom'],
  });
export type EntradaCrearPeticion = z.infer<typeof esquemaCrearPeticion>;

export const esquemaActualizarPeticion = z
  .object({
    name: camposComunes.name.optional(),
    method: camposComunes.method.optional(),
    methodCustom: camposComunes.methodCustom,
    url: camposComunes.url.optional(),
    folderId: camposComunes.folderId,
    description: camposComunes.description,
    headers: camposComunes.headers,
    queryParams: camposComunes.queryParams,
    bodyType: camposComunes.bodyType,
    body: camposComunes.body,
    sortKey: camposComunes.sortKey,
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no hay nada que actualizar' })
  .refine((v) => verboCoherente(v), { message: MENSAJE_VERBO, path: ['methodCustom'] });
export type EntradaActualizarPeticion = z.infer<typeof esquemaActualizarPeticion>;

export const esquemaDuplicarPeticion = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    folderId: z.uuid().nullable().optional(),
  })
  .optional();
export type EntradaDuplicarPeticion = z.infer<typeof esquemaDuplicarPeticion>;
