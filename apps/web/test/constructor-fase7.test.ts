import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { defineComponent, h, ref } from 'vue';
import { RouterLinkStub, flushPromises, mount } from '@vue/test-utils';
import { usarFetch, type FuncionFetch } from '@/api/cliente';
import { usarAlmacenDeConstructor } from '@/stores/constructor';
import { usarAutoguardado, RETARDO_DE_AUTOGUARDADO_MS } from '@/composables/usarAutoguardado';
import TituloEditable from '@/components/peticiones/TituloEditable.vue';
import VistaDeConstructor from '@/views/VistaDeConstructor.vue';
import { errorDeNombreDePeticion } from '@/api/peticiones';

/**
 * FASE 7 · ÁMBITO C — P1 (autoguardado), P2 (renombrar dentro) y el botón de
 * cURL dentro del constructor (§1.1 causa 2).
 *
 * LO QUE ESTAS PRUEBAS VIGILAN DE VERDAD, por orden de importancia:
 *
 *  1. **Que no se autoguarde lo que no existe.** El §3.C.1 lo pone como
 *     requisito duro: crear una petición lo decide el usuario, no un
 *     temporizador. Un rebote que crea filas solo es un fallo de datos, no de
 *     interfaz.
 *  2. **Que un rechazo del servidor NO borre lo que el usuario escribió.** Es
 *     la otra mitad del mismo requisito, y la que de verdad duele cuando
 *     falla.
 *  3. **Que el cURL se pida DESPUÉS de guardar.** Es la causa 1 del §1.1: el
 *     servidor genera el comando desde la fila guardada, así que pedirlo
 *     antes de guardar exporta la versión vieja — exactamente la queja del
 *     cliente («el cURL no copia el body»).
 *
 * Nada toca la red: `usarFetch` recibe un doble, igual que en
 * `peticiones.test.ts`. El reloj tampoco: el rebote recibe su `programar` y
 * su `cancelarProgramado` inyectados, así que no hay esperas reales ni
 * dependencia del reloj de la máquina.
 *
 * AVISO MEDIDO EN ESTE ENTORNO (Vue 3.5.44 + @vue/test-utils 2.5.1 + Vitest 5):
 * `wrapper.emitted()` **no recoge los `emit` de un componente**, sólo eventos
 * del DOM que burbujean. Por eso los componentes se observan con props-oyente
 * (`onRenombrar`, …) y no con `emitted()`. Quien lo «arregle» al revés verá
 * falsos negativos.
 */

const TESTIGO_CSRF = 'nonce.firma';

interface LlamadaRegistrada {
  readonly url: string;
  readonly metodo: string;
  readonly cuerpo: unknown;
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
    const crudo = iniciales?.body;
    const llamada: LlamadaRegistrada = {
      url: String(entrada),
      metodo: (iniciales?.method ?? 'GET').toUpperCase(),
      cuerpo: typeof crudo === 'string' ? JSON.parse(crudo) : undefined,
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

/** Petición guardada mínima, en la forma que devuelve la API. */
function peticionCruda(parcial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'req-1',
    collectionId: 'col-1',
    name: 'Listar clientes',
    method: 'GET',
    url: '{{base_url}}/v1/clientes',
    headers: [],
    queryParams: [],
    bodyType: 'none',
    body: null,
    lockVersion: 3,
    ...parcial,
  };
}

/**
 * Reloj de rebote manual. En vez de `vi.useFakeTimers()` —que afecta a todo el
 * entorno y a las promesas— se inyecta el programador del propio composable:
 * la prueba decide exactamente cuándo vence el rebote.
 */
function relojManual() {
  const pendientes = new Map<number, () => void>();
  let siguiente = 0;
  return {
    programar: (fn: () => void): number => {
      siguiente += 1;
      pendientes.set(siguiente, fn);
      return siguiente;
    },
    cancelarProgramado: (id: unknown): void => {
      pendientes.delete(id as number);
    },
    get programados(): number {
      return pendientes.size;
    },
    /** Vence todos los rebotes pendientes. */
    vencer(): void {
      const tareas = [...pendientes.values()];
      pendientes.clear();
      for (const tarea of tareas) tarea();
    },
  };
}

/** Monta el composable dentro de un componente: usa `onMounted`/`onBeforeUnmount`. */
function montarAutoguardado(opciones: {
  huella: () => string;
  activo: () => boolean;
  guardar: () => Promise<unknown>;
  reloj: ReturnType<typeof relojManual>;
}) {
  let api: ReturnType<typeof usarAutoguardado> | null = null;
  const anfitrion = mount(
    defineComponent({
      setup() {
        api = usarAutoguardado({
          huella: opciones.huella,
          activo: opciones.activo,
          guardar: opciones.guardar,
          programar: opciones.reloj.programar,
          cancelarProgramado: opciones.reloj.cancelarProgramado,
        });
        return () => h('div');
      },
    }),
  );
  if (api === null) throw new Error('El composable no se inicializó.');
  return { anfitrion, api: api as ReturnType<typeof usarAutoguardado> };
}

let pinia: Pinia;

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
});

// ---------------------------------------------------------------------------
// P1 · El rebote
// ---------------------------------------------------------------------------

describe('P1 · rebote del autoguardado', () => {
  it('el retardo por defecto es el que fija el brief (~800 ms)', () => {
    expect(RETARDO_DE_AUTOGUARDADO_MS).toBe(800);
  });

  it('agrupa varias pulsaciones seguidas en UN solo guardado', async () => {
    const reloj = relojManual();
    const texto = ref('a');
    let guardados = 0;

    const { anfitrion } = montarAutoguardado({
      huella: () => texto.value,
      activo: () => true,
      guardar: async () => {
        guardados += 1;
      },
      reloj,
    });

    texto.value = 'ab';
    await anfitrion.vm.$nextTick();
    texto.value = 'abc';
    await anfitrion.vm.$nextTick();
    texto.value = 'abcd';
    await anfitrion.vm.$nextTick();

    // Nada todavía: el rebote no ha vencido.
    expect(guardados).toBe(0);
    // Y sólo hay UN temporizador vivo: cada tecla cancela el anterior.
    expect(reloj.programados).toBe(1);

    reloj.vencer();
    await flushPromises();
    expect(guardados).toBe(1);

    anfitrion.unmount();
  });

  it('NO autoguarda cuando no hay petición abierta: crear lo decide el usuario', async () => {
    const reloj = relojManual();
    const texto = ref('a');
    let guardados = 0;

    const { anfitrion, api } = montarAutoguardado({
      huella: () => texto.value,
      activo: () => false,
      guardar: async () => {
        guardados += 1;
      },
      reloj,
    });

    texto.value = 'cambiado';
    await anfitrion.vm.$nextTick();

    expect(reloj.programados).toBe(0);
    reloj.vencer();
    await flushPromises();
    expect(guardados).toBe(0);

    // Ni siquiera el guardado inmediato dispara nada.
    await api.guardarYa();
    expect(guardados).toBe(0);

    anfitrion.unmount();
  });

  it('el blur guarda sin esperar al rebote', async () => {
    const reloj = relojManual();
    const texto = ref('a');
    let guardados = 0;

    const { anfitrion, api } = montarAutoguardado({
      huella: () => texto.value,
      activo: () => true,
      guardar: async () => {
        guardados += 1;
      },
      reloj,
    });

    texto.value = 'b';
    await anfitrion.vm.$nextTick();
    api.alPerderFoco();
    await flushPromises();

    expect(guardados).toBe(1);
    // El temporizador se cancela: no se guarda dos veces por lo mismo.
    expect(reloj.programados).toBe(0);
    reloj.vencer();
    await flushPromises();
    expect(guardados).toBe(1);

    anfitrion.unmount();
  });

  it('salir de la vista con un cambio a medias lo guarda', async () => {
    const reloj = relojManual();
    const texto = ref('a');
    let guardados = 0;

    const { anfitrion } = montarAutoguardado({
      huella: () => texto.value,
      activo: () => true,
      guardar: async () => {
        guardados += 1;
      },
      reloj,
    });

    texto.value = 'b';
    await anfitrion.vm.$nextTick();
    expect(guardados).toBe(0);

    anfitrion.unmount();
    await flushPromises();
    expect(guardados).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// P1 · La escritura y sus fallos
// ---------------------------------------------------------------------------

describe('P1 · guardado contra la API', () => {
  function abrir(almacen: ReturnType<typeof usarAlmacenDeConstructor>): void {
    almacen.cargarDesdePeticionGuardada({
      requestId: 'req-1',
      collectionId: 'col-1',
      name: 'Listar clientes',
      method: 'GET',
      url: '{{base_url}}/v1/clientes',
      lockVersion: 3,
    });
  }

  it('manda el PATCH con el vocabulario del contrato y pasa a «Guardado»', async () => {
    const llamadas = instalarApi(() => ({
      estado: 200,
      cuerpo: { peticion: peticionCruda({ lockVersion: 4 }) },
    }));

    const almacen = usarAlmacenDeConstructor();
    abrir(almacen);
    expect(almacen.estadoDeGuardado).toBe('guardado');

    almacen.url = '{{base_url}}/v1/clientes?activo=1';
    almacen.anadirCabecera('Accept', 'application/json');
    expect(almacen.hayCambiosSinGuardar).toBe(true);

    await almacen.guardarAhora();

    const patch = llamadas.find((l) => l.metodo === 'PATCH');
    expect(patch?.url).toBe('/api/v1/requests/req-1');
    expect(patch?.cuerpo).toMatchObject({
      name: 'Listar clientes',
      method: 'GET',
      url: '{{base_url}}/v1/clientes?activo=1',
      headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
      bodyType: 'none',
      body: null,
      // Viaja aunque el servidor todavía no lo mire: ver el informe.
      lockVersion: 3,
    });
    expect(almacen.estadoDeGuardado).toBe('guardado');
    expect(almacen.lockVersion).toBe(4);
    expect(almacen.hayCambiosSinGuardar).toBe(false);
  });

  it('un rechazo del servidor NO descarta lo que el usuario escribió', async () => {
    instalarApi(() => ({
      estado: 500,
      cuerpo: { error: 'inesperado', mensaje: 'Algo se rompió en el servidor.' },
    }));

    const almacen = usarAlmacenDeConstructor();
    abrir(almacen);
    almacen.url = 'https://api.ejemplo.com/v1/muy-importante';
    almacen.establecerModoDeCuerpo('json');
    almacen.establecerContenidoDelCuerpo('{"importante":true}');

    const ok = await almacen.guardarAhora();

    expect(ok).toBe(false);
    expect(almacen.estadoDeGuardado).toBe('error');
    expect(almacen.errorDeGuardado).toContain('Algo se rompió');
    // LO ESCRITO SIGUE AHÍ. Esto es el corazón del requisito.
    expect(almacen.url).toBe('https://api.ejemplo.com/v1/muy-importante');
    expect(almacen.cuerpo.contenido).toBe('{"importante":true}');
  });

  it('no pisa cambios ajenos en silencio: un salto de lock_version avisa', async () => {
    // El servidor devuelve 9 cuando esperábamos 4: alguien escribió en medio.
    instalarApi(() => ({ estado: 200, cuerpo: { peticion: peticionCruda({ lockVersion: 9 }) } }));

    const almacen = usarAlmacenDeConstructor();
    abrir(almacen);
    almacen.url = 'https://api.ejemplo.com/v1/otra';

    await almacen.guardarAhora();

    expect(almacen.estadoDeGuardado).toBe('conflicto');
    expect(almacen.errorDeGuardado).toContain('Alguien más modificó');
    expect(almacen.url).toBe('https://api.ejemplo.com/v1/otra');
  });

  it('un 409 del servidor se trata como conflicto y conserva el borrador', async () => {
    instalarApi(() => ({
      estado: 409,
      cuerpo: { error: 'conflicto', mensaje: 'La petición cambió.' },
    }));

    const almacen = usarAlmacenDeConstructor();
    abrir(almacen);
    almacen.url = 'https://api.ejemplo.com/v1/mia';

    const ok = await almacen.guardarAhora();

    expect(ok).toBe(false);
    expect(almacen.estadoDeGuardado).toBe('conflicto');
    expect(almacen.url).toBe('https://api.ejemplo.com/v1/mia');
  });

  it('sin petición abierta, guardar no llama a nadie', async () => {
    const llamadas = instalarApi(() => ({ estado: 200, cuerpo: {} }));
    const almacen = usarAlmacenDeConstructor();

    almacen.url = 'https://api.ejemplo.com/v1/suelta';
    const ok = await almacen.guardarAhora();

    expect(ok).toBe(false);
    expect(llamadas).toHaveLength(0);
    expect(almacen.estadoDeGuardado).toBe('inactivo');
  });

  it('un nombre vacío no se guarda, y lo dice', async () => {
    const llamadas = instalarApi(() => ({ estado: 200, cuerpo: { peticion: peticionCruda() } }));
    const almacen = usarAlmacenDeConstructor();
    abrir(almacen);

    almacen.nombre = '   ';
    const ok = await almacen.guardarAhora();

    expect(ok).toBe(false);
    expect(llamadas.filter((l) => l.metodo === 'PATCH')).toHaveLength(0);
    expect(almacen.estadoDeGuardado).toBe('error');
    expect(almacen.errorDeGuardado).toContain('obligatorio');
  });

  it('cambiar de adaptador o recibir una respuesta NO cuenta como editar', () => {
    const almacen = usarAlmacenDeConstructor();
    abrir(almacen);
    const antes = almacen.huellaDelBorrador;

    almacen.usarAdaptador('navegador');
    almacen.limpiarResultado();

    expect(almacen.huellaDelBorrador).toBe(antes);
    expect(almacen.hayCambiosSinGuardar).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P2 · Renombrar dentro de la petición
// ---------------------------------------------------------------------------

describe('P2 · renombrar dentro del constructor', () => {
  it('Enter confirma el nombre nuevo', async () => {
    const recibidos: string[] = [];
    const titulo = mount(TituloEditable, {
      props: {
        nombre: 'Listar clientes',
        validar: errorDeNombreDePeticion,
        onRenombrar: (n: string) => recibidos.push(n),
      },
    });

    await titulo.get('[data-prueba="renombrar-en-constructor"]').trigger('click');
    const campo = titulo.get('[data-prueba="campo-de-nombre"]');
    await campo.setValue('Alta de cliente');
    await campo.trigger('keydown', { key: 'Enter' });

    expect(recibidos).toEqual(['Alta de cliente']);
    titulo.unmount();
  });

  it('Esc cancela y deja el nombre anterior', async () => {
    const recibidos: string[] = [];
    const titulo = mount(TituloEditable, {
      props: {
        nombre: 'Listar clientes',
        validar: errorDeNombreDePeticion,
        onRenombrar: (n: string) => recibidos.push(n),
      },
    });

    await titulo.get('[data-prueba="renombrar-en-constructor"]').trigger('click');
    const campo = titulo.get('[data-prueba="campo-de-nombre"]');
    await campo.setValue('Algo que no quiero');
    await campo.trigger('keydown', { key: 'Escape' });

    expect(recibidos).toEqual([]);
    expect(titulo.text()).toContain('Listar clientes');
    titulo.unmount();
  });

  it('un nombre vacío no se guarda: se rechaza y el campo sigue abierto', async () => {
    const recibidos: string[] = [];
    const titulo = mount(TituloEditable, {
      props: {
        nombre: 'Listar clientes',
        validar: errorDeNombreDePeticion,
        onRenombrar: (n: string) => recibidos.push(n),
      },
    });

    await titulo.get('[data-prueba="renombrar-en-constructor"]').trigger('click');
    const campo = titulo.get('[data-prueba="campo-de-nombre"]');
    await campo.setValue('   ');
    await campo.trigger('keydown', { key: 'Enter' });

    expect(recibidos).toEqual([]);
    expect(titulo.text()).toContain('El nombre es obligatorio');
    // Sigue en edición: lo escrito no se descarta a espaldas del usuario.
    expect(titulo.find('[data-prueba="campo-de-nombre"]').exists()).toBe(true);
    titulo.unmount();
  });

  it('sin petición abierta el título no ofrece renombrar', () => {
    const titulo = mount(TituloEditable, { props: { nombre: '', editable: false } });
    expect(titulo.find('[data-prueba="renombrar-en-constructor"]').exists()).toBe(false);
    expect(titulo.text()).toContain('Constructor de solicitudes');
    titulo.unmount();
  });

  it('el almacén rechaza el nombre vacío y conserva el anterior', () => {
    const almacen = usarAlmacenDeConstructor();
    almacen.cargarDesdePeticionGuardada({
      requestId: 'req-1',
      collectionId: 'col-1',
      name: 'Listar clientes',
      method: 'GET',
      url: 'https://api.ejemplo.com',
    });

    expect(almacen.renombrar('  ')).toContain('obligatorio');
    expect(almacen.nombre).toBe('Listar clientes');
    expect(almacen.renombrar('Alta de cliente')).toBeNull();
    expect(almacen.nombre).toBe('Alta de cliente');
  });
});

// ---------------------------------------------------------------------------
// §1.1 causa 2 · «Copiar como cURL» dentro del constructor
// ---------------------------------------------------------------------------

describe('§1.1 causa 2 · cURL dentro del constructor', () => {
  it('el constructor ofrece el botón y GUARDA antes de pedir el comando', async () => {
    const llamadas = instalarApi((llamada) => {
      if (llamada.url === '/api/v1/collections/col-1') {
        return {
          estado: 200,
          cuerpo: { coleccion: { id: 'col-1', workspaceId: 'ws-1', name: 'API', slug: 'api' } },
        };
      }
      if (llamada.url === '/api/v1/requests/req-1/curl') {
        return {
          estado: 200,
          cuerpo: { curl: "curl --request GET --url 'https://api.ejemplo.com'", advertencias: [] },
        };
      }
      return { estado: 200, cuerpo: { peticion: peticionCruda({ lockVersion: 4 }) } };
    });

    const vista = mount(VistaDeConstructor, {
      props: { peticionId: 'req-1', coleccionId: 'col-1' },
      global: { plugins: [pinia], components: { RouterLink: RouterLinkStub } },
    });
    await flushPromises();

    const almacen = usarAlmacenDeConstructor();
    almacen.establecerModoDeCuerpo('json');
    almacen.establecerContenidoDelCuerpo('{"a":1}');
    await vista.vm.$nextTick();

    const boton = vista.get('[data-prueba="curl-en-constructor"]');
    await boton.trigger('click');
    await flushPromises();

    const indicePatch = llamadas.findIndex((l) => l.metodo === 'PATCH');
    const indiceCurl = llamadas.findIndex((l) => l.url === '/api/v1/requests/req-1/curl');

    expect(indicePatch).toBeGreaterThanOrEqual(0);
    expect(indiceCurl).toBeGreaterThanOrEqual(0);
    // EL ORDEN ES EL ENTREGABLE: guardar y DESPUÉS pedir. Al revés se
    // exportaría la versión vieja, que es la queja del cliente.
    expect(indicePatch).toBeLessThan(indiceCurl);
    // Y lo que se guardó lleva el cuerpo que el usuario está viendo.
    expect(llamadas[indicePatch]?.cuerpo).toMatchObject({
      bodyType: 'raw_json',
      body: '{"a":1}',
    });

    vista.unmount();
  });

  it('si el guardado falla, NO se exporta un cURL que mentiría', async () => {
    const llamadas = instalarApi((llamada) => {
      if (llamada.url === '/api/v1/collections/col-1') {
        return { estado: 200, cuerpo: { coleccion: { id: 'col-1', workspaceId: 'ws-1' } } };
      }
      if (llamada.metodo === 'PATCH') {
        return { estado: 500, cuerpo: { error: 'inesperado', mensaje: 'No se pudo.' } };
      }
      return { estado: 200, cuerpo: { peticion: peticionCruda() } };
    });

    const vista = mount(VistaDeConstructor, {
      props: { peticionId: 'req-1', coleccionId: 'col-1' },
      global: { plugins: [pinia], components: { RouterLink: RouterLinkStub } },
    });
    await flushPromises();

    const almacen = usarAlmacenDeConstructor();
    almacen.url = 'https://api.ejemplo.com/v1/nueva';
    await vista.vm.$nextTick();

    await vista.get('[data-prueba="curl-en-constructor"]').trigger('click');
    await flushPromises();

    expect(llamadas.some((l) => l.url.endsWith('/curl'))).toBe(false);
    expect(almacen.estadoDeGuardado).toBe('error');

    vista.unmount();
  });

  it('el indicador de guardado es visible y se anuncia', async () => {
    instalarApi((llamada) =>
      llamada.url === '/api/v1/collections/col-1'
        ? { estado: 200, cuerpo: { coleccion: { id: 'col-1', workspaceId: 'ws-1' } } }
        : { estado: 200, cuerpo: { peticion: peticionCruda() } },
    );

    const vista = mount(VistaDeConstructor, {
      props: { peticionId: 'req-1', coleccionId: 'col-1' },
      global: { plugins: [pinia], components: { RouterLink: RouterLinkStub } },
    });
    await flushPromises();

    const indicador = vista.get('[data-prueba="estado-de-guardado"]');
    expect(indicador.attributes('role')).toBe('status');
    expect(indicador.attributes('aria-live')).toBe('polite');
    expect(indicador.text()).toContain('Guardado');

    vista.unmount();
  });
});
