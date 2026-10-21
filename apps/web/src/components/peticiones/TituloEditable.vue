<script setup lang="ts">
/**
 * Título del constructor, editable en el sitio (P2 del `BRIEF-FASE7`).
 *
 * El cliente pidió «que ya dentro de la petición permita modificar el nombre
 * de esta». Hasta la fase 7 el constructor pintaba el nombre dentro de un
 * `<h1>` de sólo lectura y para renombrar había que volver a la lista
 * (`FilaDePeticion.vue`), que es exactamente el viaje que molestaba.
 *
 * TRES DECISIONES QUE NO SON DE ESTILO
 * ------------------------------------
 *  1. **Sigue siendo un `<h1>` cuando no se edita.** Convertirlo en un
 *     `<input>` permanente le quitaría a la página su encabezado de nivel 1 y
 *     un lector de pantalla se quedaría sin el título de la vista. Se edita
 *     *sobre* el encabezado, no en lugar de él.
 *  2. **`Esc` cancela y `Enter` confirma**, como pide el brief, y `Esc` además
 *     **detiene la propagación**: si no, el diálogo o la vista de alrededor lo
 *     interpretaría como «cerrar» y el usuario perdería más de lo que quería.
 *  3. **Nombre vacío no se guarda.** Se rechaza, se dice por qué y el campo se
 *     queda abierto con lo que había. Descartar en silencio y volver al
 *     nombre anterior dejaría al usuario pensando que el teclado falló.
 *
 * No hace la escritura: emite. Quien persiste es el almacén, por el mismo
 * camino que cualquier otro campo (el autoguardado). Dos caminos de escritura
 * distintos para el nombre serían dos sitios donde se puede perder.
 */
import { computed, nextTick, ref, watch } from 'vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';

const props = withDefaults(
  defineProps<{
    /** Nombre actual. Si está vacío, se pinta el texto de respaldo. */
    nombre: string;
    /** Qué se escribe cuando no hay nombre (borrador sin guardar). */
    respaldo?: string;
    /** `false` ⇒ sólo lectura: no hay petición abierta que renombrar. */
    editable?: boolean;
    /** Validación del nombre; devuelve el error o `null`. */
    validar?: (nombre: string) => string | null;
  }>(),
  {
    respaldo: 'Constructor de solicitudes',
    editable: true,
    validar: () => null,
  },
);

const emitir = defineEmits<{
  /** Nombre nuevo, ya validado y recortado. */
  renombrar: [nombre: string];
  /** El usuario terminó de editar (confirmando o cancelando). */
  fin: [];
}>();

const editando = ref(false);
const borrador = ref('');
const error = ref<string | null>(null);
const campo = ref<HTMLInputElement | null>(null);

const textoVisible = computed(() =>
  props.nombre.trim().length > 0 ? props.nombre : props.respaldo,
);

/** Si el nombre cambia por fuera mientras se edita, no se pisa lo tecleado. */
watch(
  () => props.nombre,
  (nuevo) => {
    if (!editando.value) borrador.value = nuevo;
  },
  { immediate: true },
);

async function empezar(): Promise<void> {
  if (!props.editable) return;
  borrador.value = props.nombre;
  error.value = null;
  editando.value = true;
  await nextTick();
  campo.value?.focus();
  campo.value?.select();
}

function cancelar(): void {
  editando.value = false;
  error.value = null;
  borrador.value = props.nombre;
  emitir('fin');
}

function confirmar(): void {
  const fallo = props.validar(borrador.value);
  if (fallo !== null) {
    // No se cierra: cerrar aquí descartaría lo escrito, que es justo lo que
    // el brief prohíbe («nombre vacío no se guarda», no «se pierde»).
    error.value = fallo;
    return;
  }
  const limpio = borrador.value.trim();
  editando.value = false;
  error.value = null;
  if (limpio !== props.nombre) emitir('renombrar', limpio);
  emitir('fin');
}

function alTeclear(evento: KeyboardEvent): void {
  if (evento.key === 'Escape') {
    evento.preventDefault();
    evento.stopPropagation();
    cancelar();
    return;
  }
  if (evento.key === 'Enter') {
    evento.preventDefault();
    confirmar();
  }
}
</script>

<template>
  <div class="titulo">
    <template v-if="editando">
      <label class="titulo__etiqueta" for="titulo-de-la-peticion">Nombre de la petición</label>
      <div class="titulo__fila">
        <input
          id="titulo-de-la-peticion"
          ref="campo"
          v-model="borrador"
          class="titulo__campo"
          type="text"
          data-prueba="campo-de-nombre"
          spellcheck="false"
          autocomplete="off"
          :aria-invalid="error ? 'true' : undefined"
          aria-describedby="titulo-de-la-peticion-error"
          @keydown="alTeclear"
          @blur="confirmar"
        />
        <CeibaBoton compacto variante="primario" @mousedown.prevent @click="confirmar">
          Guardar nombre
        </CeibaBoton>
        <CeibaBoton compacto variante="fantasma" @mousedown.prevent @click="cancelar">
          Cancelar
        </CeibaBoton>
      </div>
      <p id="titulo-de-la-peticion-error" class="titulo__error" role="alert">
        <template v-if="error">{{ error }}</template>
      </p>
    </template>

    <template v-else>
      <h1 class="titulo__texto">{{ textoVisible }}</h1>
      <CeibaBoton
        v-if="editable"
        compacto
        variante="fantasma"
        data-prueba="renombrar-en-constructor"
        :aria-label="`Cambiar el nombre de la petición ${textoVisible}`"
        @click="empezar"
      >
        Cambiar nombre
      </CeibaBoton>
    </template>
  </div>
</template>

<style scoped>
.titulo {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ceiba-space-2);
  min-width: 0;
}

.titulo__texto {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.titulo__etiqueta {
  flex-basis: 100%;
  font-size: var(--ceiba-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ceiba-text-faint);
}

.titulo__fila {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ceiba-space-2);
  min-width: 0;
}

.titulo__campo {
  min-width: 0;
  flex: 1 1 18rem;
  min-height: 34px;
  padding: var(--ceiba-space-1) var(--ceiba-space-2);
  background: var(--ceiba-bg-sunken);
  border: 1px solid var(--ceiba-border-strong);
  border-radius: var(--ceiba-radius-md);
  color: var(--ceiba-text);
  font-family: inherit;
  font-size: var(--ceiba-text-xl);
  font-weight: 600;
}

.titulo__campo:focus-visible {
  outline: none;
  box-shadow: var(--ceiba-focus-ring);
}

.titulo__campo[aria-invalid='true'] {
  border-color: var(--ceiba-danger);
}

.titulo__error {
  flex-basis: 100%;
  min-height: 1.2em;
  margin: 0;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-danger);
}
</style>
