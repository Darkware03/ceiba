import { Inject, Injectable, Logger } from '@nestjs/common';
import { RELOJ, type Reloj } from '../../platform/time/clock.ts';
import {
  HASHER_DE_CONTRASENA,
  type HasherDeContrasena,
} from '../../platform/crypto/password-hasher.ts';
import { verificarTotp } from '../../platform/crypto/totp.ts';
import {
  Conflicto,
  DemasiadasPeticiones,
  NoAutenticado,
} from '../../platform/errors/domain-errors.ts';
import { PUERTO_DE_AUDITORIA, type PuertoDeAuditoria } from '../../platform/audit/ports.ts';
import {
  RATE_LIMIT_STORE,
  type RateLimitStore,
} from '../../platform/ratelimit/rate-limit-store.ts';
import { calcularBloqueoHasta } from '../../platform/ratelimit/backoff.ts';
import {
  REPOSITORIO_DE_USUARIOS,
  type RepositorioDeUsuarios,
} from '../../platform/persistence/repositories.ts';
import type { FilaUsuario } from '../../platform/persistence/records.ts';
import type { ContextoDePeticion } from '../../platform/auth/principal.ts';
import { ServicioDeSesiones, type SesionEmitida } from './session.service.ts';
import {
  ALMACEN_DE_RETOS_MFA,
  type AlmacenDeRetosMfa,
} from './mfa-challenge.store.ts';
import {
  PROVEEDOR_DE_SEMILLA_TOTP,
  type ProveedorDeSemillaTotp,
} from './totp-seed.provider.ts';

/** Ventana e intentos del límite por IP para el inicio de sesión. */
export const VENTANA_LIMITE_IP_MS = 900_000; // 15 min
export const MAX_INTENTOS_POR_IP = 50;
export const TTL_RETO_MFA_MS = 300_000; // 5 min

export interface PerfilPublico {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly locale: string;
  readonly timezone: string;
  readonly mfaEnabled: boolean;
  readonly emailVerificado: boolean;
}

export type ResultadoDeInicio =
  | { readonly tipo: 'sesion'; readonly sesion: SesionEmitida; readonly perfil: PerfilPublico }
  | {
      readonly tipo: 'mfa_requerido';
      readonly retoId: string;
      readonly retoTestigo: string;
      readonly expiraEn: Date;
    };

@Injectable()
export class ServicioDeIdentidad {
  readonly #log = new Logger('identity');

  constructor(
    @Inject(REPOSITORIO_DE_USUARIOS) private readonly usuarios: RepositorioDeUsuarios,
    @Inject(HASHER_DE_CONTRASENA) private readonly hasher: HasherDeContrasena,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(PUERTO_DE_AUDITORIA) private readonly auditoria: PuertoDeAuditoria,
    @Inject(RATE_LIMIT_STORE) private readonly limites: RateLimitStore,
    @Inject(ALMACEN_DE_RETOS_MFA) private readonly retos: AlmacenDeRetosMfa,
    @Inject(PROVEEDOR_DE_SEMILLA_TOTP) private readonly semillas: ProveedorDeSemillaTotp,
    private readonly sesiones: ServicioDeSesiones,
  ) {}

  // -------------------------------------------------------------------------
  // Registro
  // -------------------------------------------------------------------------

  /**
   * ENUMERACIÓN, dicho sin adornos: este endpoint **sí** permite distinguir un
   * correo registrado de uno libre, porque devuelve 409 si ya existe. El patrón
   * que lo evita («siempre 202, te hemos enviado un correo») exige un modelo de
   * verificación de correo que **no existe en el esquema**: es un HUECO que el
   * propio ADR-0009 declara y asigna a `database-engineer`. No lo tapo con un
   * 202 falso que nunca envía nada. Mitigación aplicada mientras tanto: límite
   * por IP sobre este endpoint.
   */
  async registrar(
    correo: string,
    contrasena: string,
    nombre: string,
    contexto: ContextoDePeticion,
  ): Promise<PerfilPublico> {
    await this.#comprobarLimitePorIp(`registro:${contexto.ip}`);

    const ahora = this.reloj.ahora();
    const existente = await this.usuarios.buscarPorCorreo(correo);
    if (existente !== null) {
      throw new Conflicto('Ese correo no está disponible.');
    }

    const hash = await this.hasher.hashear(contrasena);
    const usuario = await this.usuarios.crear(
      {
        email: correo.trim(),
        passwordHash: hash,
        displayName: nombre.trim(),
        status: 'active',
      },
      ahora,
    );

    this.auditoria.registrar({
      accion: 'auth.register',
      actorUserId: usuario.id,
      sessionId: null,
      workspaceId: null,
      recursoTipo: 'user',
      recursoId: usuario.id,
      clientIp: contexto.ip,
    });
    return perfilPublico(usuario);
  }

  // -------------------------------------------------------------------------
  // Inicio de sesión (§8)
  // -------------------------------------------------------------------------

  /**
   * No enumeración, mecanismo exacto:
   *
   *  - Si el correo NO existe, se verifica igualmente contra un **hash señuelo**
   *    Argon2id del mismo perfil. El coste y el tiempo son los mismos.
   *  - Correo inexistente, contraseña incorrecta, cuenta bloqueada y cuenta no
   *    activa producen **la misma excepción**, que el filtro serializa como el
   *    mismo 401 con el mismo cuerpo. El motivo real sólo va al log.
   *  - El orden de las comprobaciones NO cortocircuita antes del hash: el hash
   *    se calcula siempre, también cuando la cuenta está bloqueada o inactiva.
   */
  async iniciarSesion(
    correo: string,
    contrasena: string,
    contexto: ContextoDePeticion,
  ): Promise<ResultadoDeInicio> {
    await this.#comprobarLimitePorIp(`login:${contexto.ip}`);

    const ahora = this.reloj.ahora();
    const usuario = await this.usuarios.buscarPorCorreo(correo);

    const hashAComparar =
      usuario?.passwordHash !== undefined && usuario?.passwordHash !== null
        ? usuario.passwordHash
        : await this.hasher.hashSenuelo();

    const contrasenaCorrecta = await this.hasher.verificar(hashAComparar, contrasena);

    if (usuario === null) {
      this.#registrarFalloAnonimo(correo, contexto, 'correo_inexistente');
      throw new NoAutenticado('correo_inexistente');
    }

    const bloqueado =
      usuario.lockedUntil !== null && usuario.lockedUntil.getTime() > ahora.getTime();
    if (bloqueado) {
      this.#registrarFallo(usuario, contexto, 'cuenta_en_backoff');
      throw new NoAutenticado('cuenta_en_backoff');
    }

    if (!contrasenaCorrecta) {
      const fallos = usuario.failedLoginCount + 1;
      const bloqueadoHasta = calcularBloqueoHasta(fallos, ahora);
      await this.usuarios.registrarFalloDeAcceso(usuario.id, fallos, bloqueadoHasta, ahora);
      this.#registrarFallo(usuario, contexto, 'contrasena_incorrecta');
      if (bloqueadoHasta !== null) {
        this.auditoria.registrar({
          accion: 'auth.locked_out',
          actorUserId: usuario.id,
          sessionId: null,
          workspaceId: null,
          recursoTipo: 'user',
          recursoId: usuario.id,
          clientIp: contexto.ip,
          metadata: { fallosConsecutivos: fallos },
        });
      }
      throw new NoAutenticado('contrasena_incorrecta');
    }

    if (usuario.status !== 'active' || usuario.deletedAt !== null) {
      this.#registrarFallo(usuario, contexto, `estado_${usuario.status}`);
      throw new NoAutenticado(`estado_no_activo:${usuario.status}`);
    }

    if (usuario.mfaEnabled) {
      // §8: «la contraseña NO emite sesión». No hay sesión a medias en la tabla.
      const reto = await this.retos.crear(usuario.id, ahora, TTL_RETO_MFA_MS);
      await this.usuarios.registrarAccesoCorrecto(usuario.id, ahora);
      return {
        tipo: 'mfa_requerido',
        retoId: reto.id,
        retoTestigo: reto.testigo,
        expiraEn: reto.expiraEn,
      };
    }

    return this.#emitirSesionTrasAutenticar(usuario, contexto, ahora);
  }

  /** Segundo paso del 2FA: valida el TOTP y sólo entonces crea la sesión. */
  async verificarSegundoFactor(
    retoId: string,
    retoTestigo: string,
    codigo: string,
    contexto: ContextoDePeticion,
  ): Promise<ResultadoDeInicio> {
    await this.#comprobarLimitePorIp(`mfa:${contexto.ip}`);
    const ahora = this.reloj.ahora();

    const reto = await this.retos.consumir(retoId, retoTestigo, ahora);
    if (reto === null) throw new NoAutenticado('reto_mfa_invalido');

    const usuario = await this.usuarios.buscarPorId(reto.usuarioId);
    if (usuario === null || usuario.status !== 'active' || usuario.deletedAt !== null) {
      throw new NoAutenticado('reto_mfa_usuario_no_valido');
    }
    if (!usuario.mfaEnabled || usuario.mfaSecretId === null) {
      throw new NoAutenticado('reto_mfa_sin_secreto');
    }

    const semilla = await this.semillas.obtenerSemilla(usuario.mfaSecretId);
    if (semilla === null) throw new NoAutenticado('semilla_totp_no_disponible');

    if (!verificarTotp(semilla, codigo, ahora.getTime())) {
      this.#registrarFallo(usuario, contexto, 'totp_incorrecto');
      throw new NoAutenticado('totp_incorrecto');
    }

    return this.#emitirSesionTrasAutenticar(usuario, contexto, ahora);
  }

  async #emitirSesionTrasAutenticar(
    usuario: FilaUsuario,
    contexto: ContextoDePeticion,
    ahora: Date,
  ): Promise<ResultadoDeInicio> {
    await this.usuarios.registrarAccesoCorrecto(usuario.id, ahora);
    const sesion = await this.sesiones.emitir(usuario.id, contexto);
    await this.limites.reiniciar(`login:${contexto.ip}`);
    this.auditoria.registrar({
      accion: 'auth.login',
      actorUserId: usuario.id,
      sessionId: sesion.sesion.id,
      workspaceId: null,
      recursoTipo: 'user',
      recursoId: usuario.id,
      clientIp: contexto.ip,
    });
    return { tipo: 'sesion', sesion, perfil: perfilPublico(usuario) };
  }

  // -------------------------------------------------------------------------
  // Cambio de contraseña (§8)
  // -------------------------------------------------------------------------

  /**
   * «Al cambiar la contraseña se revocan **todas** las sesiones del usuario con
   * `password_changed`, salvo la que ejecuta el cambio, que se **rota**.»
   */
  async cambiarContrasena(
    usuarioId: string,
    sesionActualId: string,
    contrasenaActual: string,
    contrasenaNueva: string,
    contexto: ContextoDePeticion,
  ): Promise<SesionEmitida> {
    const ahora = this.reloj.ahora();
    const usuario = await this.usuarios.buscarPorId(usuarioId);
    if (usuario === null) throw new NoAutenticado('usuario_inexistente');

    const hashAComparar = usuario.passwordHash ?? (await this.hasher.hashSenuelo());
    if (!(await this.hasher.verificar(hashAComparar, contrasenaActual))) {
      throw new NoAutenticado('contrasena_actual_incorrecta');
    }

    await this.usuarios.actualizarContrasena(
      usuarioId,
      await this.hasher.hashear(contrasenaNueva),
      ahora,
    );
    await this.sesiones.revocarOtras(usuarioId, sesionActualId, 'password_changed');

    const actual = await this.sesiones.buscarPorId(sesionActualId);
    if (actual === null) throw new NoAutenticado('sesion_actual_inexistente');
    const rotada = await this.sesiones.rotar(actual, contexto, 'rotated');

    this.auditoria.registrar({
      accion: 'auth.password_changed',
      actorUserId: usuarioId,
      sessionId: rotada.sesion.id,
      workspaceId: null,
      recursoTipo: 'user',
      recursoId: usuarioId,
      clientIp: contexto.ip,
    });
    return rotada;
  }

  async perfilDe(usuarioId: string): Promise<PerfilPublico | null> {
    const usuario = await this.usuarios.buscarPorId(usuarioId);
    return usuario === null ? null : perfilPublico(usuario);
  }

  // -------------------------------------------------------------------------

  async #comprobarLimitePorIp(clave: string): Promise<void> {
    const conteo = await this.limites.incrementar(clave, VENTANA_LIMITE_IP_MS);
    if (conteo.contador > MAX_INTENTOS_POR_IP) {
      throw new DemasiadasPeticiones(conteo.restanteMs / 1000);
    }
  }

  #registrarFallo(usuario: FilaUsuario, contexto: ContextoDePeticion, motivo: string): void {
    this.#log.warn(`auth.login_failed motivo=${motivo}`);
    this.auditoria.registrar({
      accion: 'auth.login_failed',
      actorUserId: usuario.id,
      sessionId: null,
      workspaceId: null,
      recursoTipo: 'user',
      recursoId: usuario.id,
      clientIp: contexto.ip,
      metadata: { motivo },
    });
  }

  /** Sin usuario no hay `actor_user_id`; el correo NO se escribe en el evento. */
  #registrarFalloAnonimo(_correo: string, contexto: ContextoDePeticion, motivo: string): void {
    this.#log.warn(`auth.login_failed motivo=${motivo}`);
    this.auditoria.registrar({
      accion: 'auth.login_failed',
      actorUserId: null,
      sessionId: null,
      workspaceId: null,
      recursoTipo: 'user',
      recursoId: null,
      clientIp: contexto.ip,
      metadata: { motivo },
    });
  }
}

export function perfilPublico(usuario: FilaUsuario): PerfilPublico {
  // Nunca se serializa `passwordHash`, `mfaSecretId`, `failedLoginCount` ni
  // `lockedUntil`: revelarían material sensible o permitirían enumerar estado.
  return {
    id: usuario.id,
    email: usuario.email,
    displayName: usuario.displayName,
    locale: usuario.locale,
    timezone: usuario.timezone,
    mfaEnabled: usuario.mfaEnabled,
    emailVerificado: usuario.emailVerifiedAt !== null,
  };
}
