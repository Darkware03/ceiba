import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { createRouter, createWebHistory, type Router } from 'vue-router';
import { usarFetch, type FuncionFetch } from '@/api/cliente';
import BarraLateral from '@/components/layout/BarraLateral.vue';
import { usarAlmacenDelArbol } from '@/stores/arbol';

/**
 * Pruebas de la barra lateral con el árbol dentro (P3).
 *
 * Aquí SÍ se instala un router de verdad, y es la diferencia con
 * `arbol.test.ts`: lo que se comprueba es justamente el reparto de papeles
 * entre los dos componentes.
 *
 *   - `BarraLateral` conoce la ruta (`useRoute`) y navega (`useRouter`).
 *   - `ArbolDeNavegacion` no conoce ninguna de las dos cosas: recibe tres
 *     identificadores por `props` y avisa del destino con `navegar`.
 *
 * Si alguien «simplifica» metiendo `useRoute()` dentro del árbol, el árbol
 * deja de poder montarse sin router y `arbol.test.ts` se cae entero. Este
 * fichero documenta por qué está así.
 *
 * Lo que NO se toca: las dos correcciones de la fase 4 que el componente
 * lleva escritas en la cabecera —el workspace activo sale de la URL y no se
 * anuncia ningún rol—. Hay un caso para cada una, para que la fase 7 no las
 * deshaga por descuido.
 */

const TESTIGO_CSRF = 'nonce.firma';

function respuestaFalsa(cuerpo: unknown, estado = 200): Response {
  return {
    ok: estado >= 200 && estado < 300,
    status: estado,
    headers: {
      get: (nombre: string): string | null =>
        nombre.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: async (): Promise<unknown> => cuerpo,
  } as unknown as Response;
}

function instalarApi(rutas: Record<string, unknown>): string[] {
  const pedidas: string[] = [];
  const doble: FuncionFetch = async (entrada) => {
    const url = String(entrada);
    if (url === '/api/v1/auth/csrf') return respuestaFalsa({ csrfToken: TESTIGO_CSRF });
    pedidas.push(url);
    const cuerpo = rutas[url];
    if (cuerpo === undefined) return respuestaFalsa({ mensaje: 'No' }, 404);
    return respuestaFalsa(cuerpo);
  };
  usarFetch(doble);
  return pedidas;
}

const DATOS = {
  '/api/v1/workspaces': {
    workspaces: [
      {
        id: 'ws-1',
        slug: 'pagos',
        name: 'Pagos',
        description: null,
        ownerUserId: 'u-1',
        status: 'active',
        createdAt: '2026-01-05T10:00:00.000Z',
        updatedAt: '2026-01-05T10:00:00.000Z',
      },
    ],
  },
  '/api/v1/workspaces/ws-1/collections': {
    colecciones: [
      {
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
      },
    ],
  },
  '/api/v1/collections/col-1/requests': {
    peticiones: [{ id: 'req-1', name: 'Crear cobro', method: 'POST' }],
  },
};

/** Router mínimo: sólo las rutas que el lateral puede nombrar. */
function crearRouterDePrueba(): Router {
  const vacia = { template: '<div />' };
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/workspaces', name: 'workspaces', component: vacia },
      { path: '/workspaces/:workspaceId', name: 'workspace', component: vacia },
      { path: '/colecciones/:collectionId', name: 'coleccion', component: vacia },
      { path: '/constructor', name: 'constructor', component: vacia },
      { path: '/historial', name: 'historial', component: vacia },
      { path: '/entornos', name: 'entornos', component: vacia },
      { path: '/ejecuciones', name: 'ejecuciones', component: vacia },
      { path: '/documentacion', name: 'documentacion', component: vacia },
      { path: '/importar', name: 'importar', component: vacia },
      { path: '/configuracion', name: 'configuracion', component: vacia },
    ],
  });
}

async function montarLateral(ruta = '/workspaces') {
  const router = crearRouterDePrueba();
  await router.push(ruta);
  await router.isReady();
  const envoltorio = mount(BarraLateral, {
    global: { plugins: [router], stubs: { CeibaSpinner: true } },
  });
  await flushPromises();
  return { envoltorio, router };
}

describe('barra lateral con árbol (P3)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('mantiene la navegación estática que ya existía', async () => {
    instalarApi(DATOS);
    const { envoltorio } = await montarLateral();

    const texto = envoltorio.text();
    expect(texto).toContain('Espacios de trabajo');
    expect(texto).toContain('Constructor HTTP');
    expect(texto).toContain('Configuración y colaboración');
  });

  it('añade el árbol: ahora el lateral tiene `role="tree"`, que antes no tenía', async () => {
    instalarApi(DATOS);
    const { envoltorio } = await montarLateral();

    expect(envoltorio.find('[role="tree"]').exists()).toBe(true);
    expect(envoltorio.find('[data-clave="w:ws-1"]').exists()).toBe(true);
  });

  it('le pasa al árbol el workspace de la URL, no uno inventado del almacén', async () => {
    instalarApi(DATOS);
    const { envoltorio } = await montarLateral('/workspaces/ws-1');
    await flushPromises();

    // La corrección de la fase 4 sigue en pie: el activo sale de la ruta.
    const nodo = envoltorio.find('[data-clave="w:ws-1"]');
    expect(nodo.attributes('aria-selected')).toBe('true');
  });

  it('estando en una colección, despliega su rama sin que el usuario pulse nada', async () => {
    instalarApi(DATOS);
    const arbol = () => usarAlmacenDelArbol();
    const { envoltorio } = await montarLateral('/workspaces/ws-1');
    // Se despliega el workspace para que el índice conozca la colección.
    await envoltorio.findAll('.arbol__pico')[0]?.trigger('click');
    await flushPromises();

    await envoltorio.vm.$router.push('/colecciones/col-1');
    await flushPromises();
    await flushPromises();

    expect(arbol().coleccionAbierta('col-1')).toBe(true);
    expect(envoltorio.find('[data-clave="c:col-1"]').attributes('aria-selected')).toBe('true');
  });

  it('pulsar un nodo navega de verdad: el lateral hace el push que el árbol no hace', async () => {
    instalarApi(DATOS);
    const { envoltorio, router } = await montarLateral();

    await envoltorio.find('[data-clave="w:ws-1"]').trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.params['workspaceId']).toBe('ws-1');
  });

  it('sigue sin anunciar ningún rol: la API no manda `myRole`', async () => {
    instalarApi(DATOS);
    const { envoltorio } = await montarLateral('/workspaces/ws-1');

    const texto = envoltorio.text().toLowerCase();
    expect(texto).not.toContain('editor');
    expect(texto).not.toContain('administrador');
  });

  it('al entrar sólo pide los workspaces: el lateral no precarga el árbol entero', async () => {
    const pedidas = instalarApi(DATOS);
    await montarLateral();

    expect(pedidas).toEqual(['/api/v1/workspaces']);
  });
});
