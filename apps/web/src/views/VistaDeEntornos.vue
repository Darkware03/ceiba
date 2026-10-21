<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import {
  actualizarEntorno,
  crearEntorno,
  eliminarEntorno,
  listarEntornos,
  obtenerConfiguracionWorkspace,
  type EntornoDeWorkspace,
  type VariableDeEntorno,
} from '@/api/studio';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import CeibaCampo from '@/components/ui/CeibaCampo.vue';
import CeibaVacio from '@/components/ui/CeibaVacio.vue';
import { usarAlmacenWorkspaces } from '@/stores/workspaces';

const almacenWorkspaces = usarAlmacenWorkspaces();

const workspaceId = ref('');
const entornos = ref<EntornoDeWorkspace[]>([]);
const entornoActivoId = ref<string | null>(null);
const puedeEditar = ref(true);
const cargando = ref(false);
const guardando = ref(false);
const errorMensaje = ref<string | null>(null);
const exitoMensaje = ref<string | null>(null);

const nuevoNombre = ref('');
const nuevaDescripcion = ref('');

const nombreEdicion = ref('');
const descripcionEdicion = ref('');
const esPredeterminadoEdicion = ref(false);
const variablesEdicion = ref<VariableDeEntorno[]>([]);

const entornoActivo = computed(
  () => entornos.value.find((e) => e.id === entornoActivoId.value) ?? null,
);

function sincronizarFormulario(entorno: EntornoDeWorkspace | null): void {
  if (!entorno) {
    nombreEdicion.value = '';
    descripcionEdicion.value = '';
    esPredeterminadoEdicion.value = false;
    variablesEdicion.value = [];
    return;
  }
  nombreEdicion.value = entorno.name;
  descripcionEdicion.value = entorno.description ?? '';
  esPredeterminadoEdicion.value = entorno.isDefault;
  variablesEdicion.value = entorno.variables.map((v) => ({
    key: v.key,
    value: v.value ?? '',
    description: v.description ?? '',
    enabled: v.enabled !== false,
    isSecret: v.isSecret === true,
  }));
}

async function cargarEntornos(): Promise<void> {
  if (!workspaceId.value) return;
  cargando.value = true;
  errorMensaje.value = null;
  try {
    const [resEntornos, config] = await Promise.all([
      listarEntornos(workspaceId.value),
      obtenerConfiguracionWorkspace(workspaceId.value),
    ]);
    entornos.value = resEntornos.items;
    puedeEditar.value = config.canEdit;
    if (!entornoActivoId.value || !entornos.value.some((e) => e.id === entornoActivoId.value)) {
      entornoActivoId.value = entornos.value[0]?.id ?? null;
    }
    sincronizarFormulario(entornoActivo.value);
  } catch (err) {
    errorMensaje.value = err instanceof Error ? err.message : 'Error al cargar entornos.';
  } finally {
    cargando.value = false;
  }
}

async function manejarCrearEntorno(): Promise<void> {
  if (!workspaceId.value || !nuevoNombre.value.trim()) return;
  guardando.value = true;
  errorMensaje.value = null;
  exitoMensaje.value = null;
  try {
    const creado = await crearEntorno(workspaceId.value, {
      name: nuevoNombre.value.trim(),
      description: nuevaDescripcion.value.trim() || undefined,
      isDefault: entornos.value.length === 0,
      variables: [{ key: 'BASE_URL', value: 'https://localhost:8443', enabled: true }],
    });
    nuevoNombre.value = '';
    nuevaDescripcion.value = '';
    await cargarEntornos();
    entornoActivoId.value = creado.id;
    sincronizarFormulario(creado);
    exitoMensaje.value = `Entorno «${creado.name}» creado y registrado en el historial.`;
  } catch (err) {
    errorMensaje.value = err instanceof Error ? err.message : 'No se pudo crear el entorno.';
  } finally {
    guardando.value = false;
  }
}

function agregarFilaVariable(): void {
  variablesEdicion.value.push({
    key: '',
    value: '',
    description: '',
    enabled: true,
    isSecret: false,
  });
}

function quitarFilaVariable(idx: number): void {
  variablesEdicion.value.splice(idx, 1);
}

async function guardarCambiosEntorno(): Promise<void> {
  if (!workspaceId.value || !entornoActivoId.value) return;
  guardando.value = true;
  errorMensaje.value = null;
  exitoMensaje.value = null;
  try {
    const actualizado = await actualizarEntorno(workspaceId.value, entornoActivoId.value, {
      name: nombreEdicion.value.trim(),
      description: descripcionEdicion.value.trim() || null,
      isDefault: esPredeterminadoEdicion.value,
      variables: variablesEdicion.value.filter((v) => v.key.trim().length > 0),
    });
    await cargarEntornos();
    entornoActivoId.value = actualizado.id;
    sincronizarFormulario(actualizado);
    exitoMensaje.value = 'Entorno actualizado y guardado en el historial de modificaciones.';
  } catch (err) {
    errorMensaje.value = err instanceof Error ? err.message : 'No se pudo actualizar el entorno.';
  } finally {
    guardando.value = false;
  }
}

async function manejarEliminarEntorno(id: string): Promise<void> {
  if (!workspaceId.value) return;
  guardando.value = true;
  errorMensaje.value = null;
  try {
    await eliminarEntorno(workspaceId.value, id);
    if (entornoActivoId.value === id) {
      entornoActivoId.value = null;
    }
    await cargarEntornos();
    exitoMensaje.value = 'Entorno eliminado.';
  } catch (err) {
    errorMensaje.value = err instanceof Error ? err.message : 'No se pudo eliminar el entorno.';
  } finally {
    guardando.value = false;
  }
}

watch(workspaceId, () => {
  entornoActivoId.value = null;
  void cargarEntornos();
});

watch(entornoActivoId, () => {
  sincronizarFormulario(entornoActivo.value);
});

onMounted(async () => {
  if (almacenWorkspaces.lista.length === 0) {
    await almacenWorkspaces.cargarLista();
  }
  workspaceId.value = almacenWorkspaces.actual?.id ?? almacenWorkspaces.lista[0]?.id ?? '';
});
</script>

<template>
  <section class="ceiba-pagina">
    <header class="ceiba-pagina__cabecera">
      <div>
        <h1 class="ceiba-pagina__titulo">Entornos y variables</h1>
        <p class="ceiba-pagina__subtitulo">
          Define variables reutilizables como <code v-pre>{{BASE_URL}}</code> o <code v-pre>{{API_KEY}}</code> para interpolarlas en el Constructor y en las ejecuciones de colecciones.
        </p>
      </div>
      <label class="ceiba-selector-inline">
        <span>Workspace:</span>
        <select v-model="workspaceId" class="ceiba-select">
          <option v-for="ws in almacenWorkspaces.lista" :key="ws.id" :value="ws.id">
            {{ ws.name }}
          </option>
        </select>
      </label>
    </header>

    <CeibaAviso
      v-if="!puedeEditar"
      tipo="info"
      titulo="Modo Solo mostrar (Lector): puedes consultar los entornos pero no modificarlos."
    />
    <CeibaAviso v-if="errorMensaje" tipo="error" :titulo="errorMensaje" />
    <CeibaAviso v-if="exitoMensaje" tipo="exito" :titulo="exitoMensaje" />

    <div class="ceiba-layout-entornos">
      <!-- Columna izquierda: lista y alta de entorno -->
      <aside class="ceiba-panel-lista">
        <h2 class="ceiba-subtitulo-panel">Entornos del workspace</h2>

        <form v-if="puedeEditar" class="ceiba-form-nuevo" @submit.prevent="manejarCrearEntorno">
          <CeibaCampo
            id="nuevo-entorno-nombre"
            v-model="nuevoNombre"
            etiqueta="Nuevo entorno"
            placeholder="Ej. Desarrollo, Staging, Producción"
            obligatorio
          />
          <CeibaCampo
            id="nuevo-entorno-desc"
            v-model="nuevaDescripcion"
            etiqueta="Descripción (opcional)"
            placeholder="Variables para pruebas locales"
          />
          <CeibaBoton tipo="submit" variante="primario" :cargando="guardando">
            Crear entorno
          </CeibaBoton>
        </form>

        <ul v-if="entornos.length > 0" class="ceiba-lista-entornos">
          <li
            v-for="env in entornos"
            :key="env.id"
            class="ceiba-item-entorno"
            :class="{ 'ceiba-item-entorno--activo': env.id === entornoActivoId }"
            @click="entornoActivoId = env.id"
          >
            <div>
              <strong>{{ env.name }}</strong>
              <span v-if="env.isDefault" class="ceiba-insignia">Predeterminado</span>
              <div class="ceiba-meta">{{ env.variables.length }} variable(s)</div>
            </div>
          </li>
        </ul>
        <CeibaVacio
          v-else-if="!cargando"
          titulo="Sin entornos creados"
          descripcion="Crea tu primer entorno para parametrizar URLs y cabeceras."
        />
      </aside>

      <!-- Columna derecha: editor de variables -->
      <div class="ceiba-panel-editor">
        <template v-if="entornoActivo">
          <div class="ceiba-editor-cabecera">
            <div class="ceiba-campos-entorno">
              <CeibaCampo
                id="editar-entorno-nombre"
                v-model="nombreEdicion"
                etiqueta="Nombre del entorno"
                :deshabilitado="!puedeEditar"
              />
              <CeibaCampo
                id="editar-entorno-desc"
                v-model="descripcionEdicion"
                etiqueta="Descripción"
                :deshabilitado="!puedeEditar"
              />
              <label class="ceiba-check">
                <input
                  v-model="esPredeterminadoEdicion"
                  type="checkbox"
                  :disabled="!puedeEditar"
                />
                <span>Usar como entorno predeterminado del workspace</span>
              </label>
            </div>
            <div v-if="puedeEditar" class="ceiba-acciones-entorno">
              <CeibaBoton variante="primario" :cargando="guardando" @click="guardarCambiosEntorno">
                Guardar cambios
              </CeibaBoton>
              <CeibaBoton
                variante="peligro"
                :cargando="guardando"
                @click="manejarEliminarEntorno(entornoActivo.id)"
              >
                Eliminar
              </CeibaBoton>
            </div>
          </div>

          <div class="ceiba-variables-cabecera">
            <h3>Variables (<code v-pre>{{clave}}</code>)</h3>
            <CeibaBoton
              v-if="puedeEditar"
              variante="secundario"
              tamano="sm"
              @click="agregarFilaVariable"
            >
              + Añadir variable
            </CeibaBoton>
          </div>

          <table class="ceiba-tabla-vars">
            <thead>
              <tr>
                <th>Activa</th>
                <th>Clave</th>
                <th>Valor</th>
                <th>Descripción</th>
                <th v-if="puedeEditar"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(v, idx) in variablesEdicion" :key="idx">
                <td>
                  <input v-model="v.enabled" type="checkbox" :disabled="!puedeEditar" />
                </td>
                <td>
                  <input
                    v-model="v.key"
                    class="ceiba-input-celda ceiba-mono"
                    placeholder="BASE_URL"
                    :disabled="!puedeEditar"
                  />
                </td>
                <td>
                  <input
                    v-model="v.value"
                    class="ceiba-input-celda ceiba-mono"
                    placeholder="https://api.ejemplo.com"
                    :disabled="!puedeEditar"
                  />
                </td>
                <td>
                  <input
                    v-model="v.description"
                    class="ceiba-input-celda"
                    placeholder="Descripción opcional"
                    :disabled="!puedeEditar"
                  />
                </td>
                <td v-if="puedeEditar">
                  <CeibaBoton
                    variante="fantasma"
                    tamano="sm"
                    @click="quitarFilaVariable(idx)"
                  >
                    Quitar
                  </CeibaBoton>
                </td>
              </tr>
            </tbody>
          </table>
        </template>

        <CeibaVacio
          v-else
          titulo="Selecciona o crea un entorno"
          descripcion="Elige un entorno de la columna izquierda para administrar sus variables."
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.ceiba-pagina {
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-espacio-5);
}
.ceiba-pagina__cabecera {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--ceiba-espacio-4);
  flex-wrap: wrap;
}
.ceiba-pagina__titulo {
  margin: 0;
  font-size: var(--ceiba-tamano-h1);
  font-weight: var(--ceiba-peso-negrita);
}
.ceiba-pagina__subtitulo {
  margin: 4px 0 0;
  color: var(--text-secondary);
}
.ceiba-selector-inline {
  display: flex;
  align-items: center;
  gap: var(--ceiba-espacio-2);
}
.ceiba-select {
  padding: 6px 10px;
  border-radius: var(--ceiba-radio-sm);
  border: 1px solid var(--border-default);
  background: var(--bg-surface);
  color: var(--text-primary);
}
.ceiba-layout-entornos {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: var(--ceiba-espacio-5);
  align-items: start;
}
.ceiba-panel-lista,
.ceiba-panel-editor {
  padding: var(--ceiba-espacio-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--ceiba-radio-md);
  background: var(--bg-surface);
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-espacio-4);
}
.ceiba-subtitulo-panel {
  margin: 0;
  font-size: var(--ceiba-tamano-h2);
}
.ceiba-form-nuevo {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-espacio-3);
  padding-bottom: var(--ceiba-espacio-3);
  border-bottom: 1px solid var(--border-subtle);
}
.ceiba-lista-entornos {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ceiba-item-entorno {
  padding: 10px 12px;
  border-radius: var(--ceiba-radio-sm);
  border: 1px solid var(--border-subtle);
  cursor: pointer;
}
.ceiba-item-entorno--activo {
  border-color: var(--brand-primary);
  background: var(--brand-primary-subtle);
}
.ceiba-insignia {
  margin-left: 8px;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--bg-raised);
}
.ceiba-meta {
  font-size: 12px;
  color: var(--text-muted);
}
.ceiba-editor-cabecera {
  display: flex;
  justify-content: space-between;
  gap: var(--ceiba-espacio-4);
  flex-wrap: wrap;
}
.ceiba-campos-entorno {
  flex: 1;
  min-width: 260px;
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-espacio-3);
}
.ceiba-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.ceiba-acciones-entorno {
  display: flex;
  gap: var(--ceiba-espacio-2);
  align-items: flex-start;
}
.ceiba-variables-cabecera {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.ceiba-tabla-vars {
  width: 100%;
  border-collapse: collapse;
}
.ceiba-tabla-vars th,
.ceiba-tabla-vars td {
  padding: 8px;
  border-bottom: 1px solid var(--border-subtle);
  text-align: left;
}
.ceiba-input-celda {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border-default);
  border-radius: var(--ceiba-radio-sm);
  background: var(--bg-base);
  color: var(--text-primary);
}
.ceiba-mono {
  font-family: var(--ceiba-fuente-mono);
}
</style>
