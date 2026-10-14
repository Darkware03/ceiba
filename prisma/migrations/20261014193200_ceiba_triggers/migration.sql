-- =============================================================================
-- CEIBA API Studio - TRIGGERS  (invariantes que no son CHECK de fila)
-- Autor: database-engineer   Fecha: 2026-10-14
--
-- ESTADO: ESCRITO, **NO EJECUTADO Y NO PROBADO**. No hay PostgreSQL en este
-- entorno (verificado 2026-10-14). Marcar esto como "funciona" seria mentir.
--
-- NATURALEZA DE ESTE FICHERO, DICHA SIN ADORNO:
-- MODELO-DATOS.md 8.5 enumera siete invariantes y NOMBRA el mecanismo
-- ("trigger AFTER UPDATE/DELETE sobre workspace_members", etc.) pero NO
-- contiene el codigo. El codigo de abajo es una PROPUESTA mia, derivada de esa
-- especificacion; no es la transcripcion de algo ya revisado. Por tanto es lo
-- que menos confianza merece de todo el entregable y lo primero que hay que
-- ejecutar y probar en cuanto haya un PostgreSQL. Las pruebas concretas que
-- debe pasar estan en MODELO-DATOS-PRISMA.md, seccion "Pruebas de integridad".
--
-- Prisma no modela triggers en absoluto: ni los crea, ni los ve, ni los borra.
-- =============================================================================


-- =============================================================================
-- 1. JERARQUIA DE CARPETAS: materialized_path, depth y ANTI-CICLO
--
-- `parent_folder_id` es la verdad; `materialized_path` y `depth` son derivados.
-- Si se desincronizan, la consulta de subarbol por prefijo devuelve resultados
-- equivocados EN SILENCIO, que es el peor modo de fallo posible aqui.
--
-- El trigger BEFORE solo recalcula cuando cambia el padre (o en INSERT). Es
-- deliberado: la reescritura masiva del subarbol que hace el trigger AFTER no
-- toca `parent_folder_id`, de modo que no vuelve a entrar aqui y no hay
-- recursion.
-- =============================================================================
CREATE OR REPLACE FUNCTION ceiba_folder_path_before() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_parent_path  text;
  v_parent_depth smallint;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.parent_folder_id IS NOT DISTINCT FROM OLD.parent_folder_id THEN
    RETURN NEW;                      -- el padre no cambia: nada que recalcular
  END IF;

  IF NEW.parent_folder_id IS NULL THEN
    NEW.materialized_path := '/' || NEW.id::text || '/';
    NEW.depth := 0;
  ELSE
    SELECT f.materialized_path, f.depth
      INTO v_parent_path, v_parent_depth
      FROM collection_folders f
     WHERE f.id = NEW.parent_folder_id;

    IF v_parent_path IS NULL THEN
      RAISE EXCEPTION 'ceiba: la carpeta padre % no existe', NEW.parent_folder_id;
    END IF;

    -- ANTI-CICLO: si el camino del padre empieza por el camino de ESTA carpeta,
    -- el padre esta dentro de su propio subarbol. Mover ahi crearia un ciclo.
    IF TG_OP = 'UPDATE' AND v_parent_path LIKE OLD.materialized_path || '%' THEN
      RAISE EXCEPTION
        'ceiba: ciclo de carpetas; % no puede colgar de %, que esta en su propio subarbol',
        NEW.id, NEW.parent_folder_id;
    END IF;

    NEW.materialized_path := v_parent_path || NEW.id::text || '/';
    NEW.depth := v_parent_depth + 1;
  END IF;

  -- Redundante con ck_folder_depth, pero da un mensaje util y corta antes de
  -- reescribir un subarbol entero.
  IF NEW.depth > 32 THEN
    RAISE EXCEPTION 'ceiba: profundidad maxima de carpetas (32) superada en %', NEW.id;
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION ceiba_folder_path_after() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.materialized_path IS DISTINCT FROM OLD.materialized_path THEN
    -- Reescribe el subarbol en UNA sentencia: sustituye el prefijo antiguo por
    -- el nuevo y desplaza la profundidad por el mismo delta.
    UPDATE collection_folders f
       SET materialized_path = NEW.materialized_path
             || substring(f.materialized_path from length(OLD.materialized_path) + 1),
           depth = (f.depth + (NEW.depth - OLD.depth))::smallint
     WHERE f.materialized_path LIKE OLD.materialized_path || '%'
       AND f.id <> NEW.id;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_folder_path_before ON collection_folders;
CREATE TRIGGER trg_folder_path_before
  BEFORE INSERT OR UPDATE OF parent_folder_id ON collection_folders
  FOR EACH ROW EXECUTE FUNCTION ceiba_folder_path_before();

DROP TRIGGER IF EXISTS trg_folder_path_after ON collection_folders;
CREATE TRIGGER trg_folder_path_after
  AFTER UPDATE OF parent_folder_id ON collection_folders
  FOR EACH ROW EXECUTE FUNCTION ceiba_folder_path_after();


-- =============================================================================
-- 2. TODO WORKSPACE VIVO TIENE AL MENOS UN PROPIETARIO ACTIVO
--
-- Es CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED a proposito: una
-- transferencia de propiedad degrada al antiguo propietario y promueve al
-- nuevo en la MISMA transaccion. Con un trigger inmediato, el orden de las dos
-- sentencias decidiria si la operacion es legal, que es una trampa. Diferido,
-- solo importa el estado al hacer COMMIT.
--
-- No se exige nada si el workspace esta borrado logicamente o ya no existe:
-- el borrado en cascada de sus miembros no debe fallar.
-- =============================================================================
CREATE OR REPLACE FUNCTION ceiba_workspace_owner_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_ws uuid := COALESCE(NEW.workspace_id, OLD.workspace_id);
  v_n  integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.id = v_ws AND w.deleted_at IS NULL) THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO v_n
    FROM workspace_members m
   WHERE m.workspace_id = v_ws
     AND m.role   = 'owner'
     AND m.status = 'active';

  IF v_n = 0 THEN
    RAISE EXCEPTION
      'ceiba: el workspace % quedaria sin ningun miembro activo con rol owner', v_ws;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_workspace_owner_guard ON workspace_members;
CREATE CONSTRAINT TRIGGER trg_workspace_owner_guard
  AFTER UPDATE OR DELETE ON workspace_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ceiba_workspace_owner_guard();


-- =============================================================================
-- 3. collections.request_count
--
-- Contador denormalizado para no pagar COUNT(*) al pintar el arbol de una
-- coleccion de miles de solicitudes.
--
-- DECISION QUE HAY QUE CONFIRMAR: cuenta solicitudes VIVAS, es decir con
-- deleted_at IS NULL. El DBML dice "contador denormalizado mantenido por
-- trigger" sin precisar si incluye las borradas logicamente. Elijo vivas
-- porque es el numero que la interfaz ensena; si la decision correcta fuera
-- otra, cambia solo el predicado de este fichero.
-- =============================================================================
CREATE OR REPLACE FUNCTION ceiba_collection_request_count() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_old_live boolean := (TG_OP <> 'INSERT') AND (OLD.deleted_at IS NULL);
  v_new_live boolean := (TG_OP <> 'DELETE') AND (NEW.deleted_at IS NULL);
BEGIN
  IF v_old_live THEN
    UPDATE collections SET request_count = GREATEST(request_count - 1, 0)
     WHERE id = OLD.collection_id;
  END IF;
  IF v_new_live THEN
    UPDATE collections SET request_count = request_count + 1
     WHERE id = NEW.collection_id;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_collection_request_count ON api_requests;
CREATE TRIGGER trg_collection_request_count
  AFTER INSERT OR DELETE OR UPDATE OF collection_id, deleted_at ON api_requests
  FOR EACH ROW EXECUTE FUNCTION ceiba_collection_request_count();


-- =============================================================================
-- 4. collection_versions.version_number MONOTONO POR COLECCION
--
-- No se puede usar una secuencia global: el numero debe empezar en 1 en cada
-- coleccion. Se toma un bloqueo de fila sobre `collections` para serializar
-- dos instantaneas simultaneas de la misma coleccion; dos colecciones
-- distintas no se bloquean entre si.
--
-- El historial es append-only: una restauracion crea una version NUEVA con
-- source='restore', no reescribe ninguna.
-- =============================================================================
CREATE OR REPLACE FUNCTION ceiba_version_number() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_next integer;
BEGIN
  SELECT current_version_number + 1 INTO v_next
    FROM collections
   WHERE id = NEW.collection_id
     FOR UPDATE;

  IF v_next IS NULL THEN
    RAISE EXCEPTION 'ceiba: la coleccion % no existe', NEW.collection_id;
  END IF;

  NEW.version_number := v_next;
  UPDATE collections SET current_version_number = v_next WHERE id = NEW.collection_id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_version_number ON collection_versions;
CREATE TRIGGER trg_version_number
  BEFORE INSERT ON collection_versions
  FOR EACH ROW EXECUTE FUNCTION ceiba_version_number();


-- =============================================================================
-- 5. SINCRONIA retention_policies -> workspaces
--
-- Las cuatro columnas de retencion estan duplicadas en `workspaces` a
-- proposito: la ruta caliente de ejecucion necesita la politica sin un JOIN
-- adicional. `retention_policies` es la politica VIVA y editable; `workspaces`
-- es la copia de lectura rapida. La duplicacion solo es admisible si algo
-- garantiza que no divergen, y ese algo es este trigger.
-- =============================================================================
CREATE OR REPLACE FUNCTION ceiba_retention_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE workspaces w
     SET history_retention_days    = NEW.history_retention_days,
         response_body_persistence = NEW.response_body_persistence,
         response_retention_days   = NEW.response_retention_days,
         response_max_persist_bytes = NEW.response_max_persist_bytes
   WHERE w.id = NEW.workspace_id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_retention_sync ON retention_policies;
CREATE TRIGGER trg_retention_sync
  AFTER INSERT OR UPDATE ON retention_policies
  FOR EACH ROW EXECUTE FUNCTION ceiba_retention_sync();


-- =============================================================================
-- INVARIANTE QUE NO SE CUBRE AQUI, Y POR QUE
--
-- `secrets.scope_id` apunta a cinco tablas distintas segun `scope` y NO lleva
-- clave foranea. Es una renuncia consciente: la boveda debe sobrevivir al
-- borrado del recurso que uso el secreto, para poder auditar la rotacion, y un
-- FK con CASCADE borraria esa evidencia. Un trigger que lo validase en cada
-- INSERT reintroduciria el acoplamiento por la puerta de atras y ademas
-- fallaria al borrar el recurso.
-- La integridad se vigila con un JOB DE RECONCILIACION periodico, que es
-- codigo de aplicacion y no esquema. Queda fuera de este entregable y esta
-- declarado como HUECO en MODELO-DATOS-PRISMA.md.
-- =============================================================================
