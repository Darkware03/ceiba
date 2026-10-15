import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Inject,
  Logger,
} from '@nestjs/common';
import { CONFIGURACION_APP, type ConfiguracionApp } from '../config/app-config.ts';
import {
  DemasiadasPeticiones,
  EntradaInvalida,
  ErrorDeDominio,
  NoAutenticado,
} from './domain-errors.ts';
import type { RespuestaHttp } from '../http/http-types.ts';

interface RespuestaConEstado extends RespuestaHttp {
  status(codigo: number): RespuestaConEstado;
  send(cuerpo: unknown): unknown;
}

/**
 * Serializa los errores de dominio a una forma única y **sin fugas**.
 *
 * Reglas que esta capa hace cumplir:
 *  - `NoAutenticado` -> siempre el MISMO cuerpo y el MISMO código, sea cual sea
 *    el motivo (ADR-0009 §2). El motivo real va al log interno, nunca al
 *    cliente, y nunca incluye el testigo, el selector ni el verificador.
 *  - Un error inesperado -> 500 genérico. No se filtran trazas ni mensajes de
 *    la base de datos.
 */
@Catch()
export class FiltroDeErroresDeDominio implements ExceptionFilter {
  readonly #log = new Logger('errores');

  constructor(@Inject(CONFIGURACION_APP) private readonly config: ConfiguracionApp) {}

  catch(excepcion: unknown, host: ArgumentsHost): void {
    const respuesta = host.switchToHttp().getResponse<RespuestaConEstado>();

    if (excepcion instanceof NoAutenticado) {
      this.#log.warn(`401 ${excepcion.motivoInterno}`);
      respuesta.status(401).send({ error: excepcion.codigo, mensaje: excepcion.message });
      return;
    }

    if (excepcion instanceof DemasiadasPeticiones) {
      respuesta.header('Retry-After', excepcion.reintentarEnSegundos);
      respuesta
        .status(excepcion.estadoHttp)
        .send({ error: excepcion.codigo, mensaje: excepcion.message });
      return;
    }

    if (excepcion instanceof EntradaInvalida) {
      respuesta.status(excepcion.estadoHttp).send({
        error: excepcion.codigo,
        mensaje: excepcion.message,
        detalles: excepcion.detalles,
      });
      return;
    }

    if (excepcion instanceof ErrorDeDominio) {
      respuesta
        .status(excepcion.estadoHttp)
        .send({ error: excepcion.codigo, mensaje: excepcion.message });
      return;
    }

    if (excepcion instanceof HttpException) {
      const estado = excepcion.getStatus();
      const cuerpo = excepcion.getResponse();
      respuesta
        .status(estado)
        .send(typeof cuerpo === 'string' ? { error: 'error_http', mensaje: cuerpo } : cuerpo);
      return;
    }

    this.#log.error(
      `500 no controlado: ${excepcion instanceof Error ? excepcion.message : String(excepcion)}`,
      this.config.esProduccion ? undefined : (excepcion as Error)?.stack,
    );
    respuesta.status(500).send({ error: 'error_interno', mensaje: 'Error interno.' });
  }
}
