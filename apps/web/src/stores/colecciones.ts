import { defineStore } from 'pinia';
import {
  actualizarColeccion,
  borrarColeccion,
  crearColeccion,
  listarColecciones,
} from '@/api/colecciones';
import { mensajeDeError } from '@/api/errores';
import type { Coleccion, EntradaActualizarColeccion, EntradaCrearColeccion } from '@/api/tipos';

/**
 * Almacén de colecciones, **indexado por workspace**.
 *
 * Por qué un índice y no una lista plana: la vista de detalle de un workspace
 * sólo quiere las colecciones de ese workspace, y navegar entre dos workspaces
 * no debe mezclar ni descartar lo ya cargado del otro.
 *
 * LA ASIMETRÍA DE RUTAS, que es lo que de verdad condiciona estas acciones
 * (`collection.controller.ts` lo deja escrito):
 *
 *   - crear y listar  -> `/workspaces/:workspaceId/collections`
 *   - renombrar/borrar-> `/collections/:collectionId`
 *
 * El servidor resuelve la colección a su workspace **antes** de autorizar, para
 * que conocer un identificador no baste (§19). Consecuencia directa para este
 * almacén: `renombrar` y `borrar` reciben además el `workspaceId`, que la ruta
 * ya no lleva, porque sin él no se sabe **qué casilla del índice** actualizar.
 * Deducirlo de la respuesta sería posible en `renombrar` (`coleccion.workspaceId`)
 * pero no en `borrar`, que responde 204 sin cuerpo; pedirlo siempre evita tener
 * dos reglas distintas para la misma cosa.
 *
 * Como en el almacén de workspaces: aquí no se comprueba ningún rol. El
 * servidor exige `editor` para crear, renombrar y borrar (ADR-0009 §7.5) y es
 * él quien responde 403 si no se cumple.
 */

interface EstadoDeColecciones {
  /** `workspaceId` -> colecciones ya cargadas de ese workspace. */
  porWorkspace: Record<string, Coleccion[]>;
  cargando: boolean;
  error: string | null;
  guardando: boolean;
}

export const usarAlmacenDeColecciones = defineStore('colecciones', {
  state: (): EstadoDeColecciones => ({
    porWorkspace: {},
    cargando: false,
    error: null,
    guardando: false,
  }),

  getters: {
    /** Colecciones del workspace; lista vacía si todavía no se han pedido. */
    deWorkspace:
      (estado) =>
      (workspaceId: string): Coleccion[] =>
        estado.porWorkspace[workspaceId] ?? [],

    /** `true` sólo si ese workspace ya se cargó alguna vez con éxito. */
    cargada:
      (estado) =>
      (workspaceId: string): boolean =>
        estado.porWorkspace[workspaceId] !== undefined,

    /** Vacío **confirmado** para ese workspace. */
    estaVacia:
      (estado) =>
      (workspaceId: string): boolean => {
        const lista = estado.porWorkspace[workspaceId];
        return lista !== undefined && lista.length === 0;
      },
  },

  actions: {
    /** `GET /workspaces/:workspaceId/collections`. */
    async cargar(workspaceId: string): Promise<void> {
      this.cargando = true;
      try {
        const { colecciones } = await listarColecciones(workspaceId);
        this.porWorkspace[workspaceId] = colecciones;
        this.error = null;
      } catch (error) {
        // No se escribe la casilla: así `cargada(workspaceId)` sigue siendo
        // `false` y la vista muestra el error en vez de un «no hay nada».
        this.error = mensajeDeError(error);
      } finally {
        this.cargando = false;
      }
    },

    /** `POST /workspaces/:workspaceId/collections`. */
    async crear(workspaceId: string, entrada: EntradaCrearColeccion): Promise<Coleccion | null> {
      this.guardando = true;
      try {
        const { coleccion } = await crearColeccion(workspaceId, entrada);
        this.porWorkspace[workspaceId] = [...(this.porWorkspace[workspaceId] ?? []), coleccion];
        this.error = null;
        return coleccion;
      } catch (error) {
        this.error = mensajeDeError(error);
        return null;
      } finally {
        this.guardando = false;
      }
    },

    /**
     * `PATCH /collections/:collectionId`.
     *
     * `workspaceId` no viaja en la petición: es sólo la casilla del índice que
     * hay que refrescar.
     */
    async renombrar(
      collectionId: string,
      workspaceId: string,
      entrada: EntradaActualizarColeccion,
    ): Promise<Coleccion | null> {
      this.guardando = true;
      try {
        const { coleccion } = await actualizarColeccion(collectionId, entrada);
        const lista = this.porWorkspace[workspaceId];
        if (lista !== undefined) {
          this.porWorkspace[workspaceId] = lista.map((actual) =>
            actual.id === coleccion.id ? coleccion : actual,
          );
        }
        // Si la casilla no existía no se crea con un solo elemento: una lista
        // de uno parecería la lista completa del workspace.
        this.error = null;
        return coleccion;
      } catch (error) {
        this.error = mensajeDeError(error);
        return null;
      } finally {
        this.guardando = false;
      }
    },

    /** `DELETE /collections/:collectionId` — responde 204. */
    async borrar(collectionId: string, workspaceId: string): Promise<boolean> {
      this.guardando = true;
      try {
        await borrarColeccion(collectionId);
        const lista = this.porWorkspace[workspaceId];
        if (lista !== undefined) {
          this.porWorkspace[workspaceId] = lista.filter((actual) => actual.id !== collectionId);
        }
        this.error = null;
        return true;
      } catch (error) {
        this.error = mensajeDeError(error);
        return false;
      } finally {
        this.guardando = false;
      }
    },

    /** Olvida lo cargado de un workspace (p. ej. tras borrarlo). */
    olvidar(workspaceId: string): void {
      // `delete` sobre el proxy reactivo de Vue 3 sí notifica a los efectos.
      delete this.porWorkspace[workspaceId];
    },

    limpiarError(): void {
      this.error = null;
    },
  },
});
export const usarAlmacenColecciones = usarAlmacenDeColecciones;
export const useColeccionesStore = usarAlmacenDeColecciones;
