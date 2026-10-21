<script setup lang="ts">
/**
 * Pantalla de una colección: sus peticiones.
 *
 * ESTA VISTA EXISTE PARA ARREGLAR UN FALLO CONCRETO REPORTADO POR EL CLIENTE:
 * «después de crear un workspace, se crean colecciones, después de estas
 * colecciones adentro deberían ir las peticiones no?, porque no sale nada
 * después de crear una colección». No salía nada porque esta pantalla no
 * existía: la colección se creaba y quedaba muerta.
 *
 * Los cuatro estados están contemplados a propósito y ninguno es un hueco:
 *
 *  - **cargando** -> el logo de la marca girando (`CeibaLoadingScreen`).
 *  - **error**    -> `CeibaAviso` con el motivo y un botón de reintento.
 *  - **vacío**    -> `CeibaVacio` CON ACCIÓN («Crear la primera petición»).
 *    Es el estado que faltaba. Un vacío sin salida es exactamente lo que hizo
 *    que el cliente concluyera que el producto estaba roto.
 *  - **con datos** -> la lista, agrupada por carpeta.
 *
 * El `collectionId` llega por `props` (la ruta declara `props: true`) y no
 * leyendo `useRoute()`, igual que en `VistaDeWorkspace.vue`: así el componente
 * se monta en una prueba sin instalar un router entero.
 *
 * La colección en sí se pide con `GET /collections/:id` directamente a la capa
 * de API y no por el almacén de colecciones, porque ese almacén está indexado
 * por workspace y aquí **todavía no se sabe el workspace**: es justamente lo
 * que devuelve esta llamada. Pedir antes la lista entera de workspaces para
 * averiguarlo sería dar un rodeo por tres peticiones para resolver una.
 */
import { computed, onMounted, ref, watch } from 'vue';
import { CeibaLoadingScreen } from '@ceiba/brand';
import BotonDeCompartir from '@/components/comparticion/BotonDeCompartir.vue';
import DialogoDeComparticion from '@/components/comparticion/DialogoDeComparticion.vue';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import CeibaVacio from '@/components/ui/CeibaVacio.vue';
import DialogoDeBorrado from '@/components/workspaces/DialogoDeBorrado.vue';
import DialogoDeCurl from '@/components/peticiones/DialogoDeCurl.vue';
import DialogoDePeticion from '@/components/peticiones/DialogoDePeticion.vue';
import type { DatosDePeticion } from '@/components/peticiones/DialogoDePeticion.vue';
import FilaDePeticion from '@/components/peticiones/FilaDePeticion.vue';
import { obtenerColeccion } from '@/api/colecciones';
import { mensajeDeError } from '@/api/errores';
import { usarAlmacenDePeticiones } from '@/stores/peticiones';
import { RUTA_WORKSPACE, RUTA_WORKSPACES } from '@/router/nombres';
import type { Coleccion } from '@/api/tipos';
import type { Peticion } from '@/api/peticiones';

const NOTA_DE_ROL = 'El servidor exige rol «editor» en este workspace para esta operación.';

const props = defineProps<{ collectionId: string }>();

const almacen = usarAlmacenDePeticiones();

const coleccion = ref<Coleccion | null>(null);
const cargandoColeccion = ref(false);
const errorDeColeccion = ref<string | null>(null);

const creando = ref(false);
const aRenombrar = ref<Peticion | null>(null);
const aBorrar = ref<Peticion | null>(null);
const errorDeDialogo = ref<string | null>(null);
const recopiando = ref(false);
/** P7: ¿está abierto el diálogo de compartir esta colección? */
const compartiendo = ref(false);

const lista = computed(() => almacen.deColeccion(props.collectionId));
const grupos = computed(() => almacen.porCarpeta(props.collectionId));
const cargada = computed(() => almacen.cargada(props.collectionId));
const sinPeticiones = computed(() => almacen.estaVacia(props.collectionId));
const primeraCarga = computed(
  () => (almacen.cargando && !cargada.value) || cargandoColeccion.value,
);

/** Destino de la miga de pan: sólo se sabe cuando la colección ha llegado. */
const destinoDelWorkspace = computed(() =>
  coleccion.value === null
    ? { name: RUTA_WORKSPACES }
    : { name: RUTA_WORKSPACE, params: { workspaceId: coleccion.value.workspaceId } },
);

async function cargarColeccion(collectionId: string): Promise<void> {
  cargandoColeccion.value = true;
  errorDeColeccion.value = null;
  try {
    const respuesta = await obtenerColeccion(collectionId);
    coleccion.value = respuesta.coleccion;
  } catch (error) {
    // No se distingue «no existe» de «no tienes membresía»: lo decide el
    // servidor y filtrar esa diferencia sería decir de más (§19).
    coleccion.value = null;
    errorDeColeccion.value = mensajeDeError(error);
  } finally {
    cargandoColeccion.value = false;
  }
}

async function cargarTodo(collectionId: string): Promise<void> {
  await Promise.all([cargarColeccion(collectionId), almacen.cargar(collectionId)]);
}

onMounted(() => {
  void cargarTodo(props.collectionId);
});

// Navegar de una colección a otra reutiliza el componente: sin esto, la
// segunda pantalla enseñaría las peticiones de la primera.
watch(
  () => props.collectionId,
  (nuevo, anterior) => {
    if (nuevo === anterior) return;
    cerrarDialogos();
    void cargarTodo(nuevo);
  },
);

function abrirCreacion(): void {
  errorDeDialogo.value = null;
  creando.value = true;
}

function abrirRenombrado(peticion: Peticion): void {
  errorDeDialogo.value = null;
  aRenombrar.value = peticion;
}

function abrirBorrado(peticion: Peticion): void {
  errorDeDialogo.value = null;
  aBorrar.value = peticion;
}

function cerrarDialogos(): void {
  creando.value = false;
  aRenombrar.value = null;
  aBorrar.value = null;
  compartiendo.value = false;
  errorDeDialogo.value = null;
}

async function crear(datos: DatosDePeticion): Promise<void> {
  const creada = await almacen.crear(props.collectionId, {
    name: datos.name,
    method: datos.method,
    methodCustom: datos.methodCustom,
    url: datos.url,
    description: datos.description,
    bodyType: datos.bodyType,
    folderId: null,
  });
  if (creada === null) {
    errorDeDialogo.value = almacen.error;
    return;
  }
  cerrarDialogos();
}

async function renombrar(datos: DatosDePeticion): Promise<void> {
  const objetivo = aRenombrar.value;
  if (objetivo === null) return;
  const actualizada = await almacen.actualizar(objetivo.id, props.collectionId, {
    name: datos.name,
    method: datos.method,
    methodCustom: datos.methodCustom,
    url: datos.url,
    description: datos.description,
    bodyType: datos.bodyType,
  });
  if (actualizada === null) {
    errorDeDialogo.value = almacen.error;
    return;
  }
  cerrarDialogos();
}

async function duplicar(peticion: Peticion): Promise<void> {
  await almacen.duplicar(peticion.id, props.collectionId);
}

async function borrar(): Promise<void> {
  const objetivo = aBorrar.value;
  if (objetivo === null) return;
  const borrada = await almacen.borrar(objetivo.id, props.collectionId);
  if (!borrada) {
    errorDeDialogo.value = almacen.error;
    return;
  }
  cerrarDialogos();
}

/**
 * «Copiar como cURL». El comando lo genera `GET /requests/:id/curl`: el
 * servidor es el único que sabe qué cabecera es secreta. Aquí no se compone
 * nada, sólo se pide, se copia y se enseña lo que conteste —advertencias
 * incluidas—.
 */
async function copiarCurl(peticion: Peticion): Promise<void> {
  await almacen.copiarComoCurl(peticion.id, peticion.name);
}

async function recopiar(): Promise<void> {
  recopiando.value = true;
  try {
    await almacen.recopiarCurl();
  } finally {
    recopiando.value = false;
  }
}
</script>

<template>
  <section class="coleccion" aria-labelledby="titulo-coleccion">
    <nav class="coleccion__migas" aria-label="Ruta de navegación">
      <RouterLink :to="destinoDelWorkspace">← Volver al workspace</RouterLink>
    </nav>

    <header class="coleccion__cabecera">
      <div class="coleccion__identidad">
        <h1 id="titulo-coleccion">{{ coleccion?.name ?? 'Colección' }}</h1>
        <code class="coleccion__slug">{{ coleccion?.slug ?? collectionId }}</code>
        <p v-if="coleccion?.description" class="coleccion__descripcion">
          {{ coleccion.description }}
        </p>
      </div>
      <div class="coleccion__acciones">
        <!--
          P7: el icono de compartir, primera de las dos pulsaciones hasta tener
          el enlace en el portapapeles. Va **antes** de la acción principal
          para no empujarla fuera de la cabecera al envolver en pantallas
          estrechas.
        -->
        <BotonDeCompartir
          :nombre="`la colección ${coleccion?.name ?? 'actual'}`"
          @click="compartiendo = true"
        />
        <CeibaBoton variante="primario" @click="abrirCreacion">Nueva petición</CeibaBoton>
      </div>
    </header>

    <DialogoDeComparticion
      :abierto="compartiendo"
      tipo="coleccion"
      :recurso-id="collectionId"
      :nombre="coleccion?.name ?? 'esta colección'"
      @cerrar="cerrarDialogos"
    />

    <CeibaAviso v-if="errorDeColeccion" tono="aviso" titulo="Colección no disponible">
      {{ errorDeColeccion }}
      <p class="coleccion__reintento">
        <CeibaBoton
          compacto
          :cargando="cargandoColeccion"
          @click="cargarColeccion(collectionId)"
        >
          Reintentar
        </CeibaBoton>
      </p>
    </CeibaAviso>

    <CeibaAviso
      v-if="almacen.error && !creando && !aRenombrar && !aBorrar"
      tono="error"
      titulo="No se pudieron cargar las peticiones"
    >
      {{ almacen.error }}
      <p class="coleccion__reintento">
        <CeibaBoton compacto :cargando="almacen.cargando" @click="almacen.cargar(collectionId)">
          Reintentar
        </CeibaBoton>
      </p>
    </CeibaAviso>

    <CeibaAviso v-if="almacen.errorDeCurl" tono="error" titulo="No se pudo generar el cURL">
      {{ almacen.errorDeCurl }}
    </CeibaAviso>

    <h2 class="coleccion__seccion">
      Peticiones
      <span v-if="cargada" class="coleccion__cuenta">({{ lista.length }})</span>
    </h2>

    <div v-if="primeraCarga" class="coleccion__espera">
      <CeibaLoadingScreen
        inline
        message="Cargando peticiones…"
        :detail="`GET /api/v1/collections/${collectionId}/requests`"
      />
    </div>

    <CeibaVacio
      v-else-if="sinPeticiones"
      titulo="Esta colección todavía no tiene peticiones"
      detalle="Una petición es una llamada HTTP guardada: su método, su URL, sus cabeceras y su cuerpo. Al pulsarla se abre en el constructor."
    >
      <CeibaBoton variante="primario" @click="abrirCreacion">
        Crear la primera petición
      </CeibaBoton>
    </CeibaVacio>

    <div v-else-if="lista.length > 0" class="coleccion__grupos">
      <section
        v-for="grupo in grupos"
        :key="grupo.folderId ?? 'raiz'"
        class="coleccion__grupo"
        :aria-label="grupo.titulo"
      >
        <h3 v-if="grupos.length > 1" class="coleccion__carpeta">{{ grupo.titulo }}</h3>
        <ul class="coleccion__lista ceiba-panel">
          <FilaDePeticion
            v-for="peticion in grupo.peticiones"
            :key="peticion.id"
            :peticion="peticion"
            :generando-curl="almacen.generandoCurlDe === peticion.id"
            :ocupado="almacen.guardando"
            @renombrar="abrirRenombrado(peticion)"
            @duplicar="duplicar(peticion)"
            @borrar="abrirBorrado(peticion)"
            @curl="copiarCurl(peticion)"
          />
        </ul>
      </section>
    </div>

    <DialogoDePeticion
      :abierto="creando"
      titulo="Nueva petición"
      descripcion="La URL se guarda sin resolver: las variables se conservan tal cual."
      etiqueta-accion="Crear petición"
      :nota-de-rol="NOTA_DE_ROL"
      :guardando="almacen.guardando"
      :error-de-envio="errorDeDialogo"
      @cerrar="cerrarDialogos"
      @guardar="crear"
    />

    <DialogoDePeticion
      v-if="aRenombrar"
      :abierto="aRenombrar !== null"
      titulo="Editar petición"
      etiqueta-accion="Guardar cambios"
      :peticion-inicial="aRenombrar"
      :nota-de-rol="NOTA_DE_ROL"
      :guardando="almacen.guardando"
      :error-de-envio="errorDeDialogo"
      @cerrar="cerrarDialogos"
      @guardar="renombrar"
    />

    <DialogoDeBorrado
      v-if="aBorrar"
      :abierto="aBorrar !== null"
      titulo="Borrar petición"
      :nombre="aBorrar.name"
      :identificador="aBorrar.id"
      consecuencia="El borrado es lógico: la petición deja de listarse."
      :nota-de-rol="NOTA_DE_ROL"
      :guardando="almacen.guardando"
      :error-de-envio="errorDeDialogo"
      @cerrar="cerrarDialogos"
      @confirmar="borrar"
    />

    <DialogoDeCurl
      v-if="almacen.curl"
      :estado="almacen.curl"
      :recopiando="recopiando"
      @cerrar="almacen.cerrarCurl()"
      @recopiar="recopiar"
    />
  </section>
</template>

<style scoped>
.coleccion {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-4);
  padding: var(--ceiba-space-5);
  max-width: 1100px;
  width: 100%;
  margin: 0 auto;
}

.coleccion__migas {
  font-size: var(--ceiba-text-sm);
}

.coleccion__cabecera {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ceiba-space-4);
  flex-wrap: wrap;
}

.coleccion__identidad {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
  min-width: 0;
}

.coleccion__acciones {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-2);
  flex-shrink: 0;
}

.coleccion__slug {
  color: var(--ceiba-text-faint);
  font-size: var(--ceiba-text-xs);
}

.coleccion__descripcion {
  margin-top: var(--ceiba-space-1);
  max-width: 62ch;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.coleccion__seccion {
  display: flex;
  align-items: baseline;
  gap: var(--ceiba-space-2);
  font-size: var(--ceiba-text-lg);
  border-bottom: 1px solid var(--ceiba-border);
  padding-bottom: var(--ceiba-space-2);
}

.coleccion__cuenta {
  font-size: var(--ceiba-text-sm);
  font-weight: 400;
  color: var(--ceiba-text-faint);
}

.coleccion__reintento {
  margin-top: var(--ceiba-space-2);
}

.coleccion__espera {
  position: relative;
  min-height: 200px;
}

.coleccion__grupos {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-4);
}

.coleccion__carpeta {
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
  margin-bottom: var(--ceiba-space-2);
}

.coleccion__lista {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: hidden;
}

@media (max-width: 600px) {
  .coleccion {
    padding: var(--ceiba-space-4) var(--ceiba-space-3);
  }
}
</style>
