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
