import { Inject, Injectable } from '@nestjs/common';
import { CONFIGURACION_APP, type ConfiguracionApp } from '../../platform/config/app-config.ts';
import { RELOJ, type Reloj } from '../../platform/time/clock.ts';
import {
  descomponerTestigo,
  generarTestigoDeSesion,
  verificadorCoincide,
} from '../../platform/crypto/session-token.ts';
import { NoAutenticado } from '../../platform/errors/domain-errors.ts';
import type {
  CookieEmitida,
  PuertoDeSesion,
  ResultadoDeValidacionDeSesion,
} from '../../platform/auth/ports.ts';
import type { ContextoDePeticion } from '../../platform/auth/principal.ts';
import {
  REPOSITORIO_DE_SESIONES,
  type RepositorioDeSesiones,
} from '../../platform/persistence/repositories.ts';
import type { FilaSesion, MotivoDeRevocacion } from '../../platform/persistence/records.ts';
import { PUERTO_DE_AUDITORIA, type PuertoDeAuditoria } from '../../platform/audit/ports.ts';

export interface SesionEmitida {
  readonly sesion: FilaSesion;
  readonly cookie: CookieEmitida;
}

/**
 * Ciclo de vida de la sesión con estado del ADR-0009.
 *
 * **La fila de `sessions` ES la sesión.** La cookie sólo transporta un
 * identificador opaco. No hay JWT, no hay firma, no hay *claims*: el esquema no
 * tiene dónde guardarlos y la revocación inmediata es un requisito (§1).
 */
@Injectable()
export class ServicioDeSesiones implements PuertoDeSesion {
  constructor(
    @Inject(REPOSITORIO_DE_SESIONES) private readonly sesiones: RepositorioDeSesiones,
    @Inject(CONFIGURACION_APP) private readonly config: ConfiguracionApp,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(PUERTO_DE_AUDITORIA) private readonly auditoria: PuertoDeAuditoria,
  ) {}

  // -------------------------------------------------------------------------
  // Emisión
  // -------------------------------------------------------------------------

  /** Crea una sesión raíz (`parent_session_id = NULL`). */
  async emitir(usuarioId: string, contexto: ContextoDePeticion): Promise<SesionEmitida> {
    const ahora = this.reloj.ahora();
    const testigo = generarTestigoDeSesion();
    const sesion = await this.sesiones.crear({
      userId: usuarioId,
      tokenSelector: testigo.selector,
      tokenVerifierHash: testigo.hashVerificador,
      parentSessionId: null,
      userAgent: contexto.userAgent ?? null,
      clientIp: contexto.ip,
      deviceLabel: null,
      issuedAt: ahora,
      absoluteExpiresAt: new Date(ahora.getTime() + this.config.sesion.ttlAbsolutoMs),
      idleExpiresAt: new Date(ahora.getTime() + this.config.sesion.ttlInactividadMs),
    });
    return {
      sesion,
      cookie: {
        nombre: this.config.cookies.nombreSesion,
        valor: testigo.valorCookie,
        expiraEn: sesion.absoluteExpiresAt,
      },
    };
  }

  // -------------------------------------------------------------------------
  // Validación por petición
  // -------------------------------------------------------------------------

  async validar(
    valorCookie: string | undefined,
    contexto: ContextoDePeticion,
  ): Promise<ResultadoDeValidacionDeSesion> {
    const partes = descomponerTestigo(valorCookie);
    if (partes === null) throw new NoAutenticado('cookie_ausente_o_malformada');

    const sesion = await this.sesiones.buscarPorSelector(partes.selector);
    if (sesion === null) throw new NoAutenticado('selector_desconocido');

    // ORDEN DELIBERADO: el verificador se comprueba ANTES de reaccionar al
    // estado de revocación. Si no, bastaría conocer un `token_selector` —que es
    // la mitad pública— para disparar la revocación de la familia entera de
    // otra persona. El selector no es secreto; el verificador sí.
    if (!verificadorCoincide(partes.verificador, sesion.tokenVerifierHash)) {
      throw new NoAutenticado('verificador_no_coincide');
    }

    if (sesion.revokedAt !== null) {
      return this.#tratarSesionRevocada(sesion, contexto);
    }

    const ahora = this.reloj.ahora();

    if (ahora.getTime() >= sesion.absoluteExpiresAt.getTime()) {
      await this.sesiones.revocar(sesion.id, ahora, 'expired_absolute');
      throw new NoAutenticado('caducidad_absoluta');
    }
    if (ahora.getTime() >= sesion.idleExpiresAt.getTime()) {
      await this.sesiones.revocar(sesion.id, ahora, 'expired_idle');
      throw new NoAutenticado('caducidad_por_inactividad');
    }

    const edadMs = ahora.getTime() - sesion.issuedAt.getTime();
    if (edadMs >= this.config.sesion.rotarTrasMs) {
      const rotada = await this.rotar(sesion, contexto, 'rotated');
      return {
        principal: { tipo: 'usuario', usuarioId: rotada.sesion.userId, sesionId: rotada.sesion.id },
        cookieNueva: rotada.cookie,
      };
    }

    await this.#tocarSiProcede(sesion, ahora);
    return {
      principal: { tipo: 'usuario', usuarioId: sesion.userId, sesionId: sesion.id },
    };
  }

  /**
   * §3: `last_seen_at` se escribe **como mucho 1 vez / 60 s** por sesión, para
   * no hacer un UPDATE por petición. Consecuencia aceptada y escrita: la
   * inactividad se mide con granularidad de 60 s. Con una ventana de 12 h es
   * irrelevante.
   */
  async #tocarSiProcede(sesion: FilaSesion, ahora: Date): Promise<void> {
    const desdeUltimoToque = ahora.getTime() - sesion.lastSeenAt.getTime();
    if (desdeUltimoToque < this.config.sesion.intervaloMinimoLastSeenMs) return;
    await this.sesiones.tocarUltimaActividad(
      sesion.id,
      ahora,
      new Date(ahora.getTime() + this.config.sesion.ttlInactividadMs),
    );
  }

  // -------------------------------------------------------------------------
  // Rotación y detección de reutilización (§4)
  // -------------------------------------------------------------------------

  /**
   * Rota una sesión viva: fila nueva con `parent_session_id` apuntando a la
   * anterior, **`absolute_expires_at` heredado sin cambios** (la rotación no
   * alarga la vida absoluta) e `idle_expires_at` recalculado. La anterior queda
   * `revoked_reason = 'rotated'`.
   */
  async rotar(
    sesion: FilaSesion,
    contexto: ContextoDePeticion,
    motivoDeLaAnterior: MotivoDeRevocacion,
  ): Promise<SesionEmitida> {
    const ahora = this.reloj.ahora();
    const testigo = generarTestigoDeSesion();
    const nueva = await this.sesiones.crear({
      userId: sesion.userId,
      tokenSelector: testigo.selector,
      tokenVerifierHash: testigo.hashVerificador,
      parentSessionId: sesion.id,
      userAgent: contexto.userAgent ?? sesion.userAgent,
      clientIp: contexto.ip,
      deviceLabel: sesion.deviceLabel,
      issuedAt: ahora,
      absoluteExpiresAt: sesion.absoluteExpiresAt, // heredado, NO se extiende
      idleExpiresAt: new Date(ahora.getTime() + this.config.sesion.ttlInactividadMs),
    });
    await this.sesiones.revocar(sesion.id, ahora, motivoDeLaAnterior);
    this.auditoria.registrar({
      accion: 'session.rotated',
      actorUserId: sesion.userId,
      sessionId: nueva.id,
      workspaceId: null,
      recursoTipo: 'session',
      recursoId: nueva.id,
      clientIp: contexto.ip,
      metadata: { anterior: sesion.id },
    });
    return {
      sesion: nueva,
      cookie: {
        nombre: this.config.cookies.nombreSesion,
        valor: testigo.valorCookie,
        expiraEn: nueva.absoluteExpiresAt,
      },
    };
  }

  async #tratarSesionRevocada(
    sesion: FilaSesion,
    contexto: ContextoDePeticion,
  ): Promise<ResultadoDeValidacionDeSesion> {
    if (sesion.revokedReason !== 'rotated') {
      throw new NoAutenticado(`sesion_revocada:${sesion.revokedReason ?? 'desconocido'}`);
    }

    const ahora = this.reloj.ahora();
    const revocadaHace = ahora.getTime() - (sesion.revokedAt?.getTime() ?? 0);
    const dentroDeGracia = revocadaHace <= this.config.sesion.ventanaGraciaRotacionMs;
    const mismaHuella =
      sesion.clientIp === contexto.ip && (sesion.userAgent ?? null) === (contexto.userAgent ?? null);

    if (dentroDeGracia && mismaHuella) {
      // Carrera de red legítima (§4). El servidor NO puede reenviar la cookie
      // vigente: de la hija sólo guarda el hash del verificador y el valor en
      // claro se destruyó al emitirlo. Lo que se hace es localizar la hija viva,
      // ROTARLA otra vez y devolver esa cookie nueva. No se revoca la familia.
      const hija = await this.sesiones.buscarHijaViva(sesion.id);
      if (hija !== null) {
        const nieta = await this.rotar(hija, contexto, 'rotated');
        return {
          principal: { tipo: 'usuario', usuarioId: nieta.sesion.userId, sesionId: nieta.sesion.id },
          cookieNueva: nieta.cookie,
        };
      }
      // Sin hija viva no hay nada que reemitir: se trata como reutilización.
    }

    const revocadas = await this.sesiones.revocarFamilia(
      sesion.id,
      sesion.userId,
      ahora,
      'reuse_detected',
    );
    this.auditoria.registrar({
      accion: 'session.reuse_detected',
      actorUserId: sesion.userId,
      sessionId: sesion.id,
      workspaceId: null,
      recursoTipo: 'session',
      recursoId: sesion.id,
      clientIp: contexto.ip,
      metadata: { sesionesRevocadas: revocadas },
    });
    throw new NoAutenticado('reutilizacion_detectada');
  }

  // -------------------------------------------------------------------------
  // Cierre (§9)
  // -------------------------------------------------------------------------

  async cerrar(sesionId: string, usuarioId: string, ip: string): Promise<void> {
    const ahora = this.reloj.ahora();
    await this.sesiones.revocar(sesionId, ahora, 'logout');
    this.auditoria.registrar({
      accion: 'auth.logout',
      actorUserId: usuarioId,
      sessionId: sesionId,
      workspaceId: null,
      recursoTipo: 'session',
      recursoId: sesionId,
      clientIp: ip,
    });
  }

  async cerrarTodas(usuarioId: string, ip: string): Promise<number> {
    const ahora = this.reloj.ahora();
    const revocadas = await this.sesiones.revocarTodasDeUsuario(usuarioId, ahora, 'logout_all');
    this.auditoria.registrar({
      accion: 'auth.logout_all',
      actorUserId: usuarioId,
      sessionId: null,
      workspaceId: null,
      recursoTipo: 'session',
      recursoId: null,
      clientIp: ip,
      metadata: { sesionesRevocadas: revocadas },
    });
    return revocadas;
  }

  /**
   * Revoca una sesión concreta del propio usuario. Devuelve `false` si la fila
   * no existe o **no es suya**: nunca se revela que exista la sesión de otro.
   */
  async cerrarUna(sesionId: string, usuarioId: string, ip: string): Promise<boolean> {
    const fila = await this.sesiones.buscarPorId(sesionId);
    if (fila === null || fila.userId !== usuarioId) return false;
    await this.cerrar(sesionId, usuarioId, ip);
    return true;
  }

  async listar(usuarioId: string): Promise<readonly FilaSesion[]> {
    return this.sesiones.listarVivasDeUsuario(usuarioId, this.reloj.ahora());
  }

  /** Revoca todas menos la actual (cambio de contraseña o de 2FA, §8). */
  async revocarOtras(
    usuarioId: string,
    sesionActualId: string,
    motivo: MotivoDeRevocacion,
  ): Promise<number> {
    return this.sesiones.revocarTodasDeUsuario(
      usuarioId,
      this.reloj.ahora(),
      motivo,
      sesionActualId,
    );
  }

  async buscarPorId(sesionId: string): Promise<FilaSesion | null> {
    return this.sesiones.buscarPorId(sesionId);
  }
}
