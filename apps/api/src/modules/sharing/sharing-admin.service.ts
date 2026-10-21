import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { RELOJ, type Reloj } from '../../platform/time/clock.ts';
import {
  HASHER_DE_CONTRASENA,
  PERFIL_ARGON2ID,
  type HasherDeContrasena,
} from '../../platform/crypto/password-hasher.ts';
import { PUERTO_DE_AUDITORIA, type PuertoDeAuditoria } from '../../platform/audit/ports.ts';
import {
  Conflicto,
  EntradaInvalida,
  RecursoNoEncontrado,
} from '../../platform/errors/domain-errors.ts';
import type { ResolutorDeRecurso } from '../../platform/auth/ports.ts';
import { RegistroDeResolutores } from '../../platform/auth/resource-resolver.registry.ts';
import { generarCodigoDeAcceso, generarSlugPublico } from './access-code.ts';
import { UMBRAL_POR_ENLACE, type PermisoDeComparticion } from './share-policy.ts';
import {
  RepositorioDeComparticion,
  type FilaCodigoDeAcceso,
  type FilaDeIntento,
  type FilaEnlaceCompartido,
} from './sharing.repository.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * LADO DEL PROPIETARIO: modos de visibilidad, enlaces, códigos y auditoría.
 *
 * Todo lo de aquí exige **sesión de usuario y rol en el workspace**; lo aplican
 * los guards globales a partir de `@RequiereRolDeWorkspace` + `@Recurso`. Una
 * sesión de compartición **no alcanza ninguna de estas rutas**: el principal es
 * de otro tipo y el guard de workspace ni siquiera lo reconoce.
 *
 * El servicio es además el `ResolutorDeRecurso` de tipo `shared_link`, para que
 * `/shares/:sharedLinkId/...` se autorice resolviendo el enlace a su workspace
 * y no por posesión del identificador (ADR-0009 §7.4).
 * ════════════════════════════════════════════════════════════════════════════
 */

export interface DatosDeCreacionDeEnlace {
  readonly permission: PermisoDeComparticion;
  readonly requiresAccessCode: boolean;
  readonly allowExport: boolean;
  readonly allowExecution: boolean;
  readonly includeExamples: boolean;
  readonly expiresAt: Date | null;
  readonly maxViews: number | null;
  readonly codeLabel: string | null;
  readonly codeExpiresAt: Date | null;
  readonly codeMaxUses: number | null;
  /** Guardar los 4 últimos caracteres para distinguir códigos en la interfaz. */
  readonly guardarPista: boolean;
}

export interface EnlaceCreado {
  readonly enlace: FilaEnlaceCompartido;
  /**
   * **Se entrega UNA sola vez.** No se persiste, no se vuelve a mostrar y no
   * se puede recuperar: la única salida es rotar el código.
   */
  readonly codigoEnClaro: string | null;
  readonly codigo: FilaCodigoDeAcceso | null;
}

export interface VistaDeEnlace {
  readonly id: string;
  readonly collectionId: string;
  readonly slug: string;
  readonly url: string;
  readonly permission: PermisoDeComparticion;
  readonly requiresAccessCode: boolean;
  readonly allowExport: boolean;
  readonly allowExecution: boolean;
  readonly includeExamples: boolean;
  readonly state: string;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly maxViews: number | null;
  readonly viewCount: number;
  readonly lastAccessedAt: string | null;
  readonly createdAt: string;
  readonly activeCode: VistaDeCodigo | null;
}

export interface VistaDeCodigo {
  readonly id: string;
  readonly label: string | null;
  readonly hint: string | null;
  readonly state: string;
  readonly failedAttemptCount: number;
  readonly lockedUntil: string | null;
  readonly maxAttempts: number;
  readonly maxUses: number | null;
  readonly useCount: number;
  readonly expiresAt: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

@Injectable()
export class ServicioDeAdministracionDeComparticion
  implements ResolutorDeRecurso, OnModuleInit
{
  readonly tipo = 'shared_link';

  constructor(
    private readonly repo: RepositorioDeComparticion,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(HASHER_DE_CONTRASENA) private readonly hasher: HasherDeContrasena,
    @Inject(PUERTO_DE_AUDITORIA) private readonly auditoria: PuertoDeAuditoria,
    private readonly resolutores: RegistroDeResolutores,
  ) {}

  onModuleInit(): void {
    this.resolutores.registrar(this);
  }

  async resolverWorkspaceId(sharedLinkId: string): Promise<string | null> {
    return this.repo.workspaceIdDeEnlace(sharedLinkId);
  }

  // -------------------------------------------------------------------------
  // Crear enlace (y, si procede, su código)
  // -------------------------------------------------------------------------

  async crearEnlace(
    collectionId: string,
    workspaceId: string,
    datos: DatosDeCreacionDeEnlace,
    actorId: string,
    ip: string,
  ): Promise<EnlaceCreado> {
    const ahora = this.reloj.ahora();

    if (datos.expiresAt !== null && datos.expiresAt.getTime() <= ahora.getTime()) {
      throw new EntradaInvalida('La fecha de caducidad del enlace ya ha pasado.');
    }
    // `ck_share_exec` lo impide en la base de datos; aquí se devuelve un 422
    // legible en vez de dejar que reviente el INSERT con un error de motor.
    if (datos.allowExecution && datos.permission !== 'executor') {
      throw new EntradaInvalida(
        'allowExecution sólo puede activarse con permission = executor (CHECK ck_share_exec).',
      );
    }
    if (datos.allowExecution) {
      // C-CODE-08: la ejecución compartida NO está implementada en esta
      // entrega, y aceptar la bandera haría creer que sí. Falla cerrado.
      throw new EntradaInvalida(
        'La ejecución compartida (C-CODE-08) todavía no está implementada: no se puede ' +
          'activar allowExecution. El enlace se crea igual con permission = executor, ' +
          'pero sin ejecución.',
      );
    }

    const enlace = await this.repo.crearEnlace(
      {
        collectionId,
        workspaceId,
        publicSlug: generarSlugPublico(),
        requiresAccessCode: datos.requiresAccessCode,
        permission: datos.permission,
        allowExecution: false,
        allowExport: datos.allowExport,
        includeExamples: datos.includeExamples,
        expiresAt: datos.expiresAt,
        maxViews: datos.maxViews,
        createdByUserId: actorId,
      },
      ahora,
    );

    let codigoEnClaro: string | null = null;
    let codigo: FilaCodigoDeAcceso | null = null;
    if (datos.requiresAccessCode) {
      const emitido = await this.#emitirCodigo(enlace, datos, actorId, null, ahora);
      codigoEnClaro = emitido.codigoEnClaro;
      codigo = emitido.codigo;
    }

    await this.#sincronizarVisibilidad(collectionId, ahora);

    this.auditoria.registrar({
      accion: 'share.link.created',
      actorUserId: actorId,
      workspaceId,
      recursoTipo: 'shared_link',
      recursoId: enlace.id,
      clientIp: ip,
      outcome: 'success',
      detalles: {
        collectionId,
        permiso: enlace.permission,
        exigeCodigo: enlace.requiresAccessCode,
        caducaEn: enlace.expiresAt?.toISOString() ?? null,
      },
    });

    return { enlace, codigoEnClaro, codigo };
  }

  // -------------------------------------------------------------------------
  // Rotar código
  // -------------------------------------------------------------------------

  /**
   * Rotar **no** es «crear otro»: `uq_sharecode_one_active` admite un solo
   * código activo por enlace, así que la emisión revoca el anterior y cierra
   * sus sesiones en la misma transacción (`revoked_reason = 'code_rotated'`).
   */
  async rotarCodigo(
    sharedLinkId: string,
    datos: Pick<
      DatosDeCreacionDeEnlace,
      'codeLabel' | 'codeExpiresAt' | 'codeMaxUses' | 'guardarPista'
    >,
    actorId: string,
    ip: string,
  ): Promise<{ codigoEnClaro: string; codigo: FilaCodigoDeAcceso; sesionesCerradas: number }> {
    const ahora = this.reloj.ahora();
    const enlace = await this.#enlaceVivo(sharedLinkId);
    if (!enlace.requiresAccessCode) {
      throw new Conflicto('Este enlace es público y no usa código de acceso.');
    }
    const anterior = await this.repo.codigoActivoDeEnlace(sharedLinkId);
    const emitido = await this.#emitirCodigo(
      enlace,
      {
        codeLabel: datos.codeLabel,
        codeExpiresAt: datos.codeExpiresAt,
        codeMaxUses: datos.codeMaxUses,
        guardarPista: datos.guardarPista,
      },
      actorId,
      anterior?.id ?? null,
      ahora,
    );

    this.auditoria.registrar({
      accion: 'share.code.rotated',
      actorUserId: actorId,
      workspaceId: enlace.workspaceId,
      recursoTipo: 'share_access_code',
      recursoId: emitido.codigo.id,
      clientIp: ip,
      outcome: 'success',
      detalles: {
        sharedLinkId,
        anteriorId: anterior?.id ?? null,
        sesionesCerradas: emitido.sesionesCerradas,
      },
    });
    return emitido;
  }

  async revocarCodigo(
    sharedLinkId: string,
    codigoId: string,
    actorId: string,
    ip: string,
  ): Promise<{ sesionesCerradas: number }> {
    const ahora = this.reloj.ahora();
    const enlace = await this.#enlace(sharedLinkId);
    const codigos = await this.repo.listarCodigosDeEnlace(sharedLinkId);
    const objetivo = codigos.find((fila) => fila.id === codigoId);
    if (objetivo === undefined) throw new RecursoNoEncontrado('Código no encontrado.');
    if (objetivo.revokedAt !== null) {
      return { sesionesCerradas: 0 };
    }
    const sesionesCerradas = await this.repo.revocarCodigo(codigoId, actorId, ahora);

    this.auditoria.registrar({
      accion: 'share.code.revoked',
      actorUserId: actorId,
      workspaceId: enlace.workspaceId,
      recursoTipo: 'share_access_code',
      recursoId: codigoId,
      clientIp: ip,
      outcome: 'success',
      detalles: { sharedLinkId, sesionesCerradas },
    });
    return { sesionesCerradas };
  }

  // -------------------------------------------------------------------------
  // Revocar enlace — C-CODE-06, efecto inmediato y en cascada
  // -------------------------------------------------------------------------

  async revocarEnlace(
    sharedLinkId: string,
    actorId: string,
    ip: string,
  ): Promise<{ sesionesRevocadas: number; codigosRevocados: number }> {
    const ahora = this.reloj.ahora();
    const enlace = await this.#enlace(sharedLinkId);
    if (enlace.revokedAt !== null) {
      return { sesionesRevocadas: 0, codigosRevocados: 0 };
    }
    const efecto = await this.repo.revocarEnlace(sharedLinkId, actorId, 'link_revoked', ahora);
    await this.#sincronizarVisibilidad(enlace.collectionId, ahora);

    this.auditoria.registrar({
      accion: 'share.link.revoked',
      actorUserId: actorId,
      workspaceId: enlace.workspaceId,
      recursoTipo: 'shared_link',
      recursoId: sharedLinkId,
      clientIp: ip,
      outcome: 'success',
      detalles: { collectionId: enlace.collectionId, ...efecto },
    });
    return efecto;
  }

  // -------------------------------------------------------------------------
  // Consulta
  // -------------------------------------------------------------------------

  async listarEnlaces(collectionId: string, urlPublica: string): Promise<VistaDeEnlace[]> {
    const enlaces = await this.repo.listarEnlacesDeColeccion(collectionId);
    const vistas: VistaDeEnlace[] = [];
    for (const enlace of enlaces) {
      const codigo = await this.repo.codigoActivoDeEnlace(enlace.id);
      vistas.push(vistaDeEnlace(enlace, codigo, urlPublica));
    }
    return vistas;
  }

  async obtenerEnlace(sharedLinkId: string, urlPublica: string): Promise<VistaDeEnlace> {
    const enlace = await this.#enlace(sharedLinkId);
    const codigo = await this.repo.codigoActivoDeEnlace(enlace.id);
    return vistaDeEnlace(enlace, codigo, urlPublica);
  }

  /**
   * **La auditoría del propietario**: el único sitio donde la causa real de
   * cada rechazo es visible. Es la contrapartida exacta de C-CODE-04: fuera,
   * una sola respuesta; aquí, los seis resultados del enum
   * `access_attempt_result`.
   */
  async auditoriaDeEnlace(
    sharedLinkId: string,
    limite: number,
  ): Promise<{
    readonly intentos: readonly FilaDeIntento[];
    readonly resumen: Readonly<Record<string, number>>;
  }> {
    await this.#enlace(sharedLinkId);
    const intentos = await this.repo.listarIntentos(sharedLinkId, limite);
    const resumen: Record<string, number> = {};
    for (const intento of intentos) {
      resumen[intento.result] = (resumen[intento.result] ?? 0) + 1;
    }
    return { intentos, resumen };
  }

  async sesionesVivas(sharedLinkId: string): Promise<number> {
    return this.repo.contarSesionesVivas(sharedLinkId, this.reloj.ahora());
  }

  // -------------------------------------------------------------------------
  // Internos
  // -------------------------------------------------------------------------

  async #emitirCodigo(
    enlace: FilaEnlaceCompartido,
    datos: Pick<
      DatosDeCreacionDeEnlace,
      'codeLabel' | 'codeExpiresAt' | 'codeMaxUses' | 'guardarPista'
    >,
    actorId: string,
    rotadoDe: string | null,
    ahora: Date,
  ): Promise<{
    codigoEnClaro: string;
    codigo: FilaCodigoDeAcceso;
    sesionesCerradas: number;
  }> {
    const generado = generarCodigoDeAcceso();

    // C-CODE-02: Argon2id con EL MISMO perfil que el registro de usuarios
    // (`m=19456, t=2, p=1`, sal de 16 bytes, formato PHC). No hay un segundo
    // perfil criptográfico en el producto, a propósito.
    const phc = await this.hasher.hashear(generado.verificador);

    const emitido = await this.repo.emitirCodigo(
      {
        sharedLinkId: enlace.id,
        codeSelector: generado.selector,
        // El PHC se guarda tal cual, en UTF-8, dentro de la columna `bytea`.
        // Conserva la sal y los parámetros, que es lo que permite subir el
        // coste más adelante sin invalidar los códigos vivos.
        codeVerifierHash: Buffer.from(phc, 'utf8'),
        hashParams: {
          m: PERFIL_ARGON2ID.memoryCost,
          t: PERFIL_ARGON2ID.timeCost,
          p: PERFIL_ARGON2ID.parallelism,
          saltLength: PERFIL_ARGON2ID.saltLength,
        },
        codeHint: datos.guardarPista ? generado.pista : null,
        label: datos.codeLabel,
        maxAttempts: UMBRAL_POR_ENLACE,
        maxUses: datos.codeMaxUses,
        expiresAt: datos.codeExpiresAt,
        rotatedFromCodeId: rotadoDe,
        createdByUserId: actorId,
      },
      ahora,
    );

    return {
      codigoEnClaro: generado.codigoEnClaro,
      codigo: emitido.codigo,
      sesionesCerradas: emitido.sesionesCerradas,
    };
  }

  async #enlace(sharedLinkId: string): Promise<FilaEnlaceCompartido> {
    const enlace = await this.repo.buscarEnlacePorId(sharedLinkId);
    if (enlace === null) throw new RecursoNoEncontrado('Enlace compartido no encontrado.');
    return enlace;
  }

  async #enlaceVivo(sharedLinkId: string): Promise<FilaEnlaceCompartido> {
    const enlace = await this.#enlace(sharedLinkId);
    if (enlace.state !== 'active' || enlace.revokedAt !== null) {
      throw new Conflicto('El enlace está revocado; crea uno nuevo.');
    }
    return enlace;
  }

  /**
   * `collections.visibility` se **deriva** de los enlaces vivos, no se declara
   * aparte. Mantener dos fuentes para el mismo hecho garantiza que un día
   * discrepen y que la interfaz diga «privada» mientras un enlace sirve.
   *
   *   algún enlace activo sin código  -> `link_public`
   *   algún enlace activo con código  -> `link_private`
   *   ninguno                         -> `private`
   *
   * Gana `link_public` si conviven los dos, porque es lo que de verdad está
   * pasando: la colección es alcanzable sin credencial.
   */
  async #sincronizarVisibilidad(collectionId: string, ahora: Date): Promise<void> {
    const activos = await this.repo.hayEnlaceActivo(collectionId);
    if (!activos) {
      await this.repo.fijarVisibilidad(collectionId, 'private', ahora);
      return;
    }
    const conCodigo = await this.repo.contarEnlacesActivosQueExigenCodigo(collectionId);
    const totalActivos = await this.repo.listarEnlacesDeColeccion(collectionId);
    const activosTotales = totalActivos.filter((e) => e.state === 'active').length;
    await this.repo.fijarVisibilidad(
      collectionId,
      conCodigo === activosTotales ? 'link_private' : 'link_public',
      ahora,
    );
  }
}

export function vistaDeEnlace(
  enlace: FilaEnlaceCompartido,
  codigo: FilaCodigoDeAcceso | null,
  urlPublica: string,
): VistaDeEnlace {
  return {
    id: enlace.id,
    collectionId: enlace.collectionId,
    slug: enlace.publicSlug,
    url: `${urlPublica.replace(/\/+$/u, '')}/s/${enlace.publicSlug}`,
    permission: enlace.permission,
    requiresAccessCode: enlace.requiresAccessCode,
    allowExport: enlace.allowExport,
    allowExecution: enlace.allowExecution,
    includeExamples: enlace.includeExamples,
    state: enlace.state,
    expiresAt: enlace.expiresAt?.toISOString() ?? null,
    revokedAt: enlace.revokedAt?.toISOString() ?? null,
    maxViews: enlace.maxViews,
    viewCount: enlace.viewCount,
    lastAccessedAt: enlace.lastAccessedAt?.toISOString() ?? null,
    createdAt: enlace.createdAt.toISOString(),
    activeCode: codigo === null ? null : vistaDeCodigo(codigo),
  };
}

/**
 * Vista de un código **sin el código**. Lo que sale de aquí es el estado
 * operativo: ni el selector, ni el hash, ni nada que permita reconstruirlo.
 * La pista son como mucho 4 caracteres y sólo si el propietario la pidió.
 */
export function vistaDeCodigo(codigo: FilaCodigoDeAcceso): VistaDeCodigo {
  return {
    id: codigo.id,
    label: codigo.label,
    hint: codigo.codeHint,
    state: codigo.state,
    failedAttemptCount: codigo.failedAttemptCount,
    lockedUntil: codigo.lockedUntil?.toISOString() ?? null,
    maxAttempts: codigo.maxAttempts,
    maxUses: codigo.maxUses,
    useCount: codigo.useCount,
    expiresAt: codigo.expiresAt?.toISOString() ?? null,
    createdAt: codigo.createdAt.toISOString(),
    lastUsedAt: codigo.lastUsedAt?.toISOString() ?? null,
  };
}
