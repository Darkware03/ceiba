/**
 * Cliente del módulo `studio` de la API.
 *
 * CONTRATO COMPROBADO, NO SUPUESTO (fase 4, 2026-10-21). Cada ruta de este
 * fichero se ha contrastado una a una contra los decoradores reales de
 * `apps/api/src/modules/studio/studio.controller.ts` y
 * `apps/api/src/modules/workspace/workspace.controller.ts`, con el prefijo
 * global `api/v1` que fija `apps/api/src/bootstrap.ts`.
 *
 * Tres llamadas apuntaban a rutas que **no existen**. Se han corregido o
 * declarado como hueco:
 *
 *  1. `actualizarEntorno` hacía `PATCH /workspaces/:id/environments/:envId`.
 *     En esa ruta el controlador sólo declara `PUT`; el `PATCH` vive en la
 *     ruta corta `/environments/:envId`. Se usa el `PUT` de la ruta larga,
 *     que es la que lleva el workspace y por tanto la que la API puede
 *     autorizar por recurso.
 *  2. `ejecutarColeccion` hacía `POST /workspaces/:id/collections/:colId/run`,
 *     que no existe. La ruta real es `POST /workspaces/:id/runs` con
 *     `{ collectionId, environmentId }` en el cuerpo.
 *  3. `obtenerDetalleCorrida` pedía `GET /workspaces/:id/runs/:runId`.
 *     **No existe ninguna ruta de detalle por ejecución.** Es un HUECO: la
 *     función lanza `ErrorDeHueco` en vez de provocar un 404 que parecería
 *     un fallo pasajero. No se inventa el endpoint.
 */
import { clienteApi } from './cliente';
import { ErrorDeHueco } from './errores';

export type RolColaboracion = 'owner' | 'admin' | 'editor' | 'executor' | 'viewer';

export interface VariableDeEntorno {
  id?: string;
  key: string;
  value: string | null;
  description?: string | null;
  enabled?: boolean;
  isSecret?: boolean;
  sortOrder?: number;
}

export interface EntornoDeWorkspace {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  variables: VariableDeEntorno[];
  createdAt: string;
  updatedAt: string;
}

export type EntornoDto = EntornoDeWorkspace;

export interface EntradaHistorialPeticion {
  id: string;
  workspaceId: string;
  requestId: string | null;
  userId: string;
  userName: string;
  userEmail: string;
  environmentId: string | null;
  environmentName: string | null;
  method: string;
  resolvedUrl: string;
  requestSnapshot: Record<string, unknown>;
  responseStatus: number | null;
  responseTimeMs: number | null;
  responseSizeBytes: number | null;
  responseHeaders: Record<string, unknown> | null;
  responseBodyPreview: string | null;
  errorMessage: string | null;
  executedAt: string;
}

export interface EventoDeAuditoria {
  id: string;
  workspaceId: string | null;
  actorId: string | null;
  actorType: string;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: string;
  metadata: Record<string, unknown> | null;
  occurredAt: string;
}

export interface VersionDeColeccion {
  id: string;
  collectionId: string;
  collectionName: string;
  versionNumber: number;
  label: string | null;
  notes: string | null;
  createdById: string;
  createdByName: string;
  createdAt: string;
}

export interface ItemCorridaDeColeccion {
  id: string;
  requestId: string | null;
  orderIndex: number;
  method: string;
  resolvedUrl: string;
  responseStatus: number | null;
  responseTimeMs: number | null;
  responseSizeBytes: number | null;
  passedAssertionsCount: number;
  failedAssertionsCount: number;
  errorMessage: string | null;
  executedAt: string;
}

export interface ResumenEjecucionDto {
  totalRequests: number;
  succeededRequests: number;
  failedRequests: number;
  durationMs: number;
  results: Array<{
    requestName: string;
    method: string;
    url: string;
    status: number | null;
    durationMs: number;
    passed: boolean;
    error?: string | null;
  }>;
}

export interface CorridaDeColeccion {
  id: string;
  workspaceId: string;
  collectionId: string;
  collectionName: string;
  environmentId: string | null;
  environmentName: string | null;
  triggeredById: string;
  triggeredByName: string;
  status: string;
  totalRequests: number;
  passedCount: number;
  failedCount: number;
  durationMs: number | null;
  startedAt: string;
  finishedAt: string | null;
  items?: ItemCorridaDeColeccion[];
  summary?: ResumenEjecucionDto;
}

export type EjecucionColeccionDto = CorridaDeColeccion;

export interface MiembroDeWorkspace {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  role: RolColaboracion;
  permissions: {
    canView: boolean;
    canEdit: boolean;
    canExecute: boolean;
    canManageMembers: boolean;
    modeLabel: string;
  };
  joinedAt: string;
}

export type MiembroWorkspaceDto = MiembroDeWorkspace;

export interface InvitacionDeWorkspace {
  id: string;
  email: string;
  role: RolColaboracion;
  modeLabel: string;
  status: string;
  inviteToken?: string;
  inviteUrl?: string;
  invitedByName: string;
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export type InvitacionWorkspaceDto = InvitacionDeWorkspace;
export type InvitacionCreadaDto = InvitacionDeWorkspace & { inviteToken: string; inviteUrl: string };

export interface InvitacionPublicaDto {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug?: string;
  email: string;
  role: RolColaboracion;
  modeLabel?: string;
  status: string;
  invitedByName: string;
  invitedByEmail: string;
  expiresAt: string;
  isExpired?: boolean;
}

export interface DocumentacionColeccionDto {
  id: string;
  name: string;
  description: string | null;
  versionCount?: number;
  foldersCount?: number;
  requestsCount?: number;
  markdown?: string;
  requests: Array<{
    id: string;
    name: string;
    method: string;
    url: string;
    description: string | null;
  }>;
}

export interface DocumentacionDeColeccion {
  collectionId: string;
  collectionName: string;
  description: string | null;
  versionCount: number;
  foldersCount: number;
  requestsCount: number;
  markdown: string;
}

export interface DocumentacionWorkspaceDto {
  workspace: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
  };
  generatedAt: string;
  collections: DocumentacionColeccionDto[];
  items: DocumentacionDeColeccion[];
  markdown: string;
}

/**
 * Ajustes de un workspace, **ya traducidos** de la forma real de la API.
 *
 * `GET /workspaces/:id/settings` responde PLANO y en otro vocabulario
 * (`studio-core.service.ts:1565`):
 * `{ id, name, slug, description, isPersonal, myRole, settings, counts,
 *    retentionPolicy:{ requestHistoryDays, auditLogsDays, collectionRunsDays,
 *    versionSnapshotsKeep } }`.
 *
 * Antes este tipo prometa `workspace{…}`, `currentUserRole`, `canEdit` y
 * `canManageMembers`, y la función haca un `get<T>` directo: **ninguno de
 * esos campos llegaba**. Un `as` no comprueba nada en ejecución, así que la
 * vista de Entornos se quedaba en solo lectura para todo el mundo y nadie veía
 * un error. Ahora se mapea de verdad y se exponen las dos formas.
 *
 * `ownerId`, `createdAt` y `updatedAt` son **opcionales a propósito**: este
 * endpoint no los devuelve y rellenarlos con un valor inventado sería peor
 * que no tenerlos.
 */
export interface ConfiguracionDeWorkspace {
  workspace: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    isPersonal: boolean;
    ownerId?: string;
    createdAt?: string;
    updatedAt?: string;
  };
  currentUserRole: RolColaboracion;
  /** También con el nombre que usa la API, para quien lea la forma cruda. */
  myRole: RolColaboracion;
  canEdit: boolean;
  canManageMembers: boolean;
  retentionPolicy: {
    /** Nombres declarados históricamente por el cliente. */
    historyRetentionDays: number;
    runRetentionDays: number;
    auditRetentionDays: number;
    /** Nombres reales de la API. */
    requestHistoryDays: number;
    collectionRunsDays: number;
    auditLogsDays: number;
    versionSnapshotsKeep: number;
  };
  counts: {
    members: number;
    collections: number;
    environments: number;
  };
}

/**
 * Jerarquía de roles **del servidor**, transcrita de
 * `studio-collab.service.ts:33`. No es una regla del cliente: es la misma
 * escala con la que la API decide, y sólo se usa para no pintar controles que
 * el servidor va a rechazar. Quien autoriza sigue siendo la API.
 */
const JERARQUIA_DE_ROLES: Record<RolColaboracion, number> = {
  viewer: 10,
  executor: 20,
  editor: 30,
  admin: 40,
  owner: 50,
};

function alMenos(rol: RolColaboracion, minimo: RolColaboracion): boolean {
  return (JERARQUIA_DE_ROLES[rol] ?? 0) >= JERARQUIA_DE_ROLES[minimo];
}

export type ListaConItems<T> = T[] & { items: T[] };

function envolverLista<T>(items: T[]): ListaConItems<T> {
  return Object.assign([...items], { items });
}

function enriquecerCorrida(run: CorridaDeColeccion): CorridaDeColeccion {
  const items = run.items ?? [];
  return {
    ...run,
    summary: run.summary ?? {
      totalRequests: run.totalRequests ?? items.length,
      succeededRequests: run.passedCount ?? items.filter((i) => i.failedAssertionsCount === 0 && !i.errorMessage).length,
      failedRequests: run.failedCount ?? items.filter((i) => i.failedAssertionsCount > 0 || Boolean(i.errorMessage)).length,
      durationMs: run.durationMs ?? 0,
      results: items.map((item, idx) => ({
        requestName: `Petición #${idx + 1} (${item.method})`,
        method: item.method,
        url: item.resolvedUrl,
        status: item.responseStatus,
        durationMs: item.responseTimeMs ?? 0,
        passed: item.failedAssertionsCount === 0 && !item.errorMessage,
        error: item.errorMessage,
      })),
    },
  };
}

export async function listarEntornos(
  workspaceId: string,
): Promise<ListaConItems<EntornoDeWorkspace>> {
  const res = await clienteApi.get<EntornoDeWorkspace[] | { items: EntornoDeWorkspace[] }>(
    `/workspaces/${workspaceId}/environments`,
  );
  const items = Array.isArray(res) ? res : (res.items ?? []);
  return envolverLista(items);
}

export async function crearEntorno(
  workspaceId: string,
  datos: {
    name: string;
    description?: string;
    isDefault?: boolean;
    variables?: VariableDeEntorno[];
  },
): Promise<EntornoDeWorkspace> {
  return clienteApi.post<EntornoDeWorkspace>(`/workspaces/${workspaceId}/environments`, datos);
}

/**
 * `PUT /workspaces/:workspaceId/environments/:environmentId`.
 *
 * `PUT` y no `PATCH`: en esa ruta el controlador sólo declara `PUT`
 * (`studio.controller.ts:235`). El cuerpo sigue siendo parcial, así que la
 * semántica de actualización no cambia para quien la llama.
 */
export async function actualizarEntorno(
  workspaceId: string,
  environmentId: string,
  datos: {
    name?: string;
    description?: string | null;
    isDefault?: boolean;
    variables?: VariableDeEntorno[];
  },
): Promise<EntornoDeWorkspace> {
  const res = await clienteApi.put<EntornoDeWorkspace & { environment?: EntornoDeWorkspace }>(
    `/workspaces/${workspaceId}/environments/${environmentId}`,
    datos,
  );
  // El controlador responde `{ ...entorno, environment }`: se aceptan las dos
  // formas sin suponer cuál llega.
  return res.environment ?? res;
}

export async function eliminarEntorno(workspaceId: string, environmentId: string): Promise<void> {
  await clienteApi.delete(`/workspaces/${workspaceId}/environments/${environmentId}`);
}

export async function listarHistorialPeticiones(
  workspaceId: string,
  limit = 60,
): Promise<{ items: EntradaHistorialPeticion[] }> {
  const res = await clienteApi.get<
    EntradaHistorialPeticion[] | { items: EntradaHistorialPeticion[] }
  >(`/workspaces/${workspaceId}/history/requests?limit=${limit}`);
  return Array.isArray(res) ? { items: res } : { items: res.items ?? [] };
}

export async function listarHistorialModificaciones(
  workspaceId: string,
  limit = 100,
): Promise<{ items: EventoDeAuditoria[]; versions: VersionDeColeccion[] }> {
  const res = await clienteApi.get<{
    items?: EventoDeAuditoria[];
    auditLogs?: EventoDeAuditoria[];
    versions?: VersionDeColeccion[];
    collectionVersions?: VersionDeColeccion[];
  }>(`/workspaces/${workspaceId}/history/changes?limit=${limit}`);
  return {
    items: res.items ?? res.auditLogs ?? [],
    versions: res.versions ?? res.collectionVersions ?? [],
  };
}

export async function listarCorridasColeccion(
  workspaceId: string,
): Promise<{ items: CorridaDeColeccion[] }> {
  const res = await clienteApi.get<CorridaDeColeccion[] | { items: CorridaDeColeccion[] }>(
    `/workspaces/${workspaceId}/runs`,
  );
  const raw = Array.isArray(res) ? res : (res.items ?? []);
  return { items: raw.map(enriquecerCorrida) };
}

export async function listarEjecucionesColeccion(
  workspaceId: string,
): Promise<ListaConItems<CorridaDeColeccion>> {
  const res = await listarCorridasColeccion(workspaceId);
  return envolverLista(res.items);
}

/**
 * HUECO DEL CONTRATO: no hay ruta de detalle por ejecución.
 *
 * `studio.controller.ts` declara `GET /workspaces/:id/runs` (lista) y
 * `POST /workspaces/:id/runs` (lanzar), pero **ninguna**
 * `GET /workspaces/:id/runs/:runId`. La lista ya trae `items` y `summary` de
 * cada corrida, así que la vista puede presentar el detalle sin esta llamada.
 *
 * Se conserva la función y lanza `ErrorDeHueco`: borrarla escodería el hueco,
 * y dejarla pidiendo la ruta inexistente convertiría un hueco conocido en un
 * 404 confuso con un botón de reintento que no funcionaría nunca.
 */
export function obtenerDetalleCorrida(
  workspaceId: string,
  runId: string,
): Promise<CorridaDeColeccion> {
  return Promise.reject(
    new ErrorDeHueco(
      `GET /workspaces/${workspaceId}/runs/${runId}`,
      'La API no expone el detalle de una ejecución concreta: sólo la lista ' +
        '(GET /workspaces/:id/runs), que ya incluye el resumen y las peticiones ' +
        'de cada corrida.',
    ),
  );
}

export async function ejecutarColeccion(
  workspaceId: string,
  collectionIdOrPayload:
    | string
    | {
        collectionId: string;
        environmentId?: string | null;
      },
  environmentIdOptional?: string,
): Promise<CorridaDeColeccion> {
  const payload =
    typeof collectionIdOrPayload === 'string'
      ? {
          collectionId: collectionIdOrPayload,
          environmentId: environmentIdOptional || undefined,
        }
      : collectionIdOrPayload;
  // `POST /workspaces/:id/runs` con el `collectionId` en el cuerpo: es la ruta
  // real (`studio.controller.ts:430`). La que había antes,
  // `/collections/:colId/run`, no existe en la API.
  const res = await clienteApi.post<CorridaDeColeccion & { run?: CorridaDeColeccion }>(
    `/workspaces/${workspaceId}/runs`,
    {
      collectionId: payload.collectionId,
      environmentId: payload.environmentId ?? null,
    },
  );
  return enriquecerCorrida(res.run ?? res);
}

export async function exportarColeccion(
  workspaceId: string,
  collectionId: string,
): Promise<Record<string, unknown>> {
  return clienteApi.get<Record<string, unknown>>(
    `/workspaces/${workspaceId}/collections/${collectionId}/export`,
  );
}

export async function importarColeccion(
  workspaceId: string,
  payload: Record<string, unknown>,
): Promise<{
  id: string;
  collectionId: string;
  name: string;
  collectionName: string;
  foldersImported: number;
  requestsImported: number;
  importedFolders: number;
  importedRequests: number;
  versionNumber: number;
}> {
  const res = await clienteApi.post<{
    id?: string;
    collectionId?: string;
    name?: string;
    collectionName?: string;
    foldersImported?: number;
    requestsImported?: number;
    importedFolders?: number;
    importedRequests?: number;
    versionNumber?: number;
  }>(`/workspaces/${workspaceId}/collections/import`, payload);
  const cid = res.collectionId ?? res.id ?? '';
  const cname = res.collectionName ?? res.name ?? 'Colección importada';
  const fCount = res.foldersImported ?? res.importedFolders ?? 0;
  const rCount = res.requestsImported ?? res.importedRequests ?? 0;
  return {
    id: cid,
    collectionId: cid,
    name: cname,
    collectionName: cname,
    foldersImported: fCount,
    requestsImported: rCount,
    importedFolders: fCount,
    importedRequests: rCount,
    versionNumber: res.versionNumber ?? 1,
  };
}

export async function obtenerDocumentacionWorkspace(
  workspaceId: string,
): Promise<DocumentacionWorkspaceDto> {
  const res = await clienteApi.get<{
    workspace: { id: string; name: string; slug: string; description: string | null };
    generatedAt: string;
    items?: DocumentacionDeColeccion[];
    collections?: DocumentacionColeccionDto[];
    markdown?: string;
  }>(`/workspaces/${workspaceId}/documentation`);
  const items = res.items ?? [];
  const collections: DocumentacionColeccionDto[] =
    res.collections ??
    items.map((item) => ({
      id: item.collectionId,
      name: item.collectionName,
      description: item.description,
      versionCount: item.versionCount,
      foldersCount: item.foldersCount,
      requestsCount: item.requestsCount,
      markdown: item.markdown,
      requests: [],
    }));
  const markdownGlobal =
    res.markdown ?? items.map((i) => i.markdown).join('\n\n---\n\n');
  return {
    workspace: res.workspace,
    generatedAt: res.generatedAt,
    items,
    collections,
    markdown: markdownGlobal,
  };
}

/** `GET /workspaces/:workspaceId/settings`, traducido a la forma declarada. */
export async function obtenerConfiguracionWorkspace(
  workspaceId: string,
): Promise<ConfiguracionDeWorkspace> {
  const res = await clienteApi.get<{
    id?: string;
    name?: string;
    slug?: string;
    description?: string | null;
    isPersonal?: boolean;
    myRole?: RolColaboracion;
    currentUserRole?: RolColaboracion;
    canEdit?: boolean;
    canManageMembers?: boolean;
    workspace?: {
      id?: string;
      name?: string;
      slug?: string;
      description?: string | null;
      isPersonal?: boolean;
      ownerId?: string;
      createdAt?: string;
      updatedAt?: string;
    };
    counts?: { members?: number; collections?: number; environments?: number };
    retentionPolicy?: {
      requestHistoryDays?: number;
      collectionRunsDays?: number;
      auditLogsDays?: number;
      versionSnapshotsKeep?: number;
      historyRetentionDays?: number;
      runRetentionDays?: number;
      auditRetentionDays?: number;
    };
  }>(`/workspaces/${workspaceId}/settings`);

  const ws = res.workspace ?? {};
  const rol: RolColaboracion = res.currentUserRole ?? res.myRole ?? 'viewer';
  const ret = res.retentionPolicy ?? {};

  const historial = ret.requestHistoryDays ?? ret.historyRetentionDays ?? 0;
  const corridas = ret.collectionRunsDays ?? ret.runRetentionDays ?? 0;
  const auditoria = ret.auditLogsDays ?? ret.auditRetentionDays ?? 0;

  return {
    workspace: {
      id: ws.id ?? res.id ?? workspaceId,
      name: ws.name ?? res.name ?? '',
      slug: ws.slug ?? res.slug ?? '',
      description: ws.description ?? res.description ?? null,
      isPersonal: ws.isPersonal ?? res.isPersonal ?? false,
      ...(ws.ownerId === undefined ? {} : { ownerId: ws.ownerId }),
      ...(ws.createdAt === undefined ? {} : { createdAt: ws.createdAt }),
      ...(ws.updatedAt === undefined ? {} : { updatedAt: ws.updatedAt }),
    },
    currentUserRole: rol,
    myRole: rol,
    // La API no manda estos dos: se derivan de su propia jerarquía de roles.
    // Editar entornos y ajustes exige `editor`; gestionar miembros, `admin`.
    canEdit: res.canEdit ?? alMenos(rol, 'editor'),
    canManageMembers: res.canManageMembers ?? alMenos(rol, 'admin'),
    retentionPolicy: {
      historyRetentionDays: historial,
      runRetentionDays: corridas,
      auditRetentionDays: auditoria,
      requestHistoryDays: historial,
      collectionRunsDays: corridas,
      auditLogsDays: auditoria,
      versionSnapshotsKeep: ret.versionSnapshotsKeep ?? 0,
    },
    counts: {
      members: res.counts?.members ?? 0,
      collections: res.counts?.collections ?? 0,
      environments: res.counts?.environments ?? 0,
    },
  };
}

/**
 * `PATCH /workspaces/:workspaceId/settings`.
 *
 * El controlador espera la retención **plana**
 * (`requestHistoryDays`, `collectionRunsDays`, `auditLogsDays`,
 * `versionSnapshotsKeep`; `studio.controller.ts:48-80`), no un
 * `retentionPolicy{…}` anidado. Lo que se enviaba antes **se descartaba en
 * silencio**: la interfaz decía «guardado» y la retención no cambiaba nunca.
 * Se aceptan los dos vocabularios de entrada y se envía el que entiende la API.
 */
export async function actualizarConfiguracionWorkspace(
  workspaceId: string,
  datos: {
    name?: string;
    description?: string | null;
    requestHistoryDays?: number;
    collectionRunsDays?: number;
    auditLogsDays?: number;
    versionSnapshotsKeep?: number;
    retentionPolicy?: {
      historyRetentionDays?: number;
      runRetentionDays?: number;
      auditRetentionDays?: number;
      requestHistoryDays?: number;
      collectionRunsDays?: number;
      auditLogsDays?: number;
      versionSnapshotsKeep?: number;
    };
  },
): Promise<ConfiguracionDeWorkspace> {
  const ret = datos.retentionPolicy ?? {};
  const cuerpo: Record<string, unknown> = {};

  if (datos.name !== undefined) cuerpo['name'] = datos.name;
  if (datos.description !== undefined) cuerpo['description'] = datos.description;

  const historial = datos.requestHistoryDays ?? ret.requestHistoryDays ?? ret.historyRetentionDays;
  const corridas = datos.collectionRunsDays ?? ret.collectionRunsDays ?? ret.runRetentionDays;
  const auditoria = datos.auditLogsDays ?? ret.auditLogsDays ?? ret.auditRetentionDays;
  const versiones = datos.versionSnapshotsKeep ?? ret.versionSnapshotsKeep;

  if (historial !== undefined) cuerpo['requestHistoryDays'] = historial;
  if (corridas !== undefined) cuerpo['collectionRunsDays'] = corridas;
  if (auditoria !== undefined) cuerpo['auditLogsDays'] = auditoria;
  if (versiones !== undefined) cuerpo['versionSnapshotsKeep'] = versiones;

  await clienteApi.patch(`/workspaces/${workspaceId}/settings`, cuerpo);
  // El PATCH responde la fila cruda; se relee por la vía que sí está mapeada
  // para no devolver dos formas distintas según el camino.
  return obtenerConfiguracionWorkspace(workspaceId);
}

export async function listarColaboradores(
  workspaceId: string,
): Promise<{
  currentUserRole: RolColaboracion;
  canEdit: boolean;
  canManageMembers: boolean;
  members: MiembroDeWorkspace[];
  invitations: InvitacionDeWorkspace[];
}> {
  return clienteApi.get(`/workspaces/${workspaceId}/collaboration`);
}

export async function listarMiembrosWorkspace(
  workspaceId: string,
): Promise<MiembroWorkspaceDto[]> {
  // `workspace.controller.ts:107` responde `{ miembros }`, **en español**.
  // Leer sólo `res.members` devolvía siempre una lista vacía sin error: la
  // interfaz diría «este workspace no tiene miembros» con el workspace lleno.
  const res = await clienteApi.get<
    MiembroWorkspaceDto[] | { miembros?: MiembroWorkspaceDto[]; members?: MiembroWorkspaceDto[] }
  >(`/workspaces/${workspaceId}/members`);
  if (Array.isArray(res)) return res;
  return res.miembros ?? res.members ?? [];
}

export async function listarInvitacionesWorkspace(
  workspaceId: string,
): Promise<InvitacionWorkspaceDto[]> {
  const res = await clienteApi.get<
    InvitacionWorkspaceDto[] | { invitations: InvitacionWorkspaceDto[] }
  >(`/workspaces/${workspaceId}/invitations`);
  return Array.isArray(res) ? res : (res.invitations ?? []);
}

export async function invitarColaborador(
  workspaceId: string,
  datos: {
    email?: string;
    role: 'admin' | 'editor' | 'executor' | 'viewer';
    expiresInDays?: number;
  },
): Promise<InvitacionCreadaDto> {
  const res = await clienteApi.post<InvitacionDeWorkspace>(
    `/workspaces/${workspaceId}/invitations`,
    datos,
  );
  const token = res.inviteToken ?? res.inviteUrl?.split('/invitacion/')[1] ?? '';
  return {
    ...res,
    inviteToken: token,
    inviteUrl: res.inviteUrl ?? `${window.location.origin}/invitacion/${token}`,
  };
}

export const crearInvitacionWorkspace = invitarColaborador;

export async function cambiarRolColaborador(
  workspaceId: string,
  memberUserId: string,
  role: 'admin' | 'editor' | 'executor' | 'viewer',
): Promise<MiembroDeWorkspace> {
  return clienteApi.patch<MiembroDeWorkspace>(
    `/workspaces/${workspaceId}/members/${memberUserId}`,
    { role },
  );
}

export const actualizarRolMiembro = cambiarRolColaborador;

export async function eliminarColaborador(
  workspaceId: string,
  memberUserId: string,
): Promise<void> {
  await clienteApi.delete(`/workspaces/${workspaceId}/members/${memberUserId}`);
}

export const eliminarMiembroWorkspace = eliminarColaborador;

export async function revocarInvitacion(
  workspaceId: string,
  invitationId: string,
): Promise<void> {
  await clienteApi.delete(`/workspaces/${workspaceId}/invitations/${invitationId}`);
}

export const revocarInvitacionWorkspace = revocarInvitacion;

/**
 * `GET /invitations/:token`.
 *
 * **Hay que mapear**: la API no devuelve la forma que este módulo declaraba.
 * `studio-collab.service.ts:288-297` responde
 * `{ id, status, email, role, modeLabel, expiresAt, workspace:{id,name,slug,description}, invitedBy:{id,email,displayName} }`
 * y el controlador añade una copia en `invitation`. El `InvitacionPublicaDto`
 * de aquí pide `workspaceId`, `workspaceName`, `invitedByName`,
 * `invitedByEmail` e `isExpired`, que **no existen** en esa respuesta: antes
 * se hacía un `get<InvitacionPublicaDto>` directo y todos esos campos
 * llegaban `undefined` sin que nadie se enterase, porque un `as` no comprueba
 * nada en ejecución. Aquí se traduce de la forma real a la declarada.
 *
 * `isExpired` sale de `status === 'expired'`, que es lo que el servicio ya
 * calcula comparando `expiresAt` con el reloj del servidor —mejor que el del
 * navegador, que el usuario puede tener mal—.
 */
export async function consultarInvitacionPorToken(token: string): Promise<InvitacionPublicaDto> {
  const res = await clienteApi.get<{
    id?: string;
    status?: string;
    email?: string;
    role?: RolColaboracion;
    modeLabel?: string;
    expiresAt?: string;
    workspace?: { id?: string; name?: string; slug?: string; description?: string | null };
    invitedBy?: { id?: string; email?: string; displayName?: string };
    // Formas alternativas, por si la API se normaliza más adelante.
    workspaceId?: string;
    workspaceName?: string;
    invitedByName?: string;
    invitedByEmail?: string;
    isExpired?: boolean;
  }>(`/invitations/${encodeURIComponent(token)}`);

  const estado = res.status ?? 'pending';
  return {
    id: res.id ?? '',
    workspaceId: res.workspaceId ?? res.workspace?.id ?? '',
    workspaceName: res.workspaceName ?? res.workspace?.name ?? '',
    workspaceSlug: res.workspace?.slug,
    email: res.email ?? '',
    role: res.role ?? 'viewer',
    modeLabel: res.modeLabel,
    status: estado,
    invitedByName: res.invitedByName ?? res.invitedBy?.displayName ?? '',
    invitedByEmail: res.invitedByEmail ?? res.invitedBy?.email ?? '',
    expiresAt: res.expiresAt ?? '',
    isExpired: res.isExpired ?? estado === 'expired',
  };
}

export const obtenerInvitacionPorToken = consultarInvitacionPorToken;

/**
 * `POST /invitations/:token/accept`.
 *
 * La API devuelve **sólo** `{ workspaceId, workspaceName, role, modeLabel }`
 * (`studio-collab.service.ts:382-389`).
 *
 *  - `accepted` se deriva de que la llamada **resuelva**: un 2xx de este
 *    endpoint significa que la invitación quedó aceptada. No es un dato
 *    inventado, es la lectura del código de estado.
 *  - `alreadyMember` **no se puede saber**: el servicio resuelve la
 *    re-aceptación con un `upsert` silencioso y no informa de si la fila ya
 *    existía. Se deja `undefined` a propósito en vez de adivinar un `false`
 *    que la interfaz presentaría como un hecho. HUECO declarado en el informe
 *    de fase 4: que la API lo devuelva, porque el `upsert` ya lo sabe.
 */
export async function aceptarInvitacionPorToken(token: string): Promise<{
  accepted: boolean;
  alreadyMember?: boolean;
  workspaceId: string;
  workspaceName: string;
  role: RolColaboracion;
  modeLabel: string;
}> {
  const res = await clienteApi.post<{
    workspaceId?: string;
    workspaceName?: string;
    role?: RolColaboracion;
    modeLabel?: string;
    accepted?: boolean;
    alreadyMember?: boolean;
  }>(`/invitations/${encodeURIComponent(token)}/accept`);

  return {
    accepted: res.accepted ?? true,
    ...(res.alreadyMember === undefined ? {} : { alreadyMember: res.alreadyMember }),
    workspaceId: res.workspaceId ?? '',
    workspaceName: res.workspaceName ?? '',
    role: res.role ?? 'viewer',
    modeLabel: res.modeLabel ?? '',
  };
}

export const apiStudio = {
  listarEntornos,
  crearEntorno,
  actualizarEntorno,
  eliminarEntorno,
  listarHistorialPeticiones,
  listarHistorialModificaciones,
  listarCorridasColeccion,
  listarEjecucionesColeccion,
  obtenerDetalleCorrida,
  ejecutarColeccion,
  exportarColeccion,
  importarColeccion,
  obtenerDocumentacionWorkspace,
  obtenerConfiguracionWorkspace,
  actualizarConfiguracionWorkspace,
  listarColaboradores,
  listarMiembrosWorkspace,
  listarInvitacionesWorkspace,
  invitarColaborador,
  crearInvitacionWorkspace,
  cambiarRolColaborador,
  actualizarRolMiembro,
  eliminarColaborador,
  eliminarMiembroWorkspace,
  revocarInvitacion,
  revocarInvitacionWorkspace,
  consultarInvitacionPorToken,
  obtenerInvitacionPorToken,
  aceptarInvitacionPorToken,
};
