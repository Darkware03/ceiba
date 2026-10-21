import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { usarFetch, type FuncionFetch } from '@/api/cliente';
import {
  crearEnlaceDeColeccion,
  listarEnlacesDeColeccion,
  revocarEnlaceDeColeccion,
} from '@/api/studio';
import DialogoDeComparticion from '@/components/comparticion/DialogoDeComparticion.vue';
import BotonDeCompartir from '@/components/comparticion/BotonDeCompartir.vue';
import TarjetaDeWorkspace from '@/components/workspaces/TarjetaDeWorkspace.vue';
import VistaDeWorkspace from '@/views/VistaDeWorkspace.vue';
import type { Workspace } from '@/api/tipos';

/**
 * Pruebas de P7 (compartir).
 *
 * LA PRUEBA DE ACEPTACIÓN LA FIJÓ EL CLIENTE: «que sea más rápido y fácil».
 * Traducido a algo que una prueba pueda comprobar: **dos pulsaciones desde la
 * pantalla hasta tener el enlace en el portapapeles**. El caso
 * «dos pulsaciones…» de más abajo las cuenta, literalmente.
 *
 * Lo segundo que vigilan estas pruebas es la **doble vía**: cuando se
 * escribieron, `POST /collections/:id/invitations` (BRIEF-FASE7 §2.4) **no
 * existía en el árbol** —medido con `grep -rn` sobre `apps/api/src`— y el
 * módulo `sharing` sí. El cliente HTTP intenta el primero y cae al segundo, de
 * forma que la pantalla funciona hoy y se actualizará sola cuando el ámbito B
 * publique su ruta. Hay un caso para cada rama.
 */

const TESTIGO_CSRF = 'nonce.firma';

interface Llamada {
  readonly metodo: string;
  readonly url: string;
  readonly cuerpo: unknown;
}

interface Planificada {
  readonly estado: number;
  readonly cuerpo?: unknown;
}

function respuestaFalsa({ estado, cuerpo }: Planificada): Response {
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
  responder: (llamada: Llamada) => Planificada,
): Llamada[] {
  const llamadas: Llamada[] = [];
  const doble: FuncionFetch = async (entrada, iniciales) => {
    const url = String(entrada);
    if (url === '/api/v1/auth/csrf') {
      return respuestaFalsa({ estado: 200, cuerpo: { csrfToken: TESTIGO_CSRF } });
    }
    const crudo = iniciales?.body;
    const llamada: Llamada = {
      metodo: (iniciales?.method ?? 'GET').toUpperCase(),
      url,
      cuerpo: typeof crudo === 'string' ? JSON.parse(crudo) : undefined,
    };
    llamadas.push(llamada);
    return respuestaFalsa(responder(llamada));
  };
  usarFetch(doble);
  return llamadas;
}

/** 404 en las rutas del §2.4; el módulo `sharing` responde. */
function apiSoloConSharing(): Llamada[] {
  return instalarApi((llamada) => {
    // El §2.4 no existe todavía para POST/GET… salvo el DELETE de revocación,
    // que se deja responder para poder ejercitar esa rama del cliente.
    if (llamada.url.includes('/invitations') && llamada.metodo !== 'DELETE') {
      return { estado: 404, cuerpo: { error: 'no_encontrado', mensaje: 'No existe.' } };
    }
    if (llamada.metodo === 'DELETE' && llamada.url.includes('/invitations/')) {
      return { estado: 204 };
    }
    if (llamada.metodo === 'POST' && llamada.url === '/api/v1/collections/col-1/shares') {
      return {
        estado: 201,
        cuerpo: {
          share: {
            id: 'sh-1',
            collectionId: 'col-1',
            slug: 'abc123',
            url: 'https://ceiba.example/s/abc123',
            permission: 'viewer',
            expiresAt: '2026-11-01T00:00:00.000Z',
            revokedAt: null,
          },
          accessCode: null,
          aviso: 'El código se muestra una sola vez.',
        },
      };
    }
    if (llamada.metodo === 'GET' && llamada.url === '/api/v1/collections/col-1/shares') {
      return { estado: 200, cuerpo: { shares: [], visibility: null } };
    }
    if (llamada.url.startsWith('/api/v1/shares/')) return { estado: 204 };
    return { estado: 404, cuerpo: { mensaje: 'No' } };
  });
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

/** Portapapeles de mentira. Devuelve lo que se haya escrito. */
function instalarPortapapeles(): { escrito: string[] } {
  const escrito: string[] = [];
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (texto: string) => {
        escrito.push(texto);
      },
    },
  });
  return { escrito };
}

function quitarPortapapeles(): void {
  Object.defineProperty(globalThis.navigator, 'clipboard', {
    configurable: true,
    value: undefined,
  });
}

describe('cliente de compartición de colecciones', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('usa el contrato §2.4 cuando existe, y no toca el módulo sharing', async () => {
    const llamadas = instalarApi((llamada) => {
      if (llamada.metodo === 'POST' && llamada.url === '/api/v1/collections/col-1/invitations') {
        return {
          estado: 201,
          cuerpo: {
            id: 'inv-1',
            role: 'viewer',
            status: 'pending',
            expiresAt: '2026-11-01T00:00:00.000Z',
            inviteToken: 'tok',
            invitePath: '/invitacion/tok',
          },
        };
      }
      return { estado: 404, cuerpo: { mensaje: 'No' } };
    });

    const enlace = await crearEnlaceDeColeccion('col-1', {
      permiso: 'viewer',
      dias: 7,
      conCodigo: false,
    });

    expect(enlace.origen).toBe('invitations');
    expect(enlace.url).toMatch(/\/invitacion\/tok$/u);
    expect(llamadas.map((l) => l.url)).not.toContain('/api/v1/collections/col-1/shares');
  });

  it('cae al módulo `sharing` cuando el §2.4 todavía no está publicado', async () => {
    const llamadas = apiSoloConSharing();

    const enlace = await crearEnlaceDeColeccion('col-1', {
      permiso: 'viewer',
      dias: 7,
      conCodigo: false,
    });

    expect(enlace.origen).toBe('shares');
    // Lo único que de verdad importa: un enlace pegable en un chat.
    expect(enlace.url).toBe('https://ceiba.example/s/abc123');
    expect(llamadas.map((l) => `${l.metodo} ${l.url}`)).toEqual([
      'POST /api/v1/collections/col-1/invitations',
      'POST /api/v1/collections/col-1/shares',
    ]);
  });

  it('traduce la caducidad en días a la fecha absoluta que exige `sharing`', async () => {
    const llamadas = apiSoloConSharing();

    await crearEnlaceDeColeccion('col-1', { permiso: 'executor', dias: 30, conCodigo: true });

    const creacion = llamadas.find((l) => l.url.endsWith('/shares'));
    const cuerpo = creacion?.cuerpo as Record<string, unknown>;
    expect(cuerpo['permission']).toBe('executor');
    expect(cuerpo['requiresAccessCode']).toBe(true);
    expect(typeof cuerpo['expiresAt']).toBe('string');
    const dias = (new Date(cuerpo['expiresAt'] as string).getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(29);
    expect(dias).toBeLessThan(31);
  });

  it('un 403 NO se degrada: un «no tienes permiso» no se reintenta por otra puerta', async () => {
    const llamadas = instalarApi(() => ({
      estado: 403,
      cuerpo: { error: 'prohibido', mensaje: 'Necesitas rol editor.' },
    }));

    await expect(
      crearEnlaceDeColeccion('col-1', { permiso: 'viewer', dias: 7, conCodigo: false }),
    ).rejects.toThrow(/editor/u);
    // Una sola llamada: no hubo segundo intento disfrazando el 403.
    expect(llamadas).toHaveLength(1);
  });

  it('revocar usa la ruta de quien sirvió el enlace, no una adivinada', async () => {
    const llamadas = apiSoloConSharing();

    await revocarEnlaceDeColeccion('col-1', { id: 'sh-1', origen: 'shares' });
    await revocarEnlaceDeColeccion('col-1', { id: 'inv-1', origen: 'invitations' });

    expect(llamadas.map((l) => `${l.metodo} ${l.url}`)).toEqual([
      'POST /api/v1/shares/sh-1/revoke',
      'DELETE /api/v1/collections/col-1/invitations/inv-1',
    ]);
  });

  it('listar también cae a `sharing` si el §2.4 no está', async () => {
    apiSoloConSharing();
    const lista = await listarEnlacesDeColeccion('col-1');
    expect(lista).toEqual([]);
  });

  it('lee el `inviteUrl` aditivo que el ámbito B añadió a `POST /shares`', async () => {
    // El ámbito B resolvió P7 de colecciones **ampliando `sharing`** en vez de
    // crear las rutas del §2.4, y añadió `inviteUrl` al nivel superior con el
    // mismo valor que `share.url`, para que la interfaz lea un solo campo en
    // workspaces y colecciones. Se comprueba que se respeta ese campo.
    instalarApi((llamada) => {
      if (llamada.url.includes('/invitations')) return { estado: 404, cuerpo: { mensaje: 'No' } };
      return {
        estado: 201,
        cuerpo: {
          share: { id: 'sh-2', slug: 'qqq', url: '', permission: 'viewer', revokedAt: null },
          inviteUrl: 'https://ceiba.example/s/qqq',
          accessCode: null,
          aviso: '',
        },
      };
    });

    const enlace = await crearEnlaceDeColeccion('col-1', {
      permiso: 'viewer',
      dias: 7,
      conCodigo: false,
    });

    expect(enlace.url).toBe('https://ceiba.example/s/qqq');
  });
});

describe('icono de compartir (P7)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('tiene nombre accesible: un icono mudo no es un control', () => {
    const envoltorio = mount(BotonDeCompartir, { props: { nombre: 'Pagos' } });
    expect(envoltorio.get('button').attributes('aria-label')).toBe('Compartir Pagos');
  });

  it('está en la tarjeta de workspace, que es «su respectiva pantalla»', () => {
    const compartidos: number[] = [];
    const envoltorio = mount(TarjetaDeWorkspace, {
      props: {
        workspace: workspaceDePrueba(),
        onCompartir: () => compartidos.push(1),
      },
      global: { stubs: { RouterLink: true } },
    });

    const icono = envoltorio.get('[aria-label="Compartir Pagos"]');
    void icono.trigger('click');

    expect(compartidos).toHaveLength(1);
  });

  it('está también en la pantalla de UN workspace, no sólo en la lista', async () => {
    instalarApi((llamada) => {
      if (llamada.url === '/api/v1/workspaces') {
        return { estado: 200, cuerpo: { workspaces: [workspaceDePrueba()] } };
      }
      if (llamada.url === '/api/v1/workspaces/ws-1/collections') {
        return { estado: 200, cuerpo: { colecciones: [] } };
      }
      return { estado: 200, cuerpo: { invitations: [] } };
    });

    const envoltorio = mount(VistaDeWorkspace, {
      props: { workspaceId: 'ws-1' },
      global: { stubs: { RouterLink: true, CeibaSpinner: true } },
    });
    await flushPromises();

    const icono = envoltorio.find('[aria-label="Compartir Pagos"]');
    expect(icono.exists()).toBe(true);

    // Y abre el diálogo de verdad: la 1.ª de las dos pulsaciones.
    await icono.trigger('click');
    await flushPromises();
    expect(envoltorio.text()).toContain('Crear enlace y copiar');
  });
});

describe('diálogo de compartición (P7)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('DOS PULSACIONES: abrir el diálogo y pulsar una vez deja el enlace en el portapapeles', async () => {
    apiSoloConSharing();
    const portapapeles = instalarPortapapeles();

    // 1.ª pulsación: el icono. La vista responde abriendo el diálogo, que es
    // lo que aquí se simula montándolo ya abierto.
    const envoltorio = mount(DialogoDeComparticion, {
      props: { abierto: true, tipo: 'coleccion', recursoId: 'col-1', nombre: 'Cobros' },
    });
    await flushPromises();

    // 2.ª pulsación: y sólo esta. No hay que elegir nada antes.
    const boton = envoltorio
      .findAll('button')
      .find((b) => b.text().includes('Crear enlace y copiar'));
    expect(boton).toBeDefined();
    await boton?.trigger('click');
    await flushPromises();

    expect(portapapeles.escrito).toEqual(['https://ceiba.example/s/abc123']);
    expect(envoltorio.text()).toContain('Enlace copiado al portapapeles');
    quitarPortapapeles();
  });

  it('si el portapapeles no está disponible, el enlace NO se pierde', async () => {
    apiSoloConSharing();
    quitarPortapapeles();

    const envoltorio = mount(DialogoDeComparticion, {
      props: { abierto: true, tipo: 'coleccion', recursoId: 'col-1', nombre: 'Cobros' },
    });
    await flushPromises();
    await envoltorio
      .findAll('button')
      .find((b) => b.text().includes('Crear enlace y copiar'))
      ?.trigger('click');
    await flushPromises();

    expect(envoltorio.text()).toContain('Copia el enlace a mano');
    const campo = envoltorio.get('input[aria-label="Enlace de invitación generado"]');
    expect((campo.element as HTMLInputElement).value).toBe('https://ceiba.example/s/abc123');
  });

  it('para un workspace reutiliza la invitación que YA existía; no la reescribe', async () => {
    const llamadas = instalarApi((llamada) => {
      if (llamada.metodo === 'POST' && llamada.url === '/api/v1/workspaces/ws-1/invitations') {
        return {
          estado: 201,
          cuerpo: {
            id: 'inv-1',
            email: 'enlace-compartido@ceiba.local',
            role: 'viewer',
            modeLabel: 'Solo mostrar (Lectura)',
            status: 'pending',
            invitedByName: 'Ana',
            expiresAt: '2026-11-01T00:00:00.000Z',
            acceptedAt: null,
            createdAt: '2026-10-21T00:00:00.000Z',
            inviteToken: 'tok',
            invitePath: '/invitacion/tok',
          },
        };
      }
      return { estado: 200, cuerpo: { invitations: [] } };
    });
    instalarPortapapeles();

    const envoltorio = mount(DialogoDeComparticion, {
      props: { abierto: true, tipo: 'workspace', recursoId: 'ws-1', nombre: 'Pagos' },
    });
    await flushPromises();
    await envoltorio
      .findAll('button')
      .find((b) => b.text().includes('Crear enlace y copiar'))
      ?.trigger('click');
    await flushPromises();

    const creacion = llamadas.find(
      (l) => l.metodo === 'POST' && l.url === '/api/v1/workspaces/ws-1/invitations',
    );
    expect(creacion).toBeDefined();
    // El campo de caducidad del servidor se llama `expiresInDays`, no
    // `expiresInHours`: verificado en `studio-collab.service.ts:209`.
    expect(creacion?.cuerpo).toMatchObject({ role: 'viewer', expiresInDays: 7 });
    quitarPortapapeles();
  });

  it('«crear workspace dedicado» crea el workspace y comparte el NUEVO, no el de partida', async () => {
    const llamadas = instalarApi((llamada) => {
      if (llamada.metodo === 'POST' && llamada.url === '/api/v1/workspaces') {
        return { estado: 201, cuerpo: { workspace: workspaceDePrueba({ id: 'ws-9' }) } };
      }
      if (llamada.metodo === 'POST' && llamada.url === '/api/v1/workspaces/ws-9/invitations') {
        return {
          estado: 201,
          cuerpo: {
            id: 'inv-9',
            email: 'enlace-compartido@ceiba.local',
            role: 'viewer',
            modeLabel: 'Solo mostrar (Lectura)',
            status: 'pending',
            invitedByName: 'Ana',
            expiresAt: '2026-11-01T00:00:00.000Z',
            acceptedAt: null,
            createdAt: '2026-10-21T00:00:00.000Z',
            inviteToken: 'tok9',
            invitePath: '/invitacion/tok9',
          },
        };
      }
      return { estado: 200, cuerpo: { invitations: [] } };
    });
    const portapapeles = instalarPortapapeles();

    const envoltorio = mount(DialogoDeComparticion, {
      props: { abierto: true, tipo: 'workspace', recursoId: 'ws-1', nombre: 'Pagos' },
    });
    await flushPromises();

    const radios = envoltorio.findAll('input[type="radio"]');
    await radios[1]?.setValue();
    await envoltorio.get('input[type="text"]').setValue('Equipo de integración');
    await envoltorio
      .findAll('button')
      .find((b) => b.text().includes('Crear enlace y copiar'))
      ?.trigger('click');
    await flushPromises();

    const creacion = llamadas.find((l) => l.url === '/api/v1/workspaces');
    expect((creacion?.cuerpo as Record<string, unknown>)['name']).toBe('Equipo de integración');
    // Comparte el recién creado (ws-9), no el que se estaba mirando (ws-1).
    // Se compara sobre los POST: el GET a `ws-1/invitations` SÍ es legítimo,
    // porque el diálogo se abrió sobre ws-1 y lista sus enlaces vigentes.
    const creados = llamadas
      .filter((l) => l.metodo === 'POST' && l.url.endsWith('/invitations'))
      .map((l) => l.url);
    expect(creados).toEqual(['/api/v1/workspaces/ws-9/invitations']);
    expect(portapapeles.escrito[0]).toMatch(/\/invitacion\/tok9$/u);
    quitarPortapapeles();
  });

  it('lista los enlaces vigentes y los deja revocar', async () => {
    const llamadas = instalarApi((llamada) => {
      if (llamada.url.includes('/invitations')) {
        return { estado: 404, cuerpo: { mensaje: 'No' } };
      }
      if (llamada.metodo === 'GET' && llamada.url === '/api/v1/collections/col-1/shares') {
        return {
          estado: 200,
          cuerpo: {
            shares: [
              {
                id: 'sh-7',
                collectionId: 'col-1',
                slug: 'zzz',
                url: 'https://ceiba.example/s/zzz',
                permission: 'viewer',
                expiresAt: '2026-11-01T00:00:00.000Z',
                revokedAt: null,
              },
            ],
          },
        };
      }
      return { estado: 204 };
    });

    const envoltorio = mount(DialogoDeComparticion, {
      props: { abierto: true, tipo: 'coleccion', recursoId: 'col-1', nombre: 'Cobros' },
    });
    await flushPromises();

    // Se mira la LISTA, no el texto suelto: «Solo lectura» también es una
    // opción del selector de permiso, así que buscarlo en `text()` pasaría
    // aunque la lista estuviese vacía. Esa trampa ya se coló una vez.
    expect(envoltorio.findAll('.comparticion__item')).toHaveLength(1);
    const revocar = envoltorio.findAll('button').find((b) => b.text().includes('Revocar'));
    expect(revocar).toBeDefined();
    await revocar?.trigger('click');
    await flushPromises();

    expect(llamadas.some((l) => l.url === '/api/v1/shares/sh-7/revoke')).toBe(true);
    expect(envoltorio.text()).toContain('No hay ningún enlace activo todavía');
  });

  it('un fallo al crear se dice; no se copia un enlace vacío', async () => {
    instalarApi(() => ({
      estado: 500,
      cuerpo: { error: 'error_interno', mensaje: 'Se rompió algo.' },
    }));
    const portapapeles = instalarPortapapeles();

    const envoltorio = mount(DialogoDeComparticion, {
      props: { abierto: true, tipo: 'coleccion', recursoId: 'col-1', nombre: 'Cobros' },
    });
    await flushPromises();
    await envoltorio
      .findAll('button')
      .find((b) => b.text().includes('Crear enlace y copiar'))
      ?.trigger('click');
    await flushPromises();

    expect(envoltorio.text()).toContain('No se pudo crear el enlace');
    expect(portapapeles.escrito).toEqual([]);
    quitarPortapapeles();
  });

  it('sólo ofrece caducidades que el servidor respeta (1, 7 y 30 días)', async () => {
    apiSoloConSharing();
    const envoltorio = mount(DialogoDeComparticion, {
      props: { abierto: true, tipo: 'coleccion', recursoId: 'col-1', nombre: 'Cobros' },
    });
    await flushPromises();

    const opciones = envoltorio
      .findAll('select')[1]
      ?.findAll('option')
      .map((o) => o.text());

    // El servidor recorta con Math.min(..., 30): ofrecer «90 días» sería
    // ofrecer algo que se convierte en 30 sin avisar.
    expect(opciones).toEqual(['1 día', '7 días', '30 días']);
  });
});

describe('higiene', () => {
  it('no quedan espías colgando entre casos', () => {
    expect(vi.isMockFunction(globalThis.fetch)).toBe(false);
  });
});
