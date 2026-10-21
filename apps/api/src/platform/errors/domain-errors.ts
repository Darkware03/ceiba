/**
 * Errores de dominio de `apps/api`.
 *
 * Dos reglas del ADR-0009 que esta jerarquía hace cumplir:
 *
 *  - §2  «Si algo falla: **una sola respuesta** `401` idéntica para todos los
 *        casos». `NoAutenticado` no admite mensaje variable.
 *  - §7.4 «La denegación devuelve **404**, no 403, cuando revelar la existencia
 *        del recurso ya sería una fuga». `RecursoNoEncontrado` es el valor por
 *        defecto de la autorización por recurso; `Prohibido` se reserva a los
 *        casos en los que el usuario YA sabe que el recurso existe (es miembro
 *        del workspace) y sólo le falta el rol.
 */

export abstract class ErrorDeDominio extends Error {
  abstract readonly estadoHttp: number;
  abstract readonly codigo: string;
}

/** 401 único e indistinguible. El motivo real sólo va al registro interno. */
export class NoAutenticado extends ErrorDeDominio {
  override readonly name = 'NoAutenticado';
  readonly estadoHttp = 401;
  readonly codigo = 'no_autenticado';
  /** Motivo interno, NUNCA se serializa al cliente. */
  readonly motivoInterno: string;

  constructor(motivoInterno: string) {
    super('Credenciales inválidas o sesión no válida.');
    this.motivoInterno = motivoInterno;
  }
}

/** 403: el usuario está autenticado y ve el recurso, pero le falta el rol. */
export class Prohibido extends ErrorDeDominio {
  override readonly name = 'Prohibido';
  readonly estadoHttp = 403;
  readonly codigo = 'prohibido';
}

/** 403 específico de CSRF, para que la auditoría distinga el motivo. */
export class CsrfInvalido extends ErrorDeDominio {
  override readonly name = 'CsrfInvalido';
  readonly estadoHttp = 403;
  readonly codigo = 'csrf_invalido';
}

/** 404: también se usa para «existe pero no es tuyo» (ADR-0009 §7.4). */
export class RecursoNoEncontrado extends ErrorDeDominio {
  override readonly name = 'RecursoNoEncontrado';
  readonly estadoHttp = 404;
  readonly codigo = 'no_encontrado';

  constructor(mensaje = 'Recurso no encontrado.') {
    super(mensaje);
  }
}

/** 409: conflicto de unicidad (slug repetido, etc.). */
export class Conflicto extends ErrorDeDominio {
  override readonly name = 'Conflicto';
  readonly estadoHttp = 409;
  readonly codigo = 'conflicto';
}

/** 422: entrada que no supera la validación de esquema. */
export class EntradaInvalida extends ErrorDeDominio {
  override readonly name = 'EntradaInvalida';
  readonly estadoHttp = 422;
  readonly codigo = 'entrada_invalida';
  readonly detalles: readonly string[];

  constructor(mensaje: string, detalles: readonly string[] = []) {
    super(mensaje);
    this.detalles = detalles;
  }
}

/** 429: backoff o límite por IP. `reintentarEnSegundos` alimenta `Retry-After`. */
export class DemasiadasPeticiones extends ErrorDeDominio {
  override readonly name = 'DemasiadasPeticiones';
  readonly estadoHttp = 429;
  readonly codigo = 'demasiadas_peticiones';
  readonly reintentarEnSegundos: number;

  constructor(reintentarEnSegundos: number, mensaje = 'Demasiados intentos. Inténtalo más tarde.') {
    super(mensaje);
    this.reintentarEnSegundos = Math.max(1, Math.ceil(reintentarEnSegundos));
  }
}

export {
  EntradaInvalida as SolicitudInvalida,
  EntradaInvalida as ReglaDeNegocioViolada,
  EntradaInvalida as DatosDeEntradaInvalidos,
  Prohibido as AccesoProhibido,
  Conflicto as ConflictoDeEstado,
};

