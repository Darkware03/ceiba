import { defineStore } from 'pinia';
import { listarPeticionesDeColeccion, type NodoDePeticion } from '@/api/colecciones';
import { mensajeDeError } from '@/api/errores';
import { usarAlmacenDeColecciones } from '@/stores/colecciones';
import { usarAlmacenDeWorkspaces } from '@/stores/workspaces';

/**
 * Estado del árbol de la barra lateral (P3).
 *
 * El cliente lo pidió así: «cuando esté dentro de la colección en el lateral
 * me muestre los workspaces que he creado, dentro del workspace las
 * colecciones y dentro de las colecciones las peticiones que he creado».
 *
 * QUÉ GUARDA ESTE ALMACÉN Y QUÉ NO — es la decisión central y conviene
 * dejarla escrita, porque la tentación de duplicar datos aquí es enorme:
 *
 *   - **No guarda workspaces.** Los tiene `stores/workspaces.ts` (`lista`).
 *   - **No guarda colecciones.** Las tiene `stores/colecciones.ts`, que además
 *     ya está indexado por workspace (`porWorkspace`), que es justo la forma
 *     que un árbol perezoso necesita.
 *   - **Sí guarda las peticiones**, porque el almacén que las tiene
 *     (`stores/peticiones.ts`) es del ámbito C y se está reescribiendo ahora
 *     mismo para P5; y porque ese almacén lleva estado de edición que el árbol
 *     no quiere ni debe tocar. Aquí sólo hay tres campos de lectura.
 *   - **Sí guarda qué está desplegado**, que es lo único de verdad suyo.
 *
 * Esto es exactamente lo que pide el §3.1 del BRIEF-FASE7 («Reutiliza los
 * almacenes que ya existen antes de crear otros»): se añade un almacén para lo
 * que no tiene dueño, no para duplicar lo que ya lo tiene.
 *
 * PERSISTENCIA DEL DESPLIEGUE, Y POR QUÉ NO ES `sessionStorage`:
 * `apps/web/scripts/check-no-token-storage.ts:13` declara postura de lista
 * blanca —«Cualquier escritura en `localStorage` o `sessionStorage` es un
 * hallazgo salvo que su clave esté explícitamente» autorizada— y esa lista
 * vive en `scripts/`, fuera del ámbito de escritura de este encargo. Así que
 * la persistencia la da este almacén Pinia: sobrevive a todas las navegaciones
 * dentro de la aplicación, que es lo que pide el brief, y **no** sobrevive a
 * un refresco completo del navegador. Está pedido en el informe.
 */

interface EstadoDelArbol {
  /** `workspaceId` -> desplegado. Ausente = plegado. */
  workspacesAbiertos: Record<string, boolean>;
  /** `collectionId` -> desplegado. */
  coleccionesAbiertas: Record<string, boolean>;
  /** `collectionId` -> hojas ya cargadas. Ausente = nunca se pidieron. */
  peticionesPorColeccion: Record<string, NodoDePeticion[]>;
  /** `collectionId` -> hay una carga en vuelo. */
  cargandoPeticiones: Record<string, boolean>;
  /** `workspaceId` -> hay una carga de colecciones en vuelo. */
  cargandoColecciones: Record<string, boolean>;
  /** `collectionId` -> último error al pedir sus peticiones. */
  errorPorColeccion: Record<string, string | null>;
}

export const usarAlmacenDelArbol = defineStore('arbol', {
  state: (): EstadoDelArbol => ({
    workspacesAbiertos: {},
    coleccionesAbiertas: {},
    peticionesPorColeccion: {},
    cargandoPeticiones: {},
    cargandoColecciones: {},
    errorPorColeccion: {},
  }),

  getters: {
    workspaceAbierto:
      (estado) =>
      (workspaceId: string): boolean =>
        estado.workspacesAbiertos[workspaceId] === true,

    coleccionAbierta:
      (estado) =>
      (collectionId: string): boolean =>
        estado.coleccionesAbiertas[collectionId] === true,

    /** Hojas ya cargadas; lista vacía si todavía no se pidieron. */
    peticionesDe:
      (estado) =>
      (collectionId: string): NodoDePeticion[] =>
        estado.peticionesPorColeccion[collectionId] ?? [],

    /**
     * `true` sólo si esa colección ya se pidió **con éxito** alguna vez.
     * Distinguirlo de «lista vacía» es lo que permite que el árbol diga
     * «no hay peticiones» en vez de dejar un hueco mudo.
     */
    peticionesCargadas:
      (estado) =>
      (collectionId: string): boolean =>
        estado.peticionesPorColeccion[collectionId] !== undefined,

    cargandoColeccion:
      (estado) =>
      (collectionId: string): boolean =>
        estado.cargandoPeticiones[collectionId] === true,

    cargandoWorkspace:
      (estado) =>
      (workspaceId: string): boolean =>
        estado.cargandoColecciones[workspaceId] === true,

    errorDeColeccion:
      (estado) =>
      (collectionId: string): string | null =>
        estado.errorPorColeccion[collectionId] ?? null,
  },

  actions: {
    /**
     * `GET /workspaces/:workspaceId/collections` a través del almacén que ya
     * las posee. Si ese workspace ya se cargó, **no se vuelve a pedir**: esa
     * es la mitad de la carga perezosa.
     */
    async cargarColecciones(workspaceId: string, forzar = false): Promise<void> {
      const colecciones = usarAlmacenDeColecciones();
      if (!forzar && colecciones.cargada(workspaceId)) return;
      if (this.cargandoColecciones[workspaceId] === true) return;
      this.cargandoColecciones[workspaceId] = true;
      try {
        await colecciones.cargar(workspaceId);
      } finally {
        delete this.cargandoColecciones[workspaceId];
      }
    },

    /**
     * `GET /collections/:collectionId/requests`.
     *
     * No se pide si ya están cargadas ni si hay otra carga en vuelo: desplegar
     * y plegar la misma colección tres veces seguidas debe costar **una**
     * petición, no tres.
     */
    async cargarPeticiones(collectionId: string, forzar = false): Promise<void> {
      if (!forzar && this.peticionesPorColeccion[collectionId] !== undefined) return;
      if (this.cargandoPeticiones[collectionId] === true) return;

      this.cargandoPeticiones[collectionId] = true;
      this.errorPorColeccion[collectionId] = null;
      try {
        this.peticionesPorColeccion[collectionId] =
          await listarPeticionesDeColeccion(collectionId);
      } catch (error) {
        // No se escribe la casilla: así `peticionesCargadas()` sigue siendo
        // `false` y el nodo enseña el error en vez de un «no hay peticiones»
        // que sería mentira.
        this.errorPorColeccion[collectionId] = mensajeDeError(error);
      } finally {
        delete this.cargandoPeticiones[collectionId];
      }
    },

    /** Despliega un workspace y, sólo entonces, pide sus colecciones. */
    async abrirWorkspace(workspaceId: string): Promise<void> {
      this.workspacesAbiertos[workspaceId] = true;
      await this.cargarColecciones(workspaceId);
    },

    cerrarWorkspace(workspaceId: string): void {
      // Se borra la marca en vez de ponerla a `false`: el estado por defecto
      // es «plegado», y dejar `false` explícito haría crecer el objeto sin
      // aportar nada.
      delete this.workspacesAbiertos[workspaceId];
    },

    async alternarWorkspace(workspaceId: string): Promise<void> {
      if (this.workspacesAbiertos[workspaceId] === true) this.cerrarWorkspace(workspaceId);
      else await this.abrirWorkspace(workspaceId);
    },

    /** Despliega una colección y, sólo entonces, pide sus peticiones. */
    async abrirColeccion(collectionId: string): Promise<void> {
      this.coleccionesAbiertas[collectionId] = true;
      await this.cargarPeticiones(collectionId);
    },

    cerrarColeccion(collectionId: string): void {
      delete this.coleccionesAbiertas[collectionId];
    },

    async alternarColeccion(collectionId: string): Promise<void> {
      if (this.coleccionesAbiertas[collectionId] === true) this.cerrarColeccion(collectionId);
      else await this.abrirColeccion(collectionId);
    },

    /**
     * Deja visible el nodo que corresponde a la ruta actual (§3.1: «el nodo
     * correspondiente a la ruta actual marcado y **visible**»).
     *
     * Desplegar un ancestro no es una preferencia del usuario que se pueda
     * pisar: es la condición para que el nodo activo se vea. Plegar lo demás
     * sí sería pisarle el estado, y por eso no se hace.
     *
     * El `workspaceId` de una colección **no está en la URL** de
     * `/colecciones/:collectionId`, así que si no se pasa se deduce del índice
     * ya cargado. Si no se puede deducir, se despliega sólo la colección: es
     * preferible a inventarse un workspace.
     */
    async revelar(destino: {
      workspaceId?: string | null;
      collectionId?: string | null;
    }): Promise<void> {
      const { collectionId } = destino;
      let workspaceId = destino.workspaceId ?? null;

      if (workspaceId === null && collectionId != null && collectionId.length > 0) {
        workspaceId = this.workspaceDeColeccion(collectionId);
      }

      const tareas: Promise<void>[] = [];
      if (workspaceId !== null && workspaceId.length > 0) {
        tareas.push(this.abrirWorkspace(workspaceId));
      }
      if (collectionId != null && collectionId.length > 0) {
        tareas.push(this.abrirColeccion(collectionId));
      }
      await Promise.all(tareas);
    },

    /** Busca en el índice ya cargado a qué workspace pertenece una colección. */
    workspaceDeColeccion(collectionId: string): string | null {
      const colecciones = usarAlmacenDeColecciones();
      for (const [workspaceId, lista] of Object.entries(colecciones.porWorkspace)) {
        if (lista.some((coleccion) => coleccion.id === collectionId)) return workspaceId;
      }
      return null;
    },

    /**
     * Carga la raíz del árbol: los workspaces del usuario.
     * Es la **única** petición que el árbol hace al entrar.
     */
    async cargarRaiz(): Promise<void> {
      const workspaces = usarAlmacenDeWorkspaces();
      if (workspaces.cargada || workspaces.cargando) return;
      await workspaces.cargar();
    },

    /** Olvida lo que se sabía de una colección (tras borrarla o renombrarla). */
    olvidarColeccion(collectionId: string): void {
      delete this.coleccionesAbiertas[collectionId];
      delete this.peticionesPorColeccion[collectionId];
      delete this.cargandoPeticiones[collectionId];
      delete this.errorPorColeccion[collectionId];
    },

    olvidarWorkspace(workspaceId: string): void {
      delete this.workspacesAbiertos[workspaceId];
      delete this.cargandoColecciones[workspaceId];
      const colecciones = usarAlmacenDeColecciones();
      for (const coleccion of colecciones.deWorkspace(workspaceId)) {
        this.olvidarColeccion(coleccion.id);
      }
    },
  },
});

export const useArbolStore = usarAlmacenDelArbol;
