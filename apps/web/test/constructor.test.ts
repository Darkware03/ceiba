import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import VistaDeConstructor from '../src/views/VistaDeConstructor.vue';
import {
  construirUrl,
  ejecutar,
  esCabeceraProhibidaPorElNavegador,
  familiaDeEstado,
  formatearDuracion,
  formatearTamano,
  tamanoEnBytes,
  textoDeEstado,
} from '../src/api/ejecucion';
import { usarFetch } from '../src/api/cliente';
import type { Par, SolicitudPreparada } from '../src/api/ejecucion';
import { MAXIMO_DE_HISTORIAL, usarAlmacenDeConstructor } from '../src/stores/constructor';
import {
  formatearJson,
  lenguajeDesdeContenido,
  lenguajeDesdeTipoDeContenido,
} from '../src/composables/useEditorDeCodigo';

/**
 * Pruebas del constructor: composición de la URL, adaptador de ejecución y
 * almacén. Nada toca la red: `ejecutar()` recibe un doble de `fetch`.
 */

function par(nombre: string, valor: string, activo = true): Par {
  return { id: `${nombre}-${valor}`, nombre, valor, activo };
}

function solicitud(parcial: Partial<SolicitudPreparada> = {}): SolicitudPreparada {
  return {
    metodo: 'GET',
    url: 'https://api.ejemplo.com/v1/cosas',
    cabeceras: [],
    parametros: [],
    cuerpo: { modo: 'none', contenido: '', tipoContenido: null },
    ...parcial,
  };
}

/** Reloj determinista: una lista de marcas en vez del reloj de la máquina. */
function reloj(marcas: readonly number[]): () => number {
  const pendientes = [...marcas];
  return () => pendientes.shift() ?? 0;
}

interface LlamadaRegistrada {
  url: string;
  init: RequestInit;
}

function fetchQueDevuelve(
  respuesta: () => Response,
  registro: LlamadaRegistrada[],
): typeof globalThis.fetch {
  const doble = async (entrada: unknown, init?: RequestInit): Promise<Response> => {
    registro.push({ url: String(entrada), init: init ?? {} });
    return respuesta();
  };
  return doble as unknown as typeof globalThis.fetch;
}

function fetchQueFalla(error: Error): typeof globalThis.fetch {
  const doble = async (): Promise<Response> => {
    throw error;
  };
  return doble as unknown as typeof globalThis.fetch;
}

describe('construirUrl', () => {
  it('devuelve la URL intacta cuando no hay parámetros activos', () => {
    expect(construirUrl('https://a.ejemplo.com/b')).toBe('https://a.ejemplo.com/b');
    expect(construirUrl('https://a.ejemplo.com/b?ya=1')).toBe('https://a.ejemplo.com/b?ya=1');
    expect(construirUrl('  https://a.ejemplo.com/b  ')).toBe('https://a.ejemplo.com/b');
  });

  it('añade la consulta cuando la URL no la tiene', () => {
    expect(construirUrl('https://a.ejemplo.com/b', [par('x', '1'), par('y', '2')])).toBe(
      'https://a.ejemplo.com/b?x=1&y=2',
    );
  });

  it('conserva la consulta que ya venía escrita en la URL', () => {
    expect(construirUrl('https://a.ejemplo.com/b?ya=1', [par('x', '2')])).toBe(
      'https://a.ejemplo.com/b?ya=1&x=2',
    );
  });

  it('no duplica un parámetro que ya estaba en la URL: lo sustituye', () => {
    expect(construirUrl('https://a.ejemplo.com/b?a=1&z=9', [par('a', '7')])).toBe(
      'https://a.ejemplo.com/b?a=7&z=9',
    );
  });

  it('sí manda dos veces el mismo nombre si el usuario pone dos filas', () => {
    expect(construirUrl('https://a.ejemplo.com/b', [par('a', '1'), par('a', '2')])).toBe(
      'https://a.ejemplo.com/b?a=1&a=2',
    );
  });

  it('ignora los pares desactivados y los que no tienen nombre', () => {
    const pares = [par('x', '1'), par('oculto', '2', false), par('   ', '3'), par('', '4')];
    expect(construirUrl('https://a.ejemplo.com/b', pares)).toBe('https://a.ejemplo.com/b?x=1');
  });

  it('escapa los valores y respeta el fragmento', () => {
    expect(construirUrl('https://a.ejemplo.com/b#seccion', [par('q', 'hola mundo')])).toBe(
      'https://a.ejemplo.com/b?q=hola+mundo#seccion',
    );
    expect(construirUrl('https://a.ejemplo.com/b', [par('q', 'a&b=c')])).toBe(
      'https://a.ejemplo.com/b?q=a%26b%3Dc',
    );
  });
});

describe('ejecutar (adaptador directo del navegador)', () => {
  it('ejecuta un 200 y NO manda credenciales', async () => {
    const registro: LlamadaRegistrada[] = [];
    const cuerpo = '{"ok":true}';
    const fetchDoble = fetchQueDevuelve(
      () =>
        new Response(cuerpo, {
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
        }),
      registro,
    );

    const resultado = await ejecutar(
      solicitud({
        metodo: 'GET',
        parametros: [par('page', '2')],
        cabeceras: [par('accept', 'application/json'), par('x-apagada', 'no', false)],
      }),
      { fetchImpl: fetchDoble, ahora: reloj([0, 5, 12]), idDeEjecucion: 'ej-1' },
    );

    // Lo que se pidió.
    expect(registro).toHaveLength(1);
    expect(registro[0]?.url).toBe('https://api.ejemplo.com/v1/cosas?page=2');
    expect(registro[0]?.init.method).toBe('GET');

    // LA COMPROBACIÓN QUE IMPORTA: ninguna cookie de CEIBA viaja a un destino
    // de terceros.
    expect(registro[0]?.init.credentials).toBe('omit');
    expect(registro[0]?.init.credentials).not.toBe('include');

    // Las cabeceras desactivadas no se envían.
    expect(registro[0]?.init.headers).toEqual({ accept: 'application/json' });

    // Y lo que se devolvió.
    expect(resultado.outcome).toBe('completed');
    expect(resultado.error).toBeNull();
    expect(resultado.executionId).toBe('ej-1');
    expect(resultado.adaptador).toBe('navegador');
    expect(resultado.response?.status).toBe(200);
    expect(resultado.response?.statusText).toBe('OK');
    expect(resultado.response?.body).toBe(cuerpo);
    expect(resultado.response?.sizeBytes).toBe(11);
    expect(resultado.response?.bodyTruncated).toBe(false);
    expect(resultado.response?.headers).toContainEqual({
      name: 'content-type',
      value: 'application/json',
    });
    expect(resultado.timings.ttfbMs).toBe(5);
    expect(resultado.timings.totalMs).toBe(12);
  });

  it('traduce un fallo de red a outcome "failed" con código del motor', async () => {
    // Es literalmente lo que lanza el navegador: un `TypeError` sin más.
    const resultado = await ejecutar(solicitud(), {
      fetchImpl: fetchQueFalla(new TypeError('Failed to fetch')),
      ahora: reloj([0, 7]),
      idDeEjecucion: 'ej-2',
    });

    expect(resultado.outcome).toBe('failed');
    expect(resultado.response).toBeNull();
    expect(resultado.error?.code).toBe('CONNECTION_REFUSED');
    // El mensaje no finge precisión: dice que el navegador no distingue.
    expect(resultado.error?.message).toContain('CORS');
    expect(resultado.timings.totalMs).toBe(7);
    expect(resultado.urlEfectiva).toBe('https://api.ejemplo.com/v1/cosas');
  });

  it('una petición abortada es TIMEOUT, no un fallo de conexión', async () => {
    const abortada = new Error('The operation was aborted.');
    abortada.name = 'AbortError';

    const resultado = await ejecutar(solicitud(), { fetchImpl: fetchQueFalla(abortada) });

    expect(resultado.outcome).toBe('failed');
    expect(resultado.error?.code).toBe('TIMEOUT');
  });

  it('envía el cuerpo en POST y pone el content-type del modo json', async () => {
    const registro: LlamadaRegistrada[] = [];
    const fetchDoble = fetchQueDevuelve(() => new Response('', { status: 201 }), registro);

    const resultado = await ejecutar(
      solicitud({
        metodo: 'POST',
        cuerpo: { modo: 'json', contenido: '{"a":1}', tipoContenido: null },
      }),
      { fetchImpl: fetchDoble },
    );

    expect(registro[0]?.init.body).toBe('{"a":1}');
    expect(registro[0]?.init.headers).toEqual({ 'content-type': 'application/json' });
    // 201 sin frase: se completa con la de referencia.
    expect(resultado.response?.statusText).toBe('Created');
  });

  it('descarta las cabeceras que el navegador prohíbe y lo declara', async () => {
    const registro: LlamadaRegistrada[] = [];
    const fetchDoble = fetchQueDevuelve(() => new Response('', { status: 200 }), registro);

    const resultado = await ejecutar(
      solicitud({ cabeceras: [par('Host', 'otro.ejemplo.com'), par('x-propia', 'si')] }),
      { fetchImpl: fetchDoble },
    );

    expect(registro[0]?.init.headers).toEqual({ 'x-propia': 'si' });
    expect(resultado.cabecerasIgnoradas).toEqual(['Host']);
  });
});

describe('ayudas de presentación', () => {
  it('reconoce las cabeceras prohibidas por el navegador', () => {
    expect(esCabeceraProhibidaPorElNavegador('Host')).toBe(true);
    expect(esCabeceraProhibidaPorElNavegador('connection')).toBe(true);
    expect(esCabeceraProhibidaPorElNavegador('Sec-Fetch-Mode')).toBe(true);
    expect(esCabeceraProhibidaPorElNavegador('Proxy-Authorization')).toBe(true);
    expect(esCabeceraProhibidaPorElNavegador('authorization')).toBe(false);
    expect(esCabeceraProhibidaPorElNavegador('x-cualquiera')).toBe(false);
  });

  it('describe el estado y su familia', () => {
    expect(textoDeEstado(200, 'OK')).toBe('OK');
    expect(textoDeEstado(404, '')).toBe('Not Found');
    expect(textoDeEstado(599, '')).toBe('');
    expect(familiaDeEstado(204)).toBe('exito');
    expect(familiaDeEstado(301)).toBe('redireccion');
    expect(familiaDeEstado(404)).toBe('cliente');
    expect(familiaDeEstado(500)).toBe('servidor');
  });

  it('calcula tamaños y duraciones', () => {
    expect(tamanoEnBytes('abc')).toBe(3);
    expect(tamanoEnBytes('€')).toBe(3);
    expect(formatearTamano(845)).toBe('845 B');
    expect(formatearTamano(1500)).toBe('1,5 kB');
    expect(formatearDuracion(128)).toBe('128 ms');
    expect(formatearDuracion(1234)).toBe('1,23 s');
  });

  it('formatea JSON y detecta el lenguaje', () => {
    expect(formatearJson('{"a":1}')).toEqual({ texto: '{\n  "a": 1\n}', formateado: true });
    expect(formatearJson('esto no es json')).toEqual({
      texto: 'esto no es json',
      formateado: false,
    });
    expect(lenguajeDesdeTipoDeContenido('application/problem+json; charset=utf-8')).toBe('json');
    expect(lenguajeDesdeTipoDeContenido('text/html')).toBe('html');
    expect(lenguajeDesdeTipoDeContenido('application/atom+xml')).toBe('xml');
    expect(lenguajeDesdeTipoDeContenido(null)).toBe('texto');
    expect(lenguajeDesdeContenido('  {"a":1}')).toBe('json');
    expect(lenguajeDesdeContenido('<?xml version="1.0"?>')).toBe('xml');
    expect(lenguajeDesdeContenido('hola')).toBe('texto');
  });
});

describe('almacén del constructor', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('añade y quita pares sin dejar la tabla sin filas', () => {
    const almacen = usarAlmacenDeConstructor();

    almacen.anadirCabecera('authorization', 'Bearer x');
    expect(almacen.cabeceras).toHaveLength(2);
    expect(almacen.cabecerasActivas).toBe(1);

    const primera = almacen.cabeceras[0];
    const segunda = almacen.cabeceras[1];
    almacen.quitarCabecera(primera?.id ?? '');
    almacen.quitarCabecera(segunda?.id ?? '');
    expect(almacen.cabeceras).toHaveLength(1);
    expect(almacen.cabeceras[0]?.nombre).toBe('');

    almacen.anadirParametro('page', '3');
    expect(almacen.parametrosActivos).toBe(1);
    almacen.quitarParametro(almacen.parametros[1]?.id ?? '');
    expect(almacen.parametros).toHaveLength(1);
  });

  it('compone la URL efectiva con los parámetros del borrador', () => {
    const almacen = usarAlmacenDeConstructor();
    almacen.url = 'https://api.ejemplo.com/v1/cosas';
    almacen.anadirParametro('page', '2');
    expect(almacen.urlEfectiva).toBe('https://api.ejemplo.com/v1/cosas?page=2');
    expect(almacen.puedeEnviar).toBe(true);
  });

  it('ejecuta, guarda el resultado y lo apunta en el historial', async () => {
    const almacen = usarAlmacenDeConstructor();
    almacen.url = 'https://api.ejemplo.com/v1/cosas';

    // Va por el MOTOR, que es el camino por defecto. El doble se inyecta con
    // `usarFetch` porque el adaptador de motor habla con nuestra API a traves
    // del cliente comun, no con el `fetchImpl` que solo honra el modo directo.
    usarFetch(async () =>
      new Response(
        JSON.stringify({
          executionId: 'exec-hist',
          outcome: 'completed',
          response: {
            status: 200,
            statusText: 'OK',
            headers: [],
            body: '{"ok":true}',
            bodyTruncated: false,
            sizeBytes: 11,
          },
          timings: { dnsMs: 0, tcpMs: 0, tlsMs: 0, ttfbMs: 5, totalMs: 12 },
          redirects: [],
          error: null,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    const resultado = await almacen.ejecutarSolicitud();

    expect(resultado?.outcome).toBe('completed');
    expect(resultado?.adaptador).toBe('api');
    expect(almacen.ejecutando).toBe(false);
    expect(almacen.error).toBeNull();
    expect(almacen.resultado?.response?.status).toBe(200);
    expect(almacen.historial).toHaveLength(1);
    expect(almacen.historial[0]?.estado).toBe(200);
    // El historial guarda el DESTINO, no la ruta interna de la API.
    expect(almacen.historial[0]?.url).toBe('https://api.ejemplo.com/v1/cosas');

    usarFetch(null);
  });

  it('se niega a enviar sin URL y lo dice en `error`', async () => {
    const almacen = usarAlmacenDeConstructor();
    const resultado = await almacen.ejecutarSolicitud();

    expect(resultado).toBeNull();
    expect(almacen.error).toContain('URL de destino');
    expect(almacen.historial).toHaveLength(0);
  });

  it('el adaptador por defecto es el MOTOR, no el navegador', () => {
    const almacen = usarAlmacenDeConstructor();
    // Esta es la garantia que pidio el cliente: nada sale de la pestana.
    expect(almacen.adaptador).toBe('api');
    expect(almacen.puerto.id).toBe('api');
    expect(almacen.puerto.disponible).toBe(true);
  });

  it('el adaptador de motor envia a la API y NO usa fetch del navegador', async () => {
    const almacen = usarAlmacenDeConstructor();
    almacen.url = 'https://api.ejemplo.com/v1/cosas';
    almacen.anadirCabecera('Host', 'otro.ejemplo.com');

    // Si la peticion saliera del navegador, este doble recibiria el destino.
    // Debe recibir la ruta de NUESTRA API, y nada mas.
    const llamadas: string[] = [];
    usarFetch(async (entrada: RequestInfo | URL) => {
      llamadas.push(String(entrada));
      return new Response(
        JSON.stringify({
          executionId: 'exec-1',
          outcome: 'completed',
          response: { status: 200, statusText: 'OK', headers: [], body: '{}', bodyTruncated: false, sizeBytes: 2 },
          timings: { dnsMs: 1, tcpMs: 2, tlsMs: 3, ttfbMs: 4, totalMs: 10 },
          redirects: [],
          error: null,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const resultado = await almacen.ejecutarSolicitud();

    expect(resultado?.adaptador).toBe('api');
    expect(resultado?.outcome).toBe('completed');
    // Tiempos REALES del motor: el navegador los devolvia en cero.
    expect(resultado?.timings.totalMs).toBe(10);
    // Ninguna llamada al destino; todas a la API de CEIBA.
    expect(llamadas.some((u) => u.includes('api.ejemplo.com'))).toBe(false);
    expect(llamadas.some((u) => u.includes('/requests/execute'))).toBe(true);

    usarFetch(null);
  });

  it('por el motor NO se descarta ninguna cabecera: `Host` llega', async () => {
    const almacen = usarAlmacenDeConstructor();
    almacen.anadirCabecera('Host', 'otro.ejemplo.com');
    // La limitacion de cabeceras prohibidas era del navegador. El motor no la
    // tiene, asi que la lista de ignoradas queda vacia.
    expect(almacen.cabecerasIgnoradas).toEqual([]);
  });

  it('el historial se queda en las últimas 20 ejecuciones y no se persiste', async () => {
    const almacen = usarAlmacenDeConstructor();
    almacen.url = 'https://api.ejemplo.com/v1/cosas';
    const fetchDoble = fetchQueDevuelve(() => new Response('', { status: 204 }), []);

    for (let i = 0; i < MAXIMO_DE_HISTORIAL + 5; i += 1) {
      await almacen.ejecutarSolicitud({ fetchImpl: fetchDoble, idDeEjecucion: `ej-${i}` });
    }

    expect(almacen.historial).toHaveLength(MAXIMO_DE_HISTORIAL);
    expect(almacen.historial[0]?.id).toBe(`ej-${MAXIMO_DE_HISTORIAL + 4}`);
    // Nada de esto se escribe en el navegador.
    expect(globalThis.localStorage.length).toBe(0);
  });

  it('recupera una solicitud del historial en el borrador', async () => {
    const almacen = usarAlmacenDeConstructor();
    almacen.url = 'https://api.ejemplo.com/v1/original';
    almacen.metodo = 'POST';
    almacen.anadirCabecera('x-prueba', '1');

    const fetchDoble = fetchQueDevuelve(() => new Response('', { status: 200 }), []);
    await almacen.ejecutarSolicitud({ fetchImpl: fetchDoble, idDeEjecucion: 'ej-recuperable' });

    almacen.url = 'https://api.ejemplo.com/v1/otra';
    almacen.metodo = 'GET';

    expect(almacen.recuperarDelHistorial('ej-recuperable')).toBe(true);
    expect(almacen.url).toBe('https://api.ejemplo.com/v1/original');
    expect(almacen.metodo).toBe('POST');
    expect(almacen.cabeceras.some((cabecera) => cabecera.nombre === 'x-prueba')).toBe(true);
    expect(almacen.recuperarDelHistorial('no-existe')).toBe(false);
  });
});

describe('VistaDeConstructor', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('declara en pantalla las limitaciones del modo directo y bloquea Enviar sin URL', async () => {
    const envoltorio = mount(VistaDeConstructor);
    const almacen = usarAlmacenDeConstructor();

    expect(envoltorio.text()).toContain('Constructor de solicitudes');
    // Por defecto se va por el MOTOR, asi que no hay limitacion que avisar.
    expect(envoltorio.text()).toContain('A través del motor de CEIBA');
    expect(envoltorio.get('button[type="submit"]').attributes('disabled')).toBeDefined();

    // La limitacion solo aparece si el usuario baja al modo directo a mano, y
    // entonces tiene que estar DICHA, no escondida en un comentario (§18).
    almacen.usarAdaptador('navegador');
    await envoltorio.vm.$nextTick();
    expect(envoltorio.text()).toContain('CORS');
    expect(envoltorio.text()).toContain('controles SSRF del motor');
    almacen.usarAdaptador('api');
    await envoltorio.vm.$nextTick();

    almacen.url = 'https://api.ejemplo.com/v1/cosas';
    almacen.anadirParametro('page', '2');
    await envoltorio.vm.$nextTick();

    expect(envoltorio.get('button[type="submit"]').attributes('disabled')).toBeUndefined();
    expect(envoltorio.text()).toContain('https://api.ejemplo.com/v1/cosas?page=2');

    envoltorio.unmount();
  });

  it('la pantalla ofrece el motor como modo activo', async () => {
    const envoltorio = mount(VistaDeConstructor);
    const almacen = usarAlmacenDeConstructor();

    expect(almacen.adaptador).toBe('api');
    expect(envoltorio.text()).toContain('A través del motor de CEIBA');

    envoltorio.unmount();
  });

  it('solo el modo directo, elegido a mano, avisa de las cabeceras descartadas', async () => {
    const envoltorio = mount(VistaDeConstructor);
    const almacen = usarAlmacenDeConstructor();

    almacen.anadirCabecera('Host', 'otro.ejemplo.com');
    await envoltorio.vm.$nextTick();
    // Por defecto (motor) no hay nada que descartar.
    expect(almacen.cabecerasIgnoradas).toEqual([]);

    // Al bajar al modo directo reaparece la limitacion del navegador.
    almacen.usarAdaptador('navegador');
    await envoltorio.vm.$nextTick();
    expect(almacen.cabecerasIgnoradas).toEqual(['Host']);
    expect(envoltorio.text()).toContain('El navegador descartará estas cabeceras');

    envoltorio.unmount();
  });
});
