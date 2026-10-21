import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount, flushPromises } from '@vue/test-utils';
import { usarFetch, type FuncionFetch } from '@/api/cliente';
import { usarAlmacenDelArbol } from '@/stores/arbol';
import { usarAlmacenDeColecciones } from '@/stores/colecciones';
import { usarAlmacenDeWorkspaces } from '@/stores/workspaces';
import ArbolDeNavegacion from '@/components/layout/ArbolDeNavegacion.vue';
import type { Coleccion, Workspace } from '@/api/tipos';

/**
 * Pruebas del árbol lateral (P3).
 *
 * Lo que de verdad vigilan, y que es justo lo que el cliente pidió:
 *
 *  1. Que haya **tres niveles**: workspaces → colecciones → peticiones.
 *  2. Que la carga sea **perezosa**. Es la propiedad más fácil de romper sin
 *     darse cuenta: basta un `onMounted` de más para que abrir la barra
 *     lateral dispare una petición por cada colección del usuario. Por eso se
 *     cuentan las URL pedidas, no sólo lo que se pinta.
 *  3. Que el despliegue **sobreviva a la navegación** (vive en el almacén).
 *  4. Que sea un árbol accesible de verdad: `role="tree"`, `role="treeitem"`,
 *     `aria-expanded` sólo donde hay hijos, y flechas que funcionan.
 *
 * El doble de `fetch` está duplicado respecto a `colecciones.test.ts` por la
 * misma razón que allí se documenta: un `test/ayudas.ts` compartido queda
 * fuera del ámbito de escritura de este encargo.
 */

const TESTIGO_CSRF = 'nonce.firma';

interface RespuestaPlanificada {
  readonly estado: number;
  readonly cuerpo?: unknown;
}

function respuestaFalsa({ estado, cuerpo }: RespuestaPlanificada): Response {
  const conCuerpo = cuerpo !== undefined && estado !== 204;
  return {
    ok: estado >= 200 && estado < 300,
    status: estado,
    headers: {
      get: (nombre: string): string | null =>
        nombre.toLowerCase() === 'content-type' && conCuerpo ? 'application/json' : null,
    },
    json: async (): Promise<unknown> => cuerpo,
  } as unknown as Response;
}

/** Instala el doble y devuelve la lista de URL pedidas, en orden. */
function instalarApi(rutas: Record<string, unknown>): string[] {
  const pedidas: string[] = [];
  const doble: FuncionFetch = async (entrada, iniciales) => {
    const url = String(entrada);
    const metodo = (iniciales?.method ?? 'GET').toUpperCase();
    if (url === '/api/v1/auth/csrf') {
      return respuestaFalsa({ estado: 200, cuerpo: { csrfToken: TESTIGO_CSRF } });
    }
    pedidas.push(`${metodo} ${url}`);
    const cuerpo = rutas[url];
    if (cuerpo === undefined) return respuestaFalsa({ estado: 404, cuerpo: { mensaje: 'No' } });
    return respuestaFalsa({ estado: 200, cuerpo });
  };
  usarFetch(doble);
  return pedidas;
}

function workspaceDePrueba(parcial: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-1',
    slug: 'pagos',
    name: 'Pagos',
    description: null,
    ownerUserId: 'u-1',
    status: 'active',
    createdAt: '2026-01-05T10:00:00.000Z',
    updatedAt: '2026-01-05T10:00:00.000Z',
    ...parcial,
  };
}

function coleccionDePrueba(parcial: Partial<Coleccion> = {}): Coleccion {
  return {
    id: 'col-1',
    workspaceId: 'ws-1',
    slug: 'cobros',
    name: 'Cobros',
    description: null,
    visibility: 'workspace',
    status: 'active',
    lockVersion: 1,
    createdAt: '2026-02-01T09:00:00.000Z',
    updatedAt: '2026-02-01T09:00:00.000Z',
    ...parcial,
  };
}

/** Dos workspaces, dos colecciones en el primero, dos peticiones en la primera. */
const ARBOL_COMPLETO = {
  '/api/v1/workspaces': {
    workspaces: [
      workspaceDePrueba(),
      workspaceDePrueba({ id: 'ws-2', slug: 'interno', name: 'Interno' }),
    ],
  },
  '/api/v1/workspaces/ws-1/collections': {
    colecciones: [
      coleccionDePrueba(),
      coleccionDePrueba({ id: 'col-2', slug: 'reembolsos', name: 'Reembolsos' }),
    ],
  },
  '/api/v1/workspaces/ws-2/collections': { colecciones: [] },
  '/api/v1/collections/col-1/requests': {
    peticiones: [
      { id: 'req-1', name: 'Crear cobro', method: 'POST' },
      { id: 'req-2', name: 'Listar cobros', method: 'GET' },
    ],
  },
  '/api/v1/collections/col-2/requests': { peticiones: [] },
};

/**
 * El árbol se monta **sin router**: recibe los identificadores de la ruta por
 * `props`, igual que `VistaDeColeccion.vue` recibe su `collectionId`.
 *
 * POR QUÉ LOS DESTINOS SE RECOGEN CON UN OYENTE Y NO CON `wrapper.emitted()`.
 * Medido aquí, y coincide con lo que el ámbito C documentó por su cuenta en
 * `test/autocompletado.test.ts:150` para este mismo entorno (Vue 3.5.44 +
 * `@vue/test-utils` 2.5.1): `emitted()` recoge los eventos DOM que burbujean
 * hasta la raíz —se vio `click`— pero **no** los `emit` del componente.
 * Comprobado con un caso de depuración: `activar()` se ejecuta y llama a
 * `emitir('navegar', destino)`, y aun así `Object.keys(wrapper.emitted())`
 * devuelve `["click"]`. Suscribirse de verdad es además lo que hará
 * `BarraLateral.vue` al integrar. **No se «arregle» volviendo a `emitted()`.**
 */
function montarArbol(
  props: {
    workspaceActivo?: string | null;
    coleccionActiva?: string | null;
    peticionActiva?: string | null;
  } = {},
) {
  const destinos: unknown[] = [];
  const envoltorio = mount(ArbolDeNavegacion, {
    props: {
      ...props,
      onNavegar: (destino: unknown) => {
        destinos.push(destino);
      },
    },
    global: { stubs: { CeibaSpinner: true } },
  });
  return { envoltorio, destinos };
}

describe('almacén del árbol (P3)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('al cargar la raíz pide SÓLO los workspaces: nada de colecciones ni peticiones', async () => {
    const pedidas = instalarApi(ARBOL_COMPLETO);
    const arbol = usarAlmacenDelArbol();

    await arbol.cargarRaiz();

    expect(pedidas).toEqual(['GET /api/v1/workspaces']);
  });

  it('desplegar un workspace pide sus colecciones, y sólo las suyas', async () => {
    const pedidas = instalarApi(ARBOL_COMPLETO);
    const arbol = usarAlmacenDelArbol();
    await arbol.cargarRaiz();
    pedidas.length = 0;

    await arbol.abrirWorkspace('ws-1');

    expect(pedidas).toEqual(['GET /api/v1/workspaces/ws-1/collections']);
    expect(usarAlmacenDeColecciones().deWorkspace('ws-1')).toHaveLength(2);
    // Lo que NO se pidió es la mitad de la prueba.
    expect(pedidas).not.toContain('GET /api/v1/workspaces/ws-2/collections');
  });

  it('desplegar una colección pide sus peticiones, y no las de la colección hermana', async () => {
    const pedidas = instalarApi(ARBOL_COMPLETO);
    const arbol = usarAlmacenDelArbol();
    await arbol.cargarRaiz();
    await arbol.abrirWorkspace('ws-1');
    pedidas.length = 0;

    await arbol.abrirColeccion('col-1');

    expect(pedidas).toEqual(['GET /api/v1/collections/col-1/requests']);
    expect(arbol.peticionesDe('col-1').map((p) => p.name)).toEqual([
      'Crear cobro',
      'Listar cobros',
    ]);
    expect(arbol.peticionesCargadas('col-2')).toBe(false);
  });

  it('plegar y volver a desplegar NO repite la petición', async () => {
    const pedidas = instalarApi(ARBOL_COMPLETO);
    const arbol = usarAlmacenDelArbol();
    await arbol.cargarRaiz();
    await arbol.abrirWorkspace('ws-1');
    await arbol.abrirColeccion('col-1');
    pedidas.length = 0;

    arbol.cerrarColeccion('col-1');
    await arbol.abrirColeccion('col-1');
    arbol.cerrarColeccion('col-1');
    await arbol.abrirColeccion('col-1');

    expect(pedidas).toEqual([]);
  });

  it('si fallan las peticiones de una rama, NO se finge que la colección está vacía', async () => {
    // `col-1/requests` no está en el mapa -> 404.
    instalarApi({ ...ARBOL_COMPLETO, '/api/v1/collections/col-1/requests': undefined });
    const arbol = usarAlmacenDelArbol();
    await arbol.cargarRaiz();
    await arbol.abrirWorkspace('ws-1');

    await arbol.abrirColeccion('col-1');

    expect(arbol.errorDeColeccion('col-1')).not.toBeNull();
    // La distinción que importa: «no se sabe» no es «no hay».
    expect(arbol.peticionesCargadas('col-1')).toBe(false);
  });

  it('`revelar` despliega los ancestros del nodo de la ruta actual', async () => {
    instalarApi(ARBOL_COMPLETO);
    const arbol = usarAlmacenDelArbol();
    await arbol.cargarRaiz();

    await arbol.revelar({ workspaceId: 'ws-1', collectionId: 'col-1' });

    expect(arbol.workspaceAbierto('ws-1')).toBe(true);
    expect(arbol.coleccionAbierta('col-1')).toBe(true);
  });

  it('deduce el workspace de una colección cuando la URL no lo lleva', async () => {
    instalarApi(ARBOL_COMPLETO);
    const arbol = usarAlmacenDelArbol();
    await arbol.cargarRaiz();
    await arbol.abrirWorkspace('ws-1');

    // `/colecciones/col-2` no lleva workspaceId en la URL.
    await arbol.revelar({ collectionId: 'col-2' });

    expect(arbol.workspaceDeColeccion('col-2')).toBe('ws-1');
    expect(arbol.workspaceAbierto('ws-1')).toBe(true);
  });

  it('el despliegue sobrevive a la navegación: vive en el almacén, no en el componente', async () => {
    instalarApi(ARBOL_COMPLETO);
    const arbol = usarAlmacenDelArbol();
    await arbol.cargarRaiz();
    await arbol.abrirWorkspace('ws-1');
    await arbol.abrirColeccion('col-1');

    // Se destruye y se vuelve a pedir el almacén, que es lo que ocurre al
    // cambiar de vista: el componente se desmonta, el almacén no.
    const otraVez = usarAlmacenDelArbol();

    expect(otraVez.workspaceAbierto('ws-1')).toBe(true);
    expect(otraVez.coleccionAbierta('col-1')).toBe(true);
  });

  it('una petición sin nombre se etiqueta en vez de pintar una fila en blanco', async () => {
    instalarApi({
      ...ARBOL_COMPLETO,
      '/api/v1/collections/col-1/requests': {
        peticiones: [{ id: 'req-9', name: '   ', method: '' }],
      },
    });
    const arbol = usarAlmacenDelArbol();
    await arbol.cargarRaiz();
    await arbol.abrirWorkspace('ws-1');
    await arbol.abrirColeccion('col-1');

    expect(arbol.peticionesDe('col-1')[0]).toMatchObject({ name: 'Sin nombre', method: 'GET' });
  });

  it('`methodCustom` gana a `method`, como en el resto de la aplicación', async () => {
    instalarApi({
      ...ARBOL_COMPLETO,
      '/api/v1/collections/col-1/requests': {
        peticiones: [{ id: 'req-9', name: 'Rara', method: 'GET', methodCustom: 'purge' }],
      },
    });
    const arbol = usarAlmacenDelArbol();
    await arbol.cargarRaiz();
    await arbol.abrirWorkspace('ws-1');
    await arbol.abrirColeccion('col-1');

    expect(arbol.peticionesDe('col-1')[0]?.method).toBe('PURGE');
  });
});

describe('componente del árbol (P3)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('pinta los workspaces como un árbol accesible', async () => {
    instalarApi(ARBOL_COMPLETO);
    const { envoltorio } = montarArbol();
    await flushPromises();

    expect(envoltorio.find('[role="tree"]').exists()).toBe(true);
    const nodos = envoltorio.findAll('[role="treeitem"]');
    expect(nodos).toHaveLength(2);
    expect(nodos[0]?.attributes('aria-level')).toBe('1');
    // Un workspace es desplegable: tiene que anunciarlo.
    expect(nodos[0]?.attributes('aria-expanded')).toBe('false');
  });

  it('despliega los tres niveles al pulsar y marca el verbo de cada petición', async () => {
    instalarApi(ARBOL_COMPLETO);
    const { envoltorio } = montarArbol();
    await flushPromises();

    await envoltorio.findAll('.arbol__pico')[0]?.trigger('click');
    await flushPromises();
    const colecciones = envoltorio.findAll('[data-tipo="coleccion"]');
    expect(colecciones).toHaveLength(2);

    await envoltorio.findAll('.arbol__pico')[1]?.trigger('click');
    await flushPromises();
    const peticiones = envoltorio.findAll('[data-tipo="peticion"]');
    expect(peticiones).toHaveLength(2);
    expect(peticiones[0]?.attributes('aria-level')).toBe('3');
    expect(envoltorio.text()).toContain('Crear cobro');
    expect(envoltorio.text()).toContain('POST');
  });

  it('una hoja NO lleva `aria-expanded`: no se puede desplegar', async () => {
    instalarApi(ARBOL_COMPLETO);
    const { envoltorio } = montarArbol();
    await flushPromises();
    await envoltorio.findAll('.arbol__pico')[0]?.trigger('click');
    await flushPromises();
    await envoltorio.findAll('.arbol__pico')[1]?.trigger('click');
    await flushPromises();

    const hoja = envoltorio.findAll('[data-tipo="peticion"]')[0];

    expect(hoja?.attributes('aria-expanded')).toBeUndefined();
  });

  it('la flecha derecha despliega un nodo plegado sin ratón', async () => {
    instalarApi(ARBOL_COMPLETO);
    const { envoltorio } = montarArbol();
    await flushPromises();

    await envoltorio.findAll('[role="treeitem"]')[0]?.trigger('keydown', { key: 'ArrowRight' });
    await flushPromises();

    expect(usarAlmacenDelArbol().workspaceAbierto('ws-1')).toBe(true);
    expect(envoltorio.findAll('[data-tipo="coleccion"]').length).toBe(2);
  });

  it('la flecha izquierda pliega un nodo desplegado', async () => {
    instalarApi(ARBOL_COMPLETO);
    const { envoltorio } = montarArbol();
    await flushPromises();
    await envoltorio.findAll('[role="treeitem"]')[0]?.trigger('keydown', { key: 'ArrowRight' });
    await flushPromises();

    await envoltorio.findAll('[role="treeitem"]')[0]?.trigger('keydown', { key: 'ArrowLeft' });
    await flushPromises();

    expect(usarAlmacenDelArbol().workspaceAbierto('ws-1')).toBe(false);
  });

  it('sólo hay UN nodo tabulable: un árbol no puede ser una trampa de teclado', async () => {
    instalarApi(ARBOL_COMPLETO);
    const { envoltorio } = montarArbol();
    await flushPromises();
    await envoltorio.findAll('.arbol__pico')[0]?.trigger('click');
    await flushPromises();

    const nodos = envoltorio.findAll('[role="treeitem"]');
    const tabulables = nodos.filter((n) => n.attributes('tabindex') === '0');

    expect(nodos.length).toBeGreaterThan(1);
    expect(tabulables).toHaveLength(1);
  });

  it('marca y hace visible el nodo de la ruta actual sin que el usuario despliegue nada', async () => {
    instalarApi(ARBOL_COMPLETO);
    const { envoltorio } = montarArbol({ coleccionActiva: 'col-1', workspaceActivo: 'ws-1' });
    await flushPromises();
    await flushPromises();

    const seleccionados = envoltorio.findAll('[aria-selected="true"]');
    // Un árbol sin `aria-multiselectable` tiene UN nodo seleccionado, no dos.
    expect(seleccionados).toHaveLength(1);
    expect(seleccionados[0]?.attributes('data-tipo')).toBe('coleccion');
    expect(seleccionados[0]?.attributes('aria-current')).toBe('page');
    // Y el ancestro está desplegado, que es su señal: el nodo activo se ve.
    const workspace = envoltorio.find('[data-clave="w:ws-1"]');
    expect(workspace.attributes('aria-expanded')).toBe('true');
  });

  it('activar un nodo avisa del destino en vez de navegar por su cuenta', async () => {
    instalarApi(ARBOL_COMPLETO);
    const { envoltorio, destinos } = montarArbol();
    await flushPromises();

    await envoltorio.findAll('[role="treeitem"]')[0]?.trigger('click');

    expect(destinos).toHaveLength(1);
    expect(destinos[0]).toMatchObject({ params: { workspaceId: 'ws-1' } });
  });

  it('activar una petición lleva al constructor con su colección', async () => {
    instalarApi(ARBOL_COMPLETO);
    const { envoltorio, destinos } = montarArbol();
    await flushPromises();
    await envoltorio.findAll('.arbol__pico')[0]?.trigger('click');
    await flushPromises();
    await envoltorio.findAll('.arbol__pico')[1]?.trigger('click');
    await flushPromises();

    await envoltorio.findAll('[data-tipo="peticion"]')[0]?.trigger('click');

    expect(destinos[0]).toMatchObject({
      query: { peticion: 'req-1', coleccion: 'col-1' },
    });
  });

  it('una colección vacía lo dice; no deja un hueco mudo', async () => {
    instalarApi(ARBOL_COMPLETO);
    const { envoltorio } = montarArbol();
    await flushPromises();
    // ws-2 no tiene colecciones.
    await envoltorio.findAll('.arbol__pico')[1]?.trigger('click');
    await flushPromises();

    expect(envoltorio.text()).toContain('Sin colecciones todavía');
  });

  it('sin workspaces explica qué hacer en vez de quedarse en blanco', async () => {
    instalarApi({ '/api/v1/workspaces': { workspaces: [] } });
    const { envoltorio } = montarArbol();
    await flushPromises();

    expect(envoltorio.text()).toContain('Todavía no tienes workspaces');
    expect(envoltorio.find('[role="tree"]').exists()).toBe(false);
  });

  it('un error de rama se enseña dentro del árbol', async () => {
    instalarApi({ ...ARBOL_COMPLETO, '/api/v1/collections/col-1/requests': undefined });
    const { envoltorio } = montarArbol();
    await flushPromises();
    await envoltorio.findAll('.arbol__pico')[0]?.trigger('click');
    await flushPromises();
    await envoltorio.findAll('.arbol__pico')[1]?.trigger('click');
    await flushPromises();

    expect(envoltorio.find('[data-clave="c:col-1:error"]').exists()).toBe(true);
  });
});

describe('el árbol no duplica lo que ya tienen otros almacenes', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('reutiliza el almacén de workspaces y el de colecciones', async () => {
    instalarApi(ARBOL_COMPLETO);
    const arbol = usarAlmacenDelArbol();
    await arbol.cargarRaiz();
    await arbol.abrirWorkspace('ws-1');

    // Los datos viven en sus dueños, no copiados dentro de `arbol`.
    expect(usarAlmacenDeWorkspaces().lista).toHaveLength(2);
    expect(usarAlmacenDeColecciones().deWorkspace('ws-1')).toHaveLength(2);
    expect(Object.keys(arbol.$state)).not.toContain('workspaces');
    expect(Object.keys(arbol.$state)).not.toContain('colecciones');
  });
});
