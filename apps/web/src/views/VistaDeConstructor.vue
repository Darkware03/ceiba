<script setup lang="ts">
/**
 * Constructor de solicitudes: borrador a la izquierda, respuesta a la derecha
 * (apilados en pantallas estrechas).
 *
 * EL AVISO DE MODO NO ES DECORACIÓN. §18 pide que una función pendiente se
 * identifique claramente en la interfaz, y aquí lo pendiente es gordo: hoy la
 * solicitud sale del propio navegador, no del motor, así que no pasa por los
 * controles SSRF, está sujeta a CORS y el navegador descarta cabeceras. El
 * usuario tiene que saberlo antes de concluir que «CEIBA no puede llamar a
 * esta API».
 */
import { computed, onMounted, ref, watch } from 'vue';
import { CeibaLoadingScreen } from '@ceiba/brand';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import BarraDeSolicitud from '@/components/solicitud/BarraDeSolicitud.vue';
import EditorDeCuerpo from '@/components/solicitud/EditorDeCuerpo.vue';
import EditorDePares from '@/components/solicitud/EditorDePares.vue';
import IndicadorDeGuardado from '@/components/solicitud/IndicadorDeGuardado.vue';
import TituloEditable from '@/components/peticiones/TituloEditable.vue';
import DialogoDeCurl from '@/components/peticiones/DialogoDeCurl.vue';
import PanelDeRespuesta from '@/components/respuesta/PanelDeRespuesta.vue';
import { usarAlmacenDeConstructor } from '@/stores/constructor';
import { usarAlmacenDePeticiones } from '@/stores/peticiones';
import { usarAutoguardado } from '@/composables/usarAutoguardado';
import { ADAPTADORES, formatearDuracion } from '@/api/ejecucion';
import { clavesSecretas, errorDeNombreDePeticion, obtenerPeticion } from '@/api/peticiones';
import { obtenerColeccion } from '@/api/colecciones';
import { mensajeDeError } from '@/api/errores';
import { RUTA_COLECCION } from '@/router/nombres';
import type { CampoDeCuerpo, FicheroDeCuerpo, IdDeAdaptador, Par } from '@/api/ejecucion';
import type { Peticion } from '@/api/peticiones';

/**
 * Petición guardada a abrir, si se ha llegado aquí desde una colección.
 *
 * Llegan por `props` desde la **query** de la ruta (`rutas.ts`), no por
 * `useRoute()`. Así `/constructor` a secas sigue siendo el borrador en blanco
 * de siempre y la vista se puede montar sin router, que es lo que hacen las
 * pruebas de la fase 5.
 */
const props = defineProps<{ peticionId?: string; coleccionId?: string }>();

const constructor = usarAlmacenDeConstructor();
const almacenDePeticiones = usarAlmacenDePeticiones();

const peticionAbierta = ref<Peticion | null>(null);
const cargandoPeticion = ref(false);
const errorDePeticion = ref<string | null>(null);
/** Lo que la petición guardada dice y este constructor no sabe representar. */
const limitaciones = ref<string[]>([]);

const destinoDeLaColeccion = computed(() =>
  props.coleccionId === undefined
    ? null
    : { name: RUTA_COLECCION, params: { collectionId: props.coleccionId } },
);

/**
 * Carga la petición guardada en el borrador.
 *
 * Las limitaciones que devuelva el almacén se guardan y se pintan: abrir una
 * petición con un método o un cuerpo que el motor no admite y no decirlo
 * dejaría al usuario enviando algo distinto de lo que tenía guardado.
 */
async function abrirPeticionGuardada(requestId: string): Promise<void> {
  cargandoPeticion.value = true;
  errorDePeticion.value = null;
  limitaciones.value = [];
  try {
    const peticion = await obtenerPeticion(requestId);
    peticionAbierta.value = peticion;
    const notas: string[] = [];

    /*
     * Los valores secretos NO viajan: el servidor manda `value: null` y la
     * marca `secret`. Es lo correcto, pero hay que DECIRLO. Si no, el
     * constructor abre la petición con la cabecera presente y vacía, el envío
     * se va con un `Authorization:` en blanco y el 401 resultante parece un
     * fallo del destino en vez de lo que es.
     */
    const secretas = clavesSecretas(peticion);
    if (secretas.length > 0) {
      notas.push(
        `El servidor no envía el valor de ${secretas.length === 1 ? 'el secreto' : 'los secretos'} ` +
          `${secretas.join(', ')}: ${secretas.length === 1 ? 'aparece' : 'aparecen'} con el valor ` +
          'vacío. Complétalo antes de enviar, o usa una variable de entorno.',
      );
    }

    limitaciones.value = notas.concat(constructor.cargarDesdePeticionGuardada({
      collectionId: peticion.collectionId,
      requestId: peticion.id,
      name: peticion.name,
      method: peticion.method,
      methodCustom: peticion.methodCustom,
      url: peticion.url,
      headers: peticion.headers.map((par) => ({ ...par })),
      queryParams: peticion.queryParams.map((par) => ({ ...par })),
      bodyType: peticion.bodyType,
      body: peticion.body,
      bodyFields: peticion.bodyFields,
      binaryFile: peticion.binaryFile,
      lockVersion: peticion.lockVersion,
    }));
    void resolverWorkspace(peticion.collectionId);
  } catch (error) {
    peticionAbierta.value = null;
    errorDePeticion.value = mensajeDeError(error);
  } finally {
    cargandoPeticion.value = false;
  }
}

/**
 * Averigua a qué workspace pertenece la colección abierta.
 *
 * HACE FALTA PARA P5 Y NO VIENE EN LA PETICIÓN. La subida de ficheros cuelga
 * de `/workspaces/:workspaceId/files` (§2.2), pero `GET /requests/:id` **no**
 * devuelve `workspaceId`: lo comprobé en `vistaResumen`/`vistaDetalle` de
 * `request.service.ts`, que no lo incluyen en su lista de permitidos. Así que
 * se resuelve con una lectura extra de la colección, que sí lo lleva.
 *
 * Si falla, **no es un error de la vista**: el constructor funciona entero sin
 * esto; lo único que no se puede hacer es subir ficheros, y el selector lo
 * dice con todas sus letras. Por eso este fallo no pinta un cartel rojo.
 */
async function resolverWorkspace(collectionId: string): Promise<void> {
  if (collectionId.length === 0) return;
  try {
    const { coleccion } = await obtenerColeccion(collectionId);
    constructor.workspaceId = coleccion.workspaceId;
  } catch {
    constructor.workspaceId = null;
  }
}

onMounted(() => {
  if (props.peticionId !== undefined) void abrirPeticionGuardada(props.peticionId);
});

watch(
  () => props.peticionId,
  (nuevo, anterior) => {
    if (nuevo === anterior) return;
    if (nuevo === undefined) {
      // Se ha pasado de una petición guardada al borrador en blanco. Hay que
      // dejar de apuntar a la fila anterior o el siguiente rebote escribiría
      // en ella.
      peticionAbierta.value = null;
      constructor.olvidarPeticionAbierta();
      return;
    }
    void abrirPeticionGuardada(nuevo);
  },
);

// ---------------------------------------------------------------------------
// P1 · Autoguardado
// ---------------------------------------------------------------------------

/**
 * El rebote sólo está vivo cuando hay una fila que actualizar **y hay algo
 * distinto que escribir**.
 *
 * Las dos condiciones son necesarias y cada una arregla un fallo concreto:
 *
 *  - `hayPeticionAbierta`: «no autoguardar una petición que todavía no existe
 *    — eso es crear, y lo decide el usuario» (§3.C.1).
 *  - `hayCambiosSinGuardar`: sin esto, **abrir** una petición contaría como
 *    editarla. La huella del borrador pasa de «vacío» a «la petición» al
 *    cargar, el observador lo veía como un cambio y el indicador anunciaba
 *    «Sin guardar» nada más abrir, además de lanzar un `PATCH` que no
 *    cambiaba nada. Lo detectó la prueba del indicador; queda aquí anotado
 *    para que nadie «simplifique» esta condición.
 */
const autoguardado = usarAutoguardado({
  huella: () => constructor.huellaDelBorrador,
  activo: () => constructor.hayPeticionAbierta && constructor.hayCambiosSinGuardar,
  guardar: async () => {
    await constructor.guardarAhora();
  },
});

watch(
  () => autoguardado.pendiente.value,
  (hay) => {
    if (hay) constructor.marcarSinGuardar();
  },
);

/** `blur` de cualquier campo: guardado inmediato, como pide el brief. */
function alPerderFoco(): void {
  autoguardado.alPerderFoco();
}

async function reintentarGuardado(): Promise<void> {
  await constructor.guardarAhora();
}

// ---------------------------------------------------------------------------
// P2 · Renombrar dentro de la petición
// ---------------------------------------------------------------------------

function renombrar(nombre: string): void {
  const fallo = constructor.renombrar(nombre);
  if (fallo !== null) return;
  // El nombre también vive en la cabecera de la vista y en el almacén de la
  // lista; si no se refresca aquí, al volver a la colección se vería el viejo.
  const abierta = peticionAbierta.value;
  if (abierta !== null) peticionAbierta.value = { ...abierta, name: constructor.nombre };
  void autoguardado.guardarYa();
}

// ---------------------------------------------------------------------------
// §1.1 causa 2 · «Copiar como cURL» dentro del constructor
// ---------------------------------------------------------------------------

const copiandoCurl = ref(false);

/**
 * GUARDA PRIMERO Y PIDE DESPUÉS. No es una floritura: es la causa 1 del §1.1.
 *
 * `GET /requests/:id/curl` genera el comando desde la **fila guardada**
 * (`request.service.ts#comoCurl` lee la fila y se la pasa a `generarCurl`).
 * Si se pidiese sin guardar, el usuario recibiría el cURL de lo que había
 * antes —sin su cuerpo y sin sus cabeceras—, que es literalmente la queja del
 * cliente. Con P1 el borrador ya suele estar guardado; esto cierra la ventana
 * que queda entre la última tecla y el rebote.
 */
const recopiando = ref(false);

async function recopiarCurl(): Promise<void> {
  recopiando.value = true;
  try {
    await almacenDePeticiones.recopiarCurl();
  } finally {
    recopiando.value = false;
  }
}

async function copiarComoCurl(): Promise<void> {
  const abierta = peticionAbierta.value;
  if (abierta === null || copiandoCurl.value) return;
  copiandoCurl.value = true;
  try {
    await autoguardado.guardarYa();
    if (constructor.estadoDeGuardado === 'error') {
      // Exportaría la versión vieja y parecería la nueva. Mejor no exportar.
      return;
    }
    await almacenDePeticiones.copiarComoCurl(abierta.id, constructor.nombre || abierta.name);
  } finally {
    copiandoCurl.value = false;
  }
}

type PestanaDeSolicitud = 'parametros' | 'cabeceras' | 'cuerpo';
const pestana = ref<PestanaDeSolicitud>('parametros');

const puerto = computed(() => constructor.puerto);

function actualizarPar(lista: Par[], id: string, campo: 'nombre' | 'valor', valor: string): void {
  const par = lista.find((item) => item.id === id);
  if (par === undefined) return;
  par[campo] = valor;
}

function alternarPar(lista: Par[], id: string, activo: boolean): void {
  const par = lista.find((item) => item.id === id);
  if (par === undefined) return;
  par.activo = activo;
}

function cambiarAdaptador(evento: Event): void {
  constructor.usarAdaptador((evento.target as HTMLSelectElement).value as IdDeAdaptador);
}

// --- P5 · Cuerpo: formulario y binario -------------------------------------

function actualizarCampoDeCuerpo(
  id: string,
  cambio: Partial<Pick<CampoDeCuerpo, 'nombre' | 'valor' | 'tipo' | 'activo'>>,
): void {
  constructor.actualizarCampoDeCuerpo(id, cambio);
}

function ficheroDeCampo(id: string, fichero: FicheroDeCuerpo | null): void {
  constructor.establecerFicheroDeCampo(id, fichero);
}

async function enviar(): Promise<void> {
  await constructor.ejecutarSolicitud();
}
</script>

<template>
  <div class="constructor">
    <nav v-if="destinoDeLaColeccion" class="constructor__migas" aria-label="Ruta de navegación">
      <RouterLink :to="destinoDeLaColeccion">← Volver a la colección</RouterLink>
    </nav>

    <header class="constructor__cabecera">
      <!--
        P2. Antes esto era un `<h1>` de sólo lectura y renombrar obligaba a
        volver a la lista de la colección. Ahora el título se edita aquí
        mismo; sigue siendo un `<h1>` cuando no se está editando, para no
        dejar la página sin encabezado de nivel 1.
      -->
      <TituloEditable
        :nombre="constructor.nombre"
        :editable="constructor.hayPeticionAbierta"
        :validar="errorDeNombreDePeticion"
        @renombrar="renombrar"
      />

      <div class="constructor__acciones">
        <!-- P1: el indicador no es decoración; ver `IndicadorDeGuardado.vue`. -->
        <IndicadorDeGuardado
          v-if="constructor.hayPeticionAbierta"
          :estado="constructor.estadoDeGuardado"
          :error="constructor.errorDeGuardado"
          :guardado-en="constructor.guardadoEn"
          @reintentar="reintentarGuardado"
        />

        <!-- §1.1 causa 2: el botón, por fin, donde el usuario está. -->
        <CeibaBoton
          v-if="peticionAbierta"
          compacto
          variante="secundario"
          data-prueba="curl-en-constructor"
          :cargando="copiandoCurl"
          :aria-label="`Copiar como cURL la petición ${constructor.nombre}`"
          @click="copiarComoCurl"
        >
          Copiar como cURL
        </CeibaBoton>
      </div>

      <label class="constructor__modo">
        <span class="constructor__modo-etiqueta">Modo de ejecución</span>
        <select
          class="constructor__selector"
          :value="constructor.adaptador"
          @change="cambiarAdaptador"
        >
          <option v-for="opcion in ADAPTADORES" :key="opcion.id" :value="opcion.id">
            {{ opcion.etiqueta }}
          </option>
        </select>
      </label>
    </header>

    <div v-if="cargandoPeticion" class="constructor__espera">
      <CeibaLoadingScreen
        inline
        message="Abriendo la petición…"
        :detail="`GET /api/v1/requests/${peticionId}`"
      />
    </div>

    <CeibaAviso v-if="errorDePeticion" tono="error" titulo="No se pudo abrir la petición">
      {{ errorDePeticion }}
      <p class="constructor__reintento">
        <CeibaBoton
          v-if="peticionId"
          compacto
          :cargando="cargandoPeticion"
          @click="abrirPeticionGuardada(peticionId)"
        >
          Reintentar
        </CeibaBoton>
      </p>
    </CeibaAviso>

    <CeibaAviso
      v-if="limitaciones.length > 0"
      tono="aviso"
      titulo="Esta petición guardada no se puede representar entera aquí"
    >
      <ul class="constructor__limitaciones">
        <li v-for="(nota, indice) in limitaciones" :key="indice">{{ nota }}</li>
      </ul>
    </CeibaAviso>

    <!--
      SOLO EN MODO DIRECTO. Antes se pintaba siempre, asi que al elegir «A
      traves del motor de CEIBA» la pantalla seguia diciendo «Ejecucion
      provisional desde el navegador». El cliente lo reporto textualmente y
      tenia razon: la interfaz contradecia lo que estaba haciendo.
    -->
    <CeibaAviso
      v-if="constructor.adaptador === 'navegador'"
      tono="aviso"
      titulo="Ejecución provisional desde el navegador"
    >
      <p>{{ puerto.advertencia }}</p>
      <p v-if="!puerto.disponible" class="constructor__pendiente">
        Este modo todavía no funciona: al enviar verás el error explicando por qué.
      </p>
      <p v-if="constructor.cabecerasIgnoradas.length > 0">
        El navegador descartará estas cabeceras:
        <code>{{ constructor.cabecerasIgnoradas.join(', ') }}</code>
      </p>
    </CeibaAviso>

    <CeibaAviso
      v-if="constructor.estadoDeGuardado === 'conflicto'"
      tono="error"
      titulo="Esta petición cambió mientras la editábas"
    >
      {{ constructor.errorDeGuardado }}
    </CeibaAviso>

    <BarraDeSolicitud
      :metodo="constructor.metodo"
      :url="constructor.url"
      :url-efectiva="constructor.urlEfectiva"
      :ejecutando="constructor.ejecutando"
      :puede-enviar="constructor.puedeEnviar"
      :coleccion-id="constructor.coleccionId"
      @update:metodo="constructor.metodo = $event"
      @update:url="constructor.url = $event"
      @desenfoque="alPerderFoco"
      @enviar="enviar"
    />

    <div class="constructor__columnas">
      <section class="constructor__solicitud" aria-label="Solicitud">
        <div class="constructor__pestanas" role="tablist" aria-label="Partes de la solicitud">
          <button
            class="constructor__pestana"
            :class="{ 'constructor__pestana--activa': pestana === 'parametros' }"
            type="button"
            role="tab"
            :aria-selected="pestana === 'parametros'"
            @click="pestana = 'parametros'"
          >
            Parámetros ({{ constructor.parametrosActivos }})
          </button>
          <button
            class="constructor__pestana"
            :class="{ 'constructor__pestana--activa': pestana === 'cabeceras' }"
            type="button"
            role="tab"
            :aria-selected="pestana === 'cabeceras'"
            @click="pestana = 'cabeceras'"
          >
            Cabeceras ({{ constructor.cabecerasActivas }})
          </button>
          <button
            class="constructor__pestana"
            :class="{ 'constructor__pestana--activa': pestana === 'cuerpo' }"
            type="button"
            role="tab"
            :aria-selected="pestana === 'cuerpo'"
            @click="pestana = 'cuerpo'"
          >
            Cuerpo
          </button>
        </div>

        <EditorDePares
          v-if="pestana === 'parametros'"
          :pares="constructor.parametros"
          sustantivo="parámetro"
          etiqueta-nombre="Clave"
          :coleccion-id="constructor.coleccionId"
          @actualizar="(id, campo, valor) => actualizarPar(constructor.parametros, id, campo, valor)"
          @alternar="(id, activo) => alternarPar(constructor.parametros, id, activo)"
          @quitar="constructor.quitarParametro($event)"
          @anadir="constructor.anadirParametro()"
          @desenfoque="alPerderFoco"
        />

        <EditorDePares
          v-else-if="pestana === 'cabeceras'"
          :pares="constructor.cabeceras"
          sustantivo="cabecera"
          :nombres-con-aviso="constructor.cabecerasIgnoradas"
          titulo-del-aviso="El navegador no permite enviar esta cabecera."
          :coleccion-id="constructor.coleccionId"
          @actualizar="(id, campo, valor) => actualizarPar(constructor.cabeceras, id, campo, valor)"
          @alternar="(id, activo) => alternarPar(constructor.cabeceras, id, activo)"
          @quitar="constructor.quitarCabecera($event)"
          @anadir="constructor.anadirCabecera()"
          @desenfoque="alPerderFoco"
        />

        <EditorDeCuerpo
          v-else
          :modo="constructor.cuerpo.modo"
          :contenido="constructor.cuerpo.contenido"
          :tipo-contenido="constructor.tipoDeContenidoEfectivo"
          :metodo="constructor.metodo"
          :campos="constructor.camposDelCuerpo"
          :fichero-binario="constructor.cuerpo.ficheroBinario ?? null"
          :workspace-id="constructor.workspaceId"
          :limitaciones="constructor.limitacionesDelCuerpo"
          :coleccion-id="constructor.coleccionId"
          @update:modo="constructor.establecerModoDeCuerpo($event)"
          @update:contenido="constructor.establecerContenidoDelCuerpo($event)"
          @actualizar-campo="actualizarCampoDeCuerpo"
          @fichero-de-campo="ficheroDeCampo"
          @quitar-campo="constructor.quitarCampoDeCuerpo($event)"
          @anadir-campo="constructor.anadirCampoDeCuerpo()"
          @update:fichero-binario="constructor.establecerFicheroBinario($event)"
        />
      </section>

      <section class="constructor__respuesta" aria-label="Resultado">
        <PanelDeRespuesta
          :resultado="constructor.resultado"
          :ejecutando="constructor.ejecutando"
          :error="constructor.error"
        />
      </section>
    </div>

    <section v-if="constructor.historial.length > 0" class="constructor__historial">
      <header class="constructor__historial-cabecera">
        <h2>Historial de esta sesión</h2>
        <CeibaBoton variante="fantasma" compacto @click="constructor.limpiarHistorial()">
          Vaciar
        </CeibaBoton>
      </header>
      <p class="constructor__historial-nota">
        Sólo en memoria: se pierde al recargar. Las solicitudes llevan credenciales y no se
        guardan en el navegador.
      </p>
      <ul class="constructor__lista">
        <li v-for="entrada in constructor.historial" :key="entrada.id" class="constructor__entrada">
          <CeibaBoton
            variante="fantasma"
            ancho-completo
            class="constructor__recuperar"
            :aria-label="`Recuperar ${entrada.metodo} ${entrada.url}`"
            @click="constructor.recuperarDelHistorial(entrada.id)"
          >
            <span class="constructor__entrada-rejilla">
              <span class="ceiba-metodo" :class="`ceiba-metodo--${entrada.metodo.toLowerCase()}`">
                {{ entrada.metodo }}
              </span>
              <span class="constructor__entrada-url">{{ entrada.url }}</span>
              <span v-if="entrada.estado !== null" class="constructor__entrada-estado">
                {{ entrada.estado }}
              </span>
              <span v-else class="constructor__entrada-fallo">{{ entrada.codigoDeError }}</span>
              <span class="constructor__entrada-tiempo">
                {{ formatearDuracion(entrada.totalMs) }}
              </span>
            </span>
          </CeibaBoton>
        </li>
      </ul>
    </section>

    <!--
      Mismo diálogo que en la lista de la colección, a propósito: el comando
      lo genera el servidor y lo único que hace falta aquí es enseñarlo con
      sus advertencias. Duplicar el componente sería duplicar la regla de
      «el texto no se toca» en dos sitios donde puede divergir.
    -->
    <DialogoDeCurl
      v-if="almacenDePeticiones.curl"
      :estado="almacenDePeticiones.curl"
      :recopiando="recopiando"
      @cerrar="almacenDePeticiones.cerrarCurl()"
      @recopiar="recopiarCurl"
    />

    <CeibaAviso
      v-if="almacenDePeticiones.errorDeCurl"
      tono="error"
      titulo="No se pudo generar el cURL"
    >
      {{ almacenDePeticiones.errorDeCurl }}
    </CeibaAviso>
  </div>
</template>

<style scoped>
.constructor {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-4);
  padding: var(--ceiba-space-5);
  max-width: 1400px;
  width: 100%;
  margin: 0 auto;
}

.constructor__cabecera {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--ceiba-space-3);
}

.constructor__acciones {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ceiba-space-3);
  min-width: 0;
}

.constructor__migas {
  font-size: var(--ceiba-text-sm);
}

.constructor__espera {
  position: relative;
  min-height: 160px;
}

.constructor__reintento {
  margin-top: var(--ceiba-space-2);
}

.constructor__limitaciones {
  margin: 0;
  padding-left: var(--ceiba-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
}

.constructor__modo {
  display: inline-flex;
  align-items: center;
  gap: var(--ceiba-space-2);
}

.constructor__modo-etiqueta {
  font-size: var(--ceiba-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ceiba-text-faint);
}

.constructor__selector {
  min-height: 30px;
  padding: 0 var(--ceiba-space-2);
  background: var(--ceiba-surface-raised);
  border: 1px solid var(--ceiba-border-strong);
  border-radius: var(--ceiba-radius-md);
  color: var(--ceiba-text);
  font-family: inherit;
  font-size: var(--ceiba-text-sm);
}

.constructor__pendiente {
  color: var(--ceiba-warning);
}

.constructor__columnas {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--ceiba-space-4);
  align-items: start;
}

.constructor__solicitud,
.constructor__respuesta {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-3);
  padding: var(--ceiba-space-4);
  background: var(--ceiba-surface);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-lg);
  min-width: 0;
}

.constructor__pestanas {
  display: flex;
  gap: var(--ceiba-space-1);
  border-bottom: 1px solid var(--ceiba-border);
}

.constructor__pestana {
  padding: var(--ceiba-space-2) var(--ceiba-space-3);
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--ceiba-text-muted);
  font-family: inherit;
  font-size: var(--ceiba-text-sm);
  cursor: pointer;
}

.constructor__pestana--activa {
  color: var(--ceiba-text);
  border-bottom-color: var(--ceiba-accent);
  font-weight: 600;
}

.constructor__pestana:focus-visible,
.constructor__selector:focus-visible,
.constructor__recuperar:focus-visible {
  outline: none;
  box-shadow: var(--ceiba-focus-ring);
}

.constructor__historial {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-2);
}

.constructor__historial-cabecera {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ceiba-space-3);
}

.constructor__historial-nota {
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

.constructor__lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
}

/* La fila del historial **es** un `CeibaBoton`, no un botón propio: ejecuta una
 * acción (recuperar esa solicitud en el editor). Lo único que añade esta clase
 * es la rejilla interna de cuatro columnas; el borde, el foco visible, la
 * tipografía y los estados ya los pone el componente compartido. */
.constructor__recuperar {
  padding: var(--ceiba-space-2) var(--ceiba-space-3);
  text-align: left;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.constructor__entrada-rejilla {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr) auto auto;
  gap: var(--ceiba-space-3);
  align-items: center;
  width: 100%;
}

.constructor__recuperar:hover {
  border-color: var(--ceiba-border-strong);
  background: var(--ceiba-surface-raised);
}

.constructor__entrada-url {
  font-family: var(--ceiba-font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.constructor__entrada-estado {
  font-family: var(--ceiba-font-mono);
  color: var(--ceiba-text);
}

.constructor__entrada-fallo {
  font-family: var(--ceiba-font-mono);
  color: var(--ceiba-danger);
}

.constructor__entrada-tiempo {
  font-family: var(--ceiba-font-mono);
  color: var(--ceiba-text-faint);
}

@media (max-width: 1000px) {
  .constructor__columnas {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 640px) {
  .constructor {
    padding: var(--ceiba-space-3);
  }

  .constructor__entrada-rejilla {
    grid-template-columns: 52px minmax(0, 1fr) auto;
  }

  .constructor__entrada-tiempo {
    display: none;
  }
}
</style>
