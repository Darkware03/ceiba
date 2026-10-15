import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants.js';
import { MetadataScanner, ModulesContainer } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { META_PUBLICO, META_RECURSO, META_ROL_MINIMO } from '../auth/decorators.ts';
import type { RecursoProtegido } from '../auth/decorators.ts';
import type { RolDeWorkspace } from '../guards/roles.ts';

/**
 * Inventario de rutas con sus metadatos de control.
 *
 * Existe por el ADR-0001 §3, literal: «**que el control sea declarativo es lo
 * que permite escribir una prueba que recorra todas las rutas y falle si alguna
 * carece de guard**. Un control que no se puede enumerar no se puede auditar».
 * `test/route-inventory.test.ts` consume esto y falla si aparece una ruta sin
 * sesión, sin `@Recurso` o si un `GET` queda marcado como mutante.
 */

const VERBOS: Readonly<Record<number, string>> = Object.freeze({
  0: 'GET',
  1: 'POST',
  2: 'PUT',
  3: 'DELETE',
  4: 'PATCH',
  5: 'ALL',
  6: 'OPTIONS',
  7: 'HEAD',
  8: 'SEARCH',
});

export interface RutaInventariada {
  readonly controlador: string;
  readonly manejador: string;
  readonly metodo: string;
  readonly ruta: string;
  readonly publica: boolean;
  readonly rolMinimo: RolDeWorkspace | undefined;
  readonly recurso: RecursoProtegido | undefined;
}

function unir(base: string, sufijo: string): string {
  const limpiarBarras = (s: string): string => s.replace(/^\/+|\/+$/gu, '');
  const partes = [limpiarBarras(base), limpiarBarras(sufijo)].filter((s) => s.length > 0);
  return `/${partes.join('/')}`;
}

export function inventariarRutas(app: INestApplication): readonly RutaInventariada[] {
  const contenedor = app.get(ModulesContainer);
  const escaner = new MetadataScanner();
  const rutas: RutaInventariada[] = [];

  for (const modulo of contenedor.values()) {
    for (const envoltorio of modulo.controllers.values()) {
      const tipo = envoltorio.metatype;
      if (typeof tipo !== 'function') continue;

      const base = (Reflect.getMetadata(PATH_METADATA, tipo) as string | undefined) ?? '/';
      const publicoEnClase = Reflect.getMetadata(META_PUBLICO, tipo) === true;
      const rolEnClase = Reflect.getMetadata(META_ROL_MINIMO, tipo) as RolDeWorkspace | undefined;
      const recursoEnClase = Reflect.getMetadata(META_RECURSO, tipo) as
        | RecursoProtegido
        | undefined;

      const prototipo = tipo.prototype as object;
      for (const nombre of escaner.getAllMethodNames(prototipo)) {
        const manejador = (prototipo as Record<string, unknown>)[nombre] as
          | ((...args: unknown[]) => unknown)
          | undefined;
        if (typeof manejador !== 'function') continue;

        const sufijo = Reflect.getMetadata(PATH_METADATA, manejador) as string | undefined;
        if (sufijo === undefined) continue; // no es una ruta

        const verbo = Reflect.getMetadata(METHOD_METADATA, manejador) as number | undefined;
        rutas.push({
          controlador: tipo.name,
          manejador: nombre,
          metodo: VERBOS[verbo ?? 0] ?? `DESCONOCIDO(${String(verbo)})`,
          ruta: unir(base, sufijo),
          publica: publicoEnClase || Reflect.getMetadata(META_PUBLICO, manejador) === true,
          rolMinimo:
            (Reflect.getMetadata(META_ROL_MINIMO, manejador) as RolDeWorkspace | undefined) ??
            rolEnClase,
          recurso:
            (Reflect.getMetadata(META_RECURSO, manejador) as RecursoProtegido | undefined) ??
            recursoEnClase,
        });
      }
    }
  }

  return rutas.sort((a, b) => `${a.ruta} ${a.metodo}`.localeCompare(`${b.ruta} ${b.metodo}`));
}
