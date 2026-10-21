import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';

// EL PROXY DE EGRESO DEL CONTENEDOR SE APARTA ANTES DE NADA.
//
// Este entorno define `HTTP_PROXY`, `HTTPS_PROXY` y `NODE_USE_ENV_PROXY=1`, y
// con eso el `fetch` de Node manda por el proxy HASTA el trafico a 127.0.0.1.
// El motor de pega de esta prueba escucha en loopback, asi que sin esto la
// peticion nunca le llega y la prueba falla por el entorno, no por el codigo.
// `undici` fija su dispatcher en el primer uso: hay que hacerlo en la carga del
// modulo, antes de cualquier peticion.
for (const clave of [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'ALL_PROXY',
  'all_proxy',
  'NODE_USE_ENV_PROXY',
]) {
  delete process.env[clave];
}
process.env['NO_PROXY'] = '127.0.0.1,localhost';

import type { ServicioDeAuditoria } from '../src/platform/audit/ports.ts';
import type { ConfiguracionDeApp } from '../src/platform/config/app-config.ts';
import type { Principal } from '../src/platform/auth/principal.ts';
import {
  PrismaClientService,
  rutasCandidatasDelCliente,
  type ClientePrismaCeiba,
} from '../src/platform/persistence/prisma/prisma-client.ts';
import { StudioService } from '../src/modules/studio/studio-core.service.ts';
import type { StudioCollaborationService } from '../src/modules/studio/studio-collab.service.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * FASE 4 — Las tres cosas que estaban rotas y no se veían.
 *
 * Estas pruebas no repiten lo que ya cubre el arnés de `scripts/`: fijan por
 * escrito las tres afirmaciones que, al fallar, volvían a dejar el módulo
 * `studio` inutilizable sin que nadie se enterase.
 *
 *  1. **La fachada de Prisma es la real.** Si alguien vuelve a estrecharla a
 *     mano o a ponerla en `any`, aquí se cae: se carga el cliente GENERADO y se
 *     comprueba que están los 15 modelos y las 9 operaciones que usa el módulo.
 *  2. **Lo que le enviamos al motor cumple su contrato.** `executeRequestSchema`
 *     es un `z.strictObject` anidado; el código enviaba un objeto plano y el
 *     motor lo rechazaba con `INVALID_REQUEST`. Se levanta un motor de pega y
 *     se inspecciona byte a byte lo que sale.
 *  3. **La respuesta del motor se traduce bien**, incluido el camino de error,
 *     y la fila de historial se escribe con los nombres de columna REALES y con
 *     los cuatro campos obligatorios que antes faltaban.
 *
 * No hay red externa ni base de datos: servidor local y dobles en memoria, al
 * estilo de las 13 pruebas que ya existían.
 * ════════════════════════════════════════════════════════════════════════════
 */

// ---------------------------------------------------------------------------
// 1. La fachada tipada corresponde al cliente realmente generado
// ---------------------------------------------------------------------------

const MODELOS_QUE_USA_STUDIO = [
  'apiRequest',
  'auditLog',
  'collection',
  'collectionFolder',
  'collectionRun',
  'collectionVersion',
  'environment',
  'environmentVariable',
  'invitation',
  'requestHistory',
  'retentionPolicy',
  'user',
  'workspace',
  'workspaceMember',
  'session',
] as const;

const OPERACIONES_QUE_USA_STUDIO = [
  'findFirst',
  'findUnique',
  'findUniqueOrThrow',
  'findMany',
  'create',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
] as const;

/**
 * Localiza el cliente generado con la MISMA funcion que usa el arranque
 * (`rutasCandidatasDelCliente`), en vez de una ruta relativa a mano: las
 * pruebas se ejecutan desde `dist-test/`, no desde `src/`, y una ruta relativa
 * escrita a ojo apunta a otro sitio segun quien la lea.
 */
async function cargarClienteGenerado(): Promise<Record<string, unknown>> {
  const ruta = rutasCandidatasDelCliente().find((candidata) => existsSync(candidata));
  assert.ok(
    ruta,
    'El cliente Prisma no esta generado. Ejecuta, desde la raiz:\n' +
      '  pnpm exec prisma generate --config prisma/prisma.config.ts',
  );
  return (await import(pathToFileURL(ruta).href)) as Record<string, unknown>;
}

async function instanciaDelClienteGenerado(): Promise<Record<string, unknown>> {
  const modulo = await cargarClienteGenerado();
  const Constructor = modulo['PrismaClient'] as
    | (new (o: unknown) => Record<string, unknown>)
    | undefined;
  assert.ok(Constructor, 'el cliente generado debe exportar PrismaClient');
  // Prisma 7 EXIGE un adaptador de driver en el constructor: con `{}` lanza
  // `PrismaClientConstructorValidationError` y la prueba muere antes de
  // comprobar nada. Se le pasa uno, que NO abre conexion al construirse —solo
  // al primer query—, asi que los delegados se materializan, que es justo lo
  // que esta prueba verifica, y no hace falta PostgreSQL para ejecutarla.
  const { PrismaPg } = (await import('@prisma/adapter-pg')) as {
    PrismaPg: new (config: { connectionString: string }) => unknown;
  };
  const adaptador = new PrismaPg({
    connectionString:
      process.env['DATABASE_URL'] ?? 'postgresql://ceiba@127.0.0.1:55432/ceiba',
  });
  return new Constructor({ adapter: adaptador });
}

describe('fachada de Prisma — es el cliente generado, no una copia a mano', () => {
  it('el cliente generado existe y expone los 15 modelos que usa studio', async () => {
    const instancia = await instanciaDelClienteGenerado();
    const ausentes = MODELOS_QUE_USA_STUDIO.filter(
      (modelo) => instancia[modelo] === undefined || instancia[modelo] === null,
    );
    assert.deepEqual(
      ausentes,
      [],
      `modelos que studio usa y el cliente no tiene: ${ausentes.join(', ')}`,
    );
  });

  it('cada delegado trae las 9 operaciones usadas, incluidas upsert, delete y deleteMany', async () => {
    const instancia = await instanciaDelClienteGenerado();
    const fallos: string[] = [];
    for (const modelo of MODELOS_QUE_USA_STUDIO) {
      const delegado = instancia[modelo] as Record<string, unknown>;
      for (const operacion of OPERACIONES_QUE_USA_STUDIO) {
        if (typeof delegado[operacion] !== 'function') {
          fallos.push(`${modelo}.${operacion}`);
        }
      }
    }
    assert.deepEqual(fallos, [], `operaciones ausentes: ${fallos.join(', ')}`);
  });

  it('el cliente trae $transaction, que es de donde sale el tipo de la transacción', async () => {
    const instancia = await instanciaDelClienteGenerado();
    assert.equal(typeof instancia['$transaction'], 'function');
  });
});

// ---------------------------------------------------------------------------
// 2 y 3. Contrato con el motor y traducción de su respuesta
// ---------------------------------------------------------------------------

interface FilaDeHistorialEscrita {
  readonly [clave: string]: unknown;
}

/** Lo último que el servicio intentó escribir en `request_history`. */
let ultimaFilaDeHistorial: FilaDeHistorialEscrita | null = null;
/** Lo último que el servicio le envió al motor. */
let ultimoCuerpoAlMotor: Record<string, unknown> | null = null;
/** Respuesta que el motor de pega devolverá en la siguiente llamada. */
let respuestaDelMotor: unknown = null;
let estadoHttpDelMotor = 200;

/**
 * Doble del cliente Prisma. Sólo implementa lo que `ejecutarPeticion` toca.
 *
 * La aserción de tipo es la mínima imprescindible para un doble —el cliente
 * real tiene 41 modelos— y está aquí, en la prueba, no en el código de
 * producción: no silencia ningún error, sólo construye una maqueta.
 */
function prismaDePega(): PrismaClientService {
  const doble = {
    environment: {
      findFirst: async () => null,
    },
    apiRequest: {
      findFirst: async () => null,
    },
    requestHistory: {
      create: async ({ data }: { data: FilaDeHistorialEscrita }) => {
        ultimaFilaDeHistorial = data;
        return { id: 'historial-de-prueba' };
      },
    },
  };
  return new PrismaClientService(doble as unknown as ClientePrismaCeiba);
}

function colaboracionDePega(): StudioCollaborationService {
  const doble = {
    verificarRolMinimo: async () => ({
      workspace: {
        id: 'ws-1',
        name: 'Espacio',
        slug: 'espacio',
        ownerUserId: 'usuario-1',
        historyRetentionDays: 30,
      },
      rol: 'owner' as const,
    }),
  };
  return doble as unknown as StudioCollaborationService;
}

function auditoriaDePega(): ServicioDeAuditoria {
  return { registrar: () => undefined } as unknown as ServicioDeAuditoria;
}

const PRINCIPAL: Principal = {
  tipo: 'usuario',
  usuarioId: 'usuario-1',
  sesionId: 'sesion-1',
  userId: 'usuario-1',
};

describe('studio — contrato con el motor HTTP y traducción de su respuesta', () => {
  let motor: Server;
  let urlMotor: string;
  let servicio: StudioService;

  before(async () => {
    motor = createServer((req: IncomingMessage, res: ServerResponse) => {
      const trozos: Buffer[] = [];
      req.on('data', (t: Buffer) => trozos.push(t));
      req.on('end', () => {
        ultimoCuerpoAlMotor = JSON.parse(Buffer.concat(trozos).toString('utf8')) as Record<
          string,
          unknown
        >;
        res.writeHead(estadoHttpDelMotor, { 'content-type': 'application/json' });
        res.end(JSON.stringify(respuestaDelMotor));
      });
    });
    await new Promise<void>((listo) => motor.listen(0, '127.0.0.1', listo));
    const direccion = motor.address() as AddressInfo;
    urlMotor = `http://127.0.0.1:${direccion.port}`;

    const config = {
      engine: { url: urlMotor, token: 'testigo-de-prueba', timeoutMs: 5000 },
    } as unknown as ConfiguracionDeApp;

    servicio = new StudioService(
      prismaDePega(),
      config,
      colaboracionDePega(),
      auditoriaDePega(),
    );
  });

  after(async () => {
    await new Promise<void>((listo) => motor.close(() => listo()));
  });

  it('envía exactamente la forma que exige `executeRequestSchema`, no un objeto plano', async () => {
    estadoHttpDelMotor = 200;
    respuestaDelMotor = {
      executionId: 'x',
      outcome: 'completed',
      response: {
        status: 204,
        statusText: 'No Content',
        headers: [],
        bodyEncoding: 'utf8',
        body: '',
        bodyTruncated: false,
        sizeBytes: 0,
      },
      timings: { totalMs: 7, ttfbMs: 5 },
      redirects: [],
      error: null,
    };

    await servicio.ejecutarPeticion(
      'ws-1',
      {
        method: 'post',
        url: 'https://destino.ejemplo/api',
        headers: [
          { key: 'content-type', value: 'application/json' },
          { key: 'x-apagada', value: 'no', enabled: false },
        ],
        queryParams: [],
        bodyType: 'json',
        body: '{"a":1}',
        timeoutMs: 1234,
      },
      PRINCIPAL,
    );

    const enviado = ultimoCuerpoAlMotor;
    assert.ok(enviado, 'el motor tiene que haber recibido algo');

    // La raíz tiene SÓLO las claves del contrato. Si vuelve el objeto plano
    // (`method`, `url`, `headers`, `followRedirects` en la raíz), esto falla.
    assert.deepEqual(Object.keys(enviado).sort(), ['executionId', 'policy', 'request']);
    assert.equal(typeof enviado['executionId'], 'string');

    const peticion = enviado['request'] as Record<string, unknown>;
    assert.equal(peticion['method'], 'POST');
    assert.equal(peticion['url'], 'https://destino.ejemplo/api');

    // Las cabeceras van como `{name, value}` y la desactivada no viaja.
    assert.deepEqual(peticion['headers'], [{ name: 'content-type', value: 'application/json' }]);

    // El cuerpo usa `mode`/`raw` del `bodySchema`, no el `{kind, text}` previo.
    assert.deepEqual(peticion['body'], { mode: 'json', raw: '{"a":1}' });

    const politica = enviado['policy'] as Record<string, unknown>;
    assert.equal(politica['timeoutMs'], 1234);
    assert.equal(politica['followRedirects'], true);
  });

  it('traduce una respuesta correcta del motor y escribe el historial con las columnas reales', async () => {
    estadoHttpDelMotor = 200;
    respuestaDelMotor = {
      executionId: 'x',
      outcome: 'completed',
      response: {
        status: 201,
        statusText: 'Created',
        headers: [{ name: 'content-type', value: 'application/json' }],
        bodyEncoding: 'utf8',
        body: '{"ok":true}',
        bodyTruncated: false,
        sizeBytes: 11,
      },
      timings: { totalMs: 42, ttfbMs: 30 },
      redirects: [{ status: 301, from: 'https://a/', to: 'https://b/' }],
      error: null,
    };

    const salida = await servicio.ejecutarPeticion(
      'ws-1',
      {
        method: 'GET',
        url: 'https://destino.ejemplo/recurso',
        headers: [],
        queryParams: [],
        bodyType: 'none',
        body: null,
      },
      PRINCIPAL,
    );

    assert.equal(salida.exito, true);
    assert.equal(salida.codigoEstado, 201);
    assert.equal(salida.textoEstado, 'Created');
    assert.equal(salida.cuerpoTexto, '{"ok":true}');
    assert.equal(salida.tipoContenido, 'application/json');
    assert.equal(salida.tamanoBytes, 11);
    assert.equal(salida.tiempos.totalMs, 42);
    assert.equal(salida.redirecciones, 1);
    assert.equal(salida.urlFinal, 'https://b/');

    const fila = ultimaFilaDeHistorial;
    assert.ok(fila, 'tiene que haberse escrito una fila de historial');

    // Nombres REALES de `request_history`. Los de antes no existían.
    assert.equal(fila['urlFinal'], 'https://destino.ejemplo/recurso');
    assert.equal(fila['urlHost'], 'destino.ejemplo');
    assert.equal(fila['statusCode'], 201);
    assert.equal(fila['durationTotalMs'], 42);
    assert.equal(fila['executedByUserId'], 'usuario-1');
    assert.equal(fila['outcome'], 'completed');
    assert.equal(fila['responseContentType'], 'application/json');
    assert.equal(fila['redirectCount'], 1);
    assert.ok(fila['expiresAt'] instanceof Date, '`expiresAt` es obligatorio y sin default');

    // Y los nombres inventados NO vuelven a aparecer.
    for (const inexistente of [
      'userId',
      'requestId',
      'resolvedUrl',
      'requestSnapshot',
      'responseStatus',
      'responseHeaders',
      'responseBodyPreview',
      'durationMs',
    ]) {
      assert.equal(
        Object.hasOwn(fila, inexistente),
        false,
        `'${inexistente}' no es una columna de request_history`,
      );
    }
  });

  it('decodifica un cuerpo binario en base64 en vez de devolverlo en crudo', async () => {
    estadoHttpDelMotor = 200;
    respuestaDelMotor = {
      outcome: 'completed',
      response: {
        status: 200,
        statusText: 'OK',
        headers: [],
        bodyEncoding: 'base64',
        body: Buffer.from('hola mundo', 'utf8').toString('base64'),
        bodyTruncated: false,
        sizeBytes: 10,
      },
      timings: { totalMs: 3 },
      redirects: [],
      error: null,
    };

    const salida = await servicio.ejecutarPeticion(
      'ws-1',
      { method: 'GET', url: 'https://destino.ejemplo/bin', bodyType: 'none', body: null },
      PRINCIPAL,
    );
    assert.equal(salida.cuerpoTexto, 'hola mundo');
  });

  it('un bloqueo SSRF del motor se guarda como `blocked_by_policy`, no como error genérico', async () => {
    estadoHttpDelMotor = 200;
    respuestaDelMotor = {
      outcome: 'blocked',
      response: null,
      timings: { totalMs: 2 },
      redirects: [],
      error: { code: 'SSRF_BLOCKED', message: 'El destino está fuera de la política de red.' },
    };

    const salida = await servicio.ejecutarPeticion(
      'ws-1',
      { method: 'GET', url: 'http://169.254.169.254/latest/meta-data/', bodyType: 'none' },
      PRINCIPAL,
    );

    assert.equal(salida.exito, false);
    assert.equal(salida.errorCodigo, 'SSRF_BLOCKED');
    assert.equal(ultimaFilaDeHistorial?.['outcome'], 'blocked_by_policy');
    assert.equal(ultimaFilaDeHistorial?.['errorCode'], 'SSRF_BLOCKED');
    // El host se guarda aunque la petición no llegase a salir: es lo que
    // permite auditar los intentos contra el servicio de metadatos.
    assert.equal(ultimaFilaDeHistorial?.['urlHost'], '169.254.169.254');
  });

  it('un tiempo agotado se guarda como `timeout` y un código desconocido como `internal_error`', async () => {
    estadoHttpDelMotor = 200;
    respuestaDelMotor = {
      outcome: 'timeout',
      response: null,
      timings: { totalMs: 30000 },
      redirects: [],
      error: { code: 'TIMEOUT', message: 'Se agotó el tiempo.' },
    };
    await servicio.ejecutarPeticion(
      'ws-1',
      { method: 'GET', url: 'https://lento.ejemplo/', bodyType: 'none' },
      PRINCIPAL,
    );
    assert.equal(ultimaFilaDeHistorial?.['outcome'], 'timeout');

    respuestaDelMotor = {
      outcome: 'failed',
      response: null,
      timings: { totalMs: 1 },
      redirects: [],
      error: { code: 'UN_CODIGO_QUE_NO_CONOCEMOS', message: 'vaya' },
    };
    await servicio.ejecutarPeticion(
      'ws-1',
      { method: 'GET', url: 'https://raro.ejemplo/', bodyType: 'none' },
      PRINCIPAL,
    );
    // Falla al valor genérico del enum, nunca al literal recibido: un valor
    // fuera de `ExecutionOutcome` aborta el INSERT y se pierde el registro.
    assert.equal(ultimaFilaDeHistorial?.['outcome'], 'internal_error');
  });

  it('si el motor rechaza la petición con 4xx, no se interpreta como ejecución correcta', async () => {
    estadoHttpDelMotor = 400;
    respuestaDelMotor = {
      error: { code: 'INVALID_REQUEST', message: 'La petición no cumple el contrato del motor.' },
    };

    const salida = await servicio.ejecutarPeticion(
      'ws-1',
      { method: 'GET', url: 'https://destino.ejemplo/', bodyType: 'none' },
      PRINCIPAL,
    );
    assert.equal(salida.exito, false);
    assert.equal(salida.errorCodigo, 'INVALID_REQUEST');
    assert.equal(ultimaFilaDeHistorial?.['outcome'], 'internal_error');
  });

  it('una variable marcada como secreta se rechaza en vez de guardarse en claro', async () => {
    await assert.rejects(
      () =>
        servicio.crearEntorno(
          'ws-1',
          {
            name: 'Producción',
            variables: [{ key: 'api_key', value: 'valor-sensible', isSecret: true }],
          },
          PRINCIPAL,
        ),
      /secreta|secretos/iu,
      'guardar un secreto en `current_value` sería una fuga silenciosa',
    );
  });
});
