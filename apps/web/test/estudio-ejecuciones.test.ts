import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { defineComponent } from 'vue';
import { usarFetch, type FuncionFetch } from '@/api/cliente';
import VistaDeEjecuciones from '@/views/VistaDeEjecuciones.vue';

/**
 * Pantalla de ejecuciones: sus estados y, sobre todo, **el hueco de la API**.
 *
 * El contrato se comprobó ruta por ruta contra
 * `apps/api/src/modules/studio/studio.controller.ts`: existen
 * `GET /workspaces/:id/runs` y `POST /workspaces/:id/runs`, y **no existe**
 * `GET /workspaces/:id/runs/:runId`. Esta prueba fija las dos consecuencias
 * que importan:
 *
 *  1. La vista **no pide** la ruta inexistente por el camino normal. Si
 *     alguien la «arregla» llamándola, el doble de `fetch` lo registra y esto
 *     se pone rojo.
 *  2. Cuando se pide a propósito, el hueco se **dice**, no se disfraza de
 *     fallo pasajero ni se rellena con datos inventados.
 */

interface LlamadaRegistrada {
  readonly url: string;
  readonly metodo: string;
}

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

function instalarApi(
  responder: (llamada: LlamadaRegistrada) => RespuestaPlanificada,
): LlamadaRegistrada[] {
  const llamadas: LlamadaRegistrada[] = [];
  const doble: FuncionFetch = async (entrada, iniciales) => {
    const llamada: LlamadaRegistrada = {
      url: String(entrada),
      metodo: (iniciales?.method ?? 'GET').toUpperCase(),
    };
    llamadas.push(llamada);
    if (llamada.url.endsWith('/auth/csrf')) {
      return respuestaFalsa({ estado: 200, cuerpo: { csrfToken: 'nonce.firma' } });
    }
    return respuestaFalsa(responder(llamada));
  };
  usarFetch(doble);
  return llamadas;
}

const WORKSPACE = {
  id: 'ws-1',
  slug: 'pagos',
  name: 'Pagos',
  description: null,
  ownerUserId: 'usr-1',
  status: 'active',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

/** Corrida tal y como la devuelve la lista: con contadores y **sin** `items`. */
const CORRIDA_SIN_DESGLOSE = {
  id: 'run-1',
  workspaceId: 'ws-1',
  collectionId: 'col-1',
  collectionName: 'Cobros',
  environmentId: null,
  environmentName: null,
  triggeredById: 'usr-1',
  triggeredByName: 'Ana Rivas',
  status: 'succeeded',
  totalRequests: 0,
  passedCount: 0,
  failedCount: 0,
  durationMs: 120,
  startedAt: '2026-10-20T10:00:00.000Z',
  finishedAt: '2026-10-20T10:00:01.000Z',
};

const COLECCION = {
  id: 'col-1',
  slug: 'cobros',
  name: 'Cobros',
  description: null,
  workspaceId: 'ws-1',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

const Vacio = defineComponent({ name: 'Vacio', template: '<div />' });

function construirEnrutador(): Router {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'workspaces', component: Vacio },
      { path: '/ejecuciones', name: 'ejecuciones', component: Vacio },
      { path: '/constructor', name: 'constructor', component: Vacio },
      { path: '/importar', name: 'importar', component: Vacio },
    ],
  });
}

async function montar(pinia: Pinia) {
  const enrutador = construirEnrutador();
  await enrutador.push('/ejecuciones');
  await enrutador.isReady();
  const vista = mount(VistaDeEjecuciones, { global: { plugins: [pinia, enrutador] } });
  await flushPromises();
  return vista;
}

describe('VistaDeEjecuciones', () => {
  let pinia: Pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
  });

  it('sin workspaces enseña el estado vacío, no una tabla en blanco', async () => {
    instalarApi((llamada) => {
      if (llamada.url.endsWith('/workspaces')) {
        return { estado: 200, cuerpo: { workspaces: [] } };
      }
      return { estado: 404, cuerpo: { error: 'no_encontrado', mensaje: 'No existe.' } };
    });

    const vista = await montar(pinia);

    expect(vista.text()).toContain('Todavía no hay ningún workspace');
    vista.unmount();
  });

  it('con workspace y sin corridas enseña «Sin corridas registradas»', async () => {
    instalarApi((llamada) => {
      if (llamada.url.endsWith('/workspaces')) {
        return { estado: 200, cuerpo: { workspaces: [WORKSPACE] } };
      }
      if (llamada.url.includes('/environments')) return { estado: 200, cuerpo: { items: [] } };
      if (llamada.url.includes('/runs')) return { estado: 200, cuerpo: { items: [] } };
      if (llamada.url.includes('/collections')) {
        return { estado: 200, cuerpo: { colecciones: [COLECCION] } };
      }
      return { estado: 404, cuerpo: { error: 'no_encontrado', mensaje: 'No existe.' } };
    });

    const vista = await montar(pinia);

    expect(vista.text()).toContain('Sin corridas registradas');
    vista.unmount();
  });

  it('un fallo de la API se enseña como error, no como «no hay corridas»', async () => {
    instalarApi((llamada) => {
      if (llamada.url.endsWith('/workspaces')) {
        return { estado: 200, cuerpo: { workspaces: [WORKSPACE] } };
      }
      return { estado: 500, cuerpo: { error: 'error_interno', mensaje: 'Se cayó el motor.' } };
    });

    const vista = await montar(pinia);

    expect(vista.text()).toContain('Algo ha fallado');
    expect(vista.text()).toContain('Se cayó el motor.');
    expect(vista.text()).not.toContain('Sin corridas registradas');
    vista.unmount();
  });

  it('NO pide GET /runs/:runId: esa ruta no existe en la API', async () => {
    const llamadas = instalarApi((llamada) => {
      if (llamada.url.endsWith('/workspaces')) {
        return { estado: 200, cuerpo: { workspaces: [WORKSPACE] } };
      }
      if (llamada.url.includes('/environments')) return { estado: 200, cuerpo: { items: [] } };
      if (llamada.url.includes('/runs')) {
        return { estado: 200, cuerpo: { items: [CORRIDA_SIN_DESGLOSE] } };
      }
      if (llamada.url.includes('/collections')) {
        return { estado: 200, cuerpo: { colecciones: [COLECCION] } };
      }
      return { estado: 404, cuerpo: { error: 'no_encontrado', mensaje: 'No existe.' } };
    });

    const vista = await montar(pinia);

    const detalle = llamadas.filter((l) => /\/runs\/[^/]+$/u.test(l.url));
    expect(detalle).toEqual([]);
    vista.unmount();
  });

  it('declara el hueco en vez de inventarse el desglose de la corrida', async () => {
    instalarApi((llamada) => {
      if (llamada.url.endsWith('/workspaces')) {
        return { estado: 200, cuerpo: { workspaces: [WORKSPACE] } };
      }
      if (llamada.url.includes('/environments')) return { estado: 200, cuerpo: { items: [] } };
      if (llamada.url.includes('/runs')) {
        return { estado: 200, cuerpo: { items: [CORRIDA_SIN_DESGLOSE] } };
      }
      if (llamada.url.includes('/collections')) {
        return { estado: 200, cuerpo: { colecciones: [COLECCION] } };
      }
      return { estado: 404, cuerpo: { error: 'no_encontrado', mensaje: 'No existe.' } };
    });

    const vista = await montar(pinia);

    // El aviso del hueco se pinta solo, sin tener que pulsar nada.
    expect(vista.text()).toContain('La API no expone el detalle de una corrida concreta');
    expect(vista.text()).toContain('GET /workspaces/:id/runs/:runId');

    // Y si se comprueba a propósito, se confirma como hueco, no como error.
    const boton = vista
      .findAll('button')
      .find((b) => b.text().includes('Comprobar si la API ya lo expone'));
    expect(boton).toBeDefined();
    await boton?.trigger('click');
    await flushPromises();

    expect(vista.text()).toContain('Hueco confirmado contra la API');
    expect(vista.text()).not.toContain('Algo ha fallado');
    vista.unmount();
  });
});
