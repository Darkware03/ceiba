import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { mount } from '@vue/test-utils';
import {
  MODOS_DE_CUERPO,
  camposActivosDeCuerpo,
  esModoCrudo,
  esModoDeFormulario,
  limitacionesDeEnvioDelCuerpo,
  serializarUrlencoded,
  tipoDeContenidoDe,
} from '@/api/ejecucion';
import type { CuerpoDeSolicitud } from '@/api/ejecucion';
import {
  LIMITE_DE_FICHERO_BYTES,
  MODOS_DE_CUERPO_DEL_ESQUEMA,
  normalizarCamposDeCuerpo,
  normalizarFichero,
  normalizarPeticion,
  subirFichero,
} from '@/api/peticiones';
import { usarAlmacenDeConstructor } from '@/stores/constructor';
import { recordarTestigoCsrf } from '@/api/csrf';
import EditorDeCuerpo from '@/components/solicitud/EditorDeCuerpo.vue';
import SelectorDeFichero from '@/components/solicitud/SelectorDeFichero.vue';

/**
 * FASE 7 · ÁMBITO C — P5: form-data y binario en el cuerpo de la petición.
 *
 * El cliente pidió «en el cuerpo de la petición me debe permitir agregar
 * formdata, binario». Lo que estas pruebas vigilan, además de que exista:
 *
 *  1. **Que lo que NO se pueda enviar se declare.** Un fichero vive en el
 *     servidor, no en la pestaña: el modo directo del navegador no puede
 *     componer ese cuerpo. Decirlo es el requisito; fabricar una equivalencia
 *     falsa es lo que el §2.4 del `BRIEF-FASE6` prohíbe.
 *  2. **Que la forma que se guarda respete los CHECK del esquema.**
 *     `ck_body_mode_shape` exige `raw_content IS NULL` en los modos de
 *     formulario y en el binario; `ck_bodyfield_xor` permite una sola fuente
 *     de valor por campo. Si la interfaz manda otra cosa, el usuario recibe un
 *     500 del CHECK que no puede explicar.
 *  3. **Que al LEER se toleren los diez valores del enum**, aunque al escribir
 *     no se ofrezcan los diez. Es la decisión de la fase 6 que el §3.C.3 manda
 *     mantener.
 */

function cuerpo(parcial: Partial<CuerpoDeSolicitud> = {}): CuerpoDeSolicitud {
  return { modo: 'none', contenido: '', tipoContenido: null, campos: [], ficheroBinario: null, ...parcial };
}

function campo(
  nombre: string,
  valor: string,
  extra: Partial<{ tipo: 'texto' | 'fichero'; activo: boolean; fichero: { id: string } }> = {},
) {
  return {
    id: `c-${nombre}`,
    nombre,
    tipo: extra.tipo ?? ('texto' as const),
    valor,
    fichero:
      extra.fichero === undefined
        ? null
        : { id: extra.fichero.id, fileName: 'f.pdf', contentType: 'application/pdf', sizeBytes: 10 },
    activo: extra.activo ?? true,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

// ---------------------------------------------------------------------------
// Vocabulario
// ---------------------------------------------------------------------------

describe('P5 · vocabulario de modos', () => {
  it('la interfaz ofrece los modos nuevos y el esquema sigue teniendo diez', () => {
    expect([...MODOS_DE_CUERPO]).toEqual([
      'none',
      'raw',
      'json',
      'form_urlencoded',
      'multipart_form_data',
      'binary_file',
    ]);
    // Contados en `prisma/schema/01-enums.prisma`, no copiados de un brief.
    expect(MODOS_DE_CUERPO_DEL_ESQUEMA).toHaveLength(10);
    expect(MODOS_DE_CUERPO_DEL_ESQUEMA).toContain('binary_file');
    expect(MODOS_DE_CUERPO_DEL_ESQUEMA).toContain('custom');
  });

  it('clasifica los modos por cómo se componen', () => {
    expect(esModoDeFormulario('multipart_form_data')).toBe(true);
    expect(esModoDeFormulario('form_urlencoded')).toBe(true);
    expect(esModoDeFormulario('binary_file')).toBe(false);
    expect(esModoCrudo('raw')).toBe(true);
    expect(esModoCrudo('json')).toBe(true);
    expect(esModoCrudo('multipart_form_data')).toBe(false);
  });

  it('deriva el tipo de contenido de cada modo', () => {
    expect(tipoDeContenidoDe(cuerpo({ modo: 'none' }))).toBeNull();
    expect(tipoDeContenidoDe(cuerpo({ modo: 'json' }))).toBe('application/json');
    expect(tipoDeContenidoDe(cuerpo({ modo: 'form_urlencoded' }))).toBe(
      'application/x-www-form-urlencoded',
    );
    // Sin `boundary`: lo pone quien compone los bytes de verdad, el motor.
    expect(tipoDeContenidoDe(cuerpo({ modo: 'multipart_form_data' }))).toBe('multipart/form-data');
    expect(
      tipoDeContenidoDe(
        cuerpo({
          modo: 'binary_file',
          ficheroBinario: { id: 'f1', fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 1 },
        }),
      ),
    ).toBe('application/pdf');
    expect(tipoDeContenidoDe(cuerpo({ modo: 'binary_file' }))).toBe('application/octet-stream');
  });
});

// ---------------------------------------------------------------------------
// Serialización y limitaciones declaradas
// ---------------------------------------------------------------------------

describe('P5 · serialización y lo que NO se puede enviar', () => {
  it('urlencoded serializa sólo los campos de texto activos y con nombre', () => {
    const texto = serializarUrlencoded(
      cuerpo({
        modo: 'form_urlencoded',
        campos: [
          campo('titulo', 'hola mundo'),
          campo('vacio', 'x', { activo: false }),
          campo('', 'sin nombre'),
          campo('adjunto', '', { tipo: 'fichero', fichero: { id: 'f1' } }),
          campo('raro', 'a&b=c'),
        ],
      }),
    );

    expect(texto).toBe('titulo=hola%20mundo&raro=a%26b%3Dc');
  });

  it('un fichero en un urlencoded se declara, no se finge', () => {
    const notas = limitacionesDeEnvioDelCuerpo(
      cuerpo({
        modo: 'form_urlencoded',
        campos: [campo('adjunto', '', { tipo: 'fichero', fichero: { id: 'f1' } })],
      }),
      'api',
    );

    expect(notas).toHaveLength(1);
    expect(notas[0]).toContain('adjunto');
    expect(notas[0]).toContain('no puede llevar ficheros');
  });

  it('el modo directo del navegador declara que no puede componer multipart', () => {
    const notas = limitacionesDeEnvioDelCuerpo(
      cuerpo({ modo: 'multipart_form_data', campos: [campo('a', 'b')] }),
      'navegador',
    );
    expect(notas.join(' ')).toContain('no tiene sus bytes');

    // Por el motor sí: no se avisa de algo que no pasa.
    const porElMotor = limitacionesDeEnvioDelCuerpo(
      cuerpo({ modo: 'multipart_form_data', campos: [campo('a', 'b')] }),
      'api',
    );
    expect(porElMotor).toHaveLength(0);
  });

  it('un binario sin fichero elegido se dice en voz alta', () => {
    const notas = limitacionesDeEnvioDelCuerpo(cuerpo({ modo: 'binary_file' }), 'api');
    expect(notas.join(' ')).toContain('no tiene ningún fichero seleccionado');
  });

  it('sólo cuentan los campos activos y con nombre', () => {
    const activos = camposActivosDeCuerpo(
      cuerpo({
        modo: 'multipart_form_data',
        campos: [campo('a', '1'), campo('b', '2', { activo: false }), campo('  ', '3')],
      }),
    );
    expect(activos.map((c) => c.nombre)).toEqual(['a']);
  });
});

// ---------------------------------------------------------------------------
// El almacén y la forma que se guarda
// ---------------------------------------------------------------------------

describe('P5 · almacén y forma guardada', () => {
  it('entrar en un modo de formulario deja una fila lista para escribir', () => {
    const almacen = usarAlmacenDeConstructor();
    almacen.establecerModoDeCuerpo('multipart_form_data');
    expect(almacen.camposDelCuerpo).toHaveLength(1);
    expect(almacen.camposDelCuerpo[0]?.tipo).toBe('texto');
  });

  it('quitar la última fila deja siempre una vacía donde escribir', () => {
    const almacen = usarAlmacenDeConstructor();
    almacen.establecerModoDeCuerpo('form_urlencoded');
    const id = almacen.camposDelCuerpo[0]?.id ?? '';
    almacen.quitarCampoDeCuerpo(id);
    expect(almacen.camposDelCuerpo).toHaveLength(1);
  });

  it('poner un fichero en una fila la convierte en fila de fichero (XOR del esquema)', () => {
    const almacen = usarAlmacenDeConstructor();
    almacen.establecerModoDeCuerpo('multipart_form_data');
    const id = almacen.camposDelCuerpo[0]?.id ?? '';
    almacen.actualizarCampoDeCuerpo(id, { nombre: 'adjunto', valor: 'texto previo' });
    almacen.establecerFicheroDeCampo(id, {
      id: 'f-7',
      fileName: 'informe.pdf',
      contentType: 'application/pdf',
      sizeBytes: 2048,
    });

    const fila = almacen.camposDelCuerpo[0];
    expect(fila?.tipo).toBe('fichero');
    expect(fila?.fichero?.id).toBe('f-7');
    // El texto no se borra (cambiar de idea no debe costar reescribirlo) pero
    // ya no es la fuente del valor: lo decide `tipo`.
    expect(fila?.valor).toBe('texto previo');
  });

  it('el PATCH de un multipart manda bodyFields y body null (ck_body_mode_shape)', () => {
    const almacen = usarAlmacenDeConstructor();
    almacen.cargarDesdePeticionGuardada({
      requestId: 'req-1',
      collectionId: 'col-1',
      name: 'Subir informe',
      method: 'POST',
      url: 'https://api.ejemplo.com/v1/subida',
      bodyType: 'multipart_form_data',
      bodyFields: [
        { key: 'titulo', kind: 'text', value: 'hola', enabled: true },
        { key: 'adjunto', kind: 'file', fileId: 'f-1', enabled: true },
      ],
    });

    const entrada = almacen.entradaDeGuardado() as Record<string, unknown>;

    expect(entrada.bodyType).toBe('multipart_form_data');
    expect(entrada.body).toBeNull();
    expect(entrada.bodyFields).toEqual([
      { key: 'titulo', kind: 'text', value: 'hola', enabled: true },
      { key: 'adjunto', kind: 'file', fileId: 'f-1', enabled: true },
    ]);
    // Ninguna fila lleva las dos fuentes de valor a la vez.
    for (const fila of entrada.bodyFields as Array<Record<string, unknown>>) {
      expect('value' in fila && 'fileId' in fila).toBe(false);
    }
  });

  it('el PATCH de un binario manda binaryFileId y body null', () => {
    const almacen = usarAlmacenDeConstructor();
    almacen.cargarDesdePeticionGuardada({
      requestId: 'req-1',
      collectionId: 'col-1',
      name: 'Subir fichero',
      method: 'PUT',
      url: 'https://api.ejemplo.com/v1/fichero',
      bodyType: 'binary_file',
      binaryFile: { id: 'f-9', fileName: 'a.pdf', contentType: 'application/pdf', sizeBytes: 1 },
    });

    const entrada = almacen.entradaDeGuardado() as Record<string, unknown>;
    expect(entrada.bodyType).toBe('binary_file');
    expect(entrada.binaryFileId).toBe('f-9');
    expect(entrada.body).toBeNull();
    expect(entrada.bodyFields).toBeUndefined();
  });

  it('el texto crudo se guarda con el body_mode que implica su tipo de contenido', () => {
    const almacen = usarAlmacenDeConstructor();
    almacen.cargarDesdePeticionGuardada({
      requestId: 'req-1',
      collectionId: 'col-1',
      name: 'XML',
      method: 'POST',
      url: 'https://api.ejemplo.com',
      bodyType: 'raw_xml',
      body: '<a/>',
    });

    const entrada = almacen.entradaDeGuardado() as Record<string, unknown>;
    // `raw` + application/xml ⇒ `raw_xml`, no `raw_text`: guardar todo como
    // texto plano perdería lo que el usuario sí eligió.
    expect(entrada.bodyType).toBe('raw_xml');
    expect(entrada.body).toBe('<a/>');
  });
});

// ---------------------------------------------------------------------------
// Lectura: los diez valores del enum y los metadatos de fichero
// ---------------------------------------------------------------------------

describe('P5 · lectura tolerante', () => {
  it('normaliza bodyFields, binaryFile y lockVersion del §2.1', () => {
    const peticion = normalizarPeticion({
      id: 'req-1',
      collectionId: 'col-1',
      name: 'X',
      method: 'POST',
      url: 'u',
      bodyType: 'multipart_form_data',
      bodyFields: [
        { key: 'a', kind: 'text', value: '1', enabled: true },
        { key: 'b', kind: 'file', fileId: 'f-1', contentType: 'application/pdf' },
        { noTieneClave: true },
      ],
      binaryFile: { id: 'f-2', fileName: 'x.bin', contentType: null, sizeBytes: 7 },
      lockVersion: 5,
    });

    expect(peticion.bodyFields).toHaveLength(2);
    expect(peticion.bodyFields[0]).toMatchObject({ key: 'a', kind: 'text', value: '1' });
    // Ausente ⇒ activo: un campo guardado sin la marca es un campo que cuenta.
    expect(peticion.bodyFields[1]).toMatchObject({ key: 'b', kind: 'file', fileId: 'f-1', enabled: true });
    expect(peticion.binaryFile?.sizeBytes).toBe(7);
    expect(peticion.lockVersion).toBe(5);
  });

  it('al leer, el XOR lo decide `kind` aunque lleguen las dos fuentes', () => {
    const campos = normalizarCamposDeCuerpo([
      { key: 'a', kind: 'file', fileId: 'f-1', value: 'no debería contar', enabled: true },
    ]);
    expect(campos[0]).toMatchObject({ kind: 'file', fileId: 'f-1' });
    expect(campos[0]).not.toHaveProperty('value');
  });

  it('un fichero sin id no es un fichero', () => {
    expect(normalizarFichero({ fileName: 'x' })).toBeNull();
    expect(normalizarFichero(null)).toBeNull();
    expect(normalizarFichero({ id: 'f', fileName: 'x' })?.sizeBytes).toBeNull();
  });

  it('un body_mode desconocido no revienta la lectura', () => {
    expect(normalizarPeticion({ bodyType: 'inventado' }).bodyType).toBe('none');
    expect(normalizarPeticion({ bodyType: 'custom' }).bodyType).toBe('custom');
  });
});

// ---------------------------------------------------------------------------
// Subida de ficheros (§2.2)
// ---------------------------------------------------------------------------

describe('P5 · subida de ficheros', () => {
  const fetchOriginal = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
  });

  it('sube por multipart con sesión y testigo CSRF, y devuelve los metadatos', async () => {
    recordarTestigoCsrf('nonce.firma');
    const llamadas: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (entrada: unknown, init?: RequestInit) => {
      llamadas.push({ url: String(entrada), init: init ?? {} });
      return {
        ok: true,
        status: 201,
        headers: { get: () => 'application/json' },
        json: async () => ({
          fichero: {
            id: 'f-1',
            fileName: 'informe.pdf',
            contentType: 'application/pdf',
            sizeBytes: 1234,
          },
        }),
      } as unknown as Response;
    }) as typeof globalThis.fetch;

    const subido = await subirFichero(
      'ws-1',
      new File(['contenido'], 'informe.pdf', { type: 'application/pdf' }),
      'request_body_binary',
    );

    expect(subido).toMatchObject({ id: 'f-1', fileName: 'informe.pdf', sizeBytes: 1234 });
    const llamada = llamadas[0];
    expect(llamada?.url).toBe('/api/v1/workspaces/ws-1/files');
    expect(llamada?.init.method).toBe('POST');
    // C-31: sin esto la cookie HttpOnly de sesión no viaja.
    expect(llamada?.init.credentials).toBe('include');
    expect((llamada?.init.headers as Record<string, string>)['x-ceiba-csrf']).toBe('nonce.firma');
    // El navegador tiene que poner él el Content-Type con su boundary.
    expect((llamada?.init.headers as Record<string, string>)['content-type']).toBeUndefined();
    expect(llamada?.init.body).toBeInstanceOf(FormData);
    expect((llamada?.init.body as FormData).get('purpose')).toBe('request_body_binary');
  });

  it('un fichero por encima del límite se rechaza sin gastar la subida', async () => {
    let llamado = false;
    globalThis.fetch = (async () => {
      llamado = true;
      return {} as Response;
    }) as typeof globalThis.fetch;

    const enorme = new File([new Uint8Array(10)], 'enorme.bin');
    Object.defineProperty(enorme, 'size', { value: LIMITE_DE_FICHERO_BYTES + 1 });

    await expect(subirFichero('ws-1', enorme)).rejects.toThrow(/10 MiB/u);
    expect(llamado).toBe(false);
  });

  it('un error del servidor se traduce al vocabulario de la interfaz', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 413,
        headers: { get: () => 'application/json' },
        json: async () => ({ error: 'demasiado_grande', mensaje: 'El fichero es enorme.' }),
      }) as unknown as Response) as typeof globalThis.fetch;

    await expect(subirFichero('ws-1', new File(['x'], 'x.bin'))).rejects.toThrow(
      'El fichero es enorme.',
    );
  });
});

// ---------------------------------------------------------------------------
// Interfaz
// ---------------------------------------------------------------------------

describe('P5 · interfaz del cuerpo', () => {
  it('ofrece los seis modos y ninguno más', () => {
    const editor = mount(EditorDeCuerpo, {
      props: { modo: 'none', contenido: '', tipoContenido: null, metodo: 'POST' },
    });

    const pastillas = editor
      .findAll('[role="group"][aria-label="Modo del cuerpo"] button')
      .map((b) => b.text());
    expect(pastillas).toEqual([
      'Sin cuerpo',
      'Texto',
      'JSON',
      'Formulario',
      'Multiparte',
      'Binario',
    ]);
    editor.unmount();
  });

  it('en urlencoded el conmutador de fichero está inhabilitado y explicado', () => {
    const editor = mount(EditorDeCuerpo, {
      props: {
        modo: 'form_urlencoded',
        contenido: '',
        tipoContenido: null,
        metodo: 'POST',
        campos: [campo('a', '1')],
      },
    });

    const selector = editor.get('[data-prueba="campo-de-cuerpo"] select');
    expect(selector.attributes('disabled')).toBeDefined();
    expect(selector.attributes('title')).toContain('no puede llevar ficheros');
    editor.unmount();
  });

  it('en multiparte sí se puede elegir fichero', () => {
    const editor = mount(EditorDeCuerpo, {
      props: {
        modo: 'multipart_form_data',
        contenido: '',
        tipoContenido: null,
        metodo: 'POST',
        campos: [campo('a', '1')],
      },
    });

    const selector = editor.get('[data-prueba="campo-de-cuerpo"] select');
    expect(selector.attributes('disabled')).toBeUndefined();
    editor.unmount();
  });

  it('las limitaciones del cuerpo se pintan, no se callan', () => {
    const editor = mount(EditorDeCuerpo, {
      props: {
        modo: 'binary_file',
        contenido: '',
        tipoContenido: null,
        metodo: 'PUT',
        limitaciones: ['El cuerpo binario no tiene ningún fichero seleccionado todavía.'],
      },
    });

    expect(editor.text()).toContain('no se enviará entero');
    expect(editor.text()).toContain('no tiene ningún fichero seleccionado');
    editor.unmount();
  });

  it('sin workspace resuelto, el selector de fichero se inhabilita y dice por qué', () => {
    const selector = mount(SelectorDeFichero, {
      props: { fichero: null, workspaceId: null },
    });

    expect(selector.get('[data-prueba="elegir-fichero"]').attributes('disabled')).toBeDefined();
    expect(selector.text()).toContain('no ha podido resolver a qué workspace');
    selector.unmount();
  });

  it('con un fichero elegido enseña nombre, tipo y tamaño', () => {
    const selector = mount(SelectorDeFichero, {
      props: {
        workspaceId: 'ws-1',
        fichero: {
          id: 'f-1',
          fileName: 'informe.pdf',
          contentType: 'application/pdf',
          sizeBytes: 2048,
        },
      },
    });

    const texto = selector.get('[data-prueba="fichero-elegido"]').text();
    expect(texto).toContain('informe.pdf');
    expect(texto).toContain('application/pdf');
    expect(texto).toContain('2,0 kB');
    selector.unmount();
  });
});
