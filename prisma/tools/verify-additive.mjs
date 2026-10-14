#!/usr/bin/env node
// =============================================================================
// CEIBA API Studio - Prueba mecanica de que una migracion es ADITIVA
// Autor: database-engineer   Fecha: 2026-10-14
//
// POR QUE EXISTE
// C-23 prohibe la reestructuracion destructiva del esquema, y el cliente exige
// autorizacion especifica antes de cualquier migracion que pueda perder datos.
// Decir "mi migracion es aditiva" en un informe no es una prueba: es una
// afirmacion. Este script la convierte en una comprobacion.
//
// QUE DEMUESTRA
// Parsea las migraciones ANTERIORES con la gramatica real de PostgreSQL y
// construye el conjunto de objetos que YA EXISTIAN. Despues parsea las
// migraciones NUEVAS y comprueba, sentencia a sentencia, que:
//
//   1. Ningun objeto PREEXISTENTE se altera, se renombra ni se borra.
//      Un objeto preexistente solo puede aparecer como DESTINO DE REFERENCIA
//      de una clave foranea (REFERENCES "users"("id")), que no lo modifica.
//   2. No hay ninguna sentencia de manipulacion de datos (INSERT, UPDATE,
//      DELETE, TRUNCATE): una migracion de esquema no toca filas.
//   3. Todo objeto que las migraciones nuevas alteran o borran lo han creado
//      ellas mismas unas sentencias antes.
//
// QUE **NO** DEMUESTRA
// Que el SQL se ejecute. Aqui no hay PostgreSQL. Parsear no es ejecutar: no
// valida tipos, ni que un CHECK sea satisfacible, ni que una FK encuentre su
// destino. Demuestra una propiedad ESTRUCTURAL del texto, que es exactamente
// la que C-23 necesita y nada mas.
//
// DEPENDENCIA: libpg-query, resuelta FUERA del arbol del repositorio
// (el brief de fase 1 prohibe instalar en la raiz). Por defecto /tmp/pgparse;
// se anula con CEIBA_PGQUERY.
//
// USO:   node prisma/tools/verify-additive.mjs
// Salida 1 si encuentra cualquier operacion no aditiva.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const MIG = path.join(REPO_ROOT, 'prisma', 'migrations');

const PGQUERY_DIR = process.env.CEIBA_PGQUERY ?? '/tmp/pgparse';
const require = createRequire(path.join(PGQUERY_DIR, 'package.json'));
const { loadModule, parseSync } = require('libpg-query');
await loadModule();

// Migraciones ya entregadas en el commit a2c03bb: definen lo que YA EXISTE.
const HISTORIC = [
  '20261014192900_ceiba_prerequisites',
  '20261014193000_ceiba_initial_schema',
  '20261014193100_ceiba_constraints_and_indexes',
  '20261014193200_ceiba_triggers',
];
// Migraciones nuevas que hay que demostrar aditivas.
const ADDED = [
  '20261014213000_ceiba_adr0009_schema_gaps',
  '20261014213100_ceiba_adr0009_constraints',
];

const sqlOf = (dir) => fs.readFileSync(path.join(MIG, dir, 'migration.sql'), 'utf8');
const stmtsOf = (dir) => parseSync(sqlOf(dir)).stmts.map((s) => s.stmt);
const kindOf = (st) => Object.keys(st)[0];
const listName = (obj) => {
  // {List:{items:[{String:{sval}}...]}} o [{String:{sval}}...]
  const items = obj?.List?.items ?? (Array.isArray(obj) ? obj : [obj]);
  return items.map((i) => i?.String?.sval).filter(Boolean).join('.');
};

// -----------------------------------------------------------------------------
// 1. Inventario de lo que YA EXISTIA
// -----------------------------------------------------------------------------
const pre = {
  tables: new Set(), types: new Set(), indexes: new Set(),
  constraints: new Set(), functions: new Set(), triggers: new Set(),
  extensions: new Set(), columns: new Set(),
};

function collect(st, into) {
  const k = kindOf(st);
  const n = st[k];
  switch (k) {
    case 'CreateStmt': {
      const t = n.relation.relname;
      into.tables.add(t);
      for (const el of n.tableElts ?? []) {
        if (el.ColumnDef) into.columns.add(`${t}.${el.ColumnDef.colname}`);
        if (el.Constraint?.conname) into.constraints.add(el.Constraint.conname);
      }
      break;
    }
    case 'CreateEnumStmt': into.types.add(listName(n.typeName)); break;
    case 'IndexStmt': if (n.idxname) into.indexes.add(n.idxname); break;
    case 'CreateExtensionStmt': into.extensions.add(n.extname); break;
    case 'CreateFunctionStmt': into.functions.add(listName(n.funcname)); break;
    case 'CreateTrigStmt': into.triggers.add(n.trigname); break;
    case 'CreateSchemaStmt': break;
    case 'AlterTableStmt':
      for (const c of n.cmds ?? []) {
        const cmd = c.AlterTableCmd;
        if (cmd?.subtype === 'AT_AddConstraint' && cmd.def?.Constraint?.conname) {
          into.constraints.add(cmd.def.Constraint.conname);
        }
        if (cmd?.subtype === 'AT_AddColumn' && cmd.def?.ColumnDef) {
          into.columns.add(`${n.relation.relname}.${cmd.def.ColumnDef.colname}`);
        }
      }
      break;
    default: break;
  }
}

for (const d of HISTORIC) for (const st of stmtsOf(d)) collect(st, pre);

// -----------------------------------------------------------------------------
// 2. Recorrido de lo NUEVO
// -----------------------------------------------------------------------------
const neo = {
  tables: new Set(), types: new Set(), indexes: new Set(),
  constraints: new Set(), functions: new Set(), triggers: new Set(),
  extensions: new Set(), columns: new Set(),
};
const rows = [];       // una linea por sentencia, para el informe
const problems = [];
const refsToPre = new Set();

// Sentencias que NUNCA pueden aparecer en una migracion aditiva de esquema.
const FORBIDDEN_KINDS = {
  InsertStmt: 'inserta filas', UpdateStmt: 'modifica filas',
  DeleteStmt: 'borra filas', TruncateStmt: 'vacia una tabla',
  RenameStmt: 'renombra un objeto', AlterObjectSchemaStmt: 'mueve un objeto de esquema',
  AlterEnumStmt: 'modifica un tipo enumerado existente',
  ViewStmt: 'crea una vista (no previsto)', DoStmt: 'ejecuta codigo anonimo',
};

for (const dir of ADDED) {
  for (const st of stmtsOf(dir)) {
    const k = kindOf(st);
    const n = st[k];
    let target = '';
    let verdict = '';

    if (FORBIDDEN_KINDS[k]) {
      problems.push(`${dir}: sentencia PROHIBIDA ${k} (${FORBIDDEN_KINDS[k]})`);
      rows.push([dir, k, '-', 'PROHIBIDA']);
      continue;
    }

    switch (k) {
      case 'CreateStmt':
        target = n.relation.relname;
        verdict = 'CREA tabla nueva';
        break;
      case 'CreateEnumStmt':
        target = listName(n.typeName);
        verdict = 'CREA tipo nuevo';
        break;
      case 'IndexStmt':
        target = `${n.idxname} ON ${n.relation.relname}`;
        if (pre.tables.has(n.relation.relname)) {
          problems.push(`${dir}: indice ${n.idxname} sobre la tabla PREEXISTENTE ${n.relation.relname}`);
          verdict = 'NO ADITIVA';
        } else if (pre.indexes.has(n.idxname)) {
          problems.push(`${dir}: el indice ${n.idxname} ya existia; esto lo redefine`);
          verdict = 'NO ADITIVA';
        } else {
          verdict = 'CREA indice sobre tabla nueva';
        }
        break;
      case 'DropStmt': {
        const name = listName(n.objects?.[0]);
        target = `${n.removeType} ${name}`;
        if (n.removeType !== 'OBJECT_INDEX') {
          problems.push(`${dir}: DROP de ${n.removeType} (${name}) no permitido`);
          verdict = 'NO ADITIVA';
        } else if (pre.indexes.has(name)) {
          problems.push(`${dir}: DROP INDEX sobre el indice PREEXISTENTE ${name}`);
          verdict = 'NO ADITIVA';
        } else if (!neo.indexes.has(name)) {
          problems.push(`${dir}: DROP INDEX ${name}, que no lo crea ninguna migracion nueva`);
          verdict = 'NO ADITIVA';
        } else {
          verdict = 'BORRA un indice creado hoy, para sustituirlo por su version PARCIAL';
        }
        break;
      }
      case 'AlterTableStmt': {
        const t = n.relation.relname;
        const subs = (n.cmds ?? []).map((c) => c.AlterTableCmd?.subtype).join(',');
        target = `${t} [${subs}]`;
        if (pre.tables.has(t)) {
          problems.push(`${dir}: ALTER TABLE sobre la tabla PREEXISTENTE ${t} (${subs})`);
          verdict = 'NO ADITIVA';
          break;
        }
        if (!neo.tables.has(t)) {
          problems.push(`${dir}: ALTER TABLE ${t}, tabla que no crea ninguna migracion nueva`);
          verdict = 'NO ADITIVA';
          break;
        }
        const bad = [];
        for (const c of n.cmds ?? []) {
          const cmd = c.AlterTableCmd;
          if (['AT_DropColumn', 'AT_DropConstraint', 'AT_DropNotNull'].includes(cmd?.subtype)) {
            bad.push(cmd.subtype);
          }
          // destino de una FK: eso es una REFERENCIA, no una modificacion
          const pk = cmd?.def?.Constraint?.pktable?.relname;
          if (pk) refsToPre.add(pk);
        }
        if (bad.length) {
          problems.push(`${dir}: ${t} usa ${bad.join(',')} aun siendo tabla nueva`);
          verdict = 'NO ADITIVA';
        } else {
          verdict = 'ALTERA una tabla creada hoy';
        }
        break;
      }
      default:
        problems.push(`${dir}: sentencia no clasificada (${k}); se rechaza por precaucion`);
        verdict = 'NO CLASIFICADA';
    }

    collect(st, neo);
    rows.push([dir.slice(0, 24), k, target, verdict]);
  }
}

// -----------------------------------------------------------------------------
// 3. Informe
// -----------------------------------------------------------------------------
const w = (s, n) => String(s).padEnd(n).slice(0, n);
console.log('=== PRUEBA DE QUE LA MIGRACION ES ADITIVA ===');
console.log('');
console.log('Objetos que YA existian (migraciones ' + HISTORIC.length + '):');
console.log(`  tablas ${pre.tables.size} . tipos ${pre.types.size} . indices ${pre.indexes.size} `
  + `. constraints ${pre.constraints.size} . funciones ${pre.functions.size} `
  + `. triggers ${pre.triggers.size} . extensiones ${pre.extensions.size} `
  + `. columnas ${pre.columns.size}`);
console.log('');
console.log('Objetos que CREAN las migraciones nuevas:');
console.log(`  tablas ${neo.tables.size} [${[...neo.tables].join(', ')}]`);
console.log(`  tipos  ${neo.types.size} [${[...neo.types].join(', ')}]`);
console.log(`  indices ${neo.indexes.size} . constraints ${neo.constraints.size} . columnas ${neo.columns.size}`);
console.log('');
console.log(`Tablas PREEXISTENTES referenciadas por clave foranea (lectura, no modificacion): `
  + `${[...refsToPre].join(', ') || 'ninguna'}`);
console.log('');
console.log(`${w('MIGRACION', 25)}${w('SENTENCIA', 18)}${w('OBJETO', 46)}VEREDICTO`);
for (const r of rows) console.log(`${w(r[0], 25)}${w(r[1], 18)}${w(r[2], 46)}${r[3]}`);
console.log('');
console.log(`Sentencias analizadas: ${rows.length}`);

if (problems.length) {
  console.log('');
  console.log(`--- OPERACIONES NO ADITIVAS: ${problems.length} ---`);
  for (const p of problems) console.log(`  X ${p}`);
  console.log('');
  console.log('RESULTADO: la migracion NO es aditiva. Exige autorizacion especifica del cliente.');
  process.exit(1);
}
console.log('');
console.log('RESULTADO: ninguna sentencia toca un objeto preexistente salvo como');
console.log('destino de una clave foranea. Cero DROP de tabla, columna, tipo o');
console.log('constraint previos. Cero sentencias de manipulacion de datos.');
console.log('El cambio es ESTRICTAMENTE ADITIVO (C-23).');
