<script setup lang="ts">
/**
 * Documentación viva del workspace (`GET /workspaces/:id/documentation`).
 *
 * Decisiones que conviene dejar escritas:
 *
 *  1. **Cargando, vacío y error son tres estados distintos.** Antes la vista
 *     pintaba «sin colecciones documentadas» mientras la petición seguía en
 *     vuelo: eso es mentirle al usuario. Ahora la espera muestra el logo de la
 *     marca girando (`CeibaLoadingScreen inline`, BRIEF-FASE4 §2.2.3).
 *
 *  2. **Copiar al portapapeles puede fallar** (contexto no seguro, permiso
 *     denegado). No se da por hecho que funcione: si falla se dice y queda la
 *     descarga como salida.
 *
 *  3. El color del método HTTP sale de los tokens dedicados
 *     `--ceiba-method-*`; aquí no se escribe ni un color literal.
 */
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { CeibaLoadingScreen } from '@ceiba/brand';

import { mensajeDeError } from '@/api/errores';
import { obtenerDocumentacionWorkspace, type DocumentacionWorkspaceDto } from '@/api/studio';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import CeibaVacio from '@/components/ui/CeibaVacio.vue';
import { NOMBRES_RUTAS } from '@/router/nombres';
import { usarAlmacenDeWorkspaces } from '@/stores/workspaces';

const route = useRoute();
const router = useRouter();
const almacenWorkspaces = usarAlmacenDeWorkspaces();

const idSelectorWorkspace = useId();

const workspaceId = ref('');
const doc = ref<DocumentacionWorkspaceDto | null>(null);
const cargandoDoc = ref(false);
const errorDoc = ref<string | null>(null);
const copiado = ref(false);
const errorCopia = ref<string | null>(null);

let temporizadorCopia: ReturnType<typeof setTimeout> | null = null;

const formateadorDeFecha = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

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
const cargandoWorkspaces = computed(
  () => almacenWorkspaces.cargando && !almacenWorkspaces.cargada,
);
const errorWorkspaces = computed(() =>
  almacenWorkspaces.cargada ? null : almacenWorkspaces.error,
);
const sinWorkspaces = computed(() => almacenWorkspaces.estaVacia);

const colecciones = computed(() => doc.value?.collections ?? []);
const sinColecciones = computed(() => doc.value !== null && colecciones.value.length === 0);
const hayMarkdown = computed(() => (doc.value?.markdown ?? '').trim().length > 0);

const totalEndpoints = computed(() =>
  colecciones.value.reduce(
    (suma, col) => suma + (col.requests.length > 0 ? col.requests.length : (col.requestsCount ?? 0)),
    0,
  ),
);

const generadoEl = computed(() => {
  const marca = doc.value?.generatedAt ?? '';
  if (marca === '') return '';
  const fecha = new Date(marca);
  return Number.isNaN(fecha.getTime()) ? marca : formateadorDeFecha.format(fecha);
});

function metodoNormalizado(metodo: string): string {
  const limpio = metodo.trim().toUpperCase();
  return limpio === '' ? 'GET' : limpio;
}

function endpointsDe(coleccion: (typeof colecciones.value)[number]): number {
  return coleccion.requests.length > 0 ? coleccion.requests.length : (coleccion.requestsCount ?? 0);
}

function resolverWorkspaceInicial(): string {
  const pedido = textoDeConsulta(route.query['workspaceId']);
  if (pedido !== '' && workspaces.value.some((ws) => ws.id === pedido)) return pedido;
  return workspaces.value[0]?.id ?? '';
}

async function cargarDoc(): Promise<void> {
  if (workspaceId.value === '') return;
  cargandoDoc.value = true;
  errorDoc.value = null;
  errorCopia.value = null;
  try {
    doc.value = await obtenerDocumentacionWorkspace(workspaceId.value);
  } catch (fallo) {
    doc.value = null;
    errorDoc.value = mensajeDeError(fallo);
  } finally {
    cargandoDoc.value = false;
  }
}

async function recargarWorkspaces(): Promise<void> {
  await almacenWorkspaces.cargar();
  if (workspaceId.value === '') workspaceId.value = resolverWorkspaceInicial();
  if (workspaceId.value !== '') await cargarDoc();
}

async function copiarMarkdown(): Promise<void> {
  const texto = doc.value?.markdown ?? '';
  if (texto === '') return;
  errorCopia.value = null;
  const portapapeles = navigator.clipboard as Clipboard | undefined;
  if (portapapeles === undefined) {
    errorCopia.value =
      'Este navegador no permite copiar al portapapeles desde aquí. Descarga el archivo .md.';
    return;
  }
  try {
    await portapapeles.writeText(texto);
    copiado.value = true;
    if (temporizadorCopia !== null) clearTimeout(temporizadorCopia);
    temporizadorCopia = setTimeout(() => {
      copiado.value = false;
      temporizadorCopia = null;
    }, 2000);
  } catch (fallo) {
    errorCopia.value = `No se pudo copiar al portapapeles: ${mensajeDeError(fallo)}`;
  }
}

function descargarMarkdown(): void {
  const texto = doc.value?.markdown ?? '';
  if (texto === '') return;
  const blob = new Blob([texto], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  const slug = doc.value?.workspace.slug ?? '';
  enlace.download = `${slug === '' ? 'workspace' : slug}-docs.md`;
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
  if (workspaceId.value !== '') await cargarDoc();
});

watch(workspaceId, (nuevo, anterior) => {
  if (nuevo === anterior || nuevo === '') return;
  doc.value = null;
  copiado.value = false;
  void cargarDoc();
});

onBeforeUnmount(() => {
  if (temporizadorCopia !== null) clearTimeout(temporizadorCopia);
});
</script>

<template>
  <section class="vista-doc" aria-labelledby="titulo-doc">
    <header class="vista-doc__cabecera">
      <div>
        <p class="vista-doc__migas">Catálogo vivo de endpoints</p>
        <h1 id="titulo-doc" class="vista-doc__titulo">Documentación de API</h1>
        <p class="vista-doc__subtitulo">
          Referencia generada a partir de las colecciones, carpetas y peticiones del workspace.
        </p>
      </div>

      <div v-if="workspaces.length > 0" class="vista-doc__controles">
        <div class="vista-doc__campo-selector">
          <label class="vista-doc__etiqueta" :for="idSelectorWorkspace">Workspace</label>
          <select
            :id="idSelectorWorkspace"
            v-model="workspaceId"
            class="vista-doc__select"
            :disabled="cargandoDoc"
          >
            <option v-for="ws in workspaces" :key="ws.id" :value="ws.id">{{ ws.name }}</option>
          </select>
        </div>
        <CeibaBoton
          variante="secundario"
          compacto
          :deshabilitado="!hayMarkdown || cargandoDoc"
          @click="copiarMarkdown"
        >
          {{ copiado ? 'Markdown copiado' : 'Copiar Markdown' }}
        </CeibaBoton>
        <CeibaBoton
          variante="primario"
          compacto
          :deshabilitado="!hayMarkdown || cargandoDoc"
          @click="descargarMarkdown"
        >
          Descargar .md
        </CeibaBoton>
      </div>
    </header>

    <CeibaAviso v-if="errorCopia" tono="aviso" titulo="Copia no realizada">
      {{ errorCopia }}
    </CeibaAviso>

    <div v-if="cargandoWorkspaces" class="vista-doc__espera">
      <CeibaLoadingScreen inline size="md" message="Cargando tus workspaces…" />
    </div>

    <div v-else-if="errorWorkspaces" class="vista-doc__bloque">
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
      detalle="La documentación se genera a partir de las colecciones de un workspace."
    >
      <CeibaBoton variante="primario" @click="irAWorkspaces">Crear un workspace</CeibaBoton>
    </CeibaVacio>

    <div v-else-if="cargandoDoc" class="vista-doc__espera">
      <CeibaLoadingScreen
        inline
        size="md"
        message="Generando la documentación…"
        detail="Recorriendo colecciones, carpetas y peticiones"
      />
    </div>

    <div v-else-if="errorDoc" class="vista-doc__bloque">
      <CeibaAviso tono="error" titulo="No se pudo generar la documentación">
        {{ errorDoc }}
      </CeibaAviso>
      <CeibaBoton variante="secundario" compacto @click="cargarDoc">Reintentar</CeibaBoton>
    </div>

    <CeibaVacio
      v-else-if="sinColecciones"
      titulo="Sin colecciones documentadas"
      detalle="Crea una colección con sus peticiones y aparecerá aquí su referencia técnica."
    >
      <CeibaBoton variante="primario" @click="irAlWorkspace">Abrir el workspace</CeibaBoton>
    </CeibaVacio>

    <template v-else-if="doc">
      <div class="vista-doc__resumen">
        <p class="vista-doc__resumen-dato">
          <span class="vista-doc__resumen-cifra">{{ colecciones.length }}</span>
          <span>colecciones</span>
        </p>
        <p class="vista-doc__resumen-dato">
          <span class="vista-doc__resumen-cifra">{{ totalEndpoints }}</span>
          <span>endpoints</span>
        </p>
        <p v-if="generadoEl" class="vista-doc__resumen-fecha">Generada el {{ generadoEl }}</p>
      </div>

      <div class="vista-doc__colecciones">
        <article v-for="col in colecciones" :key="col.id" class="vista-doc__coleccion">
          <header class="vista-doc__col-cabecera">
            <h2 class="vista-doc__col-titulo">{{ col.name }}</h2>
            <p class="vista-doc__col-cifras">
              {{ endpointsDe(col) }} endpoints · {{ col.foldersCount ?? 0 }} carpetas
              <template v-if="col.versionCount"> · {{ col.versionCount }} versiones</template>
            </p>
          </header>

          <p v-if="col.description" class="vista-doc__col-desc">{{ col.description }}</p>

          <ul v-if="col.requests.length > 0" class="vista-doc__endpoints">
            <li v-for="req in col.requests" :key="req.id" class="vista-doc__endpoint">
              <div class="vista-doc__endpoint-top">
                <span
                  class="vista-doc__metodo"
                  :data-metodo="metodoNormalizado(req.method)"
                  >{{ metodoNormalizado(req.method) }}</span
                >
                <strong class="vista-doc__nombre">{{ req.name }}</strong>
              </div>
              <code class="vista-doc__url">{{ req.url }}</code>
              <p v-if="req.description" class="vista-doc__desc">{{ req.description }}</p>
            </li>
          </ul>

          <p v-else class="vista-doc__col-vacia">
            Esta colección todavía no tiene peticiones documentadas.
          </p>

          <details v-if="col.markdown" class="vista-doc__markdown">
            <summary class="vista-doc__markdown-resumen">Ver Markdown de la colección</summary>
            <pre class="vista-doc__markdown-cuerpo" tabindex="0">{{ col.markdown }}</pre>
          </details>
        </article>
      </div>
    </template>
  </section>
</template>

<style scoped>
.vista-doc {
  max-width: 1080px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-5);
}

.vista-doc__cabecera {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--ceiba-space-4);
  flex-wrap: wrap;
}

.vista-doc__migas {
  margin: 0;
  font-size: var(--ceiba-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ceiba-text-faint);
}

.vista-doc__titulo {
  margin: var(--ceiba-space-1) 0;
  font-size: var(--ceiba-text-2xl);
}

.vista-doc__subtitulo {
  margin: 0;
  max-width: 64ch;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.vista-doc__controles {
  display: flex;
  align-items: flex-end;
  gap: var(--ceiba-space-2);
  flex-wrap: wrap;
}

.vista-doc__campo-selector {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
}

.vista-doc__etiqueta {
  font-size: var(--ceiba-text-xs);
  font-weight: 500;
  color: var(--ceiba-text-muted);
}

.vista-doc__select {
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

.vista-doc__select:hover:not(:disabled) {
  border-color: var(--ceiba-accent-dim);
}

.vista-doc__select:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.vista-doc__espera {
  position: relative;
  min-height: 14rem;
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-lg);
  background: var(--ceiba-surface);
}

.vista-doc__bloque {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--ceiba-space-3);
}

.vista-doc__resumen {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-5);
  flex-wrap: wrap;
  padding: var(--ceiba-space-3) var(--ceiba-space-4);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-lg);
  background: var(--ceiba-surface);
}

.vista-doc__resumen-dato {
  display: flex;
  align-items: baseline;
  gap: var(--ceiba-space-2);
  margin: 0;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.vista-doc__resumen-cifra {
  font-size: var(--ceiba-text-xl);
  font-weight: 600;
  color: var(--ceiba-text);
}

.vista-doc__resumen-fecha {
  margin: 0 0 0 auto;
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

.vista-doc__colecciones {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-4);
}

.vista-doc__coleccion {
  background: var(--ceiba-surface);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-lg);
  padding: var(--ceiba-space-5);
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-3);
}

.vista-doc__col-cabecera {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--ceiba-space-3);
  flex-wrap: wrap;
}

.vista-doc__col-titulo {
  margin: 0;
  font-size: var(--ceiba-text-xl);
}

.vista-doc__col-cifras {
  margin: 0;
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

.vista-doc__col-desc {
  margin: 0;
  max-width: 72ch;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.vista-doc__col-vacia {
  margin: 0;
  padding: var(--ceiba-space-3);
  border: 1px dashed var(--ceiba-border);
  border-radius: var(--ceiba-radius-md);
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.vista-doc__endpoints {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-2);
}

.vista-doc__endpoint {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
  padding: var(--ceiba-space-3);
  border-radius: var(--ceiba-radius-md);
  border: 1px solid var(--ceiba-border);
  background: var(--ceiba-surface-raised);
}

.vista-doc__endpoint-top {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-3);
  flex-wrap: wrap;
}

.vista-doc__metodo {
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-xs);
  font-weight: 600;
  letter-spacing: 0.04em;
  padding: var(--ceiba-space-1) var(--ceiba-space-2);
  border-radius: var(--ceiba-radius-sm);
  background: var(--ceiba-surface-overlay);
  border: 1px solid var(--ceiba-border-strong);
  color: var(--ceiba-text-muted);
}

.vista-doc__metodo[data-metodo='GET'] {
  color: var(--ceiba-method-get);
  border-color: var(--ceiba-method-get);
}
.vista-doc__metodo[data-metodo='POST'] {
  color: var(--ceiba-method-post);
  border-color: var(--ceiba-method-post);
}
.vista-doc__metodo[data-metodo='PUT'] {
  color: var(--ceiba-method-put);
  border-color: var(--ceiba-method-put);
}
.vista-doc__metodo[data-metodo='PATCH'] {
  color: var(--ceiba-method-patch);
  border-color: var(--ceiba-method-patch);
}
.vista-doc__metodo[data-metodo='DELETE'] {
  color: var(--ceiba-method-delete);
  border-color: var(--ceiba-method-delete);
}
.vista-doc__metodo[data-metodo='HEAD'] {
  color: var(--ceiba-method-head);
  border-color: var(--ceiba-method-head);
}
.vista-doc__metodo[data-metodo='OPTIONS'] {
  color: var(--ceiba-method-options);
  border-color: var(--ceiba-method-options);
}

.vista-doc__nombre {
  font-size: var(--ceiba-text-md);
  font-weight: 600;
  color: var(--ceiba-text);
}

.vista-doc__url {
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-accent);
  overflow-wrap: anywhere;
}

.vista-doc__desc {
  margin: var(--ceiba-space-1) 0 0;
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-muted);
}

.vista-doc__markdown {
  border-top: 1px solid var(--ceiba-border);
  padding-top: var(--ceiba-space-3);
}

.vista-doc__markdown-resumen {
  cursor: pointer;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.vista-doc__markdown-resumen:hover {
  color: var(--ceiba-text);
}

.vista-doc__markdown-cuerpo {
  margin: var(--ceiba-space-3) 0 0;
  max-height: 24rem;
  overflow: auto;
  padding: var(--ceiba-space-3);
  border-radius: var(--ceiba-radius-md);
  border: 1px solid var(--ceiba-border);
  background: var(--ceiba-bg-sunken);
  color: var(--ceiba-text);
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-xs);
  line-height: 1.6;
  white-space: pre-wrap;
}
</style>
