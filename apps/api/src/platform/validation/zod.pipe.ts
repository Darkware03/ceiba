import { Injectable, type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { EntradaInvalida } from '../errors/domain-errors.ts';

/**
 * Validación de entrada con Zod 4 (la versión fijada por el ADR-0008).
 *
 * Se valida **en el servidor y siempre**: el cuerpo que llega es entrada no
 * confiable. Los errores se devuelven como 422 con la lista de campos, nunca
 * con la traza ni con el valor recibido (podría contener la contraseña).
 */
@Injectable()
export class PipeZod<T> implements PipeTransform<unknown, T> {
  constructor(private readonly esquema: ZodType<T>) {}

  transform(valor: unknown): T {
    const resultado = this.esquema.safeParse(valor);
    if (resultado.success) return resultado.data;
    const detalles = resultado.error.issues.map(
      (issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`,
    );
    throw new EntradaInvalida('La entrada no es válida.', detalles);
  }
}
