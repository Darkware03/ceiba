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
 * `body_mode` del esquema. **Los 10 valores**, contados sobre
 * `prisma/schema/01-enums.prisma:117-130` (no copiados de ningún documento:
 * el BRIEF-FASE6 decía 8 y se equivocó).
 *
 * FASE 7 — se admiten `binary_file` y `custom`, que la fase 6 rechazaba:
 *
 *  - `binary_file` ya es posible porque **ahora hay subida de ficheros**
 *    (§2.2): el cliente manda `binaryFileId` y `ck_body_mode_shape` queda
 *    satisfecho. Sin `binaryFileId` sigue siendo **422**, no un 500 del CHECK.
 *  - `custom` se acepta con la forma que el CHECK le impone: `raw_content` y
 *    `binary_file_id` a NULL. Es un modo «sin forma definida» en el esquema y
 *    así se guarda; el generador de cURL ya lo exporta con su advertencia.
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
  'binary_file',
  'custom',
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

/**
 * Modos que `ck_body_mode_shape` obliga a dejar con `raw_content IS NULL` **y**
 * `binary_file_id IS NULL`. Literal de la migración
 * `20261014193100_ceiba_constraints_and_indexes/migration.sql:255-256`.
 */
export const MODOS_SIN_CONTENIDO_CRUDO: ReadonlySet<string> = new Set([
  'none',
  'form_urlencoded',
  'multipart_form_data',
  'custom',
]);

/** Sólo `multipart_form_data` admite campos de tipo fichero (columna `file_id`). */
export const MODOS_CON_ADJUNTOS: ReadonlySet<string> = new Set(['multipart_form_data']);

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

/**
 * Un campo de `request_body_fields` tal y como lo manda el cliente (§2.1).
 *
 * `ck_bodyfield_xor` permite **como mucho una** fuente de valor por fila, así
 * que `kind` decide cuál: `text` → `field_value`, `file` → `file_id`. Nunca
 * los dos. Los campos secretos **no se crean por esta ruta**: exigen
 * `secret_id`, y el cliente no tiene forma de referenciar un secreto todavía.
 */
export const esquemaCampoDeCuerpo = z
  .object({
    key: z.string().trim().min(1).max(256),
    kind: z.enum(['text', 'file']).optional(),
    value: z.string().max(16384).nullable().optional(),
    fileId: z.uuid().nullable().optional(),
    contentType: z.string().trim().max(255).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .superRefine((campo, ctx) => {
    const tipo = campo.kind ?? (campo.fileId != null ? 'file' : 'text');
    if (tipo === 'file') {
      if (campo.fileId == null) {
        ctx.addIssue({
          code: 'custom',
          path: ['fileId'],
          message: 'un campo de tipo file exige fileId',
        });
      }
      if (campo.value != null && campo.value !== '') {
        ctx.addIssue({
          code: 'custom',
          path: ['value'],
          message: 'un campo de tipo file no puede llevar value (ck_bodyfield_xor)',
        });
      }
      return;
    }
    if (campo.fileId != null) {
      ctx.addIssue({
        code: 'custom',
        path: ['fileId'],
        message: 'un campo de tipo text no puede llevar fileId (ck_bodyfield_xor)',
      });
    }
  });
export type CampoDeCuerpo = z.infer<typeof esquemaCampoDeCuerpo>;

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
  bodyContentType: z.string().trim().max(255).nullable().optional(),
  bodyFields: z.array(esquemaCampoDeCuerpo).max(200).optional(),
  binaryFileId: z.uuid().nullable().optional(),
  sortKey: z.string().trim().max(64).nullable().optional(),
};

/**
 * `ck_body_mode_shape` traducido a 422 legible.
 *
 * Se comprueba **aquí** y no se deja reventar al CHECK porque un 500 con un
 * «violates check constraint» no le dice nada al cliente y, peor, expone el
 * nombre de la restricción. El §2.1 del BRIEF-FASE7 es explícito: «Enviar
 * `body` con `bodyType` de formulario es **422**, no un silencio».
 *
 * `modo === undefined` significa «el PATCH no toca el modo»: la coherencia
 * contra el estado final la comprueba el servicio, que sí conoce la fila.
 */
export function problemasDeFormaDelCuerpo(v: {
  bodyType?: string | undefined;
  body?: string | null | undefined;
  bodyFields?: readonly unknown[] | undefined;
  binaryFileId?: string | null | undefined;
}): string[] {
  const modo = v.bodyType;
  if (modo === undefined) return [];
  const problemas: string[] = [];
  const traeCrudo = typeof v.body === 'string' && v.body !== '';
  const traeCampos = v.bodyFields !== undefined && v.bodyFields.length > 0;
  const traeBinario = typeof v.binaryFileId === 'string';

  if (modo === 'binary_file') {
    if (!traeBinario) {
      problemas.push('binaryFileId: obligatorio con bodyType=binary_file (ck_body_mode_shape)');
    }
    if (traeCrudo) {
      problemas.push('body: con bodyType=binary_file el contenido crudo debe ir vacío');
    }
    if (traeCampos) {
      problemas.push('bodyFields: sólo valen en form_urlencoded y multipart_form_data');
    }
    return problemas;
  }

  if (traeBinario) {
    problemas.push(`binaryFileId: sólo vale con bodyType=binary_file, no con ${modo}`);
  }

  if (MODOS_DE_FORMULARIO.has(modo)) {
    if (traeCrudo) {
      problemas.push(
        `body: con bodyType=${modo} el contenido va en bodyFields, no en body (ck_body_mode_shape)`,
      );
    }
    return problemas;
  }

  if (traeCampos) {
    problemas.push('bodyFields: sólo valen en form_urlencoded y multipart_form_data');
  }
  if (modo === 'none' && traeCrudo) {
    problemas.push('body: con bodyType=none no puede haber contenido');
  }
  if (modo === 'custom' && traeCrudo) {
    problemas.push('body: con bodyType=custom el esquema obliga a raw_content NULL');
  }
  return problemas;
}

const MENSAJE_FORMA = 'la forma del cuerpo no es compatible con el modo indicado';

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
  })
  .superRefine((v, ctx) => {
    for (const problema of problemasDeFormaDelCuerpo(v)) {
      ctx.addIssue({ code: 'custom', path: ['bodyType'], message: `${MENSAJE_FORMA}: ${problema}` });
    }
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
    bodyContentType: camposComunes.bodyContentType,
    bodyFields: camposComunes.bodyFields,
    binaryFileId: camposComunes.binaryFileId,
    sortKey: camposComunes.sortKey,
    /**
     * BLOQUEO OPTIMISTA, OPCIONAL (darkware, fase 7).
     *
     * La fase 7 puso **autoguardado** en el constructor: ahora se escribe
     * solo, cada 800 ms, sin que nadie pulse nada. Eso convierte en rutina lo
     * que antes exigía mala suerte: dos personas con la misma petición
     * abierta, y la última pulsación gana en silencio.
     *
     * `api_requests.lock_version` existía desde el diseño y **no protegía
     * nada**: el repositorio lo incrementaba sin `WHERE`. Lo detectó el
     * `frontend-engineer` y lo dejó escrito como lo único que no podía
     * cerrar desde su ámbito. Se cierra aquí.
     *
     * Es OPCIONAL a propósito: quien no lo mande sigue con el comportamiento
     * de siempre («lo último que llega manda»). Quien lo mande —y la lectura
     * ya lo devuelve— recibe **409** en vez de pisar a otro.
     */
    lockVersion: z.number().int().min(0).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no hay nada que actualizar' })
  .refine((v) => verboCoherente(v), { message: MENSAJE_VERBO, path: ['methodCustom'] })
  .superRefine((v, ctx) => {
    for (const problema of problemasDeFormaDelCuerpo(v)) {
      ctx.addIssue({ code: 'custom', path: ['bodyType'], message: `${MENSAJE_FORMA}: ${problema}` });
    }
  });
export type EntradaActualizarPeticion = z.infer<typeof esquemaActualizarPeticion>;

export const esquemaDuplicarPeticion = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    folderId: z.uuid().nullable().optional(),
  })
  .optional();
export type EntradaDuplicarPeticion = z.infer<typeof esquemaDuplicarPeticion>;
