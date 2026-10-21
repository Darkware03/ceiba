import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PREFIJO_DE_SECRETO,
  generarCurl,
  type PeticionParaCurl,
} from '../src/modules/request/curl.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * FASE 7 · §3.3 — cURL FIEL PARA LOS MODOS NUEVOS.
 *
 * **Unitario puro.** `T-LEAK-03 (c)` exige verificar la tabla de escape «por
 * análisis del texto generado, y no ejecutando una shell»: aquí no se ejecuta
 * ninguna shell, ni se abre ningún fichero, ni se toca la red.
 *
 * Las cuatro reglas del `BRIEF-FASE6` §2 siguen mandando y se vuelven a
 * afirmar sobre los modos nuevos:
 *   1. los secretos NO se materializan;
 *   2. las `{{var}}` se conservan;
 *   3. el comando se puede pegar en una terminal sin romperse;
 *   4. lo que no se puede representar se declara en `advertencias[]`.
 * ════════════════════════════════════════════════════════════════════════════
 */

const CENTINELA = 'SENTINEL-c0ffee';

/**
 * Tokenizador POSIX mínimo.
 *
 * Contar comillas no sirve: el escape `'\''` aporta TRES comillas y cambia la
 * paridad. Lo que hay que comprobar es que el comando **se analiza** como una
 * lista de palabras y que cada valor llega entero al programa. Esto es
 * exactamente lo que pide `T-LEAK-03 (c)`: análisis del texto generado, **sin
 * ejecutar una shell**. Aquí no se ejecuta nada: se lee.
 */
function tokenizarPosix(linea: string): string[] {
  const tokens: string[] = [];
  let actual = '';
  let hayToken = false;
  let simple = false;
  let doble = false;
  for (let i = 0; i < linea.length; i += 1) {
    const c = linea[i] as string;
    if (simple) {
      if (c === "'") simple = false;
      else actual += c;
      continue;
    }
    if (doble) {
      if (c === '\\' && i + 1 < linea.length) {
        i += 1;
        actual += linea[i] as string;
      } else if (c === '"') doble = false;
      else actual += c;
      continue;
    }
    if (c === "'") {
      simple = true;
      hayToken = true;
      continue;
    }
    if (c === '"') {
      doble = true;
      hayToken = true;
      continue;
    }
    if (c === '\\' && i + 1 < linea.length) {
      i += 1;
      actual += linea[i] as string;
      hayToken = true;
      continue;
    }
    if (c === ' ') {
      if (hayToken) {
        tokens.push(actual);
        actual = '';
        hayToken = false;
      }
      continue;
    }
    actual += c;
    hayToken = true;
  }
  if (simple || doble) throw new Error(`comillas sin cerrar en: ${linea}`);
  if (hayToken) tokens.push(actual);
  return tokens;
}

function peticionBase(parcial: Partial<PeticionParaCurl> = {}): PeticionParaCurl {
  return {
    nombre: 'Petición',
    metodo: 'POST',
    metodoPersonalizado: null,
    urlPlantilla: 'https://api.example.com/v1/subir',
    cabeceras: [],
    parametros: [],
    modoCuerpo: 'none',
    cuerpoCrudo: null,
    contentTypeDelCuerpo: null,
    variablesGraphql: null,
    camposDeFormulario: [],
    tieneFicheroBinario: false,
    nombreDelFicheroBinario: null,
    timeoutMs: null,
    politicaDeRedireccion: null,
    maxRedirecciones: null,
    verificarTls: null,
    tieneCertificadoDeCliente: false,
    modoAutenticacion: 'none',
    tieneConfiguracionDeAutenticacion: false,
    tienePreScript: false,
    tienePostScript: false,
    ...parcial,
  };
}

function campo(parcial: Partial<PeticionParaCurl['camposDeFormulario'][number]> = {}) {
  return {
    nombre: 'campo',
    valor: 'valor',
    esSecreto: false,
    habilitado: true,
    esFichero: false,
    nombreDelFichero: null,
    contentType: null,
    ...parcial,
  };
}

// ===========================================================================
// multipart_form_data
// ===========================================================================

describe('F7 · cURL de `multipart_form_data`', () => {
  it('emite `--form` para los campos y `--form ...=@fichero` para los adjuntos', () => {
    const { curl, advertencias } = generarCurl(
      peticionBase({
        modoCuerpo: 'multipart_form_data',
        camposDeFormulario: [
          campo({ nombre: 'titulo', valor: 'hola' }),
          campo({
            nombre: 'adjunto',
            valor: null,
            esFichero: true,
            nombreDelFichero: 'informe.pdf',
            contentType: 'application/pdf',
          }),
        ],
      }),
    );
    assert.ok(curl.includes("--form-string 'titulo=hola'"), curl);
    assert.ok(curl.includes("--form 'adjunto=@./informe.pdf;type=application/pdf'"), curl);
    // Regla 4: la limitación se declara, no se esconde.
    assert.ok(
      advertencias.some((a) => a.includes('adjunto') && a.includes('GUARDADO EN EL SERVIDOR')),
      JSON.stringify(advertencias),
    );
    // Nunca se fija el Content-Type global: cURL calcula el boundary.
    assert.ok(!curl.includes('Content-Type: multipart/form-data'), curl);
  });

  it('DEFECTO F7-1 · un valor de texto que empieza por `@` NO hace que cURL lea un fichero local', () => {
    const { curl } = generarCurl(
      peticionBase({
        modoCuerpo: 'multipart_form_data',
        camposDeFormulario: [
          campo({ nombre: 'nota', valor: '@/etc/passwd' }),
          campo({ nombre: 'otra', valor: '</etc/shadow' }),
        ],
      }),
    );
    // `--form-string` manda el valor literal; `--form` lo habría interpretado.
    assert.ok(curl.includes("--form-string 'nota=@/etc/passwd'"), curl);
    assert.ok(curl.includes("--form-string 'otra=</etc/shadow'"), curl);
    assert.ok(!curl.includes("--form 'nota="), curl);
    assert.ok(!curl.includes("--form 'otra="), curl);
  });

  it('con Content-Type por campo y un valor ambiguo, se conserva el CONTENIDO y se avisa del tipo perdido', () => {
    const { curl, advertencias } = generarCurl(
      peticionBase({
        modoCuerpo: 'multipart_form_data',
        camposDeFormulario: [
          campo({ nombre: 'meta', valor: '@raro', contentType: 'application/json' }),
        ],
      }),
    );
    assert.ok(curl.includes("--form-string 'meta=@raro'"), curl);
    assert.ok(
      advertencias.some((a) => a.includes('meta') && a.includes('Content-Type')),
      JSON.stringify(advertencias),
    );
  });

  it('regla 1 · un campo secreto sale con marcador y con `--form-string`, nunca con el valor', () => {
    const { curl, advertencias } = generarCurl(
      peticionBase({
        modoCuerpo: 'multipart_form_data',
        camposDeFormulario: [campo({ nombre: 'token', valor: null, esSecreto: true })],
      }),
    );
    assert.ok(curl.includes(`$${PREFIJO_DE_SECRETO}FORM_TOKEN`), curl);
    assert.ok(curl.includes('--form-string'), curl);
    assert.ok(!curl.includes(CENTINELA), curl);
    assert.ok(advertencias.some((a) => a.includes('token')), JSON.stringify(advertencias));
  });

  it('un adjunto sin nombre conocido se omite CON advertencia, no con una ruta inventada', () => {
    const { curl, advertencias } = generarCurl(
      peticionBase({
        modoCuerpo: 'multipart_form_data',
        camposDeFormulario: [
          campo({ nombre: 'x', valor: null, esFichero: true, nombreDelFichero: null }),
        ],
      }),
    );
    assert.ok(!curl.includes('--form '), curl);
    assert.ok(
      advertencias.some((a) => a.includes('no se conoce el nombre original')),
      JSON.stringify(advertencias),
    );
  });

  it('regla 3 · un nombre de fichero con comillas y separadores no rompe el comando', () => {
    const { curl } = generarCurl(
      peticionBase({
        modoCuerpo: 'multipart_form_data',
        camposDeFormulario: [
          campo({
            nombre: 'f',
            valor: null,
            esFichero: true,
            nombreDelFichero: "../../etc/pas'swd;type=text,evil",
          }),
        ],
      }),
    );
    // Los separadores de ruta se van (es un NOMBRE, no una ruta), `;` y `,`
    // —que cURL leería como parámetros de `--form`— quedan neutralizados, y la
    // comilla simple va escapada. El valor llega ENTERO como un solo token.
    assert.ok(!curl.includes('../'), curl);
    const tokens = tokenizarPosix(curl);
    assert.deepEqual(
      tokens.filter((t) => t.startsWith('f=')),
      ["f=@./pas'swd_type=text_evil"],
      curl,
    );
    assert.equal(tokens.filter((t) => t === '--form').length, 1, curl);
  });

  it('un campo deshabilitado no aparece', () => {
    const { curl } = generarCurl(
      peticionBase({
        modoCuerpo: 'multipart_form_data',
        camposDeFormulario: [campo({ nombre: 'oculto', valor: 'x', habilitado: false })],
      }),
    );
    assert.ok(!curl.includes('oculto'), curl);
  });
});

// ===========================================================================
// form_urlencoded
// ===========================================================================

describe('F7 · cURL de `form_urlencoded`', () => {
  it('emite `--data-urlencode` por campo', () => {
    const { curl } = generarCurl(
      peticionBase({
        modoCuerpo: 'form_urlencoded',
        camposDeFormulario: [
          campo({ nombre: 'a', valor: '1' }),
          campo({ nombre: 'b', valor: 'dos & medio' }),
        ],
      }),
    );
    assert.ok(curl.includes("--data-urlencode 'a=1'"), curl);
    assert.ok(curl.includes("--data-urlencode 'b=dos & medio'"), curl);
  });

  it('DEFECTO F7-2 · un nombre de campo con `@` NO se convierte en «lee este fichero»', () => {
    const { curl } = generarCurl(
      peticionBase({
        modoCuerpo: 'form_urlencoded',
        camposDeFormulario: [campo({ nombre: 'correo@dominio', valor: 'ada@example.com' })],
      }),
    );
    // La sintaxis `name@filename` de cURL habría ganado sobre `name=content`.
    assert.ok(!curl.includes("--data-urlencode 'correo@dominio="), curl);
    assert.ok(curl.includes('--data-raw'), curl);
    assert.ok(curl.includes('correo%40dominio='), curl);
  });

  it('un campo de fichero en urlencoded se declara y se omite', () => {
    const { curl, advertencias } = generarCurl(
      peticionBase({
        modoCuerpo: 'form_urlencoded',
        camposDeFormulario: [
          campo({ nombre: 'f', valor: null, esFichero: true, nombreDelFichero: 'a.pdf' }),
        ],
      }),
    );
    assert.ok(!curl.includes('a.pdf'), curl);
    assert.ok(
      advertencias.some((a) => a.includes('no admite adjuntos')),
      JSON.stringify(advertencias),
    );
  });
});

// ===========================================================================
// binary_file
// ===========================================================================

describe('F7 · cURL de `binary_file`', () => {
  it('emite `--data-binary @fichero` con el nombre real y advierte de dónde viven los bytes', () => {
    const { curl, advertencias } = generarCurl(
      peticionBase({
        modoCuerpo: 'binary_file',
        tieneFicheroBinario: true,
        nombreDelFicheroBinario: 'carga.bin',
        contentTypeDelCuerpo: 'application/octet-stream',
      }),
    );
    assert.ok(curl.includes("--data-binary '@./carga.bin'"), curl);
    assert.ok(curl.includes("--header 'Content-Type: application/octet-stream'"), curl);
    assert.ok(
      advertencias.some((a) => a.includes('GUARDADO EN EL SERVIDOR')),
      JSON.stringify(advertencias),
    );
  });

  it('sin nombre conocido NO inventa una ruta: comando sin cuerpo y advertencia', () => {
    const { curl, advertencias } = generarCurl(
      peticionBase({ modoCuerpo: 'binary_file', tieneFicheroBinario: true }),
    );
    assert.ok(!curl.includes('--data-binary'), curl);
    assert.ok(
      advertencias.some((a) => a.includes('SIN cuerpo')),
      JSON.stringify(advertencias),
    );
  });

  it('un nombre hostil no escapa del entrecomillado ni inyecta un comando', () => {
    const { curl } = generarCurl(
      peticionBase({
        modoCuerpo: 'binary_file',
        tieneFicheroBinario: true,
        nombreDelFicheroBinario: "a'; rm -rf ~ #.bin",
      }),
    );
    const tokens = tokenizarPosix(curl);
    // Todo el nombre viaja en UN token, detrás de `--data-binary`. No hay
    // ningún `;`, `rm` ni `#` sueltos que la shell pudiera ejecutar.
    const indice = tokens.indexOf('--data-binary');
    assert.ok(indice >= 0, curl);
    // El `;` queda neutralizado como `_` (cURL lo leería como separador de
    // parámetros) y el resto viaja entero dentro de un solo token.
    assert.equal(tokens[indice + 1], "@./a'_ rm -rf ~ #.bin", curl);
    assert.ok(!tokens.includes('rm'), curl);
    assert.ok(!tokens.includes(';'), curl);
  });
});

// ===========================================================================
// custom y reglas transversales
// ===========================================================================

describe('F7 · `custom` y reglas transversales', () => {
  it('`custom` se exporta con su advertencia y sin inventar cuerpo', () => {
    const { curl, advertencias } = generarCurl(peticionBase({ modoCuerpo: 'custom' }));
    assert.ok(!curl.includes('--data'), curl);
    assert.ok(
      advertencias.some((a) => a.includes('custom')),
      JSON.stringify(advertencias),
    );
  });

  it('regla 2 · las `{{var}}` se conservan en la URL y en los campos', () => {
    const { curl } = generarCurl(
      peticionBase({
        urlPlantilla: '{{base_url}}/subir',
        modoCuerpo: 'multipart_form_data',
        camposDeFormulario: [campo({ nombre: 'env', valor: '{{entorno}}' })],
      }),
    );
    assert.ok(curl.includes('{{base_url}}'), curl);
    assert.ok(curl.includes('{{entorno}}'), curl);
  });

  it('regla 3 · el comando se analiza entero y los valores llegan íntegros en todos los modos nuevos', () => {
    for (const modo of ['multipart_form_data', 'form_urlencoded', 'binary_file', 'custom'] as const) {
      const { curl } = generarCurl(
        peticionBase({
          modoCuerpo: modo,
          tieneFicheroBinario: modo === 'binary_file',
          nombreDelFicheroBinario: "raro'nombre.bin",
          camposDeFormulario: [
            campo({ nombre: "a'b", valor: "c'd $(id) `whoami` \\" }),
            campo({ nombre: 'f', valor: null, esFichero: true, nombreDelFichero: "g'h.pdf" }),
          ],
        }),
      );
      // No lanza = ninguna comilla queda sin cerrar.
      const tokens = tokenizarPosix(curl);
      assert.equal(tokens[0], 'curl', `${modo}: ${curl}`);
      assert.ok(!/\r|\n/u.test(curl), `${modo}: el comando tiene saltos de línea`);
      // Nada de sustitución de comandos sobrevive como token ejecutable.
      assert.ok(!tokens.includes('$(id)'), `${modo}: ${curl}`);
      assert.ok(!tokens.includes('whoami'), `${modo}: ${curl}`);
      if (modo === 'multipart_form_data' || modo === 'form_urlencoded') {
        assert.ok(
          tokens.some((t) => t.includes("c'd $(id) `whoami` \\")),
          `${modo}: el valor no llegó íntegro: ${curl}`,
        );
      }
    }
  });
});
