#!/usr/bin/env bash
# CEIBA — copia de seguridad de la pila.
#
# [NO VERIFICADO] Este script NUNCA se ha ejecutado. En el contenedor donde se
# escribió no existen `docker`, `pg_dump` ni `redis-cli`. No afirmo que
# funcione: afirmo que está escrito para ejecutarse donde sí haya Docker, y que
# el procedimiento de comprobación está en DESPLIEGUE.md §7.
#
# QUÉ COPIA
#   1. PostgreSQL  — `pg_dump -Fc` (formato custom, comprimido y restaurable
#                    por partes con pg_restore). Es la fuente de verdad.
#   2. Redis       — `BGSAVE` + copia del `dump.rdb`. Caché y colas: útil para
#                    no perder trabajos en vuelo, NO es fuente de verdad.
#   3. Ficheros    — el volumen de subidas de la API.
#   4. Manifiesto  — versiones, tamaños y SHA-256 de cada pieza.
#
# QUÉ NO HACE, A PROPÓSITO
#   · No borra nada. Ni volúmenes, ni copias viejas, salvo que se le pida
#     explícitamente con --prune (y entonces sólo dentro de su directorio).
#   · No sube nada a ningún sitio. La subida a Cloud Storage es un paso
#     aparte y consciente; ver DESPLIEGUE.md §7.3.
#   · No cifra. Si el destino no es de confianza, cífralo tú: un volcado de
#     CEIBA contiene secretos de usuario cifrados Y la tabla de sesiones.
#
# USO
#   ./infra/scripts/backup.sh                      # a ./backups
#   CEIBA_BACKUP_DIR=/mnt/discos/ceiba ./infra/scripts/backup.sh
#   ./infra/scripts/backup.sh --prune 14           # conserva 14 días

set -Eeuo pipefail

COMPOSE_FILE="${CEIBA_COMPOSE_FILE:-infra/compose.yaml}"
ENV_FILE="${CEIBA_ENV_FILE:-.env}"
BACKUP_DIR="${CEIBA_BACKUP_DIR:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PRUNE_DAYS=""

while [ $# -gt 0 ]; do
  case "$1" in
    --prune) PRUNE_DAYS="${2:?--prune necesita un numero de dias}"; shift 2 ;;
    --dir)   BACKUP_DIR="${2:?--dir necesita una ruta}"; shift 2 ;;
    -h|--help) sed -n '2,40p' "$0"; exit 0 ;;
    *) echo "Opcion desconocida: $1" >&2; exit 2 ;;
  esac
done

log() { printf '[backup %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { printf '[backup] ERROR: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "no hay docker en el PATH"
[ -f "$COMPOSE_FILE" ] || die "no encuentro $COMPOSE_FILE (ejecuta desde la raiz del repositorio)"
[ -f "$ENV_FILE" ]     || die "no encuentro $ENV_FILE"

dc() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

OUT="${BACKUP_DIR}/${STAMP}"
mkdir -p "$OUT"
log "destino: $OUT"

# --- 1. PostgreSQL -----------------------------------------------------------
# `pg_dump` en caliente es consistente: usa una instantánea transaccional, no
# hace falta parar la aplicación ni bloquear tablas.
PG_USER="$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
PG_DB="$(grep -E '^POSTGRES_DB=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
PG_USER="${PG_USER:-ceiba}"
PG_DB="${PG_DB:-ceiba}"

log "PostgreSQL: pg_dump -Fc de la base '$PG_DB'"
dc exec -T postgres pg_dump \
    --username="$PG_USER" \
    --dbname="$PG_DB" \
    --format=custom \
    --compress=9 \
    --no-owner --no-privileges \
    --verbose \
  > "${OUT}/postgres-${PG_DB}.dump" 2> "${OUT}/postgres-dump.log" \
  || die "pg_dump fallo; mira ${OUT}/postgres-dump.log"

# Esquema por separado, en texto plano: hace legible el diff entre copias y
# permite revisar una migración sin restaurar nada.
dc exec -T postgres pg_dump \
    --username="$PG_USER" --dbname="$PG_DB" --schema-only --no-owner \
  > "${OUT}/postgres-schema.sql" 2>/dev/null || true

# --- 2. Redis ----------------------------------------------------------------
log "Redis: BGSAVE"
dc exec -T redis redis-cli BGSAVE >/dev/null || log "AVISO: BGSAVE fallo; sigo"

# Espera a que termine el volcado: copiar un dump.rdb a medio escribir es
# copiar basura. `rdb_bgsave_in_progress` vuelve a 0 al acabar.
for _ in $(seq 1 60); do
  if dc exec -T redis redis-cli INFO persistence 2>/dev/null \
      | tr -d '\r' | grep -q '^rdb_bgsave_in_progress:0$'; then
    break
  fi
  sleep 1
done
dc exec -T redis sh -c 'cat /data/dump.rdb' > "${OUT}/redis-dump.rdb" 2>/dev/null \
  || log "AVISO: no pude copiar dump.rdb (Redis puede no tener datos aun)"

# --- 3. Ficheros subidos -----------------------------------------------------
log "Volumen de subidas de la API"
UPLOAD_DIR="$(grep -E '^CEIBA_UPLOAD_DIR=' "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
UPLOAD_DIR="${UPLOAD_DIR:-/var/lib/ceiba/uploads}"
dc exec -T api tar -C "$UPLOAD_DIR" -cf - . > "${OUT}/api-uploads.tar" 2>/dev/null \
  || log "AVISO: no pude archivar $UPLOAD_DIR (¿vacio o api parada?)"

# --- 4. Manifiesto -----------------------------------------------------------
log "Manifiesto y sumas de verificacion"
{
  echo "ceiba_backup: 1"
  echo "timestamp_utc: ${STAMP}"
  echo "host: $(hostname)"
  echo "compose_file: ${COMPOSE_FILE}"
  echo "postgres_version: $(dc exec -T postgres postgres --version 2>/dev/null | tr -d '\r' || echo desconocida)"
  echo "redis_version: $(dc exec -T redis redis-server --version 2>/dev/null | tr -d '\r' || echo desconocida)"
  echo "images:"
  dc images --format json 2>/dev/null | sed 's/^/  /' || echo "  (no disponible)"
} > "${OUT}/MANIFEST.yaml"

( cd "$OUT" && sha256sum ./* > SHA256SUMS 2>/dev/null || true )

# El `.env` NO se copia: lleva secretos en claro y una copia de seguridad se
# acaba moviendo a sitios menos protegidos que el servidor. Las claves van al
# gestor de secretos (DESPLIEGUE.md §10). Sin ellas, el volcado es inútil para
# un atacante y recuperable para ti.
echo "AVISO: este backup NO incluye .env. Sin CEIBA_SECRETS_MASTER_KEY los
secretos de usuario cifrados NO se pueden descifrar tras una restauracion.
Guarda esa clave en GCP Secret Manager, no aqui." > "${OUT}/LEEME-CLAVES.txt"

# --- 5. Retención ------------------------------------------------------------
if [ -n "$PRUNE_DAYS" ]; then
  log "Eliminando copias de mas de ${PRUNE_DAYS} dias en ${BACKUP_DIR}"
  # Acotado al directorio de copias y a directorios con forma de marca de
  # tiempo: nunca puede alcanzar nada fuera de aquí.
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d \
       -name '20*T*Z' -mtime "+${PRUNE_DAYS}" -print -exec rm -rf {} + || true
fi

log "Terminado. Tamaño: $(du -sh "$OUT" | cut -f1)"
log "Comprueba SIEMPRE que la copia restaura: infra/scripts/restore.sh --verify-only ${OUT}"
