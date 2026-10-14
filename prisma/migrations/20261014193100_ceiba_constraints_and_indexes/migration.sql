-- =============================================================================
-- CEIBA API Studio - 3/3  LO QUE PRISMA NO SABE EXPRESAR
-- Autor: database-engineer   Fecha: 2026-10-14
--
-- ESTADO: ESCRITO, **NO EJECUTADO**. No hay PostgreSQL en el entorno donde se
-- escribio (verificado 2026-10-14). Ninguna sentencia se ha corrido.
--
-- PARA QUE SIRVE ESTE FICHERO
-- El esquema Prisma de prisma/schema/ es una traduccion FIEL del DBML en todo
-- lo que Prisma sabe modelar: tablas, columnas, tipos, enums, indices, claves
-- foraneas y politicas de borrado. Pero el lenguaje de Prisma NO tiene:
--   . restricciones CHECK
--   . indices PARCIALES (clausula WHERE)
--   . NULLS NOT DISTINCT
--   . el tipo citext
--   . claves foraneas DEFERRABLE
--   . triggers (ver la migracion 20261014193200)
--   . particionado por rango (ver prisma/sql/particionado.sql)
-- Sin este fichero el esquema PARECE completo y no lo esta. Un esquema que ha
-- perdido sus CHECK es peor que uno que lo documenta, porque nadie lo revisa.
--
-- FUENTE NORMATIVA de cada constraint: MODELO-DATOS.md, secciones 6.1 y 8.
-- No se ha inventado ninguna: todas estan enunciadas alli o en las notas del
-- DBML.
--
-- CONSECUENCIA OPERATIVA QUE HAY QUE CONOCER ANTES DE APLICARLO:
-- varios objetos de aqui SUSTITUYEN a otros creados por la migracion
-- 20261014193000. A partir de ese momento el estado real de la base de datos
-- ya NO es derivable del esquema Prisma, y `prisma migrate dev` detectara
-- deriva e intentara "arreglarla" borrandolos. En produccion se usa SIEMPRE
-- `prisma migrate deploy`, que no compara ni corrige. Esto esta explicado en
-- MODELO-DATOS-PRISMA.md, seccion "Deriva permanente".
-- =============================================================================


-- =============================================================================
-- 1. citext  (6 columnas)
--
-- El DBML declara estas seis como `citext`. Prisma no tiene ese tipo y las
-- emitio como TEXT, lo que convierte 'Ana@ejemplo.com' y 'ana@ejemplo.com' en
-- dos correos DISTINTOS. No es una optimizacion: es la diferencia entre poder
-- registrar dos cuentas con el mismo correo y no poder.
--
-- AVISO SOBRE DATOS EXISTENTES: sobre una base vacia esto es inocuo. Sobre una
-- base con datos, si ya existen filas que solo se diferencian en mayusculas,
-- el indice unico FALLA al reconstruirse. Eso NO es un error del script: es el
-- duplicado que ya estaba ahi saliendo a la luz. Hay que reconciliarlo a mano
-- ANTES, y eso exige autorizacion explicita del cliente por ser una operacion
-- con perdida potencial.
-- =============================================================================
ALTER TABLE "users"       ALTER COLUMN "email" TYPE citext;
ALTER TABLE "invitations" ALTER COLUMN "email" TYPE citext;
ALTER TABLE "workspaces"  ALTER COLUMN "slug"  TYPE citext;
ALTER TABLE "projects"    ALTER COLUMN "slug"  TYPE citext;
ALTER TABLE "collections" ALTER COLUMN "slug"  TYPE citext;
ALTER TABLE "tags"        ALTER COLUMN "name"  TYPE citext;


-- =============================================================================
-- 2. INDICES PARCIALES
--
-- MODELO-DATOS.md 6.1 lo dice sin ambiguedad: "Si estos se crean sin
-- predicado, el producto tiene un fallo funcional, no solo una ineficiencia".
-- El fallo concreto: con borrado logico (`deleted_at`), un unico NO parcial
-- impide reutilizar para siempre el correo, el slug o el nombre de una fila
-- borrada. El usuario borra una coleccion y no puede volver a crearla con el
-- mismo nombre.
--
-- Prisma los creo SIN predicado. Aqui se sustituyen uno a uno.
-- =============================================================================

-- 2.1 Unicos que deben excluir las filas borradas logicamente
DROP INDEX IF EXISTS "uq_users_email";
CREATE UNIQUE INDEX "uq_users_email" ON "users" ("email")
  WHERE "deleted_at" IS NULL;

DROP INDEX IF EXISTS "uq_workspaces_slug";
CREATE UNIQUE INDEX "uq_workspaces_slug" ON "workspaces" ("slug")
  WHERE "deleted_at" IS NULL;

DROP INDEX IF EXISTS "uq_projects_ws_slug";
CREATE UNIQUE INDEX "uq_projects_ws_slug" ON "projects" ("workspace_id", "slug")
  WHERE "deleted_at" IS NULL;

DROP INDEX IF EXISTS "uq_collections_ws_slug";
CREATE UNIQUE INDEX "uq_collections_ws_slug" ON "collections" ("workspace_id", "slug")
  WHERE "deleted_at" IS NULL;

DROP INDEX IF EXISTS "uq_folder_sibling_name";
CREATE UNIQUE INDEX "uq_folder_sibling_name"
  ON "collection_folders" ("collection_id", "parent_folder_id", "name")
  WHERE "deleted_at" IS NULL;

DROP INDEX IF EXISTS "uq_requests_external_ref";
CREATE UNIQUE INDEX "uq_requests_external_ref"
  ON "api_requests" ("collection_id", "external_ref")
  WHERE "external_ref" IS NOT NULL AND "deleted_at" IS NULL;


-- 2.2 Unicos que ADEMAS necesitan NULLS NOT DISTINCT (PostgreSQL 15+)
--
-- Por que importa: en SQL estandar NULL <> NULL, asi que un indice unico sobre
-- columnas nulables NO impide dos filas con los mismos NULL. En
-- `scoped_variables` eso significa que dos variables GLOBALES con la misma
-- clave no colisionan y el resolvedor devuelve una de las dos al azar. Es un
-- fallo silencioso: no hay error, hay un valor equivocado.
--
-- REQUISITO DE VERSION: NULLS NOT DISTINCT existe desde PostgreSQL 15. El
-- motor objetivo declarado es PostgreSQL 16+, asi que esta cubierto; si alguien
-- despliega sobre 14 o anterior, estas dos sentencias fallan y hay que
-- sustituirlas por un indice unico sobre COALESCE(col, '00000000-0000-0000-0000-000000000000'::uuid).
DROP INDEX IF EXISTS "uq_scopedvar_identity";
CREATE UNIQUE INDEX "uq_scopedvar_identity"
  ON "scoped_variables" ("scope", "workspace_id", "collection_id", "api_request_id", "key")
  NULLS NOT DISTINCT;

DROP INDEX IF EXISTS "uq_env_scope_name";
CREATE UNIQUE INDEX "uq_env_scope_name"
  ON "environments" ("workspace_id", "collection_id", "name")
  NULLS NOT DISTINCT
  WHERE "deleted_at" IS NULL;


-- 2.3 Indices parciales que el DBML describe en notas pero NO pudo declarar,
--     de modo que Prisma tampoco los conoce. Son NUEVOS, no sustituyen a nada.

-- Una sola invitacion viva por (workspace, correo), pero reinvitable tras
-- revocar o caducar.
CREATE UNIQUE INDEX "uq_invitation_pending"
  ON "invitations" ("workspace_id", "email")
  WHERE "status" = 'pending';

-- Un solo entorno por defecto por alcance.
CREATE UNIQUE INDEX "uq_env_default"
  ON "environments" ("workspace_id", "collection_id")
  NULLS NOT DISTINCT
  WHERE "is_default" AND "deleted_at" IS NULL;

-- Un solo codigo de acceso activo por enlace compartido.
CREATE UNIQUE INDEX "uq_sharecode_one_active"
  ON "share_access_codes" ("shared_link_id")
  WHERE "state" = 'active';

-- Sesiones vivas: la consulta del middleware de autenticacion.
CREATE INDEX "ix_sessions_live" ON "sessions" ("user_id")
  WHERE "revoked_at" IS NULL;


-- 2.4 Contador de no leidas. Prisma lo creo como (recipient_user_id, read_at);
--     la forma normativa (MODELO-DATOS.md 6.1) es PARCIAL sobre una sola
--     columna, que es mucho mas pequeno y es la consulta mas frecuente de toda
--     la aplicacion.
DROP INDEX IF EXISTS "ix_notif_user_unread";
CREATE INDEX "ix_notif_user_unread" ON "notifications" ("recipient_user_id")
  WHERE "read_at" IS NULL AND "dismissed_at" IS NULL;


-- =============================================================================
-- 3. RESTRICCIONES CHECK
--
-- Fuente: MODELO-DATOS.md seccion 8 (normativa) y notas del DBML.
-- Se agrupan igual que alli para que la revision sea trazable.
-- =============================================================================

-- --- 3.1 Las que sostienen la separacion metadato/secreto -------------------
-- Son las que convierten "los secretos no se filtran al exportar" en una
-- propiedad del MOTOR y no en una promesa del serializador: si la fila esta
-- marcada como secreta, la columna de texto en claro ES NULL por restriccion.

ALTER TABLE "request_headers" ADD CONSTRAINT "ck_header_secret_xor" CHECK (
     ("is_secret" AND "value" IS NULL AND "secret_id" IS NOT NULL)
  OR (NOT "is_secret" AND "secret_id" IS NULL));

ALTER TABLE "request_params" ADD CONSTRAINT "ck_param_secret_xor" CHECK (
     ("is_secret" AND "value" IS NULL AND "secret_id" IS NOT NULL)
  OR (NOT "is_secret" AND "secret_id" IS NULL));

ALTER TABLE "environment_variables" ADD CONSTRAINT "ck_envvar_secret_xor" CHECK (
     ("value_kind" = 'secret' AND "initial_value" IS NULL AND "current_value" IS NULL
      AND "secret_id" IS NOT NULL)
  OR ("value_kind" <> 'secret' AND "secret_id" IS NULL));

ALTER TABLE "scoped_variables" ADD CONSTRAINT "ck_scopedvar_secret_xor" CHECK (
     ("value_kind" = 'secret' AND "value" IS NULL AND "secret_id" IS NOT NULL)
  OR ("value_kind" <> 'secret' AND "secret_id" IS NULL));

-- Es CHECK y no DEFAULT a proposito: para que una instantanea de version pueda
-- declararse portadora de secretos hay que BORRAR esta restriccion en una
-- migracion, y eso se ve en la revision de codigo.
ALTER TABLE "collection_versions" ADD CONSTRAINT "ck_version_no_secrets"
  CHECK ("secrets_excluded" = true);

-- Como maximo una fuente de valor por campo de formulario, y secreto obligado
-- si esta marcado como tal.
ALTER TABLE "request_body_fields" ADD CONSTRAINT "ck_bodyfield_xor" CHECK (
     (("field_value" IS NOT NULL)::int + ("secret_id" IS NOT NULL)::int
      + ("file_id" IS NOT NULL)::int) <= 1
  AND (NOT "is_secret" OR "secret_id" IS NOT NULL));


-- --- 3.2 Las que sostienen la politica de respuestas ------------------------
ALTER TABLE "response_artifacts" ADD CONSTRAINT "ck_artifact_sizes"
  CHECK ("stored_bytes" <= "size_bytes" AND "stored_bytes" >= 0);
ALTER TABLE "response_artifacts" ADD CONSTRAINT "ck_artifact_storage"
  CHECK (("storage" = 'inline_db') = ("inline_content" IS NOT NULL));
-- La barrera principal (`expires_at` NOT NULL) ya la impone la columna.

ALTER TABLE "workspaces" ADD CONSTRAINT "ck_ws_retention"
  CHECK ("response_retention_days" BETWEEN 0 AND 365);
ALTER TABLE "workspaces" ADD CONSTRAINT "ck_ws_maxbytes"
  CHECK ("response_max_persist_bytes" BETWEEN 0 AND 10485760);


-- --- 3.3 Las que sostienen la comparticion ----------------------------------
-- No hace falta un CHECK que impida conceder edicion por enlace: el enum
-- share_permission no contiene ningun valor de edicion. La garantia esta en el
-- tipo, que es mas fuerte que una restriccion.
ALTER TABLE "shared_links" ADD CONSTRAINT "ck_share_exec"
  CHECK ("allow_execution" = false OR "permission" = 'executor');
ALTER TABLE "shared_links" ADD CONSTRAINT "ck_share_revoked"
  CHECK (("state" = 'revoked') = ("revoked_at" IS NOT NULL));

ALTER TABLE "share_access_codes" ADD CONSTRAINT "ck_code_attempts"
  CHECK ("failed_attempt_count" >= 0 AND "max_attempts" > 0);
ALTER TABLE "share_access_codes" ADD CONSTRAINT "ck_code_uses"
  CHECK ("max_uses" IS NULL OR "use_count" <= "max_uses");
ALTER TABLE "share_access_codes" ADD CONSTRAINT "ck_code_hint_len"
  CHECK ("code_hint" IS NULL OR length("code_hint") <= 4);


-- --- 3.4 Forma e integridad estructural -------------------------------------
ALTER TABLE "collection_folders" ADD CONSTRAINT "ck_folder_depth"
  CHECK ("depth" BETWEEN 0 AND 32);
ALTER TABLE "collection_folders" ADD CONSTRAINT "ck_folder_notself"
  CHECK ("id" <> "parent_folder_id");

ALTER TABLE "scoped_variables" ADD CONSTRAINT "ck_scopedvar_shape" CHECK (
     ("scope" = 'global'      AND "workspace_id" IS NULL     AND "collection_id" IS NULL     AND "api_request_id" IS NULL)
  OR ("scope" = 'workspace'   AND "workspace_id" IS NOT NULL AND "collection_id" IS NULL     AND "api_request_id" IS NULL)
  OR ("scope" = 'collection'  AND "workspace_id" IS NOT NULL AND "collection_id" IS NOT NULL AND "api_request_id" IS NULL)
  OR ("scope" = 'api_request' AND "workspace_id" IS NOT NULL AND "api_request_id" IS NOT NULL));

ALTER TABLE "comments" ADD CONSTRAINT "ck_comment_target" CHECK (
  ("collection_id" IS NOT NULL)::int + ("collection_folder_id" IS NOT NULL)::int
  + ("api_request_id" IS NOT NULL)::int = 1);

ALTER TABLE "test_definitions" ADD CONSTRAINT "ck_test_scope"
  CHECK (("collection_id" IS NULL) <> ("api_request_id" IS NULL));
ALTER TABLE "test_definitions" ADD CONSTRAINT "ck_test_script"
  CHECK (("kind" = 'script') = ("script_body" IS NOT NULL));

ALTER TABLE "request_bodies" ADD CONSTRAINT "ck_body_mode_shape" CHECK (
     ("mode" IN ('raw_json','raw_text','raw_xml','raw_html','graphql') AND "binary_file_id" IS NULL)
  OR ("mode" = 'binary_file' AND "raw_content" IS NULL AND "binary_file_id" IS NOT NULL)
  OR ("mode" IN ('none','form_urlencoded','multipart_form_data','custom')
      AND "raw_content" IS NULL AND "binary_file_id" IS NULL));

ALTER TABLE "api_requests" ADD CONSTRAINT "ck_request_custom_verb"
  CHECK (("method" = 'CUSTOM') = ("method_custom" IS NOT NULL));
ALTER TABLE "api_requests" ADD CONSTRAINT "ck_request_timeout"
  CHECK ("timeout_ms" IS NULL OR "timeout_ms" BETWEEN 1 AND 600000);

ALTER TABLE "request_params" ADD CONSTRAINT "ck_param_path_enabled"
  CHECK ("kind" <> 'path' OR "is_enabled" = true);

ALTER TABLE "variable_local_values" ADD CONSTRAINT "ck_varlocal_target"
  CHECK (("environment_variable_id" IS NULL) <> ("scoped_variable_id" IS NULL));

ALTER TABLE "environments" ADD CONSTRAINT "ck_env_owner"
  CHECK ("is_shared" = true OR "owner_user_id" IS NOT NULL);

ALTER TABLE "secrets" ADD CONSTRAINT "ck_secret_revoked"
  CHECK (("state" = 'revoked') = ("revoked_at" IS NOT NULL));
ALTER TABLE "secrets" ADD CONSTRAINT "ck_secret_notself"
  CHECK ("id" <> "rotated_from_secret_id");

ALTER TABLE "auth_configurations" ADD CONSTRAINT "ck_authcfg_apikey"
  CHECK ("auth_type" NOT IN ('api_key_header','api_key_query')
         OR "api_key_param_name" IS NOT NULL);
ALTER TABLE "auth_configurations" ADD CONSTRAINT "ck_authcfg_oauth"
  CHECK ("auth_type"::text NOT LIKE 'oauth2%' OR "oauth_token_url" IS NOT NULL);

ALTER TABLE "workspace_members" ADD CONSTRAINT "ck_member_removed"
  CHECK (("status" = 'removed') = ("removed_at" IS NOT NULL));

ALTER TABLE "invitations" ADD CONSTRAINT "ck_inv_accept"
  CHECK (("status" = 'accepted') = ("accepted_at" IS NOT NULL));

ALTER TABLE "users" ADD CONSTRAINT "ck_users_locked"
  CHECK ("locked_until" IS NULL OR "locked_until" > "created_at");

ALTER TABLE "collection_versions" ADD CONSTRAINT "ck_version_storage"
  CHECK (("snapshot_file_id" IS NOT NULL)::int + ("snapshot_inline" IS NOT NULL)::int = 1);

ALTER TABLE "collection_runs" ADD CONSTRAINT "ck_run_iterations"
  CHECK ("iterations" BETWEEN 1 AND 1000);
ALTER TABLE "collection_runs" ADD CONSTRAINT "ck_run_times"
  CHECK ("finished_at" IS NULL OR "started_at" IS NOT NULL);

ALTER TABLE "files" ADD CONSTRAINT "ck_file_size"
  CHECK ("size_bytes" >= 0 AND "size_bytes" <= 104857600);
ALTER TABLE "files" ADD CONSTRAINT "ck_file_public"
  CHECK ("is_public" = false OR "purpose" IN ('user_avatar','workspace_icon'));

-- `action` es text y no enum a proposito: las acciones auditables crecen con
-- cada funcionalidad y un enum obligaria a un ALTER TYPE por verbo nuevo. A
-- cambio, se restringe el FORMATO.
ALTER TABLE "audit_logs" ADD CONSTRAINT "ck_audit_action_format"
  CHECK ("action" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$');

-- NOTA SOBRE ck_users_pwd_or_sso: el DBML lo enuncia como
--   password_hash IS NOT NULL OR status <> 'active'
-- y acto seguido dice "... relajado si hay SSO". MODELO-DATOS.md no lo recoge
-- en su seccion 8 normativa. NO se crea aqui: tal cual esta escrito impediria
-- que una cuenta solo-SSO llegara a estado 'active', que es justo el caso que
-- el propio DBML dice querer permitir. Queda como HUECO declarado en
-- MODELO-DATOS-PRISMA.md; depende del ADR-0009 de autenticacion, que es del
-- software-architect y se esta escribiendo en paralelo.


-- =============================================================================
-- 4. CLAVES FORANEAS DIFERIBLES
--
-- users.avatar_file_id <-> files.owner_user_id y
-- workspaces.icon_file_id <-> files.workspace_id forman dos CICLOS de FK.
-- Ambos lados son nullables, asi que se pueden insertar en dos pasos, pero
-- declararlos diferibles permite hacerlo en UNA transaccion sin orden impuesto,
-- que es lo que necesitan las cargas de datos y las pruebas con fixtures.
-- Prisma no sabe emitir DEFERRABLE.
-- =============================================================================
ALTER TABLE "users"      ALTER CONSTRAINT "fk_users_avatar" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "workspaces" ALTER CONSTRAINT "fk_ws_icon"      DEFERRABLE INITIALLY DEFERRED;


-- =============================================================================
-- 5. AUDITORIA APPEND-ONLY
--
-- "Un registro de auditoria que la aplicacion puede reescribir no es un
-- registro de auditoria" (MODELO-DATOS.md 7.2). El rol de la aplicacion recibe
-- solo INSERT y SELECT sobre audit_logs.
--
-- SUSTITUYE :ceiba_app POR EL ROL REAL DEL DESPLIEGUE antes de ejecutar. Se
-- deja como marcador a proposito: no invento el nombre del rol de produccion,
-- y un GRANT a un rol equivocado es peor que ninguno.
-- =============================================================================
-- REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_logs" FROM :ceiba_app;
-- GRANT  INSERT, SELECT                ON TABLE "audit_logs" TO   :ceiba_app;


-- =============================================================================
-- 6. OPCIONAL - valores por defecto de UUID en el SERVIDOR
--
-- El DBML declara `default: uuidv7()` en las 34 PK de tipo uuid. La traduccion
-- Prisma usa @default(uuid(7)), que genera el UUIDv7 en el CLIENTE y por tanto
-- NO emite ningun DEFAULT en el DDL. Es deliberado y es la opcion portable:
--   . uuidv7() es NATIVA solo desde PostgreSQL 18. En 16 y 17 NO EXISTE, y el
--     motor objetivo declarado es "PostgreSQL 16+", asi que poner
--     DEFAULT uuidv7() en el DDL romperia el despliegue en 16/17.
--   . El propio DBML ya contempla esta salida: "hay que generarlo en la
--     aplicacion o sustituir el default por gen_random_uuid()".
--
-- Si el despliegue fija PostgreSQL 18+, o si se quiere una red de seguridad
-- para INSERT hechos fuera de Prisma (scripts, carga masiva, psql a mano),
-- descomenta el bloque. No cambia el tipo ni el nombre de ninguna columna.
-- =============================================================================
-- DO $$
-- DECLARE t text;
-- BEGIN
--   FOREACH t IN ARRAY ARRAY[
--     'users','sessions','workspaces','workspace_members','invitations',
--     'projects','collections','collection_folders','api_requests',
--     'request_headers','request_params','request_bodies','request_body_fields',
--     'tags','secrets','auth_configurations','auth_credentials',
--     'client_certificates','cookie_jar_entries','environments',
--     'environment_variables','variable_local_values','scoped_variables',
--     'shared_links','share_access_codes','collection_versions',
--     'request_history','response_artifacts','retention_policies',
--     'test_definitions','collection_runs','comments','files']
--   LOOP
--     EXECUTE format('ALTER TABLE %I ALTER COLUMN id SET DEFAULT uuidv7()', t);
--   END LOOP;
-- END $$;
