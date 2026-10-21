<script setup lang="ts">
/**
 * Selector de fichero para el cuerpo de la solicitud (P5 del `BRIEF-FASE7`).
 *
 * Sube con `POST /workspaces/:workspaceId/files` (§2.2) y enseña **nombre,
 * tipo y tamaño** de lo subido, que es literalmente lo que pide el §3.C.3. No
 * enseña los bytes ni los pide: el §2.2 dice «nunca bytes al cliente web» y
 * aquí lo único que se guarda es la referencia.
 *
 * POR QUÉ HACE FALTA EL `workspaceId` Y QUÉ PASA SI NO ESTÁ
 * ----------------------------------------------------------
 * La ruta de subida cuelga del workspace, no de la colección ni de la
 * petición. `GET /requests/:id` **no** devuelve `workspaceId` (comprobado en
 * `vistaResumen`/`vistaDetalle` de `request.service.ts`), así que el
 * constructor lo resuelve aparte. Si no se ha podido resolver, este control se
 * deshabilita y **dice por qué** en vez de ofrecer un botón que fallaría.
 *
 * El estándar visual §2.2.4 exige que el estado vacío, el de carga y el de
 * error existan y sean explícitos. Están los tres.
 */
import { computed, ref } from 'vue';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import { formatearTamano } from '@/api/ejecucion';
import { subirFichero } from '@/api/peticiones';
import { mensajeDeError } from '@/api/errores';
import type { FicheroDeCuerpo } from '@/api/ejecucion';

const props = withDefaults(
  defineProps<{
    fichero: FicheroDeCuerpo | null;
    /** `null` ⇒ no se puede subir; se explica en pantalla. */
    workspaceId: string | null;
    proposito?: 'form_field_file' | 'request_body_binary';
    /** Nombre accesible del control. */
    etiqueta?: string;
    deshabilitado?: boolean;
    compacto?: boolean;
  }>(),
  {
    proposito: 'form_field_file',
    etiqueta: 'Fichero',
    deshabilitado: false,
    compacto: false,
  },
);

const emitir = defineEmits<{ 'update:fichero': [valor: FicheroDeCuerpo | null] }>();

const subiendo = ref(false);
const error = ref<string | null>(null);
const entrada = ref<HTMLInputElement | null>(null);

const puedeSubir = computed(
  () => props.workspaceId !== null && !props.deshabilitado && !subiendo.value,
);

const descripcion = computed(() => {
  const f = props.fichero;
  if (f === null) return '';
  const partes: string[] = [];
  if (f.contentType !== null && f.contentType.length > 0) partes.push(f.contentType);
  if (f.sizeBytes !== null) partes.push(formatearTamano(f.sizeBytes));
  return partes.join(' · ');
});

async function alElegir(evento: Event): Promise<void> {
  const control = evento.target as HTMLInputElement;
  const elegido = control.files?.[0] ?? null;
  // Se limpia siempre: si no, elegir dos veces el mismo fichero no dispara
  // `change` y el usuario cree que la interfaz se ha colgado.
  control.value = '';
  if (elegido === null || props.workspaceId === null) return;

  subiendo.value = true;
  error.value = null;
  try {
    const subido = await subirFichero(props.workspaceId, elegido, props.proposito);
    emitir('update:fichero', {
      id: subido.id,
      fileName: subido.fileName,
      contentType: subido.contentType,
      sizeBytes: subido.sizeBytes,
    });
  } catch (fallo) {
    error.value = mensajeDeError(fallo);
  } finally {
    subiendo.value = false;
  }
}

function abrir(): void {
  entrada.value?.click();
}

function quitar(): void {
  error.value = null;
  emitir('update:fichero', null);
}
</script>

<template>
  <div class="fichero" :class="{ 'fichero--compacto': compacto }">
    <!--
      El `<input type="file">` nativo no se puede estilar y su texto lo pone el
      navegador en su idioma. Se oculta visualmente (NO con `display: none`,
      que lo sacaría del árbol de accesibilidad) y se acciona desde un
      `CeibaBoton`, que es el control compartido del estándar visual §2.2.5.
    -->
    <input
      ref="entrada"
      class="fichero__entrada"
      type="file"
      :aria-label="etiqueta"
      :disabled="!puedeSubir"
      @change="alElegir"
    />

    <div class="fichero__fila">
      <CeibaBoton
        compacto
        variante="secundario"
        :cargando="subiendo"
        :deshabilitado="!puedeSubir"
        :aria-label="fichero ? `Cambiar ${etiqueta}` : `Elegir ${etiqueta}`"
        data-prueba="elegir-fichero"
        @click="abrir"
      >
        {{ fichero ? 'Cambiar fichero' : 'Elegir fichero' }}
      </CeibaBoton>

      <span v-if="fichero" class="fichero__nombre" data-prueba="fichero-elegido">
        <span class="fichero__titulo">{{ fichero.fileName }}</span>
        <span v-if="descripcion" class="fichero__meta">{{ descripcion }}</span>
      </span>
      <span v-else-if="!subiendo" class="fichero__vacio">Sin fichero</span>

      <CeibaBoton
        v-if="fichero"
        compacto
        variante="fantasma"
        :aria-label="`Quitar ${etiqueta}`"
        :deshabilitado="deshabilitado"
        @click="quitar"
      >
        Quitar
      </CeibaBoton>
    </div>

    <p v-if="workspaceId === null" class="fichero__nota">
      No se puede subir todavía: el constructor aún no ha podido resolver a qué workspace
      pertenece esta petición.
    </p>

    <CeibaAviso v-if="error" tono="error" :titulo="`No se pudo subir ${etiqueta.toLowerCase()}`">
      {{ error }}
    </CeibaAviso>
  </div>
</template>

<style scoped>
.fichero {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
  min-width: 0;
}

/* Oculto a la vista pero presente para el teclado y el lector de pantalla. */
.fichero__entrada {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.fichero__entrada:focus-visible + .fichero__fila {
  box-shadow: var(--ceiba-focus-ring);
  border-radius: var(--ceiba-radius-sm);
}

.fichero__fila {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ceiba-space-2);
  min-width: 0;
}

.fichero__nombre {
  display: inline-flex;
  flex-direction: column;
  min-width: 0;
  font-size: var(--ceiba-text-xs);
}

.fichero__titulo {
  font-family: var(--ceiba-font-mono);
  color: var(--ceiba-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fichero__meta,
.fichero__vacio,
.fichero__nota {
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

.fichero__nota {
  margin: 0;
}

.fichero--compacto .fichero__fila {
  gap: var(--ceiba-space-1);
}
</style>
