<script setup lang="ts">
/**
 * ════════════════════════════════════════════════════════════════════════════
 * LA PANTALLA QUE RECIBE UN ENLACE DE COLECCIÓN COMPARTIDA (`/s/:slug`).
 *
 * Es el hueco que declararon, por separado, el ámbito B y el ámbito D de la
 * fase 7: «hoy puedes generar el enlace de colección y pegarlo en un chat, y
 * quien lo abra cae en la pantalla de "no encontrado"». El enlace se construye
 * en `sharing-admin.service.ts:470` como `<urlPublica>/s/<publicSlug>`; aquí
 * aterriza.
 *
 * ── Quién llega aquí ───────────────────────────────────────────────────────
 *
 * Alguien **sin cuenta**, que ha pulsado un enlace en un chat. Por eso la ruta
 * es `meta.publica: true` (si no, el guard lo manda al login y el enlace no
 * sirve para nada) y por eso `App.vue` la pinta **sin el armazón**: un lateral
 * con «mis workspaces» no significa nada para quien no tiene ninguno.
 *
 * ── Las tres decisiones que conviene revisar ───────────────────────────────
 *
 *  1. **Un único mensaje de error, siempre.** Código incorrecto, enlace
 *     caducado, enlace revocado y enlace inexistente producen exactamente el
 *     mismo texto (`MENSAJE_ACCESO_INVALIDO`). No es una simplificación: el
 *     servidor tiene UNA sola clase de error sin parámetros para los seis
 *     escenarios, y `C-CODE-04` mide incluso los tiempos de respuesta. Esta
 *     vista ni siquiera recibe el motivo, así que no puede filtrarlo.
 *
 *  2. **La sesión de compartición NO se da por buena entre cargas.** Existe
 *     `GET /share/session/me`, y sería cómodo llamarlo al entrar para ahorrarle
 *     el código a quien refresca. No se hace, y es deliberado: la sesión está
 *     atada a UN enlace, y nada en la respuesta permite comprobar que sea el
 *     de la URL que el visitante acaba de abrir —`ColeccionPublicada.slug` es
 *     el slug de la COLECCIÓN, no el `publicSlug` del enlace—. Reutilizarla a
 *     ciegas significaría que, con sesión abierta para el enlace A, abrir el
 *     enlace B enseñaría la colección A. El coste es volver a pedir el código
 *     tras un F5; el beneficio es que lo que se pinta corresponde siempre al
 *     enlace que se abrió.
 *
 *  3. **Es una vista de LECTURA.** No ejecuta, no edita y no guarda. Donde el
 *     enlace concede permisos (`canExport`, `canExecute`) se refleja el
 *     permiso: la exportación sí se ofrece porque el endpoint existe
 *     (`GET /share/content/export`); la ejecución **no**, porque ejecutar en
 *     nombre de una sesión sin usuario no forma parte de esta entrega y un
 *     botón que no hace nada es peor que su ausencia. Queda declarado en el
 *     informe.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';

import { CeibaLoadingScreen, CeibaMark } from '@ceiba/brand';

import {
  abrirSesionDeComparticion,
  cerrarSesionCompartida,
  consultarEstadoDeEnlace,
  consultarSesionCompartida,
  exportarColeccionCompartida,
  leerColeccionCompartida,
  type ColeccionCompartida,
  type PeticionCompartida,
  type SesionCompartida,
} from '@/api/comparticion';
import { ErrorDeApi, mensajeDeError } from '@/api/errores';
import DetalleDePeticionCompartida from '@/components/comparticion/DetalleDePeticionCompartida.vue';
import FormularioDeCodigoCompartido from '@/components/comparticion/FormularioDeCodigoCompartido.vue';
import ListaDePeticionesCompartidas from '@/components/comparticion/ListaDePeticionesCompartidas.vue';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import CeibaVacio from '@/components/ui/CeibaVacio.vue';

const ruta = useRoute();

const slug = computed(() => String(ruta.params['slug'] ?? ''));

/** Carga inicial: consultando `GET /share/:slug`. */
const comprobando = ref(true);
/** Canjeando el código o abriendo un enlace sin código. */
const entrando = ref(false);
/** Trayendo la colección con la sesión ya abierta. */
const cargandoContenido = ref(false);

const pidiendoCodigo = ref(false);
/** El último intento de acceso falló. SIN motivo: no existe y no debe existir. */
const accesoFallido = ref(false);

/** Fallo que NO es de acceso: red caída, 500, servidor apagado. */
const errorTecnico = ref<string | null>(null);

const sesion = ref<SesionCompartida | null>(null);
const coleccion = ref<ColeccionCompartida | null>(null);
const seleccionada = ref<string | null>(null);

const salida = ref(false);
const saliendo = ref(false);
const exportando = ref(false);
const avisoDeExportacion = ref<string | null>(null);

const sinSlug = computed(() => slug.value === '');

const peticiones = computed<readonly PeticionCompartida[]>(
  () => coleccion.value?.requests ?? [],
);

const peticionAbierta = computed<PeticionCompartida | null>(() => {
  const id = seleccionada.value;
  if (id === null) return null;
  return peticiones.value.find((peticion) => peticion.id === id) ?? null;
});

const coleccionVacia = computed(
  () => coleccion.value !== null && peticiones.value.length === 0,
);

const puedeExportar = computed(() => sesion.value?.canExport === true);
const puedeEjecutar = computed(() => sesion.value?.canExecute === true);

const etiquetaDePermiso = computed(() => {
  const permiso = sesion.value?.permission ?? '';
  if (permiso === 'viewer') return 'Solo lectura';
  if (permiso === 'viewer_export') return 'Lectura y exportación';
  if (permiso === 'executor') return 'Lectura y ejecución';
  return permiso === '' ? 'Permiso sin determinar' : permiso;
});

const formateadorDeFecha = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'long',
  timeStyle: 'short',
});

const caducaEl = computed(() => {
  const iso = sesion.value?.expiresAt ?? '';
  if (iso === '') return '';
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? '' : formateadorDeFecha.format(fecha);
});

/**
 * Reparte un fallo entre «no has entrado» y «algo se ha roto».
 *
 * `401 invalid_access` es **la** respuesta de acceso denegado, idéntica para
 * las seis causas. Cualquier otra cosa (500, red caída) sí es un fallo técnico
 * y merece su propio mensaje: confundirlos haría que un servidor caído
 * pareciese un código mal escrito y el visitante probaría el código cien veces.
 */
function repartirFallo(fallo: unknown): void {
  if (fallo instanceof ErrorDeApi && (fallo.estado === 401 || fallo.estado === 403)) {
    accesoFallido.value = true;
    pidiendoCodigo.value = true;
    return;
  }
  errorTecnico.value = mensajeDeError(fallo);
}

async function cargarContenido(): Promise<void> {
  cargandoContenido.value = true;
  try {
    // En serie y no en paralelo a propósito: si la sesión no vale, no tiene
    // sentido pedir el contenido, y dos 401 simultáneos ensucian el reparto
    // de errores.
    sesion.value = await consultarSesionCompartida();
    coleccion.value = await leerColeccionCompartida();
    pidiendoCodigo.value = false;
    accesoFallido.value = false;
  } finally {
    cargandoContenido.value = false;
  }
}

async function entrar(codigo: string | null): Promise<void> {
  if (entrando.value) return;
  entrando.value = true;
  accesoFallido.value = false;
  errorTecnico.value = null;
  try {
    await abrirSesionDeComparticion(slug.value, codigo);
    await cargarContenido();
  } catch (fallo) {
    sesion.value = null;
    coleccion.value = null;
    repartirFallo(fallo);
  } finally {
    entrando.value = false;
  }
}

async function iniciar(): Promise<void> {
  if (sinSlug.value) {
    comprobando.value = false;
    return;
  }
  comprobando.value = true;
  errorTecnico.value = null;
  try {
    const estado = await consultarEstadoDeEnlace(slug.value);
    comprobando.value = false;
    if (estado === 'open') {
      // Sin código: el esquema del servidor lo declara `nullish`.
      await entrar(null);
      return;
    }
    pidiendoCodigo.value = true;
  } catch (fallo) {
    comprobando.value = false;
    // `GET /share/:slug` no devuelve 401 por un enlace malo —devuelve 200 con
    // `code_required`—, así que un fallo aquí es técnico de verdad.
    errorTecnico.value = mensajeDeError(fallo);
  }
}

function alEnviarCodigo(codigo: string): void {
  void entrar(codigo);
}

function seleccionar(peticionId: string): void {
  seleccionada.value = seleccionada.value === peticionId ? null : peticionId;
}

async function salir(): Promise<void> {
  if (saliendo.value) return;
  saliendo.value = true;
  try {
    await cerrarSesionCompartida();
  } catch {
    // Si el cierre falla, la sesión del servidor puede seguir viva, pero esta
    // pestaña ya no la va a usar: se limpia igual y se dice que se ha salido.
    // Dejar la colección en pantalla porque el `logout` dio error sería lo
    // contrario de lo que el usuario acaba de pedir.
  } finally {
    saliendo.value = false;
    sesion.value = null;
    coleccion.value = null;
    seleccionada.value = null;
    pidiendoCodigo.value = false;
    salida.value = true;
  }
}

async function exportar(): Promise<void> {
  if (exportando.value || !puedeExportar.value) return;
  exportando.value = true;
  avisoDeExportacion.value = null;
  try {
    const sobre = await exportarColeccionCompartida();
    descargar(sobre);
  } catch (fallo) {
    avisoDeExportacion.value = mensajeDeError(fallo);
  } finally {
    exportando.value = false;
  }
}

/**
 * Descarga el JSON exportado.
 *
 * `URL.createObjectURL` no existe en jsdom ni en navegadores muy antiguos. Si
 * falta, se dice; perder la exportación en silencio sería peor.
 */
function descargar(sobre: Record<string, unknown>): void {
  const nombre = `${coleccion.value?.slug ?? 'coleccion'}.ceiba.json`;
  const texto = JSON.stringify(sobre, null, 2);
  const crearUrl = globalThis.URL?.createObjectURL;
  if (typeof crearUrl !== 'function' || typeof document === 'undefined') {
    avisoDeExportacion.value =
      'Este navegador no permite descargar el fichero automáticamente.';
    return;
  }
  const blob = new Blob([texto], { type: 'application/json' });
  const url = crearUrl.call(globalThis.URL, blob);
  const ancla = document.createElement('a');
  ancla.href = url;
  ancla.download = nombre;
  ancla.click();
  globalThis.URL.revokeObjectURL?.(url);
  avisoDeExportacion.value = null;
}

/**
 * Envuelve un nombre de variable en sus llaves: `base_url` → `{{base_url}}`.
 *
 * Se construye AQUÍ y no en la plantilla porque el analizador de plantillas de
 * Vue no sabe distinguir unas llaves literales dentro de una interpolación de
 * la propia interpolación, y aborta con «Unterminated string constant».
 * Medido en este entorno (Vue 3.5.44) al escribir esta vista.
 */
function conLlaves(nombre: string): string {
  return `{{${nombre}}}`;
}

function reintentar(): void {
  salida.value = false;
  accesoFallido.value = false;
  errorTecnico.value = null;
  void iniciar();
}

onMounted(() => {
  void iniciar();
});
</script>

<template>
  <main class="compartida">
    <!-- ───────────────────────── Carga inicial ───────────────────────── -->
    <CeibaLoadingScreen
      v-if="comprobando"
      inline
      size="md"
      message="Abriendo el enlace compartido…"
      detail="Comprobando si pide código"
    />

    <!-- ──────────────────────── Enlace incompleto ────────────────────── -->
    <section v-else-if="sinSlug" class="compartida__tarjeta">
      <CeibaAviso tono="error" titulo="Enlace incompleto">
        Este enlace no incluye ningún identificador de colección. Pide a quien te lo compartió
        que te reenvíe el enlace completo.
      </CeibaAviso>
    </section>

    <!-- ──────────────────────── Fallo técnico ────────────────────────── -->
    <section v-else-if="errorTecnico" class="compartida__tarjeta">
      <CeibaAviso tono="error" titulo="No se ha podido abrir el enlace">
        {{ errorTecnico }}
      </CeibaAviso>
      <p class="compartida__nota">
        Esto no significa que el enlace sea incorrecto: no se ha podido contactar con el
        servidor o ha respondido con un fallo.
      </p>
      <div class="compartida__acciones">
        <CeibaBoton variante="secundario" @click="reintentar">Reintentar</CeibaBoton>
      </div>
    </section>

    <!-- ──────────────────────── Sesión cerrada ───────────────────────── -->
    <section v-else-if="salida" class="compartida__tarjeta">
      <CeibaVacio
        titulo="Has salido de la colección compartida"
        detalle="La sesión se ha cerrado. Puedes volver a entrar con el mismo enlace."
      >
        <CeibaBoton variante="primario" @click="reintentar">Volver a entrar</CeibaBoton>
      </CeibaVacio>
    </section>

    <!-- ───────────────────────── Pide código ─────────────────────────── -->
    <section v-else-if="pidiendoCodigo" class="compartida__tarjeta">
      <FormularioDeCodigoCompartido
        :enviando="entrando || cargandoContenido"
        :fallido="accesoFallido"
        @enviar="alEnviarCodigo"
      />
    </section>

    <!-- ─────────────────── Abriendo un enlace sin código ─────────────── -->
    <section v-else-if="entrando || cargandoContenido" class="compartida__tarjeta">
      <CeibaLoadingScreen
        inline
        size="md"
        message="Entrando en la colección…"
        detail="Abriendo la sesión de compartición"
      />
    </section>

    <!-- ───────────────────────── Contenido ───────────────────────────── -->
    <template v-else-if="coleccion">
      <header class="compartida__cabecera">
        <div class="compartida__identidad">
          <CeibaMark :size="36" class="compartida__marca" />
          <div class="compartida__textos">
            <p class="compartida__migas">Colección compartida contigo</p>
            <h1 class="compartida__titulo">{{ coleccion.name }}</h1>
            <p v-if="coleccion.description" class="compartida__descripcion">
              {{ coleccion.description }}
            </p>
          </div>
        </div>
        <div class="compartida__acciones">
          <CeibaBoton
            v-if="puedeExportar"
            variante="secundario"
            :cargando="exportando"
            @click="exportar"
          >
            Exportar
          </CeibaBoton>
          <CeibaBoton variante="fantasma" :cargando="saliendo" @click="salir">
            Salir
          </CeibaBoton>
        </div>
      </header>

      <div class="compartida__insignias">
        <span class="compartida__insignia">{{ etiquetaDePermiso }}</span>
        <span class="compartida__insignia compartida__insignia--neutra">
          {{ coleccion.requestCount }}
          {{ coleccion.requestCount === 1 ? 'petición' : 'peticiones' }}
        </span>
        <span v-if="caducaEl" class="compartida__insignia compartida__insignia--neutra">
          El acceso caduca el {{ caducaEl }}
        </span>
      </div>

      <CeibaAviso v-if="avisoDeExportacion" tono="aviso" titulo="No se pudo exportar">
        {{ avisoDeExportacion }}
      </CeibaAviso>

      <p class="compartida__lectura">
        Esta es una vista de solo lectura. Los valores marcados como secretos no se comparten
        nunca por un enlace público.
      </p>

      <section v-if="coleccion.expectedVariables.length > 0" class="compartida__variables">
        <h2 class="compartida__subtitulo">Variables que espera la colección</h2>
        <ul class="compartida__fichas">
          <li v-for="nombre in coleccion.expectedVariables" :key="nombre">
            <code>{{ conLlaves(nombre) }}</code>
          </li>
        </ul>
        <p class="compartida__nota">
          Se publican los nombres, nunca los valores: los valores viven en los entornos del
          propietario.
        </p>
      </section>

      <!-- Colección sin peticiones -->
      <CeibaVacio
        v-if="coleccionVacia"
        titulo="Esta colección todavía no tiene peticiones"
        detalle="Quien la compartió aún no ha añadido ninguna, o las que hay no entran en este enlace."
      />

      <div v-else class="compartida__cuerpo">
        <section class="compartida__panel" aria-label="Peticiones de la colección">
          <h2 class="compartida__subtitulo">Peticiones</h2>
          <ListaDePeticionesCompartidas
            :peticiones="peticiones"
            :carpetas="coleccion.folders"
            :seleccionada="seleccionada"
            @seleccionar="seleccionar"
          />
        </section>

        <section class="compartida__panel compartida__panel--detalle" aria-live="polite">
          <DetalleDePeticionCompartida
            v-if="peticionAbierta"
            :peticion="peticionAbierta"
            :puede-ejecutar="puedeEjecutar"
          />
          <CeibaVacio
            v-else
            titulo="Elige una petición"
            detalle="Pulsa cualquier petición de la lista para ver su URL, sus cabeceras y su cuerpo."
          />
        </section>
      </div>
    </template>
  </main>
</template>

<style scoped>
.compartida {
  max-width: 1100px;
  margin: var(--ceiba-space-6) auto;
  padding: 0 var(--ceiba-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-4);
}

.compartida__tarjeta {
  position: relative;
  min-height: 16rem;
  max-width: 620px;
  width: 100%;
  margin: 0 auto;
  padding: var(--ceiba-space-6);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-lg);
  background: var(--ceiba-surface);
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-4);
}

.compartida__cabecera {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ceiba-space-4);
  padding-bottom: var(--ceiba-space-4);
  border-bottom: 1px solid var(--ceiba-border);
}

.compartida__identidad {
  display: flex;
  align-items: flex-start;
  gap: var(--ceiba-space-3);
  min-width: 0;
}

.compartida__marca {
  color: var(--ceiba-accent);
  flex: none;
}

.compartida__textos {
  min-width: 0;
}

.compartida__migas {
  margin: 0;
  font-size: var(--ceiba-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ceiba-text-faint);
}

.compartida__titulo {
  margin: var(--ceiba-space-1) 0 0;
  font-size: var(--ceiba-text-2xl);
  color: var(--ceiba-text);
  overflow-wrap: anywhere;
}

.compartida__descripcion {
  margin: var(--ceiba-space-1) 0 0;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.compartida__acciones {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ceiba-space-2);
}

.compartida__insignias {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ceiba-space-2);
}

.compartida__insignia {
  display: inline-block;
  padding: var(--ceiba-space-1) var(--ceiba-space-3);
  border-radius: var(--ceiba-radius-pill);
  border: 1px solid var(--ceiba-accent);
  background: var(--ceiba-surface-overlay);
  color: var(--ceiba-accent);
  font-size: var(--ceiba-text-xs);
  font-weight: 600;
}

.compartida__insignia--neutra {
  border-color: var(--ceiba-border-strong);
  color: var(--ceiba-text-muted);
}

.compartida__lectura {
  margin: 0;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.compartida__variables {
  padding: var(--ceiba-space-4);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-md);
  background: var(--ceiba-surface-raised);
}

.compartida__fichas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ceiba-space-2);
  margin: var(--ceiba-space-2) 0;
  padding: 0;
  list-style: none;
}

.compartida__fichas code {
  display: inline-block;
  padding: var(--ceiba-space-1) var(--ceiba-space-2);
  border-radius: var(--ceiba-radius-sm);
  background: var(--ceiba-bg-sunken);
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-muted);
}

.compartida__subtitulo {
  margin: 0 0 var(--ceiba-space-3);
  font-size: var(--ceiba-text-sm);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ceiba-text-faint);
}

.compartida__cuerpo {
  display: grid;
  grid-template-columns: minmax(18rem, 24rem) 1fr;
  gap: var(--ceiba-space-4);
  align-items: start;
}

.compartida__panel {
  padding: var(--ceiba-space-4);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-lg);
  background: var(--ceiba-surface);
  min-width: 0;
}

.compartida__panel--detalle {
  min-height: 20rem;
}

.compartida__nota {
  margin: 0;
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

@media (max-width: 900px) {
  .compartida__cuerpo {
    grid-template-columns: 1fr;
  }
}
</style>
