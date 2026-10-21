import { defineStore } from 'pinia';
import {
  METODOS_PERMITIDOS,
  adaptadorPorId,
  camposActivosDeCuerpo,
  camposDeCuerpo,
  construirUrl,
  esCabeceraProhibidaPorElNavegador,
  esModoDeFormulario,
  limitacionesDeEnvioDelCuerpo,
  tipoDeContenidoDe,
} from '@/api/ejecucion';
import type {
  CampoDeCuerpo,
  ModoDeCuerpo,
  CodigoDeError,
  CuerpoDeSolicitud,
  Desenlace,
  FicheroDeCuerpo,
  IdDeAdaptador,
  MetodoDeSolicitud,
  OpcionesDeEjecucion,
  Par,
  PuertoDeEjecucion,
  ResultadoDeEjecucion,
  SolicitudPreparada,
} from '@/api/ejecucion';
import { actualizarPeticion, errorDeNombreDePeticion } from '@/api/peticiones';
import type { CampoDeCuerpoGuardado, EntradaActualizarPeticion } from '@/api/peticiones';
import { ErrorDeApi, mensajeDeError } from '@/api/errores';

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

/**
 * Estado visible del autoguardado (P1). **No es decoración**: el §3.C.1 del
 * `BRIEF-FASE7` lo pone como requisito no opcional, y con razon — un guardado
 * que ocurre solo y no se ve es indistinguible de uno que no ocurrió.
 *
 *  - `inactivo`   no hay petición abierta: no se autoguarda nada (crear lo
 *                 decide el usuario, nunca el rebote).
 *  - `sinGuardar` hay cambios pendientes de enviar.
 *  - `guardando`  hay un `PATCH` en vuelo.
 *  - `guardado`   el servidor confirmó.
 *  - `error`      el servidor rechazó; lo escrito **se conserva**.
 *  - `conflicto`  alguien más escribió sobre la misma fila.
 */
export type EstadoDeGuardado =
  | 'inactivo'
  | 'sinGuardar'
  | 'guardando'
  | 'guardado'
  | 'error'
  | 'conflicto';

interface EstadoDelConstructor {
  metodo: MetodoDeSolicitud;
  url: string;
  cabeceras: Par[];
  parametros: Par[];
  cuerpo: CuerpoDeSolicitud;
  // --- Identidad de la petición abierta (fase 7) -------------------------
  /**
   * `api_requests.id` de la fila abierta, o `null` si esto es un borrador en
   * blanco. ANTES DE LA FASE 7 ESTO NO EXISTÍA: `cargarDesdePeticionGuardada`
   * recibía `requestId` y `collectionId` en su argumento y **los tiraba**. Sin
   * recordar a qué fila pertenece el borrador, el autoguardado es imposible.
   */
  peticionId: string | null;
  coleccionId: string | null;
  workspaceId: string | null;
  nombre: string;
  /** `api_requests.lock_version` de la última lectura o escritura confirmada. */
  lockVersion: number | null;
  estadoDeGuardado: EstadoDeGuardado;
  errorDeGuardado: string | null;
  /** Marca ISO del último guardado confirmado. */
  guardadoEn: string | null;
  /** Huella del borrador en el momento del último guardado confirmado. */
  huellaGuardada: string | null;
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

let contadorDeCampos = 0;

/** Fila nueva de un cuerpo de formulario. */
export function nuevoCampoDeCuerpo(nombre = '', valor = ''): CampoDeCuerpo {
  contadorDeCampos += 1;
  return {
    id: `campo-${contadorDeCampos}`,
    nombre,
    tipo: 'texto',
    valor,
    fichero: null,
    activo: true,
  };
}

function cuerpoInicial(): CuerpoDeSolicitud {
  return { modo: 'none', contenido: '', tipoContenido: null, campos: [], ficheroBinario: null };
}

/**
 * Traducción de `body_mode` (vocabulario del servidor, **diez** valores,
 * contados en `prisma/schema/01-enums.prisma`) al modo del constructor.
 * `undefined` = no representable; se declara en vez de fingir una
 * equivalencia.
 *
 * CAMBIO DE LA FASE 7 (P5): `form_urlencoded`, `multipart_form_data` y
 * `binary_file` dejan de ser «no representables» y pasan a tener modo propio.
 * Antes `form_urlencoded` se abría como texto crudo — lo que era honesto pero
 * perdía la estructura— y `multipart_form_data` ni se abría.
 *
 * `custom` sigue fuera: el esquema no define su forma.
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
  form_urlencoded: { modo: 'form_urlencoded', tipo: 'application/x-www-form-urlencoded' },
  multipart_form_data: { modo: 'multipart_form_data', tipo: 'multipart/form-data' },
  binary_file: { modo: 'binary_file', tipo: null },
  // Nombres heredados de quien ya llamaba a `cargarDesdePeticionGuardada`.
  json: { modo: 'json', tipo: 'application/json' },
  text: { modo: 'raw', tipo: 'text/plain' },
});

/**
 * Traducción de vuelta: modo del constructor → `body_mode` del servidor.
 *
 * Los tres modos nuevos se llaman ya igual que en el enum, así que para ellos
 * esto es la identidad. Los dos históricos necesitan el tipo de contenido para
 * decidir: `raw` con `application/xml` es `raw_xml`, no `raw_text`. Guardar
 * todo como `raw_text` perdería información que el usuario sí eligió.
 */
export function modoGuardadoDesdeConstructor(cuerpo: CuerpoDeSolicitud): string {
  switch (cuerpo.modo) {
    case 'none':
      return 'none';
    case 'json':
      return 'raw_json';
    case 'form_urlencoded':
    case 'multipart_form_data':
    case 'binary_file':
      return cuerpo.modo;
    default:
      break;
  }
  const tipo = (cuerpo.tipoContenido ?? '').toLowerCase();
  if (tipo.includes('json')) return 'raw_json';
  if (tipo.includes('xml')) return 'raw_xml';
  if (tipo.includes('html')) return 'raw_html';
  return 'raw_text';
}

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
    peticionId: null,
    coleccionId: null,
    workspaceId: null,
    nombre: '',
    lockVersion: null,
    estadoDeGuardado: 'inactivo',
    errorDeGuardado: null,
    guardadoEn: null,
    huellaGuardada: null,
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

    /** Filas del cuerpo de formulario, nunca `undefined`. */
    camposDelCuerpo(estado): readonly CampoDeCuerpo[] {
      return camposDeCuerpo(estado.cuerpo);
    },

    camposDeCuerpoActivos(estado): number {
      return camposActivosDeCuerpo(estado.cuerpo).length;
    },

    /** Lo que este cuerpo no podrá enviarse tal cual. Se pinta, no se calla. */
    limitacionesDelCuerpo(estado): string[] {
      return limitacionesDeEnvioDelCuerpo(estado.cuerpo, estado.adaptador);
    },

    /** `true` si hay una petición guardada abierta: la condición de P1. */
    hayPeticionAbierta(estado): boolean {
      return estado.peticionId !== null;
    },

    /**
     * Huella de **todo lo que se persiste**, y de nada más.
     *
     * Es la señal que dispara el rebote del autoguardado. Deja fuera a
     * propósito el resultado, el historial y el adaptador: cambiar de modo de
     * ejecución o recibir una respuesta **no** es editar la petición, y
     * guardar por eso generaría escrituras que el usuario no pidió y una
     * entrada de auditoría falsa por cada envio.
     */
    huellaDelBorrador(estado): string {
      const pares = (lista: readonly Par[]) =>
        lista
          .filter((p) => p.nombre.trim().length > 0)
          .map((p) => `${p.nombre}\u0001${p.valor}\u0001${p.activo ? 1 : 0}`);
      const campos = camposDeCuerpo(estado.cuerpo).map(
        (c) =>
          `${c.nombre}\u0001${c.tipo}\u0001${c.tipo === 'fichero' ? (c.fichero?.id ?? '') : c.valor}\u0001${
            c.activo ? 1 : 0
          }`,
      );
      return JSON.stringify([
        estado.nombre,
        estado.metodo,
        estado.url,
        pares(estado.cabeceras),
        pares(estado.parametros),
        estado.cuerpo.modo,
        estado.cuerpo.contenido,
        estado.cuerpo.tipoContenido,
        campos,
        estado.cuerpo.ficheroBinario?.id ?? null,
      ]);
    },

    /** Hay algo escrito que todavía no está en el servidor. */
    hayCambiosSinGuardar(): boolean {
      if (this.peticionId === null) return false;
      if (this.huellaGuardada === null) return false;
      return this.huellaDelBorrador !== this.huellaGuardada;
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

    /**
     * Cambia el modo del cuerpo.
     *
     * Al entrar en un modo de formulario se asegura que haya una fila vacía:
     * si no, el usuario ve una tabla sin sitio donde escribir y tiene que ir a
     * buscar el botón de añadir. Mismo criterio que `quitarCabecera`.
     *
     * **No se borra nada al cambiar de modo**: el texto crudo, las filas y el
     * fichero binario conviven. Cambiar de `json` a `multipart` y volver no
     * debe costar reescribir el JSON. Lo que se envía y lo que se guarda lo
     * decide el modo, no la ausencia de datos.
     */
    establecerModoDeCuerpo(modo: CuerpoDeSolicitud['modo']): void {
      this.cuerpo.modo = modo;
      if (esModoDeFormulario(modo) && camposDeCuerpo(this.cuerpo).length === 0) {
        this.cuerpo.campos = [nuevoCampoDeCuerpo()];
      }
      // El tipo de contenido derivado del modo anterior dejaría de ser cierto.
      this.cuerpo.tipoContenido = null;
    },

    establecerContenidoDelCuerpo(contenido: string): void {
      this.cuerpo.contenido = contenido;
    },

    // --- Filas del cuerpo de formulario (P5) ------------------------------

    anadirCampoDeCuerpo(nombre = '', valor = ''): void {
      this.cuerpo.campos = [...camposDeCuerpo(this.cuerpo), nuevoCampoDeCuerpo(nombre, valor)];
    },

    quitarCampoDeCuerpo(id: string): void {
      const restantes = camposDeCuerpo(this.cuerpo).filter((campo) => campo.id !== id);
      this.cuerpo.campos = restantes.length > 0 ? restantes : [nuevoCampoDeCuerpo()];
    },

    actualizarCampoDeCuerpo(
      id: string,
      cambio: Partial<Pick<CampoDeCuerpo, 'nombre' | 'valor' | 'activo' | 'tipo'>>,
    ): void {
      this.cuerpo.campos = camposDeCuerpo(this.cuerpo).map((campo) =>
        campo.id === id ? { ...campo, ...cambio } : campo,
      );
    },

    /**
     * Asocia (o quita) el fichero de una fila.
     *
     * `ck_bodyfield_xor` permite **como mucho una** fuente de valor por campo,
     * así que al poner un fichero la fila pasa a `tipo: 'fichero'` y es ese
     * tipo —no la presencia del otro campo— el que decide qué se envía.
     */
    establecerFicheroDeCampo(id: string, fichero: FicheroDeCuerpo | null): void {
      this.cuerpo.campos = camposDeCuerpo(this.cuerpo).map((campo) =>
        campo.id === id
          ? { ...campo, fichero, tipo: fichero === null ? campo.tipo : 'fichero' }
          : campo,
      );
    },

    establecerFicheroBinario(fichero: FicheroDeCuerpo | null): void {
      this.cuerpo.ficheroBinario = fichero;
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
      this.olvidarPeticionAbierta();
    },

    /**
     * Deja de considerar que hay una fila abierta.
     *
     * Imprescindible al salir de la vista: si el estado se quedase apuntando a
     * la petición anterior, el siguiente rebote escribiría en ella.
     */
    olvidarPeticionAbierta(): void {
      this.peticionId = null;
      this.coleccionId = null;
      this.workspaceId = null;
      this.nombre = '';
      this.lockVersion = null;
      this.estadoDeGuardado = 'inactivo';
      this.errorDeGuardado = null;
      this.guardadoEn = null;
      this.huellaGuardada = null;
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
      bodyFields?: readonly CampoDeCuerpoGuardado[];
      binaryFile?: {
        id: string;
        fileName: string;
        contentType: string | null;
        sizeBytes: number | null;
      } | null;
      lockVersion?: number | null;
    }): string[] {
      const limitaciones: string[] = [];

      /*
       * FASE 7: se RECUERDA la identidad. Antes estos tres campos llegaban en
       * el argumento y se descartaban, y por eso no podía haber autoguardado:
       * el constructor no sabía a qué fila hacer `PATCH`.
       */
      this.peticionId = datos.requestId ?? null;
      this.coleccionId = datos.collectionId ?? null;
      this.workspaceId = datos.workspaceId ?? null;
      this.nombre = datos.name ?? '';
      this.lockVersion = typeof datos.lockVersion === 'number' ? datos.lockVersion : null;
      this.estadoDeGuardado = this.peticionId === null ? 'inactivo' : 'guardado';
      this.errorDeGuardado = null;
      this.guardadoEn = null;

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

      const campos: CampoDeCuerpo[] = (datos.bodyFields ?? []).map((guardado) => {
        contadorDeCampos += 1;
        return {
          id: `campo-${contadorDeCampos}`,
          nombre: guardado.key,
          tipo: guardado.kind === 'file' ? 'fichero' : 'texto',
          valor: guardado.value ?? '',
          fichero:
            guardado.kind === 'file' && typeof guardado.fileId === 'string'
              ? {
                  id: guardado.fileId,
                  // El servidor manda el id del fichero en la fila, y sus
                  // metadatos aparte. Si no llegan, se dice «fichero» en vez de
                  // inventar un nombre que el usuario creería real.
                  fileName: 'fichero adjunto',
                  contentType: guardado.contentType ?? null,
                  sizeBytes: null,
                }
              : null,
          activo: guardado.enabled,
        };
      });

      if (esModoDeFormulario(modo) && campos.length === 0) campos.push(nuevoCampoDeCuerpo());

      const secretos = (datos.bodyFields ?? []).filter((c) => c.secret === true);
      if (secretos.length > 0) {
        limitaciones.push(
          `El servidor no envía el valor de ${secretos.length === 1 ? 'el campo secreto' : 'los campos secretos'} ` +
            `${secretos.map((c) => c.key).join(', ')} del cuerpo: ${
              secretos.length === 1 ? 'aparece vacío' : 'aparecen vacíos'
            }. Complétalo antes de enviar, o usa una variable de entorno.`,
        );
      }

      this.cuerpo = {
        modo,
        contenido: modo === 'none' ? '' : (datos.body ?? ''),
        tipoContenido,
        campos,
        ficheroBinario: datos.binaryFile ?? null,
      };

      if (modo === 'binary_file' && (datos.binaryFile ?? null) === null) {
        limitaciones.push(
          'Esta petición está guardada como cuerpo binario pero el servidor no ha ' +
            'devuelto el fichero asociado. No se enviará ningún cuerpo hasta que elijas uno.',
        );
      }

      this.resultado = null;
      this.error = null;
      // La huella se fija DESPUÉS de volcarlo todo: es el punto cero contra el
      // que se mide «hay cambios sin guardar». Fijarla antes haría que abrir
      // una petición contase como editarla y disparase un guardado inmediato.
      this.huellaGuardada = this.peticionId === null ? null : this.huellaDelBorrador;
      return limitaciones;
    },

    // --- P1: autoguardado -------------------------------------------------

    /** Marca que hay cambios pendientes. La llama el rebote, no las vistas. */
    marcarSinGuardar(): void {
      if (this.peticionId === null) return;
      if (this.estadoDeGuardado === 'guardando') return;
      this.estadoDeGuardado = 'sinGuardar';
    },

    /** Cuerpo del `PATCH`: exactamente lo que se persiste, y nada más. */
    entradaDeGuardado(): EntradaActualizarPeticion {
      const aPares = (lista: readonly Par[]) =>
        lista
          .filter((p) => p.nombre.trim().length > 0)
          .map((p) => ({ key: p.nombre.trim(), value: p.valor, enabled: p.activo }));

      const modoGuardado = modoGuardadoDesdeConstructor(this.cuerpo);
      const esFormulario = esModoDeFormulario(this.cuerpo.modo);

      const entrada: Record<string, unknown> = {
        name: this.nombre.trim(),
        method: this.metodo,
        url: this.url,
        headers: aPares(this.cabeceras),
        queryParams: aPares(this.parametros),
        bodyType: modoGuardado,
        /*
         * §2.1: «Enviar `body` con `bodyType` de formulario es 422». Y
         * `ck_body_mode_shape` exige `raw_content IS NULL` en
         * `binary_file`/`multipart`/`urlencoded`. Así que aquí va `null`, no
         * la cadena vacía: una cadena vacía sigue siendo NOT NULL.
         */
        body:
          esFormulario || this.cuerpo.modo === 'binary_file' || this.cuerpo.modo === 'none'
            ? null
            : this.cuerpo.contenido,
      };

      if (esFormulario) {
        entrada.bodyFields = camposActivosDeCuerpo(this.cuerpo).map((campo) =>
          campo.tipo === 'fichero'
            ? {
                key: campo.nombre.trim(),
                kind: 'file' as const,
                fileId: campo.fichero?.id ?? null,
                enabled: campo.activo,
              }
            : {
                key: campo.nombre.trim(),
                kind: 'text' as const,
                value: campo.valor,
                enabled: campo.activo,
              },
        );
      }
      if (this.cuerpo.modo === 'binary_file') {
        entrada.binaryFileId = this.cuerpo.ficheroBinario?.id ?? null;
      }
      if (this.lockVersion !== null) entrada.lockVersion = this.lockVersion;

      return entrada as EntradaActualizarPeticion;
    },

    /**
     * `PATCH /requests/:id` con lo que hay ahora mismo en el borrador.
     *
     * TRES COSAS QUE NO SON OPCIONALES (§3.C.1 del `BRIEF-FASE7`):
     *
     *  1. **No autoguarda una petición que no existe.** Si `peticionId` es
     *     `null` esto no crea nada: crear lo decide el usuario.
     *  2. **No descarta lo que el usuario escribió.** Si el servidor rechaza,
     *     el borrador se queda intacto y lo único que cambia es el indicador.
     *     Recargar desde el servidor «para quedar consistentes» sería tirar el
     *     trabajo de alguien.
     *  3. **No pisa cambios ajenos en silencio.** Ver `detectarConflicto`.
     */
    async guardarAhora(): Promise<boolean> {
      if (this.peticionId === null) return false;
      if (this.estadoDeGuardado === 'guardando') return false;

      const nombre = this.nombre.trim();
      if (errorDeNombreDePeticion(nombre) !== null) {
        // P2: «nombre vacío no se guarda». Y tampoco se guarda el resto con un
        // nombre inválido: el `PATCH` es uno solo y el servidor lo rechazaría
        // entero con 422.
        this.estadoDeGuardado = 'error';
        this.errorDeGuardado =
          errorDeNombreDePeticion(nombre) ?? 'El nombre de la petición no es válido.';
        return false;
      }

      const huellaEnviada = this.huellaDelBorrador;
      const versionEsperada = this.lockVersion;
      this.estadoDeGuardado = 'guardando';
      this.errorDeGuardado = null;

      try {
        const actualizada = await actualizarPeticion(this.peticionId, this.entradaDeGuardado());

        const conflicto =
          versionEsperada !== null &&
          actualizada.lockVersion !== null &&
          actualizada.lockVersion > versionEsperada + 1;

        this.lockVersion = actualizada.lockVersion;
        this.huellaGuardada = huellaEnviada;
        this.guardadoEn = new Date().toISOString();

        if (conflicto) {
          /*
           * DETECCIÓN A POSTERIORI, Y SE DICE POR QUÉ ES A POSTERIORI.
           * `api_requests` tiene `lock_version`, pero hoy el repositorio del
           * servidor hace `lockVersion: { increment: 1 }` SIN comprobar la
           * versión recibida (`request.repository.ts:367`), de modo que no
           * puede rechazar la escritura. Lo único que el cliente puede hacer
           * honestamente es mirar el salto de versión: si subió más de uno,
           * alguien escribió entre nuestra lectura y nuestra escritura. Avisa
           * —que es lo que exige el brief— aunque la sobrescritura ya haya
           * ocurrido. Que el servidor la impida está pedido en el informe.
           */
          this.estadoDeGuardado = 'conflicto';
          this.errorDeGuardado =
            'Alguien más modificó esta petición mientras la editábas. Se ha guardado ' +
            'tu versión encima; revisa los cambios antes de seguir.';
          return true;
        }

        this.estadoDeGuardado = 'guardado';
        return true;
      } catch (error) {
        if (error instanceof ErrorDeApi && (error.estado === 409 || error.estado === 412)) {
          this.estadoDeGuardado = 'conflicto';
          this.errorDeGuardado =
            'El servidor rechazó el guardado porque la petición cambió por otro lado. ' +
            'Lo que has escrito sigue aquí: cópialo o vuelve a guardar para sobrescribir.';
          return false;
        }
        this.estadoDeGuardado = 'error';
        this.errorDeGuardado = mensajeDeError(error);
        return false;
      }
    },

    /**
     * P2: renombrar dentro del constructor.
     *
     * Devuelve el error si lo hay, `null` si el nombre se aceptó. **Vacío no
     * se guarda**: se rechaza aquí y el título recupera el nombre anterior.
     * El guardado de verdad lo hace el rebote o el `blur`, como cualquier otro
     * campo: tener dos caminos de escritura distintos para el nombre sería
     * tener dos sitios donde se puede perder.
     */
    renombrar(nombre: string): string | null {
      const error = errorDeNombreDePeticion(nombre);
      if (error !== null) return error;
      this.nombre = nombre.trim();
      return null;
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
