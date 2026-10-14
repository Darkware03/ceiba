#!/bin/sh
# CEIBA — aplicación controlada de migraciones.
#
# [NO VERIFICADO] Este script nunca se ha ejecutado contra una base de datos:
# no hay PostgreSQL ni Docker en el contenedor donde se escribió. Sí se ha
# analizado con ShellCheck 0.11.0 (modo sh), sin hallazgos.
#
# Contrato:
#   · Sólo ejecuta `prisma migrate status` y `prisma migrate deploy`.
#   · `deploy` es idempotente y NO destructivo: aplica las migraciones
#     pendientes que ya están versionadas en el repositorio y no toca nada más.
#   · Si falla, sale distinto de 0 y la API no arranca (depends_on:
#     service_completed_successfully en compose.yaml). Un despliegue con la
#     base de datos a medio migrar es peor que un despliegue que no arranca.
#   · NUNCA ejecuta `migrate reset`, `migrate dev`, `db push` ni `db execute`.
#     ADR-0003 y §21 del prompt maestro: las operaciones destructivas exigen
#     autorización explícita y se hacen a mano, con copia de seguridad previa.
#
# `--config` es OBLIGATORIO, no un adorno: Prisma 7 sacó la URL de conexión
# del `.prisma` (P1012) y CEIBA la declara en `prisma/prisma.config.ts`. Sin
# `--config`, el CLI valida el esquema pero se queda sin `DATABASE_URL`.
# Comprobado el 2026-10-14 con prisma 7.10.0; ver migrator.Dockerfile.

set -eu

CONFIG="${CEIBA_PRISMA_CONFIG:-/app/prisma/prisma.config.ts}"

log() { printf '[ceiba-migrate] %s\n' "$*"; }

if [ -z "${DATABASE_URL:-}" ]; then
  log "ERROR: DATABASE_URL no esta definida."
  exit 2
fi

if [ ! -f "$CONFIG" ]; then
  log "ERROR: no existe el fichero de configuracion $CONFIG"
  exit 2
fi

# Nunca imprimas DATABASE_URL: lleva la contraseña. Sólo el destino.
HOSTPORT=$(printf '%s' "$DATABASE_URL" | sed -e 's#^.*@##' -e 's#?.*$##')
log "destino: $HOSTPORT"
log "config:  $CONFIG"

log "estado ANTES de migrar"
prisma migrate status --config "$CONFIG" || true

log "aplicando migraciones pendientes (prisma migrate deploy)"
prisma migrate deploy --config "$CONFIG"

log "estado DESPUES de migrar"
prisma migrate status --config "$CONFIG"

log "migraciones aplicadas correctamente"
