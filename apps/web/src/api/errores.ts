/**
 * Errores que la interfaz distingue.
 *
 * El contrato de error de la API es el de
 * `apps/api/src/platform/errors/domain-error.filter.ts`:
 * `{ error: string, mensaje: string, detalles?: string[] }`.
 * Esta capa NO lo reinventa: lo transcribe.
 */

/** La API respondió, pero con un estado de error. */
export class ErrorDeApi extends Error {
  override readonly name = 'ErrorDeApi';
  readonly estado: number;
  /** Código estable del dominio: `no_autenticado`, `csrf_invalido`, … */
  readonly codigo: string;
  readonly detalles: readonly string[];

  constructor(estado: number, codigo: string, mensaje: string, detalles: readonly string[] = []) {
    super(mensaje);
    this.estado = estado;
    this.codigo = codigo;
    this.detalles = detalles;
  }

  get esNoAutenticado(): boolean {
    return this.estado === 401;
  }

  get esCsrf(): boolean {
    return this.codigo === 'csrf_invalido';
  }
}

/**
 * La interfaz pide algo que **la API todavía no expone**.
 *
 * No es un fallo de red ni un 404 del servidor: es un hueco conocido del
 * contrato, comprobado ruta por ruta contra
 * `apps/api/src/modules/studio/studio.controller.ts`. Se declara como tipo
 * propio para que la vista pueda distinguirlo y decirlo con todas sus letras
 * en vez de inventarse el endpoint o disfrazar el hueco de error pasajero con
 * un botón de «reintentar» que nunca va a funcionar.
 */
export class ErrorDeHueco extends Error {
  override readonly name = 'ErrorDeHueco';
  /** Ruta que haría falta, tal y como se pediría: `GET /workspaces/:id/runs/:runId`. */
  readonly rutaQueFalta: string;

  constructor(rutaQueFalta: string, mensaje?: string) {
    super(
      mensaje ??
        `La API todavía no expone «${rutaQueFalta}». Es un hueco conocido del ` +
          'contrato, no un fallo pasajero.',
    );
    this.rutaQueFalta = rutaQueFalta;
  }
}

/** `true` si el fallo es un hueco del contrato y no un error de ejecución. */
export function esErrorDeHueco(error: unknown): error is ErrorDeHueco {
  return error instanceof ErrorDeHueco;
}

/** No hubo respuesta: red caída, servidor apagado, CORS, petición abortada. */
export class ErrorDeRed extends Error {
  override readonly name = 'ErrorDeRed';
  readonly causaOriginal: unknown;

  constructor(mensaje: string, causaOriginal?: unknown) {
    super(mensaje);
    this.causaOriginal = causaOriginal;
  }
}

/**
 * Mensaje presentable al usuario, en español y sin filtrar detalles internos.
 * Se usa en todos los estados de error de la interfaz para no tener dos
 * redacciones distintas del mismo fallo.
 */
export function mensajeDeError(error: unknown): string {
  if (error instanceof ErrorDeApi) {
    if (error.detalles.length > 0) return `${error.message} (${error.detalles.join('; ')})`;
    return error.message;
  }
  if (error instanceof ErrorDeHueco) return error.message;
  if (error instanceof ErrorDeRed) return error.message;
  if (error instanceof Error && error.message.length > 0) return error.message;
  return 'Ha ocurrido un error inesperado.';
}
