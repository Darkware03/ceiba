import { Inject, Injectable } from '@nestjs/common';
import { RELOJ, type Reloj } from '../../platform/time/clock.ts';
import {
  descomponerTestigo,
  generarTestigoDeSesion,
  verificadorCoincide,
} from '../../platform/crypto/session-token.ts';
import {
  RepositorioDeComparticion,
  type FilaCodigoDeAcceso,
  type FilaEnlaceCompartido,
} from './sharing.repository.ts';
import {
  INTERVALO_MINIMO_LAST_SEEN_MS,
  TTL_SESION_COMPARTIDA_MS,
  type PermisoDeComparticion,
} from './share-policy.ts';
import type { PrincipalDeComparticion } from './share-principal.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * C-CODE-06 — Revocación y expiración con efecto INMEDIATO.
 *
 * §6 del prompt maestro exige: *«la revocación debe surtir efecto
 * inmediatamente en las solicitudes posteriores»*. Eso **descarta un JWT**: con
 * un testigo firmado la decisión viaja dentro y sigue valiendo hasta que
 * caduca. Aquí la sesión tiene **estado en servidor** y se revalida en **cada**
 * petición contra la base de datos. **Sin caché**: C-CODE-06 permite hasta 5 s,
 * y se ha preferido no tenerla —no hay evidencia de que el coste de una lectura
 * indexada lo justifique, y una caché es una ventana en la que la revocación
 * *no* es inmediata.
 *
 * El identificador opaco son 384 bits partidos como en `sessions`
 * (ADR-0009 §2): selector de 128 bits —indexado, no secreto— y verificador de
 * 256 bits, del que **sólo se guarda el SHA-256**. C-CODE-06 pide «un
 * identificador opaco de 256 bits»; partir 256 dejaría el secreto por debajo,
 * así que se suman. Es exactamente lo que razona el comentario de
 * `share_sessions` en el esquema.
 *
 * SHA-256 y no Argon2id para el verificador, por el mismo motivo que la sesión
 * de usuario: son 256 bits aleatorios, no hay diccionario que atacar, y un KDF
 * lento convertiría **cada petición** del visitante en trabajo costoso.
 * ════════════════════════════════════════════════════════════════════════════
 */

/** Motivos admitidos por `share_sessions.revoked_reason`, según el esquema. */
export type MotivoDeRevocacion =
  | 'link_revoked'
  | 'link_expired'
  | 'code_revoked'
  | 'code_rotated'
  | 'permission_changed'
  | 'logout'
  | 'admin_revoked';

export interface SesionEmitida {
  readonly sesionId: string;
  /** Valor para la cookie. El verificador en claro **no** se persiste. */
  readonly valorCookie: string;
  readonly expiraEn: Date;
  readonly permiso: PermisoDeComparticion;
}

@Injectable()
export class ServicioDeSesionesCompartidas {
  constructor(
    private readonly repo: RepositorioDeComparticion,
    @Inject(RELOJ) private readonly reloj: Reloj,
  ) {}

  /** Crea la sesión que devuelve un código validado (o un enlace público). */
  async emitir(
    enlace: FilaEnlaceCompartido,
    codigo: FilaCodigoDeAcceso | null,
    ip: string | null,
  ): Promise<SesionEmitida> {
    const ahora = this.reloj.ahora();
    const testigo = generarTestigoDeSesion();

    // La sesión nunca sobrevive a su enlace: si el enlace caduca antes, manda
    // el enlace. Sin esto, un enlace con 10 minutos de vida dejaría sesiones de
    // 2 horas, y la caducidad del enlace sería decorativa.
    const porPolitica = new Date(ahora.getTime() + TTL_SESION_COMPARTIDA_MS);
    const expiraEn =
      enlace.expiresAt !== null && enlace.expiresAt.getTime() < porPolitica.getTime()
        ? enlace.expiresAt
        : porPolitica;

    const fila = await this.repo.crearSesion({
      sharedLinkId: enlace.id,
      shareAccessCodeId: codigo?.id ?? null,
      // INSTANTÁNEA del permiso. No es redundante: C-CODE-06 exige comprobar en
      // cada petición «que el permiso sigue siendo el mismo», y eso es comparar
      // esta columna con la del enlace.
      permission: enlace.permission,
      tokenSelector: testigo.selector,
      tokenVerifierHash: testigo.hashVerificador,
      clientIp: ip,
      issuedAt: ahora,
      expiresAt: expiraEn,
    });

    return {
      sesionId: fila.id,
      valorCookie: testigo.valorCookie,
      expiraEn: fila.expiresAt,
      permiso: fila.permission,
    };
  }

  /**
   * LAS SIETE COMPROBACIONES POR PETICIÓN, en el orden del esquema.
   *
   * Devuelve `null` ante **cualquier** fallo, sin decir cuál: quien llama
   * responde siempre lo mismo. El motivo no se filtra ni por el tipo de retorno.
   */
  async validar(valorCookie: string | undefined): Promise<PrincipalDeComparticion | null> {
    // 1. Separar selector y buscar por `uq_sharesession_selector`.
    const testigo = descomponerTestigo(valorCookie);
    if (testigo === null) return null;

    const encontrado = await this.repo.buscarSesionPorSelector(testigo.selector);
    if (encontrado === null) return null;

    const { sesion, enlace, codigo, coleccionBorrada } = encontrado;
    const ahora = this.reloj.ahora();

    // 2. Comparar SHA-256(verificador) en tiempo constante.
    if (!verificadorCoincide(testigo.verificador, sesion.tokenVerifierHash)) return null;

    // 3. La sesión, viva.
    if (sesion.revokedAt !== null) return null;
    if (sesion.expiresAt.getTime() <= ahora.getTime()) return null;

    // 4. El ENLACE padre, vivo. `expires_at` NULL significa «sin caducidad»:
    //    tratarlo como caducado rompería todos los enlaces perpetuos.
    if (enlace.state !== 'active' || enlace.revokedAt !== null) return null;
    if (enlace.expiresAt !== null && enlace.expiresAt.getTime() <= ahora.getTime()) return null;

    // 5. El CÓDIGO padre, vivo, si la sesión nació de uno. Sin este paso, rotar
    //    o revocar un código no cerraría las sesiones que abrió.
    if (codigo !== null) {
      if (codigo.state !== 'active' || codigo.revokedAt !== null) return null;
      if (codigo.expiresAt !== null && codigo.expiresAt.getTime() <= ahora.getTime()) return null;
    }

    // 6. El permiso sigue siendo el mismo. Las dos banderas del enlace viajan
    //    al principal y las comprueba el guard por operación: cambian el
    //    alcance real SIN tocar `permission`.
    if (sesion.permission !== enlace.permission) return null;

    // 7. `max_views`.
    if (enlace.maxViews !== null && enlace.viewCount > enlace.maxViews) return null;

    // No está en la lista de siete, pero una colección borrada no se sirve.
    if (coleccionBorrada) return null;

    // `last_seen_at` como mucho una vez cada 60 s, igual que `sessions`: un
    // UPDATE por petición convertiría cada lectura en una escritura.
    if (ahora.getTime() - sesion.lastSeenAt.getTime() >= INTERVALO_MINIMO_LAST_SEEN_MS) {
      await this.repo.tocarSesion(sesion.id, ahora);
    }

    return {
      tipo: 'comparticion',
      sesionId: sesion.id,
      sharedLinkId: enlace.id,
      collectionId: enlace.collectionId,
      workspaceId: enlace.workspaceId,
      permiso: sesion.permission,
      permiteExportar: enlace.allowExport,
      permiteEjecutar: enlace.allowExecution,
      expiraEn: sesion.expiresAt,
    };
  }

  async cerrar(sesionId: string, motivo: MotivoDeRevocacion = 'logout'): Promise<void> {
    await this.repo.revocarSesion(sesionId, motivo, this.reloj.ahora());
  }
}
