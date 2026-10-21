import { ErrorDeDominio } from '../../platform/errors/domain-errors.ts';

export { type ConfiguracionDeFicheros } from './file.config.ts';

/** Token de inyección de la configuración del almacén. */
export const CONFIGURACION_DE_FICHEROS = Symbol('CEIBA_CONFIGURACION_DE_FICHEROS');

/**
 * 413 — el §2.2 del BRIEF-FASE7 lo exige explícitamente («rechazo con 413 por
 * encima»).
 *
 * Se define **aquí** y no en `platform/errors/domain-errors.ts` porque ese
 * fichero está fuera de mi ámbito de escritura en la fase 7. Hereda de
 * `ErrorDeDominio`, así que `FiltroDeErroresDeDominio` ya lo serializa por la
 * rama genérica (`respuesta.status(excepcion.estadoHttp)`) sin tocar el filtro.
 * Queda **declarado en el informe** como petición de cambio fuera de ámbito:
 * su sitio natural es junto a los demás errores de dominio.
 */
export class CargaDemasiadoGrande extends ErrorDeDominio {
  override readonly name = 'CargaDemasiadoGrande';
  readonly estadoHttp = 413;
  readonly codigo = 'carga_demasiado_grande';
}

/** 415 — `Content-Type` que esta ruta no sabe leer. */
export class TipoDeMedioNoSoportado extends ErrorDeDominio {
  override readonly name = 'TipoDeMedioNoSoportado';
  readonly estadoHttp = 415;
  readonly codigo = 'tipo_de_medio_no_soportado';
}
