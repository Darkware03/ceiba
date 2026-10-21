import { CLIENTE_PRISMA } from '../../platform/persistence/prisma/prisma-client.ts';
import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';

import {
  ACCION_AUDITORIA,
  SERVICIO_DE_AUDITORIA,
  type ServicioDeAuditoria,
} from '../../platform/audit/ports.js';
import {
  idDeUsuario,
  type Principal as PrincipalAutenticado,
} from '../../platform/auth/principal.js';
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
  /** Enlaza la entrada de historial con la tirada de coleccion que la origino. */
  collectionRunId?: string | null;
}

// ===========================================================================
// AYUDANTES DE TRADUCCION ENTRE EL CONTRATO HTTP Y EL ESQUEMA REAL
//
// El modulo se escribio contra un esquema imaginado (`url`, `headers`,
// `sortOrder`, `valuePlaintext`, `folder`, `collectionRunItem`...) que NO es el
// de `prisma/schema/*.prisma`. Como la fachada de Prisma estaba en `any`, nada
// de eso se comprobaba. Al tipar la fachada afloro entero.
//
// Criterio aplicado en toda la correccion: **se cambia de donde se leen y donde
// se escriben los datos, NO el contrato HTTP**. Las respuestas conservan sus
// nombres (`url`, `headers`, `sortOrder`, `passedRequests`, ...) porque
// `apps/web` ya los consume y no es mi ambito de escritura.
// ===========================================================================

/**
 * `sort_key` es `String` y obligatorio en Collection, ApiRequest,
 * CollectionFolder y Environment. El codigo manejaba un `sortOrder` numerico
 * que no existe. Se deriva una clave lexicografica estable: con relleno a 6
 * digitos el orden de texto coincide con el numerico hasta 999.999 elementos.
 */
function claveDeOrden(indice: number): string {
  return String(Math.max(0, Math.trunc(indice))).padStart(6, '0');
}

/** Devuelve el `sortOrder` numerico que la API publica a partir del `sortKey`. */
function ordenDesdeClave(sortKey: string): number {
  const n = Number.parseInt(sortKey, 10);
  return Number.isFinite(n) ? n : 0;
}

function aRanura(texto: string, respaldo: string): string {
  const base = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return base === '' ? respaldo : base;
}

/** Fila de variable de entorno tal y como vive en la base de datos. */
interface FilaVariableDeEntorno {
  readonly id: string;
  readonly key: string;
  readonly initialValue: string | null;
  readonly currentValue: string | null;
  readonly valueKind: string;
  readonly isEnabled: boolean;
  readonly description: string | null;
}

/**
 * Proyeccion de una variable al contrato HTTP.
 *
 * `environment_variables` NO tiene `valuePlaintext`, `isSecret` ni `enabled`:
 * tiene `initial_value`/`current_value`, un enum `value_kind` y `is_enabled`.
 * Una variable `secret` **no guarda el valor en la fila** (restriccion
 * `ck_envvar_secret_xor`): vive cifrada en `secrets`. Por eso aqui se devuelve
 * cadena vacia para los secretos en lugar de inventarse un valor.
 */
function aVariableDeRespuesta(v: FilaVariableDeEntorno) {
  const esSecreta = v.valueKind === 'secret';
  return {
    id: v.id,
    key: v.key,
    value: esSecreta ? '' : (v.currentValue ?? v.initialValue ?? ''),
    isSecret: esSecreta,
    enabled: v.isEnabled,
    description: v.description,
  };
}

/** Valor efectivo de una variable para interpolar. Los secretos no se resuelven aqui. */
function valorEfectivo(v: FilaVariableDeEntorno): string {
  return v.valueKind === 'secret' ? '' : (v.currentValue ?? v.initialValue ?? '');
}

/** Host de la URL ejecutada. `request_history.url_host` es obligatorio. */
function hostDeUrl(url: string): string {
  try {
    return new URL(url).host || 'desconocido';
  } catch {
    return 'desconocido';
  }
}

/**
 * Traduce el codigo de error del motor al enum `ExecutionOutcome` del esquema.
 * Falla al valor generico `internal_error`, nunca a un literal inexistente:
 * un valor fuera del enum aborta la insercion entera del historial.
 */
function desenlaceDeEjecucion(ok: boolean, codigoError: string | null): string {
  if (ok) return 'completed';
  // Los codigos de la izquierda son los de `ENGINE_ERROR_CODES` del motor.
  switch ((codigoError ?? '').toUpperCase()) {
    case 'TIMEOUT':
    case 'ETIMEDOUT':
      return 'timeout';
    case 'CANCELLED':
      return 'cancelled';
    case 'DNS_FAILURE':
    case 'ENOTFOUND':
      return 'dns_failure';
    case 'TLS_FAILURE':
    case 'TLS_ERROR':
      return 'tls_failure';
    case 'ENGINE_UNREACHABLE':
    case 'ENGINE_REJECTED':
    case 'ECONNREFUSED':
    case 'CONNECTION_ERROR':
    case 'CONNECTION_REFUSED':
    case 'CONNECTION_RESET':
      return 'connection_error';
    case 'BLOCKED_BY_POLICY':
    case 'SSRF_BLOCKED':
      return 'blocked_by_policy';
    case 'TOO_LARGE':
    case 'RESPONSE_TOO_LARGE':
      return 'too_large';
    default:
      return 'internal_error';
  }
}

/**
 * El contrato HTTP usa los tipos de cuerpo de Postman (`json`, `xml`, `text`,
 * `multipart`); el enum `BodyMode` del esquema usa `raw_json`, `raw_xml`,
 * `raw_text`, `multipart_form_data`. Cuatro de los siete literales que escribia
 * el codigo eran valores invalidos del enum.
 */
const MODO_CUERPO: Readonly<Record<string, string>> = Object.freeze({
  none: 'none',
  ninguno: 'none',
  json: 'raw_json',
  raw_json: 'raw_json',
  xml: 'raw_xml',
  raw_xml: 'raw_xml',
  text: 'raw_text',
  texto: 'raw_text',
  raw: 'raw_text',
  raw_text: 'raw_text',
  html: 'raw_html',
  raw_html: 'raw_html',
  graphql: 'graphql',
  form_urlencoded: 'form_urlencoded',
  multipart: 'multipart_form_data',
  multipart_form_data: 'multipart_form_data',
  binary_file: 'binary_file',
});

/** Camino inverso: del enum del esquema al literal que publica la API. */
const TIPO_CUERPO_PUBLICO: Readonly<Record<string, string>> = Object.freeze({
  none: 'none',
  raw_json: 'json',
  raw_xml: 'xml',
  raw_text: 'text',
  raw_html: 'html',
  graphql: 'graphql',
  form_urlencoded: 'form_urlencoded',
  multipart_form_data: 'multipart',
  binary_file: 'binary_file',
  custom: 'none',
});

const METODOS_HTTP = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
  'TRACE',
]);

type MetodoHttp = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS' | 'TRACE';

function metodoValido(metodo: string): MetodoHttp {
  const m = metodo.toUpperCase();
  return (METODOS_HTTP.has(m) ? m : 'GET') as MetodoHttp;
}

/**
 * Respuesta de `POST /v1/execute` del motor, segun
 * `apps/engine/src/contract/engine-contract.ts` (`ExecuteResponse`). Se declara
 * aqui porque `apps/api` NO puede importar de `apps/engine`: el ADR-0002 los
 * mantiene desacoplados y el motor vive en otro contenedor (C-25). Lo que se
 * afirma de esta forma lo comprueba `test/motor-contrato.test.ts`, que valida
 * la peticion que emitimos contra el esquema real del motor.
 */
interface RespuestaDelMotor {
  readonly executionId?: string;
  readonly outcome?: 'completed' | 'failed' | 'blocked' | 'timeout' | 'too_large';
  readonly response?: {
    readonly status: number;
    readonly statusText: string;
    readonly headers?: ReadonlyArray<{ name: string; value: string }>;
    readonly bodyEncoding?: 'utf8' | 'base64';
    readonly body?: string;
    readonly bodyTruncated?: boolean;
    readonly sizeBytes?: number;
  } | null;
  readonly timings?: { readonly totalMs?: number; readonly ttfbMs?: number };
  readonly redirects?: ReadonlyArray<{ status: number; from: string; to: string }>;
  readonly error?: { readonly code: string; readonly message: string } | null;
}

/** `ALLOWED_METHODS` del motor: ni `TRACE` ni `CONNECT` (son tunel y reflejo). */
const METODOS_DEL_MOTOR = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

function metodoDelMotor(metodo: string): string {
  const m = metodo.toUpperCase();
  return METODOS_DEL_MOTOR.has(m) ? m : 'GET';
}

/** `bodySchema.mode` del motor: none|raw|json|form|urlencoded|binary|graphql. */
function modoCuerpoDelMotor(tipo: string | undefined): string {
  switch ((tipo ?? 'none').toLowerCase()) {
    case 'json':
    case 'raw_json':
      return 'json';
    case 'form_urlencoded':
      return 'urlencoded';
    case 'multipart':
    case 'multipart_form_data':
      return 'form';
    case 'graphql':
      return 'graphql';
    case 'binary_file':
      return 'binary';
    case 'none':
    case 'ninguno':
      return 'none';
    default:
      return 'raw';
  }
}

/** Cabeceras y parametros viven en tablas hijas, no en columnas Json. */
interface FilaClaveValor {
  readonly name: string;
  readonly value: string | null;
  readonly isEnabled: boolean;
}

function aParesDeRespuesta(filas: readonly FilaClaveValor[]) {
  return filas.map((f) => ({ key: f.name, value: f.value ?? '', enabled: f.isEnabled }));
}

/**
 * HUECO DECLARADO: `retention_policies` **no tiene** `collection_runs_days` ni
 * `version_snapshots_keep`, y el contrato de `PATCH .../settings` los expone.
 * `prisma/` no es ambito de escritura de este entregable, asi que viven en
 * `workspaces.settings` (columna `Json` pensada para ajustes de aplicacion)
 * hasta que el `database-engineer` decida si merecen columna propia.
 */
function ajustesDeRetencionExtra(settings: unknown): {
  collectionRunsDays: number;
  versionSnapshotsKeep: number;
} {
  const raiz =
    typeof settings === 'object' && settings !== null
      ? (settings as Record<string, unknown>)
      : {};
  const bloque =
    typeof raiz['retention'] === 'object' && raiz['retention'] !== null
      ? (raiz['retention'] as Record<string, unknown>)
      : {};
  const entero = (valor: unknown, porDefecto: number): number =>
    typeof valor === 'number' && Number.isInteger(valor) && valor > 0 ? valor : porDefecto;
  return {
    collectionRunsDays: entero(bloque['collectionRunsDays'], 180),
    versionSnapshotsKeep: entero(bloque['versionSnapshotsKeep'], 20),
  };
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
      where: { workspaceId, deletedAt: null },
      include: {
        environmentVariables: {
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });

    return envs.map((env) => ({
      id: env.id,
      workspaceId: env.workspaceId,
      name: env.name,
      // `environments` no tiene columna `slug`. Se deriva del nombre para no
      // romper el contrato que ya consume la interfaz; no se persiste.
      slug: aRanura(env.name, 'entorno'),
      description: env.description,
      color: env.color,
      isDefault: env.isDefault,
      createdAt: env.createdAt.toISOString(),
      updatedAt: env.updatedAt.toISOString(),
      variables: env.environmentVariables.map(aVariableDeRespuesta),
    }));
  }

  /**
   * Convierte la entrada del contrato HTTP en filas de `environment_variables`.
   *
   * **Rechaza `isSecret: true` en lugar de guardarlo en claro.** La restriccion
   * `ck_envvar_secret_xor` exige que una variable `secret` tenga el valor en la
   * tabla `secrets` (cifrado con la clave maestra) y NULL en la fila. Aceptar la
   * marca y escribir el valor en `current_value` seria una fuga silenciosa.
   */
  #aFilasDeVariables(variables: readonly VariableEntornoInput[]) {
    const conSecreto = variables.find((v) => v.isSecret === true);
    if (conSecreto) {
      throw new ErrorValidacion(
        `La variable '${conSecreto.key}' se marca como secreta, y los secretos se guardan cifrados ` +
          'en el almacen de secretos, no en el entorno. Esa via todavia no esta expuesta en esta ruta.',
      );
    }
    return variables
      .filter((v) => v.key?.trim())
      .map((v, idx) => ({
        key: v.key.trim(),
        valueKind: 'string' as const,
        initialValue: v.value ?? '',
        currentValue: v.value ?? '',
        isEnabled: v.enabled ?? true,
        description: v.description ?? null,
        sortOrder: idx,
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

    const slug = `${aRanura(nombre, 'entorno')}-${Date.now().toString(36).slice(-4)}`;
    const filasVariables = this.#aFilasDeVariables(input.variables ?? []);

    const creado = await this.prisma.client.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.environment.updateMany({
          where: { workspaceId, isDefault: true },
          data: { isDefault: false },
        });
      }

      // `sortKey` es obligatorio y sin default; el `slug` que ya se calculaba
      // sirve de clave de orden estable y legible.
      return tx.environment.create({
        data: {
          workspaceId,
          name: nombre,
          sortKey: slug,
          description: input.description ?? null,
          color: input.color ?? '#0ea5e9',
          isDefault: Boolean(input.isDefault),
          createdByUserId: idDeUsuario(principal),
          environmentVariables: { create: filasVariables },
        },
        include: { environmentVariables: { orderBy: { sortOrder: 'asc' } } },
      });
    });

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.ENTORNO_CREADO,
      actorUserId: idDeUsuario(principal),
      workspaceId,
      recursoTipo: 'environment',
      recursoId: creado.id,
      detalles: {
        name: creado.name,
        variablesCount: creado.environmentVariables.length,
      },
    });

    return {
      id: creado.id,
      workspaceId: creado.workspaceId,
      name: creado.name,
      slug,
      description: creado.description,
      color: creado.color,
      isDefault: creado.isDefault,
      createdAt: creado.createdAt.toISOString(),
      updatedAt: creado.updatedAt.toISOString(),
      variables: creado.environmentVariables.map(aVariableDeRespuesta),
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

    const filasVariables =
      input.variables === undefined ? undefined : this.#aFilasDeVariables(input.variables);

    const actualizado = await this.prisma.client.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.environment.updateMany({
          where: { workspaceId: actual.workspaceId, isDefault: true },
          data: { isDefault: false },
        });
      }

      if (filasVariables !== undefined) {
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
          ...(filasVariables !== undefined
            ? { environmentVariables: { create: filasVariables } }
            : {}),
        },
        include: { environmentVariables: { orderBy: { sortOrder: 'asc' } } },
      });
    });

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.ENTORNO_ACTUALIZADO,
      actorUserId: idDeUsuario(principal),
      workspaceId: actual.workspaceId,
      recursoTipo: 'environment',
      recursoId: actualizado.id,
      detalles: {
        name: actualizado.name,
        variablesCount: actualizado.environmentVariables.length,
      },
    });

    return {
      id: actualizado.id,
      workspaceId: actualizado.workspaceId,
      name: actualizado.name,
      slug: aRanura(actualizado.name, 'entorno'),
      description: actualizado.description,
      color: actualizado.color,
      isDefault: actualizado.isDefault,
      createdAt: actualizado.createdAt.toISOString(),
      updatedAt: actualizado.updatedAt.toISOString(),
      variables: actualizado.environmentVariables.map(aVariableDeRespuesta),
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
      actorUserId: idDeUsuario(principal),
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
    const { workspace } = await this.collab.verificarRolMinimo(workspaceId, principal, 'viewer');

    const variables = new Map<string, string>();
    if (input.environmentId) {
      const env = await this.prisma.client.environment.findFirst({
        where: { id: input.environmentId, workspaceId, deletedAt: null },
        include: { environmentVariables: { where: { isEnabled: true } } },
      });
      if (env) {
        for (const v of env.environmentVariables) {
          variables.set(v.key, valorEfectivo(v));
        }
      }
    } else {
      const defaultEnv = await this.prisma.client.environment.findFirst({
        where: { workspaceId, isDefault: true, deletedAt: null },
        include: { environmentVariables: { where: { isEnabled: true } } },
      });
      if (defaultEnv) {
        for (const v of defaultEnv.environmentVariables) {
          variables.set(v.key, valorEfectivo(v));
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

    // ───────────────────────────────────────────────────────────────────────
    // CONTRATO REAL DEL MOTOR (`apps/engine/src/contract/engine-contract.ts`).
    //
    // `executeRequestSchema` es un `z.strictObject` con esta forma:
    //
    //   { executionId, request: { method, url, headers, body }, policy, capture }
    //
    // El codigo enviaba un objeto PLANO con `body: { kind, text }` y
    // `followRedirects` en la raiz. `strictObject` lo rechaza con
    // `INVALID_REQUEST` (reproducido con curl contra el motor). Nunca se
    // detecto porque el fallo quedaba indistinguible del motor inalcanzable.
    // ───────────────────────────────────────────────────────────────────────
    const idEjecucion = randomUUID();
    const enginePayload = {
      executionId: idEjecucion,
      request: {
        method: metodoDelMotor(metodo),
        url: urlFinal,
        headers: headersActivos,
        ...(cuerpoInterpolado === undefined
          ? {}
          : {
              body: {
                mode: modoCuerpoDelMotor(input.bodyType),
                raw: cuerpoInterpolado,
              },
            }),
      },
      policy: {
        timeoutMs: Math.min(Math.max(input.timeoutMs ?? 15000, 500), 30000),
        followRedirects: true,
      },
    };

    const inicio = Date.now();
    let engineRes: RespuestaDelMotor;
    try {
      const engineBaseUrl = this.config.engine?.url ?? 'http://127.0.0.1:3001';
      const engineAuthToken = this.config.engine?.token ?? '';
      const res = await fetch(`${engineBaseUrl.replace(/\/$/u, '')}/v1/execute`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-ceiba-engine-token': engineAuthToken,
        },
        body: JSON.stringify(enginePayload),
        signal: AbortSignal.timeout(this.config.engine?.timeoutMs ?? 30000),
      });
      engineRes = (await res.json()) as RespuestaDelMotor;
      // Un 4xx del motor trae `{ error: { code, message } }` sin `outcome`.
      if (!res.ok && engineRes.error == null) {
        engineRes = {
          outcome: 'failed',
          error: { code: 'ENGINE_REJECTED', message: `El motor respondio ${res.status}.` },
        };
      }
    } catch (err) {
      engineRes = {
        outcome: 'failed',
        error: {
          code: 'ENGINE_UNREACHABLE',
          message: err instanceof Error ? err.message : 'Error contactando al motor HTTP',
        },
      };
    }

    // `outcome: 'completed'` y respuesta presente es la unica combinacion que
    // cuenta como exito. Antes se miraba `engineRes.ok`, campo que el motor no
    // emite: SIEMPRE era `undefined`, asi que toda ejecucion se tomaba por
    // fallida aunque el destino hubiese contestado.
    const respuesta = engineRes.response ?? null;
    const esOk = engineRes.outcome === 'completed' && respuesta !== null;
    const duracionMs = Number(engineRes.timings?.totalMs ?? Date.now() - inicio);

    const statusHttp = respuesta === null ? null : Number(respuesta.status);
    const responseSizeBytes = respuesta === null ? 0 : Number(respuesta.sizeBytes ?? 0);
    const errorCode = esOk ? null : String(engineRes.error?.code ?? 'EXECUTION_ERROR');

    let validRequestId: string | null = null;
    if (input.requestId) {
      const reqRow = await this.prisma.client.apiRequest.findFirst({
        where: { id: input.requestId, collection: { workspaceId } },
        select: { id: true },
      });
      validRequestId = reqRow?.id ?? null;
    }

    // `request_history` NO tiene `userId`, `requestId`, `resolvedUrl`,
    // `requestSnapshot`, `responseStatus`, `responseHeaders`, `durationMs` ni
    // `responseBodyPreview`, y SI exige `urlFinal`, `urlHost`, `outcome` y
    // `expiresAt`. Los cuatro obligatorios faltaban: la insercion habria fallado
    // en el motor aunque todos los nombres hubiesen sido correctos.
    //
    // El CUERPO DE RESPUESTA NO SE PERSISTE. `body_persistence` vale `none` por
    // defecto y el cuerpo vive, si la politica lo autoriza, en
    // `response_artifacts`. Guardarlo aqui seria saltarse esa politica.
    const diasRetencion = Math.max(1, workspace.historyRetentionDays);
    const caducaEn = new Date(Date.now() + diasRetencion * 24 * 60 * 60 * 1000);

    const hist = await this.prisma.client.requestHistory.create({
      data: {
        workspaceId,
        executedByUserId: idDeUsuario(principal),
        apiRequestId: validRequestId,
        environmentId: input.environmentId ?? null,
        collectionId: input.collectionId ?? null,
        collectionRunId: input.collectionRunId ?? null,
        method: metodoValido(metodo),
        urlFinal,
        urlHost: hostDeUrl(urlFinal),
        outcome: desenlaceDeEjecucion(esOk, errorCode) as 'completed',
        requestHeadersSnapshot: headersActivos,
        statusCode: statusHttp,
        responseHeadersSnapshot: respuesta === null ? undefined : (respuesta.headers ?? []),
        responseContentType:
          respuesta?.headers?.find((h) => h.name.toLowerCase() === 'content-type')?.value ?? null,
        redirectCount: engineRes.redirects?.length ?? 0,
        responseSizeBytes,
        durationTotalMs: Math.max(0, Math.round(duracionMs)),
        errorCode,
        errorMessage: esOk ? null : (String(engineRes.error?.message ?? '').slice(0, 500) || null),
        expiresAt: caducaEn,
      },
    });

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.PETICION_EJECUTADA,
      actorUserId: idDeUsuario(principal),
      workspaceId,
      recursoTipo: 'request_execution',
      recursoId: validRequestId ?? hist.id,
      detalles: {
        method: metodo,
        url: urlFinal,
        status: statusHttp,
        durationMs: Math.round(duracionMs),
        ok: esOk,
      },
    });

    if (!esOk) {
      return {
        historyId: hist.id,
        exito: false,
        codigoEstado: statusHttp ?? 0,
        textoEstado: String(engineRes.error?.code ?? 'ERROR'),
        cabeceras: [],
        cuerpoTexto: String(engineRes.error?.message ?? 'Fallo al ejecutar la petición'),
        tipoContenido: 'text/plain',
        tamanoBytes: 0,
        truncado: false,
        tiempos: { totalMs: Math.round(duracionMs) },
        urlFinal,
        redirecciones: engineRes.redirects?.length ?? 0,
        desenlace: engineRes.outcome ?? 'failed',
        errorCodigo: String(engineRes.error?.code ?? 'EXECUTION_ERROR'),
        errorMensaje: String(engineRes.error?.message ?? 'Fallo al ejecutar la petición'),
      };
    }

    const headersRaw = respuesta?.headers ?? [];
    const contentTypeHeader = headersRaw.find((h) => h.name.toLowerCase() === 'content-type');
    // `bodyEncoding` puede ser `base64` (respuesta binaria); decodificarlo aqui
    // evita devolver base64 crudo donde la interfaz espera texto.
    const cuerpoTexto =
      respuesta?.bodyEncoding === 'base64'
        ? Buffer.from(respuesta.body ?? '', 'base64').toString('utf8')
        : (respuesta?.body ?? '');

    return {
      historyId: hist.id,
      exito: true,
      codigoEstado: statusHttp ?? 200,
      textoEstado: String(respuesta?.statusText ?? 'OK'),
      cabeceras: headersRaw.map((h) => ({ clave: h.name, valor: h.value })),
      cuerpoTexto,
      tipoContenido: String(contentTypeHeader?.value ?? 'text/plain'),
      tamanoBytes: responseSizeBytes,
      truncado: Boolean(respuesta?.bodyTruncated),
      tiempos: {
        totalMs: Math.round(duracionMs),
        ttfbMs: Number(engineRes.timings?.ttfbMs ?? duracionMs),
      },
      urlFinal:
        engineRes.redirects && engineRes.redirects.length > 0
          ? (engineRes.redirects[engineRes.redirects.length - 1]?.to ?? urlFinal)
          : urlFinal,
      redirecciones: engineRes.redirects?.length ?? 0,
      desenlace: engineRes.outcome ?? 'completed',
      errorCodigo: null,
      errorMensaje: null,
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
        executedByUser: { select: { id: true, email: true, displayName: true } },
        apiRequest: { select: { id: true, name: true } },
      },
      orderBy: { executedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });

    return rows.map((r) => ({
      id: r.id,
      workspaceId: r.workspaceId,
      method: r.method,
      resolvedUrl: r.urlFinal,
      responseStatus: r.statusCode,
      // `BigInt` no es serializable a JSON; se baja a numero en la frontera.
      responseSizeBytes: r.responseSizeBytes === null ? null : Number(r.responseSizeBytes),
      durationMs: r.durationTotalMs,
      outcome: r.outcome,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      executedAt: r.executedAt.toISOString(),
      user: r.executedByUser,
      request: r.apiRequest,
      requestSnapshot: {
        method: r.method,
        url: r.urlFinal,
        headers: r.requestHeadersSnapshot ?? [],
      },
      // El esquema no guarda el cuerpo de respuesta con la politica por defecto
      // (`body_persistence = none`); se declara null en vez de inventarlo.
      responseBodyPreview: null,
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
    const { workspace } = await this.collab.verificarRolMinimo(workspaceId, principal, 'executor');

    // Cabeceras, parametros y cuerpo NO son columnas Json de `api_requests`:
    // son las tablas hijas `request_headers`, `request_params` y
    // `request_bodies`. Y la relacion se llama `apiRequests`, no `requests`.
    const coleccion = await this.prisma.client.collection.findFirst({
      where: { id: collectionId, workspaceId, deletedAt: null },
      include: {
        apiRequests: {
          where: { deletedAt: null },
          orderBy: { sortKey: 'asc' },
          include: {
            requestHeaders: { orderBy: { sortOrder: 'asc' } },
            requestParams: { where: { kind: 'query' }, orderBy: { sortOrder: 'asc' } },
            requestBodies: true,
          },
        },
      },
    });

    if (!coleccion) {
      throw new ErrorNoEncontrado('La colección no existe en este espacio.');
    }

    const caducaEn = new Date(
      Date.now() + Math.max(1, workspace.historyRetentionDays) * 24 * 60 * 60 * 1000,
    );

    const run = await this.prisma.client.collectionRun.create({
      data: {
        workspaceId,
        collectionId: coleccion.id,
        environmentId: environmentId ?? null,
        triggeredByUserId: idDeUsuario(principal),
        status: 'running',
        totalRequests: coleccion.apiRequests.length,
        startedAt: new Date(),
        // Obligatorio y sin default: los resultados de ejecucion caducan igual
        // que el historial (seccion de retencion del modelo de datos).
        expiresAt: caducaEn,
      },
    });

    let passed = 0;
    let failed = 0;
    const resultados: Array<Record<string, unknown>> = [];

    for (let i = 0; i < coleccion.apiRequests.length; i++) {
      const req = coleccion.apiRequests[i]!;
      const headersArr = aParesDeRespuesta(req.requestHeaders);
      const queryArr = aParesDeRespuesta(req.requestParams);
      const bodyRaw = req.requestBodies?.rawContent ?? null;

      const res = await this.ejecutarPeticion(
        workspaceId,
        {
          requestId: req.id,
          collectionId: coleccion.id,
          environmentId: environmentId ?? null,
          // La tirada enlaza cada ejecucion con su entrada de historial a traves
          // de `request_history.collection_run_id`. Eso es lo que sustituye al
          // inexistente `collectionRunItem`.
          collectionRunId: run.id,
          method: req.method,
          url: req.urlTemplate,
          headers: headersArr,
          queryParams: queryArr,
          bodyType: TIPO_CUERPO_PUBLICO[req.bodyMode] ?? 'none',
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

      // NO se crea ninguna fila extra: `ejecutarPeticion` ya ha insertado la
      // entrada de `request_history` con `collection_run_id`, que ES el item de
      // la tirada en este esquema. El modelo `collectionRunItem` que invocaba el
      // codigo original no existe en `prisma/schema`, y la llamada reventaba con
      // `TypeError: Cannot read properties of undefined (reading 'create')`.

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

    // `RunStatus` = queued | running | passed | failed | cancelled | errored.
    // `'completed'` NO es un valor del enum y abortaba el `update` entero, con
    // lo que toda tirada quedaba colgada en `running` para siempre.
    const estadoFinal: 'passed' | 'failed' = failed > 0 ? 'failed' : 'passed';

    const finalizado = await this.prisma.client.collectionRun.update({
      where: { id: run.id },
      data: {
        status: estadoFinal,
        // El esquema llama `completedRequests` a los que terminaron bien; no
        // existe `passedRequests` ni una columna `summary`.
        completedRequests: passed,
        failedRequests: failed,
        totalDurationMs: resultados.reduce(
          (suma, item) => suma + Number(item['durationMs'] ?? 0),
          0,
        ),
        finishedAt: new Date(),
      },
      include: {
        collection: { select: { id: true, name: true } },
        environment: { select: { id: true, name: true } },
        triggeredByUser: { select: { id: true, email: true, displayName: true } },
      },
    });

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.COLECCION_EJECUTADA,
      actorUserId: idDeUsuario(principal),
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
      triggeredBy: finalizado.triggeredByUser,
      status: finalizado.status,
      totalRequests: finalizado.totalRequests,
      passedRequests: finalizado.completedRequests,
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
        triggeredByUser: { select: { id: true, email: true, displayName: true } },
        // Los items de la tirada son sus entradas de historial.
        // `executionOrder` no existe como columna en ningun modelo: el orden es
        // el de ejecucion, y se reconstruye por `executed_at`, que es
        // monotono porque las peticiones se lanzan en serie.
        requestHistory: {
          include: {
            apiRequest: { select: { id: true, name: true, method: true, urlTemplate: true } },
          },
          orderBy: { executedAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });

    return runs.map((r) => ({
      id: r.id,
      collection: r.collection,
      environment: r.environment,
      triggeredBy: r.triggeredByUser,
      status: r.status,
      totalRequests: r.totalRequests,
      passedRequests: r.completedRequests,
      failedRequests: r.failedRequests,
      startedAt: r.startedAt?.toISOString() ?? r.createdAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      items: r.requestHistory.map((item, indice) => ({
        id: item.id,
        executionOrder: indice + 1,
        status: item.outcome === 'completed' && (item.statusCode ?? 0) < 400 ? 'passed' : 'failed',
        responseStatus: item.statusCode,
        durationMs: item.durationTotalMs,
        errorMessage: item.errorMessage,
        request: item.apiRequest
          ? {
              id: item.apiRequest.id,
              name: item.apiRequest.name,
              method: item.apiRequest.method,
              url: item.apiRequest.urlTemplate,
            }
          : null,
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
        collectionFolders: { where: { deletedAt: null }, orderBy: { sortKey: 'asc' } },
        apiRequests: {
          where: { deletedAt: null },
          orderBy: { sortKey: 'asc' },
          include: {
            requestHeaders: { orderBy: { sortOrder: 'asc' } },
            requestParams: { where: { kind: 'query' }, orderBy: { sortOrder: 'asc' } },
            requestBodies: true,
          },
        },
      },
    });

    if (!coleccion) {
      throw new ErrorNoEncontrado('La colección solicitada no existe.');
    }

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.COLECCION_EXPORTADA,
      actorUserId: idDeUsuario(principal),
      workspaceId,
      recursoTipo: 'collection',
      recursoId: coleccion.id,
      detalles: {
        name: coleccion.name,
        foldersCount: coleccion.collectionFolders.length,
        requestsCount: coleccion.apiRequests.length,
      },
    });

    return {
      schemaVersion: 'ceiba.collection.v1',
      exportedAt: new Date().toISOString(),
      collection: {
        name: coleccion.name,
        description: coleccion.description,
        // `variables_doc` es SOLO documentacion de variables esperadas; por
        // diseno nunca contiene valores secretos, así que es exportable.
        variables: coleccion.variablesDoc,
        authConfig: { type: coleccion.defaultAuthMode },
      },
      folders: coleccion.collectionFolders.map((f) => ({
        id: f.id,
        parentFolderId: f.parentFolderId,
        name: f.name,
        description: f.description,
        sortOrder: ordenDesdeClave(f.sortKey),
      })),
      requests: coleccion.apiRequests.map((r) => ({
        id: r.id,
        folderId: r.folderId,
        name: r.name,
        description: r.description,
        method: r.method,
        url: r.urlTemplate,
        headers: aParesDeRespuesta(r.requestHeaders),
        queryParams: aParesDeRespuesta(r.requestParams),
        bodyType: TIPO_CUERPO_PUBLICO[r.bodyMode] ?? 'none',
        body: r.requestBodies?.rawContent == null ? null : { raw: r.requestBodies.rawContent },
        authConfig: { type: r.authMode },
        sortOrder: ordenDesdeClave(r.sortKey),
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

    // `collections.slug` es obligatorio y unico por workspace
    // (`uq_collections_ws_slug`). El `create` original no lo enviaba y habria
    // fallado en el motor aunque hubiese compilado.
    const ranuraBase = aRanura(nombreFinal, 'coleccion');
    const ranurasUsadas = new Set(
      (
        await this.prisma.client.collection.findMany({
          where: { workspaceId },
          select: { slug: true },
        })
      ).map((c) => c.slug),
    );
    let ranuraFinal = ranuraBase;
    let nSlug = 2;
    while (ranurasUsadas.has(ranuraFinal)) {
      ranuraFinal = `${ranuraBase}-${nSlug++}`;
    }

    const resultado = await this.prisma.client.$transaction(async (tx) => {
      const nuevaCol = await tx.collection.create({
        data: {
          workspaceId,
          name: nombreFinal,
          slug: ranuraFinal,
          sortKey: claveDeOrden(ranurasUsadas.size),
          description: descripcion,
          schemaFormat: Array.isArray(payload.item) ? 'postman_v2_1' : 'ceiba_native',
          createdByUserId: idDeUsuario(principal),
        },
      });

      // `collection_folders` exige `materialized_path` y `sort_key`, y el
      // delegado se llama `collectionFolder` (el `tx.folder` original no existia
      // y reventaba con TypeError). La ruta materializada incluye el id de la
      // propia carpeta, que solo se conoce tras el INSERT: se crea con la ruta
      // del padre y se completa acto seguido, dentro de la misma transaccion.
      const mapaCarpetas = new Map<string, string>();
      const rutasCarpetas = new Map<string, string>();
      const profundidades = new Map<string, number>();
      const nombresPorPadre = new Map<string, Set<string>>();

      for (let i = 0; i < carpetasEntrada.length; i++) {
        const f = carpetasEntrada[i]!;
        const oldId = typeof f.id === 'string' ? f.id : `f-${i}`;
        const parentNuevo =
          typeof f.parentFolderId === 'string' ? (mapaCarpetas.get(f.parentFolderId) ?? null) : null;

        // `uq_folder_sibling_name`: dos hermanas no pueden compartir nombre.
        const clavePadre = parentNuevo ?? 'raiz';
        const usados = nombresPorPadre.get(clavePadre) ?? new Set<string>();
        let nombreCarpeta = String(f.name ?? `Carpeta ${i + 1}`).trim() || `Carpeta ${i + 1}`;
        let nCarpeta = 2;
        while (usados.has(nombreCarpeta.toLowerCase())) {
          nombreCarpeta = `${String(f.name ?? `Carpeta ${i + 1}`).trim()} (${nCarpeta++})`;
        }
        usados.add(nombreCarpeta.toLowerCase());
        nombresPorPadre.set(clavePadre, usados);

        const rutaPadre = parentNuevo ? (rutasCarpetas.get(parentNuevo) ?? '/') : '/';
        const profundidadPadre = parentNuevo ? (profundidades.get(parentNuevo) ?? 0) : -1;

        const creadaCarpeta = await tx.collectionFolder.create({
          data: {
            collectionId: nuevaCol.id,
            parentFolderId: parentNuevo,
            name: nombreCarpeta,
            description: typeof f.description === 'string' ? f.description : null,
            materializedPath: rutaPadre,
            // `ck_folders_depth`: entre 0 y 32.
            depth: Math.min(32, profundidadPadre + 1),
            sortKey: claveDeOrden(typeof f.sortOrder === 'number' ? f.sortOrder : i),
          },
        });
        const rutaPropia = `${rutaPadre}${creadaCarpeta.id}/`;
        await tx.collectionFolder.update({
          where: { id: creadaCarpeta.id },
          data: { materializedPath: rutaPropia },
        });

        mapaCarpetas.set(oldId, creadaCarpeta.id);
        rutasCarpetas.set(creadaCarpeta.id, rutaPropia);
        profundidades.set(creadaCarpeta.id, Math.min(32, profundidadPadre + 1));
      }

      let peticionesCreadas = 0;
      for (let i = 0; i < peticionesEntrada.length; i++) {
        const r = peticionesEntrada[i]!;
        const metodoFinal = metodoValido(String(r.method ?? 'GET'));
        // `BodyMode` no tiene `json`/`xml`/`text`/`multipart`: son `raw_json`,
        // `raw_xml`, `raw_text` y `multipart_form_data`.
        const modoCuerpo = (MODO_CUERPO[String(r.bodyType ?? 'none').toLowerCase()] ??
          'none') as 'none';

        const folderDestino =
          typeof r.folderId === 'string' ? (mapaCarpetas.get(r.folderId) ?? null) : null;

        const cabeceras = Array.isArray(r.headers)
          ? (r.headers as Array<Record<string, unknown>>)
          : [];
        const parametros = Array.isArray(r.queryParams)
          ? (r.queryParams as Array<Record<string, unknown>>)
          : [];
        const cuerpoCrudo =
          typeof r.body === 'string'
            ? r.body
            : typeof r.body === 'object' && r.body !== null
              ? ((r.body as Record<string, unknown>)['raw'] as string | undefined) ?? null
              : null;

        // Cabeceras, parametros y cuerpo son FILAS HIJAS, no columnas Json.
        await tx.apiRequest.create({
          data: {
            collectionId: nuevaCol.id,
            folderId: folderDestino,
            name: String(r.name ?? `Petición ${i + 1}`).trim() || `Petición ${i + 1}`,
            description: typeof r.description === 'string' ? r.description : null,
            method: metodoFinal,
            urlTemplate: String(r.url ?? 'https://example.com').trim() || 'https://example.com',
            bodyMode: modoCuerpo,
            sortKey: claveDeOrden(typeof r.sortOrder === 'number' ? r.sortOrder : i),
            createdByUserId: idDeUsuario(principal),
            requestHeaders: {
              create: cabeceras
                .filter((h) => String(h['key'] ?? '').trim() !== '')
                .map((h, idx) => ({
                  name: String(h['key']).trim(),
                  value: String(h['value'] ?? ''),
                  isEnabled: h['enabled'] !== false,
                  sortOrder: idx,
                })),
            },
            requestParams: {
              create: parametros
                .filter((q) => String(q['key'] ?? '').trim() !== '')
                .map((q, idx) => ({
                  kind: 'query' as const,
                  name: String(q['key']).trim(),
                  value: String(q['value'] ?? ''),
                  isEnabled: q['enabled'] !== false,
                  sortOrder: idx,
                })),
            },
            ...(cuerpoCrudo === null
              ? {}
              : {
                  requestBodies: {
                    create: {
                      mode: modoCuerpo,
                      rawContent: cuerpoCrudo,
                      sizeBytes: Buffer.byteLength(cuerpoCrudo, 'utf8'),
                    },
                  },
                }),
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
      // `snapshot_sha256` es `Bytes` y obligatorio, no una cadena hexadecimal.
      // `ck_version_snapshot_xor` exige ademas exactamente una de
      // `snapshot_file_id` / `snapshot_inline`: aqui va la segunda.
      const serializado = JSON.stringify(snapshotData);
      const checksum = createHash('sha256').update(serializado).digest();

      await tx.collectionVersion.create({
        data: {
          collectionId: nuevaCol.id,
          versionNumber: 1,
          source: 'import',
          label: 'v1 (Importación inicial)',
          changeSummary: `Colección importada con ${mapaCarpetas.size} carpetas y ${peticionesCreadas} peticiones.`,
          snapshotInline: snapshotData,
          snapshotSha256: checksum,
          snapshotSizeBytes: Buffer.byteLength(serializado, 'utf8'),
          requestCount: peticionesCreadas,
          createdByUserId: idDeUsuario(principal),
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
      actorUserId: idDeUsuario(principal),
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
        collectionFolders: { where: { deletedAt: null }, orderBy: { sortKey: 'asc' } },
        apiRequests: {
          where: { deletedAt: null },
          orderBy: { sortKey: 'asc' },
          include: {
            requestHeaders: { orderBy: { sortOrder: 'asc' } },
            requestParams: { where: { kind: 'query' }, orderBy: { sortOrder: 'asc' } },
            requestBodies: true,
          },
        },
      },
      orderBy: [{ sortKey: 'asc' }, { name: 'asc' }],
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

      const endpoints = col.apiRequests.map((req) => {
        const headers = aParesDeRespuesta(req.requestHeaders).filter((h) => h.enabled);
        const queryParams = aParesDeRespuesta(req.requestParams).filter((q) => q.enabled);

        lineasMd.push(`### \`[${req.method}]\` ${req.name}`);
        lineasMd.push(`- **URL:** \`${req.urlTemplate}\``);
        if (req.description) {
          lineasMd.push(`- **Descripción:** ${req.description}`);
        }
        if (headers.length > 0) {
          lineasMd.push(`- **Cabeceras:**`);
          for (const h of headers) {
            lineasMd.push(`  - \`${h.key}\`: \`${h.value}\``);
          }
        }
        lineasMd.push('');

        return {
          id: req.id,
          folderId: req.folderId,
          name: req.name,
          description: req.description,
          method: req.method,
          url: req.urlTemplate,
          headers,
          queryParams,
          bodyType: TIPO_CUERPO_PUBLICO[req.bodyMode] ?? 'none',
          body:
            req.requestBodies?.rawContent == null ? null : { raw: req.requestBodies.rawContent },
        };
      });

      return {
        id: col.id,
        name: col.name,
        description: col.description,
        foldersCount: col.collectionFolders.length,
        requestsCount: col.apiRequests.length,
        folders: col.collectionFolders.map((f) => ({
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

    // El campo de relacion se llama `retentionPolicies` (aunque sea a-uno), y
    // el contador de miembros es `workspaceMembers`, no `members`.
    const ws = await this.prisma.client.workspace.findUnique({
      where: { id: workspaceId },
      include: {
        retentionPolicies: true,
        _count: {
          select: {
            collections: { where: { deletedAt: null } },
            environments: true,
            workspaceMembers: true,
          },
        },
      },
    });

    if (!ws) {
      throw new ErrorNoEncontrado('El espacio de trabajo no existe.');
    }

    const extras = ajustesDeRetencionExtra(ws.settings);

    return {
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      description: ws.description,
      // `workspaces` no tiene `isPersonal`. Se deriva de la unica senal real
      // disponible: un espacio sin mas miembros que su propietario.
      isPersonal: ws._count.workspaceMembers <= 1,
      myRole: rol,
      settings: ws.settings,
      counts: {
        collections: ws._count.collections,
        environments: ws._count.environments,
        members: ws._count.workspaceMembers,
      },
      retentionPolicy: {
        requestHistoryDays:
          ws.retentionPolicies?.historyRetentionDays ?? ws.historyRetentionDays,
        auditLogsDays: ws.retentionPolicies?.auditRetentionDays ?? 365,
        collectionRunsDays: extras.collectionRunsDays,
        versionSnapshotsKeep: extras.versionSnapshotsKeep,
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

    for (const [clave, valor] of Object.entries({
      requestHistoryDays: input.requestHistoryDays,
      collectionRunsDays: input.collectionRunsDays,
      auditLogsDays: input.auditLogsDays,
      versionSnapshotsKeep: input.versionSnapshotsKeep,
    })) {
      if (valor !== undefined && (!Number.isInteger(valor) || valor < 1 || valor > 3650)) {
        throw new ErrorValidacion(`El valor de '${clave}' debe ser un entero entre 1 y 3650.`);
      }
    }

    if (input.name !== undefined && !input.name.trim()) {
      throw new ErrorValidacion('El nombre del espacio no puede estar vacío.');
    }

    await this.prisma.client.$transaction(async (tx) => {
      if (input.name !== undefined || input.description !== undefined) {
        if (input.name !== undefined) {
          const existe = await tx.workspace.findFirst({
            where: {
              id: { not: workspaceId },
              ownerUserId: idDeUsuario(principal),
              name: input.name.trim(),
              deletedAt: null,
            },
            select: { id: true },
          });
          if (existe) {
            throw new ErrorConflicto('Ya existe otro espacio con ese nombre.');
          }
        }

        await tx.workspace.update({
          where: { id: workspaceId },
          data: {
            ...(input.name !== undefined ? { name: input.name.trim() } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
          },
        });
      }

      // DOS DESTINOS, Y NO ES UN CAPRICHO.
      //
      // `retention_policies` tiene `history_retention_days` y
      // `audit_retention_days`, pero **no** tiene `collectionRunsDays` ni
      // `versionSnapshotsKeep`: esos dos no existen en el esquema y `prisma/` no
      // es mi ambito de escritura. En vez de inventarme una columna o de
      // descartar silenciosamente la entrada del usuario, se guardan en
      // `workspaces.settings`, que es `Json` y existe justo para ajustes de
      // aplicacion. Queda anotado como HUECO en el informe de fase.
      if (input.requestHistoryDays !== undefined || input.auditLogsDays !== undefined) {
        await tx.retentionPolicy.upsert({
          where: { workspaceId },
          create: {
            workspaceId,
            historyRetentionDays: input.requestHistoryDays ?? 90,
            auditRetentionDays: input.auditLogsDays ?? 365,
            updatedByUserId: idDeUsuario(principal),
          },
          update: {
            ...(input.requestHistoryDays !== undefined
              ? { historyRetentionDays: input.requestHistoryDays }
              : {}),
            ...(input.auditLogsDays !== undefined
              ? { auditRetentionDays: input.auditLogsDays }
              : {}),
            updatedByUserId: idDeUsuario(principal),
          },
        });

        if (input.requestHistoryDays !== undefined) {
          // `request_history.expires_at` se calcula desde esta columna del
          // workspace, asi que las dos tienen que ir a la vez o la retencion
          // efectiva no cambia.
          await tx.workspace.update({
            where: { id: workspaceId },
            data: { historyRetentionDays: input.requestHistoryDays },
          });
        }
      }

      if (input.collectionRunsDays !== undefined || input.versionSnapshotsKeep !== undefined) {
        const actual = await tx.workspace.findUniqueOrThrow({
          where: { id: workspaceId },
          select: { settings: true },
        });
        const previos = ajustesDeRetencionExtra(actual.settings);
        const base =
          typeof actual.settings === 'object' && actual.settings !== null
            ? (actual.settings as Record<string, unknown>)
            : {};
        await tx.workspace.update({
          where: { id: workspaceId },
          data: {
            settings: {
              ...base,
              retention: {
                collectionRunsDays: input.collectionRunsDays ?? previos.collectionRunsDays,
                versionSnapshotsKeep: input.versionSnapshotsKeep ?? previos.versionSnapshotsKeep,
              },
            },
          },
        });
      }
    });

    await this.auditoria.registrar({
      accion: ACCION_AUDITORIA.WORKSPACE_RENOMBRADO,
      actorUserId: idDeUsuario(principal),
      workspaceId,
      recursoTipo: 'workspace',
      recursoId: workspaceId,
      detalles: input as Record<string, unknown>,
    });

    return this.obtenerConfiguracionWorkspace(workspaceId, principal);
  }
}
