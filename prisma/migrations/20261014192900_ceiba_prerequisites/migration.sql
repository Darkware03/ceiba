-- =============================================================================
-- CEIBA API Studio - 1/3  PRERREQUISITOS
-- Autor: database-engineer   Fecha: 2026-10-14
--
-- ESTADO: ESCRITO, **NO EJECUTADO**. En este contenedor no existe PostgreSQL
-- (verificado 2026-10-14: `command -v psql` y `command -v postgres` no
-- devuelven nada). Ninguna sentencia de este fichero se ha corrido contra un
-- motor real.
--
-- POR QUE VA ANTES QUE LA MIGRACION GENERADA, Y NO DESPUES:
-- la migracion 20261014193000 crea tres indices con `gin_trgm_ops`
-- (ix_collections_name_trgm, ix_requests_name_trgm, ix_requests_url_trgm).
-- Esa clase de operadores NO EXISTE sin la extension pg_trgm, de modo que si
-- este fichero no se ha aplicado antes, la migracion inicial FALLA con
-- "operator class gin_trgm_ops does not exist". El orden lexicografico de los
-- directorios de migracion (…192900 < …193000 < …193100) es lo que lo
-- garantiza con `prisma migrate deploy`.
--
-- PERMISOS: CREATE EXTENSION exige rol superusuario o, desde PostgreSQL 13,
-- pertenencia a un rol con el privilegio correspondiente. Si el despliegue usa
-- un rol de aplicacion sin privilegios (que es lo recomendable), un
-- administrador debe ejecutar ESTE fichero aparte, una sola vez por base de
-- datos. Dicho explicitamente porque es el punto donde suele fallar el primer
-- despliegue.
-- =============================================================================

-- citext: unicidad de correos y slugs sin distincion de mayusculas, sin tener
-- que indexar lower(x). Lo usan 6 columnas: users.email, invitations.email,
-- workspaces.slug, projects.slug, collections.slug y tags.name.
CREATE EXTENSION IF NOT EXISTS citext;

-- pg_trgm: busqueda por nombre y por URL de la seccion 11 del prompt maestro.
-- Requerida por los tres indices GIN trigram de la migracion inicial.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- pgcrypto: solo necesaria si se decide generar los UUID en el servidor con
-- gen_random_uuid() en PostgreSQL < 13. Desde PostgreSQL 13 gen_random_uuid()
-- es nativo y esta extension sobra. Se deja porque es idempotente y barata.
-- Ver la nota sobre uuidv7() al final de la migracion 20261014193100.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
