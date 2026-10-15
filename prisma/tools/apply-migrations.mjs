#!/usr/bin/env node
/**
 * Aplica las migraciones en orden contra un PostgreSQL real y reporta el estado
 * resultante del catálogo.
 *
 * No usa `prisma migrate deploy` a propósito: ese comando exige el cliente
 * generado y una configuración completa, y aquí lo que interesa es ejecutar el
 * SQL **tal cual se entrega**, que es lo que correrá en el servidor del cliente.
 * Si el SQL falla, debe fallar aquí igual que allí.
 *
 * Uso:
 *   node provision-postgres.mjs
 *   node apply-migrations.mjs [urlDeConexion]
 */
import { Client } from 'pg';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const url = process.argv[2] ?? process.env.DATABASE_URL ?? 'postgresql://ceiba@127.0.0.1:55432/ceiba';

const cliente = new Client({ connectionString: url });
await cliente.connect();

const migraciones = readdirSync(DIR)
  .filter((d) => existsSync(join(DIR, d, 'migration.sql')))
  .sort();

console.log(`\n${migraciones.length} migraciones en ${DIR}\n`);

let aplicadas = 0;
for (const m of migraciones) {
  const sql = readFileSync(join(DIR, m, 'migration.sql'), 'utf8');
  process.stdout.write(`  ${m} ... `);
  try {
    await cliente.query(sql);
    console.log(`OK (${sql.split('\n').length} lineas)`);
    aplicadas += 1;
  } catch (e) {
    console.log('FALLO');
    console.log(`      ${e.message.split('\n')[0]}`);
    if (e.position) console.log(`      posicion ${e.position}`);
    console.log(`\n${aplicadas} de ${migraciones.length} aplicadas antes del fallo.`);
    await cliente.end();
    process.exit(1);
  }
}

const q = async (sql) => (await cliente.query(sql)).rows[0].n;
const tablas = await q(
  `SELECT count(*)::int n FROM information_schema.tables WHERE table_schema=current_schema()`,
);
const indices = await q(`SELECT count(*)::int n FROM pg_indexes WHERE schemaname=current_schema()`);
const fks = await q(`SELECT count(*)::int n FROM pg_constraint WHERE contype='f'`);
const checks = await q(`SELECT count(*)::int n FROM pg_constraint WHERE contype='c'`);
const triggers = await q(`SELECT count(*)::int n FROM pg_trigger WHERE NOT tgisinternal`);
const enums = (
  await cliente.query(`SELECT DISTINCT enumtypid FROM pg_enum`)
).rowCount;

console.log(`\n${aplicadas} de ${migraciones.length} migraciones aplicadas.`);
console.log(
  `TABLAS=${tablas}  INDICES=${indices}  FK=${fks}  CHECK=${checks}  ENUMS=${enums}  TRIGGERS=${triggers}`,
);

await cliente.end();
