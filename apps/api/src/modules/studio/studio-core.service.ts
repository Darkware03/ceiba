import { CLIENTE_PRISMA } from '../../platform/persistence/prisma/prisma-client.ts';
import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';

import {
  ACCION_AUDITORIA,
  SERVICIO_DE_AUDITORIA,
  type ServicioDeAuditoria,
} from '../../platform/audit/ports.js';
import type { Principal as PrincipalAutenticado } from '../../platform/auth/principal.js';
import { CONFIGURACION_APP, type ConfiguracionDeApp as ConfigAplicacion } from '../../platform/config/app-config.js';
import {
  ConflictoDeEstado as ErrorConflicto,
  RecursoNoEncontrado as ErrorNoEncontrado,
  DatosDeEntradaInvalidos as ErrorValidacion,
} from '../../platform/errors/domain-errors.js';
import { PrismaClientService as ClientePrisma } from '../../platform/persistence/prisma/prisma-client.js';
import { StudioCollaborationService } from './studio-collab.service.js';

export interface VariableEntornoInput {
  key: string;
  value: string;
  enabled?: boolean;
  isSecret?: boolean;
  description?: string | null;
}

export interface EjecutarPeticionInput {
  requestId?: string | null;
  collectionId?: string | null;
  environmentId?: string | null;
  method: string;
  url: string;
  headers?: Array<{ key: string; value: string; enabled?: boolean }>;
  queryParams?: Array<{ key: string; value: string; enabled?: boolean }>;
  bodyType?: string;
  body?: string | null;
  timeoutMs?: number;
}

@Injectable()
export class StudioService {
  constructor(
    @Inject(CLIENTE_PRISMA) private readonly prisma: ClientePrisma,
    @Inject(CONFIGURACION_APP) private readonly config: ConfigAplicacion,
    @Inject(StudioCollaborationService) private readonly collab: StudioCollaborationService,
    @Inject(SERVICIO_DE_AUDITORIA)
    private readonly auditoria: ServicioDeAuditoria,
  ) {}

  // =========================================================================
  // 1. ENTORNOS Y VARIABLES
  // =========================================================================

  async listarEntornos(workspaceId: string, principal: PrincipalAutenticado) {
    await this.collab.verificarRolMinimo(workspaceId, principal, 'viewer');

    const envs = await this.prisma.client.environment.findMany({
      where: { workspaceId },
      include: {
        variables: {
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });

    return envs.map((env) => ({
      id: env.id,
      workspaceId: env.workspaceId,
      name: env.name,
      slug: env.slug,
      description: env.description,
      color: env.color,
      isDefault: env.isDefault,
      createdAt: env.createdAt.toISOString(),
      updatedAt: env.updatedAt.toISOString(),
      variables: env.variables.map((v) => ({
        id: v.id,
        key: v.key,
        value: v.valuePlaintext ?? '',
        isSecret: v.isSecret,
        enabled: v.enabled,
        description: v.description,
      })),
    }));
  }

  async crearEntorno(
    workspaceId: string,
    input: {
      name: string;
      description?: string | null;
      color?: string | null;
      isDefault?: boolean;
      variables?: VariableEntornoInput[];
    },
    principal: PrincipalAutenticado,
  ) {
    await this.collab.verificarRolMinimo(workspaceId, principal, 'editor');

    const nombre = input.name?.trim();
    if (!nombre) {
      throw new ErrorValidacion('El nombre del entorno es obligatorio.');
    }

    const baseSlug = nombre
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'entorno';
    const slug = `${baseSlug}-${ Date.now().toString(36).slice(-4) }`;

    const creado = await this.prisma.client.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.environment.updateMany({
          where: { workspaceId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.environment.create({
        data: {
          workspaceId,
          name: nombre,
          slug,
          description: input.description ?? null,
          color: input.color ?? '#0ea5e9',
          isDefault: Boolean(input.isDefault),
          createdByUserId: principal.userId,
          variables: {
            create: (input.variables ?? [])
              .filter((v) => v.key?.trim())
              .map((v, idx) => ({
                key: v.key.trim(),
                valuePlaintext: v.value ?? '',
                isSecret: false,
                enabled: v.enabled ?? true,
                description: v.description ?? null,
                sortOrder: idx,
              })),
          },
        },
        include: { variables: { orderBy: { sortOrder: 'asc' } } },
      });
    });

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.ENTORNO_CREADO,
      actorUserId: principal.userId,
      workspaceId,
      recursoTipo: 'environment',
      recursoId: creado.id,
      detalles: {
        name: creado.name,
        variablesCount: creado.variables.length,
      },
    });

    return {
      id: creado.id,
      workspaceId: creado.workspaceId,
      name: creado.name,
      slug: creado.slug,
      description: creado.description,
      color: creado.color,
      isDefault: creado.isDefault,
      createdAt: creado.createdAt.toISOString(),
      updatedAt: creado.updatedAt.toISOString(),
      variables: creado.variables.map((v) => ({
        id: v.id,
        key: v.key,
        value: v.valuePlaintext ?? '',
        isSecret: v.isSecret,
        enabled: v.enabled,
        description: v.description,
      })),
    };
  }

  async actualizarEntorno(
    environmentId: string,
    input: {
      name?: string;
      description?: string | null;
      color?: string | null;
      isDefault?: boolean;
      variables?: VariableEntornoInput[];
    },
    principal: PrincipalAutenticado,
  ) {
    const actual = await this.prisma.client.environment.findUnique({
      where: { id: environmentId },
    });
    if (!actual) {
      throw new ErrorNoEncontrado('El entorno no existe.');
    }

    await this.collab.verificarRolMinimo(actual.workspaceId, principal, 'editor');

    const actualizado = await this.prisma.client.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.environment.updateMany({
          where: { workspaceId: actual.workspaceId, isDefault: true },
          data: { isDefault: false },
        });
      }

      if (input.variables !== undefined) {
        await tx.environmentVariable.deleteMany({
          where: { environmentId },
        });
      }

      return tx.environment.update({
        where: { id: environmentId },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
          ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
          ...(input.variables !== undefined
            ? {
                variables: {
                  create: input.variables
                    .filter((v) => v.key?.trim())
                    .map((v, idx) => ({
                      key: v.key.trim(),
                      valuePlaintext: v.value ?? '',
                      isSecret: false,
                      enabled: v.enabled ?? true,
                      description: v.description ?? null,
                      sortOrder: idx,
                    })),
                },
              }
            : {}),
        },
        include: { variables: { orderBy: { sortOrder: 'asc' } } },
      });
    });

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.ENTORNO_ACTUALIZADO,
      actorUserId: principal.userId,
      workspaceId: actual.workspaceId,
      recursoTipo: 'environment',
      recursoId: actualizado.id,
      detalles: {
        name: actualizado.name,
        variablesCount: actualizado.variables.length,
      },
    });

    return {
      id: actualizado.id,
      workspaceId: actualizado.workspaceId,
      name: actualizado.name,
      slug: actualizado.slug,
      description: actualizado.description,
      color: actualizado.color,
      isDefault: actualizado.isDefault,
      createdAt: actualizado.createdAt.toISOString(),
      updatedAt: actualizado.updatedAt.toISOString(),
      variables: actualizado.variables.map((v) => ({
        id: v.id,
        key: v.key,
        value: v.valuePlaintext ?? '',
        isSecret: v.isSecret,
        enabled: v.enabled,
        description: v.description,
      })),
    };
  }

  async eliminarEntorno(environmentId: string, principal: PrincipalAutenticado) {
    const actual = await this.prisma.client.environment.findUnique({
      where: { id: environmentId },
    });
    if (!actual) {
      throw new ErrorNoEncontrado('El entorno no existe.');
    }

    await this.collab.verificarRolMinimo(actual.workspaceId, principal, 'editor');

    await this.prisma.client.environment.delete({
      where: { id: environmentId },
    });

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.ENTORNO_ELIMINADO,
      actorUserId: principal.userId,
      workspaceId: actual.workspaceId,
      recursoTipo: 'environment',
      recursoId: actual.id,
      detalles: { name: actual.name },
    });
  }

  private interpolar(texto: string, mapa: Map<string, string>): string {
    return texto.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, clave: string) => {
      return mapa.has(clave) ? (mapa.get(clave) ?? '') : match;
    });
  }

  // =========================================================================
  // 2. EJECUCIÓN DE PETICIÓN HTTP Y REGISTRO EN HISTORIAL
  // =========================================================================

  async ejecutarPeticion(
    workspaceId: string,
    input: EjecutarPeticionInput,
    principal: PrincipalAutenticado,
  ) {
    await this.collab.verificarRolMinimo(workspaceId, principal, 'viewer');

    const variables = new Map<string, string>();
    if (input.environmentId) {
      const env = await this.prisma.client.environment.findFirst({
        where: { id: input.environmentId, workspaceId },
        include: { variables: { where: { enabled: true } } },
      });
      if (env) {
        for (const v of env.variables) {
          variables.set(v.key, v.valuePlaintext ?? '');
        }
      }
    } else {
      const defaultEnv = await this.prisma.client.environment.findFirst({
        where: { workspaceId, isDefault: true },
        include: { variables: { where: { enabled: true } } },
      });
      if (defaultEnv) {
        for (const v of defaultEnv.variables) {
          variables.set(v.key, v.valuePlaintext ?? '');
        }
      }
    }

    const metodo = (input.method || 'GET').toUpperCase();
    let urlFinal = this.interpolar(input.url.trim(), variables);

    const queryActivos = (input.queryParams ?? []).filter((q) => q.enabled !== false && q.key.trim());
    if (queryActivos.length > 0) {
      try {
        const parsed = new URL(urlFinal);
        for (const q of queryActivos) {
          parsed.searchParams.append(
            this.interpolar(q.key.trim(), variables),
            this.interpolar(q.value ?? '', variables),
          );
        }
        urlFinal = parsed.toString();
      } catch {
        // URL inválida la reportará el motor
      }
    }

    const headersActivos = (input.headers ?? [])
      .filter((h) => h.enabled !== false && h.key.trim())
      .map((h) => ({
        name: this.interpolar(h.key.trim(), variables),
        value: this.interpolar(h.value ?? '', variables),
      }));

    const cuerpoInterpolado =
      input.body && input.bodyType !== 'none'
        ? this.interpolar(input.body, variables)
        : undefined;

    const enginePayload = {
      method: metodo,
      url: urlFinal,
      headers: headersActivos,
      ...(cuerpoInterpolado !== undefined
        ? {
            body: {
              kind: 'utf8',
              text: cuerpoInterpolado,
            },
          }
        : {}),
      timeoutMs: Math.min(Math.max(input.timeoutMs ?? 15000, 500), 30000),
      followRedirects: true,
    };

    const inicio = Date.now();
    let engineRes: Record<string, unknown>;
    try {
      const engineBaseUrl = this.config.engine?.url ?? 'http://engine:3001';
      const engineAuthToken = this.config.engine?.token ?? '';
      const res = await fetch(`${engineBaseUrl.replace(/\/$/, '')}/v1/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ceiba-engine-token': engineAuthToken,
        },
        body: JSON.stringify(enginePayload),
      });
      engineRes = (await res.json()) as Record<string, unknown>;
    } catch (err) {
      const durationMs = Date.now() - inicio;
      engineRes = {
        ok: false,
        error: {
          code: 'ENGINE_UNREACHABLE',
          message: err instanceof Error ? err.message : 'Error contactando al motor HTTP',
          durationMs,
        },
      };
    }

    const esOk = engineRes.ok === true;
    const duracionMs = esOk
      ? Number((engineRes.timings as Record<string, unknown> | undefined)?.totalMs ?? Date.now() - inicio)
      : Number((engineRes.error as Record<string, unknown> | undefined)?.durationMs ?? Date.now() - inicio);

    const statusHttp = esOk ? Number(engineRes.status ?? 0) : null;
    const responseBodyObj = (engineRes.body ?? null) as Record<string, unknown> | null;
    const responseSizeBytes = esOk ? Number(responseBodyObj?.byteLength ?? 0) : 0;
    const errorCode = !esOk ? String((engineRes.error as Record<string, unknown> | undefined)?.code ?? 'EXECUTION_ERROR') : null;

    let validRequestId: string | null = null;
    if (input.requestId) {
      const reqRow = await this.prisma.client.apiRequest.findFirst({
        where: { id: input.requestId, collection: { workspaceId } },
        select: { id: true },
      });
      validRequestId = reqRow?.id ?? null;
    }

    const hist = await this.prisma.client.requestHistory.create({
      data: {
        workspaceId,
        userId: principal.userId,
        requestId: validRequestId,
        environmentId: input.environmentId ?? null,
        method: metodo as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS',
        resolvedUrl: urlFinal,
        requestSnapshot: {
          method: metodo,
          url: urlFinal,
          headers: headersActivos,
          bodyType: input.bodyType ?? 'none',
          bodyPreview: cuerpoInterpolado ? cuerpoInterpolado.slice(0, 2000) : null,
        },
        responseStatus: statusHttp,
        responseHeaders: esOk ? ((engineRes.headers ?? []) as object) : undefined,
        responseBodyPreview: esOk ? String(responseBodyObj?.text ?? '').slice(0, 16000) : null,
        responseSizeBytes,
        durationMs: Math.max(0, Math.round(duracionMs)),
        errorCode,
      },
    });

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.PETICION_EJECUTADA,
      actorUserId: principal.userId,
      workspaceId,
      recursoTipo: 'request_execution',
      recursoId: validRequestId ?? hist.id.toString(),
      detalles: {
        method: metodo,
        url: urlFinal,
        status: statusHttp,
        durationMs: Math.round(duracionMs),
        ok: esOk,
      },
    });

    if (!esOk) {
      const errObj = (engineRes.error ?? {}) as Record<string, unknown>;
      return {
        historyId: hist.id.toString(),
        exito: false,
        codigoEstado: 0,
        textoEstado: String(errObj.code ?? 'ERROR'),
        cabeceras: [],
        cuerpoTexto: String(errObj.message ?? 'Fallo al ejecutar la petición'),
        tipoContenido: 'text/plain',
        tamanoBytes: 0,
        truncado: false,
        tiempos: { totalMs: Math.round(duracionMs) },
        urlFinal,
        redirecciones: 0,
        errorCodigo: String(errObj.code ?? 'EXECUTION_ERROR'),
        errorMensaje: String(errObj.message ?? 'Fallo al ejecutar la petición'),
      };
    }

    const headersRaw = Array.isArray(engineRes.headers) ? engineRes.headers : [];
    const contentTypeHeader = headersRaw.find(
      (h: { name?: string; value?: string }) => h.name?.toLowerCase() === 'content-type',
    );

    return {
      historyId: hist.id.toString(),
      exito: true,
      codigoEstado: statusHttp ?? 200,
      textoEstado: String(engineRes.statusText ?? 'OK'),
      cabeceras: headersRaw.map((h: { name?: string; value?: string }) => ({
        clave: String(h.name ?? ''),
        valor: String(h.value ?? ''),
      })),
      cuerpoTexto: String(responseBodyObj?.text ?? ''),
      tipoContenido: String(contentTypeHeader?.value ?? 'text/plain'),
      tamanoBytes: responseSizeBytes,
      truncado: Boolean(responseBodyObj?.truncated),
      tiempos: {
        totalMs: Math.round(duracionMs),
        ttfbMs: Number((engineRes.timings as Record<string, unknown> | undefined)?.ttfbMs ?? duracionMs),
      },
      urlFinal: String(engineRes.finalUrl ?? urlFinal),
      redirecciones: Number(engineRes.redirects ?? 0),
    };
  }

  async listarHistorialPeticiones(
    workspaceId: string,
    principal: PrincipalAutenticado,
    limit = 60,
  ) {
    await this.collab.verificarRolMinimo(workspaceId, principal, 'viewer');

    const rows = await this.prisma.client.requestHistory.findMany({
      where: { workspaceId },
      include: {
        user: { select: { id: true, email: true, displayName: true } },
        request: { select: { id: true, name: true } },
      },
      orderBy: { executedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });

    return rows.map((r) => ({
      id: r.id.toString(),
      workspaceId: r.workspaceId,
      method: r.method,
      resolvedUrl: r.resolvedUrl,
      responseStatus: r.responseStatus,
      responseSizeBytes: r.responseSizeBytes,
      durationMs: r.durationMs,
      errorCode: r.errorCode,
      executedAt: r.executedAt.toISOString(),
      user: r.user,
      request: r.request,
      requestSnapshot: r.requestSnapshot,
      responseBodyPreview: r.responseBodyPreview,
    }));
  }

  // =========================================================================
  // 3. EJECUCIONES DE COLECCIONES (COLLECTION RUNNER)
  // =========================================================================

  async ejecutarColeccion(
    workspaceId: string,
    collectionId: string,
    environmentId: string | null | undefined,
    principal: PrincipalAutenticado,
  ) {
    await this.collab.verificarRolMinimo(workspaceId, principal, 'executor');

    const coleccion = await this.prisma.client.collection.findFirst({
      where: { id: collectionId, workspaceId, deletedAt: null },
      include: {
        requests: {
          where: { deletedAt: null },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    if (!coleccion) {
      throw new ErrorNoEncontrado('La colección no existe en este espacio.');
    }

    const run = await this.prisma.client.collectionRun.create({
      data: {
        workspaceId,
        collectionId: coleccion.id,
        environmentId: environmentId ?? null,
        triggeredByUserId: principal.userId,
        status: 'running',
        totalRequests: coleccion.requests.length,
        startedAt: new Date(),
      },
    });

    let passed = 0;
    let failed = 0;
    const resultados: Array<Record<string, unknown>> = [];

    for (let i = 0; i < coleccion.requests.length; i++) {
      const req = coleccion.requests[i]!;
      const headersArr = Array.isArray(req.headers)
        ? (req.headers as Array<{ key: string; value: string; enabled?: boolean }>)
        : [];
      const queryArr = Array.isArray(req.queryParams)
        ? (req.queryParams as Array<{ key: string; value: string; enabled?: boolean }>)
        : [];
      const bodyRaw =
        typeof req.body === 'object' && req.body !== null && 'raw' in (req.body as Record<string, unknown>)
          ? String((req.body as Record<string, unknown>).raw ?? '')
          : typeof req.body === 'string'
            ? req.body
            : null;

      const res = await this.ejecutarPeticion(
        workspaceId,
        {
          requestId: req.id,
          collectionId: coleccion.id,
          environmentId: environmentId ?? null,
          method: req.method,
          url: req.url,
          headers: headersArr,
          queryParams: queryArr,
          bodyType: req.bodyType,
          body: bodyRaw,
        },
        principal,
      );

      const exitoItem = res.exito && res.codigoEstado >= 200 && res.codigoEstado < 400;
      if (exitoItem) {
        passed++;
      } else {
        failed++;
      }

      await this.prisma.client.collectionRunItem.create({
        data: {
          collectionRunId: run.id,
          requestId: req.id,
          executionOrder: i + 1,
          status: exitoItem ? 'passed' : 'failed',
          responseStatus: res.codigoEstado || null,
          durationMs: res.tiempos?.totalMs ?? 0,
          assertionsPassed: exitoItem ? 1 : 0,
          assertionsFailed: exitoItem ? 0 : 1,
          errorMessage: res.errorMensaje ?? null,
        },
      });

      resultados.push({
        requestId: req.id,
        name: req.name,
        method: req.method,
        url: res.urlFinal,
        status: res.codigoEstado,
        durationMs: res.tiempos?.totalMs ?? 0,
        passed: exitoItem,
        error: res.errorMensaje ?? null,
      });
    }

    const estadoFinal = failed > 0 && passed === 0 && coleccion.requests.length > 0 ? 'failed' : 'completed';

    const finalizado = await this.prisma.client.collectionRun.update({
      where: { id: run.id },
      data: {
        status: estadoFinal,
        passedRequests: passed,
        failedRequests: failed,
        finishedAt: new Date(),
        summary: { items: resultados },
      },
      include: {
        collection: { select: { id: true, name: true } },
        environment: { select: { id: true, name: true } },
        triggeredBy: { select: { id: true, email: true, displayName: true } },
      },
    });

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.COLECCION_EJECUTADA,
      actorUserId: principal.userId,
      workspaceId,
      recursoTipo: 'collection_run',
      recursoId: finalizado.id,
      detalles: {
        collectionId: coleccion.id,
        collectionName: coleccion.name,
        totalRequests: finalizado.totalRequests,
        passedRequests: passed,
        failedRequests: failed,
      },
    });

    return {
      id: finalizado.id,
      collection: finalizado.collection,
      environment: finalizado.environment,
      triggeredBy: finalizado.triggeredBy,
      status: finalizado.status,
      totalRequests: finalizado.totalRequests,
      passedRequests: finalizado.passedRequests,
      failedRequests: finalizado.failedRequests,
      startedAt: finalizado.startedAt?.toISOString() ?? finalizado.createdAt.toISOString(),
      finishedAt: finalizado.finishedAt?.toISOString() ?? null,
      items: resultados,
    };
  }

  async listarEjecucionesColeccion(workspaceId: string, principal: PrincipalAutenticado) {
    await this.collab.verificarRolMinimo(workspaceId, principal, 'viewer');

    const runs = await this.prisma.client.collectionRun.findMany({
      where: { workspaceId },
      include: {
        collection: { select: { id: true, name: true } },
        environment: { select: { id: true, name: true } },
        triggeredBy: { select: { id: true, email: true, displayName: true } },
        items: {
          include: {
            request: { select: { id: true, name: true, method: true, url: true } },
          },
          orderBy: { executionOrder: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });

    return runs.map((r) => ({
      id: r.id,
      collection: r.collection,
      environment: r.environment,
      triggeredBy: r.triggeredBy,
      status: r.status,
      totalRequests: r.totalRequests,
      passedRequests: r.passedRequests,
      failedRequests: r.failedRequests,
      startedAt: r.startedAt?.toISOString() ?? r.createdAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      items: r.items.map((item) => ({
        id: item.id,
        executionOrder: item.executionOrder,
        status: item.status,
        responseStatus: item.responseStatus,
        durationMs: item.durationMs,
        errorMessage: item.errorMessage,
        request: item.request,
      })),
    }));
  }

  // =========================================================================
  // 4. EXPORTAR E IMPORTAR COLECCIONES (CON VERSIONADO E HISTORIAL)
  // =========================================================================

  async exportarColeccion(
    workspaceId: string,
    collectionId: string,
    principal: PrincipalAutenticado,
  ) {
    await this.collab.verificarRolMinimo(workspaceId, principal, 'viewer');

    const coleccion = await this.prisma.client.collection.findFirst({
      where: { id: collectionId, workspaceId, deletedAt: null },
      include: {
        folders: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
        requests: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
      },
    });

    if (!coleccion) {
      throw new ErrorNoEncontrado('La colección solicitada no existe.');
    }

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.COLECCION_EXPORTADA,
      actorUserId: principal.userId,
      workspaceId,
      recursoTipo: 'collection',
      recursoId: coleccion.id,
      detalles: {
        name: coleccion.name,
        foldersCount: coleccion.folders.length,
        requestsCount: coleccion.requests.length,
      },
    });

    return {
      schemaVersion: 'ceiba.collection.v1',
      exportedAt: new Date().toISOString(),
      collection: {
        name: coleccion.name,
        description: coleccion.description,
        variables: coleccion.variables,
        authConfig: coleccion.authConfig,
      },
      folders: coleccion.folders.map((f) => ({
        id: f.id,
        parentFolderId: f.parentFolderId,
        name: f.name,
        description: f.description,
        sortOrder: f.sortOrder,
      })),
      requests: coleccion.requests.map((r) => ({
        id: r.id,
        folderId: r.folderId,
        name: r.name,
        description: r.description,
        method: r.method,
        url: r.url,
        headers: r.headers,
        queryParams: r.queryParams,
        bodyType: r.bodyType,
        body: r.body,
        authConfig: r.authConfig,
        sortOrder: r.sortOrder,
      })),
    };
  }

  async importarColeccion(
    workspaceId: string,
    payload: Record<string, unknown>,
    principal: PrincipalAutenticado,
  ) {
    await this.collab.verificarRolMinimo(workspaceId, principal, 'editor');

    const colObj = (payload.collection ?? payload.info ?? payload) as Record<string, unknown>;
    const nombreBase = String(colObj.name ?? payload.name ?? 'Colección Importada').trim();
    if (!nombreBase) {
      throw new ErrorValidacion('El archivo importado debe incluir un nombre de colección.');
    }

    const descripcion =
      typeof colObj.description === 'string' ? colObj.description : null;

    const carpetasEntrada = Array.isArray(payload.folders)
      ? (payload.folders as Array<Record<string, unknown>>)
      : [];
    const peticionesEntrada = Array.isArray(payload.requests)
      ? (payload.requests as Array<Record<string, unknown>>)
      : [];

    if (Array.isArray(payload.item)) {
      const recorrerPostman = (items: Array<Record<string, unknown>>, folderId: string | null) => {
        items.forEach((it, idx) => {
          if (Array.isArray(it.item)) {
            const fid = `pm-folder-${carpetasEntrada.length + 1}`;
            carpetasEntrada.push({
              id: fid,
              parentFolderId: folderId,
              name: String(it.name ?? `Carpeta ${idx + 1}`),
              sortOrder: idx,
            });
            recorrerPostman(it.item as Array<Record<string, unknown>>, fid);
          } else if (it.request && typeof it.request === 'object') {
            const reqObj = it.request as Record<string, unknown>;
            const rawUrl =
              typeof reqObj.url === 'string'
                ? reqObj.url
                : String((reqObj.url as Record<string, unknown> | undefined)?.raw ?? 'https://example.com');
            const rawHeaders = Array.isArray(reqObj.header)
              ? (reqObj.header as Array<Record<string, unknown>>).map((h) => ({
                  key: String(h.key ?? ''),
                  value: String(h.value ?? ''),
                  enabled: true,
                }))
              : [];
            const bodyObj = reqObj.body as Record<string, unknown> | undefined;
            const rawText = typeof bodyObj?.raw === 'string' ? bodyObj.raw : null;

            peticionesEntrada.push({
              folderId,
              name: String(it.name ?? `Petición ${idx + 1}`),
              method: String(reqObj.method ?? 'GET').toUpperCase(),
              url: rawUrl,
              headers: rawHeaders,
              queryParams: [],
              bodyType: rawText ? 'json' : 'none',
              body: rawText ? { raw: rawText } : null,
              sortOrder: idx,
            });
          }
        });
      };
      recorrerPostman(payload.item as Array<Record<string, unknown>>, null);
    }

    const existentes = await this.prisma.client.collection.findMany({
      where: { workspaceId, deletedAt: null },
      select: { name: true },
    });
    const nombresUsados = new Set(existentes.map((e) => e.name.toLowerCase()));
    let nombreFinal = nombreBase;
    let sufijo = 2;
    while (nombresUsados.has(nombreFinal.toLowerCase())) {
      nombreFinal = `${nombreBase} (${sufijo++})`;
    }

    const resultado = await this.prisma.client.$transaction(async (tx) => {
      const nuevaCol = await tx.collection.create({
        data: {
          workspaceId,
          name: nombreFinal,
          description: descripcion,
          createdByUserId: principal.userId,
        },
      });

      const mapaCarpetas = new Map<string, string>();
      for (let i = 0; i < carpetasEntrada.length; i++) {
        const f = carpetasEntrada[i]!;
        const oldId = typeof f.id === 'string' ? f.id : `f-${i}`;
        const parentNuevo =
          typeof f.parentFolderId === 'string' ? (mapaCarpetas.get(f.parentFolderId) ?? null) : null;

        const creadaCarpeta = await tx.folder.create({
          data: {
            collectionId: nuevaCol.id,
            parentFolderId: parentNuevo,
            name: String(f.name ?? `Carpeta ${i + 1}`).trim() || `Carpeta ${i + 1}`,
            description: typeof f.description === 'string' ? f.description : null,
            sortOrder: typeof f.sortOrder === 'number' ? f.sortOrder : i,
          },
        });
        mapaCarpetas.set(oldId, creadaCarpeta.id);
      }

      const metodosValidos = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
      const tiposCuerpoValidos = new Set(['none', 'json', 'xml', 'text', 'form_urlencoded', 'multipart', 'graphql']);

      let peticionesCreadas = 0;
      for (let i = 0; i < peticionesEntrada.length; i++) {
        const r = peticionesEntrada[i]!;
        const metodo = String(r.method ?? 'GET').toUpperCase();
        const metodoFinal = (metodosValidos.has(metodo) ? metodo : 'GET') as
          | 'GET'
          | 'POST'
          | 'PUT'
          | 'PATCH'
          | 'DELETE'
          | 'HEAD'
          | 'OPTIONS';
        const bodyTypeStr = String(r.bodyType ?? 'none');
        const bodyTypeFinal = (tiposCuerpoValidos.has(bodyTypeStr) ? bodyTypeStr : 'none') as
          | 'none'
          | 'json'
          | 'xml'
          | 'text'
          | 'form_urlencoded'
          | 'multipart'
          | 'graphql';

        const folderDestino =
          typeof r.folderId === 'string' ? (mapaCarpetas.get(r.folderId) ?? null) : null;

        await tx.apiRequest.create({
          data: {
            collectionId: nuevaCol.id,
            folderId: folderDestino,
            name: String(r.name ?? `Petición ${i + 1}`).trim() || `Petición ${i + 1}`,
            description: typeof r.description === 'string' ? r.description : null,
            method: metodoFinal,
            url: String(r.url ?? 'https://example.com').trim() || 'https://example.com',
            headers: Array.isArray(r.headers) ? (r.headers as object) : [],
            queryParams: Array.isArray(r.queryParams) ? (r.queryParams as object) : [],
            bodyType: bodyTypeFinal,
            body: r.body !== undefined && r.body !== null ? (r.body as object) : undefined,
            authConfig:
              typeof r.authConfig === 'object' && r.authConfig !== null
                ? (r.authConfig as object)
                : { type: 'none' },
            sortOrder: typeof r.sortOrder === 'number' ? r.sortOrder : i,
            createdByUserId: principal.userId,
            updatedByUserId: principal.userId,
          },
        });
        peticionesCreadas++;
      }

      const snapshotData = {
        collectionName: nuevaCol.name,
        foldersCount: mapaCarpetas.size,
        requestsCount: peticionesCreadas,
        importedAt: new Date().toISOString(),
      };
      const checksum = createHash('sha256').update(JSON.stringify(snapshotData)).digest('hex');

      await tx.collectionVersion.create({
        data: {
          collectionId: nuevaCol.id,
          versionNumber: 1,
          label: 'v1 (Importación inicial)',
          changelog: `Colección importada con ${mapaCarpetas.size} carpetas y ${peticionesCreadas} peticiones.`,
          snapshot: snapshotData,
          checksumSha256: checksum,
          createdByUserId: principal.userId,
        },
      });

      return {
        id: nuevaCol.id,
        name: nuevaCol.name,
        description: nuevaCol.description,
        importedFolders: mapaCarpetas.size,
        importedRequests: peticionesCreadas,
      };
    });

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.COLECCION_IMPORTADA,
      actorUserId: principal.userId,
      workspaceId,
      recursoTipo: 'collection',
      recursoId: resultado.id,
      detalles: {
        name: resultado.name,
        importedFolders: resultado.importedFolders,
        importedRequests: resultado.importedRequests,
      },
    });

    return resultado;
  }

  // =========================================================================
  // 5. DOCUMENTACIÓN AUTOGENERADA DE COLECCIONES
  // =========================================================================

  async generarDocumentacion(workspaceId: string, principal: PrincipalAutenticado) {
    const { workspace } = await this.collab.verificarRolMinimo(workspaceId, principal, 'viewer');

    const colecciones = await this.prisma.client.collection.findMany({
      where: { workspaceId, deletedAt: null },
      include: {
        folders: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
        requests: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    const lineasMd: string[] = [
      `# Documentación de API — ${workspace.name}`,
      '',
      `Generado automáticamente en CEIBA API Studio.`,
      '',
    ];

    const coleccionesDoc = colecciones.map((col) => {
      lineasMd.push(`## Colección: ${col.name}`);
      if (col.description) {
        lineasMd.push(col.description, '');
      }

      const endpoints = col.requests.map((req) => {
        const headers = Array.isArray(req.headers)
          ? (req.headers as Array<{ key?: string; value?: string; enabled?: boolean }>).filter(
              (h) => h.enabled !== false && h.key,
            )
          : [];
        const queryParams = Array.isArray(req.queryParams)
          ? (req.queryParams as Array<{ key?: string; value?: string; enabled?: boolean }>).filter(
              (q) => q.enabled !== false && q.key,
            )
          : [];

        lineasMd.push(`### \`[${req.method}]\` ${req.name}`);
        lineasMd.push(`- **URL:** \`${req.url}\``);
        if (req.description) {
          lineasMd.push(`- **Descripción:** ${req.description}`);
        }
        if (headers.length > 0) {
          lineasMd.push(`- **Cabeceras:**`);
          for (const h of headers) {
            lineasMd.push(`  - \`${h.key}\`: \`${h.value ?? ''}\``);
          }
        }
        lineasMd.push('');

        return {
          id: req.id,
          folderId: req.folderId,
          name: req.name,
          description: req.description,
          method: req.method,
          url: req.url,
          headers,
          queryParams,
          bodyType: req.bodyType,
          body: req.body,
        };
      });

      return {
        id: col.id,
        name: col.name,
        description: col.description,
        foldersCount: col.folders.length,
        requestsCount: col.requests.length,
        folders: col.folders.map((f) => ({
          id: f.id,
          parentFolderId: f.parentFolderId,
          name: f.name,
          description: f.description,
        })),
        requests: endpoints,
        endpoints,
      };
    });

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        description: null,
      },
      generatedAt: new Date().toISOString(),
      markdown: lineasMd.join('\n'),
      collections: coleccionesDoc,
    };
  }

  // =========================================================================
  // 6. CONFIGURACIÓN DEL WORKSPACE
  // =========================================================================

  async obtenerConfiguracionWorkspace(workspaceId: string, principal: PrincipalAutenticado) {
    const { rol } = await this.collab.verificarRolMinimo(workspaceId, principal, 'viewer');

    const ws = await this.prisma.client.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        retentionPolicy: true,
        _count: {
          select: {
            collections: { where: { deletedAt: null } },
            environments: true,
            members: true,
          },
        },
      },
    });

    if (!ws) {
      throw new ErrorNoEncontrado('El espacio de trabajo no existe.');
    }

    return {
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      description: ws.description,
      isPersonal: ws.isPersonal,
      myRole: rol,
      settings: ws.settings,
      counts: ws._count,
      retentionPolicy: ws.retentionPolicy
        ? {
            requestHistoryDays: ws.retentionPolicy.requestHistoryDays,
            collectionRunsDays: ws.retentionPolicy.collectionRunsDays,
            auditLogsDays: ws.retentionPolicy.auditLogsDays,
            versionSnapshotsKeep: ws.retentionPolicy.versionSnapshotsKeep,
          }
        : {
            requestHistoryDays: 90,
            collectionRunsDays: 180,
            auditLogsDays: 365,
            versionSnapshotsKeep: 20,
          },
    };
  }

  async actualizarConfiguracionWorkspace(
    workspaceId: string,
    input: {
      name?: string;
      description?: string | null;
      requestHistoryDays?: number;
      collectionRunsDays?: number;
      auditLogsDays?: number;
      versionSnapshotsKeep?: number;
    },
    principal: PrincipalAutenticado,
  ) {
    await this.collab.verificarRolMinimo(workspaceId, principal, 'admin');

    if (input.name !== undefined && !input.name.trim()) {
      throw new ErrorValidacion('El nombre del espacio no puede estar vacío.');
    }

    await this.prisma.client.$transaction(async (tx) => {
      if (input.name !== undefined || input.description !== undefined) {
        const existe = await tx.workspace.findFirst({
          where: {
            id: { not: workspaceId },
            ownerId: principal.userId,
            name: input.name?.trim(),
            deletedAt: null,
          },
        });
        if (existe && input.name) {
          throw new ErrorConflicto('Ya existe otro espacio con ese nombre.');
        }

        await tx.workspace.update({
          where: { id: workspaceId },
          data: {
            ...(input.name !== undefined ? { name: input.name.trim() } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
          },
        });
      }

      if (
        input.requestHistoryDays !== undefined ||
        input.collectionRunsDays !== undefined ||
        input.auditLogsDays !== undefined
      ) {
        await tx.retentionPolicy.upsert({
          where: { workspaceId },
          create: {
            workspaceId,
            requestHistoryDays: input.requestHistoryDays ?? 90,
            collectionRunsDays: input.collectionRunsDays ?? 180,
            auditLogsDays: input.auditLogsDays ?? 365,
            updatedByUserId: principal.userId,
          },
          update: {
            ...(input.requestHistoryDays !== undefined
              ? { requestHistoryDays: input.requestHistoryDays }
              : {}),
            ...(input.collectionRunsDays !== undefined
              ? { collectionRunsDays: input.collectionRunsDays }
              : {}),
            ...(input.auditLogsDays !== undefined ? { auditLogsDays: input.auditLogsDays } : {}),
            updatedByUserId: principal.userId,
          },
        });
      }
    });

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.WORKSPACE_RENOMBRADO,
      actorUserId: principal.userId,
      workspaceId,
      recursoTipo: 'workspace',
      recursoId: workspaceId,
      detalles: input as Record<string, unknown>,
    });

    return this.obtenerConfiguracionWorkspace(workspaceId, principal);
  }
}
