<script setup lang="ts">
/**
 * Pantalla de un workspace: su cabecera y sus colecciones.
 *
 * El `workspaceId` llega por `props` (la ruta declara `props: true`), no
 * leyendo `useRoute()`. Así el componente es montable en una prueba sin
 * instalar un router entero, que es exactamente lo que hace
 * `test/colecciones.test.ts`.
 *
 * Por qué pide **las dos** cosas al montar:
 *  - `GET /workspaces` si la lista no estaba cargada, para poder pintar el
 *    nombre del workspace al entrar directamente por URL. La API no ofrece
 *    nada más barato que esto para un acceso en frío y `listarDeUsuario` ya
 *    devuelve todos los workspaces con membresía activa.
 *  - `GET /workspaces/:id/collections` siempre, porque es el contenido.
 *
 * Si el workspace no aparece en la lista, puede ser que no exista o que el
 * usuario no tenga membresía: la interfaz **no distingue** entre las dos cosas
 * ni lo intenta. Quien decide es el servidor, y no filtrar esa diferencia es
 * justamente lo correcto (§19).
 */
import { computed, inject, onMounted, ref, watch } from 'vue';
import { routerKey } from 'vue-router';
import { CeibaLoadingScreen } from '@ceiba/brand';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import CeibaVacio from '@/components/ui/CeibaVacio.vue';
import DialogoDeBorrado from '@/components/workspaces/DialogoDeBorrado.vue';
import DialogoDeCreacion from '@/components/workspaces/DialogoDeCreacion.vue';
import DialogoDeRenombrado from '@/components/workspaces/DialogoDeRenombrado.vue';
import FilaDeColeccion from '@/components/workspaces/FilaDeColeccion.vue';
import { usarAlmacenDeColecciones } from '@/stores/colecciones';
import { usarAlmacenDeWorkspaces } from '@/stores/workspaces';
// Desde `router/nombres.ts`, que es una hoja sin imports: `router/rutas.ts`
// arrastraría los `import()` diferidos de todas las vistas.
import { RUTA_COLECCION, RUTA_WORKSPACES } from '@/router/nombres';
import type { Coleccion } from '@/api/tipos';

/** Tope de `description` en `esquemaCrearColeccion`. */
const MAXIMO_DESCRIPCION = 4000;
const NOTA_DE_ROL = 'El servidor exige rol «editor» en este workspace para esta operación.';

const props = defineProps<{ workspaceId: string }>();

const workspaces = usarAlmacenDeWorkspaces();
const almacen = usarAlmacenDeColecciones();

/**
 * El router, inyectado **con valor por defecto `null`**.
 *
 * No se usa `useRouter()` porque ese ayudante hace `inject(routerKey)` sin
 * defecto, y este componente se monta a propósito sin router en
 * `test/colecciones.test.ts`. Sin el defecto, Vue emite un aviso de inyección
 * no encontrada en cada montaje de esa prueba. Con él, la navegación
 * simplemente no ocurre fuera de la aplicación, que es lo correcto.
 */
const enrutador = inject(routerKey, null);

const creando = ref(false);
const aRenombrar = ref<Coleccion | null>(null);
const aBorrar = ref<Coleccion | null>(null);
const errorDeDialogo = ref<string | null>(null);

const workspace = computed(() => workspaces.porId(props.workspaceId));
const lista = computed(() => almacen.deWorkspace(props.workspaceId));
const cargada = computed(() => almacen.cargada(props.workspaceId));
const primeraCarga = computed(() => almacen.cargando && !cargada.value);
const sinColecciones = computed(() => almacen.estaVacia(props.workspaceId));

/** El workspace no está entre los del usuario y la lista ya se consultó. */
const workspaceDesconocido = computed(
  () => workspaces.cargada && workspace.value === null && !workspaces.cargando,
);

async function cargarTodo(): Promise<void> {
  if (!workspaces.cargada) await workspaces.cargar();
  await almacen.cargar(props.workspaceId);
}

onMounted(() => {
  void cargarTodo();
});

// Navegar de un workspace a otro reutiliza el componente: sin esto, la segunda
// pantalla mostraría las colecciones de la primera.
watch(
  () => props.workspaceId,
  (nuevo, anterior) => {
    if (nuevo === anterior) return;
    cerrarDialogos();
    void almacen.cargar(nuevo);
  },
);

function abrirCreacion(): void {
  errorDeDialogo.value = null;
  creando.value = true;
}

/**
 * Abre la colección y enseña sus peticiones.
 *
 * Hasta la fase 6 esto no existía y la colección quedaba muerta: el cliente
 * reportó exactamente eso. Ver la nota de `FilaDeColeccion.vue` sobre por qué
 * es navegación programática y no un `RouterLink`.
 */
function abrirColeccion(coleccion: Coleccion): void {
  void enrutador?.push({ name: RUTA_COLECCION, params: { collectionId: coleccion.id } });
}

function abrirRenombrado(coleccion: Coleccion): void {
  errorDeDialogo.value = null;
  aRenombrar.value = coleccion;
}

function abrirBorrado(coleccion: Coleccion): void {
  errorDeDialogo.value = null;
  aBorrar.value = coleccion;
}

function cerrarDialogos(): void {
  creando.value = false;
  aRenombrar.value = null;
  aBorrar.value = null;
  errorDeDialogo.value = null;
}

async function crear(datos: {
  slug: string;
  name: string;
  description: string | null;
}): Promise<void> {
  const creada = await almacen.crear(props.workspaceId, datos);
  if (creada === null) {
    errorDeDialogo.value = almacen.error;
    return;
  }
  cerrarDialogos();
}

async function renombrar(datos: { name: string; description: string | null }): Promise<void> {
  const objetivo = aRenombrar.value;
  if (objetivo === null) return;
  // `PATCH /collections/:id`: el `workspaceId` no viaja, sirve para refrescar
  // el índice local (ver `stores/colecciones.ts`).
  const actualizada = await almacen.renombrar(objetivo.id, props.workspaceId, datos);
  if (actualizada === null) {
    errorDeDialogo.value = almacen.error;
    return;
  }
  cerrarDialogos();
}

async function borrar(): Promise<void> {
  const objetivo = aBorrar.value;
  if (objetivo === null) return;
  const borrada = await almacen.borrar(objetivo.id, props.workspaceId);
  if (!borrada) {
    errorDeDialogo.value = almacen.error;
    return;
  }
  cerrarDialogos();
}
</script>

<template>
  <section class="detalle" aria-labelledby="titulo-workspace">
    <nav class="detalle__migas" aria-label="Ruta de navegación">
      <RouterLink :to="{ name: RUTA_WORKSPACES }">← Todos los workspaces</RouterLink>
    </nav>

    <header class="detalle__cabecera">
      <div class="detalle__identidad">
        <h1 id="titulo-workspace">{{ workspace?.name ?? 'Workspace' }}</h1>
        <code class="detalle__slug">{{ workspace?.slug ?? workspaceId }}</code>
        <p v-if="workspace?.description" class="detalle__descripcion">
          {{ workspace.description }}
        </p>
      </div>
      <CeibaBoton variante="primario" @click="abrirCreacion">Nueva colección</CeibaBoton>
    </header>

    <CeibaAviso v-if="workspaceDesconocido" tono="aviso" titulo="Workspace no disponible">
      No aparece entre tus workspaces. Puede que no exista o que ya no tengas membresía en él.
    </CeibaAviso>

    <CeibaAviso v-if="almacen.error && !creando && !aRenombrar && !aBorrar" tono="error"
                titulo="Algo ha fallado">
      {{ almacen.error }}
      <p class="detalle__reintento">
        <CeibaBoton compacto :cargando="almacen.cargando" @click="almacen.cargar(workspaceId)">
          Reintentar
        </CeibaBoton>
      </p>
    </CeibaAviso>

    <h2 class="detalle__seccion">
      Colecciones
      <span v-if="cargada" class="detalle__cuenta">({{ lista.length }})</span>
    </h2>

    <div v-if="primeraCarga" class="detalle__cargando">
      <CeibaLoadingScreen
        inline
        message="Cargando colecciones…"
        :detail="`GET /api/v1/workspaces/${workspaceId}/collections`"
      />
    </div>

    <CeibaVacio
      v-else-if="sinColecciones"
      titulo="Este workspace no tiene colecciones"
      detalle="Una colección agrupa peticiones relacionadas: una API, un flujo, un servicio."
    >
      <CeibaBoton variante="primario" @click="abrirCreacion">Crear colección</CeibaBoton>
    </CeibaVacio>

    <ul v-else-if="lista.length > 0" class="detalle__lista ceiba-panel">
      <FilaDeColeccion
        v-for="coleccion in lista"
        :key="coleccion.id"
        :coleccion="coleccion"
        @abrir="abrirColeccion(coleccion)"
        @renombrar="abrirRenombrado(coleccion)"
        @borrar="abrirBorrado(coleccion)"
      />
    </ul>

    <DialogoDeCreacion
      :abierto="creando"
      titulo="Nueva colección"
      descripcion="El identificador se usa en las URLs y no cambia al renombrar la colección."
      etiqueta-nombre="Nombre de la colección"
      etiqueta-accion="Crear colección"
      ayuda-slug="Minúsculas, dígitos y guiones. Único dentro del workspace."
      :maximo-descripcion="MAXIMO_DESCRIPCION"
      :guardando="almacen.guardando"
      :error-de-envio="errorDeDialogo"
      @cerrar="cerrarDialogos"
      @crear="crear"
    />

    <DialogoDeRenombrado
      v-if="aRenombrar"
      :abierto="aRenombrar !== null"
      titulo="Renombrar colección"
      :nombre-inicial="aRenombrar.name"
      :descripcion-inicial="aRenombrar.description"
      :nota-de-rol="NOTA_DE_ROL"
      :maximo-descripcion="MAXIMO_DESCRIPCION"
      :guardando="almacen.guardando"
      :error-de-envio="errorDeDialogo"
      @cerrar="cerrarDialogos"
      @guardar="renombrar"
    />

    <DialogoDeBorrado
      v-if="aBorrar"
      :abierto="aBorrar !== null"
      titulo="Borrar colección"
      :nombre="aBorrar.name"
      :identificador="aBorrar.slug"
      consecuencia="Se borrarán también las peticiones y carpetas que contenga."
      :nota-de-rol="NOTA_DE_ROL"
      :guardando="almacen.guardando"
      :error-de-envio="errorDeDialogo"
      @cerrar="cerrarDialogos"
      @confirmar="borrar"
    />
  </section>
</template>

<style scoped>
.detalle {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-4);
  padding: var(--ceiba-space-5);
  max-width: 1100px;
  width: 100%;
  margin: 0 auto;
}

.detalle__migas {
  font-size: var(--ceiba-text-sm);
}

.detalle__cabecera {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ceiba-space-4);
  flex-wrap: wrap;
}

.detalle__identidad {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
  min-width: 0;
}

.detalle__slug {
  color: var(--ceiba-text-faint);
  font-size: var(--ceiba-text-xs);
}

.detalle__descripcion {
  margin-top: var(--ceiba-space-1);
  max-width: 62ch;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.detalle__seccion {
  display: flex;
  align-items: baseline;
  gap: var(--ceiba-space-2);
  font-size: var(--ceiba-text-lg);
  border-bottom: 1px solid var(--ceiba-border);
  padding-bottom: var(--ceiba-space-2);
}

.detalle__cuenta {
  font-size: var(--ceiba-text-sm);
  font-weight: 400;
  color: var(--ceiba-text-faint);
}

.detalle__reintento {
  margin-top: var(--ceiba-space-2);
}

.detalle__cargando {
  position: relative;
  min-height: 200px;
}

.detalle__lista {
  margin: 0;
  padding: 0;
  list-style: none;
  overflow: hidden;
}

@media (max-width: 600px) {
  .detalle {
    padding: var(--ceiba-space-4) var(--ceiba-space-3);
  }
}
</style>
