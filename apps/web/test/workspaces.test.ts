import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { RouterLinkStub, flushPromises, mount } from '@vue/test-utils';
import { usarFetch, type FuncionFetch } from '@/api/cliente';
import { usarAlmacenDeWorkspaces } from '@/stores/workspaces';
import DialogoDeBorrado from '@/components/workspaces/DialogoDeBorrado.vue';
import VistaDeWorkspaces from '@/views/VistaDeWorkspaces.vue';
import type { Workspace } from '@/api/tipos';

/**
 * Pruebas del almacén de workspaces y de su pantalla.
 *
 * Cómo se finge la API: `usarFetch()` de `src/api/cliente.ts` inyecta un doble.
 * Se finge **el transporte**, no el cliente, justamente para que lo que estas
 * pruebas comprueban sea lo que de verdad sale por el cable: el método, la
 * ruta, `credentials: "include"` (C-31) y la cabecera `x-ceiba-csrf`
 * (ADR-0009 §5). Si alguien «optimizara» el almacén haciendo `fetch` directo,
 * estas pruebas se caerían, que es el objetivo.
 *
 * El doble responde `GET /auth/csrf` con un testigo `nonce.firma`, igual que
 * la API real, porque es lo que el cliente pide antes de su primera mutación.
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

/**
 * Respuesta mínima con lo que `peticionApi` consume de verdad: `ok`, `status`,
 * `headers.get('content-type')` y `json()`. Se construye a mano y no con
 * `new Response(...)` para no depender de qué globales trae el entorno.
 */
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

/** Instala el doble y devuelve el registro de todo lo que se pidió. */
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

describe('almacén de workspaces', () => {
  it('cargar() rellena la lista desde el cuerpo { workspaces: [...] }', async () => {
    const primero = workspaceDePrueba();
    const segundo = workspaceDePrueba({ id: 'ws-2', slug: 'catalogo', name: 'Catálogo' });
    const llamadas = instalarApi(() => ({
      estado: 200,
      cuerpo: { workspaces: [primero, segundo] },
    }));

    const almacen = usarAlmacenDeWorkspaces();
    await almacen.cargar();

    expect(llamadaDe(llamadas, 'GET', '/api/v1/workspaces').credenciales).toBe('include');
    expect(almacen.lista).toHaveLength(2);
    expect(almacen.lista.map((w) => w.name)).toEqual(['Pagos', 'Catálogo']);
    expect(almacen.cargada).toBe(true);
    expect(almacen.cargando).toBe(false);
    expect(almacen.error).toBeNull();
    expect(almacen.porId('ws-2')?.slug).toBe('catalogo');
    expect(almacen.porId('ws-404')).toBeNull();
  });

  it('cargar() con lista vacía deja estaVacia en true', async () => {
    instalarApi(() => ({ estado: 200, cuerpo: { workspaces: [] } }));

    const almacen = usarAlmacenDeWorkspaces();
    await almacen.cargar();

    expect(almacen.lista).toEqual([]);
    expect(almacen.estaVacia).toBe(true);
  });

  it('crear() hace POST a /workspaces con credenciales y testigo CSRF', async () => {
    const creado = workspaceDePrueba({ id: 'ws-9', slug: 'nuevo', name: 'Nuevo' });
    const llamadas = instalarApi((llamada) => {
      if (llamada.metodo === 'POST' && llamada.url === '/api/v1/workspaces') {
        return { estado: 201, cuerpo: { workspace: creado } };
      }
      return { estado: 500, cuerpo: { error: 'inesperado', mensaje: 'Llamada no prevista.' } };
    });

    const almacen = usarAlmacenDeWorkspaces();
    const resultado = await almacen.crear({ slug: 'nuevo', name: 'Nuevo', description: null });

    // El cliente acuña el testigo antes de la mutación.
    expect(llamadaDe(llamadas, 'GET', '/api/v1/auth/csrf').credenciales).toBe('include');

    const peticion = llamadaDe(llamadas, 'POST', '/api/v1/workspaces');
    expect(peticion.credenciales).toBe('include');
    expect(peticion.cabeceras['x-ceiba-csrf']).toBe(TESTIGO_CSRF);
    expect(peticion.cabeceras['content-type']).toBe('application/json');
    expect(peticion.cuerpo).toEqual({ slug: 'nuevo', name: 'Nuevo', description: null });

    expect(resultado).toEqual(creado);
    expect(almacen.lista).toEqual([creado]);
    expect(almacen.guardando).toBe(false);
    expect(almacen.error).toBeNull();
  });

  it('renombrar() hace PATCH a /workspaces/:id y actualiza el elemento local', async () => {
    const original = workspaceDePrueba();
    const renombrado: Workspace = { ...original, name: 'Pagos v2', description: 'Nueva' };
    const llamadas = instalarApi((llamada) => {
      if (llamada.metodo === 'PATCH' && llamada.url === '/api/v1/workspaces/ws-1') {
        return { estado: 200, cuerpo: { workspace: renombrado } };
      }
      return { estado: 200, cuerpo: { workspaces: [original] } };
    });

    const almacen = usarAlmacenDeWorkspaces();
    await almacen.cargar();
    await almacen.renombrar('ws-1', { name: 'Pagos v2', description: 'Nueva' });

    const peticion = llamadaDe(llamadas, 'PATCH', '/api/v1/workspaces/ws-1');
    expect(peticion.credenciales).toBe('include');
    expect(peticion.cabeceras['x-ceiba-csrf']).toBe(TESTIGO_CSRF);
    expect(peticion.cuerpo).toEqual({ name: 'Pagos v2', description: 'Nueva' });

    expect(almacen.lista).toHaveLength(1);
    expect(almacen.porId('ws-1')?.name).toBe('Pagos v2');
  });

  it('borrar() hace DELETE, trata el 204 y quita el elemento local', async () => {
    const uno = workspaceDePrueba();
    const dos = workspaceDePrueba({ id: 'ws-2', slug: 'catalogo', name: 'Catálogo' });
    const llamadas = instalarApi((llamada) => {
      if (llamada.metodo === 'DELETE' && llamada.url === '/api/v1/workspaces/ws-1') {
        return { estado: 204 };
      }
      return { estado: 200, cuerpo: { workspaces: [uno, dos] } };
    });

    const almacen = usarAlmacenDeWorkspaces();
    await almacen.cargar();
    const borrado = await almacen.borrar('ws-1');

    const peticion = llamadaDe(llamadas, 'DELETE', '/api/v1/workspaces/ws-1');
    expect(peticion.credenciales).toBe('include');
    expect(peticion.cabeceras['x-ceiba-csrf']).toBe(TESTIGO_CSRF);

    expect(borrado).toBe(true);
    expect(almacen.lista.map((w) => w.id)).toEqual(['ws-2']);
    expect(almacen.error).toBeNull();
  });

  it('un 409 de la API deja el mensaje en error y no corrompe la lista', async () => {
    const existente = workspaceDePrueba();
    instalarApi((llamada) => {
      if (llamada.metodo === 'POST') {
        return {
          estado: 409,
          cuerpo: { error: 'conflicto', mensaje: 'Ya existe un workspace con ese slug.' },
        };
      }
      return { estado: 200, cuerpo: { workspaces: [existente] } };
    });

    const almacen = usarAlmacenDeWorkspaces();
    await almacen.cargar();
    const resultado = await almacen.crear({ slug: 'pagos', name: 'Pagos otra vez' });

    expect(resultado).toBeNull();
    expect(almacen.error).toBe('Ya existe un workspace con ese slug.');
    expect(almacen.lista).toEqual([existente]);
    expect(almacen.guardando).toBe(false);
  });

  it('un 403 al borrar deja el elemento en la lista', async () => {
    const existente = workspaceDePrueba();
    instalarApi((llamada) => {
      if (llamada.metodo === 'DELETE') {
        return {
          estado: 403,
          cuerpo: { error: 'prohibido', mensaje: 'Hace falta rol owner.' },
        };
      }
      return { estado: 200, cuerpo: { workspaces: [existente] } };
    });

    const almacen = usarAlmacenDeWorkspaces();
    await almacen.cargar();
    const borrado = await almacen.borrar('ws-1');

    expect(borrado).toBe(false);
    expect(almacen.error).toBe('Hace falta rol owner.');
    expect(almacen.lista).toEqual([existente]);
  });

  it('un fallo de carga no borra la lista que ya se tenía', async () => {
    const existente = workspaceDePrueba();
    let primeraVez = true;
    instalarApi(() => {
      if (primeraVez) {
        primeraVez = false;
        return { estado: 200, cuerpo: { workspaces: [existente] } };
      }
      return { estado: 500, cuerpo: { error: 'interno', mensaje: 'La API se ha caído.' } };
    });

    const almacen = usarAlmacenDeWorkspaces();
    await almacen.cargar();
    await almacen.cargar();

    expect(almacen.error).toBe('La API se ha caído.');
    expect(almacen.lista).toEqual([existente]);
    expect(almacen.cargada).toBe(true);
  });
});

describe('VistaDeWorkspaces', () => {
  /**
   * `RouterLink` se registra como **componente global**, no como `stubs`. Con
   * `stubs` el nombre no llega a resolverse (no hay router instalado), Vue
   * pinta un elemento desconocido y **se pierde el contenido del enlace**, con
   * lo que la prueba comprobaría un árbol que no es el de la aplicación.
   * Registrado como componente, `RouterLinkStub` pinta su `slot` y además
   * `findAllComponents(RouterLinkStub)` lo encuentra.
   */
  function montar() {
    return mount(VistaDeWorkspaces, {
      global: { plugins: [pinia], components: { RouterLink: RouterLinkStub } },
    });
  }

  it('muestra el estado vacío cuando la API no devuelve ningún workspace', async () => {
    instalarApi(() => ({ estado: 200, cuerpo: { workspaces: [] } }));

    const vista = montar();
    await flushPromises();

    expect(vista.text()).toContain('Todavía no hay ningún workspace');
    expect(vista.findAllComponents(RouterLinkStub)).toHaveLength(0);
    vista.unmount();
  });

  it('pinta una tarjeta por workspace, con enlace al detalle', async () => {
    const uno = workspaceDePrueba();
    const dos = workspaceDePrueba({ id: 'ws-2', slug: 'catalogo', name: 'Catálogo' });
    instalarApi(() => ({ estado: 200, cuerpo: { workspaces: [uno, dos] } }));

    const vista = montar();
    await flushPromises();

    const texto = vista.text();
    expect(texto).toContain('Pagos');
    expect(texto).toContain('Catálogo');
    expect(texto).not.toContain('Todavía no hay ningún workspace');

    const enlaces = vista.findAllComponents(RouterLinkStub);
    expect(enlaces).toHaveLength(2);
    expect(enlaces[0]?.props('to')).toEqual({
      name: 'workspace',
      params: { workspaceId: 'ws-1' },
    });
    expect(enlaces[1]?.props('to')).toEqual({
      name: 'workspace',
      params: { workspaceId: 'ws-2' },
    });
    vista.unmount();
  });

  it('no borra sin confirmación explícita: hay que teclear el identificador', async () => {
    const uno = workspaceDePrueba();
    const dos = workspaceDePrueba({ id: 'ws-2', slug: 'catalogo', name: 'Catálogo' });
    const llamadas = instalarApi((llamada) => {
      if (llamada.metodo === 'DELETE' && llamada.url === '/api/v1/workspaces/ws-1') {
        return { estado: 204 };
      }
      return { estado: 200, cuerpo: { workspaces: [uno, dos] } };
    });

    const vista = montar();
    await flushPromises();

    // El botón de la tarjeta **no** borra: abre la confirmación.
    const botonDeTarjeta = vista
      .findAll('button')
      .find((boton) => boton.attributes('aria-label') === 'Borrar el workspace Pagos');
    expect(botonDeTarjeta).toBeDefined();
    await botonDeTarjeta?.trigger('click');
    expect(llamadas.some((l) => l.metodo === 'DELETE')).toBe(false);

    const dialogo = vista.findComponent(DialogoDeBorrado);
    expect(dialogo.exists()).toBe(true);
    expect(dialogo.text()).toContain('Esta acción no se puede deshacer');
    expect(dialogo.text()).toContain('El servidor exige rol «owner» para borrar un workspace.');

    const confirmar = dialogo
      .findAll('button')
      .find((boton) => boton.text().includes('Borrar definitivamente'));
    expect(confirmar).toBeDefined();
    // Sin teclear el identificador, el botón destructivo está inactivo.
    expect(confirmar?.attributes('disabled')).toBeDefined();

    await dialogo.find('input').setValue('pagos');
    expect(confirmar?.attributes('disabled')).toBeUndefined();

    await confirmar?.trigger('click');
    await flushPromises();

    expect(llamadaDe(llamadas, 'DELETE', '/api/v1/workspaces/ws-1').cabeceras['x-ceiba-csrf']).toBe(
      TESTIGO_CSRF,
    );
    expect(usarAlmacenDeWorkspaces().lista.map((w) => w.id)).toEqual(['ws-2']);
    expect(vista.findComponent(DialogoDeBorrado).exists()).toBe(false);
    vista.unmount();
  });

  it('enseña el error de la API con un botón de reintento', async () => {
    instalarApi(() => ({
      estado: 500,
      cuerpo: { error: 'interno', mensaje: 'La API se ha caído.' },
    }));

    const vista = montar();
    await flushPromises();

    expect(vista.text()).toContain('La API se ha caído.');
    expect(vista.text()).toContain('Reintentar');
    vista.unmount();
  });
});
