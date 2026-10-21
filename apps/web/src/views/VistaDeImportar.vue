<script setup lang="ts">
/**
 * Portabilidad de colecciones: importar y exportar JSON.
 *
 * Tres cosas que esta vista hace a propósito y conviene dejar escritas:
 *
 *  1. **La importación es la espera larga típica** de la aplicación (crea
 *     carpetas y peticiones una a una en el servidor). Por eso no basta el
 *     giro del botón: el panel entero se cubre con `CeibaLoadingScreen inline`
 *     (BRIEF-FASE4 §2.2.3), que es el logo de la marca girando.
 *
 *  2. **Ningún `fetch` sale de aquí.** Todo pasa por `@/api/studio`, que es
 *     quien pone la cookie y el testigo CSRF.
 *
 *  3. **El rol no se usa como control de acceso**, sólo para no ofrecer un
 *     botón que la API va a rechazar con 403. La autorización real la hace el
 *     servidor en cada petición.
 */
import { computed, onMounted, ref, useId, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { CeibaLoadingScreen, CeibaSpinner } from '@ceiba/brand';

import { mensajeDeError } from '@/api/errores';
import { exportarColeccion, importarColeccion } from '@/api/studio';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import CeibaCampo from '@/components/ui/CeibaCampo.vue';
import CeibaVacio from '@/components/ui/CeibaVacio.vue';
import { NOMBRES_RUTAS } from '@/router/nombres';
import { usarAlmacenDeColecciones } from '@/stores/colecciones';
import { usarAlmacenDeWorkspaces } from '@/stores/workspaces';

const route = useRoute();
const router = useRouter();
const almacenWorkspaces = usarAlmacenDeWorkspaces();
const almacenColecciones = usarAlmacenDeColecciones();

const idSelectorWorkspace = useId();
const idArchivo = useId();
const idSelectorColeccion = useId();

const workspaceId = ref('');
const coleccionId = ref('');
const jsonEntrada = ref('');
const jsonExportado = ref('');

const importando = ref(false);
const exportando = ref(false);
const errorJson = ref<string | null>(null);
const errorImportacion = ref<string | null>(null);
const errorExportacion = ref<string | null>(null);
const resumenImportacion = ref<string | null>(null);
const nombreArchivoLeido = ref('');

/** Primer valor de texto de un parámetro de consulta (`?workspaceId=…`). */
function textoDeConsulta(valor: unknown): string {
  if (typeof valor === 'string') return valor;
  if (Array.isArray(valor)) {
    const primero: unknown = valor[0];
    return typeof primero === 'string' ? primero : '';
  }
  return '';
}

const workspaces = computed(() => almacenWorkspaces.lista);
const workspaceActual = computed(() => almacenWorkspaces.porId(workspaceId.value));
const colecciones = computed(() => almacenColecciones.deWorkspace(workspaceId.value));

const cargandoWorkspaces = computed(
  () => almacenWorkspaces.cargando && !almacenWorkspaces.cargada,
);
const errorWorkspaces = computed(() =>
  almacenWorkspaces.cargada ? null : almacenWorkspaces.error,
);
const sinWorkspaces = computed(() => almacenWorkspaces.estaVacia);

const coleccionesCargadas = computed(() => almacenColecciones.cargada(workspaceId.value));
const cargandoColecciones = computed(
  () => almacenColecciones.cargando && !coleccionesCargadas.value,
);
const errorColecciones = computed(() =>
  coleccionesCargadas.value ? null : almacenColecciones.error,
);
const sinColecciones = computed(() => almacenColecciones.estaVacia(workspaceId.value));

/**
 * `editor` o superior. Si la API no dijo el rol se deja la acción visible: el
 * servidor responderá 403 y el error se verá, que es preferible a esconder una
 * acción legítima.
 */
const puedeEditar = computed(() => {
  const rol = workspaceActual.value?.myRole;
  if (rol === undefined || rol === null || rol === '') return true;
  return rol === 'owner' || rol === 'admin' || rol === 'editor';
});

const hayJson = computed(() => jsonEntrada.value.trim().length > 0);

function etiquetaDeRol(rol: string | undefined | null): string {
  if (rol === 'owner') return 'Propietario';
  if (rol === 'admin') return 'Administrador';
  if (rol === 'editor') return 'Edición';
  if (rol === 'executor') return 'Ejecución';
  if (rol === 'viewer') return 'Solo mostrar';
  return 'Rol sin determinar';
}

function resolverWorkspaceInicial(): string {
  const pedido = textoDeConsulta(route.query['workspaceId']);
  if (pedido !== '' && workspaces.value.some((ws) => ws.id === pedido)) return pedido;
  return workspaces.value[0]?.id ?? '';
}

async function cargarColecciones(): Promise<void> {
  if (workspaceId.value === '') return;
  await almacenColecciones.cargar(workspaceId.value);
  if (coleccionId.value === '') {
    coleccionId.value = colecciones.value[0]?.id ?? '';
  }
}

async function recargarWorkspaces(): Promise<void> {
  await almacenWorkspaces.cargar();
  if (workspaceId.value === '') workspaceId.value = resolverWorkspaceInicial();
  if (workspaceId.value !== '') await cargarColecciones();
}

function leerArchivo(evento: Event): void {
  const entrada = evento.target as HTMLInputElement;
  const archivo = entrada.files?.[0];
  if (archivo === undefined) return;
  errorJson.value = null;
  errorImportacion.value = null;
  resumenImportacion.value = null;
  const lector = new FileReader();
  lector.onload = (): void => {
    jsonEntrada.value = String(lector.result ?? '');
    nombreArchivoLeido.value = archivo.name;
  };
  lector.onerror = (): void => {
    nombreArchivoLeido.value = '';
    errorJson.value = `No se pudo leer «${archivo.name}». Pega el contenido a mano.`;
  };
  lector.readAsText(archivo);
}

function cargarPlantillaEjemplo(): void {
  errorJson.value = null;
  nombreArchivoLeido.value = '';
  jsonEntrada.value = JSON.stringify(
    {
      schemaVersion: 'ceiba.collection.v1',
      collection: {
        name: 'API Pagos Regionales',
        description: 'Colección importada con carpetas y endpoints de prueba',
      },
      folders: [{ id: 'f-auth', parentFolderId: null, name: 'Autenticación', sortOrder: 0 }],
      requests: [
        {
          folderId: 'f-auth',
          name: 'Estado del servicio',
          method: 'GET',
          url: 'https://httpbin.org/get',
          headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
          queryParams: [],
          bodyType: 'none',
          body: null,
          authConfig: { type: 'none' },
        },
      ],
    },
    null,
    2,
  );
}

/** Valida el texto antes de gastar una petición: el error se ve en el campo. */
function interpretarJson(texto: string): Record<string, unknown> | null {
  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch (fallo) {
    errorJson.value =
      fallo instanceof Error
        ? `El texto no es JSON válido: ${fallo.message}`
        : 'El texto no es JSON válido.';
    return null;
  }
  if (typeof datos !== 'object' || datos === null || Array.isArray(datos)) {
    errorJson.value = 'El JSON debe ser un objeto con la colección, sus carpetas y peticiones.';
    return null;
  }
  errorJson.value = null;
  return datos as Record<string, unknown>;
}

async function ejecutarImportacion(): Promise<void> {
  if (workspaceId.value === '' || !hayJson.value) return;
  errorImportacion.value = null;
  resumenImportacion.value = null;
  const payload = interpretarJson(jsonEntrada.value);
  if (payload === null) return;

  importando.value = true;
  try {
    const resultado = await importarColeccion(workspaceId.value, payload);
    await almacenColecciones.cargar(workspaceId.value);
    const nombre = resultado.collectionName !== '' ? resultado.collectionName : resultado.name;
    resumenImportacion.value =
      `Colección «${nombre}»: ${resultado.importedFolders} carpetas y ` +
      `${resultado.importedRequests} peticiones (versión ${resultado.versionNumber}).`;
    if (coleccionId.value === '') coleccionId.value = resultado.collectionId;
  } catch (fallo) {
    errorImportacion.value = mensajeDeError(fallo);
  } finally {
    importando.value = false;
  }
}

async function ejecutarExportacion(): Promise<void> {
  if (workspaceId.value === '' || coleccionId.value === '') return;
  exportando.value = true;
  errorExportacion.value = null;
  try {
    const paquete = await exportarColeccion(workspaceId.value, coleccionId.value);
    jsonExportado.value = JSON.stringify(paquete, null, 2);
  } catch (fallo) {
    jsonExportado.value = '';
    errorExportacion.value = mensajeDeError(fallo);
  } finally {
    exportando.value = false;
  }
}

function descargarJsonExportado(): void {
  if (jsonExportado.value === '') return;
  const blob = new Blob([jsonExportado.value], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = `ceiba-collection-${coleccionId.value.slice(0, 8)}.json`;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}

function irAlWorkspace(): void {
  if (workspaceId.value === '') return;
  void router.push({
    name: NOMBRES_RUTAS.WORKSPACE_DETALLE,
    params: { workspaceId: workspaceId.value },
  });
}

function irAWorkspaces(): void {
  void router.push({ name: NOMBRES_RUTAS.WORKSPACES });
}

onMounted(async () => {
  if (!almacenWorkspaces.cargada) await almacenWorkspaces.cargar();
  workspaceId.value = resolverWorkspaceInicial();
  if (workspaceId.value !== '') await cargarColecciones();
});

watch(workspaceId, (nuevo, anterior) => {
  if (nuevo === anterior || nuevo === '') return;
  coleccionId.value = '';
  jsonExportado.value = '';
  errorExportacion.value = null;
  errorImportacion.value = null;
  resumenImportacion.value = null;
  void cargarColecciones();
});
</script>

<template>
  <section class="vista-importar" aria-labelledby="titulo-importar">
    <header class="vista-importar__cabecera">
      <div>
        <p class="vista-importar__migas">Portabilidad de colecciones</p>
        <h1 id="titulo-importar" class="vista-importar__titulo">
          Importar y exportar colecciones
        </h1>
        <p class="vista-importar__subtitulo">
          Importa una colección en JSON o exporta cualquiera de las del workspace con sus
          carpetas, cabeceras, parámetros y cuerpo.
        </p>
      </div>

      <div v-if="workspaces.length > 0" class="vista-importar__controles">
        <div class="vista-importar__campo-selector">
          <label class="vista-importar__etiqueta" :for="idSelectorWorkspace">Workspace</label>
          <select
            :id="idSelectorWorkspace"
            v-model="workspaceId"
            class="vista-importar__select"
            :disabled="importando || exportando"
          >
            <option v-for="ws in workspaces" :key="ws.id" :value="ws.id">
              {{ ws.name }} · {{ etiquetaDeRol(ws.myRole) }}
            </option>
          </select>
        </div>
        <CeibaBoton variante="secundario" compacto @click="irAlWorkspace">
          Ir al workspace
        </CeibaBoton>
      </div>
    </header>

    <div v-if="cargandoWorkspaces" class="vista-importar__espera">
      <CeibaLoadingScreen inline message="Cargando tus workspaces…" size="md" />
    </div>

    <div v-else-if="errorWorkspaces" class="vista-importar__bloque">
      <CeibaAviso tono="error" titulo="No se pudieron cargar los workspaces">
        {{ errorWorkspaces }}
      </CeibaAviso>
      <CeibaBoton
        variante="secundario"
        compacto
        :cargando="almacenWorkspaces.cargando"
        @click="recargarWorkspaces"
      >
        Reintentar
      </CeibaBoton>
    </div>

    <CeibaVacio
      v-else-if="sinWorkspaces"
      titulo="Todavía no tienes workspaces"
      detalle="La importación y la exportación necesitan un workspace donde dejar la colección."
    >
      <CeibaBoton variante="primario" @click="irAWorkspaces">Crear un workspace</CeibaBoton>
    </CeibaVacio>

    <div v-else class="vista-importar__grid">
      <section class="vista-importar__panel" aria-labelledby="titulo-panel-importar">
        <CeibaLoadingScreen
          v-if="importando"
          inline
          size="md"
          message="Importando la colección…"
          detail="Creando carpetas y peticiones en el workspace"
        />

        <h2 id="titulo-panel-importar" class="vista-importar__panel-titulo">
          Importar colección (JSON)
        </h2>
        <p class="vista-importar__ayuda">
          Sube un archivo <code>.json</code> o pega el contenido. Cada importación queda
          registrada en el historial de cambios con su número de versión.
        </p>

        <CeibaAviso v-if="!puedeEditar" tono="aviso" titulo="Permiso insuficiente">
          Tu rol en «{{ workspaceActual?.name }}» es
          {{ etiquetaDeRol(workspaceActual?.myRole).toLowerCase() }}: la API rechazará la
          importación. Pide permiso de edición a quien administre el workspace.
        </CeibaAviso>

        <div class="vista-importar__archivo">
          <label class="vista-importar__etiqueta" :for="idArchivo">Archivo de colección</label>
          <input
            :id="idArchivo"
            class="vista-importar__input-archivo"
            type="file"
            accept=".json,application/json"
            :disabled="!puedeEditar || importando"
            @change="leerArchivo"
          />
          <p v-if="nombreArchivoLeido" class="vista-importar__nota">
            Contenido tomado de «{{ nombreArchivoLeido }}».
          </p>
        </div>

        <CeibaCampo
          v-model="jsonEntrada"
          etiqueta="Contenido JSON"
          multilinea
          monoespaciada
          :filas="14"
          :error="errorJson"
          :deshabilitado="!puedeEditar || importando"
          ayuda="Formato CEIBA (ceiba.collection.v1) o Postman v2.1."
          marcador-de-posicion='{"collection": {"name": "Mi colección"}, "folders": [], "requests": []}'
        />

        <div class="vista-importar__acciones">
          <CeibaBoton
            variante="fantasma"
            compacto
            :deshabilitado="!puedeEditar || importando"
            @click="cargarPlantillaEjemplo"
          >
            Cargar ejemplo
          </CeibaBoton>
          <CeibaBoton
            variante="primario"
            :cargando="importando"
            :deshabilitado="!puedeEditar || !hayJson"
            @click="ejecutarImportacion"
          >
            Importar al workspace
          </CeibaBoton>
        </div>

        <CeibaAviso v-if="errorImportacion" tono="error" titulo="No se pudo importar">
          {{ errorImportacion }}
        </CeibaAviso>
        <CeibaAviso v-if="resumenImportacion" tono="exito" titulo="Importación completada">
          {{ resumenImportacion }}
        </CeibaAviso>
      </section>

      <section class="vista-importar__panel" aria-labelledby="titulo-panel-exportar">
        <CeibaLoadingScreen
          v-if="exportando"
          inline
          size="md"
          message="Generando la exportación…"
          detail="Leyendo carpetas, peticiones y cuerpos"
        />

        <h2 id="titulo-panel-exportar" class="vista-importar__panel-titulo">
          Exportar colección a JSON
        </h2>
        <p class="vista-importar__ayuda">
          Genera el paquete completo de una colección para versionarlo o moverlo a otro
          workspace.
        </p>

        <p v-if="cargandoColecciones" class="vista-importar__linea-espera">
          <CeibaSpinner size="sm" />
          <span>Cargando colecciones…</span>
        </p>

        <template v-else-if="errorColecciones">
          <CeibaAviso tono="error" titulo="No se pudieron cargar las colecciones">
            {{ errorColecciones }}
          </CeibaAviso>
          <CeibaBoton variante="secundario" compacto @click="cargarColecciones">
            Reintentar
          </CeibaBoton>
        </template>

        <CeibaVacio
          v-else-if="sinColecciones"
          titulo="Este workspace no tiene colecciones"
          detalle="Crea o importa una colección y podrás exportarla desde aquí."
        >
          <CeibaBoton variante="secundario" compacto @click="irAlWorkspace">
            Abrir el workspace
          </CeibaBoton>
        </CeibaVacio>

        <template v-else>
          <div class="vista-importar__barra-exportar">
            <div class="vista-importar__campo-selector">
              <label class="vista-importar__etiqueta" :for="idSelectorColeccion">Colección</label>
              <select
                :id="idSelectorColeccion"
                v-model="coleccionId"
                class="vista-importar__select"
                :disabled="exportando"
              >
                <option value="" disabled>Selecciona una colección</option>
                <option v-for="col in colecciones" :key="col.id" :value="col.id">
                  {{ col.name }}
                </option>
              </select>
            </div>
            <CeibaBoton
              variante="primario"
              :cargando="exportando"
              :deshabilitado="coleccionId === ''"
              @click="ejecutarExportacion"
            >
              Generar exportación
            </CeibaBoton>
          </div>

          <CeibaAviso v-if="errorExportacion" tono="error" titulo="No se pudo exportar">
            {{ errorExportacion }}
          </CeibaAviso>

          <template v-if="jsonExportado">
            <pre
              class="vista-importar__salida"
              tabindex="0"
              aria-label="JSON exportado de la colección"
            >{{ jsonExportado }}</pre>
            <div class="vista-importar__acciones">
              <CeibaBoton variante="secundario" @click="descargarJsonExportado">
                Descargar .json
              </CeibaBoton>
            </div>
          </template>

          <CeibaVacio
            v-else-if="!errorExportacion"
            titulo="Sin exportación generada"
            detalle="Elige una colección y pulsa «Generar exportación» para ver aquí su JSON."
          />
        </template>
      </section>
    </div>
  </section>
</template>

<style scoped>
.vista-importar {
  max-width: 1180px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-5);
}

.vista-importar__cabecera {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--ceiba-space-4);
  flex-wrap: wrap;
}

.vista-importar__migas {
  margin: 0;
  font-size: var(--ceiba-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ceiba-text-faint);
}

.vista-importar__titulo {
  margin: var(--ceiba-space-1) 0;
  font-size: var(--ceiba-text-2xl);
}

.vista-importar__subtitulo {
  margin: 0;
  max-width: 64ch;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.vista-importar__controles {
  display: flex;
  align-items: flex-end;
  gap: var(--ceiba-space-2);
  flex-wrap: wrap;
}

.vista-importar__campo-selector {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
}

.vista-importar__etiqueta {
  font-size: var(--ceiba-text-xs);
  font-weight: 500;
  color: var(--ceiba-text-muted);
}

.vista-importar__select {
  min-width: 14rem;
  padding: var(--ceiba-space-2) var(--ceiba-space-3);
  border-radius: var(--ceiba-radius-md);
  border: 1px solid var(--ceiba-border-strong);
  background: var(--ceiba-surface);
  color: var(--ceiba-text);
  font-family: inherit;
  font-size: var(--ceiba-text-md);
  transition: border-color var(--ceiba-duration-fast) var(--ceiba-ease);
}

.vista-importar__select:hover:not(:disabled) {
  border-color: var(--ceiba-accent-dim);
}

.vista-importar__select:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.vista-importar__espera {
  position: relative;
  min-height: 12rem;
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-lg);
  background: var(--ceiba-surface);
}

.vista-importar__bloque {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--ceiba-space-3);
}

.vista-importar__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--ceiba-space-5);
  align-items: start;
}

.vista-importar__panel {
  position: relative;
  min-height: 18rem;
  background: var(--ceiba-surface);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-lg);
  padding: var(--ceiba-space-5);
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-3);
}

.vista-importar__panel-titulo {
  margin: 0;
  font-size: var(--ceiba-text-lg);
}

.vista-importar__ayuda {
  margin: 0;
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-muted);
}

.vista-importar__ayuda code {
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text);
}

.vista-importar__archivo {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
}

.vista-importar__input-archivo {
  padding: var(--ceiba-space-2);
  border: 1px dashed var(--ceiba-border-strong);
  border-radius: var(--ceiba-radius-md);
  background: var(--ceiba-surface-raised);
  color: var(--ceiba-text-muted);
  font-family: inherit;
  font-size: var(--ceiba-text-xs);
}

.vista-importar__input-archivo:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.vista-importar__nota {
  margin: 0;
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

.vista-importar__acciones {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ceiba-space-2);
  justify-content: flex-end;
}

.vista-importar__linea-espera {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-2);
  margin: 0;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.vista-importar__barra-exportar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--ceiba-space-2);
  flex-wrap: wrap;
}

.vista-importar__salida {
  margin: 0;
  max-height: 22rem;
  overflow: auto;
  padding: var(--ceiba-space-3);
  border-radius: var(--ceiba-radius-md);
  border: 1px solid var(--ceiba-border);
  background: var(--ceiba-bg-sunken);
  color: var(--ceiba-text);
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-xs);
  line-height: 1.6;
  white-space: pre;
}

@media (max-width: 900px) {
  .vista-importar__grid {
    grid-template-columns: 1fr;
  }
}
</style>
