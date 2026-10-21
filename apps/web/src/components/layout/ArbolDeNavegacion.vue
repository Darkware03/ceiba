<script setup lang="ts">
/**
 * Árbol de navegación del lateral (P3).
 *
 * Lo que pidió el cliente, literal: «cuando esté dentro de la colección en el
 * lateral me muestre los workspaces que he creado, dentro del workspace las
 * colecciones y dentro de las colecciones las peticiones que he creado».
 *
 * POR QUÉ UNA LISTA PLANA Y NO UN COMPONENTE RECURSIVO
 * ----------------------------------------------------
 * El árbol se aplana a un array de nodos visibles con su `nivel`. Dos motivos,
 * los dos prácticos:
 *
 *  1. **El teclado.** `ArrowDown` tiene que ir al siguiente nodo *visible*,
 *     que puede estar tres niveles más arriba en la jerarquía. Con un árbol
 *     recursivo eso obliga a que cada nodo conozca a sus tíos; con una lista
 *     plana es `indice + 1`. La navegación por teclado del patrón «Tree View»
 *     de WAI-ARIA se vuelve trivial y, sobre todo, comprobable.
 *  2. **`aria-level` / `aria-setsize` / `aria-posinset`.** WAI-ARIA admite
 *     explícitamente el árbol plano con esos tres atributos, y es la forma que
 *     mejor sobrevive a `v-for` sin anidar `role="group"` mal cerrados.
 *
 * Accesibilidad implementada, no prometida:
 *  - `role="tree"` en el contenedor y `role="treeitem"` en cada fila.
 *  - `aria-expanded` sólo en los nodos que **tienen** hijos (ponerlo en una
 *    hoja le dice al lector de pantalla que se puede desplegar, y no se puede).
 *  - `aria-selected` en el nodo de la ruta actual.
 *  - **Tabulador rodante**: un solo nodo tabulable; el resto se alcanza con
 *    las flechas. Un árbol con 40 nodos tabulables es una trampa de teclado.
 *  - `aria-busy` mientras una rama carga.
 *
 * Carga perezosa: al entrar sólo se piden los workspaces. Las colecciones se
 * piden al desplegar su workspace y las peticiones al desplegar su colección.
 *
 * QUÉ NODO ESTÁ ACTIVO: ENTRA POR `props`, NO POR `useRoute()`
 * ------------------------------------------------------------
 * Es la misma decisión que ya tomaron `VistaDeWorkspace.vue` y
 * `VistaDeColeccion.vue` cuando declararon `props: true` en la tabla de rutas,
 * y está escrita en sus cabeceras: «así el componente se monta en una prueba
 * sin instalar un router entero».
 *
 * Se intentó primero con `useRoute()` dentro de este componente y **no
 * compila en prueba**: sin un router instalado, `useRoute()` devuelve
 * `undefined` y el primer `computed` que lee `ruta.params` revienta con
 * `Cannot read properties of undefined (reading 'params')`. Medido, no
 * supuesto. Quien conoce la ruta es `BarraLateral.vue`, que sí vive dentro
 * del armazón con router; el árbol sólo recibe tres identificadores.
 */
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { CeibaSpinner } from '@ceiba/brand';
import { RUTA_COLECCION, RUTA_CONSTRUCTOR, RUTA_WORKSPACE } from '@/router/nombres';
import { usarAlmacenDelArbol } from '@/stores/arbol';
import { usarAlmacenDeColecciones } from '@/stores/colecciones';
import { usarAlmacenDeWorkspaces } from '@/stores/workspaces';
import type { RouteLocationRaw } from 'vue-router';

type TipoDeNodo = 'workspace' | 'coleccion' | 'peticion' | 'nota';

interface NodoVisible {
  readonly clave: string;
  readonly tipo: TipoDeNodo;
  readonly id: string;
  readonly etiqueta: string;
  readonly nivel: number;
  readonly desplegable: boolean;
  readonly desplegado: boolean;
  readonly activo: boolean;
  readonly ocupado: boolean;
  readonly verbo: string | null;
  readonly destino: RouteLocationRaw | null;
  /** Una nota («sin colecciones», un error) no se puede activar. */
  readonly inerte: boolean;
}

const props = withDefaults(
  defineProps<{
    /** `params.workspaceId` de la ruta actual, o `null`. */
    workspaceActivo?: string | null;
    /** `params.collectionId` de la ruta actual, o `null`. */
    coleccionActiva?: string | null;
    /** `query.peticion` de la ruta actual, o `null`. */
    peticionActiva?: string | null;
  }>(),
  { workspaceActivo: null, coleccionActiva: null, peticionActiva: null },
);

/**
 * El árbol **no navega**: avisa de a dónde hay que ir y `BarraLateral.vue`
 * hace el `push`. Por eso este componente no necesita router ni en producción
 * ni en prueba.
 */
const emitir = defineEmits<{ navegar: [destino: RouteLocationRaw] }>();

const arbol = usarAlmacenDelArbol();
const workspaces = usarAlmacenDeWorkspaces();
const colecciones = usarAlmacenDeColecciones();

/** Índice del único nodo tabulable (tabulador rodante). */
const enfocado = ref(0);
const contenedor = ref<HTMLElement | null>(null);

function identificador(valor: string | null | undefined): string | null {
  return typeof valor === 'string' && valor.length > 0 ? valor : null;
}

const workspaceDeLaRuta = computed(() => identificador(props.workspaceActivo));
const coleccionDeLaRuta = computed(() => identificador(props.coleccionActiva));
const peticionDeLaRuta = computed(() => identificador(props.peticionActiva));

/**
 * Qué nivel manda al marcar el nodo activo.
 *
 * UN ÁRBOL SIN `aria-multiselectable` TIENE **UN** NODO SELECCIONADO, no tres.
 * Estando en `/colecciones/col-1` el workspace `ws-1` es un *ancestro* del
 * nodo activo, no el nodo activo; marcar los dos con `aria-selected="true"`
 * le dice al lector de pantalla que hay dos cosas seleccionadas y deja al
 * usuario sin saber dónde está. Gana siempre el más específico.
 *
 * Los ancestros no se quedan sin señal: se ven desplegados, que es la señal
 * que el patrón «Tree View» reserva para ellos.
 */
const nivelActivo = computed<'peticion' | 'coleccion' | 'workspace' | null>(() => {
  if (peticionDeLaRuta.value !== null) return 'peticion';
  if (coleccionDeLaRuta.value !== null) return 'coleccion';
  if (workspaceDeLaRuta.value !== null) return 'workspace';
  return null;
});

/**
 * El árbol aplanado. Es un `computed`: no hay copia del estado que pueda
 * quedarse vieja, se deriva de los tres almacenes en cada cambio.
 */
const nodos = computed<NodoVisible[]>(() => {
  const salida: NodoVisible[] = [];

  for (const workspace of workspaces.lista) {
    const abierto = arbol.workspaceAbierto(workspace.id);
    salida.push({
      clave: `w:${workspace.id}`,
      tipo: 'workspace',
      id: workspace.id,
      etiqueta: workspace.name,
      nivel: 1,
      desplegable: true,
      desplegado: abierto,
      activo: nivelActivo.value === 'workspace' && workspaceDeLaRuta.value === workspace.id,
      ocupado: arbol.cargandoWorkspace(workspace.id),
      verbo: null,
      destino: { name: RUTA_WORKSPACE, params: { workspaceId: workspace.id } },
      inerte: false,
    });

    if (!abierto) continue;

    const lista = colecciones.deWorkspace(workspace.id);
    if (colecciones.cargada(workspace.id) && lista.length === 0) {
      salida.push(nota(`w:${workspace.id}:vacio`, 'Sin colecciones todavía', 2));
    }

    for (const coleccion of lista) {
      const desplegada = arbol.coleccionAbierta(coleccion.id);
      salida.push({
        clave: `c:${coleccion.id}`,
        tipo: 'coleccion',
        id: coleccion.id,
        etiqueta: coleccion.name,
        nivel: 2,
        desplegable: true,
        desplegado: desplegada,
        activo: nivelActivo.value === 'coleccion' && coleccionDeLaRuta.value === coleccion.id,
        ocupado: arbol.cargandoColeccion(coleccion.id),
        verbo: null,
        destino: { name: RUTA_COLECCION, params: { collectionId: coleccion.id } },
        inerte: false,
      });

      if (!desplegada) continue;

      const error = arbol.errorDeColeccion(coleccion.id);
      if (error !== null) {
        salida.push(nota(`c:${coleccion.id}:error`, error, 3, true));
        continue;
      }

      const peticiones = arbol.peticionesDe(coleccion.id);
      if (arbol.peticionesCargadas(coleccion.id) && peticiones.length === 0) {
        salida.push(nota(`c:${coleccion.id}:vacio`, 'Sin peticiones todavía', 3));
      }

      for (const peticion of peticiones) {
        salida.push({
          clave: `p:${peticion.id}`,
          tipo: 'peticion',
          id: peticion.id,
          etiqueta: peticion.name,
          nivel: 3,
          desplegable: false,
          desplegado: false,
          activo: nivelActivo.value === 'peticion' && peticionDeLaRuta.value === peticion.id,
          ocupado: false,
          verbo: peticion.method,
          destino: {
            name: RUTA_CONSTRUCTOR,
            query: { peticion: peticion.id, coleccion: coleccion.id },
          },
          inerte: false,
        });
      }
    }
  }

  return salida;
});

function nota(clave: string, etiqueta: string, nivel: number, esError = false): NodoVisible {
  return {
    clave,
    tipo: 'nota',
    id: esError ? 'error' : '',
    etiqueta,
    nivel,
    desplegable: false,
    desplegado: false,
    activo: false,
    ocupado: false,
    verbo: null,
    destino: null,
    inerte: true,
  };
}

/** Nodos que el tabulador puede alcanzar: las notas no son interactivas. */
const indicesActivables = computed(() =>
  nodos.value.map((nodo, indice) => (nodo.inerte ? -1 : indice)).filter((i) => i >= 0),
);

const indiceTabulable = computed(() => {
  const posibles = indicesActivables.value;
  if (posibles.length === 0) return -1;
  if (posibles.includes(enfocado.value)) return enfocado.value;
  // Si el nodo que tenía el foco desapareció (se plegó su rama), el tabulador
  // vuelve al nodo activo, y si no hay, al primero. Nunca se queda sin nodo
  // tabulable: eso sacaría el árbol entero del orden de tabulación.
  const activo = nodos.value.findIndex((nodo) => nodo.activo && !nodo.inerte);
  return activo >= 0 ? activo : (posibles[0] ?? -1);
});

const vacio = computed(
  () => workspaces.cargada && workspaces.lista.length === 0,
);
const primeraCarga = computed(() => workspaces.cargando && !workspaces.cargada);

onMounted(async () => {
  await arbol.cargarRaiz();
  await revelarRutaActual();
});

/**
 * Al navegar, el nodo de la ruta nueva se despliega y se marca. Sin esto,
 * entrar a una colección por un enlace directo dejaba el árbol plegado y el
 * usuario no veía dónde estaba (§3.1: «marcado y visible»).
 */
watch(
  () => [workspaceDeLaRuta.value, coleccionDeLaRuta.value],
  () => {
    void revelarRutaActual();
  },
);

async function revelarRutaActual(): Promise<void> {
  await arbol.revelar({
    workspaceId: workspaceDeLaRuta.value,
    collectionId: coleccionDeLaRuta.value,
  });
}

async function alternar(nodo: NodoVisible): Promise<void> {
  if (nodo.tipo === 'workspace') await arbol.alternarWorkspace(nodo.id);
  else if (nodo.tipo === 'coleccion') await arbol.alternarColeccion(nodo.id);
}

function enfocarIndice(indice: number): void {
  const posibles = indicesActivables.value;
  if (posibles.length === 0) return;
  const limitado = Math.min(Math.max(indice, 0), nodos.value.length - 1);
  // Si cae sobre una nota, se busca el activable más cercano hacia abajo y,
  // si no hay, hacia arriba.
  const destino =
    posibles.find((i) => i >= limitado) ??
    [...posibles].reverse().find((i) => i <= limitado) ??
    posibles[0];
  if (destino === undefined) return;
  enfocado.value = destino;
  void nextTick(() => {
    const nodo = nodos.value[destino];
    if (nodo === undefined) return;
    const elemento = contenedor.value?.querySelector<HTMLElement>(
      `[data-clave="${CSS.escape(nodo.clave)}"]`,
    );
    elemento?.focus();
  });
}

function moverRelativo(delta: number): void {
  const posibles = indicesActivables.value;
  const actual = posibles.indexOf(indiceTabulable.value);
  const siguiente = actual < 0 ? 0 : Math.min(Math.max(actual + delta, 0), posibles.length - 1);
  const destino = posibles[siguiente];
  if (destino !== undefined) enfocarIndice(destino);
}

/** `ArrowRight`: despliega; si ya está desplegado, baja al primer hijo. */
async function haciaDentro(nodo: NodoVisible, indice: number): Promise<void> {
  if (!nodo.desplegable) return;
  if (!nodo.desplegado) {
    await alternar(nodo);
    return;
  }
  const hijo = nodos.value.findIndex((n, i) => i > indice && n.nivel === nodo.nivel + 1);
  if (hijo >= 0) enfocarIndice(hijo);
}

/** `ArrowLeft`: pliega; si ya está plegado, sube al padre. */
async function haciaFuera(nodo: NodoVisible, indice: number): Promise<void> {
  if (nodo.desplegable && nodo.desplegado) {
    await alternar(nodo);
    return;
  }
  for (let i = indice - 1; i >= 0; i -= 1) {
    const candidato = nodos.value[i];
    if (candidato !== undefined && candidato.nivel === nodo.nivel - 1) {
      enfocarIndice(i);
      return;
    }
  }
}

async function alPulsarTecla(evento: KeyboardEvent, nodo: NodoVisible, indice: number): Promise<void> {
  switch (evento.key) {
    case 'ArrowDown':
      evento.preventDefault();
      moverRelativo(1);
      break;
    case 'ArrowUp':
      evento.preventDefault();
      moverRelativo(-1);
      break;
    case 'ArrowRight':
      evento.preventDefault();
      await haciaDentro(nodo, indice);
      break;
    case 'ArrowLeft':
      evento.preventDefault();
      await haciaFuera(nodo, indice);
      break;
    case 'Home':
      evento.preventDefault();
      enfocarIndice(0);
      break;
    case 'End':
      evento.preventDefault();
      enfocarIndice(nodos.value.length - 1);
      break;
    default:
      break;
  }
}

/**
 * Activar un nodo = **ir a su pantalla**. Desplegar es cosa del triángulo y de
 * las flechas del teclado.
 *
 * Es la decisión que más se nota al usar esto: si pulsar el nombre desplegara
 * en vez de navegar, llegar a una colección costaría dos gestos distintos
 * según dónde se pulse, que es justo lo contrario de «más rápido y fácil».
 */
function activar(nodo: NodoVisible, indice: number): void {
  if (nodo.inerte || nodo.destino === null) return;
  enfocado.value = indice;
  emitir('navegar', nodo.destino);
}
</script>

<template>
  <div class="arbol">
    <div v-if="primeraCarga" class="arbol__espera">
      <CeibaSpinner size="sm" />
      <span class="arbol__espera-texto">Cargando workspaces…</span>
    </div>

    <p v-else-if="vacio" class="arbol__nota">
      Todavía no tienes workspaces. Crea el primero para ver aquí tus colecciones y peticiones.
    </p>

    <div
      v-else
      ref="contenedor"
      class="arbol__raiz"
      role="tree"
      aria-label="Workspaces, colecciones y peticiones"
    >
      <div
        v-for="(nodo, indice) in nodos"
        :key="nodo.clave"
        class="arbol__fila"
        :class="`arbol__fila--n${nodo.nivel}`"
      >
        <button
          v-if="nodo.desplegable"
          type="button"
          class="arbol__pico"
          :class="{ 'arbol__pico--abierto': nodo.desplegado }"
          :aria-label="`${nodo.desplegado ? 'Plegar' : 'Desplegar'} ${nodo.etiqueta}`"
          tabindex="-1"
          @click="alternar(nodo)"
        >
          <span aria-hidden="true">▸</span>
        </button>
        <span v-else class="arbol__pico arbol__pico--hueco" aria-hidden="true"></span>

        <button
          v-if="!nodo.inerte"
          type="button"
          role="treeitem"
          class="arbol__nodo"
          :class="[`arbol__nodo--${nodo.tipo}`, { 'arbol__nodo--activo': nodo.activo }]"
          :data-clave="nodo.clave"
          :data-tipo="nodo.tipo"
          :aria-level="nodo.nivel"
          :aria-expanded="nodo.desplegable ? nodo.desplegado : undefined"
          :aria-selected="nodo.activo"
          :aria-busy="nodo.ocupado ? 'true' : undefined"
          :aria-current="nodo.activo ? 'page' : undefined"
          :tabindex="indice === indiceTabulable ? 0 : -1"
          @click="activar(nodo, indice)"
          @keydown="alPulsarTecla($event, nodo, indice)"
        >
          <span
            v-if="nodo.verbo"
            class="arbol__verbo"
            :data-verbo="nodo.verbo.toLowerCase()"
            aria-hidden="true"
            >{{ nodo.verbo }}</span
          >
          <span class="arbol__etiqueta">{{ nodo.etiqueta }}</span>
          <CeibaSpinner v-if="nodo.ocupado" size="xs" />
        </button>

        <span v-else class="arbol__nota arbol__nota--rama" :data-clave="nodo.clave">
          {{ nodo.etiqueta }}
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.arbol {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
  min-height: 0;
}

.arbol__raiz {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.arbol__fila {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-1);
  min-width: 0;
}

.arbol__fila--n2 {
  padding-left: var(--ceiba-space-3);
}

.arbol__fila--n3 {
  padding-left: var(--ceiba-space-5);
}

.arbol__pico {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  border-radius: var(--ceiba-radius-sm);
  background: transparent;
  color: var(--ceiba-text-faint);
  font-size: var(--ceiba-text-xs);
  cursor: pointer;
  transition: transform var(--ceiba-duration-fast) var(--ceiba-ease);
}

.arbol__pico:hover {
  color: var(--ceiba-text);
  background: var(--ceiba-surface-raised);
}

.arbol__pico--abierto {
  transform: rotate(90deg);
}

.arbol__pico--hueco {
  cursor: default;
}

.arbol__nodo {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-2);
  padding: var(--ceiba-space-1) var(--ceiba-space-2);
  border: none;
  border-radius: var(--ceiba-radius-sm);
  background: transparent;
  color: var(--ceiba-text-muted);
  font-family: inherit;
  font-size: var(--ceiba-text-sm);
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--ceiba-duration-fast) var(--ceiba-ease),
    color var(--ceiba-duration-fast) var(--ceiba-ease);
}

.arbol__nodo:hover {
  background: var(--ceiba-surface-raised);
  color: var(--ceiba-text);
}

.arbol__nodo:focus-visible {
  outline: 2px solid var(--ceiba-focus-ring);
  outline-offset: 1px;
}

.arbol__nodo--workspace {
  font-weight: 600;
  color: var(--ceiba-text);
}

.arbol__nodo--activo {
  background: var(--ceiba-accent-surface);
  color: var(--ceiba-text);
  font-weight: 600;
}

.arbol__etiqueta {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.arbol__verbo {
  flex-shrink: 0;
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-xs);
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--ceiba-text-faint);
}

.arbol__verbo[data-verbo='get'] {
  color: var(--ceiba-method-get);
}
.arbol__verbo[data-verbo='post'] {
  color: var(--ceiba-method-post);
}
.arbol__verbo[data-verbo='put'] {
  color: var(--ceiba-method-put);
}
.arbol__verbo[data-verbo='patch'] {
  color: var(--ceiba-method-patch);
}
.arbol__verbo[data-verbo='delete'] {
  color: var(--ceiba-method-delete);
}
.arbol__verbo[data-verbo='head'] {
  color: var(--ceiba-method-head);
}
.arbol__verbo[data-verbo='options'] {
  color: var(--ceiba-method-options);
}

.arbol__nota {
  margin: 0;
  padding: var(--ceiba-space-1) var(--ceiba-space-2);
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

.arbol__nota--rama {
  flex: 1;
  min-width: 0;
}

.arbol__espera {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-2);
  padding: var(--ceiba-space-2);
}

.arbol__espera-texto {
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}
</style>
