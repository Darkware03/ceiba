import { defineStore } from 'pinia';
import {
  METODOS_PERMITIDOS,
  adaptadorPorId,
  construirUrl,
  esCabeceraProhibidaPorElNavegador,
  tipoDeContenidoDe,
} from '@/api/ejecucion';
import type {
  ModoDeCuerpo,
  CodigoDeError,
  CuerpoDeSolicitud,
  Desenlace,
  IdDeAdaptador,
  MetodoDeSolicitud,
  OpcionesDeEjecucion,
  Par,
  PuertoDeEjecucion,
  ResultadoDeEjecucion,
  SolicitudPreparada,
} from '@/api/ejecucion';
import { mensajeDeError } from '@/api/errores';

/**
 * Borrador de la solicitud que se está construyendo, y resultado de la última
 * ejecución.
 *
 * EL HISTORIAL ES EN MEMORIA, A PROPÓSITO. No se persiste en `localStorage` ni
 * en ningún sitio: una solicitud guardada contiene con mucha frecuencia
 * cabeceras `Authorization`, claves de API y cuerpos con datos personales.
 * Dejar eso escrito en el disco del navegador sería crear un almacén de
 * credenciales que nadie ha pedido y que sobrevive al cierre de sesión. Al
 * recargar la página el historial desaparece, y eso es la decisión, no un
 * olvido. La persistencia **de verdad** son las colecciones del servidor.
 *
 * POR QUÉ EL ID NO ES `'constructor'` A SECAS, QUE ERA LO PEDIDO
 * --------------------------------------------------------------
 * Porque con Pinia 4.1.0 **no funciona**, y no es una opinión. Pinia guarda el
 * estado en `pinia.state.value[id]`, que es un objeto normal; antes de crear
 * la tienda comprueba `const initialState = pinia.state.value[id]` para no
 * pisar un estado hidratado. Con `id = 'constructor'` esa lectura no devuelve
 * `undefined`: devuelve `Object.prototype.constructor` por herencia de
 * prototipo. Pinia cree que ya hay estado inicial, se salta `state()` y la
 * tienda queda con TODOS los campos a `undefined`.
 *
 * Comprobado en este contenedor:
 *
 *   defineStore('constructor',              { state: () => ({ a: 1 }) })().a  // undefined
 *   defineStore('constructorDeSolicitudes', { state: () => ({ a: 1 }) })().a  // 1
 *
 * El fichero, la función `usarAlmacenDeConstructor` y la ruta siguen
 * llamándose igual; lo único que cambia es la clave interna. Va anotado en el
 * informe de entrega como desviación consciente del encargo.
 */

/** Tope del historial. Más que esto es ruido y memoria para nada. */
export const MAXIMO_DE_HISTORIAL = 20;

export interface EntradaDeHistorial {
  readonly id: string;
  readonly metodo: MetodoDeSolicitud;
  /** URL ya compuesta, la que se pidió de verdad. */
  readonly url: string;
  readonly outcome: Desenlace;
  readonly estado: number | null;
  readonly codigoDeError: CodigoDeError | null;
  readonly totalMs: number;
  readonly sizeBytes: number | null;
  readonly momento: string;
  /** Copia del borrador, para poder recuperarlo con un clic. */
  readonly solicitud: SolicitudPreparada;
}

interface EstadoDelConstructor {
  metodo: MetodoDeSolicitud;
  url: string;
  cabeceras: Par[];
  parametros: Par[];
  cuerpo: CuerpoDeSolicitud;
  /** Qué adaptador ejecuta. Por defecto el directo: es el único que funciona. */
  adaptador: IdDeAdaptador;
  ejecutando: boolean;
  resultado: ResultadoDeEjecucion | null;
  /** Error de la propia interfaz (URL vacía, excepción inesperada). Los
   *  errores del destino viven en `resultado.error`, no aquí. */
  error: string | null;
  historial: EntradaDeHistorial[];
}

let contadorDePares = 0;

/** Par nuevo. El `id` es la clave de `v-for`: sin él, Vue reutiliza filas mal. */
export function nuevoPar(nombre = '', valor = '', activo = true): Par {
  contadorDePares += 1;
  return { id: `par-${contadorDePares}`, nombre, valor, activo };
}

function clonarPares(pares: readonly Par[]): Par[] {
  return pares.map((par) => ({ ...par }));
}

function cuerpoInicial(): CuerpoDeSolicitud {
  return { modo: 'none', contenido: '', tipoContenido: null };
}

/**
 * Traducción de `body_mode` (vocabulario del servidor, diez valores) al modo
 * del constructor (tres). `undefined` = no representable; se declara en vez de
 * fingir una equivalencia.
 *
 * `multipart_form_data` y `binary_file` quedan fuera a conciencia: esta
 * interfaz no sabe componer esos cuerpos, y abrir la petición como si fuese
 * texto plano enviaría algo distinto de lo guardado.
 */
const TRADUCCION_DE_CUERPO: Readonly<
  Record<string, { modo: ModoDeCuerpo; tipo: string | null } | undefined>
> = Object.freeze({
  none: { modo: 'none', tipo: null },
  raw_json: { modo: 'json', tipo: 'application/json' },
  raw_text: { modo: 'raw', tipo: 'text/plain' },
  raw_xml: { modo: 'raw', tipo: 'application/xml' },
  raw_html: { modo: 'raw', tipo: 'text/html' },
  graphql: { modo: 'raw', tipo: 'application/json' },
  form_urlencoded: { modo: 'raw', tipo: 'application/x-www-form-urlencoded' },
  // Nombres heredados de quien ya llamaba a `cargarDesdePeticionGuardada`.
  json: { modo: 'json', tipo: 'application/json' },
  text: { modo: 'raw', tipo: 'text/plain' },
});

/** Clave del almacén. Ver arriba por qué no es `'constructor'` a secas. */
export const ID_DEL_ALMACEN = 'constructorDeSolicitudes';

export const usarAlmacenDeConstructor = defineStore(ID_DEL_ALMACEN, {
  state: (): EstadoDelConstructor => ({
    metodo: 'GET',
    url: '',
    cabeceras: [nuevoPar()],
    parametros: [nuevoPar()],
    cuerpo: cuerpoInicial(),
    // `navegador`, no `motor`: los adaptadores que existen son
    // `'navegador' | 'api'` (`api/ejecucion.ts`). `'motor'` no es ninguno,
    // así que el almacén arrancaba en un adaptador inexistente y
    // `cabecerasIgnoradas` dejaba de avisar de las cabeceras que el navegador
    // descarta —justo el aviso que exige la prueba del constructor—.
    // CAMBIADO A `api`: TODO sale por el motor, no por el navegador.
    // El modo directo se saltaba los 12 controles SSRF, descartaba las
    // cabeceras prohibidas del navegador (`Host`, `Origin`, `Referer`,
    // `Cookie`...) y devolvia tiempos y redirecciones en cero porque la
    // pestana no los expone. Se conserva solo como diagnostico, a mano.
    adaptador: 'api',
    ejecutando: false,
    resultado: null,
    error: null,
    historial: [],
  }),

  getters: {
    /** URL final con los parámetros compuestos: la que verá el usuario. */
    urlEfectiva(estado): string {
      return construirUrl(estado.url, estado.parametros);
    },

    puedeEnviar(estado): boolean {
      return estado.url.trim().length > 0 && !estado.ejecutando;
    },

    /** El borrador congelado en la forma que espera el puerto de ejecución. */
    solicitudActual(estado): SolicitudPreparada {
      return {
        metodo: estado.metodo,
        url: estado.url.trim(),
        cabeceras: clonarPares(estado.cabeceras),
        parametros: clonarPares(estado.parametros),
        cuerpo: { ...estado.cuerpo },
      };
    },

    /** Cabeceras activas que el navegador descartará. La interfaz las avisa. */
    cabecerasIgnoradas(estado): string[] {
      if (estado.adaptador !== 'navegador') return [];
      return estado.cabeceras
        .filter(
          (par) => par.activo && par.nombre.trim().length > 0 && esCabeceraProhibidaPorElNavegador(par.nombre),
        )
        .map((par) => par.nombre.trim());
    },

    puerto(estado): PuertoDeEjecucion {
      return adaptadorPorId(estado.adaptador);
    },

    /** Cuántos pares cuentan de verdad: lo que se pinta en las pestañas. */
    cabecerasActivas(estado): number {
      return estado.cabeceras.filter((par) => par.activo && par.nombre.trim().length > 0).length;
    },

    parametrosActivos(estado): number {
      return estado.parametros.filter((par) => par.activo && par.nombre.trim().length > 0).length;
    },

    tipoDeContenidoEfectivo(estado): string | null {
      return tipoDeContenidoDe(estado.cuerpo);
    },
  },

  actions: {
    anadirCabecera(nombre = '', valor = ''): void {
      this.cabeceras.push(nuevoPar(nombre, valor));
    },

    quitarCabecera(id: string): void {
      this.cabeceras = this.cabeceras.filter((par) => par.id !== id);
      // Siempre queda una fila vacía: si se vacía la tabla, el usuario se
      // queda sin sitio donde escribir y tiene que buscar el botón.
      if (this.cabeceras.length === 0) this.cabeceras.push(nuevoPar());
    },

    anadirParametro(nombre = '', valor = ''): void {
      this.parametros.push(nuevoPar(nombre, valor));
    },

    quitarParametro(id: string): void {
      this.parametros = this.parametros.filter((par) => par.id !== id);
      if (this.parametros.length === 0) this.parametros.push(nuevoPar());
    },

    establecerModoDeCuerpo(modo: CuerpoDeSolicitud['modo']): void {
      this.cuerpo.modo = modo;
    },

    establecerContenidoDelCuerpo(contenido: string): void {
      this.cuerpo.contenido = contenido;
    },

    usarAdaptador(id: IdDeAdaptador): void {
      this.adaptador = id;
    },

    limpiarResultado(): void {
      this.resultado = null;
      this.error = null;
    },

    limpiarHistorial(): void {
      this.historial = [];
    },

    reiniciarBorrador(): void {
      this.metodo = 'GET';
      this.url = '';
      this.cabeceras = [nuevoPar()];
      this.parametros = [nuevoPar()];
      this.cuerpo = cuerpoInicial();
      this.resultado = null;
      this.error = null;
    },

    /**
     * Vuelca una petición **guardada** (`api_requests`) en el borrador.
     *
     * Devuelve las **limitaciones** encontradas: lo que la petición guardada
     * dice y el constructor no puede representar. No es decoración. El
     * vocabulario del servidor es más ancho que el de esta interfaz en dos
     * sitios concretos:
     *
     *  - `http_method` admite `TRACE` y `CUSTOM`; el contrato del motor
     *    (`ALLOWED_METHODS`) no. Coercerlos a `GET` en silencio sería cambiar
     *    la petición del usuario sin decírselo, así que **no se tocan**: se
     *    deja el método anterior y se devuelve la limitación para que la
     *    pantalla la escriba.
     *  - `body_mode` tiene diez valores y aquí sólo hay `none | raw | json`.
     *    Los textuales se mapean a `raw` con su tipo de contenido; los que
     *    exigen componer un cuerpo que esta interfaz no sabe serializar
     *    (`multipart_form_data`) se declaran.
     *
     * Los nombres antiguos (`'json'`, `'text'`) se siguen aceptando para no
     * romper a quien ya llamaba a esto.
     */
    cargarDesdePeticionGuardada(datos: {
      workspaceId?: string;
      collectionId?: string;
      requestId?: string;
      name?: string;
      method: MetodoDeSolicitud | string;
      methodCustom?: string | null;
      url: string;
      headers?: ReadonlyArray<{ key: string; value: string; enabled: boolean }>;
      queryParams?: ReadonlyArray<{ key: string; value: string; enabled: boolean }>;
      bodyType?: string;
      body?: string | null;
    }): string[] {
      const limitaciones: string[] = [];

      const metodoPedido = String(datos.method).toUpperCase();
      if ((METODOS_PERMITIDOS as readonly string[]).includes(metodoPedido)) {
        this.metodo = metodoPedido as MetodoDeSolicitud;
      } else {
        const verbo =
          metodoPedido === 'CUSTOM' && (datos.methodCustom ?? '').trim().length > 0
            ? (datos.methodCustom ?? '').trim().toUpperCase()
            : metodoPedido;
        limitaciones.push(
          `El método «${verbo}» está guardado pero el motor no lo ejecuta: ` +
            `los admitidos son ${METODOS_PERMITIDOS.join(', ')}. ` +
            `Se mantiene «${this.metodo}» en el selector; cámbialo antes de enviar.`,
        );
      }

      this.url = datos.url;
      this.cabeceras =
        datos.headers && datos.headers.length > 0
          ? datos.headers.map((h) => nuevoPar(h.key, h.value, h.enabled))
          : [nuevoPar()];
      this.parametros =
        datos.queryParams && datos.queryParams.length > 0
          ? datos.queryParams.map((q) => nuevoPar(q.key, q.value, q.enabled))
          : [nuevoPar()];
      // Los modos que existen aquí son `'none' | 'raw' | 'json'`
      // (`api/ejecucion.ts`). No hay modo `'text'`: lo que no es JSON y tiene
      // cuerpo es `raw`, y el tipo de contenido es quien distingue el texto
      // plano de un formulario codificado o de un XML.
      const guardado = datos.bodyType ?? 'none';
      const traduccion = TRADUCCION_DE_CUERPO[guardado];
      const modo: ModoDeCuerpo = traduccion?.modo ?? 'none';
      const tipoContenido = traduccion?.tipo ?? null;

      if (traduccion === undefined && guardado !== 'none') {
        limitaciones.push(
          `El tipo de cuerpo «${guardado}» no se puede componer en el ` +
            'constructor: se abre sin cuerpo para no enviar algo distinto de lo guardado.',
        );
      }

      this.cuerpo = { modo, contenido: modo === 'none' ? '' : (datos.body ?? ''), tipoContenido };
      this.resultado = null;
      this.error = null;
      return limitaciones;
    },

    /** Vuelve a cargar en el borrador una solicitud ya ejecutada. */
    recuperarDelHistorial(id: string): boolean {
      const entrada = this.historial.find((item) => item.id === id);
      if (entrada === undefined) return false;
      this.metodo = entrada.solicitud.metodo;
      this.url = entrada.solicitud.url;
      this.cabeceras = clonarPares(entrada.solicitud.cabeceras);
      this.parametros = clonarPares(entrada.solicitud.parametros);
      this.cuerpo = { ...entrada.solicitud.cuerpo };
      if (this.cabeceras.length === 0) this.cabeceras.push(nuevoPar());
      if (this.parametros.length === 0) this.parametros.push(nuevoPar());
      return true;
    },

    registrarEnHistorial(solicitud: SolicitudPreparada, resultado: ResultadoDeEjecucion): void {
      this.historial.unshift({
        id: resultado.executionId,
        metodo: solicitud.metodo,
        url: resultado.urlEfectiva,
        outcome: resultado.outcome,
        estado: resultado.response?.status ?? null,
        codigoDeError: resultado.error?.code ?? null,
        totalMs: resultado.timings.totalMs,
        sizeBytes: resultado.response?.sizeBytes ?? null,
        momento: new Date().toISOString(),
        solicitud,
      });
      if (this.historial.length > MAXIMO_DE_HISTORIAL) {
        this.historial.length = MAXIMO_DE_HISTORIAL;
      }
    },

    /**
     * Ejecuta el borrador con el adaptador seleccionado.
     *
     * Un destino que responde 500 **no es un error de esta acción**: es una
     * ejecución correcta con un resultado feo, y se guarda en `resultado` para
     * que el panel lo pinte. `error` queda sólo para los fallos de la propia
     * interfaz. Mezclar las dos cosas es lo que lleva a enseñar «error de red»
     * cuando lo que pasó es que el servidor contestó 404.
     */
    async ejecutarSolicitud(opciones: OpcionesDeEjecucion = {}): Promise<ResultadoDeEjecucion | null> {
      if (this.ejecutando) return null;

      const solicitud = this.solicitudActual;
      if (solicitud.url.length === 0) {
        this.error = 'Escribe la URL de destino antes de enviar.';
        return null;
      }

      this.ejecutando = true;
      this.error = null;
      try {
        const resultado = await this.puerto.ejecutar(solicitud, opciones);
        this.resultado = resultado;
        this.registrarEnHistorial(solicitud, resultado);
        return resultado;
      } catch (error) {
        // Aquí sólo se llega si el adaptador rompe su propio contrato: lo
        // normal es que devuelva un resultado con `outcome: 'failed'`.
        this.resultado = null;
        this.error = mensajeDeError(error);
        return null;
      } finally {
        this.ejecutando = false;
      }
    },
  },
});

export const useConstructorStore = usarAlmacenDeConstructor;

export const usarAlmacenConstructor = usarAlmacenDeConstructor;
