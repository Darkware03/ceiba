/**
 * Tipos estructurales mínimos de petición y respuesta.
 *
 * POR QUÉ NO SE IMPORTA `fastify` AQUÍ. El ADR-0008 (Hallazgo 3) prohíbe
 * declarar `fastify` como dependencia directa de `apps/api`: produciría dos
 * copias en el árbol (`5.12.5` del adaptador y la declarada). Sin declararla,
 * `import type { FastifyRequest } from 'fastify'` no resuelve bajo el aislamiento
 * estricto de pnpm. La salida es tipar **sólo lo que se usa**, que además deja
 * los guards probables con objetos literales, sin levantar un servidor.
 */

export interface OpcionesCookie {
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: 'lax' | 'strict' | 'none';
  readonly path?: string;
  readonly maxAge?: number;
  readonly expires?: Date;
  readonly domain?: string;
}

export interface PeticionHttp {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly cookies?: Readonly<Record<string, string | undefined>>;
  readonly params?: Readonly<Record<string, string>>;
  /** IP real, ya resuelta por el `trustProxy` acotado (ADR-0009 §6.1). */
  readonly ip?: string;
  [clave: string]: unknown;
}

export interface RespuestaHttp {
  setCookie(nombre: string, valor: string, opciones?: OpcionesCookie): unknown;
  clearCookie(nombre: string, opciones?: OpcionesCookie): unknown;
  header(nombre: string, valor: string | number): unknown;
}

/** Primera cabecera, normalizada a string. Fastify puede dar arrays. */
export function cabecera(peticion: PeticionHttp, nombre: string): string | undefined {
  const valor = peticion.headers[nombre.toLowerCase()];
  if (typeof valor === 'string') return valor;
  if (Array.isArray(valor)) return valor[0];
  return undefined;
}

export const METODOS_MUTANTES: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function esMetodoMutante(metodo: string): boolean {
  return METODOS_MUTANTES.has(metodo.toUpperCase());
}
