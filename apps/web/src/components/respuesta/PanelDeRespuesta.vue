<script setup lang="ts">
/**
 * Panel de respuesta.
 *
 * Enseña lo que exige la §8 del encargo: **código HTTP con su descripción,
 * tiempo total, tamaño, cabeceras y cuerpo formateado**.
 *
 * LA PARTE QUE SE SUELE HACER MAL — EL ERROR DE CONEXIÓN. Cuando no hay
 * respuesta (`outcome: 'failed'`, `response: null`) este panel **no pinta
 * ningún código de estado**. Nada de un «0» con pinta de HTTP: cero no es un
 * estado HTTP, es la marca de «aquí no supimos qué poner», y confunde a quien
 * depura porque parece que el servidor contestó algo. Se enseña el código del
 * vocabulario del motor (`CONNECTION_REFUSED`, `DNS_FAILURE`, …) y su mensaje.
 */
import { computed, ref } from 'vue';
import { CeibaSpinner } from '@ceiba/brand';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaVacio from '@/components/ui/CeibaVacio.vue';
import TablaDeCabeceras from './TablaDeCabeceras.vue';
import VisorDeCuerpo from './VisorDeCuerpo.vue';
import {
  buscarCabecera,
  familiaDeEstado,
  formatearDuracion,
  formatearTamano,
  textoDeEstado,
} from '@/api/ejecucion';
import type { ResultadoDeEjecucion } from '@/api/ejecucion';

const props = withDefaults(
  defineProps<{
    resultado: ResultadoDeEjecucion | null;
    ejecutando?: boolean;
    /** Error de la propia interfaz, no del destino. */
    error?: string | null;
  }>(),
  { ejecutando: false, error: null },
);

type Pestana = 'cuerpo' | 'cabeceras';
const pestana = ref<Pestana>('cuerpo');

const respuesta = computed(() => props.resultado?.response ?? null);
const falloDeEjecucion = computed(() => props.resultado?.error ?? null);

/** `true` sólo cuando hubo respuesta HTTP de verdad. */
const hayEstado = computed(() => respuesta.value !== null);

const familia = computed(() =>
  respuesta.value === null ? 'otra' : familiaDeEstado(respuesta.value.status),
);

const descripcionDeEstado = computed(() =>
  respuesta.value === null ? '' : textoDeEstado(respuesta.value.status, respuesta.value.statusText),
);

const tiempoTotal = computed(() =>
  props.resultado === null ? '—' : formatearDuracion(props.resultado.timings.totalMs),
);

const tamano = computed(() =>
  respuesta.value === null ? '—' : formatearTamano(respuesta.value.sizeBytes),
);

const tipoDeContenido = computed(() =>
  respuesta.value === null ? null : buscarCabecera(respuesta.value.headers, 'content-type'),
);

const numeroDeCabeceras = computed(() => respuesta.value?.headers.length ?? 0);

const ejecutadoEnNavegador = computed(() => props.resultado?.adaptador === 'navegador');
</script>

<template>
  <section class="panel" aria-label="Respuesta">
    <!-- 1. En vuelo -->
    <div v-if="ejecutando" class="panel__cargando" data-prueba="ejecutando">
      <CeibaSpinner size="md" />
      <p>Ejecutando la solicitud…</p>
    </div>

    <!-- 2. Fallo de la propia interfaz -->
    <CeibaAviso v-else-if="error" tono="error" titulo="No se pudo ejecutar">
      {{ error }}
    </CeibaAviso>

    <!-- 3. Todavía no se ha enviado nada -->
    <CeibaVacio
      v-else-if="resultado === null"
      titulo="Sin respuesta todavía"
      detalle="Compón la solicitud y pulsa Enviar para ver aquí el resultado."
      data-prueba="sin-respuesta"
    />

    <!-- 4. Hubo ejecución pero NO hubo respuesta: error de conexión -->
    <div v-else-if="!hayEstado" class="panel__error" data-prueba="error-de-ejecucion">
      <CeibaAviso tono="error" titulo="Sin respuesta del destino">
        <p data-prueba="mensaje-de-error">
          {{ falloDeEjecucion?.message ?? 'La ejecución falló sin devolver respuesta.' }}
        </p>
        <p class="panel__codigo-error">
          Código del motor:
          <code data-prueba="codigo-de-error">{{ falloDeEjecucion?.code ?? 'desconocido' }}</code>
        </p>
        <p class="panel__sin-estado">
          No llegó ninguna respuesta HTTP, así que no hay código de estado que mostrar.
        </p>
      </CeibaAviso>

      <dl class="panel__metricas">
        <div class="panel__metrica">
          <dt>Tiempo hasta el fallo</dt>
          <dd data-prueba="tiempo-total">{{ tiempoTotal }}</dd>
        </div>
        <div class="panel__metrica">
          <dt>Destino</dt>
          <dd class="panel__url">{{ resultado.urlEfectiva }}</dd>
        </div>
      </dl>
    </div>

    <!-- 5. Respuesta normal -->
    <div v-else class="panel__contenido">
      <header class="panel__resumen">
        <p class="panel__estado" :class="`panel__estado--${familia}`" data-prueba="estado">
          <span class="panel__codigo" data-prueba="estado-codigo">{{ respuesta?.status }}</span>
          <span class="panel__descripcion" data-prueba="estado-texto">
            {{ descripcionDeEstado }}
          </span>
        </p>

        <dl class="panel__metricas">
          <div class="panel__metrica">
            <dt>Tiempo</dt>
            <dd data-prueba="tiempo-total">{{ tiempoTotal }}</dd>
          </div>
          <div class="panel__metrica">
            <dt>Tamaño</dt>
            <dd data-prueba="tamano">{{ tamano }}</dd>
          </div>
          <div v-if="respuesta && respuesta.httpVersion.length > 0" class="panel__metrica">
            <dt>Protocolo</dt>
            <dd>{{ respuesta.httpVersion }}</dd>
          </div>
          <div v-if="resultado.redirects.length > 0" class="panel__metrica">
            <dt>Redirecciones</dt>
            <dd>{{ resultado.redirects.length }}</dd>
          </div>
        </dl>
      </header>

      <p class="panel__modo" data-prueba="modo-de-ejecucion">
        Ejecutado
        {{ ejecutadoEnNavegador ? 'directamente desde el navegador' : 'a través de la API' }}.
        <template v-if="resultado.cabecerasIgnoradas.length > 0">
          El navegador descartó: {{ resultado.cabecerasIgnoradas.join(', ') }}.
        </template>
      </p>

      <div class="panel__pestanas" role="tablist" aria-label="Partes de la respuesta">
        <button
          class="panel__pestana"
          :class="{ 'panel__pestana--activa': pestana === 'cuerpo' }"
          type="button"
          role="tab"
          :aria-selected="pestana === 'cuerpo'"
          @click="pestana = 'cuerpo'"
        >
          Cuerpo
        </button>
        <button
          class="panel__pestana"
          :class="{ 'panel__pestana--activa': pestana === 'cabeceras' }"
          type="button"
          role="tab"
          :aria-selected="pestana === 'cabeceras'"
          data-prueba="pestana-cabeceras"
          @click="pestana = 'cabeceras'"
        >
          Cabeceras ({{ numeroDeCabeceras }})
        </button>
      </div>

      <div v-show="pestana === 'cuerpo'" class="panel__panel">
        <VisorDeCuerpo
          v-if="respuesta"
          :cuerpo="respuesta.body"
          :tipo-contenido="tipoDeContenido"
          :truncado="respuesta.bodyTruncated"
        />
      </div>

      <div v-show="pestana === 'cabeceras'" class="panel__panel">
        <TablaDeCabeceras
          v-if="respuesta"
          :cabeceras="respuesta.headers"
          :aviso-de-cors="ejecutadoEnNavegador"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}

.panel__cargando {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ceiba-space-3);
  padding: var(--ceiba-space-7) var(--ceiba-space-4);
  color: var(--ceiba-text-muted);
}

.panel__contenido,
.panel__error {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-3);
  min-height: 0;
}

.panel__resumen {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ceiba-space-4);
}

.panel__estado {
  display: inline-flex;
  align-items: baseline;
  gap: var(--ceiba-space-2);
  padding: var(--ceiba-space-1) var(--ceiba-space-3);
  border: 1px solid currentcolor;
  border-radius: var(--ceiba-radius-pill);
  font-family: var(--ceiba-font-mono);
}

.panel__codigo {
  font-size: var(--ceiba-text-lg);
  font-weight: 600;
}

.panel__descripcion {
  font-size: var(--ceiba-text-sm);
}

/* Color por familia de estado. Todo sale de los tokens de marca. */
.panel__estado--exito {
  color: var(--ceiba-success);
}
.panel__estado--redireccion {
  color: var(--ceiba-info);
}
.panel__estado--cliente {
  color: var(--ceiba-warning);
}
.panel__estado--servidor {
  color: var(--ceiba-danger);
}
.panel__estado--info,
.panel__estado--otra {
  color: var(--ceiba-text-muted);
}

.panel__metricas {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ceiba-space-4);
  margin: 0;
}

.panel__metrica dt {
  font-size: var(--ceiba-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ceiba-text-faint);
}

.panel__metrica dd {
  margin: 0;
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text);
}

.panel__url {
  word-break: break-all;
}

.panel__modo,
.panel__codigo-error,
.panel__sin-estado {
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

.panel__codigo-error code {
  color: var(--ceiba-danger);
}

.panel__pestanas {
  display: inline-flex;
  gap: var(--ceiba-space-1);
  border-bottom: 1px solid var(--ceiba-border);
}

.panel__pestana {
  padding: var(--ceiba-space-2) var(--ceiba-space-3);
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--ceiba-text-muted);
  font-family: inherit;
  font-size: var(--ceiba-text-sm);
  cursor: pointer;
}

.panel__pestana--activa {
  color: var(--ceiba-text);
  border-bottom-color: var(--ceiba-accent);
  font-weight: 600;
}

.panel__pestana:focus-visible {
  outline: none;
  box-shadow: var(--ceiba-focus-ring);
}

.panel__panel {
  min-height: 0;
}
</style>
