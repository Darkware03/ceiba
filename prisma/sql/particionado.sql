-- =============================================================================
-- CEIBA API Studio - PARTICIONADO POR RANGO  (NO es una migracion aplicable)
-- Autor: database-engineer   Fecha: 2026-10-14
--
-- ESTADO: ESCRITO, **NO EJECUTADO**. No hay PostgreSQL en este entorno
-- (verificado 2026-10-14).
--
-- ESTE FICHERO NO ESTA EN prisma/migrations/ A PROPOSITO.
-- Los otros tres anexos (prerrequisitos, restricciones, triggers) PARCHEAN lo
-- que Prisma dejo a medias. El particionado NO se puede parchear: una tabla
-- normal no se convierte en particionada con un ALTER. Hay que crearla
-- particionada DESDE EL PRINCIPIO, o reemplazarla despues copiando los datos.
-- Por eso esto es una DECISION, no un script que se encadena detras del resto.
-- =============================================================================
--
-- 1. QUE PIDE EL DISENO
-- El DBML declara cuatro tablas particionadas por rango MENSUAL:
--     request_history        -> executed_at
--     audit_logs             -> occurred_at
--     test_runs              -> executed_at
--     share_access_attempts  -> attempted_at
-- El motivo es la purga: con particiones, borrar un mes caducado es
-- DROP PARTITION (O(1), sin WAL, sin bloat). Sin particiones es un DELETE de
-- millones de filas que infla el WAL y deja la tabla hinchada.
--
-- 2. POR QUE PRISMA NO PUEDE
-- El lenguaje de esquema de Prisma no tiene particionado. Pero el problema de
-- fondo no es sintactico, son TRES CONFLICTOS REALES:
--
--   2.a  LA CLAVE PRIMARIA CAMBIA.
--        En PostgreSQL, la PK de una tabla particionada DEBE incluir la columna
--        de particion. Las PK reales pasan a ser (id, executed_at),
--        (id, occurred_at), (id, executed_at) y (id, attempted_at). El modelo
--        Prisma declara `@id` sobre `id` solo, porque es lo que corresponde al
--        DBML. Son incompatibles.
--
--   2.b  SE PIERDE LA UNICIDAD DE `id`.
--        No se puede crear un indice UNICO sobre `id` solo en una tabla
--        particionada. `findUnique({ where: { id } })` seguira generando SQL
--        correcto y devolviendo la fila, pero el MOTOR ya no garantiza que sea
--        unica: la garantia pasa a depender de que los UUID no colisionen.
--        Con UUIDv7 es aceptable, pero hay que saberlo y escribirlo.
--
--   2.c  UNA CLAVE FORANEA SE CAE. Este es el conflicto duro.
--        `fk_testrun_history: test_runs.request_history_id > request_history.id`
--        no puede existir si `request_history` esta particionada: PostgreSQL
--        exige que una FK apunte a una restriccion unica del destino, y en una
--        tabla particionada toda restriccion unica tiene que incluir la columna
--        de particion. Referenciar `request_history.id` a secas es imposible.
--        Salidas, ninguna gratis:
--          (i)  eliminar fk_testrun_history y degradar la relacion a una
--               referencia debil validada en la aplicacion;
--          (ii) anadir `request_history_executed_at` a `test_runs` y apuntar la
--               FK al par (id, executed_at). Son dos columnas nuevas en el
--               DBML y cambia el modelo.
--        ESTO EXCEDE MI AMBITO: es un cambio de diseno del esquema de fase 0,
--        y C-23 prohibe la reestructuracion por cuenta propia. Lo elevo a
--        darkware en MODELO-DATOS-PRISMA.md en vez de decidirlo yo.
--
-- 3. LAS DOS OPCIONES, Y CUAL RECOMIENDO
--
--   OPCION A - NO PARTICIONAR AHORA  [recomendada para la fase 1]
--     Se despliega tal cual esta en prisma/migrations/. Las cuatro tablas son
--     normales, `fk_testrun_history` sobrevive intacta y no hay deriva.
--     La purga se hace con DELETE por lotes acotados, que a volumen bajo es
--     perfectamente razonable.
--     Se particiona mas adelante, cuando haya datos reales que lo justifiquen,
--     con una ventana de mantenimiento y copia de tabla.
--     COSTE: migrar despues una tabla grande es caro y requiere parada o una
--     copia en caliente. Es un coste conocido y diferido, no una sorpresa.
--
--   OPCION B - PARTICIONAR DESDE EL PRIMER DIA
--     Requiere declarar las cuatro tablas como EXTERNAS a Prisma, usando la
--     funcion `tables.external` de Prisma 7 (experimental). Prisma las sigue
--     exponiendo en el cliente pero NO genera ni modifica su estructura:
--
--         // prisma/prisma.config.ts
--         experimental: { externalTables: true },
--         tables: { external: [
--           'public.request_history', 'public.audit_logs',
--           'public.test_runs', 'public.share_access_attempts',
--         ]},
--         migrations: { initShadowDb: './sql/particionado.sql' },
--
--     Comprobado en la definicion de tipos de @prisma/config 7.10.0:
--       "List of tables that are externally managed. Prisma will not modify
--        the structure of these tables and not generate migrations for those
--        tables. These tables will still be represented in schema.prisma file
--        and be available in the client API."
--     AVISO: la propia API la marca como experimental (`experimental.
--     externalTables`). Meter una funcion experimental en los cimientos
--     contradice el criterio del BRIEF 2.2 ("prefiere siempre estable y
--     compatible sobre nuevo"), que es justo por lo que no usamos Prisma 8 RC.
--     Por coherencia, la opcion A es la que propongo.
--     Y SIGUE SIN RESOLVER el conflicto 2.c: hay que decidirlo igualmente.
--
-- 4. QUE HAY ABAJO
-- El DDL de la OPCION B, con la PK ya corregida para incluir la columna de
-- particion. NO esta transcrito a mano: se deriva automaticamente del DDL ya
-- verificado de prisma/migrations/20261014193000_ceiba_initial_schema, por lo
-- que las columnas y sus tipos coinciden exactamente con el resto del esquema.
-- Los indices y las claves foraneas de estas cuatro tablas estan en esa misma
-- migracion y se crean igual, SALVO fk_testrun_history (conflicto 2.c).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- OPCION B: tablas particionadas  (derivado de la migracion inicial verificada)
-- -----------------------------------------------------------------------------

CREATE TABLE "share_access_attempts" (
    "id" BIGSERIAL NOT NULL,
    "shared_link_id" UUID NOT NULL,
    "share_access_code_id" UUID,
    "result" "access_attempt_result" NOT NULL,
    "client_ip" INET,
    "client_ip_prefix" INET,
    "user_agent_hash" BYTEA,
    "authenticated_user_id" UUID,
    "attempted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_access_attempts_pkey" PRIMARY KEY ("id", "attempted_at")
) PARTITION BY RANGE ("attempted_at");

CREATE TABLE "request_history" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "collection_id" UUID,
    "api_request_id" UUID,
    "environment_id" UUID,
    "executed_by_user_id" UUID,
    "shared_link_id" UUID,
    "collection_run_id" UUID,
    "method" "http_method" NOT NULL,
    "method_custom" TEXT,
    "url_final" TEXT NOT NULL,
    "url_host" TEXT NOT NULL,
    "request_size_bytes" BIGINT,
    "status_code" SMALLINT,
    "status_text" TEXT,
    "outcome" "execution_outcome" NOT NULL,
    "error_code" TEXT,
    "error_message" TEXT,
    "duration_total_ms" INTEGER,
    "duration_ttfb_ms" INTEGER,
    "duration_dns_ms" INTEGER,
    "duration_tls_ms" INTEGER,
    "response_size_bytes" BIGINT,
    "response_content_type" TEXT,
    "redirect_count" SMALLINT NOT NULL DEFAULT 0,
    "request_headers_snapshot" JSONB,
    "response_headers_snapshot" JSONB,
    "response_artifact_id" UUID,
    "request_artifact_id" UUID,
    "body_persistence" "body_persistence" NOT NULL DEFAULT 'none',
    "is_pinned" BOOLEAN NOT NULL DEFAULT false,
    "executed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "request_history_pkey" PRIMARY KEY ("id", "executed_at")
) PARTITION BY RANGE ("executed_at");

CREATE TABLE "test_runs" (
    "id" BIGSERIAL NOT NULL,
    "test_definition_id" UUID,
    "collection_run_id" UUID,
    "request_history_id" UUID,
    "api_request_id" UUID,
    "iteration" INTEGER NOT NULL DEFAULT 1,
    "test_name_snapshot" TEXT NOT NULL,
    "kind" "test_kind" NOT NULL,
    "result" "test_result" NOT NULL,
    "expected_snapshot" TEXT,
    "actual_snapshot" TEXT,
    "failure_message" TEXT,
    "duration_ms" INTEGER,
    "executed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "test_runs_pkey" PRIMARY KEY ("id", "executed_at")
) PARTITION BY RANGE ("executed_at");

CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "workspace_id" UUID,
    "actor_user_id" UUID,
    "actor_kind" TEXT NOT NULL DEFAULT 'user',
    "actor_ip" INET,
    "actor_user_agent_hash" BYTEA,
    "session_id" UUID,
    "shared_link_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" "audit_target_type" NOT NULL,
    "target_id" UUID,
    "target_label" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'success',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id", "occurred_at")
) PARTITION BY RANGE ("occurred_at");

-- -----------------------------------------------------------------------------
-- Creacion de particiones mensuales.
--
-- Una tabla particionada SIN particiones rechaza toda insercion ("no partition
-- of relation found for row"). Hay que crear el mes en curso ANTES de insertar
-- nada, y despues crear el siguiente mes con antelacion desde un job.
-- Se incluye una particion DEFAULT como red de seguridad: sin ella, una fila
-- fuera de rango aborta la transaccion. Con ella, la fila aterriza en DEFAULT y
-- el problema se detecta por monitorizacion en vez de por caida.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ceiba_ensure_month_partition(
  p_table text, p_month date
) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_from date := date_trunc('month', p_month)::date;
  v_to   date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_name text := format('%s_p%s', p_table, to_char(v_from, 'YYYYMM'));
BEGIN
  IF to_regclass(format('public.%I', v_name)) IS NOT NULL THEN
    RETURN;
  END IF;
  EXECUTE format(
    'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
    v_name, p_table, v_from, v_to);
END $$;

-- Mes en curso y mes siguiente para las cuatro tablas.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['request_history','audit_logs','test_runs','share_access_attempts']
  LOOP
    PERFORM ceiba_ensure_month_partition(t, CURRENT_DATE);
    PERFORM ceiba_ensure_month_partition(t, (CURRENT_DATE + interval '1 month')::date);
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I_pdefault PARTITION OF %I DEFAULT', t, t);
  END LOOP;
END $$;

-- Purga: DROP TABLE de la particion caducada. Es O(1).
--   DROP TABLE request_history_p202501;
-- NUNCA un DELETE masivo: es justo lo que el particionado viene a evitar.
--
-- RECORDATORIO: esto NO se ha ejecutado. Antes de aplicarlo contra cualquier
-- entorno con datos hace falta autorizacion explicita del cliente, porque
-- sustituir tablas existentes por sus versiones particionadas implica copiar y
-- borrar datos.
