import { defineStore } from 'pinia';
import {
  actualizarPeticion,
  borrarPeticion,
  crearPeticion,
  duplicarPeticion,
  listarPeticiones,
  obtenerCurl,
  obtenerPeticion,
  ordenarPeticiones,
} from '@/api/peticiones';
import { mensajeDeError } from '@/api/errores';
import { copiarTexto } from '@/composables/usarPortapapeles';
import type {
  ComandoCurl,
  EntradaActualizarPeticion,
  EntradaCrearPeticion,
  Peticion,
} from '@/api/peticiones';

/**
 * Almacén de peticiones, **indexado por colección**.
 *
 * Mismo criterio que `stores/colecciones.ts`, y por el mismo motivo: entrar en
 * una colección no debe descartar lo ya cargado de otra, y `cargada()` tiene
 * que poder distinguir «todavía no se ha pedido» de «se pidió y está vacía».
 * Esa distinción es LA que arregla el fallo del cliente: sin ella la vista no
 * sabe si pintar el logo girando, el estado vacío con acción, o el error, y
 * acaba pintando un hueco mudo, que es justo lo reportado.
 *
 * Las mutaciones que cuelgan de `/requests/:id` (renombrar, duplicar, borrar)
 * reciben **además** el `collectionId`, que la ruta ya no lleva: sin él no se
 * sabe qué casilla del índice refrescar. Idéntico a lo que hace el almacén de
 * colecciones con el `workspaceId`.
 *
 * Aquí no se comprueba ningún rol: el servidor exige `editor` y responde 403.
 * Una interfaz que esconde botones no protege nada.
 */

/** Estado de la última petición de cURL. Vive aquí para que la vista lo pinte. */
export interface EstadoDeCurl {
  readonly requestId: string;
  readonly nombre: string;
  readonly comando: string;
  readonly advertencias: readonly string[];
  /** `true` si llegó al portapapeles; `false` si hay que copiarlo a mano. */
  readonly copiado: boolean;
  /** Por qué no se pudo copiar. `null` si se copió. */
  readonly motivoDeNoCopia: string | null;
}

interface EstadoDePeticiones {
  /** `collectionId` -> peticiones ya cargadas de esa colección. */
  porColeccion: Record<string, Peticion[]>;
  cargando: boolean;
  error: string | null;
  guardando: boolean;
  /** Identificador de la petición cuyo cURL se está pidiendo. */
  generandoCurlDe: string | null;
  curl: EstadoDeCurl | null;
  errorDeCurl: string | null;
}

export const ID_DEL_ALMACEN_DE_PETICIONES = 'peticiones';

export const usarAlmacenDePeticiones = defineStore(ID_DEL_ALMACEN_DE_PETICIONES, {
  state: (): EstadoDePeticiones => ({
    porColeccion: {},
    cargando: false,
    error: null,
    guardando: false,
    generandoCurlDe: null,
    curl: null,
    errorDeCurl: null,
  }),

  getters: {
    /** Peticiones de la colección; lista vacía si todavía no se han pedido. */
    deColeccion:
      (estado) =>
      (collectionId: string): Peticion[] =>
        estado.porColeccion[collectionId] ?? [],

    /** `true` sólo si esa colección ya se cargó alguna vez con éxito. */
    cargada:
      (estado) =>
      (collectionId: string): boolean =>
        estado.porColeccion[collectionId] !== undefined,

    /**
     * Vacío **confirmado**: se preguntó al servidor y no hay ninguna.
     *
     * Es lo que distingue el estado vacío con acción («Crear la primera
     * petición») del hueco mudo. Sin este getter la vista no puede saberlo.
     */
    estaVacia:
      (estado) =>
      (collectionId: string): boolean => {
        const lista = estado.porColeccion[collectionId];
        return lista !== undefined && lista.length === 0;
      },

    /**
     * Peticiones agrupadas por carpeta, en el orden del §1 («árbol: carpeta +
     * orden»). La raíz (`folderId === null`) va siempre primera.
     */
    porCarpeta:
      (estado) =>
      (
        collectionId: string,
      ): Array<{ folderId: string | null; titulo: string; peticiones: Peticion[] }> => {
        const lista = estado.porColeccion[collectionId] ?? [];
        const grupos = new Map<string, { folderId: string | null; titulo: string; peticiones: Peticion[] }>();

        for (const peticion of lista) {
          const clave = peticion.folderId ?? '';
          let grupo = grupos.get(clave);
          if (grupo === undefined) {
            grupo = {
              folderId: peticion.folderId,
              // HUECO declarado: el §1 no define cómo viaja el nombre de la
              // carpeta. Si el servidor lo manda (`folderName`) se usa; si no,
              // se enseña el identificador en vez de inventarse un nombre.
              titulo:
                peticion.folderId === null
                  ? 'Raíz de la colección'
                  : (peticion.folderName ?? `Carpeta ${peticion.folderId}`),
              peticiones: [],
            };
            grupos.set(clave, grupo);
          }
          grupo.peticiones.push(peticion);
        }

        return [...grupos.values()].sort((a, b) => {
          if (a.folderId === null) return -1;
          if (b.folderId === null) return 1;
          return a.titulo.localeCompare(b.titulo, 'es');
        });
      },
  },

  actions: {
    /** `GET /collections/:collectionId/requests`. */
    async cargar(collectionId: string): Promise<void> {
      this.cargando = true;
      try {
        this.porColeccion[collectionId] = await listarPeticiones(collectionId);
        this.error = null;
      } catch (error) {
        // No se escribe la casilla: `cargada()` sigue en `false` y la vista
        // enseña el error, no un «no hay nada» que sería mentira.
        this.error = mensajeDeError(error);
      } finally {
        this.cargando = false;
      }
    },

    /** `POST /collections/:collectionId/requests`. */
    async crear(
      collectionId: string,
      entrada: EntradaCrearPeticion,
    ): Promise<Peticion | null> {
      this.guardando = true;
      try {
        const creada = await crearPeticion(collectionId, entrada);
        const lista = this.porColeccion[collectionId] ?? [];
        this.porColeccion[collectionId] = ordenarPeticiones([...lista, creada]);
        this.error = null;
        return creada;
      } catch (error) {
        this.error = mensajeDeError(error);
        return null;
      } finally {
        this.guardando = false;
      }
    },

    /** `PATCH /requests/:requestId`. Sirve para renombrar y para editar. */
    async actualizar(
      requestId: string,
      collectionId: string,
      entrada: EntradaActualizarPeticion,
    ): Promise<Peticion | null> {
      this.guardando = true;
      try {
        const actualizada = await actualizarPeticion(requestId, entrada);
        const lista = this.porColeccion[collectionId];
        if (lista !== undefined) {
          this.porColeccion[collectionId] = ordenarPeticiones(
            lista.map((actual) => (actual.id === actualizada.id ? actualizada : actual)),
          );
        }
        this.error = null;
        return actualizada;
      } catch (error) {
        this.error = mensajeDeError(error);
        return null;
      } finally {
        this.guardando = false;
      }
    },

    /** `POST /requests/:requestId/duplicate`. */
    async duplicar(requestId: string, collectionId: string): Promise<Peticion | null> {
      this.guardando = true;
      try {
        const copia = await duplicarPeticion(requestId);
        const lista = this.porColeccion[collectionId];
        if (lista !== undefined) {
          this.porColeccion[collectionId] = ordenarPeticiones([...lista, copia]);
        }
        this.error = null;
        return copia;
      } catch (error) {
        this.error = mensajeDeError(error);
        return null;
      } finally {
        this.guardando = false;
      }
    },

    /** `DELETE /requests/:requestId` — borrado lógico, responde 204. */
    async borrar(requestId: string, collectionId: string): Promise<boolean> {
      this.guardando = true;
      try {
        await borrarPeticion(requestId);
        const lista = this.porColeccion[collectionId];
        if (lista !== undefined) {
          this.porColeccion[collectionId] = lista.filter((actual) => actual.id !== requestId);
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

    /** `GET /requests/:requestId` — una sola, para abrirla en el constructor. */
    async obtenerUna(requestId: string): Promise<Peticion | null> {
      this.cargando = true;
      try {
        const peticion = await obtenerPeticion(requestId);
        this.error = null;
        return peticion;
      } catch (error) {
        this.error = mensajeDeError(error);
        return null;
      } finally {
        this.cargando = false;
      }
    },

    /**
     * «Copiar como cURL»: `GET /requests/:id/curl` y al portapapeles.
     *
     * EL COMANDO LO GENERA EL SERVIDOR Y AQUÍ NO SE TOCA NI UN CARÁCTER.
     * Es el único que sabe qué cabecera está marcada como secreta; un cURL
     * compuesto en el navegador materializaría el valor de un `Authorization`
     * en un texto que el usuario pega en un ticket. Por eso esta acción
     * **transporta**, no construye.
     *
     * Las `advertencias` se guardan y se enseñan siempre que vengan: son la
     * forma honesta de decir «esto no se puede representar en cURL» en lugar
     * de generar una equivalencia falsa.
     *
     * Que no se pueda copiar (HTTP sin contexto seguro, permiso denegado) **no
     * es un error de esta acción**: el comando se obtuvo igual y se enseña
     * para copiarlo a mano. Mezclar las dos cosas escondería el comando por un
     * fallo del portapapeles.
     */
    async copiarComoCurl(requestId: string, nombre: string): Promise<EstadoDeCurl | null> {
      if (this.generandoCurlDe !== null) return null;
      this.generandoCurlDe = requestId;
      this.errorDeCurl = null;
      try {
        const respuesta: ComandoCurl = await obtenerCurl(requestId);
        const copia = await copiarTexto(respuesta.curl);
        const estado: EstadoDeCurl = {
          requestId,
          nombre,
          comando: respuesta.curl,
          advertencias: respuesta.advertencias,
          copiado: copia.copiado,
          motivoDeNoCopia: copia.copiado ? null : copia.motivo,
        };
        this.curl = estado;
        return estado;
      } catch (error) {
        this.errorDeCurl = mensajeDeError(error);
        this.curl = null;
        return null;
      } finally {
        this.generandoCurlDe = null;
      }
    },

    /** Reintenta sólo la copia, con el comando ya obtenido. */
    async recopiarCurl(): Promise<boolean> {
      const actual = this.curl;
      if (actual === null) return false;
      const copia = await copiarTexto(actual.comando);
      this.curl = {
        ...actual,
        copiado: copia.copiado,
        motivoDeNoCopia: copia.copiado ? null : copia.motivo,
      };
      return copia.copiado;
    },

    cerrarCurl(): void {
      this.curl = null;
      this.errorDeCurl = null;
    },

    /** Olvida lo cargado de una colección (p. ej. tras borrarla). */
    olvidar(collectionId: string): void {
      delete this.porColeccion[collectionId];
    },

    limpiarError(): void {
      this.error = null;
      this.errorDeCurl = null;
    },
  },
});

export const usarAlmacenPeticiones = usarAlmacenDePeticiones;
export const usePeticionesStore = usarAlmacenDePeticiones;
