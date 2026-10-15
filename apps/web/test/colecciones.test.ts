import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { RouterLinkStub, flushPromises, mount } from '@vue/test-utils';
import { usarFetch, type FuncionFetch } from '@/api/cliente';
import { usarAlmacenDeColecciones } from '@/stores/colecciones';
import { usarAlmacenDeWorkspaces } from '@/stores/workspaces';
import DialogoDeCreacion from '@/components/workspaces/DialogoDeCreacion.vue';
import VistaDeWorkspace from '@/views/VistaDeWorkspace.vue';
import type { Coleccion, Workspace } from '@/api/tipos';

/**
 * Pruebas del almacén de colecciones y de la pantalla de un workspace.
 *
 * Lo que de verdad vigilan estas pruebas es **la asimetría de rutas** del
 * `collection.controller.ts`, que es fácil de romper sin darse cuenta:
 *
 *   crear/listar       -> /workspaces/:workspaceId/collections
 *   renombrar/borrar   -> /collections/:collectionId
 *
 * Si alguien «uniformiza» las rutas, el PATCH se iría a
 * `/workspaces/.../collections/...`, que en la API no existe, y estas pruebas
 * lo cazan antes que un 404 en producción.
 *
 * Los ayudantes del doble de `fetch` están duplicados respecto a
 * `workspaces.test.ts` a conciencia: un `test/ayudas.ts` compartido queda
 * fuera del ámbito de escritura de este encargo (ver informe).
 */

const TESTIGO_CSRF = 'nonce.firma';

interface LlamadaRegistrada {
  readonly url: string;
  readonly metodo: string;
  readonly credenciales: RequestCredentials | undefined;
  readonly cabeceras: Record<string, string>;
  readonly cuerpo: unknown;
}

interface RespuestaPlanificada {
  readonly estado: number;
  readonly cuerpo?: unknown;
}

function cabecerasDe(iniciales: RequestInit | undefined): Record<string, string> {
  const origen = iniciales?.headers;
  if (origen === undefined) return {};
  if (Array.isArray(origen)) {
    const resultado: Record<string, string> = {};
    for (const par of origen) {
      const clave = par[0];
      const valor = par[1];
      if (clave !== undefined && valor !== undefined) resultado[clave.toLowerCase()] = valor;
    }
    return resultado;
  }
  const comoHeaders = origen as unknown as Headers;
  if (typeof comoHeaders.forEach === 'function') {
    const resultado: Record<string, string> = {};
    comoHeaders.forEach((valor, clave) => {
      resultado[clave.toLowerCase()] = valor;
    });
    return resultado;
  }
  const resultado: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(origen as Record<string, string>)) {
    resultado[clave.toLowerCase()] = valor;
  }
  return resultado;
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
    const cuerpoCrudo = iniciales?.body;
    const llamada: LlamadaRegistrada = {
      url: String(entrada),
      metodo: (iniciales?.method ?? 'GET').toUpperCase(),
      credenciales: iniciales?.credentials,
      cabeceras: cabecerasDe(iniciales),
      cuerpo: typeof cuerpoCrudo === 'string' ? JSON.parse(cuerpoCrudo) : undefined,
    };
    llamadas.push(llamada);

    if (llamada.url === '/api/v1/auth/csrf') {
      return respuestaFalsa({ estado: 200, cuerpo: { csrfToken: TESTIGO_CSRF } });
    }
    return respuestaFalsa(responder(llamada));
  };
  usarFetch(doble);
  return llamadas;
}

function llamadaDe(
  llamadas: readonly LlamadaRegistrada[],
  metodo: string,
  url: string,
): LlamadaRegistrada {
  const encontrada = llamadas.find((l) => l.metodo === metodo && l.url === url);
  if (encontrada === undefined) {
    throw new Error(
      `No se pidió ${metodo} ${url}. Se pidió: ${llamadas.map((l) => `${l.metodo} ${l.url}`).join(', ')}`,
    );
  }
  return encontrada;
}

function coleccionDePrueba(parcial: Partial<Coleccion> = {}): Coleccion {
  return {
    id: 'col-1',
    workspaceId: 'ws-1',
    slug: 'cobros',
    name: 'Cobros',
    description: 'Peticiones de cobro',
    visibility: 'workspace',
    status: 'active',
    lockVersion: 1,
    createdAt: '2026-02-01T09:00:00.000Z',
    updatedAt: '2026-02-01T09:00:00.000Z',
    ...parcial,
  };
}

function workspaceDePrueba(parcial: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-1',
    slug: 'pagos',
    name: 'Pagos',
    description: 'API de cobros',
    ownerUserId: 'u-1',
    status: 'active',
    createdAt: '2026-01-05T10:00:00.000Z',
    updatedAt: '2026-01-05T10:00:00.000Z',
    ...parcial,
  };
}

let pinia: Pinia;

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
});

describe('almacén de colecciones', () => {
  it('cargar() rellena el índice desde el cuerpo { colecciones: [...] }', async () => {
    const una = coleccionDePrueba();
    const otra = coleccionDePrueba({ id: 'col-2', slug: 'reembolsos', name: 'Reembolsos' });
    const llamadas = instalarApi(() => ({
      estado: 200,
      cuerpo: { colecciones: [una, otra] },
    }));

    const almacen = usarAlmacenDeColecciones();
    await almacen.cargar('ws-1');

    const peticion = llamadaDe(llamadas, 'GET', '/api/v1/workspaces/ws-1/collections');
    expect(peticion.credenciales).toBe('include');

    expect(almacen.deWorkspace('ws-1')).toHaveLength(2);
    expect(almacen.deWorkspace('ws-1').map((c) => c.name)).toEqual(['Cobros', 'Reembolsos']);
    expect(almacen.cargada('ws-1')).toBe(true);
    expect(almacen.cargada('ws-2')).toBe(false);
    expect(almacen.deWorkspace('ws-2')).toEqual([]);
    expect(almacen.error).toBeNull();
  });

  it('cargar() con lista vacía deja estaVacia en true sólo para ese workspace', async () => {
    instalarApi(() => ({ estado: 200, cuerpo: { colecciones: [] } }));

    const almacen = usarAlmacenDeColecciones();
    await almacen.cargar('ws-1');

    expect(almacen.estaVacia('ws-1')).toBe(true);
    expect(almacen.estaVacia('ws-2')).toBe(false);
  });

  it('crear() hace POST a /workspaces/:id/collections con credenciales y testigo CSRF', async () => {
    const creada = coleccionDePrueba({ id: 'col-9', slug: 'nueva', name: 'Nueva' });
    const llamadas = instalarApi((llamada) => {
      if (llamada.metodo === 'POST' && llamada.url === '/api/v1/workspaces/ws-1/collections') {
        return { estado: 201, cuerpo: { coleccion: creada } };
      }
      return { estado: 500, cuerpo: { error: 'inesperado', mensaje: 'Llamada no prevista.' } };
    });

    const almacen = usarAlmacenDeColecciones();
    const resultado = await almacen.crear('ws-1', {
      slug: 'nueva',
      name: 'Nueva',
      description: null,
    });

    expect(llamadaDe(llamadas, 'GET', '/api/v1/auth/csrf').credenciales).toBe('include');

    const peticion = llamadaDe(llamadas, 'POST', '/api/v1/workspaces/ws-1/collections');
    expect(peticion.credenciales).toBe('include');
    expect(peticion.cabeceras['x-ceiba-csrf']).toBe(TESTIGO_CSRF);
    expect(peticion.cabeceras['content-type']).toBe('application/json');
    expect(peticion.cuerpo).toEqual({ slug: 'nueva', name: 'Nueva', description: null });

    expect(resultado).toEqual(creada);
    expect(almacen.deWorkspace('ws-1')).toEqual([creada]);
    expect(almacen.guardando).toBe(false);
  });

  it('renombrar() hace PATCH a /collections/:id y actualiza el índice local', async () => {
    const original = coleccionDePrueba();
    const renombrada: Coleccion = { ...original, name: 'Cobros v2', lockVersion: 2 };
    const llamadas = instalarApi((llamada) => {
      if (llamada.metodo === 'PATCH' && llamada.url === '/api/v1/collections/col-1') {
        return { estado: 200, cuerpo: { coleccion: renombrada } };
      }
      return { estado: 200, cuerpo: { colecciones: [original] } };
    });

    const almacen = usarAlmacenDeColecciones();
    await almacen.cargar('ws-1');
    const resultado = await almacen.renombrar('col-1', 'ws-1', {
      name: 'Cobros v2',
      description: 'Peticiones de cobro',
    });

    const peticion = llamadaDe(llamadas, 'PATCH', '/api/v1/collections/col-1');
    expect(peticion.credenciales).toBe('include');
    expect(peticion.cabeceras['x-ceiba-csrf']).toBe(TESTIGO_CSRF);
    expect(peticion.cuerpo).toEqual({ name: 'Cobros v2', description: 'Peticiones de cobro' });

    // La ruta de renombrado NO cuelga del workspace: eso es lo que se vigila.
    expect(llamadas.some((l) => l.url.includes('/workspaces/ws-1/collections/col-1'))).toBe(false);

    expect(resultado).toEqual(renombrada);
    expect(almacen.deWorkspace('ws-1')).toHaveLength(1);
    expect(almacen.deWorkspace('ws-1')[0]?.name).toBe('Cobros v2');
  });

  it('borrar() hace DELETE a /collections/:id, trata el 204 y quita el elemento local', async () => {
    const una = coleccionDePrueba();
    const otra = coleccionDePrueba({ id: 'col-2', slug: 'reembolsos', name: 'Reembolsos' });
    const llamadas = instalarApi((llamada) => {
      if (llamada.metodo === 'DELETE' && llamada.url === '/api/v1/collections/col-1') {
        return { estado: 204 };
      }
      return { estado: 200, cuerpo: { colecciones: [una, otra] } };
    });

    const almacen = usarAlmacenDeColecciones();
    await almacen.cargar('ws-1');
    const borrada = await almacen.borrar('col-1', 'ws-1');

    const peticion = llamadaDe(llamadas, 'DELETE', '/api/v1/collections/col-1');
    expect(peticion.credenciales).toBe('include');
    expect(peticion.cabeceras['x-ceiba-csrf']).toBe(TESTIGO_CSRF);

    expect(borrada).toBe(true);
    expect(almacen.deWorkspace('ws-1').map((c) => c.id)).toEqual(['col-2']);
    expect(almacen.error).toBeNull();
  });

  it('un 409 de la API deja el mensaje en error y no corrompe el índice', async () => {
    const existente = coleccionDePrueba();
    instalarApi((llamada) => {
      if (llamada.metodo === 'POST') {
        return {
          estado: 409,
          cuerpo: { error: 'conflicto', mensaje: 'Ya existe una colección con ese slug.' },
        };
      }
      return { estado: 200, cuerpo: { colecciones: [existente] } };
    });

    const almacen = usarAlmacenDeColecciones();
    await almacen.cargar('ws-1');
    const resultado = await almacen.crear('ws-1', { slug: 'cobros', name: 'Cobros otra vez' });

    expect(resultado).toBeNull();
    expect(almacen.error).toBe('Ya existe una colección con ese slug.');
    expect(almacen.deWorkspace('ws-1')).toEqual([existente]);
    expect(almacen.guardando).toBe(false);
  });

  it('un error con detalles los añade al mensaje y no toca el índice', async () => {
    const existente = coleccionDePrueba();
    instalarApi((llamada) => {
      if (llamada.metodo === 'PATCH') {
        return {
          estado: 400,
          cuerpo: {
            error: 'entrada_invalida',
            mensaje: 'La entrada no es válida.',
            detalles: ['name: demasiado largo'],
          },
        };
      }
      return { estado: 200, cuerpo: { colecciones: [existente] } };
    });

    const almacen = usarAlmacenDeColecciones();
    await almacen.cargar('ws-1');
    const resultado = await almacen.renombrar('col-1', 'ws-1', { name: 'x'.repeat(200) });

    expect(resultado).toBeNull();
    expect(almacen.error).toBe('La entrada no es válida. (name: demasiado largo)');
    expect(almacen.deWorkspace('ws-1')).toEqual([existente]);
  });

  it('olvidar() descarta lo cargado de un workspace', async () => {
    instalarApi(() => ({ estado: 200, cuerpo: { colecciones: [coleccionDePrueba()] } }));

    const almacen = usarAlmacenDeColecciones();
    await almacen.cargar('ws-1');
    expect(almacen.cargada('ws-1')).toBe(true);

    almacen.olvidar('ws-1');
    expect(almacen.cargada('ws-1')).toBe(false);
    expect(almacen.deWorkspace('ws-1')).toEqual([]);
  });
});

describe('VistaDeWorkspace', () => {
  /** Ver la nota de `workspaces.test.ts`: componente global, no `stubs`. */
  function montar(workspaceId = 'ws-1') {
    return mount(VistaDeWorkspace, {
      props: { workspaceId },
      global: { plugins: [pinia], components: { RouterLink: RouterLinkStub } },
    });
  }

  it('pinta la cabecera del workspace y la lista de sus colecciones', async () => {
    const workspace = workspaceDePrueba();
    const una = coleccionDePrueba();
    const otra = coleccionDePrueba({ id: 'col-2', slug: 'reembolsos', name: 'Reembolsos' });
    instalarApi((llamada) => {
      if (llamada.url === '/api/v1/workspaces') {
        return { estado: 200, cuerpo: { workspaces: [workspace] } };
      }
      if (llamada.url === '/api/v1/workspaces/ws-1/collections') {
        return { estado: 200, cuerpo: { colecciones: [una, otra] } };
      }
      return { estado: 404, cuerpo: { error: 'no_encontrado', mensaje: 'No existe.' } };
    });

    const vista = montar();
    await flushPromises();

    const texto = vista.text();
    expect(texto).toContain('Pagos');
    expect(texto).toContain('Cobros');
    expect(texto).toContain('Reembolsos');
    expect(texto).toContain('(2)');

    // El enlace de vuelta al listado.
    const enlaces = vista.findAllComponents(RouterLinkStub);
    expect(enlaces).toHaveLength(1);
    expect(enlaces[0]?.props('to')).toEqual({ name: 'workspaces' });

    expect(usarAlmacenDeColecciones().deWorkspace('ws-1')).toHaveLength(2);
    vista.unmount();
  });

  it('muestra el estado vacío cuando el workspace no tiene colecciones', async () => {
    const workspace = workspaceDePrueba();
    instalarApi((llamada) => {
      if (llamada.url === '/api/v1/workspaces') {
        return { estado: 200, cuerpo: { workspaces: [workspace] } };
      }
      return { estado: 200, cuerpo: { colecciones: [] } };
    });

    const vista = montar();
    await flushPromises();

    expect(vista.text()).toContain('Este workspace no tiene colecciones');
    expect(vista.text()).toContain('Crear colección');
    vista.unmount();
  });

  it('al crear, el identificador se autorrellena desde el nombre y se envía en el POST', async () => {
    const workspace = workspaceDePrueba();
    const creada = coleccionDePrueba({
      id: 'col-9',
      slug: 'pagos-recurrentes',
      name: 'Pagos Recurrentes',
    });
    const llamadas = instalarApi((llamada) => {
      if (llamada.url === '/api/v1/workspaces') {
        return { estado: 200, cuerpo: { workspaces: [workspace] } };
      }
      if (llamada.metodo === 'POST') return { estado: 201, cuerpo: { coleccion: creada } };
      return { estado: 200, cuerpo: { colecciones: [] } };
    });

    const vista = montar();
    await flushPromises();

    const abrir = vista
      .findAll('button')
      .find((boton) => boton.text().includes('Nueva colección'));
    await abrir?.trigger('click');

    const dialogo = vista.findComponent(DialogoDeCreacion);
    const campos = dialogo.findAll('input');
    expect(campos).toHaveLength(2);

    await campos[0]?.setValue('Pagos Recurrentes');
    // El slug se deriva solo mientras el usuario no lo toque.
    expect((campos[1]?.element as HTMLInputElement | undefined)?.value).toBe('pagos-recurrentes');

    const crear = dialogo
      .findAll('button')
      .find((boton) => boton.text().includes('Crear colección'));
    await crear?.trigger('click');
    await flushPromises();

    const peticion = llamadaDe(llamadas, 'POST', '/api/v1/workspaces/ws-1/collections');
    expect(peticion.cuerpo).toEqual({
      slug: 'pagos-recurrentes',
      name: 'Pagos Recurrentes',
      description: null,
    });
    expect(peticion.cabeceras['x-ceiba-csrf']).toBe(TESTIGO_CSRF);
    expect(usarAlmacenDeColecciones().deWorkspace('ws-1')).toEqual([creada]);
    vista.unmount();
  });

  it('avisa si el workspace no está entre los del usuario, sin inventarse el motivo', async () => {
    instalarApi((llamada) => {
      if (llamada.url === '/api/v1/workspaces') return { estado: 200, cuerpo: { workspaces: [] } };
      return { estado: 403, cuerpo: { error: 'prohibido', mensaje: 'Sin acceso.' } };
    });

    const vista = montar('ws-ajeno');
    await flushPromises();

    expect(vista.text()).toContain('Workspace no disponible');
    expect(vista.text()).toContain('Sin acceso.');
    // No se pinta la lista: la casilla del índice no llegó a escribirse.
    expect(usarAlmacenDeWorkspaces().porId('ws-ajeno')).toBeNull();
    expect(usarAlmacenDeColecciones().cargada('ws-ajeno')).toBe(false);
    vista.unmount();
  });
});
