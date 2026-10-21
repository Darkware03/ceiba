import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { RouterLinkStub, flushPromises, mount } from '@vue/test-utils';
import type { DOMWrapper, VueWrapper } from '@vue/test-utils';
import { usarFetch, type FuncionFetch } from '@/api/cliente';
import { usarPortapapeles } from '@/composables/usarPortapapeles';
import {
  clavesSecretas,
  desenvolverLista,
  desenvolverUno,
  errorDeUrlDePeticion,
  errorDeVerboPropio,
  esEjecutableEnElConstructor,
  normalizarPeticion,
  ordenarPeticiones,
  verboVisible,
} from '@/api/peticiones';
import { usarAlmacenDePeticiones } from '@/stores/peticiones';
import { usarAlmacenDeConstructor } from '@/stores/constructor';
import VistaDeColeccion from '@/views/VistaDeColeccion.vue';
import VistaDeConstructor from '@/views/VistaDeConstructor.vue';
import VistaDeWorkspace from '@/views/VistaDeWorkspace.vue';
import type { Peticion } from '@/api/peticiones';

/**
 * Pruebas de la fase 6: peticiones dentro de la colección y exportación a cURL.
 *
 * LO QUE DE VERDAD VIGILAN, por orden de importancia:
 *
 *  1. **Que la colección deje de estar muerta.** El fallo que reportó el
 *     cliente («no sale nada después de crear una colección») no era un error
 *     de red: era una vista que no existía y, en su ausencia, un hueco mudo.
 *     Por eso hay un caso dedicado a que el vacío **tenga acción**, y otro a
 *     que un error NO se confunda con un vacío.
 *  2. **Que el cURL no se fabrique en el cliente.** Es la regla de seguridad de
 *     la fase (`C-LEAK`): el servidor es el único que sabe qué cabecera es
 *     secreta. La prueba afirma que lo que acaba en el portapapeles es
 *     **byte a byte** lo que devolvió el servidor, marcador de secreto
 *     incluido, y que la interfaz no monta ningún comando por su cuenta.
 *  3. **Que las `advertencias` se enseñan.** Un comando incompleto presentado
 *     como completo es el fallo que el §2.4 existe para impedir.
 *
 * Nada toca la red: `usarFetch` recibe un doble, igual que en
 * `colecciones.test.ts`. Los ayudantes están duplicados respecto a ese fichero
 * por el mismo motivo que allí se explica: un `test/ayudas.ts` compartido
 * tocaría ficheros de otra entrega.
 */

const TESTIGO_CSRF = 'nonce.firma';

/**
 * Busca un campo por su **etiqueta accesible**, no por su posición.
 *
 * `CeibaCampo` enlaza `<label for>` con el `id` del control, así que esto
 * recorre las etiquetas, encuentra la que coincide y devuelve su control. Un
 * selector por índice se rompe en cuanto alguien añade un diálogo a la misma
 * vista — pasó de verdad en la fase 7.
 */
function campoPorEtiqueta(vista: VueWrapper, etiqueta: string): DOMWrapper<HTMLInputElement> {
  const marca = vista.findAll('label').find((l) => l.text().trim().startsWith(etiqueta));
  if (marca === undefined) throw new Error(`No hay ningún campo etiquetado «${etiqueta}».`);
  const destino = marca.attributes('for');
  if (destino === undefined) {
    throw new Error(`La etiqueta «${etiqueta}» no apunta a ningún control (falta «for»).`);
  }
  const control = vista.find<HTMLInputElement>(`#${destino}`);
  if (!control.exists()) throw new Error(`La etiqueta «${etiqueta}» apunta a un control que no existe.`);
  return control;
}

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

function peticionCruda(parcial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'req-1',
    collectionId: 'col-1',
    folderId: null,
    name: 'Listar clientes',
    description: null,
    method: 'GET',
    methodCustom: null,
    url: '{{base_url}}/v1/clientes',
    headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
    queryParams: [{ key: 'page', value: '2', enabled: true }],
    bodyType: 'none',
    body: null,
    sortKey: 'a',
    ...parcial,
  };
}

const COLECCION = {
  id: 'col-1',
  workspaceId: 'ws-1',
  slug: 'cobros',
  name: 'Cobros',
  description: 'API de cobros',
  visibility: 'private',
  status: 'active',
  lockVersion: 0,
  createdAt: '2026-10-21T10:00:00.000Z',
  updatedAt: '2026-10-21T10:00:00.000Z',
};

/** Escritor de portapapeles que recuerda lo copiado. */
function espiarPortapapeles(): { copiado: string[] } {
  const copiado: string[] = [];
  usarPortapapeles(async (texto) => {
    copiado.push(texto);
  });
  return { copiado };
}

let pinia: Pinia;

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
});

afterEach(() => {
  usarPortapapeles(null);
});

// ---------------------------------------------------------------------------

describe('api/peticiones — las siete rutas del BRIEF-FASE6 §1', () => {
  it('lista colgando de la colección, con la cookie de sesión', async () => {
    const llamadas = instalarApi(() => ({
      estado: 200,
      cuerpo: { peticiones: [peticionCruda()] },
    }));

    const almacen = usarAlmacenDePeticiones();
    await almacen.cargar('col-1');

    const llamada = llamadaDe(llamadas, 'GET', '/api/v1/collections/col-1/requests');
    expect(llamada.credenciales).toBe('include');
    expect(almacen.deColeccion('col-1')).toHaveLength(1);
    expect(almacen.deColeccion('col-1')[0]?.name).toBe('Listar clientes');
  });

  it('crea con el cuerpo exacto del §1 y con el testigo CSRF', async () => {
    const llamadas = instalarApi((llamada) =>
      llamada.metodo === 'POST'
        ? { estado: 201, cuerpo: { peticion: peticionCruda({ id: 'req-9', name: 'Crear cliente' }) } }
        : { estado: 200, cuerpo: { peticiones: [] } },
    );

    const almacen = usarAlmacenDePeticiones();
    await almacen.cargar('col-1');
    const creada = await almacen.crear('col-1', {
      name: 'Crear cliente',
      method: 'POST',
      methodCustom: null,
      url: '{{base_url}}/v1/clientes',
      folderId: null,
      description: null,
      bodyType: 'raw_json',
    });

    const llamada = llamadaDe(llamadas, 'POST', '/api/v1/collections/col-1/requests');
    expect(llamada.cabeceras['x-ceiba-csrf']).toBe(TESTIGO_CSRF);
    expect(llamada.cuerpo).toMatchObject({
      name: 'Crear cliente',
      method: 'POST',
      url: '{{base_url}}/v1/clientes',
      folderId: null,
      bodyType: 'raw_json',
    });
    expect(creada?.id).toBe('req-9');
    expect(almacen.deColeccion('col-1')).toHaveLength(1);
  });

  it('duplica y borra colgando de /requests/:id, no del workspace', async () => {
    const llamadas = instalarApi((llamada) => {
      if (llamada.url.endsWith('/duplicate')) {
        return { estado: 201, cuerpo: { peticion: peticionCruda({ id: 'req-2', name: 'Copia' }) } };
      }
      if (llamada.metodo === 'DELETE') return { estado: 204 };
      return { estado: 200, cuerpo: { peticiones: [peticionCruda()] } };
    });

    const almacen = usarAlmacenDePeticiones();
    await almacen.cargar('col-1');

    await almacen.duplicar('req-1', 'col-1');
    llamadaDe(llamadas, 'POST', '/api/v1/requests/req-1/duplicate');
    expect(almacen.deColeccion('col-1')).toHaveLength(2);

    await almacen.borrar('req-1', 'col-1');
    llamadaDe(llamadas, 'DELETE', '/api/v1/requests/req-1');
    expect(almacen.deColeccion('col-1').map((p) => p.id)).toEqual(['req-2']);
  });

  it('renombra con PATCH y refresca la casilla del índice', async () => {
    instalarApi((llamada) =>
      llamada.metodo === 'PATCH'
        ? { estado: 200, cuerpo: { peticion: peticionCruda({ name: 'Listar clientes activos' }) } }
        : { estado: 200, cuerpo: { peticiones: [peticionCruda()] } },
    );

    const almacen = usarAlmacenDePeticiones();
    await almacen.cargar('col-1');
    await almacen.actualizar('req-1', 'col-1', { name: 'Listar clientes activos' });

    expect(almacen.deColeccion('col-1')[0]?.name).toBe('Listar clientes activos');
  });

  /**
   * El §1 fija las rutas pero NO el nombre del envoltorio de la lista, y el
   * backend se estaba escribiendo en paralelo. Tolerar las dos convenciones es
   * lo que impide que la vista vuelva a quedar muerta por una palabra.
   */
  it('tolera {peticiones}, {requests} y el array desnudo', () => {
    expect(desenvolverLista({ peticiones: [1] })).toEqual([1]);
    expect(desenvolverLista({ requests: [1, 2] })).toEqual([1, 2]);
    expect(desenvolverLista({ items: [1, 2, 3] })).toEqual([1, 2, 3]);
    expect(desenvolverLista([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
    expect(desenvolverLista({ otra: 'cosa' })).toEqual([]);

    expect(desenvolverUno({ peticion: { id: 'a' } })).toEqual({ id: 'a' });
    expect(desenvolverUno({ request: { id: 'b' } })).toEqual({ id: 'b' });
    expect(desenvolverUno({ id: 'c' })).toEqual({ id: 'c' });
  });

  /**
   * Verificado contra el DTO real del backend: un secreto llega con
   * `value: null` y `secret: true` —«el valor de un secreto NO sale: ni en
   * claro, ni cifrado, ni enmascarado»—. La web **no** puede rellenarlo con
   * un «••••» decorativo, porque eso acabaría enviándose como si fuese el
   * valor.
   */
  it('conserva la marca de secreto y no inventa un valor enmascarado', () => {
    const peticion = normalizarPeticion(
      peticionCruda({
        headers: [
          { key: 'Accept', value: 'application/json', enabled: true, secret: false },
          { key: 'Authorization', value: null, enabled: true, secret: true },
        ],
      }),
    );

    expect(peticion.headers[1]?.secret).toBe(true);
    expect(peticion.headers[1]?.value).toBe('');
    expect(clavesSecretas(peticion)).toEqual(['Authorization']);
  });

  it('resuelve el nombre de la carpeta cruzando el array de carpetas', async () => {
    instalarApi(() => ({
      estado: 200,
      cuerpo: {
        requests: [peticionCruda({ folderId: 'f-1' })],
        carpetas: [{ id: 'f-1', name: 'Administración' }],
      },
    }));

    const almacen = usarAlmacenDePeticiones();
    await almacen.cargar('col-1');

    expect(almacen.porCarpeta('col-1')[0]?.titulo).toBe('Administración');
  });

  it('normaliza una fila incompleta sin inventarse datos', () => {
    const peticion = normalizarPeticion({ id: 'x', name: 'Algo' }, 'col-7');
    expect(peticion.collectionId).toBe('col-7');
    expect(peticion.method).toBe('GET');
    expect(peticion.bodyType).toBe('none');
    expect(peticion.headers).toEqual([]);
    expect(peticion.folderId).toBeNull();
  });

  it('ordena por carpeta, luego por sortKey y luego por nombre', () => {
    const lista = [
      normalizarPeticion(peticionCruda({ id: '1', name: 'Zeta', sortKey: 'b' })),
      normalizarPeticion(peticionCruda({ id: '2', name: 'Alfa', sortKey: 'a' })),
      normalizarPeticion(peticionCruda({ id: '3', name: 'Beta', folderId: 'f-1', sortKey: 'a' })),
    ];
    expect(ordenarPeticiones(lista).map((p) => p.id)).toEqual(['2', '1', '3']);
  });

  it('distingue los verbos que el motor sabe ejecutar de los que no', () => {
    expect(esEjecutableEnElConstructor('GET')).toBe(true);
    expect(esEjecutableEnElConstructor('OPTIONS')).toBe(true);
    // El enum de la base admite TRACE y CUSTOM; `ALLOWED_METHODS` no.
    expect(esEjecutableEnElConstructor('TRACE')).toBe(false);
    expect(esEjecutableEnElConstructor('CUSTOM')).toBe(false);

    expect(verboVisible({ method: 'CUSTOM', methodCustom: 'purge' })).toBe('PURGE');
    expect(verboVisible({ method: 'GET', methodCustom: null })).toBe('GET');
  });

  it('valida el verbo propio tal y como lo exige ck_request_custom_verb', () => {
    expect(errorDeVerboPropio('GET', '')).toBeNull();
    expect(errorDeVerboPropio('CUSTOM', '')).toContain('verbo');
    expect(errorDeVerboPropio('CUSTOM', 'PURGE')).toBeNull();
  });

  it('acepta una URL con variables sin resolver, que es el caso normal', () => {
    expect(errorDeUrlDePeticion('{{base_url}}/v1/clientes')).toBeNull();
    expect(errorDeUrlDePeticion('')).toContain('obligatoria');
    expect(errorDeUrlDePeticion('http://a b')).toContain('espacios');
  });
});

// ---------------------------------------------------------------------------

describe('almacén de peticiones — vacío confirmado frente a error', () => {
  it('un 200 sin peticiones es VACÍO confirmado, y la casilla queda cargada', async () => {
    instalarApi(() => ({ estado: 200, cuerpo: { peticiones: [] } }));

    const almacen = usarAlmacenDePeticiones();
    await almacen.cargar('col-1');

    expect(almacen.cargada('col-1')).toBe(true);
    expect(almacen.estaVacia('col-1')).toBe(true);
    expect(almacen.error).toBeNull();
  });

  /**
   * Éste es el caso que provocó el informe del cliente. Si un fallo dejase la
   * casilla escrita, `estaVacia()` diría `true` y la vista pintaría «no hay
   * peticiones» cuando lo cierto es que no se sabe. Un hueco mudo otra vez.
   */
  it('un fallo NO deja la colección como vacía: deja error y cargada=false', async () => {
    instalarApi(() => ({
      estado: 500,
      cuerpo: { error: 'error_interno', mensaje: 'Algo se rompió.' },
    }));

    const almacen = usarAlmacenDePeticiones();
    await almacen.cargar('col-1');

    expect(almacen.cargada('col-1')).toBe(false);
    expect(almacen.estaVacia('col-1')).toBe(false);
    expect(almacen.error).toBe('Algo se rompió.');
  });

  it('agrupa por carpeta y pone la raíz la primera', async () => {
    instalarApi(() => ({
      estado: 200,
      cuerpo: {
        peticiones: [
          peticionCruda({ id: '1', name: 'En raíz' }),
          peticionCruda({ id: '2', name: 'En carpeta', folderId: 'f-1', folderName: 'Admin' }),
        ],
      },
    }));

    const almacen = usarAlmacenDePeticiones();
    await almacen.cargar('col-1');

    const grupos = almacen.porCarpeta('col-1');
    expect(grupos).toHaveLength(2);
    expect(grupos[0]?.titulo).toBe('Raíz de la colección');
    expect(grupos[1]?.titulo).toBe('Admin');
  });
});

// ---------------------------------------------------------------------------

describe('Copiar como cURL — el comando lo genera el SERVIDOR', () => {
  const COMANDO_DEL_SERVIDOR =
    "curl --request GET --url '{{base_url}}/v1/clientes?page=2' " +
    "--header 'Accept: application/json' " +
    "--header 'Authorization: Bearer $CEIBA_SECRETO_TOKEN_PAGOS'";

  it('pide GET /requests/:id/curl y copia su texto byte a byte', async () => {
    const espia = espiarPortapapeles();
    const llamadas = instalarApi((llamada) =>
      llamada.url.endsWith('/curl')
        ? { estado: 200, cuerpo: { curl: COMANDO_DEL_SERVIDOR, advertencias: [] } }
        : { estado: 200, cuerpo: { peticiones: [peticionCruda()] } },
    );

    const almacen = usarAlmacenDePeticiones();
    const estado = await almacen.copiarComoCurl('req-1', 'Listar clientes');

    llamadaDe(llamadas, 'GET', '/api/v1/requests/req-1/curl');
    expect(estado?.copiado).toBe(true);
    // Byte a byte: la interfaz NO recompone, no reordena y no reescapa nada.
    expect(espia.copiado).toEqual([COMANDO_DEL_SERVIDOR]);
    expect(almacen.curl?.comando).toBe(COMANDO_DEL_SERVIDOR);
  });

  /**
   * C-LEAK por la puerta de atrás. El valor real de la cabecera secreta sí
   * está en el almacén del constructor y en la petición guardada; lo que NO
   * puede pasar es que aparezca en el comando, porque el comando se pega en
   * tickets y en chats. Como el comando viene del servidor, basta con no
   * tocarlo — y esto lo afirma.
   */
  it('el marcador de secreto llega intacto y el valor real no aparece', async () => {
    const espia = espiarPortapapeles();
    instalarApi(() => ({
      estado: 200,
      cuerpo: { curl: COMANDO_DEL_SERVIDOR, advertencias: [] },
    }));

    const almacen = usarAlmacenDePeticiones();
    await almacen.copiarComoCurl('req-1', 'Listar clientes');

    const copiado = espia.copiado[0] ?? '';
    expect(copiado).toContain('$CEIBA_SECRETO_TOKEN_PAGOS');
    expect(copiado).not.toContain('Bearer eyJhbGciOi');
    // Las variables se conservan sin resolver: `url_template` jamás se guarda
    // resuelta y el cURL exportado no debe inventarse valores (§2.2).
    expect(copiado).toContain('{{base_url}}');
  });

  it('guarda las advertencias del servidor para poder enseñarlas', async () => {
    espiarPortapapeles();
    instalarApi(() => ({
      estado: 200,
      cuerpo: {
        curl: COMANDO_DEL_SERVIDOR,
        advertencias: [
          'El cuerpo multipart no se puede representar en cURL sin los ficheros originales.',
        ],
      },
    }));

    const almacen = usarAlmacenDePeticiones();
    const estado = await almacen.copiarComoCurl('req-1', 'Listar clientes');

    expect(estado?.advertencias).toHaveLength(1);
    expect(estado?.advertencias[0]).toContain('multipart');
  });

  /**
   * Que el portapapeles falle (HTTP sin contexto seguro, permiso denegado) no
   * puede ocultar el comando: es justo cuando más falta hace enseñarlo.
   */
  it('si el portapapeles falla, el comando sigue disponible y se dice por qué', async () => {
    usarPortapapeles(async () => {
      throw new Error('Permiso denegado por el navegador.');
    });
    instalarApi(() => ({
      estado: 200,
      cuerpo: { curl: COMANDO_DEL_SERVIDOR, advertencias: [] },
    }));

    const almacen = usarAlmacenDePeticiones();
    const estado = await almacen.copiarComoCurl('req-1', 'Listar clientes');

    expect(estado?.copiado).toBe(false);
    expect(estado?.motivoDeNoCopia).toContain('Permiso denegado');
    expect(estado?.comando).toBe(COMANDO_DEL_SERVIDOR);
  });

  it('un fallo de la API deja errorDeCurl y ningún comando a medias', async () => {
    espiarPortapapeles();
    instalarApi(() => ({
      estado: 403,
      cuerpo: { error: 'prohibido', mensaje: 'No tienes rol en este workspace.' },
    }));

    const almacen = usarAlmacenDePeticiones();
    const estado = await almacen.copiarComoCurl('req-1', 'Listar clientes');

    expect(estado).toBeNull();
    expect(almacen.curl).toBeNull();
    expect(almacen.errorDeCurl).toBe('No tienes rol en este workspace.');
  });
});

// ---------------------------------------------------------------------------

describe('VistaDeColeccion — la colección deja de estar muerta', () => {
  function montar(collectionId = 'col-1') {
    return mount(VistaDeColeccion, {
      props: { collectionId },
      global: { plugins: [pinia], components: { RouterLink: RouterLinkStub } },
    });
  }

  function apiDeColeccion(peticiones: Array<Record<string, unknown>>) {
    return instalarApi((llamada) => {
      if (llamada.url === '/api/v1/collections/col-1') {
        return { estado: 200, cuerpo: { coleccion: COLECCION } };
      }
      if (llamada.url === '/api/v1/collections/col-1/requests') {
        return { estado: 200, cuerpo: { peticiones } };
      }
      return { estado: 404, cuerpo: { error: 'no_encontrado', mensaje: 'No existe.' } };
    });
  }

  /**
   * EL CASO DEL CLIENTE. Antes de esta fase aquí no había ni pantalla. Ahora,
   * una colección sin peticiones tiene que ofrecer la salida, no un hueco.
   */
  it('una colección vacía enseña el estado vacío CON ACCIÓN', async () => {
    apiDeColeccion([]);

    const vista = montar();
    await flushPromises();

    const texto = vista.text();
    expect(texto).toContain('Esta colección todavía no tiene peticiones');
    expect(texto).toContain('Crear la primera petición');
    // Y el botón existe de verdad, no es sólo un rótulo.
    const botones = vista.findAll('button').map((b) => b.text());
    expect(botones).toContain('Crear la primera petición');

    vista.unmount();
  });

  it('pinta cada petición con su verbo, su URL y enlace al constructor', async () => {
    apiDeColeccion([
      peticionCruda(),
      peticionCruda({ id: 'req-2', name: 'Crear cliente', method: 'POST', sortKey: 'b' }),
    ]);

    const vista = montar();
    await flushPromises();

    const texto = vista.text();
    expect(texto).toContain('Cobros');
    expect(texto).toContain('Listar clientes');
    expect(texto).toContain('Crear cliente');
    expect(texto).toContain('{{base_url}}/v1/clientes');
    expect(texto).toContain('(2)');

    // Un enlace por petición, con la query que abre el constructor; más el de
    // volver al workspace.
    const enlaces = vista.findAllComponents(RouterLinkStub);
    expect(enlaces).toHaveLength(3);
    expect(enlaces[0]?.props('to')).toEqual({
      name: 'workspace',
      params: { workspaceId: 'ws-1' },
    });
    expect(enlaces[1]?.props('to')).toEqual({
      name: 'constructor',
      query: { peticion: 'req-1', coleccion: 'col-1' },
    });

    vista.unmount();
  });

  it('un error al listar NO se disfraza de colección vacía', async () => {
    instalarApi((llamada) => {
      if (llamada.url === '/api/v1/collections/col-1') {
        return { estado: 200, cuerpo: { coleccion: COLECCION } };
      }
      return { estado: 500, cuerpo: { error: 'error_interno', mensaje: 'La API se cayó.' } };
    });

    const vista = montar();
    await flushPromises();

    const texto = vista.text();
    expect(texto).toContain('No se pudieron cargar las peticiones');
    expect(texto).toContain('La API se cayó.');
    expect(texto).toContain('Reintentar');
    expect(texto).not.toContain('Esta colección todavía no tiene peticiones');

    vista.unmount();
  });

  it('mientras carga enseña el logo de la marca girando, no un texto suelto', async () => {
    // Sin resolver: la vista se queda en el estado de carga.
    usarFetch(() => new Promise<Response>(() => {}));

    const vista = montar();
    await vista.vm.$nextTick();

    expect(vista.find('.ceiba-spinner').exists()).toBe(true);
    expect(vista.text()).toContain('Cargando peticiones');

    vista.unmount();
  });

  it('el botón «Copiar como cURL» abre el diálogo con el comando y las advertencias', async () => {
    const espia = espiarPortapapeles();
    instalarApi((llamada) => {
      if (llamada.url === '/api/v1/collections/col-1') {
        return { estado: 200, cuerpo: { coleccion: COLECCION } };
      }
      if (llamada.url === '/api/v1/requests/req-1/curl') {
        return {
          estado: 200,
          cuerpo: {
            curl: "curl --request GET --url '{{base_url}}/v1/clientes'",
            advertencias: ['La cabecera «Authorization» sale como marcador: es secreta.'],
          },
        };
      }
      return { estado: 200, cuerpo: { peticiones: [peticionCruda()] } };
    });

    const vista = montar();
    await flushPromises();

    const boton = vista
      .findAll('button')
      .find((b) => b.text().includes('Copiar como cURL'));
    expect(boton).toBeDefined();
    await boton?.trigger('click');
    await flushPromises();

    const texto = vista.text();
    expect(texto).toContain('Comando cURL');
    expect(texto).toContain('Copiado al portapapeles');
    expect(texto).toContain('es secreta');
    expect(espia.copiado[0]).toBe("curl --request GET --url '{{base_url}}/v1/clientes'");
    // El comando se enseña, para poder copiarlo a mano si hiciera falta.
    const area = vista.find('#curl-comando');
    expect(area.exists()).toBe(true);
    expect((area.element as HTMLTextAreaElement).value).toContain('curl --request GET');

    vista.unmount();
  });

  it('crear una petición la manda con el cuerpo del §1 y la añade a la lista', async () => {
    const llamadas = instalarApi((llamada) => {
      if (llamada.url === '/api/v1/collections/col-1') {
        return { estado: 200, cuerpo: { coleccion: COLECCION } };
      }
      if (llamada.metodo === 'POST') {
        return {
          estado: 201,
          cuerpo: { peticion: peticionCruda({ id: 'req-3', name: 'Alta de cliente' }) },
        };
      }
      return { estado: 200, cuerpo: { peticiones: [] } };
    });

    const vista = montar();
    await flushPromises();

    // Abrir el diálogo desde el estado vacío: es la ruta que arregla el fallo.
    const abrir = vista
      .findAll('button')
      .find((b) => b.text().includes('Crear la primera petición'));
    await abrir?.trigger('click');
    await vista.vm.$nextTick();

    /*
     * POR ETIQUETA, NO POR ÍNDICE. Esto estaba escrito como
     * `vista.findAll('input')[0]` y dejó de funcionar en cuanto el ámbito D
     * añadió `DialogoDeComparticion` a la cabecera de esta misma vista
     * (renderizado siempre, con `:abierto`, no con `v-if`): sus campos pasaron
     * a ser los primeros `<input>` del documento y el nombre de la petición se
     * quedaba vacío, así que la validación cancelaba el envío y el POST nunca
     * salía. El fallo era de la prueba, no de la vista: un selector por
     * posición afirma algo sobre el orden del DOM que nadie prometió.
     * Buscar por la etiqueta accesible es estable y además comprueba, de
     * paso, que el campo TIENE nombre accesible.
     */
    await campoPorEtiqueta(vista, 'Nombre de la petición').setValue('Alta de cliente');
    await campoPorEtiqueta(vista, 'URL').setValue('{{base_url}}/v1/clientes');

    const guardar = vista.findAll('button').find((b) => b.text().includes('Crear petición'));
    await guardar?.trigger('click');
    await flushPromises();

    const envio = llamadaDe(llamadas, 'POST', '/api/v1/collections/col-1/requests');
    expect(envio.cuerpo).toMatchObject({
      name: 'Alta de cliente',
      url: '{{base_url}}/v1/clientes',
      folderId: null,
    });
    expect(usarAlmacenDePeticiones().deColeccion('col-1')).toHaveLength(1);

    vista.unmount();
  });
});

// ---------------------------------------------------------------------------

describe('VistaDeWorkspace — la colección ya tiene salida', () => {
  it('cada colección ofrece «Abrir» para ver sus peticiones', async () => {
    instalarApi((llamada) => {
      if (llamada.url === '/api/v1/workspaces') {
        return {
          estado: 200,
          cuerpo: {
            workspaces: [
              {
                id: 'ws-1',
                slug: 'pagos',
                name: 'Pagos',
                description: null,
                ownerUserId: 'u-1',
                status: 'active',
                createdAt: '2026-10-21T10:00:00.000Z',
                updatedAt: '2026-10-21T10:00:00.000Z',
              },
            ],
          },
        };
      }
      return { estado: 200, cuerpo: { colecciones: [COLECCION] } };
    });

    const vista = mount(VistaDeWorkspace, {
      props: { workspaceId: 'ws-1' },
      global: { plugins: [pinia], components: { RouterLink: RouterLinkStub } },
    });
    await flushPromises();

    const abrir = vista
      .findAll('button')
      .find((b) => b.attributes('aria-label')?.startsWith('Abrir la colección'));
    expect(abrir).toBeDefined();
    expect(abrir?.text()).toBe('Abrir');

    vista.unmount();
  });
});

// ---------------------------------------------------------------------------

describe('abrir una petición guardada en el constructor', () => {
  it('traduce los body_mode del servidor al vocabulario del constructor', () => {
    const almacen = usarAlmacenDeConstructor();

    const base = { url: 'https://api.ejemplo.com/v1', body: '{"a":1}' };
    expect(almacen.cargarDesdePeticionGuardada({ ...base, method: 'POST', bodyType: 'raw_json' }))
      .toEqual([]);
    expect(almacen.cuerpo.modo).toBe('json');
    expect(almacen.cuerpo.tipoContenido).toBe('application/json');

    almacen.cargarDesdePeticionGuardada({ ...base, method: 'POST', bodyType: 'raw_xml' });
    expect(almacen.cuerpo.modo).toBe('raw');
    expect(almacen.cuerpo.tipoContenido).toBe('application/xml');

    almacen.cargarDesdePeticionGuardada({ ...base, method: 'POST', bodyType: 'form_urlencoded' });
    expect(almacen.cuerpo.tipoContenido).toBe('application/x-www-form-urlencoded');
  });

  /**
   * ACTUALIZADO EN LA FASE 7, Y EL CAMBIO ES EL ENTREGABLE.
   *
   * Hasta aquí esta prueba afirmaba que `multipart_form_data` se declaraba
   * como «no representable», porque la interfaz no sabía componerlo. P5 lo
   * implementa: el cliente pidió «formdata, binario». Así que la expectativa
   * correcta ahora es la contraria —se abre con su modo propio— y la garantía
   * de fondo («lo que no se sabe componer se declara, no se falsea») se sigue
   * comprobando con el modo que SÍ queda fuera: `custom`, que el esquema deja
   * sin forma definida.
   */
  it('abre los modos de formulario y binario con su modo propio (P5)', () => {
    const almacen = usarAlmacenDeConstructor();

    const sinLimitaciones = almacen.cargarDesdePeticionGuardada({
      method: 'POST',
      url: 'https://api.ejemplo.com/v1/subida',
      bodyType: 'multipart_form_data',
      bodyFields: [
        { key: 'titulo', kind: 'text', value: 'hola', enabled: true },
        { key: 'adjunto', kind: 'file', fileId: 'f-1', enabled: true },
      ],
    });

    expect(sinLimitaciones).toHaveLength(0);
    expect(almacen.cuerpo.modo).toBe('multipart_form_data');
    expect(almacen.camposDelCuerpo).toHaveLength(2);
    expect(almacen.camposDelCuerpo[0]).toMatchObject({ nombre: 'titulo', tipo: 'texto', valor: 'hola' });
    expect(almacen.camposDelCuerpo[1]).toMatchObject({ nombre: 'adjunto', tipo: 'fichero' });
    expect(almacen.camposDelCuerpo[1]?.fichero?.id).toBe('f-1');

    almacen.cargarDesdePeticionGuardada({
      method: 'PUT',
      url: 'https://api.ejemplo.com/v1/fichero',
      bodyType: 'binary_file',
      binaryFile: { id: 'f-9', fileName: 'informe.pdf', contentType: 'application/pdf', sizeBytes: 1024 },
    });
    expect(almacen.cuerpo.modo).toBe('binary_file');
    expect(almacen.cuerpo.ficheroBinario?.fileName).toBe('informe.pdf');
  });

  it('declara el cuerpo que SIGUE sin saber componer en vez de falsearlo', () => {
    const almacen = usarAlmacenDeConstructor();
    const limitaciones = almacen.cargarDesdePeticionGuardada({
      method: 'POST',
      url: 'https://api.ejemplo.com/v1/raro',
      bodyType: 'custom',
      body: 'algo',
    });

    expect(limitaciones).toHaveLength(1);
    expect(limitaciones[0]).toContain('custom');
    expect(almacen.cuerpo.modo).toBe('none');
    expect(almacen.cuerpo.contenido).toBe('');
  });

  it('un método que el motor no ejecuta se declara y NO se coerce en silencio', () => {
    const almacen = usarAlmacenDeConstructor();
    const limitaciones = almacen.cargarDesdePeticionGuardada({
      method: 'CUSTOM',
      methodCustom: 'PURGE',
      url: 'https://api.ejemplo.com/v1/cache',
    });

    expect(limitaciones).toHaveLength(1);
    expect(limitaciones[0]).toContain('PURGE');
    // No se ha inventado un GET «equivalente»: el selector queda como estaba.
    expect(almacen.metodo).toBe('GET');
    expect(almacen.url).toBe('https://api.ejemplo.com/v1/cache');
  });

  /**
   * Abrir una petición con una cabecera secreta no puede terminar en un envío
   * con `Authorization:` vacío y un 401 inexplicable. Se declara en pantalla.
   */
  it('avisa de que el valor de un secreto no viene del servidor', async () => {
    instalarApi(() => ({
      estado: 200,
      cuerpo: {
        peticion: peticionCruda({
          headers: [{ key: 'Authorization', value: null, enabled: true, secret: true }],
        }),
      },
    }));

    const vista = mount(VistaDeConstructor, {
      props: { peticionId: 'req-1', coleccionId: 'col-1' },
      global: { plugins: [pinia], components: { RouterLink: RouterLinkStub } },
    });
    await flushPromises();

    const texto = vista.text();
    expect(texto).toContain('no se puede representar entera');
    expect(texto).toContain('Authorization');

    vista.unmount();
  });

  /**
   * El recorrido completo del requisito 2 del ámbito: pulsar una petición la
   * abre en el constructor que ya existía. La vista recibe el identificador
   * por `props` desde la query de la ruta y pide `GET /requests/:id`.
   */
  it('VistaDeConstructor abre la petición guardada que le pasa la ruta', async () => {
    const llamadas = instalarApi(() => ({
      estado: 200,
      cuerpo: { peticion: peticionCruda({ name: 'Listar clientes', method: 'POST' }) },
    }));

    const vista = mount(VistaDeConstructor, {
      props: { peticionId: 'req-1', coleccionId: 'col-1' },
      global: { plugins: [pinia], components: { RouterLink: RouterLinkStub } },
    });
    await flushPromises();

    llamadaDe(llamadas, 'GET', '/api/v1/requests/req-1');

    const almacen = usarAlmacenDeConstructor();
    expect(almacen.url).toBe('{{base_url}}/v1/clientes');
    expect(almacen.metodo).toBe('POST');
    expect(vista.text()).toContain('Listar clientes');
    expect(vista.text()).toContain('Volver a la colección');

    vista.unmount();
  });

  /**
   * `/constructor` a secas tiene que seguir siendo el borrador en blanco: es
   * lo que montan las pruebas de la fase 5 y lo que ve quien entra por el menú.
   */
  it('sin peticionId el constructor no pide nada y sigue en blanco', async () => {
    const llamadas = instalarApi(() => ({ estado: 200, cuerpo: {} }));

    const vista = mount(VistaDeConstructor, { global: { plugins: [pinia] } });
    await flushPromises();

    expect(llamadas).toHaveLength(0);
    expect(vista.text()).toContain('Constructor de solicitudes');
    expect(usarAlmacenDeConstructor().url).toBe('');

    vista.unmount();
  });

  it('vuelca cabeceras y parámetros guardados en el borrador', () => {
    const almacen = usarAlmacenDeConstructor();
    const peticion: Peticion = normalizarPeticion(peticionCruda());

    almacen.cargarDesdePeticionGuardada({
      method: peticion.method,
      url: peticion.url,
      headers: peticion.headers.map((p) => ({ ...p })),
      queryParams: peticion.queryParams.map((p) => ({ ...p })),
      bodyType: peticion.bodyType,
      body: peticion.body,
    });

    expect(almacen.url).toBe('{{base_url}}/v1/clientes');
    expect(almacen.cabeceras[0]?.nombre).toBe('Accept');
    expect(almacen.parametros[0]?.nombre).toBe('page');
    expect(almacen.parametros[0]?.valor).toBe('2');
  });
});
