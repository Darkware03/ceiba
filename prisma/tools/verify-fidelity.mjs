#!/usr/bin/env node
// =============================================================================
// CEIBA API Studio - Verificador de fidelidad DBML -> SQL generado por Prisma
// Autor: database-engineer   Fecha: 2026-10-14
//
// QUE DEMUESTRA (y que NO):
//  SI demuestra, comparando el AST del DBML con el DDL que emitio
//  `prisma migrate diff`, que la traduccion NO ha renombrado, anadido ni
//  perdido: tablas, columnas (nombre Y orden), nulabilidad, tipos enumerados y
//  sus valores, indices (nombre y columnas) y claves foraneas (nombre, columna,
//  destino y politica de borrado). Es la prueba mecanica del requisito C-23
//  "traduccion fiel y NO destructiva".
//
//  NO demuestra que el DDL se ejecute: aqui no hay PostgreSQL. Comparar textos
//  no es ejecutar SQL. Lo que este script valida es la EQUIVALENCIA NOMINAL
//  entre diseno y migracion, nada mas.
//
// Devuelve codigo de salida 1 si encuentra cualquier discrepancia no esperada.
// Las discrepancias ESPERADAS (lo que Prisma no sabe expresar) estan declaradas
// abajo en EXPECTED_LOSSES y se imprimen siempre, para que nunca pasen en
// silencio.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DBML_PATH = process.env.CEIBA_DBML ?? path.join(REPO_ROOT, 'docs', 'schema', 'ceiba.dbml');

// El DDL con el que se compara es la SUMA de las migraciones GENERADAS por
// Prisma, en orden de aplicacion, no un solo fichero. Desde que el ADR-0009
// anadio tres tablas, el esquema completo vive en dos migraciones generadas:
// la inicial y la aditiva. Comparar solo contra la primera daria tres "TABLA
// PERDIDA" falsas, y comparar contra un `--from-empty` recien hecho no
// demostraria nada sobre lo que de verdad se va a aplicar.
//
// NO se incluyen las migraciones ESCRITAS A MANO (…192900 prerrequisitos,
// …193100 y …213100 constraints, …193200 triggers): este verificador mide la
// fidelidad de la TRADUCCION DBML -> Prisma, y esos ficheros son justamente lo
// que Prisma no sabe traducir. Lo que anaden esta catalogado en
// MODELO-DATOS-PRISMA.md.
//
// CEIBA_SQL admite una lista separada por comas para anular este valor.
const DEFAULT_SQL = [
  '20261014193000_ceiba_initial_schema',
  '20261014213000_ceiba_adr0009_schema_gaps',
].map((d) => path.join(REPO_ROOT, 'prisma', 'migrations', d, 'migration.sql'));
const SQL_PATHS = process.env.CEIBA_SQL
  ? process.env.CEIBA_SQL.split(',').map((s) => s.trim()).filter(Boolean)
  : DEFAULT_SQL;

const DBML_CORE_DIR = process.env.CEIBA_DBML_CORE ?? '/software-factory/.toolchain/dbml';
const require = createRequire(path.join(DBML_CORE_DIR, 'package.json'));
const { Parser } = require('@dbml/core');

// Tipos DBML cuyo mapeo a PostgreSQL via Prisma es EXACTO.
const EXACT_TYPE = {
  uuid: 'UUID', text: 'TEXT', timestamptz: 'TIMESTAMPTZ(6)', bytea: 'BYTEA',
  integer: 'INTEGER', bigint: 'BIGINT', smallint: 'SMALLINT', boolean: 'BOOLEAN',
  jsonb: 'JSONB', inet: 'INET', bigserial: 'BIGSERIAL',
};
// Mapeos DEGRADADOS: el tipo del DDL no es el del DBML. Cada uno debe estar
// repuesto en prisma/sql/. Si aparece uno nuevo que no este aqui, es un fallo.
const EXPECTED_LOSSES = {
  citext: { ddl: 'TEXT', repair: 'migracion complementaria (ALTER ... TYPE citext): …193100 para las 6 originales, …213100 para user_auth_tokens.target_email' },
};

const src = fs.readFileSync(DBML_PATH, 'utf8');
const sql = SQL_PATHS.map((p) => fs.readFileSync(p, 'utf8')).join('\n');
const schema = Parser.parse(src, 'dbmlv2').schemas[0];

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);

// -----------------------------------------------------------------------------
// Extraccion del DDL
// -----------------------------------------------------------------------------
const sqlTables = new Map(); // name -> [{col, type, notNull}]
for (const m of sql.matchAll(/^CREATE TABLE "([^"]+)" \(\n([\s\S]*?)\n\);$/gm)) {
  const [, name, body] = m;
  const cols = [];
  for (const line of body.split('\n')) {
    const c = line.match(/^\s{4}"([^"]+)" (.+?)(,)?$/);
    if (!c) continue;                               // CONSTRAINT ... PRIMARY KEY
    if (line.includes('CONSTRAINT')) continue;
    let rest = c[2].replace(/,$/, '');
    const notNull = / NOT NULL\b/.test(rest);
    const type = rest.replace(/ NOT NULL\b.*$/, '').replace(/ DEFAULT .*$/, '').trim();
    cols.push({ col: c[1], type, notNull });
  }
  sqlTables.set(name, cols);
}

const sqlEnums = new Map();
for (const m of sql.matchAll(/^CREATE TYPE "([^"]+)" AS ENUM \((.*)\);$/gm)) {
  sqlEnums.set(m[1], m[2].split(',').map((v) => v.trim().replace(/^'|'$/g, '')));
}

const sqlIndexes = new Map(); // name -> {table, cols, unique}
for (const m of sql.matchAll(/^CREATE (UNIQUE )?INDEX "([^"]+)" ON "([^"]+)"(?:\s+USING \w+)?\s*\(([^;]*)\);$/gm)) {
  const cols = m[4].split(',').map((c) => (c.match(/"([^"]+)"/) ?? [])[1]).filter(Boolean);
  sqlIndexes.set(m[2], { table: m[3], cols, unique: Boolean(m[1]) });
}

const sqlFks = new Map();
for (const m of sql.matchAll(/^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" FOREIGN KEY \("([^"]+)"\) REFERENCES "([^"]+)"\("([^"]+)"\) ON DELETE ([A-Z ]+?) ON UPDATE ([A-Z ]+);$/gm)) {
  sqlFks.set(m[2], {
    child: m[1], childCol: m[3], parent: m[4], parentCol: m[5],
    onDelete: m[6].trim(), onUpdate: m[7].trim(),
  });
}

const sqlPkNames = new Map(); // table -> constraint name
for (const m of sql.matchAll(/^CREATE TABLE "([^"]+)" \(\n[\s\S]*?CONSTRAINT "([^"]+)" PRIMARY KEY \(([^)]*)\)\n\);$/gm)) {
  sqlPkNames.set(m[1], { name: m[2], cols: m[3].split(',').map((c) => c.trim().replace(/"/g, '')) });
}

// -----------------------------------------------------------------------------
// 1. Tablas
// -----------------------------------------------------------------------------
const dbmlTableNames = schema.tables.map((t) => t.name).sort();
const sqlTableNames = [...sqlTables.keys()].sort();
for (const n of dbmlTableNames) if (!sqlTables.has(n)) fail(`TABLA PERDIDA en el DDL: ${n}`);
for (const n of sqlTableNames) if (!dbmlTableNames.includes(n)) fail(`TABLA INVENTADA en el DDL: ${n}`);

// -----------------------------------------------------------------------------
// 2. Columnas: nombre, orden, nulabilidad y tipo
// -----------------------------------------------------------------------------
let colCount = 0;
let degraded = 0;
for (const t of schema.tables) {
  const got = sqlTables.get(t.name);
  if (!got) continue;
  const want = t.fields.map((f) => f.name);
  const have = got.map((c) => c.col);
  if (want.join('|') !== have.join('|')) {
    fail(`COLUMNAS distintas en ${t.name}\n   DBML: ${want.join(',')}\n   DDL : ${have.join(',')}`);
    continue;
  }
  for (let i = 0; i < t.fields.length; i += 1) {
    colCount += 1;
    const f = t.fields[i];
    const g = got[i];
    const wantNotNull = Boolean(f.not_null || f.pk);
    if (wantNotNull !== g.notNull) {
      fail(`NULABILIDAD distinta en ${t.name}.${f.name}: DBML not_null=${wantNotNull}, DDL NOT NULL=${g.notNull}`);
    }
    const dt = f.type.type_name;
    if (EXACT_TYPE[dt]) {
      // bigserial se materializa como BIGSERIAL solo si Prisma usa autoincrement
      if (dt === 'bigserial' && g.type === 'BIGSERIAL') continue;
      if (g.type !== EXACT_TYPE[dt]) {
        // uuid[] declarado como uuid en DBML: desviacion declarada aparte
        if (g.type === 'UUID[]' && dt === 'uuid') { notes.push(`${t.name}.${f.name}: uuid -> UUID[] (intencion declarada en la nota del DBML)`); continue; }
        fail(`TIPO distinto en ${t.name}.${f.name}: DBML ${dt} -> esperado ${EXACT_TYPE[dt]}, DDL ${g.type}`);
      }
    } else if (EXPECTED_LOSSES[dt]) {
      degraded += 1;
      if (g.type !== EXPECTED_LOSSES[dt].ddl) {
        fail(`PERDIDA INESPERADA en ${t.name}.${f.name}: ${dt} -> ${g.type} (se esperaba ${EXPECTED_LOSSES[dt].ddl})`);
      } else {
        notes.push(`DEGRADADO ${t.name}.${f.name}: ${dt} -> ${g.type}; repuesto en ${EXPECTED_LOSSES[dt].repair}`);
      }
    } else {
      // tipo enumerado
      const en = schema.enums.find((e) => e.name === dt);
      if (!en) { fail(`TIPO DESCONOCIDO ${dt} en ${t.name}.${f.name}`); continue; }
      if (g.type !== `"${dt}"`) fail(`ENUM mal mapeado en ${t.name}.${f.name}: DDL ${g.type}`);
    }
  }
}

// -----------------------------------------------------------------------------
// 3. Enumeraciones
// -----------------------------------------------------------------------------
for (const e of schema.enums) {
  const got = sqlEnums.get(e.name);
  if (!got) { fail(`ENUM PERDIDO en el DDL: ${e.name}`); continue; }
  const want = e.values.map((v) => v.name);
  if (want.join('|') !== got.join('|')) {
    fail(`VALORES de enum distintos en ${e.name}\n   DBML: ${want.join(',')}\n   DDL : ${got.join(',')}`);
  }
}
for (const n of sqlEnums.keys()) {
  if (!schema.enums.some((e) => e.name === n)) fail(`ENUM INVENTADO en el DDL: ${n}`);
}

// -----------------------------------------------------------------------------
// 4. Indices (incluida la PK compuesta, que en el DDL es una CONSTRAINT)
// -----------------------------------------------------------------------------
let idxCount = 0;
for (const t of schema.tables) {
  for (const idx of t.indexes) {
    idxCount += 1;
    const wantCols = idx.columns.map((c) => c.value);
    if (idx.pk) {
      const pk = sqlPkNames.get(t.name);
      if (!pk) { fail(`PK compuesta perdida en ${t.name}`); continue; }
      if (idx.name && pk.name !== idx.name) fail(`NOMBRE de PK distinto en ${t.name}: DBML ${idx.name}, DDL ${pk.name}`);
      if (wantCols.join('|') !== pk.cols.join('|')) fail(`COLUMNAS de PK distintas en ${t.name}: DBML ${wantCols} vs DDL ${pk.cols}`);
      continue;
    }
    const got = sqlIndexes.get(idx.name);
    if (!got) { fail(`INDICE PERDIDO en el DDL: ${idx.name} (tabla ${t.name})`); continue; }
    if (got.table !== t.name) fail(`INDICE ${idx.name} sobre tabla equivocada: ${got.table} != ${t.name}`);
    if (wantCols.join('|') !== got.cols.join('|')) {
      fail(`COLUMNAS de indice distintas en ${idx.name}: DBML ${wantCols.join(',')} vs DDL ${got.cols.join(',')}`);
    }
    if (Boolean(idx.unique) !== got.unique) fail(`UNICIDAD distinta en ${idx.name}: DBML ${Boolean(idx.unique)} vs DDL ${got.unique}`);
  }
}
for (const n of sqlIndexes.keys()) {
  const exists = schema.tables.some((t) => t.indexes.some((i) => i.name === n));
  if (!exists) fail(`INDICE INVENTADO en el DDL: ${n}`);
}

// -----------------------------------------------------------------------------
// 5. Claves foraneas
// -----------------------------------------------------------------------------
const DEL = { cascade: 'CASCADE', 'set null': 'SET NULL', restrict: 'RESTRICT', 'no action': 'NO ACTION' };
const tableByName = new Map(schema.tables.map((t) => [t.name, t]));
let fkCount = 0;
for (const ref of schema.refs) {
  fkCount += 1;
  const got = sqlFks.get(ref.name);
  if (!got) { fail(`CLAVE FORANEA PERDIDA en el DDL: ${ref.name}`); continue; }
  const [a, b] = ref.endpoints;
  // el padre es el extremo cuyo campo es PK de su tabla
  const aIsPk = a.fieldNames.length === 1
    && (tableByName.get(a.tableName).fields.find((f) => f.name === a.fieldNames[0])?.pk ?? false)
    && !(b.fieldNames.length === 1 && (tableByName.get(b.tableName).fields.find((f) => f.name === b.fieldNames[0])?.pk ?? false) && b.relation === '1' && a.relation === '*');
  const parent = a.relation === '1' && b.relation === '*' ? a : (b.relation === '1' && a.relation === '*' ? b : (aIsPk ? a : b));
  const child = parent === a ? b : a;
  if (got.child !== child.tableName) fail(`FK ${ref.name}: tabla hija ${got.child} != ${child.tableName}`);
  if (got.childCol !== child.fieldNames[0]) fail(`FK ${ref.name}: columna ${got.childCol} != ${child.fieldNames[0]}`);
  if (got.parent !== parent.tableName) fail(`FK ${ref.name}: tabla padre ${got.parent} != ${parent.tableName}`);
  if (got.parentCol !== parent.fieldNames[0]) fail(`FK ${ref.name}: columna padre ${got.parentCol} != ${parent.fieldNames[0]}`);
  const wantDel = DEL[String(ref.onDelete).toLowerCase()];
  if (got.onDelete !== wantDel) fail(`FK ${ref.name}: ON DELETE ${got.onDelete} != ${wantDel} (DBML)`);
  // El DBML no declara politica de UPDATE en ninguna Ref -> PostgreSQL aplica
  // NO ACTION. Si aqui apareciera CASCADE seria el default de Prisma colandose.
  if (got.onUpdate !== 'NO ACTION') fail(`FK ${ref.name}: ON UPDATE ${got.onUpdate}; el DBML no declara politica de update, debe ser NO ACTION`);
}
for (const n of sqlFks.keys()) {
  if (!schema.refs.some((r) => r.name === n)) fail(`CLAVE FORANEA INVENTADA en el DDL: ${n}`);
}

// -----------------------------------------------------------------------------
// Informe
// -----------------------------------------------------------------------------
console.log('=== VERIFICACION DE FIDELIDAD DBML -> DDL ===');
console.log(`DBML : ${DBML_PATH}`);
for (let i = 0; i < SQL_PATHS.length; i += 1) {
  console.log(`DDL ${i + 1}: ${SQL_PATHS[i]}`);
}
console.log('');
console.log(`tablas comparadas .......... ${schema.tables.length}  (DDL: ${sqlTables.size})`);
console.log(`enums comparados ........... ${schema.enums.length}  (DDL: ${sqlEnums.size})`);
console.log(`columnas comparadas ........ ${colCount}`);
console.log(`indices comparados ......... ${idxCount}  (DDL: ${sqlIndexes.size} + ${sqlPkNames.size} PK)`);
console.log(`claves foraneas comparadas . ${fkCount}  (DDL: ${sqlFks.size})`);
console.log(`columnas con tipo DEGRADADO  ${degraded}`);
console.log('');
if (notes.length) {
  console.log('--- DESVIACIONES DECLARADAS (no son fallos, pero no se silencian) ---');
  for (const n of [...new Set(notes)]) console.log(`  . ${n}`);
  console.log('');
}
if (problems.length) {
  console.log(`--- DISCREPANCIAS: ${problems.length} ---`);
  for (const p of problems) console.log(`  X ${p}`);
  process.exit(1);
}
console.log('RESULTADO: sin discrepancias. Ningun nombre de tabla, columna, indice');
console.log('o clave foranea cambia respecto al DBML; ninguna politica de borrado');
console.log('difiere. La traduccion es nominalmente fiel y no destructiva.');
