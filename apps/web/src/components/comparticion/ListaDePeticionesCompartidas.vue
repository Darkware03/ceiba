<script setup lang="ts">
/**
 * Lista de las peticiones de una colección compartida.
 *
 * Dos decisiones que conviene dejar escritas:
 *
 *  1. **No cuesta una segunda llamada.** `GET /share/content/collection`
 *     devuelve `requests[]` embebidas dentro de `ColeccionPublicada`
 *     (`publication.ts`), así que la lista se pinta con lo que ya se trajo al
 *     abrir la sesión. Pedir `/share/content/requests/:id` para cada fila sería
 *     N peticiones para datos que ya están en memoria.
 *
 *  2. **Las carpetas se usan para agrupar, no para navegar.** La colección trae
 *     `folders[]` con `parentFolderId` y `depth`, pero esta es una vista de
 *     **lectura** para alguien que llega de un chat: un árbol plegable aquí
 *     esconde peticiones detrás de un gesto más. Se agrupa por carpeta, con la
 *     ruta de la carpeta como encabezado, y todo visible.
 *
 * Es una lista de selección, así que es `role="listbox"` con
 * `aria-selected`: un lector de pantalla tiene que poder saber cuál está
 * abierta, y «un botón pulsado» no transmite eso.
 */
import { computed } from 'vue';

import type { CarpetaCompartida, PeticionCompartida } from '@/api/comparticion';

const props = withDefaults(
  defineProps<{
    peticiones: readonly PeticionCompartida[];
    carpetas?: readonly CarpetaCompartida[];
    seleccionada?: string | null;
  }>(),
  { carpetas: () => [], seleccionada: null },
);

const emitir = defineEmits<{ seleccionar: [peticionId: string] }>();

interface Grupo {
  readonly clave: string;
  readonly titulo: string;
  readonly peticiones: readonly PeticionCompartida[];
}

/** Ruta legible de una carpeta: «Padre / Hija». */
function rutaDeCarpeta(
  carpetaId: string,
  porId: ReadonlyMap<string, CarpetaCompartida>,
): string {
  const partes: string[] = [];
  let actual = porId.get(carpetaId);
  // Tope de profundidad: un `parentFolderId` cíclico por un dato corrupto no
  // puede colgar la interfaz del visitante.
  let guarda = 0;
  while (actual !== undefined && guarda < 32) {
    partes.unshift(actual.name);
    actual = actual.parentFolderId === null ? undefined : porId.get(actual.parentFolderId);
    guarda += 1;
  }
  return partes.join(' / ');
}

const grupos = computed<readonly Grupo[]>(() => {
  const porId = new Map(props.carpetas.map((carpeta) => [carpeta.id, carpeta]));
  const sueltas: PeticionCompartida[] = [];
  const porCarpeta = new Map<string, PeticionCompartida[]>();

  for (const peticion of props.peticiones) {
    const carpeta = peticion.folderId;
    if (carpeta === null || !porId.has(carpeta)) {
      sueltas.push(peticion);
      continue;
    }
    const cubo = porCarpeta.get(carpeta);
    if (cubo === undefined) porCarpeta.set(carpeta, [peticion]);
    else cubo.push(peticion);
  }

  const resultado: Grupo[] = [];
  if (sueltas.length > 0) {
    resultado.push({ clave: '__raiz', titulo: '', peticiones: sueltas });
  }
  for (const [carpetaId, lista] of porCarpeta) {
    resultado.push({
      clave: carpetaId,
      titulo: rutaDeCarpeta(carpetaId, porId),
      peticiones: lista,
    });
  }
  return resultado;
});

/** Clase de color por método: los tokens `--ceiba-method-*` ya existen. */
function claseDeMetodo(metodo: string): string {
  const conocidos = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
  const normal = metodo.toLowerCase();
  return conocidos.includes(normal) ? `peticiones__metodo--${normal}` : '';
}
</script>

<template>
  <div class="peticiones">
    <div
      v-for="grupo in grupos"
      :key="grupo.clave"
      class="peticiones__grupo"
    >
      <h3 v-if="grupo.titulo" class="peticiones__carpeta">{{ grupo.titulo }}</h3>
      <ul class="peticiones__lista" role="listbox" :aria-label="grupo.titulo || 'Peticiones'">
        <li
          v-for="peticion in grupo.peticiones"
          :key="peticion.id"
          role="option"
          class="peticiones__opcion"
          :aria-selected="peticion.id === seleccionada"
        >
          <button
            type="button"
            class="peticiones__boton"
            :class="{ 'peticiones__boton--activa': peticion.id === seleccionada }"
            :data-prueba="`peticion-${peticion.id}`"
            @click="emitir('seleccionar', peticion.id)"
          >
            <span class="peticiones__metodo" :class="claseDeMetodo(peticion.method)">
              {{ peticion.method }}
            </span>
            <span class="peticiones__texto">
              <span class="peticiones__nombre">{{ peticion.name }}</span>
              <span class="peticiones__url">{{ peticion.url }}</span>
            </span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.peticiones {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-4);
}

.peticiones__grupo {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-2);
}

.peticiones__carpeta {
  margin: 0;
  font-size: var(--ceiba-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ceiba-text-faint);
}

.peticiones__lista {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.peticiones__opcion {
  display: block;
}

.peticiones__boton {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-3);
  width: 100%;
  padding: var(--ceiba-space-2) var(--ceiba-space-3);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-md);
  background: var(--ceiba-surface-raised);
  color: var(--ceiba-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--ceiba-duration-fast) var(--ceiba-ease);
}

.peticiones__boton:hover {
  border-color: var(--ceiba-border-strong);
}

.peticiones__boton:focus-visible {
  outline: 2px solid var(--ceiba-focus-ring);
  outline-offset: 2px;
}

.peticiones__boton--activa {
  border-color: var(--ceiba-accent);
  background: var(--ceiba-accent-surface);
}

.peticiones__metodo {
  flex: none;
  min-width: 4.5rem;
  padding: var(--ceiba-space-1) var(--ceiba-space-2);
  border-radius: var(--ceiba-radius-sm);
  background: var(--ceiba-surface-overlay);
  color: var(--ceiba-text-muted);
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-xs);
  font-weight: 700;
  text-align: center;
}

.peticiones__metodo--get {
  color: var(--ceiba-method-get);
}
.peticiones__metodo--post {
  color: var(--ceiba-method-post);
}
.peticiones__metodo--put {
  color: var(--ceiba-method-put);
}
.peticiones__metodo--patch {
  color: var(--ceiba-method-patch);
}
.peticiones__metodo--delete {
  color: var(--ceiba-method-delete);
}
.peticiones__metodo--head {
  color: var(--ceiba-method-head);
}
.peticiones__metodo--options {
  color: var(--ceiba-method-options);
}

.peticiones__texto {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.peticiones__nombre {
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text);
}

.peticiones__url {
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
  overflow-wrap: anywhere;
}
</style>
