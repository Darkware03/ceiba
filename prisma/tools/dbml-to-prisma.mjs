#!/usr/bin/env node
// =============================================================================
// CEIBA API Studio - Traductor DBML -> Prisma schema (fase 1, ambito 3.B)
// Autor: database-engineer   Fecha: 2026-10-14
//
// POR QUE UN GENERADOR Y NO ESCRITURA A MANO:
// el DBML tiene 38 tablas, 603 columnas y 142 referencias. Traducirlo a mano
// admite el fallo silencioso de olvidar una columna o una FK, y ese fallo no lo
// detecta `prisma validate` (un esquema con una tabla de menos es valido).
// Derivarlo del AST de @dbml/core garantiza que la cobertura es total y que el
// resultado es reproducible y auditable: este fichero ES la prueba de la
// traduccion.
//
// REGLA RECTORA (C-23): traduccion FIEL y NO DESTRUCTIVA.
//  - Ningun nombre de tabla, columna, indice o clave foranea cambia en la base
//    de datos. Los nombres Prisma (PascalCase/camelCase) son solo la API del
//    cliente y van siempre con @map/@@map al nombre original.
//  - No se fusionan tablas. El modelo hibrido (scoped_variables +
//    environments/environment_variables) se conserva tal cual.
//
// USO:
//   node prisma/tools/dbml-to-prisma.mjs [--check]
//   --check : no escribe; solo informa (util en CI para detectar deriva).
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DBML_PATH = process.env.CEIBA_DBML ?? path.join(REPO_ROOT, 'docs', 'schema', 'ceiba.dbml');
const OUT_DIR = path.join(REPO_ROOT, 'prisma', 'schema');
const CHECK_ONLY = process.argv.includes('--check');

// @dbml/core no se instala en el arbol del repositorio (prohibido por el brief
// de fase 1: provoca contencion de lockfile). Se resuelve desde la cadena de
// herramientas compartida o desde CEIBA_DBML_CORE.
const DBML_CORE_DIR = process.env.CEIBA_DBML_CORE ?? '/software-factory/.toolchain/dbml';
const require = createRequire(path.join(DBML_CORE_DIR, 'package.json'));
const { Parser } = require('@dbml/core');

// -----------------------------------------------------------------------------
// 1. Mapas explicitos. Deliberadamente explicitos y no inferidos: una
//    singularizacion automatica se equivoca con `request_history`, `files`,
//    `collection_runs` o `retention_policies`, y un error ahi se propaga a todo
//    el cliente generado.
// -----------------------------------------------------------------------------
const MODEL_NAME = {
  users: 'User',
  sessions: 'Session',
  platform_admins: 'PlatformAdmin',
  user_auth_tokens: 'UserAuthToken',
  workspaces: 'Workspace',
  workspace_members: 'WorkspaceMember',
  invitations: 'Invitation',
  projects: 'Project',
  collections: 'Collection',
  collection_folders: 'CollectionFolder',
  api_requests: 'ApiRequest',
  request_headers: 'RequestHeader',
  request_params: 'RequestParam',
  request_bodies: 'RequestBody',
  request_body_fields: 'RequestBodyField',
  tags: 'Tag',
  request_tags: 'RequestTag',
  secrets: 'Secret',
  auth_configurations: 'AuthConfiguration',
  auth_credentials: 'AuthCredential',
  client_certificates: 'ClientCertificate',
  cookie_jar_entries: 'CookieJarEntry',
  environments: 'Environment',
  environment_variables: 'EnvironmentVariable',
  variable_local_values: 'VariableLocalValue',
  scoped_variables: 'ScopedVariable',
  shared_links: 'SharedLink',
  share_access_codes: 'ShareAccessCode',
  share_sessions: 'ShareSession',
  share_access_attempts: 'ShareAccessAttempt',
  collection_versions: 'CollectionVersion',
  request_history: 'RequestHistory',
  response_artifacts: 'ResponseArtifact',
  retention_policies: 'RetentionPolicy',
  test_definitions: 'TestDefinition',
  collection_runs: 'CollectionRun',
  test_runs: 'TestRun',
  comments: 'Comment',
  notifications: 'Notification',
  audit_logs: 'AuditLog',
  files: 'File',
};

// Singular en snake_case, para derivar nombres de campo de relacion legibles.
const SINGULAR = {
  users: 'user',
  sessions: 'session',
  platform_admins: 'platform_admin',
  user_auth_tokens: 'user_auth_token',
  workspaces: 'workspace',
  workspace_members: 'workspace_member',
  invitations: 'invitation',
  projects: 'project',
  collections: 'collection',
  collection_folders: 'collection_folder',
  api_requests: 'api_request',
  request_headers: 'request_header',
  request_params: 'request_param',
  request_bodies: 'request_body',
  request_body_fields: 'request_body_field',
  tags: 'tag',
  request_tags: 'request_tag',
  secrets: 'secret',
  auth_configurations: 'auth_configuration',
  auth_credentials: 'auth_credential',
  client_certificates: 'client_certificate',
  cookie_jar_entries: 'cookie_jar_entry',
  environments: 'environment',
  environment_variables: 'environment_variable',
  variable_local_values: 'variable_local_value',
  scoped_variables: 'scoped_variable',
  shared_links: 'shared_link',
  share_access_codes: 'share_access_code',
  share_sessions: 'share_session',
  share_access_attempts: 'share_access_attempt',
  collection_versions: 'collection_version',
  request_history: 'request_history_entry',
  response_artifacts: 'response_artifact',
  retention_policies: 'retention_policy',
  test_definitions: 'test_definition',
  collection_runs: 'collection_run',
  test_runs: 'test_run',
  comments: 'comment',
  notifications: 'notification',
  audit_logs: 'audit_log',
  files: 'file',
};

// Reparto en ficheros, espejo de los BLOQUE 1..8 del DBML.
const BLOCKS = [
  ['02-identity', 'BLOQUE 1 - Identidad, sesiones, workspaces, miembros, invitaciones',
    ['users', 'sessions', 'platform_admins', 'user_auth_tokens', 'workspaces',
      'workspace_members', 'invitations']],
  ['03-organization', 'BLOQUE 2 - Organizacion: proyectos, colecciones, carpetas, solicitudes',
    ['projects', 'collections', 'collection_folders', 'api_requests', 'request_headers',
      'request_params', 'request_bodies', 'request_body_fields', 'tags', 'request_tags']],
  ['04-vault-auth', 'BLOQUE 3 - Boveda de secretos y autenticacion',
    ['secrets', 'auth_configurations', 'auth_credentials', 'client_certificates', 'cookie_jar_entries']],
  ['05-environments-variables', 'BLOQUE 4 - Entornos y variables (MODELO HIBRIDO, C-23: se conserva)',
    ['environments', 'environment_variables', 'variable_local_values', 'scoped_variables']],
  ['06-sharing', 'BLOQUE 5 - Comparticion publica y privada con codigo hasheado',
    ['shared_links', 'share_access_codes', 'share_sessions', 'share_access_attempts']],
  ['07-versions-history', 'BLOQUE 6 - Versiones, historial y ciclo de vida de las respuestas',
    ['collection_versions', 'request_history', 'response_artifacts', 'retention_policies']],
  ['08-tests-runs', 'BLOQUE 7 - Pruebas y ejecuciones de coleccion',
    ['test_definitions', 'collection_runs', 'test_runs']],
  ['09-collaboration-audit', 'BLOQUE 8 - Colaboracion, auditoria y ficheros',
    ['comments', 'notifications', 'audit_logs', 'files']],
];

// Autorreferencias: nombres legibles en vez de los derivados mecanicamente.
const SELF_REL_NAMES = {
  fk_sessions_parent: ['parentSession', 'childSessions'],
  fk_folder_parent: ['parentFolder', 'childFolders'],
  fk_secret_rotation: ['rotatedFromSecret', 'rotatedToSecrets'],
  fk_version_parent: ['parentVersion', 'childVersions'],
  fk_sharecode_rotation: ['rotatedFromCode', 'rotatedToCodes'],
  fk_comment_parent: ['parentComment', 'childComments'],
};

// Columnas cuya INTENCION declarada en la nota del DBML es un tipo que DBML no
// sabe escribir pero Prisma SI. Se traduce a la intencion, no a la limitacion.
// Cada entrada va listada en MODELO-DATOS-PRISMA.md como desviacion explicita.
const COLUMN_TYPE_OVERRIDE = {
  'comments.mentioned_user_ids': {
    prisma: 'String[]',
    native: '@db.Uuid',
    reason: "DBML lo declara `uuid`; su nota dice literalmente \"Array uuid[] en la migracion real. DBML no expresa tipos array.\" Prisma si expresa listas escalares en PostgreSQL.",
  },
};

// Clases de operadores declaradas en las notas del DBML y expresables en Prisma.
const INDEX_OPS = {
  'collections.ix_collections_name_trgm': { name: 'gin_trgm_ops' },
  'api_requests.ix_requests_name_trgm': { name: 'gin_trgm_ops' },
  'api_requests.ix_requests_url_trgm': { name: 'gin_trgm_ops' },
  'collection_folders.ix_folders_path': { name: 'text_pattern_ops' },
};

// -----------------------------------------------------------------------------
// 2. Utilidades de nombres
// -----------------------------------------------------------------------------
const pascal = (s) => s.split('_').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('');
const camel = (s) => { const p = pascal(s); return p[0].toLowerCase() + p.slice(1); };

const enumName = (s) => pascal(s);

// -----------------------------------------------------------------------------
// 3. Tipos
// -----------------------------------------------------------------------------
const SCALAR_TYPE = {
  uuid: ['String', '@db.Uuid'],
  citext: ['String', null],          // PERDIDA: ver migracion complementaria
  text: ['String', null],
  timestamptz: ['DateTime', '@db.Timestamptz(6)'],
  bytea: ['Bytes', null],
  integer: ['Int', null],
  bigint: ['BigInt', null],
  smallint: ['Int', '@db.SmallInt'],
  boolean: ['Boolean', null],
  jsonb: ['Json', null],
  inet: ['String', '@db.Inet'],
  bigserial: ['BigInt', null],       // + @default(autoincrement())
};

function fieldType(table, field, enumSet) {
  const key = `${table.name}.${field.name}`;
  if (COLUMN_TYPE_OVERRIDE[key]) {
    const o = COLUMN_TYPE_OVERRIDE[key];
    return { base: o.prisma, native: o.native, isEnum: false, isList: true };
  }
  const t = field.type.type_name;
  if (enumSet.has(t)) return { base: enumName(t), native: null, isEnum: true, isList: false };
  const m = SCALAR_TYPE[t];
  if (!m) throw new Error(`Tipo DBML sin mapeo Prisma: ${t} (en ${key})`);
  return { base: m[0], native: m[1], isEnum: false, isList: false };
}

function defaultAttr(field, typeInfo) {
  const d = field.dbdefault;
  if (field.type.type_name === 'bigserial') return '@default(autoincrement())';
  if (!d) return null;
  if (d.type === 'expression') {
    const e = String(d.value).trim();
    if (e === 'uuidv7()') return '@default(uuid(7))';
    if (e === 'now()') return '@default(now())';
    if (/^'\{\}'::jsonb$/.test(e)) return '@default("{}")';
    throw new Error(`Default por expresion sin mapeo: ${e} (campo ${field.name})`);
  }
  if (d.type === 'boolean') return `@default(${d.value})`;
  if (d.type === 'number') return `@default(${d.value})`;
  if (d.type === 'string') {
    if (typeInfo.isEnum) return `@default(${d.value})`;      // valor de enum, sin comillas
    return `@default("${String(d.value).replace(/"/g, '\\"')}")`;
  }
  throw new Error(`Default de tipo desconocido: ${JSON.stringify(d)}`);
}

const ON_DELETE = {
  cascade: 'Cascade',
  'set null': 'SetNull',
  'set default': 'SetDefault',
  restrict: 'Restrict',
  'no action': 'NoAction',
};

// -----------------------------------------------------------------------------
// 4. Parseo
// -----------------------------------------------------------------------------
const src = fs.readFileSync(DBML_PATH, 'utf8');
// `dbml` (parser heredado) NO acepta `type: gin` en un bloque Indexes; `dbmlv2`
// (gramatica ANTLR actual) si. Comprobado 2026-10-14 con @dbml/core 10.3.1.
const db = Parser.parse(src, 'dbmlv2');
const schema = db.schemas[0];

const tables = schema.tables;
const enums = schema.enums;
const refs = schema.refs;
const enumSet = new Set(enums.map((e) => e.name));
const tableByName = new Map(tables.map((t) => [t.name, t]));

const unknown = tables.map((t) => t.name).filter((n) => !MODEL_NAME[n]);
if (unknown.length) throw new Error(`Tablas sin nombre de modelo asignado: ${unknown.join(', ')}`);

// -----------------------------------------------------------------------------
// 5. Relaciones: normalizar cada Ref a {child, parent}
// -----------------------------------------------------------------------------
function normalizeRef(ref) {
  const [a, b] = ref.endpoints;
  let child; let parent;
  if (a.relation === '*' && b.relation === '1') { child = a; parent = b; }
  else if (b.relation === '*' && a.relation === '1') { child = b; parent = a; }
  else {
    // 1-1: el padre es el extremo que apunta a su propia clave primaria.
    const aIsPk = a.fieldNames.length === 1 && (tableByName.get(a.tableName).fields.find((f) => f.name === a.fieldNames[0])?.pk ?? false);
    if (aIsPk) { parent = a; child = b; } else { parent = b; child = a; }
  }
  if (child.fieldNames.length !== 1 || parent.fieldNames.length !== 1) {
    throw new Error(`Ref compuesta no soportada por este traductor: ${ref.name}`);
  }
  return {
    name: ref.name,
    onDelete: ref.onDelete ? ON_DELETE[String(ref.onDelete).toLowerCase()] : null,
    onUpdate: ref.onUpdate ? ON_DELETE[String(ref.onUpdate).toLowerCase()] : null,
    childTable: child.tableName,
    childColumn: child.fieldNames[0],
    parentTable: parent.tableName,
    parentColumn: parent.fieldNames[0],
    isOneToOne: child.relation === '1' && parent.relation === '1',
  };
}

const rels = refs.map(normalizeRef);
for (const r of rels) {
  if (!r.onDelete) throw new Error(`Ref sin politica de borrado explicita: ${r.name}`);
}

// Agrupacion para detectar pares de tablas con mas de una relacion.
const incomingCount = new Map(); // `${parent}<-${child}` -> n
for (const r of rels) {
  const k = `${r.parentTable}<-${r.childTable}`;
  incomingCount.set(k, (incomingCount.get(k) ?? 0) + 1);
}

function childSideName(r) {
  if (SELF_REL_NAMES[r.name]) return SELF_REL_NAMES[r.name][0];
  return camel(r.childColumn.replace(/_id$/, ''));
}

function parentSideName(r) {
  if (SELF_REL_NAMES[r.name]) return SELF_REL_NAMES[r.name][1];
  const base = camel(r.childTable);
  const multi = incomingCount.get(`${r.parentTable}<-${r.childTable}`) > 1;
  if (!multi) return base;
  let role = r.childColumn.replace(/_id$/, '');
  const sing = SINGULAR[r.parentTable];
  const stripped = role.endsWith(`_${sing}`) ? role.slice(0, -(sing.length + 1)) : role;
  if (stripped.length > 0) role = stripped;
  return base + pascal(role);
}

const relsByChild = new Map();
const relsByParent = new Map();
for (const r of rels) {
  if (!relsByChild.has(r.childTable)) relsByChild.set(r.childTable, []);
  relsByChild.get(r.childTable).push(r);
  if (!relsByParent.has(r.parentTable)) relsByParent.set(r.parentTable, []);
  relsByParent.get(r.parentTable).push(r);
}

// -----------------------------------------------------------------------------
// 6. Emision
// -----------------------------------------------------------------------------
const stats = {
  models: 0, enums: 0, enumValues: 0, scalarFields: 0, relationFields: 0,
  relations: rels.length, indexes: 0, uniques: 0, compositePks: 0,
  nativeTypes: 0, defaults: 0,
};
const warnings = [];

function emitEnums() {
  const out = [];
  out.push('// =============================================================================');
  out.push('// CEIBA API Studio - Enumeraciones');
  out.push('// GENERADO por prisma/tools/dbml-to-prisma.mjs desde docs/schema/ceiba.dbml.');
  out.push('// NO EDITAR A MANO: regenera con `node prisma/tools/dbml-to-prisma.mjs`.');
  out.push('//');
  out.push('// Cada enum conserva su nombre PostgreSQL exacto via @@map. Los VALORES se');
  out.push('// escriben tal cual estan en el DBML: cambiar uno obliga a un ALTER TYPE y');
  out.push('// romperia los datos existentes.');
  out.push('// =============================================================================');
  out.push('');
  for (const e of enums) {
    stats.enums += 1;
    out.push(`enum ${enumName(e.name)} {`);
    for (const v of e.values) {
      stats.enumValues += 1;
      const note = v.note ? ` // ${String(v.note).replace(/\s+/g, ' ').trim()}` : '';
      out.push(`  ${v.name}${note}`);
    }
    out.push('');
    out.push(`  @@map("${e.name}")`);
    out.push('}');
    out.push('');
  }
  return out.join('\n');
}

function emitModel(table) {
  const out = [];
  const model = MODEL_NAME[table.name];
  stats.models += 1;

  if (table.note) {
    const lines = String(table.note).split('\n').map((l) => l.trimEnd());
    out.push(`/// ${model} -> tabla \`${table.name}\`.`);
    for (const l of lines) out.push(`/// ${l}`.trimEnd());
  }
  out.push(`model ${model} {`);

  const pkFields = table.fields.filter((f) => f.pk);
  const compositePkIdx = table.indexes.find((i) => i.pk);

  // --- columnas escalares -----------------------------------------------
  const colNames = new Set(table.fields.map((f) => f.name));
  const uniqueSingleCols = new Set(
    table.indexes.filter((i) => i.unique && i.columns.length === 1 && i.columns[0].type === 'column')
      .map((i) => i.columns[0].value),
  );

  for (const f of table.fields) {
    const ti = fieldType(table, f, enumSet);
    stats.scalarFields += 1;
    const optional = !(f.not_null || f.pk) && !ti.isList;
    let line = `  ${camel(f.name)} ${ti.base}${optional ? '?' : ''}`;
    const attrs = [];
    if (f.pk && !compositePkIdx) attrs.push('@id');
    // `unique` a nivel de columna solo si no hay ya un indice unico nombrado
    // sobre esa misma columna (si no, Prisma emitiria DOS restricciones).
    if (f.unique && !uniqueSingleCols.has(f.name)) attrs.push('@unique');
    const def = defaultAttr(f, ti);
    if (def) { attrs.push(def); stats.defaults += 1; }
    if (camel(f.name) !== f.name) attrs.push(`@map("${f.name}")`);
    if (ti.native) { attrs.push(ti.native); stats.nativeTypes += 1; }
    if (attrs.length) line += ' ' + attrs.join(' ');
    const note = f.note ? `  // ${String(f.note).replace(/\s+/g, ' ').trim()}` : '';
    out.push(line + note);
  }

  // --- relaciones: lado hijo (lleva la FK) -------------------------------
  const childRels = (relsByChild.get(table.name) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const parentRels = (relsByParent.get(table.name) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
  if (childRels.length || parentRels.length) {
    out.push('');
    out.push('  // --- Relaciones -------------------------------------------------------');
  }
  const usedNames = new Set(table.fields.map((f) => camel(f.name)));

  for (const r of childRels) {
    const fieldName = childSideName(r);
    if (usedNames.has(fieldName)) throw new Error(`Colision de nombre de campo '${fieldName}' en ${model} (ref ${r.name})`);
    usedNames.add(fieldName);
    stats.relationFields += 1;
    const col = table.fields.find((f) => f.name === r.childColumn);
    if (!col) throw new Error(`Ref ${r.name}: la columna ${r.childTable}.${r.childColumn} no existe`);
    const optional = !col.not_null;
    const target = MODEL_NAME[r.parentTable];
    const parts = [
      `"${r.name}"`,
      `fields: [${camel(r.childColumn)}]`,
      `references: [${camel(r.parentColumn)}]`,
      `onDelete: ${r.onDelete}`,
      // El DBML no declara politica de UPDATE en ninguna Ref. Sin clausula
      // explicita PostgreSQL aplica NO ACTION; el valor por defecto de Prisma
      // seria Cascade, que NO es lo que dice la fuente. Se fija NoAction para
      // que el DDL generado coincida con el DBML.
      `onUpdate: ${r.onUpdate ?? 'NoAction'}`,
      `map: "${r.name}"`,
    ];
    out.push(`  ${fieldName} ${target}${optional ? '?' : ''} @relation(${parts.join(', ')})`);
  }

  // --- relaciones: lado padre (lista inversa) ----------------------------
  for (const r of parentRels) {
    const fieldName = parentSideName(r);
    if (usedNames.has(fieldName)) throw new Error(`Colision de nombre de campo inverso '${fieldName}' en ${model} (ref ${r.name})`);
    usedNames.add(fieldName);
    stats.relationFields += 1;
    const target = MODEL_NAME[r.childTable];
    const card = r.isOneToOne ? '?' : '[]';
    out.push(`  ${fieldName} ${target}${card} @relation("${r.name}")`);
  }

  // --- bloques de tabla ---------------------------------------------------
  out.push('');
  if (compositePkIdx) {
    stats.compositePks += 1;
    const cols = compositePkIdx.columns.map((c) => camel(c.value));
    out.push(`  @@id([${cols.join(', ')}]${compositePkIdx.name ? `, map: "${compositePkIdx.name}"` : ''})`);
  }
  for (const idx of table.indexes) {
    if (idx.pk) continue;
    const opsKey = `${table.name}.${idx.name}`;
    const ops = INDEX_OPS[opsKey];
    const cols = idx.columns.map((c) => {
      if (c.type !== 'column') {
        warnings.push(`${table.name}.${idx.name}: columna de indice por expresion (${c.value}) no expresable en Prisma`);
        return null;
      }
      const base = camel(c.value);
      return ops ? `${base}(ops: raw("${ops.name}"))` : base;
    });
    if (cols.includes(null)) continue;
    const attrs = [`[${cols.join(', ')}]`];
    if (idx.name) attrs.push(`map: "${idx.name}"`);
    if (idx.type && idx.type.toLowerCase() !== 'btree') attrs.push(`type: ${pascal(idx.type)}`);
    if (idx.unique) { stats.uniques += 1; out.push(`  @@unique(${attrs.join(', ')})`); }
    else { stats.indexes += 1; out.push(`  @@index(${attrs.join(', ')})`); }
  }
  out.push(`  @@map("${table.name}")`);
  out.push('}');
  out.push('');
  return out.join('\n');
}

// -----------------------------------------------------------------------------
// 7. Escritura
// -----------------------------------------------------------------------------
const files = [];

files.push(['01-enums.prisma', emitEnums()]);

const seen = new Set();
for (const [fname, title, tnames] of BLOCKS) {
  const out = [];
  out.push('// =============================================================================');
  out.push(`// CEIBA API Studio - ${title}`);
  out.push('// GENERADO por prisma/tools/dbml-to-prisma.mjs desde docs/schema/ceiba.dbml.');
  out.push('// NO EDITAR A MANO.');
  out.push('// =============================================================================');
  out.push('');
  for (const tn of tnames) {
    const t = tableByName.get(tn);
    if (!t) throw new Error(`Tabla declarada en BLOCKS pero ausente del DBML: ${tn}`);
    if (seen.has(tn)) throw new Error(`Tabla duplicada en BLOCKS: ${tn}`);
    seen.add(tn);
    out.push(emitModel(t));
  }
  files.push([`${fname}.prisma`, out.join('\n')]);
}
const missing = tables.map((t) => t.name).filter((n) => !seen.has(n));
if (missing.length) throw new Error(`Tablas del DBML no repartidas en ningun fichero: ${missing.join(', ')}`);

if (!CHECK_ONLY) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, body] of files) {
    fs.writeFileSync(path.join(OUT_DIR, name), body.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', 'utf8');
    process.stdout.write(`escrito: prisma/schema/${name}\n`);
  }
}

// -----------------------------------------------------------------------------
// 8. Informe de cifras (esto es lo que se reporta; no se cuenta "a ojo")
// -----------------------------------------------------------------------------
const byPolicy = {};
for (const r of rels) byPolicy[r.onDelete] = (byPolicy[r.onDelete] ?? 0) + 1;
const selfRefs = rels.filter((r) => r.childTable === r.parentTable);
const multiPairs = [...incomingCount.entries()].filter(([, n]) => n > 1);

const report = {
  fuente: DBML_PATH,
  dbml: {
    tablas: tables.length,
    enums: enums.length,
    refs: refs.length,
    columnas: tables.reduce((a, t) => a + t.fields.length, 0),
    indices_declarados: tables.reduce((a, t) => a + t.indexes.length, 0),
  },
  prisma: {
    modelos: stats.models,
    enums: stats.enums,
    valores_de_enum: stats.enumValues,
    campos_escalares: stats.scalarFields,
    campos_de_relacion: stats.relationFields,
    relaciones: stats.relations,
    at_at_index: stats.indexes,
    at_at_unique: stats.uniques,
    at_at_id_compuesto: stats.compositePks,
    tipos_nativos: stats.nativeTypes,
    defaults: stats.defaults,
  },
  politicas_de_borrado: byPolicy,
  autorreferencias: selfRefs.map((r) => `${r.name} (${r.childTable}.${r.childColumn})`),
  pares_con_varias_relaciones: multiPairs.map(([k, n]) => `${k} x${n}`),
  avisos: warnings,
};
process.stdout.write('\n' + JSON.stringify(report, null, 2) + '\n');
