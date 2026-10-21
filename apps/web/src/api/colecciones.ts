import { peticionApi } from './cliente';
import type { Coleccion, EntradaActualizarColeccion, EntradaCrearColeccion } from './tipos';

/**
 * Familia «Colecciones», transcrita de
 * `apps/api/src/modules/collection/collection.controller.ts`.
 *
 * Ojo a la asimetría de rutas, que es deliberada en la API y hay que respetar:
 *  - crear y listar cuelgan del workspace: `/workspaces/:workspaceId/collections`
 *  - obtener, renombrar y borrar cuelgan de la colección: `/collections/:collectionId`
 * El motivo está escrito en el controlador: en el segundo caso el servidor
 * resuelve la colección a su workspace **antes** de autorizar, para que conocer
 * un identificador no baste (§19 del prompt maestro).
 */

export function listarColecciones(workspaceId: string): Promise<{ colecciones: Coleccion[] }> {
  return peticionApi<{ colecciones: Coleccion[] }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/collections`,
  );
}

export function crearColeccion(
  workspaceId: string,
  entrada: EntradaCrearColeccion,
): Promise<{ coleccion: Coleccion }> {
  return peticionApi<{ coleccion: Coleccion }>(
    `/workspaces/${encodeURIComponent(workspaceId)}/collections`,
    { metodo: 'POST', cuerpo: entrada },
  );
}

export function obtenerColeccion(collectionId: string): Promise<{ coleccion: Coleccion }> {
  return peticionApi<{ coleccion: Coleccion }>(`/collections/${encodeURIComponent(collectionId)}`);
}

/** Renombrar y cambiar descripción. Exige rol `editor` en el servidor. */
export function actualizarColeccion(
  collectionId: string,
  entrada: EntradaActualizarColeccion,
): Promise<{ coleccion: Coleccion }> {
  return peticionApi<{ coleccion: Coleccion }>(
    `/collections/${encodeURIComponent(collectionId)}`,
    { metodo: 'PATCH', cuerpo: entrada },
  );
}

/** 204. Exige rol `editor` en el servidor. */
export function borrarColeccion(collectionId: string): Promise<void> {
  return peticionApi<void>(`/collections/${encodeURIComponent(collectionId)}`, {
    metodo: 'DELETE',
  });
}

/* -------------------------------------------------------------------------
 * Hojas del árbol lateral (P3)
 * ---------------------------------------------------------------------- */

/**
 * Lo mínimo que el árbol necesita saber de una petición: cómo se llama, con
 * qué verbo y a dónde navegar. Nada más.
 *
 * POR QUÉ NO SE REUTILIZA `Peticion` DE `api/peticiones.ts`, que ya existe y
 * tiene estos tres campos —y la pregunta es legítima, porque reutilizar es la
 * regla de esta casa—:
 *
 *   `api/peticiones.ts` y `stores/peticiones.ts` son del **ámbito C**, que los
 *   está reescribiendo **ahora mismo** para el cuerpo `multipart`/`binary` de
 *   P5. Colgar la barra lateral —que se pinta en TODAS las pantallas— de un
 *   módulo en obra significa que cualquier cambio suyo de firma deja la
 *   navegación entera sin compilar, y ninguno de los dos se enteraría hasta
 *   el `typecheck` final.
 *
 *   El acoplamiento que se evita no es teórico: `stores/peticiones.ts` es
 *   además un almacén con estado de edición, y el árbol sólo quiere leer.
 *
 * El precio es esta interfaz de tres campos, deliberadamente más pobre que
 * `Peticion`. Es un precio barato y reversible: cuando el ámbito C cierre,
 * sustituir el tipo es un `import` y borrar 20 líneas.
 */
export interface NodoDePeticion {
  readonly id: string;
  readonly name: string;
  /** Verbo ya resuelto: `methodCustom` gana a `method` cuando existe. */
  readonly method: string;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

/** Texto o `''`. Nunca `undefined` colándose hasta la plantilla. */
function texto(valor: unknown): string {
  return typeof valor === 'string' ? valor : '';
}

/**
 * Desenvuelve la lista venga como venga.
 *
 * El servidor responde `{ peticiones: [...] }` hoy, pero el resto de esta capa
 * acepta además `requests`, `items` y el array pelado porque en fases
 * anteriores vino de las tres formas. Tolerar al leer es la decisión que ya
 * tomó la fase 6 y aquí se mantiene: si el sobre cambia, el árbol no se queda
 * mudo.
 */
function desenvolver(cuerpo: unknown): unknown[] {
  if (Array.isArray(cuerpo)) return cuerpo;
  if (!esObjeto(cuerpo)) return [];
  for (const clave of ['peticiones', 'requests', 'items', 'data']) {
    const valor = cuerpo[clave];
    if (Array.isArray(valor)) return valor;
  }
  return [];
}

/**
 * `GET /collections/:collectionId/requests` — sólo para pintar hojas.
 *
 * Se piden **al desplegar la colección y no antes** (carga perezosa del §3.1):
 * un usuario con diez colecciones no debe provocar diez peticiones por abrir
 * la barra lateral.
 */
export async function listarPeticionesDeColeccion(
  collectionId: string,
): Promise<NodoDePeticion[]> {
  const cuerpo = await peticionApi<unknown>(
    `/collections/${encodeURIComponent(collectionId)}/requests`,
  );
  return desenvolver(cuerpo)
    .filter(esObjeto)
    .map((crudo) => {
      const propio = texto(crudo['methodCustom'] ?? crudo['method_custom']);
      const estandar = texto(crudo['method']);
      return {
        id: texto(crudo['id']),
        // Una petición sin nombre existe (el servidor lo permite vacío); se
        // etiqueta en vez de pintar una fila en blanco que no se puede pulsar.
        name: texto(crudo['name']).trim() || 'Sin nombre',
        method: (propio.trim() || estandar.trim() || 'GET').toUpperCase(),
      };
    })
    .filter((nodo) => nodo.id.length > 0);
}
