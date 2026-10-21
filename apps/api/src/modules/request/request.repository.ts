import { Inject, Injectable } from '@nestjs/common';
import {
  CLIENTE_PRISMA,
  type InstanciaClientePrisma,
} from '../../platform/persistence/prisma/prisma-client.ts';
import {
  MODOS_CON_ADJUNTOS,
  MODOS_CRUDOS,
  MODOS_DE_FORMULARIO,
  MODOS_SIN_CONTENIDO_CRUDO,
} from './dto/request.dto.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * Acceso a `api_requests` y a sus cuatro tablas hijas, **ya aplicadas** en
 * PostgreSQL: `request_headers`, `request_params`, `request_bodies` y
 * `request_body_fields`.
 *
 * NO SE CREA NI SE MODIFICA NINGUNA COLUMNA. `prisma/` y `docs/schema/` están
 * fuera de ámbito; si faltara algo, se para y se reporta. No ha hecho falta.
 *
 * Decisiones que el esquema impone y que conviene leer antes de tocar esto:
 *
 *  - **El cuerpo no es una columna.** `request_bodies` es 1:1 por rendimiento
 *    (listar el árbol de una colección de miles de peticiones no debe arrastrar
 *    payloads). `ck_body_mode_shape` además prohíbe `raw_content` en los modos
 *    de formulario: ahí el contenido va a `request_body_fields`.
 *  - **Un secreto no vive en la fila.** `ck_header_secret_xor` obliga a
 *    `value IS NULL AND secret_id IS NOT NULL` cuando `is_secret`. Por eso el
 *    repositorio **jamás** puede devolver el valor de una cabecera secreta: no
 *    existe en esta tabla. Es la garantía de C-LEAK en el origen.
 *  - **Reemplazar cabeceras conserva las secretas.** Un PATCH que trae la lista
 *    completa borraría el enlace al secreto, porque el cliente nunca vio su
 *    valor y no puede devolverlo. Sería una pérdida silenciosa de datos
 *    disfrazada de actualización. Las filas con `is_secret` se conservan y las
 *    entradas entrantes que choquen con su nombre se ignoran.
 *  - **`url_template` se guarda tal cual.** Sin resolver, nunca. Es lo que dice
 *    el comentario de la columna y lo que exige la regla 2 del §2 del brief.
 * ════════════════════════════════════════════════════════════════════════════
 */

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Evita que un identificador inventado llegue a PostgreSQL como `::uuid`. */
export function esUuid(valor: unknown): valor is string {
  return typeof valor === 'string' && PATRON_UUID.test(valor);
}

export interface EntradaClaveValor {
  readonly key: string;
  readonly value?: string | null | undefined;
  readonly enabled?: boolean | undefined;
  readonly description?: string | null | undefined;
}

/** Campo de `request_body_fields` tal y como entra desde el contrato (§2.1). */
export interface EntradaCampoDeCuerpo {
  readonly key: string;
  readonly kind?: 'text' | 'file' | undefined;
  readonly value?: string | null | undefined;
  readonly fileId?: string | null | undefined;
  readonly contentType?: string | null | undefined;
  readonly enabled?: boolean | undefined;
}

export interface DatosDePeticion {
  readonly name: string;
  readonly method: string;
  readonly methodCustom: string | null;
  readonly url: string;
  readonly folderId: string | null;
  readonly description: string | null;
  readonly headers: readonly EntradaClaveValor[] | undefined;
  readonly queryParams: readonly EntradaClaveValor[] | undefined;
  readonly bodyType: string;
  readonly body: string | null;
  readonly bodyContentType: string | null | undefined;
  readonly bodyFields: readonly EntradaCampoDeCuerpo[] | undefined;
  readonly binaryFileId: string | null | undefined;
  readonly sortKey: string | null;
}

export interface FilaCabecera {
  readonly id: string;
  readonly name: string;
  readonly value: string | null;
  readonly secretId: string | null;
  readonly description: string | null;
  readonly isSecret: boolean;
  readonly isEnabled: boolean;
  readonly sortOrder: number;
}

export interface FilaParametro extends FilaCabecera {
  readonly kind: 'query' | 'path';
}

export interface FilaCampoDeFormulario {
  readonly id: string;
  readonly fieldName: string;
  readonly fieldValue: string | null;
  readonly secretId: string | null;
  readonly fileId: string | null;
  readonly contentType: string | null;
  readonly isSecret: boolean;
  readonly isEnabled: boolean;
  readonly sortOrder: number;
}

export interface FilaCuerpo {
  readonly mode: string;
  readonly contentType: string | null;
  readonly rawContent: string | null;
  readonly graphqlVariables: unknown;
  readonly binaryFileId: string | null;
  readonly campos: readonly FilaCampoDeFormulario[];
}

export interface FilaPeticion {
  readonly id: string;
  readonly collectionId: string;
  readonly folderId: string | null;
  readonly externalRef: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly method: string;
  readonly methodCustom: string | null;
  readonly urlTemplate: string;
  readonly bodyMode: string;
  readonly authMode: string;
  readonly authConfigurationId: string | null;
  readonly timeoutMs: number | null;
  readonly redirectPolicy: string | null;
  readonly maxRedirects: number | null;
  readonly tlsVerifyPeer: boolean | null;
  readonly clientCertificateId: string | null;
  readonly preRequestScript: string | null;
  readonly postResponseScript: string | null;
  readonly sortKey: string;
  readonly lockVersion: number;
  readonly lastExecutedAt: Date | null;
  readonly createdByUserId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface FilaPeticionCompleta extends FilaPeticion {
  readonly cabeceras: readonly FilaCabecera[];
  readonly parametros: readonly FilaParametro[];
  readonly cuerpo: FilaCuerpo | null;
}

export interface FilaCarpeta {
  readonly id: string;
  readonly collectionId: string;
  readonly parentFolderId: string | null;
  readonly name: string;
  readonly depth: number;
  readonly sortKey: string;
}

const SELECCION_PETICION = {
  id: true,
  collectionId: true,
  folderId: true,
  externalRef: true,
  name: true,
  description: true,
  method: true,
  methodCustom: true,
  urlTemplate: true,
  bodyMode: true,
  authMode: true,
  authConfigurationId: true,
  timeoutMs: true,
  redirectPolicy: true,
  maxRedirects: true,
  tlsVerifyPeer: true,
  clientCertificateId: true,
  preRequestScript: true,
  postResponseScript: true,
  sortKey: true,
  lockVersion: true,
  lastExecutedAt: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class RepositorioDePeticiones {
  constructor(@Inject(CLIENTE_PRISMA) private readonly prisma: InstanciaClientePrisma) {}

  // -------------------------------------------------------------------------
  // Resolución recurso → workspace (ADR-0009 §7.4). La usa el guard.
  // -------------------------------------------------------------------------

  /**
   * `null` si la petición no existe, está borrada lógicamente o su colección lo
   * está. Devolver el workspace de una petición borrada dejaría accesible un
   * recurso que el usuario cree eliminado.
   */
  async workspaceIdDePeticion(peticionId: string): Promise<string | null> {
    if (!esUuid(peticionId)) return null;
    const fila = await this.prisma.apiRequest.findFirst({
      where: { id: peticionId, deletedAt: null, collection: { deletedAt: null } },
      select: { collection: { select: { workspaceId: true } } },
    });
    return fila?.collection.workspaceId ?? null;
  }

  async coleccionViva(coleccionId: string): Promise<{ id: string; workspaceId: string } | null> {
    if (!esUuid(coleccionId)) return null;
    return this.prisma.collection.findFirst({
      where: { id: coleccionId, deletedAt: null },
      select: { id: true, workspaceId: true },
    });
  }

  async carpetaDeLaColeccion(carpetaId: string, coleccionId: string): Promise<boolean> {
    if (!esUuid(carpetaId) || !esUuid(coleccionId)) return false;
    const fila = await this.prisma.collectionFolder.findFirst({
      where: { id: carpetaId, collectionId: coleccionId, deletedAt: null },
      select: { id: true },
    });
    return fila !== null;
  }

  // -------------------------------------------------------------------------
  // Lectura
  // -------------------------------------------------------------------------

  async listarDeColeccion(
    coleccionId: string,
  ): Promise<{ peticiones: readonly FilaPeticion[]; carpetas: readonly FilaCarpeta[] }> {
    if (!esUuid(coleccionId)) return { peticiones: [], carpetas: [] };
    const [peticiones, carpetas] = await Promise.all([
      this.prisma.apiRequest.findMany({
        where: { collectionId: coleccionId, deletedAt: null },
        select: SELECCION_PETICION,
        orderBy: [{ folderId: 'asc' }, { sortKey: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.collectionFolder.findMany({
        where: { collectionId: coleccionId, deletedAt: null },
        select: {
          id: true,
          collectionId: true,
          parentFolderId: true,
          name: true,
          depth: true,
          sortKey: true,
        },
        orderBy: [{ depth: 'asc' }, { sortKey: 'asc' }],
      }),
    ]);
    return { peticiones, carpetas };
  }

  async buscarCompleta(peticionId: string): Promise<FilaPeticionCompleta | null> {
    if (!esUuid(peticionId)) return null;
    const fila = await this.prisma.apiRequest.findFirst({
      where: { id: peticionId, deletedAt: null, collection: { deletedAt: null } },
      select: {
        ...SELECCION_PETICION,
        requestHeaders: {
          select: {
            id: true,
            name: true,
            value: true,
            secretId: true,
            description: true,
            isSecret: true,
            isEnabled: true,
            sortOrder: true,
          },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        },
        requestParams: {
          select: {
            id: true,
            kind: true,
            name: true,
            value: true,
            secretId: true,
            description: true,
            isSecret: true,
            isEnabled: true,
            sortOrder: true,
          },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        },
        requestBodies: {
          select: {
            mode: true,
            contentType: true,
            rawContent: true,
            graphqlVariables: true,
            binaryFileId: true,
            requestBodyFields: {
              select: {
                id: true,
                fieldName: true,
                fieldValue: true,
                secretId: true,
                fileId: true,
                contentType: true,
                isSecret: true,
                isEnabled: true,
                sortOrder: true,
              },
              orderBy: [{ sortOrder: 'asc' }],
            },
          },
        },
      },
    });
    if (fila === null) return null;

    const { requestHeaders, requestParams, requestBodies, ...resto } = fila;
    return {
      ...resto,
      cabeceras: requestHeaders,
      parametros: requestParams as readonly FilaParametro[],
      cuerpo:
        requestBodies === null
          ? null
          : {
              mode: requestBodies.mode,
              contentType: requestBodies.contentType,
              rawContent: requestBodies.rawContent,
              graphqlVariables: requestBodies.graphqlVariables,
              binaryFileId: requestBodies.binaryFileId,
              campos: requestBodies.requestBodyFields,
            },
    };
  }

  // -------------------------------------------------------------------------
  // Escritura
  // -------------------------------------------------------------------------

  async crear(
    coleccionId: string,
    datos: DatosDePeticion,
    actorId: string,
    ahora: Date,
  ): Promise<string> {
    const sortKey = datos.sortKey ?? (await this.siguienteClaveDeOrden(coleccionId, datos.folderId));
    const cuerpo = construirCuerpo(datos.bodyType, datos.body, {
      contentType: datos.bodyContentType,
      campos: datos.bodyFields,
      binaryFileId: datos.binaryFileId,
    });

    const creada = await this.prisma.apiRequest.create({
      data: {
        collectionId: coleccionId,
        folderId: datos.folderId,
        name: datos.name,
        description: datos.description,
        method: datos.method as 'GET',
        methodCustom: datos.methodCustom,
        urlTemplate: datos.url,
        bodyMode: datos.bodyType as 'none',
        sortKey,
        createdByUserId: actorId,
        createdAt: ahora,
        updatedAt: ahora,
        requestHeaders: { create: filasDeCabecera(datos.headers) },
        requestParams: { create: filasDeParametro(datos.queryParams) },
        ...(cuerpo === null ? {} : { requestBodies: { create: cuerpo } }),
      },
      select: { id: true },
    });
    return creada.id;
  }

  /**
   * Actualización parcial. Sólo se tocan las secciones presentes en `cambios`;
   * `undefined` significa «no la toques», y `null` en un campo anulable
   * significa «ponla a NULL». Son cosas distintas y se distinguen.
   */
  async actualizar(
    peticionId: string,
    cambios: Partial<DatosDePeticion> & {
      readonly bodyTypePresente: boolean;
      readonly binaryFileIdPresente?: boolean;
    },
    ahora: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const datosBase: Record<string, unknown> = { updatedAt: ahora, lockVersion: { increment: 1 } };
      if (cambios.name !== undefined) datosBase['name'] = cambios.name;
      if (cambios.description !== undefined) datosBase['description'] = cambios.description;
      if (cambios.method !== undefined) datosBase['method'] = cambios.method;
      if (cambios.methodCustom !== undefined) datosBase['methodCustom'] = cambios.methodCustom;
      if (cambios.url !== undefined) datosBase['urlTemplate'] = cambios.url;
      if (cambios.folderId !== undefined) datosBase['folderId'] = cambios.folderId;
      if (cambios.sortKey !== undefined && cambios.sortKey !== null) {
        datosBase['sortKey'] = cambios.sortKey;
      }
      if (cambios.bodyTypePresente && cambios.bodyType !== undefined) {
        datosBase['bodyMode'] = cambios.bodyType;
      }

      await tx.apiRequest.update({ where: { id: peticionId }, data: datosBase });

      if (cambios.headers !== undefined) {
        // Las secretas se conservan: su valor no viaja al cliente y por tanto
        // el cliente no lo puede devolver. Borrarlas sería perderlas.
        const secretas = await tx.requestHeader.findMany({
          where: { apiRequestId: peticionId, isSecret: true },
          select: { name: true },
        });
        const reservados = new Set(secretas.map((s) => s.name.toLowerCase()));
        await tx.requestHeader.deleteMany({ where: { apiRequestId: peticionId, isSecret: false } });
        const nuevas = filasDeCabecera(cambios.headers).filter(
          (h) => !reservados.has(h.name.toLowerCase()),
        );
        if (nuevas.length > 0) {
          await tx.requestHeader.createMany({
            data: nuevas.map((h) => ({ ...h, apiRequestId: peticionId })),
          });
        }
      }

      if (cambios.queryParams !== undefined) {
        const secretos = await tx.requestParam.findMany({
          where: { apiRequestId: peticionId, kind: 'query', isSecret: true },
          select: { name: true },
        });
        const reservados = new Set(secretos.map((s) => s.name.toLowerCase()));
        await tx.requestParam.deleteMany({
          where: { apiRequestId: peticionId, kind: 'query', isSecret: false },
        });
        const nuevos = filasDeParametro(cambios.queryParams).filter(
          (p) => !reservados.has(p.name.toLowerCase()),
        );
        if (nuevos.length > 0) {
          await tx.requestParam.createMany({
            data: nuevos.map((p) => ({ ...p, apiRequestId: peticionId })),
          });
        }
      }

      const tocaCuerpo =
        cambios.bodyTypePresente ||
        cambios.body !== undefined ||
        cambios.bodyFields !== undefined ||
        cambios.bodyContentType !== undefined ||
        cambios.binaryFileIdPresente === true;

      if (tocaCuerpo) {
        const actual = await tx.apiRequest.findUnique({
          where: { id: peticionId },
          select: {
            bodyMode: true,
            requestBodies: {
              select: { id: true, rawContent: true, contentType: true, binaryFileId: true },
            },
          },
        });
        // `bodyMode` ya viene actualizado: el `update` de arriba corrió antes
        // en la misma transacción. Es el ESTADO FINAL, que es contra lo que
        // manda `ck_body_mode_shape`.
        const modo = String(actual?.bodyMode ?? 'none');
        const previo = actual?.requestBodies ?? null;

        const contenido =
          cambios.body !== undefined ? cambios.body : (previo?.rawContent ?? null);
        const contentType =
          cambios.bodyContentType !== undefined
            ? cambios.bodyContentType
            : (previo?.contentType ?? null);
        const binaryFileId =
          cambios.binaryFileIdPresente === true
            ? (cambios.binaryFileId ?? null)
            : (previo?.binaryFileId ?? null);

        const nuevo = construirCuerpo(modo, contenido, {
          contentType,
          campos: cambios.bodyFields,
          binaryFileId,
        });

        if (nuevo === null) {
          await tx.requestBody.deleteMany({ where: { apiRequestId: peticionId } });
        } else if (previo === null) {
          await tx.requestBody.create({ data: { ...nuevo, apiRequestId: peticionId } });
        } else {
          // NO se borra y recrea la fila: el borrado arrastra en cascada
          // `request_body_fields`, y con ella los campos secretos, que el
          // cliente **no puede devolver** porque nunca vio su valor. Sería la
          // misma pérdida silenciosa que el repositorio ya evita en las
          // cabeceras. Se actualiza en el sitio.
          const { requestBodyFields, ...columnas } = nuevo;
          await tx.requestBody.update({
            where: { id: previo.id },
            data: { ...columnas, updatedAt: ahora },
          });

          const secretos = await tx.requestBodyField.findMany({
            where: { requestBodyId: previo.id, isSecret: true },
            select: { fieldName: true },
          });
          const reservados = new Set(secretos.map((s) => s.fieldName.toLowerCase()));

          if (cambios.bodyFields !== undefined) {
            await tx.requestBodyField.deleteMany({
              where: { requestBodyId: previo.id, isSecret: false },
            });
            const entrantes = (requestBodyFields?.create ?? []).filter(
              (c) => !reservados.has(c.fieldName.toLowerCase()),
            );
            if (entrantes.length > 0) {
              await tx.requestBodyField.createMany({
                data: entrantes.map((c) => ({ ...c, requestBodyId: previo.id })),
              });
            }
          } else if (!MODOS_DE_FORMULARIO.has(modo)) {
            // El modo final ya no admite campos: los no secretos dejan de
            // tener sentido. Los secretos se conservan, igual que en las
            // cabeceras, por si el usuario vuelve a un modo de formulario.
            await tx.requestBodyField.deleteMany({
              where: { requestBodyId: previo.id, isSecret: false },
            });
          }
        }
      }
    });
  }

  async borrarLogicamente(peticionId: string, actorId: string, ahora: Date): Promise<void> {
    await this.prisma.apiRequest.update({
      where: { id: peticionId },
      data: { deletedAt: ahora, deletedByUserId: actorId, updatedAt: ahora },
    });
  }

  /**
   * Duplica la petición con TODAS sus filas hijas.
   *
   * `external_ref` se pone a `null` a propósito: `uq_requests_external_ref` es
   * único por `(collection_id, external_ref)` y copiarlo reventaría la
   * inserción. Además el identificador de origen señala a UNA petición
   * importada; la copia no es esa.
   *
   * Las cabeceras y parámetros secretos se copian **por referencia**
   * (`secret_id`), nunca por valor —que no existe aquí—. El criptograma sigue
   * siendo uno solo, en el mismo workspace, y la copia no lo descifra.
   */
  async duplicar(
    origenId: string,
    nombre: string,
    carpetaDestino: string | null | undefined,
    actorId: string,
    ahora: Date,
  ): Promise<string> {
    const origen = await this.buscarCompleta(origenId);
    if (origen === null) throw new Error('la petición de origen ya no existe');
    const folderId = carpetaDestino === undefined ? origen.folderId : carpetaDestino;
    const sortKey = await this.siguienteClaveDeOrden(origen.collectionId, folderId);

    const copia = await this.prisma.apiRequest.create({
      data: {
        collectionId: origen.collectionId,
        folderId,
        externalRef: null,
        name: nombre,
        description: origen.description,
        method: origen.method as 'GET',
        methodCustom: origen.methodCustom,
        urlTemplate: origen.urlTemplate,
        bodyMode: origen.bodyMode as 'none',
        authMode: origen.authMode as 'inherit',
        authConfigurationId: origen.authConfigurationId,
        timeoutMs: origen.timeoutMs,
        redirectPolicy: origen.redirectPolicy as null,
        maxRedirects: origen.maxRedirects,
        tlsVerifyPeer: origen.tlsVerifyPeer,
        clientCertificateId: origen.clientCertificateId,
        preRequestScript: origen.preRequestScript,
        postResponseScript: origen.postResponseScript,
        sortKey,
        createdByUserId: actorId,
        createdAt: ahora,
        updatedAt: ahora,
        requestHeaders: {
          create: origen.cabeceras.map((h) => ({
            name: h.name,
            value: h.value,
            secretId: h.secretId,
            description: h.description,
            isSecret: h.isSecret,
            isEnabled: h.isEnabled,
            sortOrder: h.sortOrder,
          })),
        },
        requestParams: {
          create: origen.parametros.map((p) => ({
            kind: p.kind,
            name: p.name,
            value: p.value,
            secretId: p.secretId,
            description: p.description,
            isSecret: p.isSecret,
            isEnabled: p.isEnabled,
            sortOrder: p.sortOrder,
          })),
        },
        ...(origen.cuerpo === null
          ? {}
          : {
              requestBodies: {
                create: {
                  mode: origen.cuerpo.mode as 'none',
                  contentType: origen.cuerpo.contentType,
                  // El fichero NO se duplica: la copia referencia el mismo
                  // objeto del mismo workspace. Duplicar los bytes sería
                  // gastar almacén por nada y romper la deduplicación por
                  // checksum que `files` contempla.
                  rawContent: origen.cuerpo.rawContent,
                  graphqlVariables: origen.cuerpo.graphqlVariables as object | undefined,
                  binaryFileId: origen.cuerpo.binaryFileId,
                  requestBodyFields: {
                    create: origen.cuerpo.campos.map((c) => ({
                      fieldName: c.fieldName,
                      fieldValue: c.fieldValue,
                      secretId: c.secretId,
                      fileId: c.fileId,
                      contentType: c.contentType,
                      isSecret: c.isSecret,
                      isEnabled: c.isEnabled,
                      sortOrder: c.sortOrder,
                    })),
                  },
                },
              },
            }),
      },
      select: { id: true },
    });
    return copia.id;
  }

  /**
   * Siguiente `sort_key` dentro del mismo padre. El formato (entero a 6
   * dígitos con ceros a la izquierda) es el que ya usa `modules/studio` al
   * importar, y se respeta para que el orden sea consistente entre las dos
   * vías de entrada.
   */
  async siguienteClaveDeOrden(coleccionId: string, carpetaId: string | null): Promise<string> {
    const hermanas = await this.prisma.apiRequest.findMany({
      where: { collectionId: coleccionId, folderId: carpetaId, deletedAt: null },
      select: { sortKey: true },
      orderBy: { sortKey: 'desc' },
      take: 1,
    });
    const ultima = hermanas[0]?.sortKey ?? '';
    const numero = Number.parseInt(ultima, 10);
    const siguiente = Number.isFinite(numero) ? numero + 1 : 0;
    return String(Math.max(0, siguiente)).padStart(6, '0');
  }
}

// ---------------------------------------------------------------------------
// Traducción contrato → filas. Fuera de la clase: son puras y se prueban solas.
// ---------------------------------------------------------------------------

interface FilaCabeceraNueva {
  readonly name: string;
  readonly value: string;
  readonly description: string | null;
  readonly isEnabled: boolean;
  readonly sortOrder: number;
}

export function filasDeCabecera(
  entradas: readonly EntradaClaveValor[] | undefined,
): FilaCabeceraNueva[] {
  if (entradas === undefined) return [];
  const vistas = new Set<string>();
  const filas: FilaCabeceraNueva[] = [];
  for (const entrada of entradas) {
    const nombre = entrada.key.trim();
    if (nombre === '') continue;
    // Una cabecera repetida con el mismo nombre no es un error de HTTP, pero
    // sí lo es casi siempre en una interfaz: se queda la última.
    const clave = nombre.toLowerCase();
    if (vistas.has(clave)) {
      const indice = filas.findIndex((f) => f.name.toLowerCase() === clave);
      if (indice >= 0) filas.splice(indice, 1);
    }
    vistas.add(clave);
    filas.push({
      name: nombre,
      // `value` NUNCA es NULL aquí: NULL está reservado por
      // `ck_header_secret_xor` a las cabeceras secretas, y esta ruta no las
      // crea. Una cabecera «sin valor» se guarda como cadena vacía.
      value: entrada.value ?? '',
      description: entrada.description ?? null,
      isEnabled: entrada.enabled !== false,
      sortOrder: 0,
    });
  }
  return filas.map((f, indice) => ({ ...f, sortOrder: indice }));
}

interface FilaParametroNuevo extends FilaCabeceraNueva {
  readonly kind: 'query';
}

export function filasDeParametro(
  entradas: readonly EntradaClaveValor[] | undefined,
): FilaParametroNuevo[] {
  return filasDeCabecera(entradas).map((f) => ({ ...f, kind: 'query' as const }));
}

interface CampoDeCuerpoNuevo {
  fieldName: string;
  fieldValue: string | null;
  fileId: string | null;
  contentType: string | null;
  isSecret: boolean;
  isEnabled: boolean;
  sortOrder: number;
}

interface CuerpoNuevo {
  mode: 'none';
  contentType: string | null;
  rawContent: string | null;
  binaryFileId: string | null;
  requestBodyFields?: { create: CampoDeCuerpoNuevo[] };
}

export interface ExtrasDeCuerpo {
  readonly contentType?: string | null | undefined;
  readonly campos?: readonly EntradaCampoDeCuerpo[] | undefined;
  readonly binaryFileId?: string | null | undefined;
}

/**
 * Traduce `bodyType` + `body` (+ los extras de la fase 7) a la fila de
 * `request_bodies` que `ck_body_mode_shape` admite. La restricción, literal de
 * `20261014193100_ceiba_constraints_and_indexes/migration.sql:252-256`:
 *
 *  - `raw_*`/`graphql`        → `binary_file_id` NULL. El contenido va a
 *    `raw_content`.
 *  - `binary_file`            → `raw_content` NULL **y** `binary_file_id` NOT
 *    NULL. Sin fichero no hay fila: devolver `null` aquí sería guardar una
 *    petición `binary_file` sin cuerpo, así que el DTO ya lo ha cortado con un
 *    422 antes de llegar.
 *  - `none`/`form_urlencoded`/`multipart_form_data`/`custom` → los dos NULL.
 *    En los dos de formulario el contenido vive en `request_body_fields`.
 *
 * Compatibilidad: la firma de dos argumentos sigue valiendo y se comporta
 * igual que en la fase 6 (texto urlencoded desgranado en campos de texto).
 */
export function construirCuerpo(
  modo: string,
  contenido: string | null,
  extras: ExtrasDeCuerpo = {},
): CuerpoNuevo | null {
  const contentType = normalizarContentTypeDeCuerpo(extras.contentType);

  if (modo === 'none') return null;

  if (MODOS_CRUDOS.has(modo)) {
    if ((contenido === null || contenido === '') && contentType === null) return null;
    return verificarForma(modo, {
      mode: modo as 'none',
      contentType,
      rawContent: contenido === '' ? null : contenido,
      binaryFileId: null,
    });
  }

  if (modo === 'binary_file') {
    const ficheroId = extras.binaryFileId ?? null;
    // `ck_body_mode_shape` exige el fichero. Sin él no se escribe nada: el 422
    // lo da el DTO, y este `null` es la red por si alguien llama directo.
    if (ficheroId === null) return null;
    return verificarForma(modo, {
      mode: modo as 'none',
      contentType,
      rawContent: null,
      binaryFileId: ficheroId,
    });
  }

  if (MODOS_DE_FORMULARIO.has(modo)) {
    const admiteAdjuntos = MODOS_CON_ADJUNTOS.has(modo);
    const campos: CampoDeCuerpoNuevo[] =
      extras.campos !== undefined
        ? camposDesdeContrato(extras.campos, admiteAdjuntos)
        : camposDesdeTextoUrlencoded(contenido);
    return verificarForma(modo, {
      mode: modo as 'none',
      contentType,
      rawContent: null,
      binaryFileId: null,
      ...(campos.length > 0 ? { requestBodyFields: { create: campos } } : {}),
    });
  }

  // `custom`: el CHECK obliga a los dos NULL. Se guarda la fila porque puede
  // llevar `content_type`, que es lo único que un modo sin forma definida
  // puede aportar.
  return verificarForma(modo, {
    mode: modo as 'none',
    contentType,
    rawContent: null,
    binaryFileId: null,
  });
}

/**
 * Última red antes de PostgreSQL: comprueba en código lo mismo que comprueba
 * `ck_body_mode_shape`.
 *
 * No es paranoia decorativa. Si alguien añade mañana un modo al enum y olvida
 * una rama aquí, el síntoma sin esto es un **500** con el texto
 * «violates check constraint "ck_body_mode_shape"», que además publica el
 * nombre de la restricción. Con esto el síntoma es un error de programación
 * con el modo culpable en el mensaje, y la prueba que lo detecta es la del
 * propio repositorio.
 */
function verificarForma(modo: string, fila: CuerpoNuevo): CuerpoNuevo {
  if (MODOS_SIN_CONTENIDO_CRUDO.has(modo)) {
    if (fila.rawContent !== null || fila.binaryFileId !== null) {
      throw new Error(`ck_body_mode_shape: el modo ${modo} exige raw_content y binary_file_id NULL`);
    }
    return fila;
  }
  if (modo === 'binary_file') {
    if (fila.rawContent !== null || fila.binaryFileId === null) {
      throw new Error('ck_body_mode_shape: binary_file exige raw_content NULL y binary_file_id NOT NULL');
    }
    return fila;
  }
  if (fila.binaryFileId !== null) {
    throw new Error(`ck_body_mode_shape: el modo ${modo} exige binary_file_id NULL`);
  }
  return fila;
}

/**
 * `ck_bodyfield_xor`: como mucho UNA fuente de valor por fila. Aquí se
 * garantiza eligiendo según `kind` y poniendo la otra a NULL **de forma
 * explícita**, no por omisión.
 *
 * Los campos secretos no se crean por esta ruta: exigirían `secret_id`, y el
 * cliente no tiene todavía forma de referenciar un secreto. `is_secret` sale
 * siempre `false`, que es lo único que el CHECK permite sin `secret_id`.
 */
function camposDesdeContrato(
  entradas: readonly EntradaCampoDeCuerpo[],
  admiteAdjuntos: boolean,
): CampoDeCuerpoNuevo[] {
  const campos: CampoDeCuerpoNuevo[] = [];
  for (const entrada of entradas) {
    const nombre = entrada.key.trim();
    if (nombre === '') continue;
    const tipo = entrada.kind ?? (entrada.fileId != null ? 'file' : 'text');
    const esFichero = tipo === 'file' && entrada.fileId != null;
    if (esFichero && !admiteAdjuntos) {
      // `form_urlencoded` no puede llevar ficheros por el cable. Se descarta
      // en vez de guardar algo que no se podría enviar nunca.
      continue;
    }
    campos.push({
      fieldName: nombre,
      fieldValue: esFichero ? null : (entrada.value ?? ''),
      fileId: esFichero ? (entrada.fileId ?? null) : null,
      contentType: normalizarContentTypeDeCuerpo(entrada.contentType),
      isSecret: false,
      isEnabled: entrada.enabled !== false,
      sortOrder: 0,
    });
  }
  return campos.map((c, indice) => ({ ...c, sortOrder: indice }));
}

/**
 * Compatibilidad con la fase 6: el texto llega como
 * `application/x-www-form-urlencoded` (`a=1&b=2`), que es la forma en que
 * viaja por el cable y la que el constructor de la web producía.
 */
function camposDesdeTextoUrlencoded(contenido: string | null): CampoDeCuerpoNuevo[] {
  const campos: CampoDeCuerpoNuevo[] = [];
  if (contenido === null || contenido.trim() === '') return campos;
  let indice = 0;
  for (const [nombre, valor] of new URLSearchParams(contenido)) {
    if (nombre.trim() === '') continue;
    campos.push({
      fieldName: nombre,
      fieldValue: valor,
      fileId: null,
      contentType: null,
      isSecret: false,
      isEnabled: true,
      sortOrder: indice,
    });
    indice += 1;
  }
  return campos;
}

/** Un `content_type` con CR/LF acabaría en una cabecera. Se corta aquí. */
function normalizarContentTypeDeCuerpo(bruto: string | null | undefined): string | null {
  if (bruto === null || bruto === undefined) return null;
  // eslint-disable-next-line no-control-regex
  const limpio = bruto.replace(/[\u0000-\u001f\u007f]/gu, '').trim();
  return limpio === '' ? null : limpio.slice(0, 255);
}
