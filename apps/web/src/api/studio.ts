import { clienteApi } from './cliente';

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

export interface ConfiguracionDeWorkspace {
  workspace: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    isPersonal: boolean;
    ownerId: string;
    createdAt: string;
    updatedAt: string;
  };
  currentUserRole: RolColaboracion;
  canEdit: boolean;
  canManageMembers: boolean;
  retentionPolicy: {
    historyRetentionDays: number;
    runRetentionDays: number;
    auditRetentionDays: number;
  };
  counts: {
    members: number;
    collections: number;
    environments: number;
  };
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
  return clienteApi.patch<EntornoDeWorkspace>(
    `/workspaces/${workspaceId}/environments/${environmentId}`,
    datos,
  );
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

export async function obtenerDetalleCorrida(
  workspaceId: string,
  runId: string,
): Promise<CorridaDeColeccion> {
  const run = await clienteApi.get<CorridaDeColeccion>(
    `/workspaces/${workspaceId}/runs/${runId}`,
  );
  return enriquecerCorrida(run);
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
  const run = await clienteApi.post<CorridaDeColeccion>(
    `/workspaces/${workspaceId}/collections/${payload.collectionId}/run`,
    { environmentId: payload.environmentId || undefined },
  );
  return enriquecerCorrida(run);
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

export async function obtenerConfiguracionWorkspace(
  workspaceId: string,
): Promise<ConfiguracionDeWorkspace> {
  return clienteApi.get<ConfiguracionDeWorkspace>(`/workspaces/${workspaceId}/settings`);
}

export async function actualizarConfiguracionWorkspace(
  workspaceId: string,
  datos: {
    name?: string;
    description?: string | null;
    retentionPolicy?: {
      historyRetentionDays?: number;
      runRetentionDays?: number;
      auditRetentionDays?: number;
    };
  },
): Promise<ConfiguracionDeWorkspace> {
  return clienteApi.patch<ConfiguracionDeWorkspace>(`/workspaces/${workspaceId}/settings`, datos);
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
  const res = await clienteApi.get<MiembroWorkspaceDto[] | { members: MiembroWorkspaceDto[] }>(
    `/workspaces/${workspaceId}/members`,
  );
  return Array.isArray(res) ? res : (res.members ?? []);
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

export async function consultarInvitacionPorToken(token: string): Promise<InvitacionPublicaDto> {
  return clienteApi.get<InvitacionPublicaDto>(`/invitations/${encodeURIComponent(token)}`);
}

export const obtenerInvitacionPorToken = consultarInvitacionPorToken;

export async function aceptarInvitacionPorToken(token: string): Promise<{
  accepted: boolean;
  alreadyMember?: boolean;
  workspaceId: string;
  workspaceName: string;
  role: RolColaboracion;
  modeLabel: string;
}> {
  return clienteApi.post(`/invitations/${encodeURIComponent(token)}/accept`);
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
