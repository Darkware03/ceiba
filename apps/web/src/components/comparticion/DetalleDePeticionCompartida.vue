<script setup lang="ts">
/**
 * Detalle de una petición dentro de una colección compartida.
 *
 * **Es una vista de lectura y no lo disimula.** No hay botón de ejecutar, ni de
 * guardar, ni de editar, y los valores se pintan como texto, no en campos de
 * formulario. Un campo editable que no guarda es peor que no ofrecerlo: invita
 * a escribir y luego pierde lo escrito.
 *
 * El botón de ejecutar sólo aparecería si el enlace lo permitiese
 * (`canExecute`), y hoy **no se ofrece ni en ese caso**: ejecutar una petición
 * compartida exige un motor de ejecución para sesiones sin usuario, que no
 * forma parte de esta entrega. Se declara en el informe en vez de pintar un
 * botón que no hace nada. Lo que sí se refleja es el permiso, para que el
 * visitante sepa qué le concedieron.
 *
 * Los secretos los pinta `ValoresCompartidos`, que es el único sitio donde vive
 * esa regla.
 */
import { computed } from 'vue';

import type { PeticionCompartida } from '@/api/comparticion';
import ValoresCompartidos from '@/components/comparticion/ValoresCompartidos.vue';

const props = defineProps<{
  peticion: PeticionCompartida;
  /** El enlace permite ejecutar. Hoy sólo informa; ver comentario de cabecera. */
  puedeEjecutar?: boolean;
}>();

const cuerpo = computed(() => props.peticion.body);

/** Modos de cuerpo que llevan filas clave/valor en vez de texto crudo. */
const MODOS_DE_CAMPOS = new Set(['form_urlencoded', 'multipart_form_data']);

const cuerpoTieneCampos = computed(
  () => cuerpo.value !== null && MODOS_DE_CAMPOS.has(cuerpo.value.mode),
);

const hayEjemplo = computed(
  () => cuerpo.value !== null && typeof cuerpo.value.example === 'string' && cuerpo.value.example !== '',
);

/**
 * `none` es un modo real del enum, no una ausencia de cuerpo. Se distingue:
 * «sin cuerpo» y «el propietario no publicó el ejemplo» no son lo mismo.
 */
const sinCuerpo = computed(() => cuerpo.value === null || cuerpo.value.mode === 'none');

const haySecretos = computed(
  () =>
    props.peticion.headers.some((h) => h.secret) ||
    props.peticion.params.some((p) => p.secret) ||
    (cuerpo.value?.fields ?? []).some((f) => f.secret),
);

const tiempoLimite = computed(() =>
  props.peticion.timeoutMs === null ? '' : `${props.peticion.timeoutMs} ms`,
);
</script>

<template>
  <article class="detalle" :aria-label="`Detalle de ${peticion.name}`">
    <header class="detalle__cabecera">
      <span class="detalle__metodo">{{ peticion.method }}</span>
      <h2 class="detalle__titulo">{{ peticion.name }}</h2>
    </header>

    <p class="detalle__url"><code>{{ peticion.url }}</code></p>

    <p v-if="peticion.description" class="detalle__descripcion">{{ peticion.description }}</p>

    <dl class="detalle__meta">
      <div class="detalle__meta-fila">
        <dt>Autenticación</dt>
        <dd>{{ peticion.authMode }}</dd>
      </div>
      <div v-if="tiempoLimite" class="detalle__meta-fila">
        <dt>Tiempo límite</dt>
        <dd>{{ tiempoLimite }}</dd>
      </div>
      <div v-if="cuerpo" class="detalle__meta-fila">
        <dt>Modo de cuerpo</dt>
        <dd><code>{{ cuerpo.mode }}</code></dd>
      </div>
      <div v-if="cuerpo?.contentType" class="detalle__meta-fila">
        <dt>Content-Type</dt>
        <dd><code>{{ cuerpo.contentType }}</code></dd>
      </div>
    </dl>

    <p v-if="haySecretos" class="detalle__nota detalle__nota--secretos">
      Esta petición usa valores secretos. Se indica que existen, pero su contenido no se
      comparte nunca por un enlace público.
    </p>

    <p
      v-if="peticion.hasPreRequestScript || peticion.hasPostResponseScript"
      class="detalle__nota"
    >
      La petición tiene
      <template v-if="peticion.hasPreRequestScript && peticion.hasPostResponseScript">
        guiones previos y posteriores
      </template>
      <template v-else-if="peticion.hasPreRequestScript">un guion previo</template>
      <template v-else>un guion posterior</template>
      definidos por el propietario. Su contenido no se publica.
    </p>

    <ValoresCompartidos
      titulo="Cabeceras"
      :valores="peticion.headers"
      vacio="Esta petición no define cabeceras."
    />

    <ValoresCompartidos
      titulo="Parámetros de consulta"
      :valores="peticion.params"
      vacio="Esta petición no define parámetros de consulta."
    />

    <ValoresCompartidos
      v-if="cuerpoTieneCampos && cuerpo"
      titulo="Campos del cuerpo"
      :valores="cuerpo.fields"
      vacio="El cuerpo no define campos."
    />

    <section v-if="!sinCuerpo" class="detalle__cuerpo">
      <h3 class="detalle__subtitulo">Cuerpo</h3>
      <pre v-if="hayEjemplo && cuerpo" class="detalle__ejemplo"><code>{{ cuerpo.example }}</code></pre>
      <p v-else-if="!cuerpoTieneCampos" class="detalle__nota">
        El enlace no incluye el cuerpo de ejemplo. Quien lo compartió puede activarlo al
        generar el enlace.
      </p>
    </section>

    <p v-if="puedeEjecutar" class="detalle__nota">
      El enlace concede permiso de ejecución, pero esta pantalla de lectura todavía no
      ejecuta peticiones compartidas.
    </p>
  </article>
</template>

<style scoped>
.detalle {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-4);
}

.detalle__cabecera {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-3);
}

.detalle__metodo {
  flex: none;
  padding: var(--ceiba-space-1) var(--ceiba-space-3);
  border-radius: var(--ceiba-radius-sm);
  background: var(--ceiba-surface-overlay);
  color: var(--ceiba-accent);
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-sm);
  font-weight: 700;
}

.detalle__titulo {
  margin: 0;
  font-size: var(--ceiba-text-lg);
  color: var(--ceiba-text);
  overflow-wrap: anywhere;
}

.detalle__url {
  margin: 0;
  padding: var(--ceiba-space-3);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-md);
  background: var(--ceiba-bg-sunken);
}

.detalle__url code {
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
  overflow-wrap: anywhere;
}

.detalle__descripcion {
  margin: 0;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.detalle__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ceiba-space-2) var(--ceiba-space-5);
  margin: 0;
}

.detalle__meta-fila {
  display: flex;
  gap: var(--ceiba-space-2);
  font-size: var(--ceiba-text-xs);
}

.detalle__meta-fila dt {
  color: var(--ceiba-text-faint);
}

.detalle__meta-fila dd {
  margin: 0;
  color: var(--ceiba-text-muted);
}

.detalle__meta-fila code {
  font-family: var(--ceiba-font-mono);
}

.detalle__subtitulo {
  margin: 0 0 var(--ceiba-space-2);
  font-size: var(--ceiba-text-sm);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ceiba-text-faint);
}

.detalle__ejemplo {
  margin: 0;
  padding: var(--ceiba-space-3);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-md);
  background: var(--ceiba-bg-sunken);
  overflow-x: auto;
}

.detalle__ejemplo code {
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.detalle__nota {
  margin: 0;
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

.detalle__nota--secretos {
  color: var(--ceiba-warning);
}
</style>
