-- =============================================================================
-- CEIBA API Studio - 6/6  LO QUE PRISMA NO SABE EXPRESAR DE LAS TRES TABLAS
--                          NUEVAS DEL ADR-0009
-- Autor: database-engineer   Fecha: 2026-10-14
--
-- ESTADO: ESCRITO, **NO EJECUTADO**. En este contenedor no existe PostgreSQL
-- (comprobado hoy otra vez: `command -v psql`, `command -v postgres`,
-- `command -v pg_ctl` e `command -v initdb` no devuelven nada; no hay docker).
-- Ninguna sentencia de este fichero se ha corrido contra un motor real.
--
-- QUE ES ESTO
-- Es a la migracion 20261014213000 lo que la 20261014193100 es a la 193000:
-- la parte del diseno que el lenguaje de Prisma no tiene. Se separa en dos
-- ficheros a proposito y por la misma razon que entonces:
--   . 20261014213000 es la salida LITERAL de `prisma migrate diff`, byte a
--     byte. Se puede regenerar y comparar con `diff`. Si le metiera SQL a mano
--     esa comprobacion dejaria de existir.
--   . este fichero es SQL escrito a mano, revisable como tal.
--
-- ADITIVO, SIN EXCEPCION. Todos los objetos que toca este fichero los CREA la
-- migracion 20261014213000, que es inmediatamente anterior. No hay ni una
-- sentencia que altere, sustituya o borre nada que existiera antes de hoy.
-- C-23 prohibe la reestructuracion destructiva y aqui no hay ninguna:
--   . el UNICO DROP INDEX (seccion 2.1) borra un indice creado en la migracion
--     inmediatamente anterior, para sustituirlo por su version PARCIAL. Es el
--     mismo patron ya usado en 20261014193100 seccion 2. El de la 2.2 es un
--     indice NUEVO y no lleva DROP.
--   . el ALTER TYPE de la seccion 1 cae sobre una columna de una tabla nueva
--     y vacia.
-- La comprobacion mecanica de esta afirmacion esta en MODELO-DATOS-PRISMA.md,
-- seccion "Prueba de que el cambio es aditivo".
--
-- REQUISITO DE VERSION: PostgreSQL 15+ (igual que la 20261014193100, por
-- NULLS NOT DISTINCT). Aqui en concreto no se usa nada posterior a 9.6 salvo
-- lo que ya exigia el esquema.
--
-- DEPENDENCIA: la extension `citext` la crea la migracion 20261014192900.
-- =============================================================================


-- =============================================================================
-- 1. citext  (1 columna nueva; antes eran 6, ahora son 7 en total)
--
-- `user_auth_tokens.target_email` esta declarada `citext` en el DBML y Prisma
-- la emitio como TEXT, porque no tiene ese tipo. Sin la conversion,
-- 'Ana@ejemplo.com' y 'ana@ejemplo.com' serian direcciones distintas y un
-- testigo de verificacion emitido para una no casaria con la otra. Es el mismo
-- fallo que la migracion 20261014193100 arregla para users.email.
--
-- Sobre una tabla recien creada esto es inocuo: no hay filas que reconciliar.
-- =============================================================================
ALTER TABLE "user_auth_tokens" ALTER COLUMN "target_email" TYPE citext;


-- =============================================================================
-- 2. INDICES PARCIALES
--
-- Prisma no expresa la clausula WHERE de un indice. Los dos de abajo no son
-- una optimizacion: sin el predicado, el primero rompe una funcion y el
-- segundo no existe en absoluto.
-- =============================================================================

-- 2.1 Un administrador de plataforma VIVO por usuario y rol
--
-- Sin el predicado, revocar a un administrador dejaria la fila revocada
-- ocupando el unico (user_id, role) para siempre: no se podria volver a
-- nombrar a esa persona nunca mas, y el historial de concesiones quedaria
-- limitado a una fila por usuario. Con el predicado, conviven N concesiones
-- historicas revocadas y como mucho una viva.
--
-- Nota: una concesion CADUCADA (expires_at < now()) sigue contando como viva
-- para este indice. Es deliberado: dejar caducar no es revocar, y permitir dos
-- filas con el mismo (user_id, role) por el mero paso del tiempo convertiria
-- la consulta de autorizacion en ambigua. Para volver a conceder tras una
-- caducidad hay que revocar explicitamente la fila caducada, que ademas deja
-- rastro de quien lo hizo.
DROP INDEX IF EXISTS "uq_platform_admin_user_role";
CREATE UNIQUE INDEX "uq_platform_admin_user_role" ON "platform_admins"
  ("user_id", "role")
  WHERE "revoked_at" IS NULL;

-- 2.2 Un testigo de correo VIVO por usuario y proposito
--
-- NO lleva DROP: no sustituye a ningun indice, es nuevo. Aplica solo a los dos propositos que
-- se entregan por correo. Pedir un restablecimiento nuevo obliga a revocar el
-- anterior, de modo que en el buzon de la victima no se acumulan enlaces
-- validos: con N testigos vivos, robar UNO cualquiera basta.
--
-- `mfa_challenge` queda FUERA del predicado a proposito. Dos inicios de sesion
-- simultaneos desde dos dispositivos son legitimos y generan dos retos vivos;
-- un unico los haria fallar al segundo.
--
-- El predicado es IMMUTABLE: comparar un valor de enumeracion con literales lo
-- es. PostgreSQL lo admite en un indice parcial.
CREATE UNIQUE INDEX "uq_authtoken_one_live" ON "user_auth_tokens"
  ("user_id", "purpose")
  WHERE "purpose" IN ('email_verification', 'password_reset')
    AND "consumed_at" IS NULL
    AND "revoked_at" IS NULL;


-- =============================================================================
-- 3. RESTRICCIONES CHECK
--
-- Prisma no tiene CHECK. Todas las de abajo estan enunciadas en la nota de su
-- tabla en docs/schema/ceiba.dbml; ninguna se inventa aqui. Las dos que son
-- PROPUESTA MIA y no requisito citado van marcadas como tales.
-- =============================================================================

-- --- 3.1 platform_admins ----------------------------------------------------

-- Una concesion no puede nacer ya caducada.
ALTER TABLE "platform_admins" ADD CONSTRAINT "ck_platform_admin_expiry"
  CHECK ("expires_at" IS NULL OR "expires_at" > "granted_at");

-- No se puede registrar QUIEN revoco o POR QUE sin registrar CUANDO. Evita la
-- fila a medias que haria ambigua la consulta de autorizacion: lo que decide
-- si un administrador sigue siendo administrador es `revoked_at IS NULL`, y si
-- hay un revocador apuntado pero no fecha, la fila miente.
-- Mismo criterio que ck_member_removed y ck_share_revoked.
ALTER TABLE "platform_admins" ADD CONSTRAINT "ck_platform_admin_revoked"
  CHECK ("revoked_at" IS NOT NULL
      OR ("revoked_by_user_id" IS NULL AND "revoked_reason" IS NULL));

-- PROPUESTA MIA, no requisito citado: separacion de funciones. Nadie se
-- concede a si mismo el privilegio mas alto de la instalacion. La concesion de
-- arranque lleva granted_by_user_id NULL (no hay concedente todavia) y por eso
-- no choca con esta restriccion.
-- SI SE CONSIDERA EXCESIVA, se retira con una linea:
--   ALTER TABLE platform_admins DROP CONSTRAINT ck_platform_admin_not_self;
ALTER TABLE "platform_admins" ADD CONSTRAINT "ck_platform_admin_not_self"
  CHECK ("granted_by_user_id" IS NULL
      OR "granted_by_user_id" <> "user_id");

-- --- 3.2 user_auth_tokens ---------------------------------------------------

-- Un testigo no puede nacer caducado.
ALTER TABLE "user_auth_tokens" ADD CONSTRAINT "ck_authtoken_expiry"
  CHECK ("expires_at" > "issued_at");

-- Mismo criterio que ck_code_attempts en share_access_codes: un max_attempts
-- de 0 convertiria el reto de 2FA en imposible de superar, y un contador
-- negativo seria un limite infinito.
ALTER TABLE "user_auth_tokens" ADD CONSTRAINT "ck_authtoken_attempts"
  CHECK ("attempt_count" >= 0 AND "max_attempts" > 0);

-- La direccion de destino es obligatoria EXACTAMENTE en el proposito que
-- verifica una direccion, y esta prohibida en los otros dos. Sin la mitad
-- "solo en ese", un restablecimiento podria llevar un target_email que nadie
-- comprueba y que pareceria autorizado.
ALTER TABLE "user_auth_tokens" ADD CONSTRAINT "ck_authtoken_target"
  CHECK (("purpose" = 'email_verification') = ("target_email" IS NOT NULL));

-- Igual que en platform_admins: no hay motivo de revocacion sin revocacion.
ALTER TABLE "user_auth_tokens" ADD CONSTRAINT "ck_authtoken_revoked"
  CHECK ("revoked_at" IS NOT NULL OR "revoked_reason" IS NULL);

-- Un testigo termina de UNA de las dos maneras: consumido o revocado, nunca
-- las dos. Si pudiera estar consumido y revocado a la vez, la pregunta "se
-- uso?" dejaria de tener respuesta y la auditoria del restablecimiento de
-- contrasena se volveria inutil.
ALTER TABLE "user_auth_tokens" ADD CONSTRAINT "ck_authtoken_terminal"
  CHECK ("consumed_at" IS NULL OR "revoked_at" IS NULL);

-- --- 3.3 share_sessions -----------------------------------------------------

-- Una sesion de comparticion no puede nacer caducada. C-CODE-06 evalua la
-- expiracion SIEMPRE con la hora del servidor; esto impide ademas que una
-- fecha absurda entre por el constructor.
ALTER TABLE "share_sessions" ADD CONSTRAINT "ck_sharesession_expiry"
  CHECK ("expires_at" > "issued_at");

-- Igual que en las otras dos tablas nuevas y que en shared_links.
ALTER TABLE "share_sessions" ADD CONSTRAINT "ck_sharesession_revoked"
  CHECK ("revoked_at" IS NOT NULL OR "revoked_reason" IS NULL);

-- NO se anade ningun CHECK que impida la escritura por enlace compartido: el
-- tipo `share_permission` no contiene ningun valor de edicion, asi que es
-- imposible por construccion. Es el mismo argumento que ya esta escrito en la
-- nota de shared_links (ck_share_no_edit) y no se repite aqui como constraint
-- porque no hay nada que comprobar.


-- =============================================================================
-- 4. LO QUE NO SE PUEDE EXPRESAR NI SIQUIERA AQUI
--
-- Se deja escrito para que nadie crea que el esquema lo cubre:
--
-- 4.1 share_sessions.permission DEBE coincidir con shared_links.permission en
--     el momento de autorizar. No es un CHECK de fila: depende de otra tabla.
--     C-CODE-06 lo exige ("y que el permiso sigue siendo el mismo") y la
--     comprobacion es del guard, en cada peticion. Una FK compuesta
--     (shared_link_id, permission) -> (id, permission) lo haria cumplir en la
--     base de datos, pero exigiria un UNIQUE (id, permission) en shared_links,
--     es decir ALTERAR UNA TABLA EXISTENTE. C-23 lo prohibe y no lo hago:
--     queda como propuesta para una fase posterior, con autorizacion.
--
-- 4.2 "Revocar el enlace cancela en cascada todas sus sesiones en la misma
--     transaccion" (C-CODE-06) es un UPDATE de la aplicacion, no una FK:
--     ON DELETE CASCADE solo actua al BORRAR, y los enlaces se revocan, no se
--     borran. Se podria imponer con un trigger AFTER UPDATE sobre
--     shared_links; NO lo escribo porque seria un trigger sobre una tabla
--     EXISTENTE y porque los triggers de la migracion 20261014193200 ya estan
--     declarados como propuesta mia no revisada. Queda como HUECO explicito.
--
-- 4.3 La separacion de dominio del hash de user_auth_tokens
--     (SHA-256(purpose || ':' || verificador)) es responsabilidad de la
--     aplicacion. La base de datos no puede comprobar como se calculo un hash.
--     Lo que SI hace el esquema es no ofrecer ninguna columna donde guardar el
--     testigo en claro.
-- =============================================================================
