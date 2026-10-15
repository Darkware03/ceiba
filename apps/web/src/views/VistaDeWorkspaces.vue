<script setup lang="ts">
/**
 * Pantalla «Workspaces»: lista, creación, renombrado y borrado.
 *
 * Los cuatro estados que §18 exige están separados y no se pisan:
 *
 *  - **cargando** (primera carga): `CeibaLoadingScreen` en modo `inline`, que
 *    es el giro de la marca de `packages/brand`. No hay ningún indicador de
 *    carga propio en esta aplicación, a propósito.
 *  - **error**: `CeibaAviso` con el mensaje de la API y un botón de reintento.
 *    El error no sustituye a la lista: si ya había datos, se siguen viendo.
 *  - **vacío confirmado**: `CeibaVacio` con la acción principal dentro.
 *  - **con datos**: la rejilla de tarjetas.
 *
 * Sobre autorización: el servidor exige `admin` para renombrar y `owner` para
 * borrar (ADR-0009 §7.5). Aquí los dos botones se muestran **siempre y
 * habilitados**, y el diálogo avisa del rol que hace falta. Deshabilitarlos
 * según un rol adivinado en el cliente daría la falsa impresión de que la
 * interfaz protege algo: quien decide es la API, que responderá 403.
 */
import { computed, onMounted, ref } from 'vue';
import { CeibaLoadingScreen } from '@ceiba/brand';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import CeibaVacio from '@/components/ui/CeibaVacio.vue';
import DialogoDeBorrado from '@/components/workspaces/DialogoDeBorrado.vue';
import DialogoDeCreacion from '@/components/workspaces/DialogoDeCreacion.vue';
import DialogoDeRenombrado from '@/components/workspaces/DialogoDeRenombrado.vue';
import TarjetaDeWorkspace from '@/components/workspaces/TarjetaDeWorkspace.vue';
import { usarAlmacenDeColecciones } from '@/stores/colecciones';
import { usarAlmacenDeWorkspaces } from '@/stores/workspaces';
import type { Workspace } from '@/api/tipos';

/** Tope de `description` en `esquemaCrearWorkspace`. */
const MAXIMO_DESCRIPCION = 2000;

const almacen = usarAlmacenDeWorkspaces();
const colecciones = usarAlmacenDeColecciones();

const creando = ref(false);
const aRenombrar = ref<Workspace | null>(null);
const aBorrar = ref<Workspace | null>(null);
/** Error de la última operación del diálogo abierto. */
const errorDeDialogo = ref<string | null>(null);

const primeraCarga = computed(() => almacen.cargando && !almacen.cargada);

onMounted(() => {
  void almacen.cargar();
});

function abrirCreacion(): void {
  errorDeDialogo.value = null;
  creando.value = true;
}

function abrirRenombrado(workspace: Workspace): void {
  errorDeDialogo.value = null;
  aRenombrar.value = workspace;
}

function abrirBorrado(workspace: Workspace): void {
  errorDeDialogo.value = null;
  aBorrar.value = workspace;
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
  const creado = await almacen.crear(datos);
  if (creado === null) {
    // El diálogo sigue abierto con lo escrito: volver a teclearlo todo porque
    // el slug estaba repetido sería castigar al usuario por un 409.
    errorDeDialogo.value = almacen.error;
    return;
  }
  cerrarDialogos();
}

async function renombrar(datos: { name: string; description: string | null }): Promise<void> {
  const objetivo = aRenombrar.value;
  if (objetivo === null) return;
  const actualizado = await almacen.renombrar(objetivo.id, datos);
  if (actualizado === null) {
    errorDeDialogo.value = almacen.error;
    return;
  }
  cerrarDialogos();
}

async function borrar(): Promise<void> {
  const objetivo = aBorrar.value;
  if (objetivo === null) return;
  const borrado = await almacen.borrar(objetivo.id);
  if (!borrado) {
    errorDeDialogo.value = almacen.error;
    return;
  }
  // Las colecciones de ese workspace dejan de existir: quitarlas del índice
  // evita enseñar datos de un workspace borrado si se vuelve a su URL.
  colecciones.olvidar(objetivo.id);
  cerrarDialogos();
}
</script>

<template>
  <section class="workspaces" aria-labelledby="titulo-workspaces">
    <header class="workspaces__cabecera">
      <div>
        <h1 id="titulo-workspaces">Workspaces</h1>
        <p class="workspaces__subtitulo">
          Cada workspace agrupa colecciones, entornos y miembros. Sólo ves aquellos en los que
          tienes membresía activa.
        </p>
      </div>
      <CeibaBoton variante="primario" @click="abrirCreacion">Nuevo workspace</CeibaBoton>
    </header>

    <CeibaAviso v-if="almacen.error && !creando && !aRenombrar && !aBorrar" tono="error"
                titulo="Algo ha fallado">
      {{ almacen.error }}
      <p class="workspaces__reintento">
        <CeibaBoton compacto :cargando="almacen.cargando" @click="almacen.cargar()">
          Reintentar
        </CeibaBoton>
      </p>
    </CeibaAviso>

    <div v-if="primeraCarga" class="workspaces__cargando">
      <CeibaLoadingScreen inline message="Cargando workspaces…" detail="GET /api/v1/workspaces" />
    </div>

    <CeibaVacio
      v-else-if="almacen.estaVacia"
      titulo="Todavía no hay ningún workspace"
      detalle="Crea el primero para empezar a guardar colecciones de peticiones."
    >
      <CeibaBoton variante="primario" @click="abrirCreacion">Crear el primero</CeibaBoton>
    </CeibaVacio>

    <ul v-else class="workspaces__rejilla">
      <TarjetaDeWorkspace
        v-for="workspace in almacen.lista"
        :key="workspace.id"
        :workspace="workspace"
        @renombrar="abrirRenombrado(workspace)"
        @borrar="abrirBorrado(workspace)"
      />
    </ul>

    <DialogoDeCreacion
      :abierto="creando"
      titulo="Nuevo workspace"
      descripcion="El identificador se usa en las URLs y no cambia al renombrar el workspace."
      etiqueta-nombre="Nombre del workspace"
      etiqueta-accion="Crear workspace"
      :maximo-descripcion="MAXIMO_DESCRIPCION"
      :guardando="almacen.guardando"
      :error-de-envio="errorDeDialogo"
      @cerrar="cerrarDialogos"
      @crear="crear"
    />

    <DialogoDeRenombrado
      v-if="aRenombrar"
      :abierto="aRenombrar !== null"
      titulo="Renombrar workspace"
      :nombre-inicial="aRenombrar.name"
      :descripcion-inicial="aRenombrar.description"
      nota-de-rol="El servidor exige rol «admin» en este workspace para cambiar sus ajustes."
      :maximo-descripcion="MAXIMO_DESCRIPCION"
      :guardando="almacen.guardando"
      :error-de-envio="errorDeDialogo"
      @cerrar="cerrarDialogos"
      @guardar="renombrar"
    />

    <DialogoDeBorrado
      v-if="aBorrar"
      :abierto="aBorrar !== null"
      titulo="Borrar workspace"
      :nombre="aBorrar.name"
      :identificador="aBorrar.slug"
      consecuencia="Se borrarán también sus colecciones y la membresía de todos sus miembros."
      nota-de-rol="El servidor exige rol «owner» para borrar un workspace."
      exigir-tecleo
      :guardando="almacen.guardando"
      :error-de-envio="errorDeDialogo"
      @cerrar="cerrarDialogos"
      @confirmar="borrar"
    />
  </section>
</template>

<style scoped>
.workspaces {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-5);
  padding: var(--ceiba-space-5);
  max-width: 1100px;
  width: 100%;
  margin: 0 auto;
}

.workspaces__cabecera {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ceiba-space-4);
  flex-wrap: wrap;
}

.workspaces__subtitulo {
  margin-top: var(--ceiba-space-2);
  max-width: 62ch;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.workspaces__reintento {
  margin-top: var(--ceiba-space-2);
}

.workspaces__cargando {
  position: relative;
  min-height: 220px;
}

.workspaces__rejilla {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--ceiba-space-4);
  margin: 0;
  padding: 0;
  list-style: none;
}

@media (max-width: 600px) {
  .workspaces {
    padding: var(--ceiba-space-4) var(--ceiba-space-3);
  }

  .workspaces__rejilla {
    grid-template-columns: 1fr;
  }
}
</style>
