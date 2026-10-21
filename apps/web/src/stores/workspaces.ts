import { defineStore } from 'pinia';
import {
  actualizarWorkspace,
  borrarWorkspace,
  crearWorkspace,
  listarWorkspaces,
} from '@/api/workspaces';
import { mensajeDeError } from '@/api/errores';
import type { EntradaActualizarWorkspace, EntradaCrearWorkspace, Workspace } from '@/api/tipos';

/**
 * Almacén de workspaces.
 *
 * Tres decisiones que conviene dejar escritas:
 *
 *  1. **Ninguna llamada a `fetch` sale de aquí.** Todo pasa por
 *     `src/api/workspaces.ts`, que a su vez pasa por `cliente.ts`: es el único
 *     sitio que pone `credentials: "include"` (C-31) y el testigo CSRF
 *     (ADR-0009 §5). Un `fetch` suelto en un almacén se saltaría las dos cosas.
 *
 *  2. **Tras cada operación se actualiza la lista en memoria**, no se recarga
 *     la colección entera. La API devuelve el recurso resultante en `crear` y
 *     `actualizar`, así que recargar sería una segunda ida y vuelta para
 *     obtener algo que ya se tiene. El borrado responde 204 y se quita el
 *     elemento localmente.
 *
 *  3. **Aquí no se decide autorización.** El servidor exige `admin` para
 *     renombrar y `owner` para borrar (ADR-0009 §7.5). Esta capa no comprueba
 *     roles: lanza la operación y, si el servidor responde 403, el mensaje
 *     acaba en `error`. Ocultar el control no sería un control (§5).
 */

interface EstadoDeWorkspaces {
  lista: Workspace[];
  /** `true` mientras `cargar()` está en vuelo. */
  cargando: boolean;
  /** `true` en cuanto `cargar()` ha terminado una vez **con éxito**. */
  cargada: boolean;
  /** Último error presentable; `null` si la última operación fue bien. */
  error: string | null;
  /** `true` mientras hay una mutación (crear/renombrar/borrar) en vuelo. */
  guardando: boolean;
}

export const usarAlmacenDeWorkspaces = defineStore('workspaces', {
  state: (): EstadoDeWorkspaces => ({
    lista: [],
    cargando: false,
    cargada: false,
    error: null,
    guardando: false,
  }),

  getters: {
    /** Devuelve el workspace ya cargado o `null`; no dispara ninguna petición. */
    porId:
      (estado) =>
      (id: string): Workspace | null =>
        estado.lista.find((workspace) => workspace.id === id) ?? null,

    /** Vacío **confirmado**: no es lo mismo que «todavía no se sabe». */
    estaVacia: (estado): boolean => estado.cargada && estado.lista.length === 0,
  },

  actions: {
    /**
     * `GET /workspaces` — sólo los workspaces con membresía activa.
     *
     * En caso de error la lista anterior **se deja intacta**: borrarla
     * convertiría un fallo de red pasajero en una pantalla vacía que miente
     * diciendo que el usuario no tiene workspaces.
     */
    async cargar(): Promise<void> {
      this.cargando = true;
      try {
        const { workspaces } = await listarWorkspaces();
        this.lista = workspaces;
        this.cargada = true;
        this.error = null;
      } catch (error) {
        this.error = mensajeDeError(error);
      } finally {
        this.cargando = false;
      }
    },

    /**
     * `POST /workspaces`.
     *
     * @returns el workspace creado, o `null` si la API lo rechazó (el motivo
     * queda en `error`, p. ej. un 409 por slug repetido).
     */
    async crear(entrada: EntradaCrearWorkspace): Promise<Workspace | null> {
      this.guardando = true;
      try {
        const { workspace } = await crearWorkspace(entrada);
        // Se añade al final y no se reordena: el orden de `GET /workspaces` lo
        // decide el servidor y esta capa no lo conoce, así que inventarse aquí
        // una ordenación haría que la lista saltara en la siguiente recarga.
        this.lista = [...this.lista, workspace];
        this.error = null;
        return workspace;
      } catch (error) {
        this.error = mensajeDeError(error);
        return null;
      } finally {
        this.guardando = false;
      }
    },

    /** `PATCH /workspaces/:id` — nombre y/o descripción. Exige `admin`. */
    async renombrar(id: string, entrada: EntradaActualizarWorkspace): Promise<Workspace | null> {
      this.guardando = true;
      try {
        const { workspace } = await actualizarWorkspace(id, entrada);
        this.lista = this.lista.map((actual) => (actual.id === workspace.id ? workspace : actual));
        this.error = null;
        return workspace;
      } catch (error) {
        this.error = mensajeDeError(error);
        return null;
      } finally {
        this.guardando = false;
      }
    },

    /**
     * `DELETE /workspaces/:id` — responde 204. Exige `owner`.
     *
     * @returns `true` si el servidor confirmó el borrado. Si falla, la lista
     * no se toca: un borrado optimista dejaría la interfaz afirmando algo que
     * no ha ocurrido.
     */
    async borrar(id: string): Promise<boolean> {
      this.guardando = true;
      try {
        await borrarWorkspace(id);
        this.lista = this.lista.filter((actual) => actual.id !== id);
        this.error = null;
        return true;
      } catch (error) {
        this.error = mensajeDeError(error);
        return false;
      } finally {
        this.guardando = false;
      }
    },

    limpiarError(): void {
      this.error = null;
    },
  },
});
export const usarAlmacenWorkspaces = usarAlmacenDeWorkspaces;
export const useWorkspacesStore = usarAlmacenDeWorkspaces;
