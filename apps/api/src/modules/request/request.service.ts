import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { RELOJ, type Reloj } from '../../platform/time/clock.ts';
import { EntradaInvalida, RecursoNoEncontrado } from '../../platform/errors/domain-errors.ts';
import { ACCION_AUDITORIA, PUERTO_DE_AUDITORIA, type PuertoDeAuditoria } from '../../platform/audit/ports.ts';
import type { ResolutorDeRecurso } from '../../platform/auth/ports.ts';
import { RegistroDeResolutores } from '../../platform/auth/resource-resolver.registry.ts';
import {
  RepositorioDeFicheros,
  ServicioDeFicheros,
  vistaBreveDeFichero,
  type FilaFichero,
} from '../file/file.public.ts';
import {
  construirCuerpoParaElMotor,
  type ResultadoCuerpoParaElMotor,
} from './engine-body.ts';
import {
  RepositorioDePeticiones,
  type FilaCarpeta,
  type FilaPeticion,
  type FilaPeticionCompleta,
} from './request.repository.ts';
import {
  generarCurl,
  pareceCredencial,
  type ModoCuerpoCurl,
  type PeticionParaCurl,
  type ResultadoCurl,
} from './curl.ts';
import {
  problemasDeFormaDelCuerpo,
  type EntradaActualizarPeticion,
  type EntradaCrearPeticion,
} from './dto/request.dto.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * Las 7 rutas del `BRIEF-FASE6` §1, sobre la tabla `api_requests` que ya
 * existe. La colección deja de estar muerta.
 *
 * AUTORIZACIÓN. El servicio **no** comprueba permisos: los comprueba
 * `GuardDeAutorizacion`, que es global y declarativo, y al que este servicio
 * alimenta registrándose como `ResolutorDeRecurso` de tipo `request`. La
 * cadena es la del ADR-0009 §7.4:
 *
 *     requestId → api_requests.collection_id → collections.workspace_id
 *               → workspace_members(workspace_id, user_id, status='active')
 *
 * Sin fila activa el guard lanza **404**, no 403, y sin rol suficiente **403**.
 * Por eso aquí no hay ni un `if (esMiembro)`: duplicarlo sería crear un
 * segundo sitio donde el permiso puede divergir, que es exactamente lo que el
 * ADR evita. Lo que sí garantiza el resolutor es que una petición borrada
 * lógicamente, o de una colección borrada, resuelve a `null` → 404.
 *
 * LISTAS DE PERMITIDOS EN LA SALIDA (C-LEAK-04). Ninguna función de este
 * fichero serializa una fila del ORM: todas proyectan campo a campo. El valor
 * de una cabecera secreta **no existe** en la fila (lo prohíbe
 * `ck_header_secret_xor`), y aun así la proyección lo fija a `null` de forma
 * explícita para que un cambio futuro del esquema no lo cuele.
 * ════════════════════════════════════════════════════════════════════════════
 */
@Injectable()
export class ServicioDePeticiones implements ResolutorDeRecurso, OnModuleInit {
  readonly tipo = 'request';

  constructor(
    private readonly repo: RepositorioDePeticiones,
    private readonly ficheros: RepositorioDeFicheros,
    private readonly servicioDeFicheros: ServicioDeFicheros,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(PUERTO_DE_AUDITORIA) private readonly auditoria: PuertoDeAuditoria,
    private readonly resolutores: RegistroDeResolutores,
  ) {}

  onModuleInit(): void {
    this.resolutores.registrar(this);
  }

  async resolverWorkspaceId(peticionId: string): Promise<string | null> {
    return this.repo.workspaceIdDePeticion(peticionId);
  }

  // -------------------------------------------------------------------------
  // 1. GET /collections/:collectionId/requests
  // -------------------------------------------------------------------------

  async listar(coleccionId: string): Promise<{
    peticiones: readonly Record<string, unknown>[];
    carpetas: readonly Record<string, unknown>[];
  }> {
    const coleccion = await this.repo.coleccionViva(coleccionId);
    if (coleccion === null) throw new RecursoNoEncontrado('Colección no encontrada.');
    const { peticiones, carpetas } = await this.repo.listarDeColeccion(coleccionId);
    return {
      peticiones: peticiones.map(vistaResumen),
      carpetas: carpetas.map(vistaCarpeta),
    };
  }

  // -------------------------------------------------------------------------
  // 2. POST /collections/:collectionId/requests
  // -------------------------------------------------------------------------

  async crear(
    coleccionId: string,
    entrada: EntradaCrearPeticion,
    actorId: string,
    ip: string,
  ): Promise<FilaPeticionCompleta> {
    const coleccion = await this.repo.coleccionViva(coleccionId);
    if (coleccion === null) throw new RecursoNoEncontrado('Colección no encontrada.');

    const folderId = entrada.folderId ?? null;
    if (folderId !== null && !(await this.repo.carpetaDeLaColeccion(folderId, coleccionId))) {
      throw new EntradaInvalida('La carpeta indicada no pertenece a esta colección.', [
        'folderId: no pertenece a la colección',
      ]);
    }

    await this.#comprobarFicheros(coleccion.workspaceId, entrada);

    const id = await this.repo.crear(
      coleccionId,
      {
        name: entrada.name,
        method: entrada.method ?? 'GET',
        methodCustom: entrada.methodCustom ?? null,
        url: entrada.url,
        folderId,
        description: entrada.description ?? null,
        headers: entrada.headers,
        queryParams: entrada.queryParams,
        bodyType: entrada.bodyType ?? 'none',
        body: entrada.body ?? null,
        bodyContentType: entrada.bodyContentType,
        bodyFields: entrada.bodyFields,
        binaryFileId: entrada.binaryFileId,
        sortKey: entrada.sortKey ?? null,
      },
      actorId,
      this.reloj.ahora(),
    );

    this.auditoria.registrar({
      accion: ACCION_AUDITORIA.PETICION_CREADA,
      actorUserId: actorId,
      sessionId: null,
      workspaceId: coleccion.workspaceId,
      recursoTipo: 'request',
      recursoId: id,
      clientIp: ip,
      // Nunca se registran valores de cabecera: podrían ser credenciales.
      detalles: { name: entrada.name, method: entrada.method ?? 'GET', collectionId: coleccionId },
    });

    return this.obtener(id);
  }

  // -------------------------------------------------------------------------
  // 3. GET /requests/:requestId
  // -------------------------------------------------------------------------

  async obtener(peticionId: string): Promise<FilaPeticionCompleta> {
    const fila = await this.repo.buscarCompleta(peticionId);
    if (fila === null) throw new RecursoNoEncontrado('Petición no encontrada.');
    return fila;
  }

  // -------------------------------------------------------------------------
  // 4. PATCH /requests/:requestId
  // -------------------------------------------------------------------------

  async actualizar(
    peticionId: string,
    cambios: EntradaActualizarPeticion,
    actorId: string,
    ip: string,
  ): Promise<FilaPeticionCompleta> {
    const actual = await this.obtener(peticionId);

    // `ck_request_custom_verb` se comprueba contra el ESTADO FINAL, no contra
    // el cuerpo: un PATCH que sólo trae `method: 'GET'` tiene que limpiar el
    // `method_custom` que quedó de antes, o el CHECK del motor rechaza la fila.
    const metodoFinal = cambios.method ?? actual.method;
    let metodoPersonalizadoFinal =
      cambios.methodCustom !== undefined ? cambios.methodCustom : actual.methodCustom;
    if (metodoFinal === 'CUSTOM') {
      if (metodoPersonalizadoFinal === null || metodoPersonalizadoFinal.trim() === '') {
        throw new EntradaInvalida('Con method=CUSTOM hay que indicar methodCustom.', [
          'methodCustom: obligatorio con method=CUSTOM',
        ]);
      }
    } else {
      metodoPersonalizadoFinal = null;
    }

    const carpetaFinal = cambios.folderId !== undefined ? cambios.folderId : undefined;
    if (
      carpetaFinal !== undefined &&
      carpetaFinal !== null &&
      !(await this.repo.carpetaDeLaColeccion(carpetaFinal, actual.collectionId))
    ) {
      throw new EntradaInvalida('La carpeta indicada no pertenece a esta colección.', [
        'folderId: no pertenece a la colección',
      ]);
    }

    // `ck_body_mode_shape` manda sobre el ESTADO FINAL, igual que el verbo.
    // Un PATCH que sólo trae `bodyFields` sobre una fila que es `raw_json`
    // sería una fila imposible, y el DTO no lo puede ver porque no conoce el
    // modo guardado.
    const modoFinal = cambios.bodyType ?? actual.bodyMode;
    const binarioFinal =
      cambios.binaryFileId !== undefined
        ? cambios.binaryFileId
        : (actual.cuerpo?.binaryFileId ?? null);
    const problemas = problemasDeFormaDelCuerpo({
      bodyType: modoFinal,
      ...(cambios.body !== undefined ? { body: cambios.body } : {}),
      ...(cambios.bodyFields !== undefined ? { bodyFields: cambios.bodyFields } : {}),
      binaryFileId: binarioFinal,
    });
    if (problemas.length > 0) {
      throw new EntradaInvalida(
        'La forma del cuerpo no es compatible con el modo resultante.',
        problemas,
      );
    }

    const workspaceId = await this.repo.workspaceIdDePeticion(peticionId);
    if (workspaceId === null) throw new RecursoNoEncontrado('Petición no encontrada.');
    await this.#comprobarFicheros(workspaceId, cambios);

    await this.repo.actualizar(
      peticionId,
      {
        ...(cambios.name !== undefined ? { name: cambios.name } : {}),
        ...(cambios.description !== undefined ? { description: cambios.description } : {}),
        method: metodoFinal,
        methodCustom: metodoPersonalizadoFinal,
        ...(cambios.url !== undefined ? { url: cambios.url } : {}),
        ...(carpetaFinal !== undefined ? { folderId: carpetaFinal } : {}),
        ...(cambios.headers !== undefined ? { headers: cambios.headers } : {}),
        ...(cambios.queryParams !== undefined ? { queryParams: cambios.queryParams } : {}),
        ...(cambios.bodyType !== undefined ? { bodyType: cambios.bodyType } : {}),
        ...(cambios.body !== undefined ? { body: cambios.body } : {}),
        ...(cambios.bodyContentType !== undefined
          ? { bodyContentType: cambios.bodyContentType }
          : {}),
        ...(cambios.bodyFields !== undefined ? { bodyFields: cambios.bodyFields } : {}),
        ...(cambios.binaryFileId !== undefined ? { binaryFileId: cambios.binaryFileId } : {}),
        ...(cambios.sortKey !== undefined ? { sortKey: cambios.sortKey } : {}),
        bodyTypePresente: cambios.bodyType !== undefined,
        binaryFileIdPresente: cambios.binaryFileId !== undefined,
        // Bloqueo optimista: sólo si el cliente dice contra qué versión
        // escribe. Quien no lo mande conserva el comportamiento de antes.
        ...(cambios.lockVersion !== undefined
          ? { lockVersionEsperada: cambios.lockVersion }
          : {}),
      },
      this.reloj.ahora(),
    );

    const actualizada = await this.obtener(peticionId);
    this.auditoria.registrar({
      accion: ACCION_AUDITORIA.PETICION_ACTUALIZADA,
      actorUserId: actorId,
      sessionId: null,
      workspaceId: null,
      recursoTipo: 'request',
      recursoId: peticionId,
      clientIp: ip,
      detalles: { campos: Object.keys(cambios).sort() },
    });
    return actualizada;
  }

  // -------------------------------------------------------------------------
  // 5. DELETE /requests/:requestId  (lógico)
  // -------------------------------------------------------------------------

  async borrar(peticionId: string, actorId: string, ip: string): Promise<void> {
    const fila = await this.obtener(peticionId);
    await this.repo.borrarLogicamente(peticionId, actorId, this.reloj.ahora());
    this.auditoria.registrar({
      accion: ACCION_AUDITORIA.PETICION_ELIMINADA,
      actorUserId: actorId,
      sessionId: null,
      workspaceId: null,
      recursoTipo: 'request',
      recursoId: peticionId,
      clientIp: ip,
      detalles: { name: fila.name, collectionId: fila.collectionId },
    });
  }

  // -------------------------------------------------------------------------
  // 6. POST /requests/:requestId/duplicate
  // -------------------------------------------------------------------------

  async duplicar(
    peticionId: string,
    opciones: { readonly name?: string; readonly folderId?: string | null } | undefined,
    actorId: string,
    ip: string,
  ): Promise<FilaPeticionCompleta> {
    const origen = await this.obtener(peticionId);
    const carpetaDestino = opciones?.folderId;
    if (
      carpetaDestino !== undefined &&
      carpetaDestino !== null &&
      !(await this.repo.carpetaDeLaColeccion(carpetaDestino, origen.collectionId))
    ) {
      throw new EntradaInvalida('La carpeta indicada no pertenece a esta colección.', [
        'folderId: no pertenece a la colección',
      ]);
    }

    const nombre = (opciones?.name ?? `${origen.name} (copia)`).slice(0, 200);
    const nuevoId = await this.repo.duplicar(
      peticionId,
      nombre,
      carpetaDestino,
      actorId,
      this.reloj.ahora(),
    );

    this.auditoria.registrar({
      accion: ACCION_AUDITORIA.PETICION_CREADA,
      actorUserId: actorId,
      sessionId: null,
      workspaceId: null,
      recursoTipo: 'request',
      recursoId: nuevoId,
      clientIp: ip,
      detalles: { duplicadaDe: peticionId, name: nombre },
    });
    return this.obtener(nuevoId);
  }

  // -------------------------------------------------------------------------
  // 7. GET /requests/:requestId/curl
  // -------------------------------------------------------------------------

  async comoCurl(peticionId: string, actorId: string, ip: string): Promise<ResultadoCurl> {
    const fila = await this.obtener(peticionId);
    const resultado = generarCurl(aPeticionParaCurl(fila, await this.#ficherosDe(fila)));
    this.auditoria.registrar({
      accion: 'request.exported.curl',
      actorUserId: actorId,
      sessionId: null,
      workspaceId: null,
      recursoTipo: 'request',
      recursoId: peticionId,
      clientIp: ip,
      // Se audita la exportación, NO el comando: contiene la URL completa y
      // C-LEAK-04 prohíbe llevarla a los registros.
      detalles: { advertencias: resultado.advertencias.length },
    });
    return resultado;
  }

  // -------------------------------------------------------------------------
  // Enriquecimiento con metadatos de fichero
  // -------------------------------------------------------------------------

  /**
   * Vista de detalle **con** los metadatos de los ficheros referenciados. El
   * controlador usa ésta y no `vistaDetalle` a secas, porque `binaryFile`
   * exige una consulta a `files` que una función pura no puede hacer.
   */
  async detalle(fila: FilaPeticionCompleta): Promise<Record<string, unknown>> {
    return vistaDetalle(fila, await this.#ficherosDe(fila));
  }

  /**
   * Cuerpo listo para `POST /v1/execute` del motor, **con los bytes de los
   * adjuntos en base64**. Cierra el §3.A.4: el motor ya sabe enviar multipart
   * con ficheros y aquí está el traductor.
   *
   * **Todavía no lo llama nadie**: quien habla con el motor es
   * `modules/studio`, que está fuera de mi ámbito. Está escrito, probado y
   * documentado en `CUERPO-Y-CURL.md` §8 para que integrarlo sea una línea.
   */
  async cuerpoParaElMotor(peticionId: string): Promise<ResultadoCuerpoParaElMotor> {
    const fila = await this.obtener(peticionId);
    return construirCuerpoParaElMotor(
      {
        bodyMode: fila.cuerpo?.mode ?? fila.bodyMode,
        rawContent: fila.cuerpo?.rawContent ?? null,
        contentType: fila.cuerpo?.contentType ?? null,
        binaryFileId: fila.cuerpo?.binaryFileId ?? null,
        campos: fila.cuerpo?.campos ?? [],
      },
      (fileId) => this.servicioDeFicheros.bytesEnBase64(fileId),
    );
  }

  async #ficherosDe(fila: FilaPeticionCompleta): Promise<Map<string, FilaFichero>> {
    const ids: string[] = [];
    if (fila.cuerpo?.binaryFileId != null) ids.push(fila.cuerpo.binaryFileId);
    for (const campo of fila.cuerpo?.campos ?? []) {
      if (campo.fileId != null) ids.push(campo.fileId);
    }
    if (ids.length === 0) return new Map();
    return this.ficheros.metadatosDe(ids);
  }

  /**
   * Un `fileId` que no sea de ESTE workspace es 422, no un 500 de clave
   * ajena. Es la frontera que impide adjuntar el fichero de otro workspace
   * conociendo su UUID: sin esto, `request_body_fields.file_id` sería un
   * puente entre workspaces que la autorización por recurso no ve.
   */
  async #comprobarFicheros(
    workspaceId: string,
    entrada: {
      readonly binaryFileId?: string | null | undefined;
      readonly bodyFields?: readonly { readonly fileId?: string | null | undefined }[] | undefined;
    },
  ): Promise<void> {
    const ids: string[] = [];
    if (typeof entrada.binaryFileId === 'string') ids.push(entrada.binaryFileId);
    for (const campo of entrada.bodyFields ?? []) {
      if (typeof campo.fileId === 'string') ids.push(campo.fileId);
    }
    if (ids.length === 0) return;

    const invalidos = await this.ficheros.idsInvalidosEnWorkspace(ids, workspaceId);
    if (invalidos.length > 0) {
      throw new EntradaInvalida(
        'Algún fichero referenciado no existe o no pertenece a este workspace.',
        invalidos.map((id) => `fileId: ${id} no disponible en este workspace`),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Proyecciones de salida. Listas de permitidos explícitas (C-LEAK-04).
// ---------------------------------------------------------------------------

function ordenDesdeClave(sortKey: string): number {
  const n = Number.parseInt(sortKey, 10);
  return Number.isFinite(n) ? n : 0;
}

/** Resumen para el árbol de la colección. Sin cabeceras ni cuerpo: no hacen falta. */
export function vistaResumen(fila: FilaPeticion): Record<string, unknown> {
  return {
    id: fila.id,
    collectionId: fila.collectionId,
    folderId: fila.folderId,
    name: fila.name,
    description: fila.description,
    method: fila.method,
    methodCustom: fila.methodCustom,
    // `url` es el nombre del contrato; `urlTemplate` deja explícito que no
    // está resuelta. Son el mismo valor y ninguno se resuelve.
    url: fila.urlTemplate,
    urlTemplate: fila.urlTemplate,
    bodyType: fila.bodyMode,
    bodyMode: fila.bodyMode,
    sortKey: fila.sortKey,
    sortOrder: ordenDesdeClave(fila.sortKey),
    lockVersion: fila.lockVersion,
    lastExecutedAt: fila.lastExecutedAt?.toISOString() ?? null,
    createdAt: fila.createdAt.toISOString(),
    updatedAt: fila.updatedAt.toISOString(),
  };
}

export function vistaCarpeta(fila: FilaCarpeta): Record<string, unknown> {
  return {
    id: fila.id,
    collectionId: fila.collectionId,
    parentFolderId: fila.parentFolderId,
    name: fila.name,
    depth: fila.depth,
    sortKey: fila.sortKey,
    sortOrder: ordenDesdeClave(fila.sortKey),
  };
}

/** Detalle. El valor de un secreto NO sale: ni en claro, ni cifrado, ni enmascarado. */
export function vistaDetalle(
  fila: FilaPeticionCompleta,
  ficheros: ReadonlyMap<string, FilaFichero> = new Map(),
): Record<string, unknown> {
  const binarioId = fila.cuerpo?.binaryFileId ?? null;
  const binario = binarioId === null ? undefined : ficheros.get(binarioId);
  return {
    ...vistaResumen(fila),
    externalRef: fila.externalRef,
    authMode: fila.authMode,
    timeoutMs: fila.timeoutMs,
    redirectPolicy: fila.redirectPolicy,
    maxRedirects: fila.maxRedirects,
    tlsVerifyPeer: fila.tlsVerifyPeer,
    hasClientCertificate: fila.clientCertificateId !== null,
    hasPreRequestScript: fila.preRequestScript !== null,
    hasPostResponseScript: fila.postResponseScript !== null,
    headers: fila.cabeceras.map((h) => ({
      key: h.name,
      value: h.isSecret ? null : h.value,
      enabled: h.isEnabled,
      secret: h.isSecret,
      // C-LEAK-05: el valor NO está clasificado pero parece una credencial.
      // Se devuelve (la interfaz tiene que poder editarlo) y se marca, para
      // que la interfaz ofrezca «convertir en variable secreta» y avise antes
      // de compartir. Detección, no clasificación: es una mitigación.
      looksSecret: !h.isSecret && pareceCredencial(h.name, h.value),
      description: h.description,
    })),
    queryParams: fila.parametros
      .filter((p) => p.kind === 'query')
      .map((p) => ({
        key: p.name,
        value: p.isSecret ? null : p.value,
        enabled: p.isEnabled,
        secret: p.isSecret,
        looksSecret: !p.isSecret && pareceCredencial(p.name, p.value),
        description: p.description,
      })),
    pathParams: fila.parametros
      .filter((p) => p.kind === 'path')
      .map((p) => ({
        key: p.name,
        value: p.isSecret ? null : p.value,
        enabled: p.isEnabled,
        secret: p.isSecret,
      })),
    body: cuerpoVisible(fila),
    bodyContentType: fila.cuerpo?.contentType ?? null,
    bodyFields:
      fila.cuerpo?.campos.map((c) => {
        const adjunto = c.fileId === null ? undefined : ficheros.get(c.fileId);
        return {
          key: c.fieldName,
          kind: c.fileId !== null ? 'file' : 'text',
          value: c.isSecret || c.fileId !== null ? null : c.fieldValue,
          enabled: c.isEnabled,
          secret: c.isSecret,
          file: c.fileId !== null,
          fileId: c.fileId,
          // Metadatos, **nunca** bytes (§2.1: «La lectura devuelve `bodyFields`
          // y `binaryFile` … **Nunca** bytes»).
          fileInfo: adjunto === undefined ? null : vistaBreveDeFichero(adjunto),
          contentType: c.contentType,
        };
      }) ?? [],
    binaryFileId: binarioId,
    binaryFile: binario === undefined ? null : vistaBreveDeFichero(binario),
  };
}

/**
 * El cuerpo que se devuelve al cliente. En los modos de formulario no hay
 * `raw_content` (lo prohíbe `ck_body_mode_shape`): se reconstruye el texto
 * urlencoded a partir de los campos NO secretos, para que el constructor de la
 * web lo pueda editar sin inventarse nada.
 */
function cuerpoVisible(fila: FilaPeticionCompleta): string | null {
  const cuerpo = fila.cuerpo;
  if (cuerpo === null) return null;
  if (cuerpo.rawContent !== null) return cuerpo.rawContent;
  if (cuerpo.campos.length === 0) return null;
  const partes = new URLSearchParams();
  for (const campo of cuerpo.campos) {
    if (campo.isSecret || campo.fileId !== null) continue;
    partes.append(campo.fieldName, campo.fieldValue ?? '');
  }
  const texto = partes.toString();
  return texto === '' ? null : texto;
}

/** Adaptador fila → entrada del generador de cURL. */
export function aPeticionParaCurl(
  fila: FilaPeticionCompleta,
  ficheros: ReadonlyMap<string, FilaFichero> = new Map(),
): PeticionParaCurl {
  const cuerpo = fila.cuerpo;
  const binarioId = cuerpo?.binaryFileId ?? null;
  const binario = binarioId === null ? undefined : ficheros.get(binarioId);
  return {
    nombre: fila.name,
    metodo: fila.method,
    metodoPersonalizado: fila.methodCustom,
    urlPlantilla: fila.urlTemplate,
    cabeceras: fila.cabeceras.map((h) => ({
      nombre: h.name,
      valor: h.isSecret ? null : h.value,
      esSecreto: h.isSecret,
      habilitada: h.isEnabled,
    })),
    parametros: fila.parametros.map((p) => ({
      tipo: p.kind,
      nombre: p.name,
      valor: p.isSecret ? null : p.value,
      esSecreto: p.isSecret,
      habilitado: p.isEnabled,
    })),
    modoCuerpo: (cuerpo?.mode ?? fila.bodyMode) as ModoCuerpoCurl,
    cuerpoCrudo: cuerpo?.rawContent ?? null,
    contentTypeDelCuerpo: cuerpo?.contentType ?? null,
    variablesGraphql: cuerpo?.graphqlVariables ?? null,
    camposDeFormulario:
      cuerpo?.campos.map((c) => {
        const adjunto = c.fileId === null ? undefined : ficheros.get(c.fileId);
        return {
          nombre: c.fieldName,
          valor: c.isSecret ? null : c.fieldValue,
          esSecreto: c.isSecret,
          habilitado: c.isEnabled,
          esFichero: c.fileId !== null,
          nombreDelFichero: adjunto?.originalFilename ?? null,
          contentType: c.contentType ?? adjunto?.contentType ?? null,
        };
      }) ?? [],
    tieneFicheroBinario: binarioId !== null,
    nombreDelFicheroBinario: binario?.originalFilename ?? null,
    timeoutMs: fila.timeoutMs,
    politicaDeRedireccion: fila.redirectPolicy,
    maxRedirecciones: fila.maxRedirects,
    verificarTls: fila.tlsVerifyPeer,
    tieneCertificadoDeCliente: fila.clientCertificateId !== null,
    modoAutenticacion: fila.authMode,
    tieneConfiguracionDeAutenticacion: fila.authConfigurationId !== null,
    tienePreScript: fila.preRequestScript !== null,
    tienePostScript: fila.postResponseScript !== null,
  };
}
