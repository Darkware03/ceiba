// =============================================================================
// CEIBA API Studio - Configuracion de Prisma 7.10.0
//
// Prisma 7 saco la URL de conexion del fichero .prisma. Al validar con `url`
// dentro de `datasource` el CLI devuelve P1012:
//   "The datasource property `url` is no longer supported in schema files.
//    Move connection URLs for Migrate to `prisma.config.ts`"
// Por eso vive aqui, y SIEMPRE leida de una variable de entorno: en este
// fichero no se escribe ninguna credencial.
//
// Las rutas son relativas a ESTE fichero (prisma/), que es como las resuelve
// el cargador de configuracion de Prisma.
//
// ESTADO: NO EJECUTADO contra ninguna base de datos. En este contenedor no
// existe PostgreSQL (verificado 2026-10-14: `command -v psql` y
// `command -v postgres` no devuelven nada). Las unicas ordenes de Prisma que
// se han corrido son `validate`, `format` y `migrate diff`, y ninguna abre
// conexion con `--from-empty --to-schema`.
//
// NO ejecutes `prisma migrate deploy` ni `prisma db push` contra un entorno con
// datos sin autorizacion especifica del cliente. La migracion inicial de
// prisma/migrations/ crea 38 tablas desde vacio; aplicarla sobre un esquema ya
// poblado falla o destruye. Ver MODELO-DATOS-PRISMA.md, seccion "Plan de
// migracion, reversion y riesgos".
// =============================================================================

import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  // El esquema es un DIRECTORIO (esquema multifichero), no un solo fichero.
  schema: 'schema',

  migrations: {
    path: 'migrations',
  },

  datasource: {
    url: env('DATABASE_URL'),
  },
});
