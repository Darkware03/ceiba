import { Inject, Injectable } from '@nestjs/common';
import {
  CLIENTE_PRISMA,
  type InstanciaClientePrisma,
} from '../../platform/persistence/prisma/prisma-client.ts';
import { aBytesDePrisma } from '../../platform/auth/principal.ts';
import type { PermisoDeComparticion } from './share-policy.ts';
import type { EntradaDePublicacion } from './publication.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * Acceso a las CUATRO tablas del bloque 5, ya aplicadas en PostgreSQL:
 * `shared_links`, `share_access_codes`, `share_sessions` y
 * `share_access_attempts`.
 *
 * No se crea ninguna tabla ni se añade ninguna columna. En particular **no se
 * añade ninguna columna capaz de contener el código en claro**, que es la
 * garantía que el esquema da y que la prueba de integridad verifica.
 *
 * El repositorio es la ÚNICA pieza del módulo que habla con Prisma. Los
 * servicios reciben filas ya tipadas, para que la lógica de C-CODE se pueda
 * leer sin consultas por el medio.
 * ════════════════════════════════════════════════════════════════════════════
 */

export type EstadoDeComparticion = 'active' | 'expired' | 'revoked';

export type ResultadoDeIntento =
  | 'success'
  | 'invalid_code'
  | 'expired'
  | 'revoked'
  | 'rate_limited'
  | 'locked_out';

export interface FilaEnlaceCompartido {
  readonly id: string;
  readonly collectionId: string;
  readonly workspaceId: string;
  readonly publicSlug: string;
  readonly requiresAccessCode: boolean;
  readonly permission: PermisoDeComparticion;
  readonly allowExecution: boolean;
  readonly allowExport: boolean;
  readonly includeExamples: boolean;
  readonly state: EstadoDeComparticion;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly maxViews: number | null;
  readonly viewCount: number;
  readonly lastAccessedAt: Date | null;
  readonly createdByUserId: string;
  readonly createdAt: Date;
}

export interface FilaCodigoDeAcceso {
  readonly id: string;
  readonly sharedLinkId: string;
  readonly codeSelector: string;
  readonly codeVerifierHash: Uint8Array;
  readonly hashAlgorithm: string;
  readonly codeHint: string | null;
  readonly label: string | null;
  readonly state: EstadoDeComparticion;
  readonly maxAttempts: number;
  readonly failedAttemptCount: number;
  readonly lockedUntil: Date | null;
  readonly maxUses: number | null;
  readonly useCount: number;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
}

export interface FilaSesionCompartida {
  readonly id: string;
  readonly sharedLinkId: string;
  readonly shareAccessCodeId: string | null;
  readonly permission: PermisoDeComparticion;
  readonly tokenSelector: string;
  readonly tokenVerifierHash: Uint8Array;
  readonly issuedAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly revokedReason: string | null;
}

export interface SesionConEnlace {
  readonly sesion: FilaSesionCompartida;
  readonly enlace: FilaEnlaceCompartido;
  readonly codigo: FilaCodigoDeAcceso | null;
  readonly coleccionBorrada: boolean;
}

export interface DatosNuevoEnlace {
  readonly collectionId: string;
  readonly workspaceId: string;
  readonly publicSlug: string;
  readonly requiresAccessCode: boolean;
  readonly permission: PermisoDeComparticion;
  readonly allowExecution: boolean;
  readonly allowExport: boolean;
  readonly includeExamples: boolean;
  readonly expiresAt: Date | null;
  readonly maxViews: number | null;
  readonly createdByUserId: string;
}

export interface DatosNuevoCodigo {
  readonly sharedLinkId: string;
  readonly codeSelector: string;
  readonly codeVerifierHash: Uint8Array;
  readonly hashParams: Readonly<Record<string, number | string>>;
  readonly codeHint: string | null;
  readonly label: string | null;
  readonly maxAttempts: number;
  readonly maxUses: number | null;
  readonly expiresAt: Date | null;
  readonly rotatedFromCodeId: string | null;
  readonly createdByUserId: string;
}

export interface DatosNuevaSesion {
  readonly sharedLinkId: string;
  readonly shareAccessCodeId: string | null;
  readonly permission: PermisoDeComparticion;
  readonly tokenSelector: string;
  readonly tokenVerifierHash: Uint8Array;
  readonly clientIp: string | null;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export interface DatosDeIntento {
  readonly sharedLinkId: string;
  readonly shareAccessCodeId: string | null;
  readonly result: ResultadoDeIntento;
  readonly clientIp: string | null;
  readonly clientIpPrefix: string | null;
  readonly userAgentHash: Uint8Array | null;
  readonly authenticatedUserId: string | null;
  readonly attemptedAt: Date;
}

export interface FilaDeIntento {
  readonly id: string;
  readonly result: ResultadoDeIntento;
  readonly shareAccessCodeId: string | null;
  readonly clientIpPrefix: string | null;
  readonly attemptedAt: Date;
}

/** `bigint` de PostgreSQL → `number`. Los contadores no se acercan a 2⁵³. */
function aNumero(valor: bigint | number): number {
  return typeof valor === 'bigint' ? Number(valor) : valor;
}

@Injectable()
export class RepositorioDeComparticion {
  constructor(@Inject(CLIENTE_PRISMA) private readonly prisma: InstanciaClientePrisma) {}

  // -------------------------------------------------------------------------
  // Enlaces
  // -------------------------------------------------------------------------

  async crearEnlace(datos: DatosNuevoEnlace, ahora: Date): Promise<FilaEnlaceCompartido> {
    const fila = await this.prisma.sharedLink.create({
      data: {
        collectionId: datos.collectionId,
        workspaceId: datos.workspaceId,
        publicSlug: datos.publicSlug,
        requiresAccessCode: datos.requiresAccessCode,
        permission: datos.permission,
        allowExecution: datos.allowExecution,
        allowExport: datos.allowExport,
        includeExamples: datos.includeExamples,
        state: 'active',
        expiresAt: datos.expiresAt,
        maxViews: datos.maxViews,
        createdByUserId: datos.createdByUserId,
        createdAt: ahora,
        updatedAt: ahora,
      },
    });
    return this.#aFilaEnlace(fila);
  }

  async buscarEnlacePorSlug(slug: string): Promise<FilaEnlaceCompartido | null> {
    const fila = await this.prisma.sharedLink.findUnique({ where: { publicSlug: slug } });
    return fila === null ? null : this.#aFilaEnlace(fila);
  }

  async buscarEnlacePorId(id: string): Promise<FilaEnlaceCompartido | null> {
    const fila = await this.prisma.sharedLink.findUnique({ where: { id } });
    return fila === null ? null : this.#aFilaEnlace(fila);
  }

  /** Para el `ResolutorDeRecurso` de tipo `shared_link` (ADR-0009 §7.4). */
  async workspaceIdDeEnlace(id: string): Promise<string | null> {
    const fila = await this.prisma.sharedLink.findUnique({
      where: { id },
      select: { workspaceId: true },
    });
    return fila?.workspaceId ?? null;
  }

  async listarEnlacesDeColeccion(collectionId: string): Promise<readonly FilaEnlaceCompartido[]> {
    const filas = await this.prisma.sharedLink.findMany({
      where: { collectionId },
      orderBy: { createdAt: 'desc' },
    });
    return filas.map((fila) => this.#aFilaEnlace(fila));
  }

  /** `true` si queda algún enlace activo. Decide si la colección vuelve a `private`. */
  async hayEnlaceActivo(collectionId: string): Promise<boolean> {
    const total = await this.prisma.sharedLink.count({
      where: { collectionId, state: 'active' },
    });
    return total > 0;
  }

  async contarEnlacesActivosQueExigenCodigo(collectionId: string): Promise<number> {
    return this.prisma.sharedLink.count({
      where: { collectionId, state: 'active', requiresAccessCode: true },
    });
  }

  /**
   * C-CODE-06: **revocar el enlace cancela en cascada todas sus sesiones en la
   * misma transacción.** No lo hace la FK: `ON DELETE CASCADE` sólo actúa al
   * BORRAR, y los enlaces se revocan, no se borran.
   */
  async revocarEnlace(
    sharedLinkId: string,
    revocadoPorUsuarioId: string | null,
    motivoDeSesiones: string,
    ahora: Date,
  ): Promise<{ sesionesRevocadas: number; codigosRevocados: number }> {
    return this.prisma.$transaction(async (tx) => {
      await tx.sharedLink.update({
        where: { id: sharedLinkId },
        data: {
          state: 'revoked',
          revokedAt: ahora,
          revokedByUserId: revocadoPorUsuarioId,
          updatedAt: ahora,
        },
      });
      const codigos = await tx.shareAccessCode.updateMany({
        where: { sharedLinkId, revokedAt: null },
        data: { state: 'revoked', revokedAt: ahora, revokedByUserId: revocadoPorUsuarioId },
      });
      const sesiones = await tx.shareSession.updateMany({
        where: { sharedLinkId, revokedAt: null },
        data: { revokedAt: ahora, revokedReason: motivoDeSesiones },
      });
      return { sesionesRevocadas: sesiones.count, codigosRevocados: codigos.count };
    });
  }

  async registrarVista(sharedLinkId: string, ahora: Date): Promise<void> {
    await this.prisma.sharedLink.update({
      where: { id: sharedLinkId },
      data: { viewCount: { increment: 1 }, lastAccessedAt: ahora, updatedAt: ahora },
    });
  }

  // -------------------------------------------------------------------------
  // Códigos de acceso
  // -------------------------------------------------------------------------

  /**
   * Rota el código: crea el nuevo y revoca el anterior **en la misma
   * transacción**, porque `uq_sharecode_one_active` es un índice único parcial
   * sobre `(shared_link_id) WHERE state = 'active'` y rechazaría dos activos.
   *
   * Además cierra las sesiones que abrió el código anterior: sin eso, rotar no
   * echaría a nadie, que es justo para lo que existe `share_access_code_id` y
   * lo que nombra `revoked_reason = 'code_rotated'`.
   */
  async emitirCodigo(
    datos: DatosNuevoCodigo,
    ahora: Date,
  ): Promise<{ codigo: FilaCodigoDeAcceso; sesionesCerradas: number }> {
    return this.prisma.$transaction(async (tx) => {
      const anteriores = await tx.shareAccessCode.findMany({
        where: { sharedLinkId: datos.sharedLinkId, state: 'active' },
        select: { id: true },
      });
      let sesionesCerradas = 0;
      if (anteriores.length > 0) {
        const ids = anteriores.map((fila) => fila.id);
        await tx.shareAccessCode.updateMany({
          where: { id: { in: ids } },
          data: { state: 'revoked', revokedAt: ahora, revokedByUserId: datos.createdByUserId },
        });
        const cerradas = await tx.shareSession.updateMany({
          where: { shareAccessCodeId: { in: ids }, revokedAt: null },
          data: { revokedAt: ahora, revokedReason: 'code_rotated' },
        });
        sesionesCerradas = cerradas.count;
      }
      const fila = await tx.shareAccessCode.create({
        data: {
          sharedLinkId: datos.sharedLinkId,
          codeSelector: datos.codeSelector,
          codeVerifierHash: aBytesDePrisma(datos.codeVerifierHash),
          hashAlgorithm: 'argon2id',
          hashParams: { ...datos.hashParams },
          codeHint: datos.codeHint,
          label: datos.label,
          state: 'active',
          maxAttempts: datos.maxAttempts,
          maxUses: datos.maxUses,
          expiresAt: datos.expiresAt,
          rotatedFromCodeId: datos.rotatedFromCodeId,
          createdByUserId: datos.createdByUserId,
          createdAt: ahora,
        },
      });
      return { codigo: this.#aFilaCodigo(fila), sesionesCerradas };
    });
  }

  /**
   * **La consulta que justifica el patrón selector/verificador.** Una lectura
   * por índice único (`uq_sharecode_selector`) y después **un solo** Argon2id.
   * Con un hash único habría que recorrer y hashear todos los códigos vivos.
   */
  async buscarCodigoPorSelector(selector: string): Promise<FilaCodigoDeAcceso | null> {
    const fila = await this.prisma.shareAccessCode.findUnique({
      where: { codeSelector: selector },
    });
    return fila === null ? null : this.#aFilaCodigo(fila);
  }

  async codigoActivoDeEnlace(sharedLinkId: string): Promise<FilaCodigoDeAcceso | null> {
    const fila = await this.prisma.shareAccessCode.findFirst({
      where: { sharedLinkId, state: 'active' },
      orderBy: { createdAt: 'desc' },
    });
    return fila === null ? null : this.#aFilaCodigo(fila);
  }

  async listarCodigosDeEnlace(sharedLinkId: string): Promise<readonly FilaCodigoDeAcceso[]> {
    const filas = await this.prisma.shareAccessCode.findMany({
      where: { sharedLinkId },
      orderBy: { createdAt: 'desc' },
    });
    return filas.map((fila) => this.#aFilaCodigo(fila));
  }

  async revocarCodigo(
    codigoId: string,
    revocadoPorUsuarioId: string | null,
    ahora: Date,
  ): Promise<number> {
    const resultado = await this.prisma.$transaction(async (tx) => {
      await tx.shareAccessCode.update({
        where: { id: codigoId },
        data: { state: 'revoked', revokedAt: ahora, revokedByUserId: revocadoPorUsuarioId },
      });
      return tx.shareSession.updateMany({
        where: { shareAccessCodeId: codigoId, revokedAt: null },
        data: { revokedAt: ahora, revokedReason: 'code_revoked' },
      });
    });
    return resultado.count;
  }

  /**
   * Mirror DURABLE del contador de fallos. El `RateLimitStore` en memoria es la
   * puerta rápida; esta fila es la que sobrevive a un reinicio del proceso y la
   * que ve el propietario.
   */
  async anotarFalloEnCodigo(
    codigoId: string,
    bloqueadoHasta: Date | null,
  ): Promise<void> {
    await this.prisma.shareAccessCode.update({
      where: { id: codigoId },
      data: { failedAttemptCount: { increment: 1 }, lockedUntil: bloqueadoHasta },
    });
  }

  async anotarUsoDeCodigo(codigoId: string, ahora: Date): Promise<void> {
    await this.prisma.shareAccessCode.update({
      where: { id: codigoId },
      data: {
        useCount: { increment: 1 },
        lastUsedAt: ahora,
        failedAttemptCount: 0,
        lockedUntil: null,
      },
    });
  }

  // -------------------------------------------------------------------------
  // Sesiones de compartición
  // -------------------------------------------------------------------------

  async crearSesion(datos: DatosNuevaSesion): Promise<FilaSesionCompartida> {
    const fila = await this.prisma.shareSession.create({
      data: {
        sharedLinkId: datos.sharedLinkId,
        shareAccessCodeId: datos.shareAccessCodeId,
        permission: datos.permission,
        tokenSelector: datos.tokenSelector,
        tokenVerifierHash: aBytesDePrisma(datos.tokenVerifierHash),
        clientIp: datos.clientIp,
        issuedAt: datos.issuedAt,
        lastSeenAt: datos.issuedAt,
        expiresAt: datos.expiresAt,
      },
    });
    return this.#aFilaSesion(fila);
  }

  /**
   * Trae la sesión **con su enlace y su código** en una sola consulta, que es
   * lo que exigen las siete comprobaciones por petición de C-CODE-06. Hacerlo
   * en tres viajes abriría una ventana entre ellas.
   */
  async buscarSesionPorSelector(selector: string): Promise<SesionConEnlace | null> {
    const fila = await this.prisma.shareSession.findUnique({
      where: { tokenSelector: selector },
      include: {
        sharedLink: { include: { collection: { select: { deletedAt: true } } } },
        shareAccessCode: true,
      },
    });
    if (fila === null) return null;
    return {
      sesion: this.#aFilaSesion(fila),
      enlace: this.#aFilaEnlace(fila.sharedLink),
      codigo: fila.shareAccessCode === null ? null : this.#aFilaCodigo(fila.shareAccessCode),
      coleccionBorrada: fila.sharedLink.collection.deletedAt !== null,
    };
  }

  async tocarSesion(sesionId: string, ahora: Date): Promise<void> {
    await this.prisma.shareSession.update({
      where: { id: sesionId },
      data: { lastSeenAt: ahora },
    });
  }

  async revocarSesion(sesionId: string, motivo: string, ahora: Date): Promise<void> {
    await this.prisma.shareSession.updateMany({
      where: { id: sesionId, revokedAt: null },
      data: { revokedAt: ahora, revokedReason: motivo },
    });
  }

  async contarSesionesVivas(sharedLinkId: string, ahora: Date): Promise<number> {
    return this.prisma.shareSession.count({
      where: { sharedLinkId, revokedAt: null, expiresAt: { gt: ahora } },
    });
  }

  // -------------------------------------------------------------------------
  // Intentos — LA AUDITORÍA DEL PROPIETARIO (requisito 2)
  // -------------------------------------------------------------------------

  /**
   * Escribe el motivo REAL del rechazo. Es el único sitio donde la causa se
   * distingue; la respuesta HTTP no la distingue nunca (C-CODE-04).
   *
   * **No guarda el código intentado**, ni entero ni parcial: el esquema lo dice
   * y es correcto, registrar el valor probado convertiría el log de seguridad
   * en un diccionario de códigos.
   */
  async registrarIntento(datos: DatosDeIntento): Promise<void> {
    await this.prisma.shareAccessAttempt.create({
      data: {
        sharedLinkId: datos.sharedLinkId,
        shareAccessCodeId: datos.shareAccessCodeId,
        result: datos.result,
        clientIp: datos.clientIp,
        clientIpPrefix: datos.clientIpPrefix,
        userAgentHash:
          datos.userAgentHash === null ? null : aBytesDePrisma(datos.userAgentHash),
        authenticatedUserId: datos.authenticatedUserId,
        attemptedAt: datos.attemptedAt,
      },
    });
  }

  async listarIntentos(
    sharedLinkId: string,
    limite: number,
  ): Promise<readonly FilaDeIntento[]> {
    const filas = await this.prisma.shareAccessAttempt.findMany({
      where: { sharedLinkId },
      orderBy: { attemptedAt: 'desc' },
      take: limite,
    });
    return filas.map((fila) => ({
      id: fila.id.toString(),
      result: fila.result as ResultadoDeIntento,
      shareAccessCodeId: fila.shareAccessCodeId,
      clientIpPrefix: fila.clientIpPrefix,
      attemptedAt: fila.attemptedAt,
    }));
  }

  async contarFallosDesde(sharedLinkId: string, desde: Date): Promise<number> {
    return this.prisma.shareAccessAttempt.count({
      where: {
        sharedLinkId,
        attemptedAt: { gte: desde },
        result: { in: ['invalid_code', 'expired', 'revoked', 'locked_out'] },
      },
    });
  }

  // -------------------------------------------------------------------------
  // Colección publicable
  // -------------------------------------------------------------------------

  /**
   * Lee **sólo** lo publicable. Nótese lo que NO aparece en ningún `select`:
   * `environments`, `environment_variables`, `secrets`, `auth_credentials` ni
   * `client_certificates`. La frontera empieza aquí, en la consulta, no en la
   * serialización: lo que no se lee no se puede filtrar por descuido.
   */
  async leerColeccionPublicable(
    collectionId: string,
    incluirEjemplos: boolean,
  ): Promise<EntradaDePublicacion | null> {
    const coleccion = await this.prisma.collection.findFirst({
      where: { id: collectionId, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        visibility: true,
        defaultAuthMode: true,
        defaultTimeoutMs: true,
        variablesDoc: true,
        requestCount: true,
        updatedAt: true,
      },
    });
    if (coleccion === null) return null;

    const carpetas = await this.prisma.collectionFolder.findMany({
      where: { collectionId, deletedAt: null },
      select: {
        id: true,
        parentFolderId: true,
        name: true,
        description: true,
        depth: true,
        sortKey: true,
      },
    });

    const solicitudes = await this.prisma.apiRequest.findMany({
      where: { collectionId, deletedAt: null },
      select: {
        id: true,
        folderId: true,
        name: true,
        description: true,
        method: true,
        methodCustom: true,
        urlTemplate: true,
        bodyMode: true,
        authMode: true,
        timeoutMs: true,
        sortKey: true,
        preRequestScript: true,
        postResponseScript: true,
        requestHeaders: {
          select: {
            name: true,
            value: true,
            secretId: true,
            description: true,
            isSecret: true,
            isEnabled: true,
            sortOrder: true,
          },
        },
        requestParams: {
          select: {
            kind: true,
            name: true,
            value: true,
            secretId: true,
            description: true,
            isSecret: true,
            isEnabled: true,
            sortOrder: true,
          },
        },
        requestBodies: {
          select: {
            mode: true,
            contentType: true,
            rawContent: true,
            requestBodyFields: {
              select: {
                fieldName: true,
                fieldValue: true,
                secretId: true,
                fileId: true,
                contentType: true,
                isSecret: true,
                isEnabled: true,
                sortOrder: true,
              },
            },
          },
        },
      },
    });

    return { coleccion, carpetas, solicitudes, incluirEjemplos };
  }

  async buscarSolicitudDeColeccion(
    collectionId: string,
    requestId: string,
  ): Promise<string | null> {
    const fila = await this.prisma.apiRequest.findFirst({
      where: { id: requestId, collectionId, deletedAt: null },
      select: { id: true },
    });
    return fila?.id ?? null;
  }

  /** Modo de visibilidad de la colección. Lo fija el propietario, no el enlace. */
  async fijarVisibilidad(
    collectionId: string,
    visibilidad: 'private' | 'link_public' | 'link_private',
    ahora: Date,
  ): Promise<void> {
    await this.prisma.collection.update({
      where: { id: collectionId },
      data: { visibility: visibilidad, updatedAt: ahora },
    });
  }

  async leerVisibilidad(collectionId: string): Promise<string | null> {
    const fila = await this.prisma.collection.findFirst({
      where: { id: collectionId, deletedAt: null },
      select: { visibility: true },
    });
    return fila?.visibility ?? null;
  }

  // -------------------------------------------------------------------------
  // Conversión de filas
  // -------------------------------------------------------------------------

  #aFilaEnlace(fila: {
    id: string;
    collectionId: string;
    workspaceId: string;
    publicSlug: string;
    requiresAccessCode: boolean;
    permission: string;
    allowExecution: boolean;
    allowExport: boolean;
    includeExamples: boolean;
    state: string;
    expiresAt: Date | null;
    revokedAt: Date | null;
    maxViews: number | null;
    viewCount: bigint;
    lastAccessedAt: Date | null;
    createdByUserId: string;
    createdAt: Date;
  }): FilaEnlaceCompartido {
    return {
      id: fila.id,
      collectionId: fila.collectionId,
      workspaceId: fila.workspaceId,
      publicSlug: fila.publicSlug,
      requiresAccessCode: fila.requiresAccessCode,
      permission: fila.permission as PermisoDeComparticion,
      allowExecution: fila.allowExecution,
      allowExport: fila.allowExport,
      includeExamples: fila.includeExamples,
      state: fila.state as EstadoDeComparticion,
      expiresAt: fila.expiresAt,
      revokedAt: fila.revokedAt,
      maxViews: fila.maxViews,
      viewCount: aNumero(fila.viewCount),
      lastAccessedAt: fila.lastAccessedAt,
      createdByUserId: fila.createdByUserId,
      createdAt: fila.createdAt,
    };
  }

  #aFilaCodigo(fila: {
    id: string;
    sharedLinkId: string;
    codeSelector: string;
    codeVerifierHash: Uint8Array;
    hashAlgorithm: string;
    codeHint: string | null;
    label: string | null;
    state: string;
    maxAttempts: number;
    failedAttemptCount: number;
    lockedUntil: Date | null;
    maxUses: number | null;
    useCount: bigint;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
    lastUsedAt: Date | null;
  }): FilaCodigoDeAcceso {
    return {
      id: fila.id,
      sharedLinkId: fila.sharedLinkId,
      codeSelector: fila.codeSelector,
      codeVerifierHash: fila.codeVerifierHash,
      hashAlgorithm: fila.hashAlgorithm,
      codeHint: fila.codeHint,
      label: fila.label,
      state: fila.state as EstadoDeComparticion,
      maxAttempts: fila.maxAttempts,
      failedAttemptCount: fila.failedAttemptCount,
      lockedUntil: fila.lockedUntil,
      maxUses: fila.maxUses,
      useCount: aNumero(fila.useCount),
      expiresAt: fila.expiresAt,
      revokedAt: fila.revokedAt,
      createdAt: fila.createdAt,
      lastUsedAt: fila.lastUsedAt,
    };
  }

  #aFilaSesion(fila: {
    id: string;
    sharedLinkId: string;
    shareAccessCodeId: string | null;
    permission: string;
    tokenSelector: string;
    tokenVerifierHash: Uint8Array;
    issuedAt: Date;
    lastSeenAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
    revokedReason: string | null;
  }): FilaSesionCompartida {
    return {
      id: fila.id,
      sharedLinkId: fila.sharedLinkId,
      shareAccessCodeId: fila.shareAccessCodeId,
      permission: fila.permission as PermisoDeComparticion,
      tokenSelector: fila.tokenSelector,
      tokenVerifierHash: fila.tokenVerifierHash,
      issuedAt: fila.issuedAt,
      lastSeenAt: fila.lastSeenAt,
      expiresAt: fila.expiresAt,
      revokedAt: fila.revokedAt,
      revokedReason: fila.revokedReason,
    };
  }
}
