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
import PanelDeRespuesta from '@/components/respuesta/PanelDeRespuesta.vue';
import { usarAlmacenDeConstructor } from '@/stores/constructor';
import { ADAPTADORES, formatearDuracion } from '@/api/ejecucion';
import { clavesSecretas, obtenerPeticion } from '@/api/peticiones';
import { mensajeDeError } from '@/api/errores';
import { RUTA_COLECCION } from '@/router/nombres';
import type { IdDeAdaptador, Par } from '@/api/ejecucion';
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
    }));
  } catch (error) {
    peticionAbierta.value = null;
    errorDePeticion.value = mensajeDeError(error);
  } finally {
    cargandoPeticion.value = false;
  }
}

onMounted(() => {
  if (props.peticionId !== undefined) void abrirPeticionGuardada(props.peticionId);
});

watch(
  () => props.peticionId,
  (nuevo, anterior) => {
    if (nuevo === anterior || nuevo === undefined) return;
    void abrirPeticionGuardada(nuevo);
  },
);

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
      <h1>
        {{ peticionAbierta ? peticionAbierta.name : 'Constructor de solicitudes' }}
      </h1>
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

    <BarraDeSolicitud
      :metodo="constructor.metodo"
      :url="constructor.url"
      :url-efectiva="constructor.urlEfectiva"
      :ejecutando="constructor.ejecutando"
      :puede-enviar="constructor.puedeEnviar"
      @update:metodo="constructor.metodo = $event"
      @update:url="constructor.url = $event"
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
          @actualizar="(id, campo, valor) => actualizarPar(constructor.parametros, id, campo, valor)"
          @alternar="(id, activo) => alternarPar(constructor.parametros, id, activo)"
          @quitar="constructor.quitarParametro($event)"
          @anadir="constructor.anadirParametro()"
        />

        <EditorDePares
          v-else-if="pestana === 'cabeceras'"
          :pares="constructor.cabeceras"
          sustantivo="cabecera"
          :nombres-con-aviso="constructor.cabecerasIgnoradas"
          titulo-del-aviso="El navegador no permite enviar esta cabecera."
          @actualizar="(id, campo, valor) => actualizarPar(constructor.cabeceras, id, campo, valor)"
          @alternar="(id, activo) => alternarPar(constructor.cabeceras, id, activo)"
          @quitar="constructor.quitarCabecera($event)"
          @anadir="constructor.anadirCabecera()"
        />

        <EditorDeCuerpo
          v-else
          :modo="constructor.cuerpo.modo"
          :contenido="constructor.cuerpo.contenido"
          :tipo-contenido="constructor.tipoDeContenidoEfectivo"
          :metodo="constructor.metodo"
          @update:modo="constructor.establecerModoDeCuerpo($event)"
          @update:contenido="constructor.establecerContenidoDelCuerpo($event)"
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
