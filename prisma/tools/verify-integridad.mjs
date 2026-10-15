#!/usr/bin/env node
/**
 * Pruebas de integridad CONTRA UN PostgreSQL REAL.
 *
 * Por qué existe
 * --------------
 * Hasta ahora el esquema sólo se había validado *sintácticamente*: `prisma
 * validate`, el parser de DBML y `libpg-query` dicen si el SQL está bien
 * escrito, no si **se comporta**. Los 6 triggers los declaró su autor como
 * «propuesta mía, no transcripción» y «lo que menos confianza merece» de todo
 * el entregable. Un trigger que nunca se ejecuta es una promesa, no un control.
 *
 * Esto los ejecuta: cada prueba provoca la condición y comprueba el efecto.
 *
 * Cómo levantar el motor sin Docker y sin root
 * --------------------------------------------
 *   node prisma/tools/provision-postgres.mjs    # descarga PostgreSQL 16 e inicia
 *   npm --prefix prisma/tools install
 *   node prisma/tools/verify-integridad.mjs
 *
 * DOS HECHOS DEL ESQUEMA REAL QUE CONVIENE SABER ANTES DE LEER EL CÓDIGO
 * ---------------------------------------------------------------------
 * 1. **Los INSERT deben traer su `id`.** El DBML declara
 *    `id uuid [pk, default: uuidv7()]`, pero el DDL generado **no lleva ese
 *    DEFAULT** (Prisma genera el id en cliente) y, además, `uuidv7()` no existe
 *    en PostgreSQL 16 — llega en la 18. De las 41 tablas sólo 4 columnas `id`
 *    tienen default en el motor. Estas pruebas generan el id en cliente, que es
 *    lo que hace la aplicación.
 * 2. **Los nombres son los del esquema, no los «evidentes»**: `owner_user_id`,
 *    `materialized_path`, `url_template`, `sort_key`, `created_by_user_id`. Se
 *    leyeron de `information_schema`, no se supusieron.
 * 3. **`trg_workspace_owner_guard` es un CONSTRAINT TRIGGER `DEFERRABLE
 *    INITIALLY DEFERRED`: se dispara en el COMMIT, no en la sentencia.** Como
 *    estas pruebas se aislan con `BEGIN ... ROLLBACK`, el commit nunca llega y
 *    el trigger **no se ejecutaria jamas**: la prueba daria un falso verde
 *    tanto si el control funciona como si no. Hay que forzarlo con
 *    `SET CONSTRAINTS ... IMMEDIATE`. Es la diferencia entre probar el control
 *    y probar que la transaccion se deshizo.
 *
 * Uso: verify-integridad.mjs [urlDeConexion]
 * Salida: 0 si todas pasan, 1 si alguna falla.
 */
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

const URL_POR_DEFECTO = 'postgresql://ceiba@127.0.0.1:55432/ceiba';
const url = process.argv[2] ?? process.env.DATABASE_URL ?? URL_POR_DEFECTO;

const resultados = [];
let cliente;

async function prueba(nombre, fn) {
  try {
    await cliente.query('BEGIN');
    await fn();
    await cliente.query('ROLLBACK');
    resultados.push({ nombre, ok: true });
    console.log(`  PASA   ${nombre}`);
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => {});
    resultados.push({ nombre, ok: false, error: e.message.split('\n')[0] });
    console.log(`  FALLA  ${nombre}`);
    console.log(`         ${e.message.split('\n')[0]}`);
  }
}

async function debeFallar(sql, params, fragmentoEsperado) {
  let fallo = null;
  try {
    await cliente.query(sql, params);
  } catch (e) {
    fallo = e;
  }
  if (!fallo) throw new Error('se esperaba un error y la operacion fue aceptada');
  if (fragmentoEsperado && !fallo.message.toLowerCase().includes(fragmentoEsperado.toLowerCase())) {
    throw new Error(`fallo por el motivo equivocado: ${fallo.message.split('\n')[0]}`);
  }
}

function afirmar(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}

const sufijo = () => Math.random().toString(36).slice(2, 10);

/* ---------- datos mínimos, con los nombres de columna reales ---------- */

async function crearUsuario() {
  const id = randomUUID();
  await cliente.query(
    `INSERT INTO users (id, email, display_name) VALUES ($1, $2, 'Prueba')`,
    [id, `u-${sufijo()}@ceiba.test`],
  );
  return id;
}

async function crearWorkspace(propietario) {
  const ws = randomUUID();
  await cliente.query(
    `INSERT INTO workspaces (id, slug, name, owner_user_id) VALUES ($1,$2,'WS',$3)`,
    [ws, `ws-${sufijo()}`, propietario],
  );
  await cliente.query(
    `INSERT INTO workspace_members (id, workspace_id, user_id, role)
     VALUES ($1,$2,$3,'owner')`,
    [randomUUID(), ws, propietario],
  );
  return ws;
}

async function crearColeccion(ws) {
  const id = randomUUID();
  await cliente.query(
    `INSERT INTO collections (id, workspace_id, slug, name, sort_key)
     VALUES ($1,$2,$3,'Col','a0')`,
    [id, ws, `col-${sufijo()}`],
  );
  return id;
}

/* ---------- pruebas ---------- */

async function main() {
  cliente = new Client({ connectionString: url });
  await cliente.connect();
  const v = await cliente.query('select version()');
  console.log(`\nMotor: ${v.rows[0].version.split(',')[0]}`);
  console.log(`Base : ${url.replace(/:[^:@/]*@/, ':***@')}\n`);

  console.log('TRIGGERS');

  await prueba('trg_workspace_owner_guard impide quedarse sin propietario', async () => {
    const u = await crearUsuario();
    const ws = await crearWorkspace(u);
    await cliente.query(`DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2`, [ws, u]);
    // El trigger es DEFERRABLE INITIALLY DEFERRED: sin esto no se evalua nunca
    // dentro de una transaccion que termina en ROLLBACK.
    await debeFallar(`SET CONSTRAINTS ALL IMMEDIATE`, [], 'owner');
  });

  await prueba('trg_workspace_owner_guard permite borrar si queda otro propietario', async () => {
    const u1 = await crearUsuario();
    const u2 = await crearUsuario();
    const ws = await crearWorkspace(u1);
    await cliente.query(
      `INSERT INTO workspace_members (id,workspace_id,user_id,role) VALUES ($1,$2,$3,'owner')`,
      [randomUUID(), ws, u2],
    );
    await cliente.query(`DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2`, [ws, u1]);
    // Se fuerza la evaluacion igual que arriba: si no, este verde no
    // demostraria nada sobre el trigger.
    await cliente.query(`SET CONSTRAINTS ALL IMMEDIATE`);
    const r = await cliente.query(
      `SELECT count(*)::int n FROM workspace_members WHERE workspace_id=$1 AND role='owner'`,
      [ws],
    );
    afirmar(r.rows[0].n === 1, `quedaban ${r.rows[0].n} propietarios, se esperaba 1`);
  });

  await prueba('trg_folder_path rellena materialized_path en una carpeta raiz', async () => {
    const u = await crearUsuario();
    const col = await crearColeccion(await crearWorkspace(u));
    const r = await cliente.query(
      `INSERT INTO collection_folders (id, collection_id, name, sort_key)
       VALUES ($1,$2,'raiz','a0') RETURNING materialized_path`,
      [randomUUID(), col],
    );
    afirmar(
      r.rows[0].materialized_path != null && r.rows[0].materialized_path !== '',
      'el trigger no rellenó materialized_path (es NOT NULL y sin default)',
    );
  });

  await prueba('trg_folder_path anida la ruta de una subcarpeta bajo la del padre', async () => {
    const u = await crearUsuario();
    const col = await crearColeccion(await crearWorkspace(u));
    const padre = await cliente.query(
      `INSERT INTO collection_folders (id,collection_id,name,sort_key)
       VALUES ($1,$2,'padre','a0') RETURNING id, materialized_path`,
      [randomUUID(), col],
    );
    const hijo = await cliente.query(
      `INSERT INTO collection_folders (id,collection_id,parent_folder_id,name,sort_key)
       VALUES ($1,$2,$3,'hijo','a0') RETURNING materialized_path`,
      [randomUUID(), col, padre.rows[0].id],
    );
    afirmar(
      hijo.rows[0].materialized_path.length > padre.rows[0].materialized_path.length,
      `la ruta del hijo (${hijo.rows[0].materialized_path}) no desciende de la del padre (${padre.rows[0].materialized_path})`,
    );
  });

  await prueba('trg_folder_path impide el ciclo carpeta -> si misma', async () => {
    const u = await crearUsuario();
    const col = await crearColeccion(await crearWorkspace(u));
    const f = randomUUID();
    await cliente.query(
      `INSERT INTO collection_folders (id,collection_id,name,sort_key) VALUES ($1,$2,'f','a0')`,
      [f, col],
    );
    await debeFallar(`UPDATE collection_folders SET parent_folder_id=$1 WHERE id=$1`, [f], null);
  });

  await prueba('trg_version_number numera las versiones de forma correlativa', async () => {
    const u = await crearUsuario();
    const col = await crearColeccion(await crearWorkspace(u));
    const ins = async () =>
      (
        await cliente.query(
          // ck_version_storage exige EXACTAMENTE uno de snapshot_file_id o
          // snapshot_inline. Se usa el inline.
          `INSERT INTO collection_versions
             (id, collection_id, snapshot_sha256, snapshot_inline, created_by_user_id)
           VALUES ($1,$2,decode(repeat('a',64),'hex'),'{}'::jsonb,$3)
           RETURNING version_number`,
          [randomUUID(), col, u],
        )
      ).rows[0].version_number;
    const a = await ins();
    const b = await ins();
    afirmar(b === a + 1, `numeracion no correlativa: ${a} -> ${b}`);
  });

  console.log('\nRESTRICCIONES DE SEGURIDAD');

  await prueba('el codigo de comparticion NO tiene columna en claro', async () => {
    const r = await cliente.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='share_access_codes'
         AND column_name IN ('code','access_code','share_code','plain_code','code_plain')`,
    );
    afirmar(r.rowCount === 0, `existe columna en claro: ${r.rows.map((x) => x.column_name).join(', ')}`);
    const h = await cliente.query(
      `SELECT count(*)::int n FROM information_schema.columns
       WHERE table_name='share_access_codes' AND column_name='code_verifier_hash'`,
    );
    afirmar(h.rows[0].n === 1, 'falta code_verifier_hash');
  });

  await prueba('response_artifacts.expires_at es NOT NULL (sin artefactos eternos)', async () => {
    const r = await cliente.query(
      `SELECT is_nullable FROM information_schema.columns
       WHERE table_name='response_artifacts' AND column_name='expires_at'`,
    );
    afirmar(r.rowCount === 1, 'no existe response_artifacts.expires_at');
    afirmar(r.rows[0].is_nullable === 'NO', 'expires_at admite NULL: caben artefactos eternos');
  });

  await prueba('un secreto no puede quedar en claro en la fila (CHECK is_secret)', async () => {
    const u = await crearUsuario();
    const col = await crearColeccion(await crearWorkspace(u));
    const req = randomUUID();
    await cliente.query(
      `INSERT INTO api_requests (id, collection_id, name, url_template, sort_key)
       VALUES ($1,$2,'r','https://ejemplo.test','a0')`,
      [req, col],
    );
    await debeFallar(
      `INSERT INTO request_headers (id, api_request_id, name, value, is_secret, secret_id)
       VALUES ($1,$2,'Authorization','Bearer EN-CLARO',true,NULL)`,
      [randomUUID(), req],
      'check',
    );
  });

  await prueba('las 148 claves foraneas existen en el motor', async () => {
    const r = await cliente.query(`SELECT count(*)::int n FROM pg_constraint WHERE contype='f'`);
    afirmar(r.rows[0].n === 148, `hay ${r.rows[0].n} claves foraneas, se esperaban 148`);
  });

  await prueba('ninguna clave foranea propaga ON UPDATE CASCADE', async () => {
    const r = await cliente.query(
      `SELECT count(*)::int n FROM pg_constraint WHERE contype='f' AND confupdtype='c'`,
    );
    afirmar(r.rows[0].n === 0, `${r.rows[0].n} claves foraneas con ON UPDATE CASCADE`);
  });

  await prueba('DIVERGENCIA DOCUMENTADA: el DBML promete uuidv7() y el motor no lo tiene', async () => {
    const f = await cliente.query(`SELECT count(*)::int n FROM pg_proc WHERE proname='uuidv7'`);
    const d = await cliente.query(
      `SELECT count(*)::int n FROM information_schema.columns
       WHERE column_name='id' AND column_default IS NOT NULL`,
    );
    afirmar(
      f.rows[0].n === 0,
      'uuidv7() ya existe en el motor: revisar si procede restaurar los DEFAULT del DBML',
    );
    afirmar(
      d.rows[0].n < 41,
      'todas las tablas tienen DEFAULT en id: la divergencia esta resuelta, actualizar esta prueba',
    );
  });

  await cliente.end();

  const fallan = resultados.filter((r) => !r.ok);
  console.log(`\n${resultados.length - fallan.length} de ${resultados.length} pruebas pasan.`);
  if (fallan.length) {
    console.log('\nFALLAN:');
    fallan.forEach((f) => console.log(`  - ${f.nombre}: ${f.error}`));
    process.exit(1);
  }
  console.log('Integridad del esquema verificada contra PostgreSQL real.');
}

main().catch((e) => {
  console.error(`\nERROR: ${e.message}`);
  process.exit(1);
});
