#!/usr/bin/env bash
# CEIBA — restauración desde una copia de seguridad.
#
# [NO VERIFICADO] Este script NUNCA se ha ejecutado. No hay Docker ni
# PostgreSQL en el contenedor donde se escribió.
#
# ESTO SOBRESCRIBE DATOS. Por eso:
#   · Por defecto NO restaura: sólo verifica la copia (`--verify-only`).
#   · Para restaurar de verdad hacen falta DOS cosas a la vez: el flag
#     `--yes-restore` y la variable `CEIBA_RESTORE_CONFIRM=<nombre-de-la-bd>`.
#     Un solo flag olvidado en un historial de shell no debe poder borrar una
#     base de datos de producción.
#   · Antes de tocar nada hace una copia de seguridad de seguridad
#     («pre-restore») de lo que haya ahora, salvo que se le diga --no-safety.
#
# El mandato del cliente es explícito: «Antes de operaciones destructivas,
# migraciones que puedan perder datos o cambios de infraestructura con
# impacto, detente y solicita autorización específica.» Este script no puede
# pedir autorización por ti: lo que hace es que sea imposible ejecutarlo sin
# haberla pedido.
#
# USO
#   ./infra/scripts/restore.sh --verify-only ./backups/20261014T120000Z
#   CEIBA_RESTORE_CONFIRM=ceiba ./infra/scripts/restore.sh --yes-restore ./backups/20261014T120000Z

set -Eeuo pipefail

COMPOSE_FILE="${CEIBA_COMPOSE_FILE:-infra/compose.yaml}"
ENV_FILE="${CEIBA_ENV_FILE:-.env}"
MODE="verify"
SAFETY=1
SRC=""

while [ $# -gt 0 ]; do
  case "$1" in
    --verify-only) MODE="verify"; shift ;;
    --yes-restore) MODE="restore"; shift ;;
    --no-safety)   SAFETY=0; shift ;;
    -h|--help)     sed -n '2,32p' "$0"; exit 0 ;;
    -*)            echo "Opcion desconocida: $1" >&2; exit 2 ;;
    *)             SRC="$1"; shift ;;
  esac
done

log()  { printf '[restore %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die()  { printf '[restore] ERROR: %s\n' "$*" >&2; exit 1; }

[ -n "$SRC" ] || die "indica el directorio de la copia a restaurar"
[ -d "$SRC" ] || die "no existe el directorio $SRC"
command -v docker >/dev/null 2>&1 || die "no hay docker en el PATH"
[ -f "$COMPOSE_FILE" ] || die "no encuentro $COMPOSE_FILE (ejecuta desde la raiz del repositorio)"

dc() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

PG_USER="$(grep -E '^POSTGRES_USER=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)"
PG_DB="$(grep -E '^POSTGRES_DB=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)"
PG_USER="${PG_USER:-ceiba}"
PG_DB="${PG_DB:-ceiba}"
DUMP="${SRC}/postgres-${PG_DB}.dump"

# ---------------------------------------------------------------------------
# Verificación — siempre, también antes de restaurar
# ---------------------------------------------------------------------------
log "verificando la copia en $SRC"

[ -f "$DUMP" ] || die "no encuentro el volcado $DUMP"

if [ -f "${SRC}/SHA256SUMS" ]; then
  if ( cd "$SRC" && sha256sum --check --quiet SHA256SUMS ); then
    log "sumas de verificacion: OK"
  else
    die "las sumas de verificacion NO cuadran: la copia esta corrupta o incompleta"
  fi
else
  log "AVISO: la copia no trae SHA256SUMS; no puedo comprobar su integridad"
fi

# `pg_restore --list` lee el índice del volcado sin tocar ninguna base de
# datos. Si esto falla, el fichero no es restaurable y da igual lo demás.
log "leyendo el indice del volcado (sin escribir nada)"
if dc exec -T postgres pg_restore --list /dev/stdin < "$DUMP" > "/tmp/ceiba-restore-toc.$$" 2>&1; then
  OBJECTS=$(wc -l < "/tmp/ceiba-restore-toc.$$")
  log "volcado legible: ${OBJECTS} entradas en el indice"
  rm -f "/tmp/ceiba-restore-toc.$$"
else
  cat "/tmp/ceiba-restore-toc.$$" >&2 || true
  rm -f "/tmp/ceiba-restore-toc.$$"
  die "pg_restore no puede leer el volcado"
fi

if [ "$MODE" = "verify" ]; then
  log "modo verificacion: no se ha modificado nada."
  log "para restaurar de verdad:  CEIBA_RESTORE_CONFIRM=${PG_DB} $0 --yes-restore ${SRC}"
  exit 0
fi

# ---------------------------------------------------------------------------
# Restauración — a partir de aquí se escribe
# ---------------------------------------------------------------------------
if [ "${CEIBA_RESTORE_CONFIRM:-}" != "$PG_DB" ]; then
  die "falta la confirmacion explicita. Exporta CEIBA_RESTORE_CONFIRM=${PG_DB} si de verdad quieres sobrescribir la base de datos '${PG_DB}'."
fi

cat >&2 <<EOF

  ATENCION
  Vas a sobrescribir la base de datos '${PG_DB}' con el contenido de:
      ${SRC}
  Los datos actuales que no esten en esa copia SE PIERDEN.

EOF

if [ "$SAFETY" -eq 1 ]; then
  log "copia de seguridad previa (pre-restore) antes de sobrescribir"
  CEIBA_BACKUP_DIR="${CEIBA_BACKUP_DIR:-./backups}/pre-restore" \
    ./infra/scripts/backup.sh \
    || die "la copia previa fallo; NO sigo. Usa --no-safety solo si sabes lo que haces."
fi

# Se paran los consumidores, no la base de datos: restaurar con la API
# escribiendo encima produce un estado mezclado imposible de razonar.
log "parando api, migrator y engine"
dc stop api engine >/dev/null 2>&1 || true

log "restaurando (pg_restore --clean --if-exists --single-transaction)"
# `--single-transaction`: o entra todo o no entra nada. Un restore a medias es
# el peor resultado posible.
dc exec -T postgres pg_restore \
      --username="$PG_USER" \
      --dbname="$PG_DB" \
      --clean --if-exists \
      --no-owner --no-privileges \
      --single-transaction \
      --verbose \
    < "$DUMP" \
  || die "pg_restore fallo. La transaccion se ha revertido; la base deberia estar como antes."

# Redis NO se restaura automáticamente: es caché y colas. Reinyectar una cola
# vieja puede re-ejecutar trabajos ya hechos, con efectos (un POST duplicado
# contra la API de un usuario). Se hace a mano y a conciencia.
if [ -f "${SRC}/redis-dump.rdb" ]; then
  log "hay un dump.rdb en la copia. NO se restaura automaticamente."
  log "Redis es cache y colas: reinyectar trabajos viejos puede duplicar efectos."
  log "Si lo necesitas, el procedimiento manual esta en DESPLIEGUE.md §7.4."
fi

if [ -f "${SRC}/api-uploads.tar" ]; then
  log "restaurando ficheros subidos"
  dc start api >/dev/null
  sleep 3
  UPLOAD_DIR="$(grep -E '^CEIBA_UPLOAD_DIR=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true)"
  UPLOAD_DIR="${UPLOAD_DIR:-/var/lib/ceiba/uploads}"
  dc exec -T api tar -C "$UPLOAD_DIR" -xf - < "${SRC}/api-uploads.tar" \
    || log "AVISO: no pude restaurar los ficheros subidos"
fi

log "arrancando la pila"
dc up -d --wait

log "estado de las migraciones tras la restauracion"
dc run --rm migrator || log "AVISO: revisa el estado de las migraciones a mano"

log "restauracion terminada. COMPRUEBA la aplicacion antes de dar por bueno el resultado."
