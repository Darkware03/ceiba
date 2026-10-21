import { Inject, Injectable } from '@nestjs/common';
import {
  CLIENTE_PRISMA,
  type InstanciaClientePrisma,
} from '../../platform/persistence/prisma/prisma-client.ts';
import { MODOS_CRUDOS, MODOS_DE_FORMULARIO } from './dto/request.dto.ts';

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
    const cuerpo = construirCuerpo(datos.bodyType, datos.body);

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
    cambios: Partial<DatosDePeticion> & { readonly bodyTypePresente: boolean },
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

      if (cambios.bodyTypePresente || cambios.body !== undefined) {
        const actual = await tx.apiRequest.findUnique({
          where: { id: peticionId },
          select: { bodyMode: true, requestBodies: { select: { id: true, rawContent: true } } },
        });
        const modo = String(actual?.bodyMode ?? 'none');
        const crudoPrevio = actual?.requestBodies?.rawContent ?? null;
        const contenido = cambios.body !== undefined ? cambios.body : crudoPrevio;
        const nuevo = construirCuerpo(modo, contenido ?? null);

        await tx.requestBody.deleteMany({ where: { apiRequestId: peticionId } });
        if (nuevo !== null) {
          await tx.requestBody.create({ data: { ...nuevo, apiRequestId: peticionId } });
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
  isSecret: boolean;
  isEnabled: boolean;
  sortOrder: number;
}

interface CuerpoNuevo {
  mode: 'none';
  contentType: string | null;
  rawContent: string | null;
  requestBodyFields?: { create: CampoDeCuerpoNuevo[] };
}

/**
 * Traduce `bodyType` + `body` a la fila de `request_bodies` que
 * `ck_body_mode_shape` admite:
 *
 *  - modos `raw_*`/`graphql` → `raw_content`.
 *  - modos de formulario     → `raw_content` NULL y el contenido desgranado en
 *    `request_body_fields`. El texto se interpreta como
 *    `application/x-www-form-urlencoded` (`a=1&b=2`), que es la forma en que
 *    viaja por el cable y la que el constructor de la web ya produce.
 *  - `none`                  → no hay fila.
 */
export function construirCuerpo(modo: string, contenido: string | null): CuerpoNuevo | null {
  if (modo === 'none') return null;

  if (MODOS_CRUDOS.has(modo)) {
    if (contenido === null || contenido === '') return null;
    return { mode: modo as 'none', contentType: null, rawContent: contenido };
  }

  if (MODOS_DE_FORMULARIO.has(modo)) {
    const campos: CampoDeCuerpoNuevo[] = [];
    if (contenido !== null && contenido.trim() !== '') {
      let indice = 0;
      for (const [nombre, valor] of new URLSearchParams(contenido)) {
        if (nombre.trim() === '') continue;
        campos.push({
          fieldName: nombre,
          fieldValue: valor,
          isSecret: false,
          isEnabled: true,
          sortOrder: indice,
        });
        indice += 1;
      }
    }
    return {
      mode: modo as 'none',
      contentType: null,
      rawContent: null,
      ...(campos.length > 0 ? { requestBodyFields: { create: campos } } : {}),
    };
  }

  // `binary_file` y `custom` no llegan aquí: el DTO los rechaza con 422.
  return null;
}
