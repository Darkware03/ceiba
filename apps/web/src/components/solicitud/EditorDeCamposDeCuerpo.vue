<script setup lang="ts">
/**
 * Filas clave/valor de un cuerpo de formulario (P5 del `BRIEF-FASE7`).
 *
 * Sirve igual para `form_urlencoded` y para `multipart_form_data`; la
 * diferencia es que el primero **no admite ficheros**, y eso no se esconde:
 * el conmutador se deshabilita y se explica, en vez de dejar elegir algo que
 * luego no se enviaría.
 *
 * EL CONMUTADOR TEXTO/FICHERO ES POR FILA, Y ES EXCLUYENTE, porque así lo
 * impone el esquema: `ck_bodyfield_xor` permite **como mucho una** fuente de
 * valor por campo. Se refleja en la interfaz en lugar de dejar que el usuario
 * llene los dos y descubra el conflicto con un 500.
 *
 * NO MUTA LAS PROPS: emite y manda el almacén. Mismo criterio que
 * `EditorDePares.vue`, que es el hermano de este componente para cabeceras y
 * parámetros, y por el mismo motivo que allí se explica.
 */
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import SelectorDeFichero from './SelectorDeFichero.vue';
import type { CampoDeCuerpo, FicheroDeCuerpo } from '@/api/ejecucion';

withDefaults(
  defineProps<{
    campos: readonly CampoDeCuerpo[];
    /** `false` en `form_urlencoded`: un urlencoded no puede llevar ficheros. */
    admiteFicheros?: boolean;
    /** Workspace al que subir. `null` ⇒ el selector lo dice y se inhabilita. */
    workspaceId?: string | null;
  }>(),
  { admiteFicheros: true, workspaceId: null },
);

const emitir = defineEmits<{
  actualizar: [id: string, cambio: Partial<Pick<CampoDeCuerpo, 'nombre' | 'valor' | 'tipo' | 'activo'>>];
  fichero: [id: string, fichero: FicheroDeCuerpo | null];
  quitar: [id: string];
  anadir: [];
}>();

function texto(evento: Event): string {
  return (evento.target as HTMLInputElement).value;
}

function marcado(evento: Event): boolean {
  return (evento.target as HTMLInputElement).checked;
}
</script>

<template>
  <div class="campos">
    <div class="campos__cabecera" aria-hidden="true">
      <span class="campos__hueco" />
      <span>Clave</span>
      <span>Tipo</span>
      <span>Valor</span>
      <span class="campos__hueco" />
    </div>

    <ul class="campos__lista">
      <li v-for="campo in campos" :key="campo.id" class="campos__fila" data-prueba="campo-de-cuerpo">
        <input
          class="campos__casilla"
          type="checkbox"
          :checked="campo.activo"
          :aria-label="`Activar el campo ${campo.nombre || 'sin nombre'}`"
          @change="emitir('actualizar', campo.id, { activo: marcado($event) })"
        />

        <input
          class="campos__entrada"
          type="text"
          :value="campo.nombre"
          placeholder="Clave"
          :aria-label="'Clave del campo del cuerpo'"
          spellcheck="false"
          autocomplete="off"
          @input="emitir('actualizar', campo.id, { nombre: texto($event) })"
        />

        <select
          class="campos__tipo"
          :value="campo.tipo"
          :disabled="!admiteFicheros"
          :title="
            admiteFicheros
              ? undefined
              : 'Un cuerpo urlencoded no puede llevar ficheros. Cambia a formulario multiparte.'
          "
          :aria-label="`Tipo del campo ${campo.nombre || 'sin nombre'}`"
          @change="
            emitir('actualizar', campo.id, {
              tipo: ($event.target as HTMLSelectElement).value === 'fichero' ? 'fichero' : 'texto',
            })
          "
        >
          <option value="texto">Texto</option>
          <option value="fichero" :disabled="!admiteFicheros">Fichero</option>
        </select>

        <SelectorDeFichero
          v-if="campo.tipo === 'fichero'"
          compacto
          :fichero="campo.fichero"
          :workspace-id="workspaceId"
          proposito="form_field_file"
          :etiqueta="`fichero del campo ${campo.nombre || 'sin nombre'}`"
          @update:fichero="emitir('fichero', campo.id, $event)"
        />
        <input
          v-else
          class="campos__entrada"
          type="text"
          :value="campo.valor"
          placeholder="Valor"
          :aria-label="`Valor del campo ${campo.nombre || 'sin nombre'}`"
          spellcheck="false"
          autocomplete="off"
          @input="emitir('actualizar', campo.id, { valor: texto($event) })"
        />

        <button
          class="campos__quitar"
          type="button"
          :aria-label="`Quitar el campo ${campo.nombre || 'sin nombre'}`"
          @click="emitir('quitar', campo.id)"
        >
          ×
        </button>
      </li>
    </ul>

    <CeibaBoton variante="fantasma" compacto @click="emitir('anadir')">+ Añadir campo</CeibaBoton>
  </div>
</template>

<style scoped>
.campos {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-2);
  align-items: flex-start;
}

.campos__cabecera,
.campos__fila {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 96px minmax(0, 1.6fr) 28px;
  gap: var(--ceiba-space-2);
  align-items: center;
  width: 100%;
}

.campos__cabecera {
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.campos__lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
  width: 100%;
}

.campos__entrada,
.campos__tipo {
  width: 100%;
  min-width: 0;
  min-height: 30px;
  padding: var(--ceiba-space-1) var(--ceiba-space-2);
  background: var(--ceiba-bg-sunken);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-sm);
  color: var(--ceiba-text);
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-sm);
}

.campos__tipo {
  font-family: var(--ceiba-font-sans);
}

.campos__tipo:disabled {
  color: var(--ceiba-text-faint);
  cursor: not-allowed;
}

.campos__entrada::placeholder {
  color: var(--ceiba-text-faint);
}

.campos__entrada:focus-visible,
.campos__tipo:focus-visible {
  outline: none;
  box-shadow: var(--ceiba-focus-ring);
}

.campos__casilla {
  accent-color: var(--ceiba-accent);
  justify-self: center;
}

.campos__quitar {
  min-height: 26px;
  border: 1px solid transparent;
  border-radius: var(--ceiba-radius-sm);
  background: transparent;
  color: var(--ceiba-text-faint);
  font-size: var(--ceiba-text-lg);
  line-height: 1;
  cursor: pointer;
}

.campos__quitar:hover {
  color: var(--ceiba-danger);
  border-color: var(--ceiba-border);
}

.campos__quitar:focus-visible {
  outline: none;
  box-shadow: var(--ceiba-focus-ring);
}

@media (max-width: 760px) {
  .campos__cabecera {
    display: none;
  }

  .campos__fila {
    grid-template-columns: 24px minmax(0, 1fr) 28px;
    grid-template-areas:
      'casilla nombre quitar'
      '.       tipo   .'
      '.       valor  .';
  }

  .campos__casilla {
    grid-area: casilla;
  }
  .campos__fila > .campos__entrada:first-of-type {
    grid-area: nombre;
  }
  .campos__tipo {
    grid-area: tipo;
  }
  .campos__fila > .campos__entrada:last-of-type,
  .campos__fila > :deep(.fichero) {
    grid-area: valor;
  }
  .campos__quitar {
    grid-area: quitar;
  }
}
</style>
