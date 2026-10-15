import { Injectable } from '@nestjs/common';
import type { ResolutorDeRecurso } from './ports.ts';

/**
 * Registro de resolutores recurso -> `workspace_id`.
 *
 * Cada módulo dueño de un recurso se registra a sí mismo en su `onModuleInit`.
 * Así el fichero de costura `app.module.ts` sigue teniendo **una línea por
 * módulo**, que es el protocolo vinculante del ADR-0004 §3, en vez de ir
 * acumulando una entrada por tipo de recurso.
 *
 * El guard consulta este registro; **no importa nada de `modules/`**.
 */
@Injectable()
export class RegistroDeResolutores {
  readonly #porTipo = new Map<string, ResolutorDeRecurso>();

  registrar(resolutor: ResolutorDeRecurso): void {
    const existente = this.#porTipo.get(resolutor.tipo);
    if (existente !== undefined && existente !== resolutor) {
      // Dos resolutores para el mismo tipo significa que dos módulos se
      // disputan la propiedad del recurso. Eso es un error de diseño, no algo
      // que se resuelva «ganando el último».
      throw new Error(`ya hay un resolutor registrado para el tipo "${resolutor.tipo}"`);
    }
    this.#porTipo.set(resolutor.tipo, resolutor);
  }

  obtener(tipo: string): ResolutorDeRecurso | undefined {
    return this.#porTipo.get(tipo);
  }

  tipos(): readonly string[] {
    return [...this.#porTipo.keys()].sort();
  }
}
