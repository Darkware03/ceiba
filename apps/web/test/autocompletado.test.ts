import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { usarFetch, type FuncionFetch } from '@/api/cliente';
import {
  desenvolverVariables,
  listarVariablesDeColeccion,
  normalizarVariable,
  ordenarVariables,
  rutaDeVariables,
  usarVariablesDeColeccion,
  type VariableDeColeccion,
} from '@/composables/usarVariablesDeColeccion';
import CampoConVariables from '@/components/variables/CampoConVariables.vue';
import ListaDeSugerencias from '@/components/variables/ListaDeSugerencias.vue';

/**
 * Pruebas del autocompletado de variables de doble llave (P6 del
 * `BRIEF-FASE7`, §3 ámbito C punto 4).
 *
 * LO QUE DE VERDAD VIGILAN, por orden de importancia:
 *
 *  1. **La frontera de secretos del §2.3.** Una variable secreta se lista —el
 *     usuario tiene que poder insertarla— pero su valor NO sale por ningún
 *     sitio. Hay dos casos dedicados: uno comprueba que el cliente descarta un
 *     `preview` que el servidor nunca debió mandar, y otro que la opción
 *     pintada no contiene ese valor ni aunque se le fuerce la prop. Dos cierres
 *     para la misma puerta, a propósito: una lista de autocompletado no es una
 *     puerta trasera para leer secretos.
 *  2. **Que el widget se maneje con el teclado.** Flechas, `Enter` y `Esc` son
 *     el requisito explícito del brief. `Esc` cerrando SIN borrar lo escrito
 *     tiene caso propio porque es el fallo clásico de este widget.
 *  3. **Que lo eclipsado y lo desactivado se digan.** El §2.3 es explícito:
 *     la variable perdedora «no se omite».
 *
 * Nada toca la red: `usarFetch` recibe un doble, igual que en
 * `peticiones.test.ts`. Los ayudantes están duplicados respecto a ese fichero
 * por el mismo motivo que allí se explica: un `test/ayudas.ts` compartido
 * tocaría ficheros de otra entrega.
 */

// ---------------------------------------------------------------------------
// Las dobles llaves, en constantes
// ---------------------------------------------------------------------------

/**
 * No se escriben literales ni aquí: aunque esto sea un `.ts` y no una
 * plantilla, componerlas a partir de las constantes deja escrito **cuál** es
 * el disparo y evita que una búsqueda por `{{` en el repositorio confunda el
 * código de prueba con una interpolación de Vue.
 */
const APERTURA = '{' + '{';
const CIERRE = '}' + '}';

function conLlaves(clave: string): string {
  return `${APERTURA}${clave}${CIERRE}`;
}

// ---------------------------------------------------------------------------
// Doble de la API
// ---------------------------------------------------------------------------

interface LlamadaRegistrada {
  readonly url: string;
  readonly metodo: string;
  readonly credenciales: RequestCredentials | undefined;
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
      credenciales: iniciales?.credentials,
    };
    llamadas.push(llamada);
    return respuestaFalsa(responder(llamada));
  };
  usarFetch(doble);
  return llamadas;
}

// ---------------------------------------------------------------------------
// Ayudantes de datos
// ---------------------------------------------------------------------------

function variable(parcial: Partial<VariableDeColeccion> & { key: string }): VariableDeColeccion {
  return {
    scope: 'collection',
    environmentId: 'env-1',
    environmentName: 'Producción',
    isSecret: false,
    isEnabled: true,
    valueKind: 'string',
    preview: null,
    shadowed: false,
    ...parcial,
  };
}

/** Teclea con el cursor al final, que es lo que hace una persona. */
async function teclear(
  elemento: HTMLInputElement | HTMLTextAreaElement,
  texto: string,
): Promise<void> {
  elemento.value = texto;
  elemento.setSelectionRange(texto.length, texto.length);
  elemento.dispatchEvent(new Event('input', { bubbles: true }));
  await flushPromises();
}

const anfitriones: HTMLDivElement[] = [];

/** Lo que el componente ha emitido, recogido por los oyentes de verdad. */
interface SucesosDelCampo {
  readonly modelo: string[];
  desenfoques: number;
  envios: number;
}

/**
 * Monta el campo **enganchado al documento** y con el `v-model` cerrado.
 *
 * Lo primero hace falta para comprobar que `Esc` no se propaga: sin un
 * ancestro real no hay a quién no propagarse. Lo segundo porque el componente
 * es controlado: si nadie devuelve la prop, el caso comprobaría un campo que
 * en la aplicación real no existe.
 *
 * POR QUÉ NO SE USA `wrapper.emitted()`. Medido en este entorno (Vue 3.5.44 +
 * `@vue/test-utils` 2.5.1 + Vitest 5): `emitted()` sólo recoge los eventos DOM
 * que burbujean hasta la raíz —`input`, `select`, `focusin`— y **no** los
 * `emit` del componente. Comprobado con un caso de depuración: los oyentes de
 * aquí abajo reciben `update:modelValue`, `desenfoque` y `enviar`, mientras
 * `Object.keys(wrapper.emitted())` no los contiene. Suscribirse de verdad es
 * además lo que hará el padre al integrar, así que la prueba se parece más a
 * la realidad. No se "arregle" volviendo a `emitted()`.
 */
function montarCampo(props: Record<string, unknown> = {}) {
  const anfitrion = document.createElement('div');
  document.body.appendChild(anfitrion);
  anfitriones.push(anfitrion);

  const sucesos: SucesosDelCampo = { modelo: [], desenfoques: 0, envios: 0 };

  const envoltorio = mount(CampoConVariables, {
    attachTo: anfitrion,
    props: {
      modelValue: '',
      etiqueta: 'URL de la petición',
      ...props,
      'onUpdate:modelValue': (valor: string) => {
        sucesos.modelo.push(valor);
        void envoltorio.setProps({ modelValue: valor });
      },
      onDesenfoque: () => {
        sucesos.desenfoques += 1;
      },
      onEnviar: () => {
        sucesos.envios += 1;
      },
    },
  });

  const selector = props.multilinea === true ? 'textarea' : 'input';
  const control = envoltorio.find(selector);
  const elemento = control.element as HTMLInputElement | HTMLTextAreaElement;
  return { envoltorio, control, elemento, anfitrion, sucesos };
}

afterEach(() => {
  for (const anfitrion of anfitriones.splice(0)) anfitrion.remove();
});

// ---------------------------------------------------------------------------
// El contrato del §2.3
// ---------------------------------------------------------------------------

describe('listarVariablesDeColeccion', () => {
  it('pide la ruta del §2.3 con la cookie de sesión y normaliza el contrato', async () => {
    const llamadas = instalarApi(() => ({
      estado: 200,
      cuerpo: {
        items: [
          {
            key: 'base_url',
            scope: 'collection',
            environmentId: 'env-1',
            environmentName: 'Producción',
            isSecret: false,
            isEnabled: true,
            valueKind: 'string',
            preview: 'https://api.ejemplo.com',
            shadowed: false,
          },
        ],
      },
    }));

    const variables = await listarVariablesDeColeccion('col 1/2');

    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]?.metodo).toBe('GET');
    expect(llamadas[0]?.url).toBe('/api/v1/collections/col%201%2F2/variables');
    expect(llamadas[0]?.credenciales).toBe('include');

    expect(variables).toEqual([
      {
        key: 'base_url',
        scope: 'collection',
        environmentId: 'env-1',
        environmentName: 'Producción',
        isSecret: false,
        isEnabled: true,
        valueKind: 'string',
        preview: 'https://api.ejemplo.com',
        shadowed: false,
      },
    ]);
  });

  it('descarta el preview de una secreta aunque el servidor mande un valor', async () => {
    instalarApi(() => ({
      estado: 200,
      cuerpo: {
        items: [
          {
            key: 'api_token',
            scope: 'workspace',
            environmentId: 'env-2',
            environmentName: 'Local',
            isSecret: true,
            isEnabled: true,
            valueKind: 'secret',
            // El §2.3 dice que esto NUNCA debería llegar. Si llega, el cliente
            // lo tira: es el único sitio donde se pintaría.
            preview: 'sk-live-FILTRADO',
            shadowed: false,
          },
        ],
      },
    }));

    const [secreta] = await listarVariablesDeColeccion('col-1');

    expect(secreta?.key).toBe('api_token');
    expect(secreta?.isSecret).toBe(true);
    expect(secreta?.preview).toBeNull();
    expect(JSON.stringify(secreta)).not.toContain('FILTRADO');
  });

  it('tolera el envoltorio {variables}, el array desnudo y la basura', () => {
    expect(desenvolverVariables({ variables: [1] })).toEqual([1]);
    expect(desenvolverVariables([2])).toEqual([2]);
    expect(desenvolverVariables({ items: [3] })).toEqual([3]);
    expect(desenvolverVariables(null)).toEqual([]);
    expect(desenvolverVariables({ otra: 'cosa' })).toEqual([]);
  });

  it('rellena los huecos y descarta lo que no tiene clave', () => {
    expect(normalizarVariable({ key: '  ' })).toBeNull();
    expect(normalizarVariable({ nombre: 'sin key' })).toBeNull();

    expect(normalizarVariable({ key: 'suelta' })).toEqual({
      key: 'suelta',
      // `scope` desconocido cae a workspace: es el ámbito menos específico.
      scope: 'workspace',
      environmentId: null,
      environmentName: null,
      isSecret: false,
      // Ausente = activa: una variable guardada sin la marca es una que cuenta.
      isEnabled: true,
      valueKind: null,
      preview: null,
      shadowed: false,
    });
  });

  it('ordena las eclipsadas después de las que ganan', () => {
    const ordenadas = ordenarVariables([
      variable({ key: 'zeta' }),
      variable({ key: 'alfa', shadowed: true }),
      variable({ key: 'beta' }),
    ]);
    expect(ordenadas.map((v) => v.key)).toEqual(['beta', 'zeta', 'alfa']);
  });

  it('compone la ruta escapando el identificador', () => {
    expect(rutaDeVariables('a/b')).toBe('/collections/a%2Fb/variables');
  });
});

// ---------------------------------------------------------------------------
// El composable
// ---------------------------------------------------------------------------

/** Monta el composable dentro de un componente, que es donde `watch` vive. */
function montarComposable(idInicial: string | undefined) {
  const id = ref<string | undefined>(idInicial);
  let estado: ReturnType<typeof usarVariablesDeColeccion> | null = null;

  const envoltorio = mount(
    defineComponent({
      setup() {
        estado = usarVariablesDeColeccion(() => id.value);
        return () => h('div');
      },
    }),
  );

  if (estado === null) throw new Error('El composable no llegó a inicializarse.');
  return { id, estado: estado as ReturnType<typeof usarVariablesDeColeccion>, envoltorio };
}

describe('usarVariablesDeColeccion', () => {
  it('no llama a la API cuando todavía no se conoce la colección', async () => {
    const llamadas = instalarApi(() => ({ estado: 200, cuerpo: { items: [] } }));
    const { estado } = montarComposable(undefined);
    await flushPromises();

    expect(llamadas).toHaveLength(0);
    expect(estado.variables.value).toEqual([]);
    expect(estado.cargando.value).toBe(false);
    expect(estado.error.value).toBeNull();
  });

  it('carga al conocerse la colección y recarga al cambiar', async () => {
    const llamadas = instalarApi((llamada) => ({
      estado: 200,
      cuerpo: { items: [{ key: llamada.url.includes('col-1') ? 'uno' : 'dos' }] },
    }));

    const { id, estado } = montarComposable(undefined);
    await flushPromises();
    expect(llamadas).toHaveLength(0);

    id.value = 'col-1';
    await flushPromises();
    expect(estado.variables.value.map((v) => v.key)).toEqual(['uno']);

    id.value = 'col-2';
    await flushPromises();
    expect(estado.variables.value.map((v) => v.key)).toEqual(['dos']);
    expect(llamadas).toHaveLength(2);
  });

  it('se degrada en silencio si la ruta todavía no existe (404/501)', async () => {
    instalarApi(() => ({ estado: 404, cuerpo: { error: 'no_encontrado', mensaje: 'No existe.' } }));

    const { estado } = montarComposable('col-1');
    await flushPromises();

    expect(estado.disponible.value).toBe(false);
    // Sin cartel rojo: un hueco conocido del contrato no es un fallo pasajero.
    expect(estado.error.value).toBeNull();
    expect(estado.variables.value).toEqual([]);
  });

  it('un error de verdad sí se cuenta', async () => {
    instalarApi(() => ({
      estado: 403,
      cuerpo: { error: 'sin_permiso', mensaje: 'No tienes acceso a este workspace.' },
    }));

    const { estado } = montarComposable('col-1');
    await flushPromises();

    expect(estado.disponible.value).toBe(true);
    expect(estado.error.value).toBe('No tienes acceso a este workspace.');
  });
});

// ---------------------------------------------------------------------------
// El widget
// ---------------------------------------------------------------------------

describe('CampoConVariables', () => {
  it('abre la lista al teclear las dos llaves y filtra con lo que se escribe detrás', async () => {
    const { envoltorio, elemento } = montarCampo({
      variables: [
        variable({ key: 'base_url' }),
        variable({ key: 'base_path' }),
        variable({ key: 'sesión_id' }),
      ],
    });

    expect(envoltorio.find('[data-prueba="sugerencias-de-variables"]').exists()).toBe(false);
    expect(elemento.getAttribute('aria-expanded')).toBe('false');

    await teclear(elemento, `https://${APERTURA}`);

    const lista = envoltorio.find('[data-prueba="sugerencias-de-variables"]');
    expect(lista.exists()).toBe(true);
    expect(lista.attributes('role')).toBe('listbox');
    expect(elemento.getAttribute('aria-expanded')).toBe('true');
    expect(elemento.getAttribute('role')).toBe('combobox');
    expect(elemento.getAttribute('aria-autocomplete')).toBe('list');
    expect(elemento.getAttribute('aria-controls')).toBe(lista.attributes('id'));
    expect(envoltorio.findAll('[data-prueba="sugerencia"]')).toHaveLength(3);

    // Mayúsculas: el filtro no distingue.
    await teclear(elemento, `https://${APERTURA}BASE`);
    expect(
      envoltorio.findAll('[data-prueba="sugerencia"]').map((o) => o.text()),
    ).toEqual([conLlaves('base_url'), conLlaves('base_path')].map((t) => expect.stringContaining(t)));

    // Acentos: tampoco.
    await teclear(elemento, `https://${APERTURA}sesion`);
    const unaSola = envoltorio.findAll('[data-prueba="sugerencia"]');
    expect(unaSola).toHaveLength(1);
    expect(unaSola[0]?.text()).toContain(conLlaves('sesión_id'));

    // Sin coincidencias no queda un hueco mudo: hay texto de vacío.
    await teclear(elemento, `https://${APERTURA}nada_de_nada`);
    expect(envoltorio.findAll('[data-prueba="sugerencia"]')).toHaveLength(0);
    expect(envoltorio.find('[data-prueba="sugerencias-vacio"]').exists()).toBe(true);

    envoltorio.unmount();
  });

  it('cierra la lista cuando se cierran las llaves', async () => {
    const { envoltorio, elemento } = montarCampo({ variables: [variable({ key: 'base_url' })] });

    await teclear(elemento, APERTURA);
    expect(envoltorio.find('[data-prueba="sugerencias-de-variables"]').exists()).toBe(true);

    await teclear(elemento, conLlaves('base_url'));
    expect(envoltorio.find('[data-prueba="sugerencias-de-variables"]').exists()).toBe(false);

    envoltorio.unmount();
  });

  it('ArrowDown y Enter insertan la variable entre dobles llaves', async () => {
    const { envoltorio, control, elemento, sucesos } = montarCampo({
      variables: [variable({ key: 'base_url' }), variable({ key: 'base_path' })],
    });

    await teclear(elemento, `https://${APERTURA}ba`);
    const opciones = envoltorio.findAll('[data-prueba="sugerencia"]');
    expect(opciones).toHaveLength(2);
    expect(opciones[0]?.attributes('aria-selected')).toBe('true');
    expect(elemento.getAttribute('aria-activedescendant')).toBe(opciones[0]?.attributes('id'));

    await control.trigger('keydown', { key: 'ArrowDown' });
    const tras = envoltorio.findAll('[data-prueba="sugerencia"]');
    expect(tras[1]?.attributes('aria-selected')).toBe('true');
    expect(elemento.getAttribute('aria-activedescendant')).toBe(tras[1]?.attributes('id'));

    await control.trigger('keydown', { key: 'Enter' });
    await flushPromises();

    // Sustituye DESDE las llaves de apertura hasta el cursor, no todo el texto.
    expect(sucesos.modelo.at(-1)).toBe(`https://${conLlaves('base_path')}`);
    // La lista se cierra al elegir y el cursor queda detrás del cierre.
    expect(envoltorio.find('[data-prueba="sugerencias-de-variables"]').exists()).toBe(false);
    expect(elemento.value).toBe(`https://${conLlaves('base_path')}`);
    expect(elemento.selectionStart).toBe(elemento.value.length);
    // `Enter` con la lista abierta elige: NO envía.
    expect(sucesos.envios).toBe(0);

    envoltorio.unmount();
  });

  it('al elegir con el ratón inserta igual, sin perder el foco', async () => {
    const { envoltorio, elemento, sucesos } = montarCampo({
      variables: [variable({ key: 'base_url' })],
    });

    await teclear(elemento, `${APERTURA}base`);
    await envoltorio.find('[data-prueba="sugerencia"]').trigger('mousedown');
    await flushPromises();

    expect(sucesos.modelo.at(-1)).toBe(conLlaves('base_url'));
    expect(sucesos.desenfoques).toBe(0);

    envoltorio.unmount();
  });

  it('ArrowUp desde la primera opción da la vuelta a la última', async () => {
    const { envoltorio, control, elemento } = montarCampo({
      variables: [variable({ key: 'uno' }), variable({ key: 'dos' }), variable({ key: 'tres' })],
    });

    await teclear(elemento, APERTURA);
    await control.trigger('keydown', { key: 'ArrowUp' });

    const opciones = envoltorio.findAll('[data-prueba="sugerencia"]');
    expect(opciones[2]?.attributes('aria-selected')).toBe('true');

    envoltorio.unmount();
  });

  it('Esc cierra sin borrar lo escrito y sin dejar que el evento se propague', async () => {
    const { envoltorio, elemento, anfitrion, sucesos } = montarCampo({
      variables: [variable({ key: 'base_url' })],
    });

    await teclear(elemento, `https://${APERTURA}ba`);
    expect(envoltorio.find('[data-prueba="sugerencias-de-variables"]').exists()).toBe(true);
    const emitidosAntes = sucesos.modelo.length;

    let llegoAlAncestro = false;
    anfitrion.addEventListener('keydown', () => {
      llegoAlAncestro = true;
    });

    const evento = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    elemento.dispatchEvent(evento);
    await flushPromises();

    expect(envoltorio.find('[data-prueba="sugerencias-de-variables"]').exists()).toBe(false);
    // Lo escrito sigue ahí: `Esc` cierra la lista, no deshace la escritura.
    expect(elemento.value).toBe(`https://${APERTURA}ba`);
    expect(sucesos.modelo.length).toBe(emitidosAntes);
    expect(llegoAlAncestro).toBe(false);
    expect(evento.defaultPrevented).toBe(true);

    envoltorio.unmount();
  });

  it('Tab cierra la lista y Enter con la lista cerrada envía', async () => {
    const { envoltorio, control, elemento, sucesos } = montarCampo({
      variables: [variable({ key: 'base_url' })],
    });

    await teclear(elemento, APERTURA);
    await control.trigger('keydown', { key: 'Tab' });
    expect(envoltorio.find('[data-prueba="sugerencias-de-variables"]').exists()).toBe(false);

    await control.trigger('keydown', { key: 'Enter' });
    expect(sucesos.envios).toBe(1);

    envoltorio.unmount();
  });

  it('el blur cierra la lista y avisa para el guardado inmediato', async () => {
    const { envoltorio, control, elemento, sucesos } = montarCampo({
      variables: [variable({ key: 'base_url' })],
    });

    await teclear(elemento, APERTURA);
    await control.trigger('blur');

    expect(envoltorio.find('[data-prueba="sugerencias-de-variables"]').exists()).toBe(false);
    expect(sucesos.desenfoques).toBe(1);

    envoltorio.unmount();
  });

  it('en multilínea pinta un textarea, autocompleta y Enter no envía', async () => {
    const { envoltorio, control, elemento, sucesos } = montarCampo({
      etiqueta: 'Cuerpo',
      multilinea: true,
      filas: 4,
      variables: [variable({ key: 'base_url' })],
    });

    expect(control.exists()).toBe(true);
    expect(control.attributes('rows')).toBe('4');
    expect(control.attributes('role')).toBe('combobox');
    expect(control.attributes('aria-label')).toBe('Cuerpo');

    await teclear(elemento, `{"url": "${APERTURA}base`);
    expect(envoltorio.findAll('[data-prueba="sugerencia"]')).toHaveLength(1);

    await control.trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(sucesos.modelo.at(-1)).toBe(`{"url": "${conLlaves('base_url')}`);
    // En multilínea `Enter` jamás envía: es un salto de línea.
    expect(sucesos.envios).toBe(0);

    await control.trigger('keydown', { key: 'Enter' });
    expect(sucesos.envios).toBe(0);

    envoltorio.unmount();
  });

  it('enseña la espera con la marca mientras cargan las variables', async () => {
    const { envoltorio, elemento } = montarCampo({ variables: [], cargandoVariables: true });

    await teclear(elemento, APERTURA);

    const lista = envoltorio.find('[data-prueba="sugerencias-de-variables"]');
    expect(lista.exists()).toBe(true);
    expect(lista.find('.ceiba-spinner').exists()).toBe(true);
    expect(lista.text()).toContain('Cargando variables');

    envoltorio.unmount();
  });
});

// ---------------------------------------------------------------------------
// La lista: marcas y frontera de secretos
// ---------------------------------------------------------------------------

function montarLista(sugerencias: readonly VariableDeColeccion[]) {
  return mount(ListaDeSugerencias, {
    props: {
      sugerencias,
      indiceActivo: 0,
      idLista: 'lista-1',
      prefijoDeOpcion: 'opcion',
    },
  });
}

describe('ListaDeSugerencias', () => {
  it('marca la secreta y NO pinta su valor ni aunque se lo fuercen', () => {
    const envoltorio = montarLista([
      // `preview` con valor junto a `isSecret` es exactamente lo que el §2.3
      // prohíbe. Aquí se fuerza a propósito: si alguna vez se cuela por otro
      // camino, el componente sigue sin pintarlo.
      { ...variable({ key: 'api_token' }), isSecret: true, preview: 'sk-live-FILTRADO' },
    ]);

    const opcion = envoltorio.find('[data-prueba="sugerencia"]');
    expect(opcion.exists()).toBe(true);
    expect(opcion.text()).toContain(conLlaves('api_token'));
    expect(opcion.find('[data-prueba="marca-secreta"]').exists()).toBe(true);
    expect(opcion.find('[data-prueba="marca-secreta"]').text()).toBe('secreta');
    expect(opcion.find('[data-prueba="sugerencia-vistazo"]').exists()).toBe(false);
    expect(envoltorio.html()).not.toContain('FILTRADO');

    envoltorio.unmount();
  });

  it('marca la eclipsada y la desactivada, y sí enseña el vistazo de una normal', () => {
    const envoltorio = montarLista([
      variable({ key: 'base_url', preview: 'https://api.ejemplo.com' }),
      variable({ key: 'eclipsada', shadowed: true, scope: 'workspace' }),
      variable({ key: 'apagada', isEnabled: false }),
    ]);

    const opciones = envoltorio.findAll('[data-prueba="sugerencia"]');
    expect(opciones).toHaveLength(3);

    expect(opciones[0]?.find('[data-prueba="sugerencia-vistazo"]').text()).toBe(
      'https://api.ejemplo.com',
    );
    expect(opciones[0]?.find('[data-prueba="marca-eclipsada"]').exists()).toBe(false);

    expect(opciones[1]?.find('[data-prueba="marca-eclipsada"]').text()).toBe('eclipsada');
    expect(opciones[2]?.find('[data-prueba="marca-desactivada"]').text()).toBe('desactivada');

    envoltorio.unmount();
  });

  it('cada opción es un role=option con id único y aria-selected', () => {
    const envoltorio = montarLista([variable({ key: 'uno' }), variable({ key: 'dos' })]);

    const opciones = envoltorio.findAll('[data-prueba="sugerencia"]');
    expect(opciones.map((o) => o.attributes('role'))).toEqual(['option', 'option']);
    expect(opciones.map((o) => o.attributes('id'))).toEqual(['opcion-0', 'opcion-1']);
    expect(opciones.map((o) => o.attributes('aria-selected'))).toEqual(['true', 'false']);

    envoltorio.unmount();
  });

  it('el vacío tiene texto: nunca un hueco mudo', () => {
    const envoltorio = mount(ListaDeSugerencias, {
      props: {
        sugerencias: [],
        indiceActivo: -1,
        idLista: 'lista-1',
        prefijoDeOpcion: 'opcion',
        consulta: 'zzz',
      },
    });

    expect(envoltorio.find('[data-prueba="sugerencias-vacio"]').text()).toContain('zzz');
    envoltorio.unmount();
  });
});
