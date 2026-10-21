<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import {
  listarHistorialModificaciones,
  listarHistorialPeticiones,
  type EntradaHistorialPeticion,
  type EventoDeAuditoria,
  type VersionDeColeccion,
} from '@/api/studio';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import CeibaVacio from '@/components/ui/CeibaVacio.vue';
import { NOMBRES_RUTA } from '@/router/nombres';
import { usarAlmacenConstructor } from '@/stores/constructor';
import { usarAlmacenWorkspaces } from '@/stores/workspaces';

const router = useRouter();
const almacenWorkspaces = usarAlmacenWorkspaces();
const almacenConstructor = usarAlmacenConstructor();

const workspaceSeleccionadoId = ref<string>('');
const pestanaActiva = ref<'cambios' | 'peticiones' | 'versiones'>('cambios');
const cargando = ref(false);
const errorMensaje = ref<string | null>(null);

const eventosCambios = ref<EventoDeAuditoria[]>([]);
const versiones = ref<VersionDeColeccion[]>([]);
const historialPeticiones = ref<EntradaHistorialPeticion[]>([]);
const filtroTexto = ref('');
const entradaSeleccionada = ref<EntradaHistorialPeticion | null>(null);

const ETIQUETAS_ACCION: Record<string, string> = {
  'workspace.created': 'Creó el workspace',
  'workspace.updated': 'Renombró el workspace',
  'workspace.deleted': 'Eliminó el workspace',
  'workspace.member_invited': 'Generó invitación al workspace',
  'workspace.member_joined': 'Se unió al workspace por invitación',
  'workspace.member_role_changed': 'Cambió permisos de colaborador',
  'workspace.member_removed': 'Eliminó colaborador del workspace',
  'collection.created': 'Creó colección',
  'collection.updated': 'Modificó colección',
  'collection.deleted': 'Eliminó colección',
  'collection.imported': 'Importó colección JSON',
  'collection.exported': 'Exportó colección JSON',
  'collection.version_created': 'Guardó versión de colección',
  'folder.created': 'Creó carpeta',
  'folder.updated': 'Modificó carpeta',
  'folder.deleted': 'Eliminó carpeta',
  'request.created': 'Creó petición HTTP',
  'request.updated': 'Modificó petición HTTP',
  'request.deleted': 'Eliminó petición HTTP',
  'request.executed': 'Ejecutó petición HTTP',
  'environment.created': 'Creó entorno',
  'environment.updated': 'Modificó variables de entorno',
  'environment.deleted': 'Eliminó entorno',
  'collection_run.completed': 'Ejecutó corrida de colección',
};

function traducirAccion(action: string): string {
  return ETIQUETAS_ACCION[action] ?? action;
}

const eventosFiltrados = computed(() => {
  const q = filtroTexto.value.trim().toLowerCase();
  if (!q) return eventosCambios.value;
  return eventosCambios.value.filter(
    (e) =>
      traducirAccion(e.action).toLowerCase().includes(q) ||
      (e.actorName ?? '').toLowerCase().includes(q) ||
      (e.actorEmail ?? '').toLowerCase().includes(q) ||
      e.resourceType.toLowerCase().includes(q) ||
      JSON.stringify(e.metadata ?? {}).toLowerCase().includes(q),
  );
});

const peticionesFiltradas = computed(() => {
  const q = filtroTexto.value.trim().toLowerCase();
  if (!q) return historialPeticiones.value;
  return historialPeticiones.value.filter(
    (h) =>
      h.resolvedUrl.toLowerCase().includes(q) ||
      h.method.toLowerCase().includes(q) ||
      h.userName.toLowerCase().includes(q),
  );
});

async function cargarDatos(): Promise<void> {
  if (!workspaceSeleccionadoId.value) return;
  cargando.value = true;
  errorMensaje.value = null;
  try {
    const [modificaciones, peticiones] = await Promise.all([
      listarHistorialModificaciones(workspaceSeleccionadoId.value, 100),
      listarHistorialPeticiones(workspaceSeleccionadoId.value, 80),
    ]);
    eventosCambios.value = modificaciones.items;
    versiones.value = modificaciones.versions;
    historialPeticiones.value = peticiones.items;
  } catch (err) {
    errorMensaje.value = err instanceof Error ? err.message : 'No se pudo cargar el historial.';
  } finally {
    cargando.value = false;
  }
}

function reabrirEnConstructor(item: EntradaHistorialPeticion): void {
  almacenConstructor.establecerMetodo(item.method);
  almacenConstructor.establecerUrl(item.resolvedUrl);
  router.push({ name: NOMBRES_RUTA.CONSTRUCTOR });
}

function formatearFecha(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-SV', {
      dateStyle: 'medium',
      timeStyle: 'medium',
    });
  } catch {
    return iso;
  }
}

function resumirMetadatos(meta: Record<string, unknown> | null): string {
  if (!meta) return '';
  const partes: string[] = [];
  if (typeof meta.name === 'string') partes.push(`Nombre: "${meta.name}"`);
  if (typeof meta.method === 'string') partes.push(`Método: ${meta.method}`);
  if (typeof meta.url === 'string') partes.push(`URL: ${meta.url}`);
  if (typeof meta.role === 'string') partes.push(`Rol: ${meta.role}`);
  if (typeof meta.email === 'string') partes.push(`Correo: ${meta.email}`);
  if (typeof meta.label === 'string') partes.push(`Versión: ${meta.label}`);
  if (partes.length > 0) return partes.join(' · ');
  return Object.entries(meta)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ');
}

watch(workspaceSeleccionadoId, () => {
  void cargarDatos();
});

onMounted(async () => {
  if (almacenWorkspaces.lista.length === 0) {
    await almacenWorkspaces.cargarLista();
  }
  const inicial = almacenWorkspaces.actual?.id ?? almacenWorkspaces.lista[0]?.id ?? '';
  workspaceSeleccionadoId.value = inicial;
});
</script>

<template>
  <section class="ceiba-pagina">
    <header class="ceiba-pagina__cabecera">
      <div>
        <h1 class="ceiba-pagina__titulo">Historial de cambios y ejecuciones</h1>
        <p class="ceiba-pagina__subtitulo">
          Bitácora auditable de todas las modificaciones realizadas por el equipo y de las peticiones HTTP ejecutadas.
        </p>
      </div>
      <div class="ceiba-pagina__controles">
        <label class="ceiba-selector-inline">
          <span>Workspace:</span>
          <select v-model="workspaceSeleccionadoId" class="ceiba-select">
            <option v-for="ws in almacenWorkspaces.lista" :key="ws.id" :value="ws.id">
              {{ ws.name }}
            </option>
          </select>
        </label>
        <CeibaBoton variante="secundario" :cargando="cargando" @click="cargarDatos">
          Actualizar
        </CeibaBoton>
      </div>
    </header>

    <CeibaAviso v-if="errorMensaje" tipo="error" :titulo="errorMensaje" />

    <div class="ceiba-barra-filtros">
      <div class="ceiba-pestanas" role="tablist">
        <button
          type="button"
          class="ceiba-pestana"
          :class="{ 'ceiba-pestana--activa': pestanaActiva === 'cambios' }"
          @click="pestanaActiva = 'cambios'"
        >
          Modificaciones y auditoría ({{ eventosCambios.length }})
        </button>
        <button
          type="button"
          class="ceiba-pestana"
          :class="{ 'ceiba-pestana--activa': pestanaActiva === 'peticiones' }"
          @click="pestanaActiva = 'peticiones'"
        >
          Ejecuciones HTTP ({{ historialPeticiones.length }})
        </button>
        <button
          type="button"
          class="ceiba-pestana"
          :class="{ 'ceiba-pestana--activa': pestanaActiva === 'versiones' }"
          @click="pestanaActiva = 'versiones'"
        >
          Versiones de colecciones ({{ versiones.length }})
        </button>
      </div>

      <input
        v-model="filtroTexto"
        type="search"
        class="ceiba-input-busqueda"
        placeholder="Filtrar por usuario, acción, recurso o URL…"
      />
    </div>

    <!-- Pestaña 1: Historial de modificaciones -->
    <div v-if="pestanaActiva === 'cambios'" class="ceiba-panel">
      <CeibaVacio
        v-if="!cargando && eventosFiltrados.length === 0"
        titulo="Sin cambios registrados todavía"
        descripcion="Cada creación o modificación de colecciones, carpetas, peticiones, entornos o miembros quedará registrada aquí."
      />
      <div v-else class="ceiba-tabla-contenedor">
        <table class="ceiba-tabla">
          <thead>
            <tr>
              <th>Fecha y hora</th>
              <th>Usuario</th>
              <th>Acción realizada</th>
              <th>Recurso</th>
              <th>Detalle del cambio</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ev in eventosFiltrados" :key="ev.id">
              <td class="ceiba-mono">{{ formatearFecha(ev.occurredAt) }}</td>
              <td>
                <strong>{{ ev.actorName || 'Usuario' }}</strong>
                <div v-if="ev.actorEmail" class="ceiba-texto-suave">{{ ev.actorEmail }}</div>
              </td>
              <td>
                <span class="ceiba-chip">{{ traducirAccion(ev.action) }}</span>
              </td>
              <td class="ceiba-mono">{{ ev.resourceType }}</td>
              <td class="ceiba-detalle-celda">{{ resumirMetadatos(ev.metadata) || '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Pestaña 2: Historial de peticiones ejecutadas -->
    <div v-else-if="pestanaActiva === 'peticiones'" class="ceiba-panel">
      <CeibaVacio
        v-if="!cargando && peticionesFiltradas.length === 0"
        titulo="Sin ejecuciones HTTP registradas"
        descripcion="Ejecuta una petición en el Constructor HTTP o corre una colección completa para ver su historial."
      />
      <div v-else class="ceiba-tabla-contenedor">
        <table class="ceiba-tabla">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Método</th>
              <th>URL resuelta</th>
              <th>Estado</th>
              <th>Duración</th>
              <th>Ejecutado por</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in peticionesFiltradas" :key="item.id">
              <td class="ceiba-mono">{{ formatearFecha(item.executedAt) }}</td>
              <td>
                <span class="ceiba-metodo">{{ item.method }}</span>
              </td>
              <td class="ceiba-mono ceiba-url-celda">{{ item.resolvedUrl }}</td>
              <td>
                <span
                  class="ceiba-estado"
                  :class="
                    item.statusCode && item.statusCode >= 200 && item.statusCode < 400
                      ? 'ceiba-estado--ok'
                      : 'ceiba-estado--error'
                  "
                >
                  {{ item.statusCode ?? item.errorCode ?? 'ERROR' }}
                </span>
              </td>
              <td class="ceiba-mono">{{ item.durationMs ?? 0 }} ms</td>
              <td>{{ item.userName }}</td>
              <td class="ceiba-acciones-fila">
                <CeibaBoton tamano="sm" variante="fantasma" @click="entradaSeleccionada = item">
                  Ver respuesta
                </CeibaBoton>
                <CeibaBoton tamano="sm" variante="secundario" @click="reabrirEnConstructor(item)">
                  Abrir en constructor
                </CeibaBoton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="entradaSeleccionada" class="ceiba-visor-detalle">
        <div class="ceiba-visor-detalle__cabecera">
          <strong>
            Detalle de ejecución: {{ entradaSeleccionada.method }} {{ entradaSeleccionada.resolvedUrl }}
          </strong>
          <CeibaBoton tamano="sm" variante="fantasma" @click="entradaSeleccionada = null">
            Cerrar
          </CeibaBoton>
        </div>
        <pre class="ceiba-pre">{{ entradaSeleccionada.responseBodyPreview || entradaSeleccionada.errorMessage || '(Sin cuerpo)' }}</pre>
      </div>
    </div>

    <!-- Pestaña 3: Versiones de colecciones -->
    <div v-else class="ceiba-panel">
      <CeibaVacio
        v-if="!cargando && versiones.length === 0"
        titulo="Sin instantáneas de versión todavía"
        descripcion="Al importar colecciones o guardar versiones se almacenan instantáneas completas aquí."
      />
      <div v-else class="ceiba-tabla-contenedor">
        <table class="ceiba-tabla">
          <thead>
            <tr>
              <th>Colección</th>
              <th>Versión</th>
              <th>Etiqueta</th>
              <th>Notas de versión</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ver in versiones" :key="ver.id">
              <td><strong>{{ ver.collectionName || ver.collectionId }}</strong></td>
              <td class="ceiba-mono">v{{ ver.versionNumber }}</td>
              <td><span class="ceiba-chip">{{ ver.label || `v${ver.versionNumber}` }}</span></td>
              <td>{{ ver.changelog || '—' }}</td>
              <td class="ceiba-mono">{{ formatearFecha(ver.createdAt) }}</td>
            </tr>
          </tbody>
        </table>
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
.ceiba-pagina__controles {
  display: flex;
  align-items: center;
  gap: var(--ceiba-espacio-3);
}
.ceiba-selector-inline {
  display: flex;
  align-items: center;
  gap: var(--ceiba-espacio-2);
  font-size: var(--ceiba-tamano-body);
}
.ceiba-select,
.ceiba-input-busqueda {
  padding: 6px 10px;
  border-radius: var(--ceiba-radio-sm);
  border: 1px solid var(--border-default);
  background: var(--bg-surface);
  color: var(--text-primary);
}
.ceiba-input-busqueda {
  min-width: 280px;
}
.ceiba-barra-filtros {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--ceiba-espacio-3);
  flex-wrap: wrap;
}
.ceiba-pestanas {
  display: flex;
  gap: var(--ceiba-espacio-2);
}
.ceiba-pestana {
  padding: 8px 14px;
  border-radius: var(--ceiba-radio-sm);
  border: 1px solid var(--border-subtle);
  background: var(--bg-surface);
  color: var(--text-secondary);
  cursor: pointer;
  font-weight: var(--ceiba-peso-medio);
}
.ceiba-pestana--activa {
  background: var(--brand-primary-subtle);
  color: var(--brand-primary);
  border-color: var(--brand-primary);
}
.ceiba-tabla-contenedor {
  border: 1px solid var(--border-subtle);
  border-radius: var(--ceiba-radio-md);
  background: var(--bg-surface);
  overflow-x: auto;
}
.ceiba-tabla {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.ceiba-tabla th,
.ceiba-tabla td {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
  text-align: left;
  vertical-align: top;
}
.ceiba-tabla th {
  color: var(--text-muted);
  font-weight: var(--ceiba-peso-medio);
  background: var(--bg-raised);
}
.ceiba-mono {
  font-family: var(--ceiba-fuente-mono);
  font-size: 12px;
}
.ceiba-texto-suave {
  font-size: 12px;
  color: var(--text-muted);
}
.ceiba-chip {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-raised);
  border: 1px solid var(--border-subtle);
  font-size: 12px;
}
.ceiba-metodo {
  font-family: var(--ceiba-fuente-mono);
  font-weight: var(--ceiba-peso-semibold);
}
.ceiba-estado {
  padding: 2px 8px;
  border-radius: 4px;
  font-family: var(--ceiba-fuente-mono);
  font-size: 12px;
}
.ceiba-estado--ok {
  background: rgba(16, 185, 129, 0.14);
  color: #10b981;
}
.ceiba-estado--error {
  background: rgba(239, 68, 68, 0.14);
  color: #ef4444;
}
.ceiba-acciones-fila {
  display: flex;
  gap: 6px;
}
.ceiba-visor-detalle {
  margin-top: var(--ceiba-espacio-4);
  padding: var(--ceiba-espacio-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--ceiba-radio-md);
  background: var(--bg-surface);
}
.ceiba-visor-detalle__cabecera {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--ceiba-espacio-2);
}
.ceiba-pre {
  margin: 0;
  padding: var(--ceiba-espacio-3);
  background: var(--bg-raised);
  border-radius: var(--ceiba-radio-sm);
  font-family: var(--ceiba-fuente-mono);
  font-size: 12px;
  max-height: 280px;
  overflow: auto;
  white-space: pre-wrap;
}
</style>
