<script setup lang="ts">
/**
 * Resultado de «Copiar como cURL».
 *
 * QUÉ ENSEÑA ESTE DIÁLOGO Y POR QUÉ CADA COSA
 * -------------------------------------------
 *  1. **Las `advertencias` del servidor, arriba del todo y siempre que
 *     vengan.** Son el mecanismo del `BRIEF-FASE6` §2.4: «cuando una solicitud
 *     no pueda representarse completamente en cURL, informa de las
 *     limitaciones en lugar de generar una equivalencia falsa». Esconderlas
 *     detrás de un «copiado ✓» convertiría un comando incompleto en un comando
 *     aparentemente correcto, que es el fallo que esa regla existe para
 *     impedir.
 *  2. **El comando literal, en un campo seleccionable.** El portapapeles puede
 *     fallar (HTTP sin contexto seguro, permiso denegado) y entonces esto es lo
 *     único que salva la operación. Un diálogo que sólo dijese «copiado» sería
 *     inútil justo cuando no se copió.
 *  3. **Si se copió o no, dicho sin ambigüedad.** Y si no, por qué.
 *
 * EL TEXTO NO SE TOCA. Llega del servidor y se pinta tal cual: es el único que
 * sabe qué cabecera está marcada como secreta y, por tanto, el único que puede
 * sustituirla por un marcador. Cualquier «mejora» local del comando aquí sería
 * reintroducir la fuga que el servidor acaba de evitar.
 */
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import CeibaDialogo from '@/components/ui/CeibaDialogo.vue';
import type { EstadoDeCurl } from '@/stores/peticiones';

defineProps<{ estado: EstadoDeCurl; recopiando?: boolean }>();

const emitir = defineEmits<{ cerrar: []; recopiar: [] }>();

/**
 * Las dobles llaves van en una constante y no escritas en la plantilla: el
 * compilador de Vue las leería como una interpolación y cierra en el primer
 * `}}`. Medido: `Unterminated string constant`.
 */
const MARCADOR_DE_VARIABLE = '{{…}}';
</script>

<template>
  <CeibaDialogo
    abierto
    titulo="Comando cURL"
    :descripcion="`Generado por el servidor para «${estado.nombre}».`"
    @cerrar="emitir('cerrar')"
  >
    <CeibaAviso
      v-if="estado.advertencias.length > 0"
      tono="aviso"
      titulo="Este comando no representa la petición por completo"
    >
      <ul class="curl__advertencias">
        <li v-for="(aviso, indice) in estado.advertencias" :key="indice">{{ aviso }}</li>
      </ul>
    </CeibaAviso>

    <CeibaAviso v-if="estado.copiado" tono="exito" titulo="Copiado al portapapeles">
      Ya lo puedes pegar en una terminal.
    </CeibaAviso>
    <CeibaAviso v-else tono="aviso" titulo="No se pudo copiar automáticamente">
      {{ estado.motivoDeNoCopia }}
    </CeibaAviso>

    <label class="curl__etiqueta" for="curl-comando">Comando</label>
    <textarea
      id="curl-comando"
      class="curl__comando"
      readonly
      rows="7"
      spellcheck="false"
      :value="estado.comando"
    />

    <p class="curl__nota">
      Las variables <code>{{ MARCADOR_DE_VARIABLE }}</code> y los marcadores de secreto se
      conservan a propósito: el comando no lleva credenciales materializadas.
    </p>

    <template #acciones>
      <CeibaBoton variante="fantasma" @click="emitir('cerrar')">Cerrar</CeibaBoton>
      <CeibaBoton variante="primario" :cargando="recopiando === true" @click="emitir('recopiar')">
        Copiar de nuevo
      </CeibaBoton>
    </template>
  </CeibaDialogo>
</template>

<style scoped>
.curl__advertencias {
  margin: 0;
  padding-left: var(--ceiba-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
}

.curl__etiqueta {
  font-size: var(--ceiba-text-sm);
  font-weight: 500;
  color: var(--ceiba-text-muted);
}

.curl__comando {
  width: 100%;
  padding: var(--ceiba-space-3);
  background: var(--ceiba-bg-sunken);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-md);
  color: var(--ceiba-text);
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-sm);
  line-height: 1.5;
  resize: vertical;
}

.curl__comando:focus-visible {
  outline: none;
  box-shadow: var(--ceiba-focus-ring);
}

.curl__nota {
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}
</style>
