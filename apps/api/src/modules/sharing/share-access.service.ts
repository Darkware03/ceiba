import { createHash } from 'node:crypto';
import { setTimeout as esperar } from 'node:timers/promises';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { RELOJ, type Reloj } from '../../platform/time/clock.ts';
import {
  HASHER_DE_CONTRASENA,
  PERFIL_ARGON2ID,
  type HasherDeContrasena,
} from '../../platform/crypto/password-hasher.ts';
import {
  RATE_LIMIT_STORE,
  type RateLimitStore,
} from '../../platform/ratelimit/rate-limit-store.ts';
import { PUERTO_DE_AUDITORIA, type PuertoDeAuditoria } from '../../platform/audit/ports.ts';
import { DemasiadasPeticiones } from '../../platform/errors/domain-errors.ts';
import { descomponerCodigo } from './access-code.ts';
import {
  CLAVES,
  PISO_DE_RESPUESTA_MS,
  UMBRAL_POR_ENLACE,
  UMBRAL_POR_IP,
  UMBRAL_REVOCACION_AUTOMATICA,
  VENTANA_POR_ENLACE_MS,
  VENTANA_POR_IP_MS,
  VENTANA_REVOCACION_MS,
  calcularBackoffDeEnlaceMs,
} from './share-policy.ts';
import { AccesoCompartidoInvalido } from './sharing.errors.ts';
import {
  RepositorioDeComparticion,
  type FilaCodigoDeAcceso,
  type FilaEnlaceCompartido,
  type ResultadoDeIntento,
} from './sharing.repository.ts';
import { ServicioDeSesionesCompartidas, type SesionEmitida } from './share-session.service.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * LA PÁGINA DE ACCESO: C-CODE-02, C-CODE-03, C-CODE-04 y C-CODE-05.
 *
 * Tres invariantes que esta clase mantiene y que las pruebas comprueban:
 *
 *  I1. **Exactamente UNA operación Argon2id por intento, pase lo que pase.**
 *      Si el enlace no existe, si está revocado, si caducó o si el selector no
 *      está, se verifica igualmente contra un **hash señuelo**. Sin eso, «no
 *      existe» responde en 1 ms y «código incorrecto» en 45 ms, y el oráculo de
 *      AM-CODE-04 sigue abierto aunque el mensaje sea idéntico.
 *
 *  I2. **Un único camino de salida de fallo.** Hay una sola instrucción
 *      `throw new AccesoCompartidoInvalido()` en todo el fichero, al final de
 *      `#rechazar`. No se puede responder distinto por descuido porque no hay
 *      otra puerta.
 *
 *  I3. **El código en claro no sale de este método.** No se registra, no se
 *      audita, no se devuelve y no se persiste. Lo único que se deriva de él es
 *      el selector (que es público por diseño) y el resultado booleano de la
 *      verificación.
 * ════════════════════════════════════════════════════════════════════════════
 */

export interface ContextoDeAcceso {
  readonly ip: string;
  readonly userAgent: string | undefined;
  /** Si quien intenta tiene además sesión de usuario. Sólo para la auditoría. */
  readonly usuarioAutenticadoId: string | null;
}

export interface AccesoConcedido {
  readonly sesion: SesionEmitida;
  readonly enlace: FilaEnlaceCompartido;
}

/** Estado que ve la página de acceso ANTES de validar nada. */
export type EstadoDeLaPaginaDeAcceso = 'open' | 'code_required';

/**
 * Cadena contra la que se verifica el señuelo. Es un valor fijo y público a
 * propósito: lo que se iguala es el **coste**, no el resultado. Que nunca
 * coincida con el señuelo es irrelevante —el resultado se descarta—.
 */
const ENTRADA_SENUELO = 'ceiba-senuelo-de-igualacion-de-tiempos';

@Injectable()
export class ServicioDeAccesoCompartido implements OnModuleInit {
  readonly #log = new Logger('sharing');

  constructor(
    private readonly repo: RepositorioDeComparticion,
    private readonly sesiones: ServicioDeSesionesCompartidas,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(HASHER_DE_CONTRASENA) private readonly hasher: HasherDeContrasena,
    @Inject(RATE_LIMIT_STORE) private readonly limites: RateLimitStore,
    @Inject(PUERTO_DE_AUDITORIA) private readonly auditoria: PuertoDeAuditoria,
  ) {}

  /**
   * Calienta el señuelo al arrancar. El `hashSenuelo()` de `HasherArgon2id` lo
   * calcula una vez y lo memoiza; si la primera llamada cayera dentro de la
   * primera petición real, **ese** intento costaría el doble que los demás y
   * sería distinguible. Es el único intento que podría serlo, y se evita aquí.
   */
  onModuleInit(): void {
    void this.hasher.hashSenuelo().catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // Página de acceso (GET): no expone la colección antes de validar
  // -------------------------------------------------------------------------

  /**
   * §6: *«solicite el código sin exponer la colección antes de validarlo»*.
   *
   * Y además **no permite enumerar slugs**: un enlace inexistente, revocado o
   * caducado devuelve exactamente lo mismo que un enlace privado vivo
   * (`code_required`). Sólo un enlace público y vivo se distingue, que es lo
   * que significa ser público.
   */
  async estadoDeLaPagina(slug: string): Promise<EstadoDeLaPaginaDeAcceso> {
    const enlace = await this.repo.buscarEnlacePorSlug(slug);
    if (enlace === null) return 'code_required';
    if (this.#causaDelEnlace(enlace, this.reloj.ahora()) !== null) return 'code_required';
    return enlace.requiresAccessCode ? 'code_required' : 'open';
  }

  // -------------------------------------------------------------------------
  // Validación del código (POST)
  // -------------------------------------------------------------------------

  async acceder(
    slug: string,
    codigoEnClaro: unknown,
    contexto: ContextoDeAcceso,
  ): Promise<AccesoConcedido> {
    const marcaInicio = process.hrtime.bigint();

    // ── C-CODE-03, ANTES de calcular ningún hash ────────────────────────────
    await this.#comprobarLimites(slug, contexto.ip);

    const ahora = this.reloj.ahora();
    const enlace = await this.repo.buscarEnlacePorSlug(slug);

    // El selector se busca SIEMPRE que el cuerpo traiga algo con forma de
    // código, aunque el enlace ya haya fallado. Así el número de lecturas a la
    // base de datos tampoco depende de la causa.
    const partes = descomponerCodigo(codigoEnClaro);
    const filaCodigo =
      partes === null ? null : await this.repo.buscarCodigoPorSelector(partes.selector);

    // Bloqueo DURABLE del código: sobrevive a un reinicio del proceso, que es
    // lo que el contador en memoria no hace. Va aquí, antes del hash.
    if (
      filaCodigo !== null &&
      enlace !== null &&
      filaCodigo.sharedLinkId === enlace.id &&
      filaCodigo.lockedUntil !== null &&
      filaCodigo.lockedUntil.getTime() > ahora.getTime()
    ) {
      await this.#auditarIntento(enlace, filaCodigo, 'locked_out', contexto, ahora);
      throw new DemasiadasPeticiones(
        (filaCodigo.lockedUntil.getTime() - ahora.getTime()) / 1000,
      );
    }

    let causa: ResultadoDeIntento | null = enlace === null ? 'invalid_code' : null;
    if (enlace !== null) causa = this.#causaDelEnlace(enlace, ahora);

    let candidato: FilaCodigoDeAcceso | null = null;
    let codigoImplicado: FilaCodigoDeAcceso | null = null;

    if (enlace !== null && enlace.requiresAccessCode) {
      if (partes === null || filaCodigo === null || filaCodigo.sharedLinkId !== enlace.id) {
        // Selector ausente, con forma inválida, inexistente o **de otro
        // enlace**. Este último caso importa: un código válido de la colección
        // A no puede abrir la colección B.
        causa ??= 'invalid_code';
      } else {
        codigoImplicado = filaCodigo;
        const causaDelCodigo = this.#causaDelCodigo(filaCodigo, ahora);
        if (causaDelCodigo !== null) causa ??= causaDelCodigo;
        else candidato = filaCodigo;
      }
    }

    // ── I1: exactamente una operación Argon2id, siempre ─────────────────────
    if (candidato !== null && partes !== null) {
      const phc = Buffer.from(
        candidato.codeVerifierHash.buffer,
        candidato.codeVerifierHash.byteOffset,
        candidato.codeVerifierHash.byteLength,
      ).toString('utf8');
      const coincide = await this.hasher.verificar(phc, partes.verificador);
      if (!coincide) causa ??= 'invalid_code';
    } else {
      await this.hasher.verificar(await this.hasher.hashSenuelo(), ENTRADA_SENUELO);
    }

    if (causa !== null) {
      await this.#rechazar(slug, enlace, codigoImplicado, causa, contexto, ahora, marcaInicio);
    }

    // ── Éxito ───────────────────────────────────────────────────────────────
    // `enlace` no puede ser null aquí: `#rechazar` no retorna nunca. El
    // compilador no lo sabe, así que se comprueba en vez de aseverar.
    if (enlace === null) throw new AccesoCompartidoInvalido();

    const sesion = await this.sesiones.emitir(enlace, candidato, contexto.ip);
    await this.repo.registrarVista(enlace.id, ahora);
    if (candidato !== null) await this.repo.anotarUsoDeCodigo(candidato.id, ahora);
    await this.#auditarIntento(enlace, candidato, 'success', contexto, ahora);
    await this.#reiniciarContadores(slug);

    this.auditoria.registrar({
      accion: 'share.access.granted',
      actorUserId: contexto.usuarioAutenticadoId,
      workspaceId: enlace.workspaceId,
      recursoTipo: 'shared_link',
      recursoId: enlace.id,
      clientIp: contexto.ip,
      outcome: 'success',
      // NUNCA el código ni su hash: sólo el evento y el identificador del
      // enlace, que es literalmente lo que C-CODE-05 permite registrar.
      detalles: { permiso: enlace.permission, conCodigo: candidato !== null },
    });

    await this.#igualarTiempo(marcaInicio);
    return { sesion, enlace };
  }

  // -------------------------------------------------------------------------
  // Decisión de causa. Devuelve el motivo REAL, que sólo verá la auditoría.
  // -------------------------------------------------------------------------

  #causaDelEnlace(enlace: FilaEnlaceCompartido, ahora: Date): ResultadoDeIntento | null {
    if (enlace.state === 'revoked' || enlace.revokedAt !== null) return 'revoked';
    if (enlace.state !== 'active') return 'expired';
    if (enlace.expiresAt !== null && enlace.expiresAt.getTime() <= ahora.getTime()) {
      return 'expired';
    }
    if (enlace.maxViews !== null && enlace.viewCount >= enlace.maxViews) return 'expired';
    return null;
  }

  #causaDelCodigo(codigo: FilaCodigoDeAcceso, ahora: Date): ResultadoDeIntento | null {
    if (codigo.state === 'revoked' || codigo.revokedAt !== null) return 'revoked';
    if (codigo.state !== 'active') return 'expired';
    if (codigo.expiresAt !== null && codigo.expiresAt.getTime() <= ahora.getTime()) {
      return 'expired';
    }
    if (codigo.maxUses !== null && codigo.useCount >= codigo.maxUses) return 'expired';
    return null;
  }

  // -------------------------------------------------------------------------
  // I2: la ÚNICA salida de fallo
  // -------------------------------------------------------------------------

  async #rechazar(
    slug: string,
    enlace: FilaEnlaceCompartido | null,
    codigo: FilaCodigoDeAcceso | null,
    causa: ResultadoDeIntento,
    contexto: ContextoDeAcceso,
    ahora: Date,
    marcaInicio: bigint,
  ): Promise<never> {
    const conteo = await this.limites.incrementar(
      CLAVES.fallosPorEnlace(slug),
      VENTANA_POR_ENLACE_MS,
    );
    await this.limites.incrementar(CLAVES.fallosPorIp(contexto.ip), VENTANA_POR_IP_MS);

    const retardoMs = calcularBackoffDeEnlaceMs(conteo.contador);
    if (retardoMs > 0) {
      // `reiniciar` + `incrementar` y no sólo `incrementar`: el almacén conserva
      // el vencimiento de la ventana existente, y aquí hace falta una ventana
      // NUEVA de `retardoMs`, que es más larga en cada fallo.
      await this.limites.reiniciar(CLAVES.esperaPorEnlace(slug));
      await this.limites.incrementar(CLAVES.esperaPorEnlace(slug), retardoMs);
    }

    if (enlace !== null) {
      await this.#auditarIntento(enlace, codigo, causa, contexto, ahora);

      if (codigo !== null) {
        const fallosDurables = codigo.failedAttemptCount + 1;
        const retardoDurable = calcularBackoffDeEnlaceMs(fallosDurables, codigo.maxAttempts);
        await this.repo.anotarFalloEnCodigo(
          codigo.id,
          retardoDurable > 0 ? new Date(ahora.getTime() + retardoDurable) : null,
        );
      }

      await this.#revocarSiAtaqueSostenido(enlace, contexto, ahora);
    }

    // El motivo real al registro interno, jamás a la respuesta. Y sin el
    // código: aquí sólo hay el slug (público) y el motivo.
    this.#log.warn(`share access denied slug=${slug} motivo=${causa}`);

    await this.#igualarTiempo(marcaInicio);
    throw new AccesoCompartidoInvalido();
  }

  // -------------------------------------------------------------------------
  // C-CODE-03, tercer contador: revocación automática del enlace
  // -------------------------------------------------------------------------

  /**
   * 100 fallos en 24 h → se revoca el enlace y se avisa al propietario.
   *
   * Es el compromiso que C-CODE-03 asume explícitamente: *«es preferible a
   * dejar un enlace bajo ataque sostenido abierto indefinidamente»*. El umbral
   * es alto y la ventana larga justamente para que un tercero no pueda usarlo
   * como arma: llegar a 100 fallos exige atravesar antes todo el backoff.
   *
   * El contador se lee de `share_access_attempts`, no de la memoria: así
   * sobrevive a un reinicio y cuenta de verdad las 24 h.
   */
  async #revocarSiAtaqueSostenido(
    enlace: FilaEnlaceCompartido,
    contexto: ContextoDeAcceso,
    ahora: Date,
  ): Promise<void> {
    const desde = new Date(ahora.getTime() - VENTANA_REVOCACION_MS);
    const fallos = await this.repo.contarFallosDesde(enlace.id, desde);
    if (fallos < UMBRAL_REVOCACION_AUTOMATICA) return;

    const efecto = await this.repo.revocarEnlace(enlace.id, null, 'admin_revoked', ahora);
    this.auditoria.registrar({
      accion: 'share.link.auto_revoked',
      actorUserId: null,
      workspaceId: enlace.workspaceId,
      recursoTipo: 'shared_link',
      recursoId: enlace.id,
      clientIp: contexto.ip,
      outcome: 'denied',
      detalles: {
        fallosEn24h: fallos,
        sesionesRevocadas: efecto.sesionesRevocadas,
        avisoAlPropietario: 'regenerar_enlace',
      },
    });
    this.#log.error(
      `enlace ${enlace.id} revocado automáticamente: ${fallos} fallos en 24 h ` +
        '(C-CODE-03, tercer contador)',
    );
  }

  // -------------------------------------------------------------------------
  // C-CODE-03, puerta previa
  // -------------------------------------------------------------------------

  async #comprobarLimites(slug: string, ip: string): Promise<void> {
    const espera = await this.limites.leer(CLAVES.esperaPorEnlace(slug));
    if (espera !== null) {
      throw new DemasiadasPeticiones(espera.restanteMs / 1000);
    }
    const porIp = await this.limites.leer(CLAVES.fallosPorIp(ip));
    if (porIp !== null && porIp.contador >= UMBRAL_POR_IP) {
      throw new DemasiadasPeticiones(porIp.restanteMs / 1000);
    }
    const porEnlace = await this.limites.leer(CLAVES.fallosPorEnlace(slug));
    if (porEnlace !== null && porEnlace.contador >= UMBRAL_POR_ENLACE) {
      const retardo = calcularBackoffDeEnlaceMs(porEnlace.contador + 1);
      if (retardo > 0) throw new DemasiadasPeticiones(retardo / 1000);
    }
  }

  async #reiniciarContadores(slug: string): Promise<void> {
    await this.limites.reiniciar(CLAVES.fallosPorEnlace(slug));
    await this.limites.reiniciar(CLAVES.esperaPorEnlace(slug));
  }

  // -------------------------------------------------------------------------
  // Auditoría del propietario — AQUÍ Y SÓLO AQUÍ se distingue la causa
  // -------------------------------------------------------------------------

  async #auditarIntento(
    enlace: FilaEnlaceCompartido,
    codigo: FilaCodigoDeAcceso | null,
    resultado: ResultadoDeIntento,
    contexto: ContextoDeAcceso,
    ahora: Date,
  ): Promise<void> {
    try {
      await this.repo.registrarIntento({
        sharedLinkId: enlace.id,
        // NULL cuando el selector no existía: registrarlo así evita confirmar
        // la existencia del código incluso dentro de la propia auditoría.
        shareAccessCodeId: codigo?.id ?? null,
        result: resultado,
        clientIp: contexto.ip,
        clientIpPrefix: prefijoDeIp(contexto.ip),
        userAgentHash: hashDeUserAgent(contexto.userAgent),
        authenticatedUserId: contexto.usuarioAutenticadoId,
        attemptedAt: ahora,
      });
    } catch (error) {
      // Perder la respuesta por no poder auditar sería peor que perder el
      // registro: el visitante legítimo quedaría fuera. Se deja constancia
      // ruidosa y se sigue.
      this.#log.error(
        `no se pudo registrar el intento de acceso: ${(error as Error).message}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // C-CODE-04 — igualación de tiempos
  // -------------------------------------------------------------------------

  /**
   * Piso de tiempo con reloj REAL (`hrtime`), no con el reloj inyectado: lo que
   * se iguala es lo que mide un cronómetro desde fuera, y un reloj falso que
   * avanza a saltos no retrasa nada.
   */
  async #igualarTiempo(marcaInicio: bigint): Promise<void> {
    const transcurridoMs = Number(process.hrtime.bigint() - marcaInicio) / 1e6;
    const restante = PISO_DE_RESPUESTA_MS - transcurridoMs;
    if (restante > 0) await esperar(restante);
  }
}

// ---------------------------------------------------------------------------
// Utilidades de auditoría con menos PII
// ---------------------------------------------------------------------------

/**
 * IP truncada: `/24` en IPv4 y `/64` en IPv6, que es lo que pide el comentario
 * de `share_access_attempts.client_ip_prefix`. Sirve igual para correlacionar y
 * guarda menos dato personal.
 */
export function prefijoDeIp(ip: string): string | null {
  if (ip.length === 0) return null;
  if (ip.includes(':')) {
    const grupos = ip.split(':');
    const primeros = grupos.slice(0, 4).map((g) => (g === '' ? '0' : g));
    while (primeros.length < 4) primeros.push('0');
    return `${primeros.join(':')}::`;
  }
  const octetos = ip.split('.');
  if (octetos.length !== 4) return null;
  return `${octetos[0]}.${octetos[1]}.${octetos[2]}.0`;
}

/** Hash, no el `User-Agent` entero: correlaciona igual con menos superficie. */
export function hashDeUserAgent(userAgent: string | undefined): Uint8Array | null {
  if (userAgent === undefined || userAgent.length === 0) return null;
  return createHash('sha256').update(userAgent, 'utf8').digest();
}

/**
 * Perfil con el que se hashea el código. Se reexporta desde aquí para que la
 * prueba pueda afirmar que es **el mismo** que usa el registro de usuarios y no
 * una copia que se pueda desincronizar.
 */
export const PERFIL_DE_HASH_DEL_CODIGO = PERFIL_ARGON2ID;
