import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';

import { usarFetch, type FuncionFetch } from '@/api/cliente';
import {
  MENSAJE_ACCESO_INVALIDO,
  consultarEstadoDeEnlace,
  sanearPeticionCompartida,
  type ColeccionCompartida,
  type PeticionCompartida,
} from '@/api/comparticion';
import { guardaDeSesion } from '@/router/guardas';
import { NOMBRES_RUTAS } from '@/router/nombres';
import { rutas } from '@/router/rutas';
import VistaDeComparticionPublica from '@/views/VistaDeComparticionPublica.vue';
import ValoresCompartidos from '@/components/comparticion/ValoresCompartidos.vue';
import ListaDePeticionesCompartidas from '@/components/comparticion/ListaDePeticionesCompartidas.vue';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * LA PANTALLA QUE RECIBE `/s/:slug`.
 *
 * Lo que estas pruebas vigilan de verdad, por orden de importancia:
 *
 *  1. **Que el enlace aterrice.** Antes de esta ronda, `/s/<slug>` caía en el
 *     comodín → «página no encontrada». Hay un caso que resuelve la ruta
 *     contra la tabla REAL (`rutas.ts`), no contra una inventada: si alguien
 *     mueve la ruta detrás del comodín, el caso se cae.
 *
 *  2. **Que el destinatario sin cuenta pueda entrar.** El guard deniega por
 *     omisión. Hay un caso que lo ejecuta de verdad, sin sesión.
 *
 *  3. **Que no se distingan las causas de rechazo** (`C-CODE-04`). Es el caso
 *     estrella: código incorrecto, enlace caducado y enlace revocado producen
 *     el MISMO 401 en el servidor, y la prueba comprueba que producen el mismo
 *     texto **byte a byte** en el DOM.
 *
 *  4. **Que no se pinte un secreto.** Se le manda a la interfaz una cabecera
 *     con `secret: true` y el `value` RELLENO —cosa que el servidor no hace,
 *     pero que un cambio futuro podría hacer— y se comprueba que el valor no
 *     aparece en el DOM.
 *
 * `wrapper.emitted()` NO se usa: el ámbito C y el ámbito D midieron por
 * separado que en este entorno (Vue 3.5.44 + @vue/test-utils 2.5.1 + Vitest 5)
 * sólo recoge eventos DOM que burbujean, no los `emit` del componente. Se
 * escuchan con oyentes reales (`onSeleccionar`, `onEnviar`), que además es lo
 * que hace la vista al integrar.
 * ════════════════════════════════════════════════════════════════════════════
 */

const TESTIGO_CSRF = 'nonce.firma';
const SLUG = 'aB3xK9zQ';

interface Llamada {
  readonly metodo: string;
  readonly url: string;
  readonly cuerpo: unknown;
  readonly cabeceras: Record<string, string>;
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

function instalarApi(responder: (llamada: Llamada) => Planificada): Llamada[] {
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
      cabeceras: (iniciales?.headers ?? {}) as Record<string, string>,
    };
    llamadas.push(llamada);
    return respuestaFalsa(responder(llamada));
  };
  usarFetch(doble);
  return llamadas;
}

/** El 401 único del servidor, idéntico para las seis causas de rechazo. */
const RECHAZO_UNICO: Planificada = {
  estado: 401,
  cuerpo: { error: 'invalid_access', mensaje: 'El enlace o el código no son válidos.' },
};

function peticionDePrueba(parcial: Partial<PeticionCompartida> = {}): PeticionCompartida {
  return {
    id: 'req-1',
    folderId: null,
    name: 'Listar clientes',
    description: null,
    method: 'GET',
    url: 'https://api.ejemplo.com/clientes',
    authMode: 'none',
    timeoutMs: null,
    headers: [],
    params: [],
    body: null,
    hasPreRequestScript: false,
    hasPostResponseScript: false,
    ...parcial,
  };
}

function coleccionDePrueba(parcial: Partial<ColeccionCompartida> = {}): ColeccionCompartida {
  return {
    id: 'col-1',
    name: 'API de facturación',
    slug: 'api-facturacion',
    description: 'Las rutas de cobro',
    visibility: 'workspace',
    defaultAuthMode: 'none',
    defaultTimeoutMs: 30000,
    expectedVariables: [],
    requestCount: 1,
    updatedAt: '2026-10-20T10:00:00.000Z',
    folders: [],
    requests: [peticionDePrueba()],
    ...parcial,
  };
}

/** Responde el camino feliz completo: enlace abierto, sesión y colección. */
function apiFeliz(
  opciones: {
    estado?: 'open' | 'code_required';
    canExport?: boolean;
    canExecute?: boolean;
    coleccion?: ColeccionCompartida;
    accesoFalla?: boolean;
  } = {},
): Llamada[] {
  const {
    estado = 'open',
    canExport = false,
    canExecute = false,
    coleccion = coleccionDePrueba(),
    accesoFalla = false,
  } = opciones;

  return instalarApi((llamada) => {
    if (llamada.metodo === 'GET' && llamada.url === `/api/v1/share/${SLUG}`) {
      return { estado: 200, cuerpo: { estado } };
    }
    if (llamada.metodo === 'POST' && llamada.url === `/api/v1/share/${SLUG}/access`) {
      if (accesoFalla) return RECHAZO_UNICO;
      return {
        estado: 200,
        cuerpo: {
          permission: 'viewer',
          expiresAt: '2026-11-01T10:00:00.000Z',
          collectionName: null,
        },
      };
    }
    if (llamada.url === '/api/v1/share/session/me') {
      return {
        estado: 200,
        cuerpo: {
          permission: canExport ? 'viewer_export' : 'viewer',
          expiresAt: '2026-11-01T10:00:00.000Z',
          canExport,
          canExecute,
        },
      };
    }
    if (llamada.url === '/api/v1/share/content/collection') {
      return { estado: 200, cuerpo: { collection: coleccion } };
    }
    if (llamada.url === '/api/v1/share/session/logout') {
      return { estado: 204 };
    }
    if (llamada.url === '/api/v1/share/content/export') {
      return { estado: 200, cuerpo: { ceiba: { format: 'ceiba-collection' }, collection: coleccion } };
    }
    return { estado: 404, cuerpo: { error: 'no_encontrado', mensaje: 'No existe.' } };
  });
}

/**
 * Monta la vista con el router YA resuelto en `/s/<SLUG>`.
 *
 * El `await` del `push` no es decorativo: sin él, `useRoute()` todavía no tiene
 * `params.slug` cuando corre `onMounted`, la vista se cree que el enlace está
 * incompleto y 22 casos fallan a la vez con «Enlace incompleto». Medido en
 * esta sesión; se deja escrito para quien añada casos después.
 */
async function montarVista(): Promise<ReturnType<typeof mount>> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      {
        path: '/s/:slug',
        name: NOMBRES_RUTAS.COMPARTICION_PUBLICA,
        component: VistaDeComparticionPublica,
      },
    ],
  });
  await router.push(`/s/${SLUG}`);
  await router.isReady();
  return mount(VistaDeComparticionPublica, {
    global: { plugins: [router, createPinia()] },
  });
}

/** Deja que se asiente la cadena estado → acceso → sesión → colección. */
async function asentar(veces = 8): Promise<void> {
  for (let i = 0; i < veces; i += 1) await flushPromises();
}

beforeEach(() => {
  setActivePinia(createPinia());
});

// ───────────────────────────────────────────────────────────────────────────
// 1. La ruta existe y aterriza
// ───────────────────────────────────────────────────────────────────────────

describe('/s/:slug · la ruta que faltaba', () => {
  function routerReal(): Router {
    return createRouter({ history: createMemoryHistory(), routes: rutas });
  }

  it('resuelve a la vista de compartición y NO al comodín de «no encontrado»', async () => {
    const router = routerReal();
    await router.push('/s/aB3xK9zQ');
    await router.isReady();
    const actual = router.currentRoute.value;

    expect(actual.name).toBe(NOMBRES_RUTAS.COMPARTICION_PUBLICA);
    expect(actual.name).not.toBe(NOMBRES_RUTAS.NO_ENCONTRADA);
    expect(actual.params['slug']).toBe('aB3xK9zQ');
  });

  it('va declarada ANTES del comodín: el orden de la tabla importa', () => {
    const indiceCompartida = rutas.findIndex(
      (ruta) => ruta.name === NOMBRES_RUTAS.COMPARTICION_PUBLICA,
    );
    const indiceComodin = rutas.findIndex((ruta) => ruta.name === NOMBRES_RUTAS.NO_ENCONTRADA);

    expect(indiceCompartida).toBeGreaterThanOrEqual(0);
    expect(indiceCompartida).toBeLessThan(indiceComodin);
  });

  it('es PÚBLICA: sin esto el destinatario, que no tiene cuenta, acaba en el login', () => {
    const ruta = rutas.find((r) => r.name === NOMBRES_RUTAS.COMPARTICION_PUBLICA);
    expect(ruta?.meta?.['publica']).toBe(true);
  });

  it('el guard REAL la deja pasar sin sesión', async () => {
    instalarApi(() => ({ estado: 401, cuerpo: { error: 'no_autenticado', mensaje: 'No.' } }));
    const router = routerReal();
    await router.push('/s/aB3xK9zQ');
    await router.isReady();

    const resultado = await guardaDeSesion(router.currentRoute.value);

    // `true` = pasa. Un objeto sería una redirección al login.
    expect(resultado).toBe(true);
  });

  it('se pinta sin el armazón de la aplicación', () => {
    const ruta = rutas.find((r) => r.name === NOMBRES_RUTAS.COMPARTICION_PUBLICA);
    expect(ruta?.meta?.['sinArmazon']).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. El cliente de API
// ───────────────────────────────────────────────────────────────────────────

describe('api/comparticion · el cliente del consumo público', () => {
  it('consulta el estado con GET /share/:slug', async () => {
    const llamadas = instalarApi(() => ({ estado: 200, cuerpo: { estado: 'open' } }));
    const estado = await consultarEstadoDeEnlace(SLUG);

    expect(estado).toBe('open');
    expect(llamadas[0]?.metodo).toBe('GET');
    expect(llamadas[0]?.url).toBe(`/api/v1/share/${SLUG}`);
  });

  it('un estado desconocido falla CERRADO: pide código, no abre', async () => {
    instalarApi(() => ({ estado: 200, cuerpo: { estado: 'algo_que_no_existe' } }));
    await expect(consultarEstadoDeEnlace(SLUG)).resolves.toBe('code_required');
  });

  it('manda el código en el CUERPO del POST y JAMÁS en la URL', async () => {
    const llamadas = apiFeliz({ estado: 'code_required' });
    const vista = await montarVista();
    await asentar();

    await vista.find('[data-prueba="campo-codigo"]').setValue('CODIGO-SECRETO-123');
    await vista.find('form').trigger('submit');
    await asentar();

    const acceso = llamadas.find((l) => l.metodo === 'POST' && l.url.endsWith('/access'));
    expect(acceso).toBeDefined();
    expect(acceso?.cuerpo).toEqual({ code: 'CODIGO-SECRETO-123' });

    // Lo que de verdad importa: el código no aparece en NINGUNA url.
    for (const llamada of llamadas) {
      expect(llamada.url).not.toContain('CODIGO-SECRETO-123');
    }
  });

  it('el POST de acceso lleva el testigo CSRF: es pública pero mutante', async () => {
    const llamadas = apiFeliz({ estado: 'code_required' });
    const vista = await montarVista();
    await asentar();

    await vista.find('[data-prueba="campo-codigo"]').setValue('abc');
    await vista.find('form').trigger('submit');
    await asentar();

    const acceso = llamadas.find((l) => l.metodo === 'POST' && l.url.endsWith('/access'));
    expect(acceso?.cabeceras['x-ceiba-csrf']).toBe(TESTIGO_CSRF);
  });

  it('sanea un secreto que llegue con valor relleno: el cliente no se fía', () => {
    const sucia = peticionDePrueba({
      headers: [
        {
          name: 'Authorization',
          // El servidor NUNCA manda esto. Si algún día lo hiciera, aquí se corta.
          value: 'Bearer token-filtrado',
          description: null,
          enabled: true,
          secret: true,
        },
      ],
    });

    const limpia = sanearPeticionCompartida(sucia);

    expect(limpia.headers[0]?.value).toBeNull();
    expect(limpia.headers[0]?.secret).toBe(true);
    expect(JSON.stringify(limpia)).not.toContain('token-filtrado');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Enlace abierto
// ───────────────────────────────────────────────────────────────────────────

describe('enlace sin código · entra solo', () => {
  it('abre la sesión sin pedir nada y enseña la colección', async () => {
    const llamadas = apiFeliz({ estado: 'open' });
    const vista = await montarVista();
    await asentar();

    expect(vista.text()).toContain('API de facturación');
    expect(vista.find('[data-prueba="campo-codigo"]').exists()).toBe(false);

    const rutasLlamadas = llamadas.map((l) => `${l.metodo} ${l.url}`);
    expect(rutasLlamadas).toContain(`GET /api/v1/share/${SLUG}`);
    expect(rutasLlamadas).toContain(`POST /api/v1/share/${SLUG}/access`);
    expect(rutasLlamadas).toContain('GET /api/v1/share/session/me');
    expect(rutasLlamadas).toContain('GET /api/v1/share/content/collection');
  });

  it('un enlace abierto se canjea con code: null, que es lo que acepta el esquema', async () => {
    const llamadas = apiFeliz({ estado: 'open' });
    await montarVista();
    await asentar();

    const acceso = llamadas.find((l) => l.metodo === 'POST');
    expect(acceso?.cuerpo).toEqual({ code: null });
  });

  it('lista las peticiones de la colección', async () => {
    apiFeliz({
      estado: 'open',
      coleccion: coleccionDePrueba({
        requestCount: 2,
        requests: [
          peticionDePrueba({ id: 'req-1', name: 'Listar clientes', method: 'GET' }),
          peticionDePrueba({ id: 'req-2', name: 'Crear factura', method: 'POST' }),
        ],
      }),
    });
    const vista = await montarVista();
    await asentar();

    expect(vista.text()).toContain('Listar clientes');
    expect(vista.text()).toContain('Crear factura');
    expect(vista.find('[data-prueba="peticion-req-2"]').exists()).toBe(true);
  });

  it('al pulsar una petición se abre su detalle', async () => {
    apiFeliz({
      estado: 'open',
      coleccion: coleccionDePrueba({
        requests: [
          peticionDePrueba({
            id: 'req-1',
            name: 'Listar clientes',
            url: 'https://api.ejemplo.com/clientes',
            headers: [
              {
                name: 'Accept',
                value: 'application/json',
                description: null,
                enabled: true,
                secret: false,
              },
            ],
          }),
        ],
      }),
    });
    const vista = await montarVista();
    await asentar();

    expect(vista.text()).toContain('Elige una petición');

    await vista.find('[data-prueba="peticion-req-1"]').trigger('click');
    await flushPromises();

    expect(vista.text()).not.toContain('Elige una petición');
    expect(vista.text()).toContain('https://api.ejemplo.com/clientes');
    expect(vista.text()).toContain('application/json');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. Enlace con código — y la indistinguibilidad (C-CODE-04)
// ───────────────────────────────────────────────────────────────────────────

describe('enlace con código', () => {
  it('pide el código y NO enseña la colección antes de tenerlo', async () => {
    apiFeliz({ estado: 'code_required' });
    const vista = await montarVista();
    await asentar();

    expect(vista.find('[data-prueba="campo-codigo"]').exists()).toBe(true);
    expect(vista.text()).not.toContain('API de facturación');
  });

  it('no publica el nombre de la colección: lo explica en vez de dejar un hueco', async () => {
    apiFeliz({ estado: 'code_required' });
    const vista = await montarVista();
    await asentar();

    expect(vista.text()).toContain('No se publica el nombre de la colección hasta que entras');
  });

  it('con el código correcto entra y enseña la colección', async () => {
    apiFeliz({ estado: 'code_required' });
    const vista = await montarVista();
    await asentar();

    await vista.find('[data-prueba="campo-codigo"]').setValue('bien');
    await vista.find('form').trigger('submit');
    await asentar();

    expect(vista.text()).toContain('API de facturación');
    expect(vista.find('[data-prueba="campo-codigo"]').exists()).toBe(false);
  });

  it('no gasta un intento del limitador con el campo vacío', async () => {
    const llamadas = apiFeliz({ estado: 'code_required' });
    const vista = await montarVista();
    await asentar();
    const antes = llamadas.filter((l) => l.metodo === 'POST').length;

    await vista.find('form').trigger('submit');
    await asentar();

    expect(llamadas.filter((l) => l.metodo === 'POST').length).toBe(antes);
  });

  /**
   * EL CASO ESTRELLA. `C-CODE-04`.
   *
   * El servidor responde lo mismo para las tres causas, así que la interfaz
   * tampoco puede diferenciarlas. Se comprueba comparando el texto renderizado
   * **entre sí**, no contra una cadena esperada: si alguien añadiese una rama
   * «este enlace ha caducado», los tres textos dejarían de ser iguales y el
   * caso se caería, aunque el mensaje nuevo fuese bonito.
   */
  it('C-CODE-04 · incorrecto, caducado y revocado producen EL MISMO texto', async () => {
    const textos: string[] = [];

    for (const causa of ['incorrecto', 'caducado', 'revocado']) {
      apiFeliz({ estado: 'code_required', accesoFalla: true });
      const vista = await montarVista();
      await asentar();

      await vista.find('[data-prueba="campo-codigo"]').setValue(`codigo-${causa}`);
      await vista.find('form').trigger('submit');
      await asentar();

      expect(vista.text()).toContain(MENSAJE_ACCESO_INVALIDO);
      textos.push(vista.text());
      vista.unmount();
    }

    expect(textos[0]).toBe(textos[1]);
    expect(textos[1]).toBe(textos[2]);
  });

  it('tras fallar sigue pidiendo el código, no manda al 404 ni al login', async () => {
    apiFeliz({ estado: 'code_required', accesoFalla: true });
    const vista = await montarVista();
    await asentar();

    await vista.find('[data-prueba="campo-codigo"]').setValue('mal');
    await vista.find('form').trigger('submit');
    await asentar();

    expect(vista.find('[data-prueba="campo-codigo"]').exists()).toBe(true);
  });

  it('un enlace «abierto» que el servidor rechaza cae en el MISMO mensaje único', async () => {
    apiFeliz({ estado: 'open', accesoFalla: true });
    const vista = await montarVista();
    await asentar();

    expect(vista.text()).toContain(MENSAJE_ACCESO_INVALIDO);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Secretos — la regla que no se negocia
// ───────────────────────────────────────────────────────────────────────────

describe('frontera de secretos', () => {
  it('una cabecera secreta se pinta con su marca y SIN valor', () => {
    const vista = mount(ValoresCompartidos, {
      props: {
        titulo: 'Cabeceras',
        valores: [
          {
            name: 'Authorization',
            value: null,
            description: null,
            enabled: true,
            secret: true,
          },
        ],
      },
    });

    expect(vista.text()).toContain('Authorization');
    expect(vista.find('[data-prueba="marca-secreta"]').exists()).toBe(true);
  });

  it('AUNQUE llegue con el valor relleno, el valor no aparece en el DOM', () => {
    const vista = mount(ValoresCompartidos, {
      props: {
        titulo: 'Cabeceras',
        valores: [
          {
            name: 'Authorization',
            // El servidor no manda esto. La interfaz no se fía de que siga así.
            value: 'Bearer SUPERSECRETO',
            description: null,
            enabled: true,
            secret: true,
          },
        ],
      },
    });

    expect(vista.html()).not.toContain('SUPERSECRETO');
    expect(vista.find('[data-prueba="marca-secreta"]').exists()).toBe(true);
  });

  it('un valor NO secreto sí se pinta: la marca no se reparte a todos', () => {
    const vista = mount(ValoresCompartidos, {
      props: {
        titulo: 'Cabeceras',
        valores: [
          {
            name: 'Accept',
            value: 'application/json',
            description: null,
            enabled: true,
            secret: false,
          },
        ],
      },
    });

    expect(vista.text()).toContain('application/json');
    expect(vista.find('[data-prueba="marca-secreta"]').exists()).toBe(false);
  });

  it('end-to-end: un secreto de la API no llega a la pantalla', async () => {
    apiFeliz({
      estado: 'open',
      coleccion: coleccionDePrueba({
        requests: [
          peticionDePrueba({
            id: 'req-1',
            headers: [
              {
                name: 'Authorization',
                value: 'Bearer FUGA',
                description: null,
                enabled: true,
                secret: true,
              },
            ],
          }),
        ],
      }),
    });
    const vista = await montarVista();
    await asentar();
    await vista.find('[data-prueba="peticion-req-1"]').trigger('click');
    await flushPromises();

    expect(vista.text()).toContain('Authorization');
    expect(vista.html()).not.toContain('FUGA');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6. Es una vista de LECTURA
// ───────────────────────────────────────────────────────────────────────────

describe('vista de solo lectura', () => {
  it('no ofrece guardar, editar ni ejecutar', async () => {
    apiFeliz({ estado: 'open', canExecute: false });
    const vista = await montarVista();
    await asentar();
    await vista.find('[data-prueba="peticion-req-1"]').trigger('click');
    await flushPromises();

    const texto = vista.text().toLowerCase();
    expect(texto).not.toContain('guardar');
    expect(texto).not.toContain('editar');
    expect(vista.findAll('input, textarea, select')).toHaveLength(0);
  });

  it('el botón de exportar sólo aparece si el enlace lo permite', async () => {
    apiFeliz({ estado: 'open', canExport: false });
    const sinExportar = await montarVista();
    await asentar();
    expect(sinExportar.text()).not.toContain('Exportar');
    sinExportar.unmount();

    apiFeliz({ estado: 'open', canExport: true });
    const conExportar = await montarVista();
    await asentar();
    expect(conExportar.text()).toContain('Exportar');
  });

  it('lee canExport, no el inexistente allowExport', async () => {
    // Si la vista mirase `allowExport`, este caso —que manda los DOS, con
    // `allowExport: false`— seguiría enseñando el botón. Es la corrección de
    // nombre que detecté al verificar el contrato.
    instalarApi((llamada) => {
      if (llamada.url === `/api/v1/share/${SLUG}`) return { estado: 200, cuerpo: { estado: 'open' } };
      if (llamada.metodo === 'POST' && llamada.url.endsWith('/access')) {
        return { estado: 200, cuerpo: { permission: 'viewer_export', expiresAt: '2026-11-01T10:00:00.000Z', collectionName: null } };
      }
      if (llamada.url === '/api/v1/share/session/me') {
        return {
          estado: 200,
          cuerpo: {
            permission: 'viewer_export',
            expiresAt: '2026-11-01T10:00:00.000Z',
            canExport: true,
            canExecute: false,
            allowExport: false,
          },
        };
      }
      if (llamada.url === '/api/v1/share/content/collection') {
        return { estado: 200, cuerpo: { collection: coleccionDePrueba() } };
      }
      return { estado: 404, cuerpo: { error: 'x', mensaje: 'x' } };
    });

    const vista = await montarVista();
    await asentar();
    expect(vista.text()).toContain('Exportar');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 7. Estados: carga, vacío, error, salir
// ───────────────────────────────────────────────────────────────────────────

describe('estados de la pantalla', () => {
  it('mientras comprueba el enlace enseña la marca girando, no un texto suelto', async () => {
    apiFeliz({ estado: 'open' });
    const vista = await montarVista();

    // SIN asentar: `onMounted` ya lanzó `GET /share/:slug` y nada ha resuelto
    // todavía, así que esto comprueba el estado de carga de verdad, no uno
    // simulado. El estándar visual (§2.2.3) exige la marca girando, no un
    // «Cargando…» suelto.
    expect(vista.html()).toContain('ceiba-spinner');
    expect(vista.text()).toContain('Abriendo el enlace compartido…');

    // Y la espera TERMINA: un indicador que no se va es un fallo distinto.
    await asentar();
    expect(vista.html()).not.toContain('ceiba-spinner');
    expect(vista.text()).toContain('API de facturación');
  });

  it('una colección sin peticiones tiene su estado vacío, no una lista en blanco', async () => {
    apiFeliz({
      estado: 'open',
      coleccion: coleccionDePrueba({ requestCount: 0, requests: [] }),
    });
    const vista = await montarVista();
    await asentar();

    expect(vista.text()).toContain('todavía no tiene peticiones');
  });

  it('un fallo TÉCNICO no se confunde con un código incorrecto', async () => {
    instalarApi((llamada) => {
      if (llamada.url === `/api/v1/share/${SLUG}`) {
        return { estado: 500, cuerpo: { error: 'error_interno', mensaje: 'Algo se rompió.' } };
      }
      return { estado: 404, cuerpo: { error: 'x', mensaje: 'x' } };
    });
    const vista = await montarVista();
    await asentar();

    expect(vista.text()).toContain('No se ha podido abrir el enlace');
    // Y sobre todo: NO dice que el enlace o el código sean inválidos.
    expect(vista.text()).not.toContain(MENSAJE_ACCESO_INVALIDO);
  });

  it('un slug vacío se dice con todas sus letras', async () => {
    instalarApi(() => ({ estado: 200, cuerpo: { estado: 'open' } }));
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/s/:slug?', name: 'x', component: VistaDeComparticionPublica },
      ],
    });
    await router.push('/s/');
    await router.isReady();
    const vista = mount(VistaDeComparticionPublica, {
      global: { plugins: [router, createPinia()] },
    });
    await asentar();

    expect(vista.text()).toContain('Enlace incompleto');
  });

  it('salir llama al logout del servidor y deja de enseñar la colección', async () => {
    const llamadas = apiFeliz({ estado: 'open' });
    const vista = await montarVista();
    await asentar();
    expect(vista.text()).toContain('API de facturación');

    const salir = vista.findAll('button').find((b) => b.text().includes('Salir'));
    expect(salir).toBeDefined();
    await salir?.trigger('click');
    await asentar();

    expect(llamadas.map((l) => `${l.metodo} ${l.url}`)).toContain(
      'POST /api/v1/share/session/logout',
    );
    expect(vista.text()).not.toContain('API de facturación');
    expect(vista.text()).toContain('Has salido');
  });

  it('tras salir se puede volver a entrar con el mismo enlace', async () => {
    apiFeliz({ estado: 'open' });
    const vista = await montarVista();
    await asentar();

    const salir = vista.findAll('button').find((b) => b.text().includes('Salir'));
    await salir?.trigger('click');
    await asentar();

    const volver = vista.findAll('button').find((b) => b.text().includes('Volver a entrar'));
    expect(volver).toBeDefined();
    await volver?.trigger('click');
    await asentar();

    expect(vista.text()).toContain('API de facturación');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 8. Agrupación por carpetas
// ───────────────────────────────────────────────────────────────────────────

describe('lista de peticiones', () => {
  it('agrupa por carpeta y pinta la ruta completa de la carpeta', () => {
    const vista = mount(ListaDePeticionesCompartidas, {
      props: {
        peticiones: [peticionDePrueba({ id: 'req-1', folderId: 'f-hija' })],
        carpetas: [
          {
            id: 'f-padre',
            parentFolderId: null,
            name: 'Cobros',
            description: null,
            depth: 0,
          },
          {
            id: 'f-hija',
            parentFolderId: 'f-padre',
            name: 'Tarjetas',
            description: null,
            depth: 1,
          },
        ],
        seleccionada: null,
      },
    });

    expect(vista.text()).toContain('Cobros / Tarjetas');
  });

  it('un ciclo de carpetas no cuelga la interfaz del visitante', () => {
    const vista = mount(ListaDePeticionesCompartidas, {
      props: {
        peticiones: [peticionDePrueba({ id: 'req-1', folderId: 'a' })],
        carpetas: [
          { id: 'a', parentFolderId: 'b', name: 'A', description: null, depth: 0 },
          { id: 'b', parentFolderId: 'a', name: 'B', description: null, depth: 0 },
        ],
        seleccionada: null,
      },
    });

    expect(vista.text()).toContain('Listar clientes');
  });

  it('marca la seleccionada con aria-selected, no sólo con color', () => {
    const vista = mount(ListaDePeticionesCompartidas, {
      props: {
        peticiones: [
          peticionDePrueba({ id: 'req-1' }),
          peticionDePrueba({ id: 'req-2', name: 'Otra' }),
        ],
        seleccionada: 'req-2',
      },
    });

    const opciones = vista.findAll('[role="option"]');
    expect(opciones).toHaveLength(2);
    expect(opciones[0]?.attributes('aria-selected')).toBe('false');
    expect(opciones[1]?.attributes('aria-selected')).toBe('true');
  });

  it('avisa al padre con un oyente real (no con emitted(), que aquí no recoge emits)', async () => {
    const recibidos: string[] = [];
    const vista = mount(ListaDePeticionesCompartidas, {
      props: {
        peticiones: [peticionDePrueba({ id: 'req-9' })],
        seleccionada: null,
        onSeleccionar: (id: string) => recibidos.push(id),
      },
    });

    await vista.find('[data-prueba="peticion-req-9"]').trigger('click');

    expect(recibidos).toEqual(['req-9']);
  });
});
