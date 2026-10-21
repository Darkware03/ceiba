import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { configurarAplicacion } from '../src/bootstrap.ts';
import { ModuloDePlataforma } from '../src/platform/platform.module.ts';
import { ModuloDeColecciones } from '../src/modules/collection/collection.public.ts';
import { ModuloDeIdentidad } from '../src/modules/identity/identity.public.ts';
import { ModuloDeWorkspaces } from '../src/modules/workspace/workspace.public.ts';
import { ModuloDeComparticion } from '../src/modules/sharing/sharing.public.ts';
import { ModuloDePeticiones } from '../src/modules/request/request.public.ts';
import { StudioModule } from '../src/modules/studio/studio.module.ts';
import { GUARDS_GLOBALES_DE_LA_RAIZ } from '../src/root-guards.ts';
import {
  CONFIGURACION_APP,
  cargarConfiguracion,
  type ConfiguracionApp,
} from '../src/platform/config/app-config.ts';
import { RELOJ, RelojFalso } from '../src/platform/time/clock.ts';
import {
  CLIENTE_PRISMA,
  type ClientePrismaCeiba,
} from '../src/platform/persistence/prisma/prisma-client.ts';
import {
  ORIGEN_DE_PRUEBA,
  type AppDePruebaPg,
  type Credenciales,
  contrasenaDePrueba,
  entornoDePruebaPostgres,
  marcaDeEjecucion,
  pedir,
  registrarYEntrar,
} from './helpers/app-de-prueba-postgres.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * FASE 7 — ÁMBITO B: variables por colección (P6) e invitaciones (P7).
 *
 * Contra el PostgreSQL REAL de `127.0.0.1:55432`. Nada de dobles: lo que hay
 * que demostrar es, precisamente, que el motor y sus restricciones están
 * delante.
 *
 * POR QUÉ ESTE FICHERO MONTA SU PROPIO ARNÉS Y NO USA
 * `crearAppDePruebaPostgres`: ese ayudante NO importa `StudioModule`
 * (`helpers/app-de-prueba-postgres.ts:82-90`), así que la ruta que se prueba
 * aquí —`GET /collections/:id/variables`— devolvería 404 por no estar
 * registrada, y la prueba pasaría «en verde» sin probar nada. El ayudante está
 * fuera de mi ámbito de escritura, de modo que replico su fábrica añadiendo el
 * módulo y REUTILIZO por importación todo lo demás (`pedir`,
 * `registrarYEntrar`, `entornoDePruebaPostgres`, …) para no duplicar semántica.
 *
 * Familias de prueba:
 *   V-VAR-01  una variable secreta se LISTA pero su `preview` es `null`
 *   V-VAR-02  precedencia colección > workspace, y la perdedora sale `shadowed`
 *   V-VAR-03  un ajeno al workspace recibe 403/404, nunca 200 con lista vacía
 *   V-VAR-04  sólo entran los dos alcances del §2.3
 *   V-INV-01  el enlace de WORKSPACE llega absoluto y pegable en una sola llamada
 *   V-INV-02  una invitación revocada deja de servir en la petición siguiente
 *   V-INV-03  el enlace de COLECCIÓN llega absoluto y pegable en una sola llamada
 *   V-INV-04  un enlace de colección revocado deja de servir inmediatamente
 * ════════════════════════════════════════════════════════════════════════════
 */

// ---------------------------------------------------------------------------
// Arnés
// ---------------------------------------------------------------------------

async function crearAppConStudio(): Promise<AppDePruebaPg> {
  const entorno = entornoDePruebaPostgres();
  const config = cargarConfiguracion(entorno);
  const reloj = new RelojFalso(new Date());

  const moduleRef = await Test.createTestingModule({
    imports: [
      ModuloDePlataforma.forRoot(entorno),
      ModuloDeColecciones,
      ModuloDePeticiones,
      ModuloDeIdentidad,
      ModuloDeWorkspaces,
      ModuloDeComparticion,
      StudioModule,
    ],
    providers: [...GUARDS_GLOBALES_DE_LA_RAIZ],
  })
    .overrideProvider(RELOJ)
    .useValue(reloj)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ trustProxy: config.proxiesDeConfianza }),
    { logger: false },
  );
  await configurarAplicacion(app, app.get<ConfiguracionApp>(CONFIGURACION_APP));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    config: app.get<ConfiguracionApp>(CONFIGURACION_APP),
    reloj,
    prisma: app.get<ClientePrismaCeiba>(CLIENTE_PRISMA),
    cerrar: async () => {
      await app.close();
    },
  };
}

async function crearWorkspaceYColeccion(
  entorno: AppDePruebaPg,
  credenciales: Credenciales,
  marca: string,
): Promise<{ workspaceId: string; collectionId: string }> {
  const ws = await pedir(entorno, {
    method: 'POST',
    url: '/api/v1/workspaces',
    payload: { slug: `ws-f7-${marca}`, name: `Workspace F7 ${marca}` },
    cookies: credenciales.cookies,
    csrf: credenciales.csrf,
  });
  if (ws.statusCode !== 201) throw new Error(`crear workspace: ${ws.statusCode} ${ws.body}`);
  const workspaceId = (ws.json() as { workspace: { id: string } }).workspace.id;

  const col = await pedir(entorno, {
    method: 'POST',
    url: `/api/v1/workspaces/${workspaceId}/collections`,
    payload: { slug: `col-f7-${marca}`, name: `Colección F7 ${marca}` },
    cookies: credenciales.cookies,
    csrf: credenciales.csrf,
  });
  if (col.statusCode !== 201) throw new Error(`crear colección: ${col.statusCode} ${col.body}`);
  const collectionId = (col.json() as { coleccion: { id: string } }).coleccion.id;
  return { workspaceId, collectionId };
}

interface VariableDevuelta {
  key: string;
  scope: 'collection' | 'workspace';
  environmentId: string;
  environmentName: string;
  isSecret: boolean;
  isEnabled: boolean;
  valueKind: string;
  preview: string | null;
  shadowed: boolean;
}

async function leerVariables(
  entorno: AppDePruebaPg,
  credenciales: Credenciales,
  collectionId: string,
): Promise<{ codigo: number; cuerpo: string; items: VariableDevuelta[] }> {
  const respuesta = await pedir(entorno, {
    method: 'GET',
    url: `/api/v1/collections/${collectionId}/variables`,
    cookies: credenciales.cookies,
  });
  const items =
    respuesta.statusCode === 200
      ? (respuesta.json() as { items: VariableDevuelta[] }).items
      : [];
  return { codigo: respuesta.statusCode, cuerpo: respuesta.body, items };
}

// ---------------------------------------------------------------------------

describe('Fase 7 · Ámbito B · variables por colección e invitaciones', () => {
  let entorno: AppDePruebaPg;
  let marca: string;
  let duena: Credenciales;
  let ajeno: Credenciales;
  let workspaceId: string;
  let collectionId: string;

  before(async () => {
    entorno = await crearAppConStudio();
    marca = marcaDeEjecucion();
    duena = await registrarYEntrar(
      entorno,
      `duena-f7-${marca}@ceiba.local`,
      contrasenaDePrueba(marca),
      'Dueña F7',
    );
    ajeno = await registrarYEntrar(
      entorno,
      `ajeno-f7-${marca}@ceiba.local`,
      contrasenaDePrueba(marca),
      'Ajeno F7',
    );
    ({ workspaceId, collectionId } = await crearWorkspaceYColeccion(entorno, duena, marca));
  });

  after(async () => {
    await entorno?.cerrar();
  });

  // =========================================================================
  // P6 — §2.3
  // =========================================================================

  describe('P6 · GET /collections/:collectionId/variables', () => {
    it('V-VAR-01 · una variable SECRETA se lista, se marca y su preview es null', async () => {
      // La fila secreta se inserta con Prisma y no por la API a propósito: la
      // API RECHAZA `isSecret: true` (studio-core.service.ts:#aFilasDeVariables)
      // porque `ck_envvar_secret_xor` exige que el valor viva cifrado en
      // `secrets`. Es decir: por diseño, el único modo de tener una variable
      // secreta hoy es éste. Si algún día se expone la vía de escritura, esta
      // prueba seguirá siendo la que vigila la frontera de lectura.
      const secreto = await entorno.prisma.secret.create({
        data: {
          workspaceId,
          scope: 'environment',
          label: 'token de staging',
          ciphertext: randomBytes(48),
          nonce: randomBytes(12),
          aadFingerprint: randomBytes(32),
          kekReference: 'prueba://kek-local',
        },
      });

      const env = await entorno.prisma.environment.create({
        data: {
          workspaceId,
          collectionId: null,
          name: `Entorno con secreto ${marca}`,
          sortKey: `secreto-${marca}`,
          isShared: true,
        },
      });

      await entorno.prisma.environmentVariable.createMany({
        data: [
          {
            environmentId: env.id,
            key: 'api_token',
            valueKind: 'secret',
            // NULL obligatorio por `ck_envvar_secret_xor`: el texto en claro no
            // cabe en esta fila ni queriendo.
            initialValue: null,
            currentValue: null,
            secretId: secreto.id,
            isEnabled: true,
            sortOrder: 0,
          },
          {
            environmentId: env.id,
            key: 'api_publico',
            valueKind: 'string',
            initialValue: 'https://publico.ejemplo.com',
            currentValue: 'https://publico.ejemplo.com',
            isEnabled: true,
            sortOrder: 1,
          },
        ],
      });

      const { codigo, items } = await leerVariables(entorno, duena, collectionId);
      assert.equal(codigo, 200);

      const secreta = items.find((v) => v.key === 'api_token');
      assert.ok(secreta, 'la variable secreta DEBE aparecer en la lista de autocompletado');
      assert.equal(secreta.isSecret, true, 'debe venir marcada como secreta');
      assert.equal(secreta.valueKind, 'secret');
      assert.equal(secreta.preview, null, 'FRONTERA DE SECRETOS: preview SIEMPRE null');

      // La no secreta sí trae preview: la prueba anterior no pasa por estar todo a null.
      const publica = items.find((v) => v.key === 'api_publico');
      assert.ok(publica);
      assert.equal(publica.isSecret, false);
      assert.equal(publica.preview, 'https://publico.ejemplo.com');
    });

    it('V-VAR-01b · ninguna variable secreta trae preview, sea cual sea', async () => {
      // Invariante sobre el conjunto entero, no sobre una fila elegida: si
      // mañana alguien añade una rama nueva al resolvedor, aquí se cae.
      const { items } = await leerVariables(entorno, duena, collectionId);
      for (const v of items) {
        if (v.isSecret) {
          assert.equal(v.preview, null, `la secreta '${v.key}' filtró un preview`);
        }
      }
    });

    it('V-VAR-02 · la variable de COLECCIÓN eclipsa a la del WORKSPACE y la eclipsada sale shadowed', async () => {
      const envWorkspace = await entorno.prisma.environment.create({
        data: {
          workspaceId,
          collectionId: null,
          name: `Entorno de workspace ${marca}`,
          sortKey: `ws-${marca}`,
          isShared: true,
          environmentVariables: {
            create: [
              {
                key: 'base_url',
                valueKind: 'string',
                initialValue: 'https://workspace.ejemplo.com',
                currentValue: 'https://workspace.ejemplo.com',
                isEnabled: true,
                sortOrder: 0,
              },
              {
                key: 'solo_en_workspace',
                valueKind: 'string',
                initialValue: 'sigo visible',
                currentValue: 'sigo visible',
                isEnabled: true,
                sortOrder: 1,
              },
            ],
          },
        },
      });

      const envColeccion = await entorno.prisma.environment.create({
        data: {
          workspaceId,
          collectionId,
          name: `Entorno de colección ${marca}`,
          sortKey: `col-${marca}`,
          isShared: true,
          environmentVariables: {
            create: [
              {
                key: 'base_url',
                valueKind: 'string',
                initialValue: 'https://coleccion.ejemplo.com',
                currentValue: 'https://coleccion.ejemplo.com',
                isEnabled: true,
                sortOrder: 0,
              },
            ],
          },
        },
      });

      const { codigo, items } = await leerVariables(entorno, duena, collectionId);
      assert.equal(codigo, 200);

      const base = items.filter((v) => v.key === 'base_url');
      assert.equal(base.length, 2, 'las DOS deben aparecer: la perdedora no se omite');

      const ganadora = base.find((v) => !v.shadowed);
      const eclipsada = base.find((v) => v.shadowed);

      assert.ok(ganadora, 'tiene que haber exactamente una ganadora');
      assert.ok(eclipsada, 'tiene que haber exactamente una eclipsada');

      assert.equal(ganadora.scope, 'collection', 'la colección gana al workspace');
      assert.equal(ganadora.environmentId, envColeccion.id);
      assert.equal(ganadora.preview, 'https://coleccion.ejemplo.com');

      assert.equal(eclipsada.scope, 'workspace', 'la eclipsada es la del workspace');
      assert.equal(eclipsada.environmentId, envWorkspace.id);
      assert.equal(eclipsada.shadowed, true);
      assert.equal(
        eclipsada.preview,
        'https://workspace.ejemplo.com',
        'estar eclipsada NO es ser secreta: conserva su preview',
      );

      // Una clave que sólo existe en el workspace no se eclipsa a sí misma.
      const soloWs = items.filter((v) => v.key === 'solo_en_workspace');
      assert.equal(soloWs.length, 1);
      assert.equal(soloWs[0]?.shadowed, false);
      assert.equal(soloWs[0]?.scope, 'workspace');
    });

    it('V-VAR-03 · un AJENO al workspace recibe 403/404, nunca 200 con lista vacía', async () => {
      const { codigo, cuerpo } = await leerVariables(entorno, ajeno, collectionId);
      assert.ok(
        codigo === 403 || codigo === 404,
        `un ajeno debe recibir 403 o 404; recibió ${codigo} ${cuerpo}`,
      );
      assert.notEqual(codigo, 200, 'un 200 con lista vacía confirmaría que la colección existe');
    });

    it('V-VAR-03b · una colección inexistente da 404 y no revela nada', async () => {
      const { codigo } = await leerVariables(
        entorno,
        duena,
        '00000000-0000-7000-8000-000000000000',
      );
      assert.equal(codigo, 404);
    });

    it('V-VAR-04 · el entorno de OTRA colección del mismo workspace no se cuela', async () => {
      const otra = await pedir(entorno, {
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/collections`,
        payload: { slug: `col-otra-f7-${marca}`, name: `Otra colección ${marca}` },
        cookies: duena.cookies,
        csrf: duena.csrf,
      });
      assert.equal(otra.statusCode, 201);
      const otraId = (otra.json() as { coleccion: { id: string } }).coleccion.id;

      await entorno.prisma.environment.create({
        data: {
          workspaceId,
          collectionId: otraId,
          name: `Entorno de la otra ${marca}`,
          sortKey: `otra-${marca}`,
          isShared: true,
          environmentVariables: {
            create: [
              {
                key: 'no_debe_aparecer',
                valueKind: 'string',
                initialValue: 'fuga',
                currentValue: 'fuga',
                isEnabled: true,
                sortOrder: 0,
              },
            ],
          },
        },
      });

      const { items } = await leerVariables(entorno, duena, collectionId);
      assert.equal(
        items.some((v) => v.key === 'no_debe_aparecer'),
        false,
        'una variable de otra colección NO es visible desde ésta',
      );

      // …y desde la otra colección sí se ve, junto a las del workspace.
      const desdeLaOtra = await leerVariables(entorno, duena, otraId);
      assert.equal(desdeLaOtra.codigo, 200);
      assert.ok(desdeLaOtra.items.some((v) => v.key === 'no_debe_aparecer'));
      assert.ok(
        desdeLaOtra.items.some((v) => v.key === 'solo_en_workspace'),
        'los entornos del workspace son visibles desde todas sus colecciones',
      );
    });
  });

  // =========================================================================
  // P7 — §2.4
  // =========================================================================

  describe('P7 · enlaces pegables en un chat', () => {
    it('V-INV-01 · WORKSPACE: una sola llamada devuelve una URL ABSOLUTA, sin pedir correo', async () => {
      const respuesta = await pedir(entorno, {
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/invitations`,
        payload: { role: 'viewer' }, // sin `email`: enlace compartido
        cookies: duena.cookies,
        csrf: duena.csrf,
      });
      assert.equal(respuesta.statusCode, 201, respuesta.body);

      const cuerpo = respuesta.json() as {
        inviteToken: string;
        invitePath: string;
        inviteUrl: string;
        email: string;
      };

      // LA PRUEBA DE ACEPTACIÓN DE P7: una llamada, un enlace pegable.
      assert.ok(cuerpo.inviteUrl, 'debe venir `inviteUrl`');
      assert.ok(
        cuerpo.inviteUrl.startsWith(`${ORIGEN_DE_PRUEBA}/invitacion/`),
        `la URL debe ser absoluta y del origen público; vino '${cuerpo.inviteUrl}'`,
      );
      assert.doesNotThrow(() => new URL(cuerpo.inviteUrl), 'tiene que ser una URL válida');

      // El campo viejo se conserva: no rompo a nadie (§3.B.3).
      assert.equal(cuerpo.invitePath, `/invitacion/${cuerpo.inviteToken}`);
      assert.ok(cuerpo.inviteUrl.endsWith(cuerpo.invitePath));

      // ───────────────────────────────────────────────────────────────────
      // CORRECCIÓN (darkware, 2026-10-21). Esta línea exigía el buzon FIJO
      // `enlace-compartido@ceiba.local`, y ese literal es justo lo que hacía
      // que **sólo pudiera existir UN enlace vivo por workspace**: hay un
      // índice único parcial `uq_invitation_pending` sobre
      // (workspace_id, email) WHERE status = 'pending'
      // (migración 20261014193100, L129-131). El SEGUNDO enlace reventaba con
      // P2002 → 500 con cuerpo vacío, y eso es exactamente lo que hacía caer a
      // V-INV-01b y V-INV-02.
      //
      // Ahora cada enlace lleva etiqueta propia:
      // `enlace-compartido+<selector>@ceiba.local`. Sigue siendo reconocible
      // (el servidor lo marca con `esEnlace`) y ya no choca consigo mismo.
      // ───────────────────────────────────────────────────────────────────
      assert.ok(
        cuerpo.email.startsWith('enlace-compartido+') && cuerpo.email.endsWith('@ceiba.local'),
        `un enlace sin destinatario lleva buzón etiquetado único; vino '${cuerpo.email}'`,
      );

      // Y la prueba que de verdad importa: un SEGUNDO enlace del mismo
      // workspace también se crea. Antes era imposible.
      const segundo = await pedir(entorno, {
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/invitations`,
        payload: { role: 'viewer' },
        cookies: duena.cookies,
        csrf: duena.csrf,
      });
      assert.equal(
        segundo.statusCode,
        201,
        `un workspace tiene que admitir MÁS DE UN enlace vivo: ${segundo.body}`,
      );
      assert.notEqual(
        (segundo.json() as { email: string }).email,
        cuerpo.email,
        'dos enlaces vivos no pueden compartir buzón: chocarían con uq_invitation_pending',
      );

      // Y el enlace SIRVE: el token resuelve la invitación.
      const consulta = await pedir(entorno, {
        method: 'GET',
        url: `/api/v1/invitations/${cuerpo.inviteToken}`,
        cookies: ajeno.cookies,
      });
      assert.equal(consulta.statusCode, 200, consulta.body);
    });

    it('V-INV-01b · el token en claro NO queda guardado en ninguna columna', async () => {
      const respuesta = await pedir(entorno, {
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/invitations`,
        payload: { role: 'viewer' },
        cookies: duena.cookies,
        csrf: duena.csrf,
      });
      assert.equal(respuesta.statusCode, 201);
      const { inviteToken, id } = respuesta.json() as { inviteToken: string; id: string };

      const fila = await entorno.prisma.invitation.findUnique({ where: { id } });
      assert.ok(fila);
      const serializada = JSON.stringify(fila, (_c, v) =>
        typeof v === 'bigint' ? v.toString() : v,
      );
      assert.equal(
        serializada.includes(inviteToken),
        false,
        'el token en claro no puede estar en la fila',
      );
      // El selector (mitad pública) sí; el verificador (mitad secreta) no.
      const [selector, verificador] = inviteToken.split('.');
      assert.equal(fila.tokenSelector, selector);
      assert.ok(verificador);
      assert.equal(serializada.includes(verificador), false, 'el verificador se guarda hasheado');
    });

    it('V-INV-02 · una invitación REVOCADA deja de servir en la petición siguiente', async () => {
      const creada = await pedir(entorno, {
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/invitations`,
        payload: { role: 'viewer' },
        cookies: duena.cookies,
        csrf: duena.csrf,
      });
      assert.equal(creada.statusCode, 201);
      const { inviteToken, id } = creada.json() as { inviteToken: string; id: string };

      const revocacion = await pedir(entorno, {
        method: 'DELETE',
        url: `/api/v1/workspaces/${workspaceId}/invitations/${id}`,
        cookies: duena.cookies,
        csrf: duena.csrf,
      });
      assert.ok(
        revocacion.statusCode >= 200 && revocacion.statusCode < 300,
        `revocar: ${revocacion.statusCode} ${revocacion.body}`,
      );

      // LA PETICIÓN SIGUIENTE. Sin esperas, sin reloj falso: inmediato.
      const intento = await pedir(entorno, {
        method: 'POST',
        url: `/api/v1/invitations/${inviteToken}/accept`,
        cookies: ajeno.cookies,
        csrf: ajeno.csrf,
      });
      assert.ok(
        intento.statusCode >= 400,
        `una invitación revocada NO puede aceptarse; devolvió ${intento.statusCode} ${intento.body}`,
      );

      // Y no se creó la pertenencia.
      const miembro = await entorno.prisma.workspaceMember.findUnique({
        where: { workspaceId_userId: { workspaceId, userId: ajeno.usuarioId } },
      });
      assert.equal(miembro, null, 'el ajeno no puede haber entrado con un enlace revocado');
    });

    it('V-INV-03 · COLECCIÓN: una sola llamada devuelve una URL ABSOLUTA pegable', async () => {
      const respuesta = await pedir(entorno, {
        method: 'POST',
        url: `/api/v1/collections/${collectionId}/shares`,
        payload: { permission: 'viewer', requiresAccessCode: false },
        cookies: duena.cookies,
        csrf: duena.csrf,
      });
      assert.equal(respuesta.statusCode, 201, respuesta.body);

      const cuerpo = respuesta.json() as {
        share: { id: string; slug: string; url: string };
        inviteUrl: string;
        accessCode: string | null;
      };

      // Mismo nombre de campo que el workspace: la interfaz lee `inviteUrl` en
      // los dos casos. Ésta es la simetría que pedía la prueba de aceptación.
      assert.ok(cuerpo.inviteUrl, 'debe venir `inviteUrl` también para la colección');
      assert.equal(cuerpo.inviteUrl, cuerpo.share.url, '`inviteUrl` es alias de `share.url`');
      assert.ok(
        cuerpo.inviteUrl.startsWith(`${ORIGEN_DE_PRUEBA}/`),
        `URL absoluta del origen público; vino '${cuerpo.inviteUrl}'`,
      );
      assert.doesNotThrow(() => new URL(cuerpo.inviteUrl));
      assert.ok(cuerpo.inviteUrl.includes(cuerpo.share.slug));

      // Sin código de acceso pedido, no hay segundo dato que pegar.
      assert.equal(cuerpo.accessCode, null);

      // Y se puede listar lo vigente desde la misma colección.
      const listado = await pedir(entorno, {
        method: 'GET',
        url: `/api/v1/collections/${collectionId}/shares`,
        cookies: duena.cookies,
      });
      assert.equal(listado.statusCode, 200, listado.body);
      const shares = (listado.json() as { shares: Array<{ id: string; url: string }> }).shares;
      assert.ok(shares.some((s) => s.id === cuerpo.share.id));
    });

    it('V-INV-04 · un enlace de COLECCIÓN revocado deja de servir en la petición siguiente', async () => {
      const creada = await pedir(entorno, {
        method: 'POST',
        url: `/api/v1/collections/${collectionId}/shares`,
        payload: { permission: 'viewer', requiresAccessCode: false },
        cookies: duena.cookies,
        csrf: duena.csrf,
      });
      assert.equal(creada.statusCode, 201, creada.body);
      const { share } = creada.json() as { share: { id: string; slug: string } };

      // Antes de revocar, el enlace responde.
      const antes = await pedir(entorno, { method: 'GET', url: `/api/v1/share/${share.slug}` });
      assert.equal(antes.statusCode, 200, `el enlace debería servir antes de revocar: ${antes.body}`);

      const revocacion = await pedir(entorno, {
        method: 'POST',
        url: `/api/v1/shares/${share.id}/revoke`,
        cookies: duena.cookies,
        csrf: duena.csrf,
      });
      assert.equal(revocacion.statusCode, 200, revocacion.body);

      // ───────────────────────────────────────────────────────────────────
      // CORRECCIÓN (darkware, 2026-10-21). Esta prueba afirmaba
      // `notEqual(statusCode, 200)` y fallaba. El defecto estaba AQUÍ, no en
      // el servidor, y lo comprobé con una sonda real antes de tocar nada.
      //
      // `GET /share/:slug` devuelve 200 con `code_required` también cuando el
      // enlace está revocado o caducado, **a propósito**:
      // `share-public.controller.ts:78` («No se puede enumerar slugs desde
      // aquí») y `share-access.service.ts:115-122`. Si un enlace revocado
      // devolviera 404 y uno vivo 200, cualquiera podría enumerar qué slugs
      // existieron. `C-CODE-04` mide incluso los TIEMPOS para que no se
      // distingan.
      //
      // Lo que sí hay que exigir —y es lo que de verdad protege al usuario—
      // es que el enlace deje de estar ABIERTO y que el contenido muera. Lo
      // segundo ya lo prueba `C-CODE-06` en `sharing-fase5.test.ts:863`
      // (401 en la petición siguiente e invalidación en cascada de las
      // sesiones). Aquí se comprueba el cambio de estado y la fila.
      // ───────────────────────────────────────────────────────────────────
      const despues = await pedir(entorno, { method: 'GET', url: `/api/v1/share/${share.slug}` });
      assert.equal(despues.statusCode, 200, 'la página de acceso sigue siendo indistinguible');
      const estadoDespues = (despues.json() as { estado: string }).estado;
      assert.notEqual(
        estadoDespues,
        'open',
        `un enlace revocado no puede seguir ABIERTO; devolvió '${estadoDespues}'`,
      );
      assert.equal(
        estadoDespues,
        'code_required',
        'revocado y caducado tienen que ser indistinguibles de «pide código»',
      );

      const fila = await entorno.prisma.sharedLink.findUnique({ where: { id: share.id } });
      assert.equal(fila?.state, 'revoked');
      assert.ok(fila?.revokedAt instanceof Date);
    });

    it('V-INV-05 · un AJENO no puede generar el enlace de una colección que no es suya', async () => {
      const respuesta = await pedir(entorno, {
        method: 'POST',
        url: `/api/v1/collections/${collectionId}/shares`,
        payload: { permission: 'viewer', requiresAccessCode: false },
        cookies: ajeno.cookies,
        csrf: ajeno.csrf,
      });
      assert.ok(
        respuesta.statusCode === 403 || respuesta.statusCode === 404,
        `un ajeno debe recibir 403/404; recibió ${respuesta.statusCode} ${respuesta.body}`,
      );
    });
  });

  // =========================================================================
  // Entornos de colección: sin esto, P6 no tiene nada que eclipsar
  // =========================================================================

  describe('Entornos por alcance', () => {
    it('V-ENT-01 · se puede crear un entorno de COLECCIÓN por la API y se marca su alcance', async () => {
      const respuesta = await pedir(entorno, {
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/environments`,
        payload: {
          name: `Entorno API de colección ${marca}`,
          collectionId,
          variables: [{ key: 'desde_api', value: 'ok', enabled: true }],
        },
        cookies: duena.cookies,
        csrf: duena.csrf,
      });
      assert.equal(respuesta.statusCode, 201, respuesta.body);
      const creado = respuesta.json() as {
        id: string;
        collectionId: string | null;
        scope: string;
      };
      assert.equal(creado.collectionId, collectionId);
      assert.equal(creado.scope, 'collection');

      const fila = await entorno.prisma.environment.findUnique({ where: { id: creado.id } });
      assert.equal(fila?.collectionId, collectionId, 'la columna real debe quedar escrita');

      // Y la variable aparece ya con alcance `collection` en el autocompletado.
      const { items } = await leerVariables(entorno, duena, collectionId);
      const desdeApi = items.find((v) => v.key === 'desde_api');
      assert.ok(desdeApi);
      assert.equal(desdeApi.scope, 'collection');
    });

    it('V-ENT-02 · sin collectionId el entorno sigue siendo del workspace (sin regresión)', async () => {
      const respuesta = await pedir(entorno, {
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/environments`,
        payload: { name: `Entorno API de workspace ${marca}` },
        cookies: duena.cookies,
        csrf: duena.csrf,
      });
      assert.equal(respuesta.statusCode, 201, respuesta.body);
      const creado = respuesta.json() as { collectionId: string | null; scope: string };
      assert.equal(creado.collectionId, null);
      assert.equal(creado.scope, 'workspace');
    });

    it('V-ENT-03 · una colección de OTRO workspace es 404, no una FK rota', async () => {
      const otroMarca = `${marca}b`;
      const otro = await crearWorkspaceYColeccion(entorno, ajeno, otroMarca);

      const respuesta = await pedir(entorno, {
        method: 'POST',
        url: `/api/v1/workspaces/${workspaceId}/environments`,
        payload: { name: `Entorno cruzado ${marca}`, collectionId: otro.collectionId },
        cookies: duena.cookies,
        csrf: duena.csrf,
      });
      assert.equal(respuesta.statusCode, 404, respuesta.body);
    });
  });
});
