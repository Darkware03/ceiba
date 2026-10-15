<script setup lang="ts">
/**
 * Editor de pares clave/valor, reutilizado para cabeceras y para parámetros
 * de consulta. La casilla de activado permite desactivar una fila sin
 * perderla, que es lo que se hace todo el rato al depurar una API.
 *
 * NO MUTA LAS PROPS: emite `actualizar`, `quitar` y `anadir`, y quien manda
 * (el almacén) decide. Un componente que escribe dentro de la prop que recibe
 * funciona con Pinia por accidente y luego es imposible de probar.
 *
 * Aquí se usan `<input>` planos en lugar de `CeibaCampo`: ese componente pinta
 * su etiqueta ENCIMA del control, que es lo correcto en un formulario pero
 * rompe una rejilla de dos columnas con decenas de filas. La accesibilidad se
 * mantiene con `aria-label` por celda, que es lo que `CeibaCampo` aporta.
 */
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import type { Par } from '@/api/ejecucion';

withDefaults(
  defineProps<{
    pares: readonly Par[];
    /** Nombre en singular de lo que se edita: «cabecera», «parámetro». */
    sustantivo: string;
    etiquetaNombre?: string;
    etiquetaValor?: string;
    /** Nombres que hay que marcar como problemáticos (p. ej. prohibidos). */
    nombresConAviso?: readonly string[];
    tituloDelAviso?: string;
  }>(),
  {
    etiquetaNombre: 'Nombre',
    etiquetaValor: 'Valor',
    nombresConAviso: () => [],
    tituloDelAviso: '',
  },
);

const emitir = defineEmits<{
  actualizar: [id: string, campo: 'nombre' | 'valor', valor: string];
  alternar: [id: string, activo: boolean];
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
  <div class="pares">
    <div class="pares__cabecera" aria-hidden="true">
      <span class="pares__hueco" />
      <span>{{ etiquetaNombre }}</span>
      <span>{{ etiquetaValor }}</span>
      <span class="pares__hueco" />
    </div>

    <ul class="pares__lista">
      <li v-for="par in pares" :key="par.id" class="pares__fila">
        <input
          class="pares__casilla"
          type="checkbox"
          :checked="par.activo"
          :aria-label="`Activar ${sustantivo} ${par.nombre || 'sin nombre'}`"
          @change="emitir('alternar', par.id, marcado($event))"
        />

        <input
          class="pares__entrada pares__entrada--nombre"
          type="text"
          :value="par.nombre"
          :class="{ 'pares__entrada--aviso': nombresConAviso.includes(par.nombre.trim()) }"
          :title="nombresConAviso.includes(par.nombre.trim()) ? tituloDelAviso : undefined"
          :placeholder="etiquetaNombre"
          :aria-label="`${etiquetaNombre} de ${sustantivo}`"
          spellcheck="false"
          autocomplete="off"
          @input="emitir('actualizar', par.id, 'nombre', texto($event))"
        />

        <input
          class="pares__entrada"
          type="text"
          :value="par.valor"
          :placeholder="etiquetaValor"
          :aria-label="`${etiquetaValor} de ${sustantivo} ${par.nombre || 'sin nombre'}`"
          spellcheck="false"
          autocomplete="off"
          @input="emitir('actualizar', par.id, 'valor', texto($event))"
        />

        <button
          class="pares__quitar"
          type="button"
          :aria-label="`Quitar ${sustantivo} ${par.nombre || 'sin nombre'}`"
          @click="emitir('quitar', par.id)"
        >
          ×
        </button>
      </li>
    </ul>

    <CeibaBoton variante="fantasma" compacto @click="emitir('anadir')">
      + Añadir {{ sustantivo }}
    </CeibaBoton>
  </div>
</template>

<style scoped>
.pares {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-2);
  align-items: flex-start;
}

.pares__cabecera,
.pares__fila {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) minmax(0, 1.6fr) 28px;
  gap: var(--ceiba-space-2);
  align-items: center;
  width: 100%;
}

.pares__cabecera {
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.pares__lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
  width: 100%;
}

.pares__entrada {
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

.pares__entrada::placeholder {
  color: var(--ceiba-text-faint);
}

.pares__entrada:focus-visible {
  outline: none;
  box-shadow: var(--ceiba-focus-ring);
}

.pares__entrada--aviso {
  border-color: var(--ceiba-warning);
}

.pares__casilla {
  accent-color: var(--ceiba-accent);
  justify-self: center;
}

.pares__quitar {
  min-height: 26px;
  border: 1px solid transparent;
  border-radius: var(--ceiba-radius-sm);
  background: transparent;
  color: var(--ceiba-text-faint);
  font-size: var(--ceiba-text-lg);
  line-height: 1;
  cursor: pointer;
}

.pares__quitar:hover {
  color: var(--ceiba-danger);
  border-color: var(--ceiba-border);
}

.pares__quitar:focus-visible {
  outline: none;
  box-shadow: var(--ceiba-focus-ring);
}

@media (max-width: 640px) {
  .pares__cabecera {
    display: none;
  }

  .pares__fila {
    grid-template-columns: 24px minmax(0, 1fr) 28px;
    grid-template-areas:
      'casilla nombre quitar'
      '.       valor  .';
  }

  .pares__casilla {
    grid-area: casilla;
  }
  .pares__entrada--nombre {
    grid-area: nombre;
  }
  .pares__entrada:not(.pares__entrada--nombre) {
    grid-area: valor;
  }
  .pares__quitar {
    grid-area: quitar;
  }
}
</style>
