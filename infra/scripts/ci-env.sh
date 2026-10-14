#!/usr/bin/env bash
# CEIBA — genera un `.env` DESECHABLE para integración continua.
#
# [NO VERIFICADO] No ejecutado: aquí no hay runner de CI. Sí se ha analizado
# con ShellCheck 0.11.0, sin hallazgos.
#
# Los valores que produce son aleatorios y mueren con el job. NO SON SECRETOS
# REALES y no deben usarse en ningún entorno con datos. Los secretos de
# verdad viven en GCP Secret Manager (DESPLIEGUE.md §10), nunca en el
# repositorio ni en una variable de workflow sin cifrar.
#
# Se niega a pisar un `.env` existente salvo que esté en CI: borrar el `.env`
# de alguien que lo ejecute por error en su máquina es exactamente el tipo de
# sorpresa que no queremos.

set -Eeuo pipefail

PLANTILLA="${CEIBA_ENV_TEMPLATE:-.env.example}"
DESTINO="${CEIBA_ENV_FILE:-.env}"

die() { printf '[ci-env] ERROR: %s\n' "$*" >&2; exit 1; }

[ -f "$PLANTILLA" ] || die "no encuentro $PLANTILLA (ejecuta desde la raiz del repositorio)"

if [ -f "$DESTINO" ] && [ "${CI:-}" != "true" ] && [ "${CEIBA_ENV_FORCE:-}" != "1" ]; then
  die "ya existe $DESTINO y no estamos en CI. Usa CEIBA_ENV_FORCE=1 si de verdad quieres sobrescribirlo."
fi

command -v openssl >/dev/null 2>&1 || die "openssl no esta disponible"

# Cada <generar> recibe un valor distinto. Hexadecimal a propósito: así ningún
# valor lleva '/', '+' ni '=', que romperían los `sed` de más abajo y las URL.
: > "$DESTINO"
while IFS= read -r linea || [ -n "$linea" ]; do
  while case "$linea" in *'<generar>'*) true ;; *) false ;; esac; do
    valor="$(openssl rand -hex 32)"
    linea="${linea/<generar>/$valor}"
  done
  printf '%s\n' "$linea" >> "$DESTINO"
done < "$PLANTILLA"

fijar() {
  clave="$1"; valor="$2"
  if grep -q "^${clave}=" "$DESTINO"; then
    sed -i "s|^${clave}=.*|${clave}=${valor}|" "$DESTINO"
  else
    printf '%s=%s\n' "$clave" "$valor" >> "$DESTINO"
  fi
}

leer() { grep -E "^$1=" "$DESTINO" | head -1 | cut -d= -f2-; }

PG_USER="$(leer POSTGRES_USER)"; PG_USER="${PG_USER:-ceiba}"
PG_DB="$(leer POSTGRES_DB)";     PG_DB="${PG_DB:-ceiba}"
PG_PASS="$(leer POSTGRES_PASSWORD)"

[ -n "$PG_PASS" ] || die "POSTGRES_PASSWORD quedo vacia"

# La plantilla trae la contraseña enmascarada con '***' dentro de DATABASE_URL.
# Hay que coserla con la que acabamos de generar o el migrador no entra.
fijar DATABASE_URL "postgresql://${PG_USER}:${PG_PASS}@postgres:5432/${PG_DB}?schema=public"

fijar NODE_ENV            production
fijar LOG_LEVEL           info
fijar CEIBA_PUBLIC_URL    "https://localhost:8443"
fijar CEIBA_HTTP_PORT     8080
fijar CEIBA_HTTPS_PORT    8443
# `../tls` y no `./tls`: compose resuelve las rutas relativas contra su
# directorio de proyecto, que con `-f infra/compose.yaml` es `infra/`.
fijar CEIBA_TLS_DIR       "../tls"
fijar CEIBA_IMAGE_TAG     ci
fijar CEIBA_AI_ENABLED    false
# ADR-0009 §6.1: `trustProxy` acotado al CIDR del proxy, nunca `true`.
fijar CEIBA_TRUSTED_PROXIES "172.31.241.0/24"
fijar CEIBA_SMTP_URL      ""

chmod 0600 "$DESTINO"

# Nunca se imprime el contenido: los logs de CI son públicos en repositorios
# públicos y quedan archivados en los privados.
printf '[ci-env] %s generado con %s claves (valores desechables, no mostrados)\n' \
  "$DESTINO" "$(grep -cE '^[A-Za-z_]+=' "$DESTINO")"
