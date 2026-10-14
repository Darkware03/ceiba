#!/usr/bin/env bash
# CEIBA — certificado autofirmado SÓLO para desarrollo.
#
# [NO VERIFICADO] No ejecutado aquí (no hay Nginx para probar el resultado).
#
# PARA QUÉ: la decisión C-31 exige cookies `Secure`. Una cookie `Secure` no se
# emite por HTTP, así que sin TLS el inicio de sesión NO FUNCIONA ni siquiera
# en local. Esto da el TLS mínimo para poder desarrollar contra la pila real.
#
# ESTO NO VALE PARA PRODUCCIÓN. En producción se usa un certificado de una CA
# reconocida (Let's Encrypt o un certificado gestionado de GCP). Ver
# DESPLIEGUE.md §6.3.

set -Eeuo pipefail

OUT_DIR="${CEIBA_TLS_DIR:-./tls}"
DAYS="${CEIBA_TLS_DAYS:-825}"
CN="${CEIBA_TLS_CN:-localhost}"

command -v openssl >/dev/null 2>&1 || { echo "openssl no esta instalado" >&2; exit 1; }

mkdir -p "$OUT_DIR"

if [ -f "${OUT_DIR}/ceiba.crt" ] && [ "${CEIBA_TLS_FORCE:-0}" != "1" ]; then
  echo "Ya existe ${OUT_DIR}/ceiba.crt. Para regenerarlo: CEIBA_TLS_FORCE=1 $0"
  exit 0
fi

# Con SAN: los navegadores modernos ignoran el CN desde hace años y sin
# subjectAltName el certificado se rechaza sin excepción posible.
openssl req -x509 -nodes \
  -newkey rsa:2048 \
  -days "$DAYS" \
  -keyout "${OUT_DIR}/ceiba.key" \
  -out    "${OUT_DIR}/ceiba.crt" \
  -subj   "/C=ES/O=CEIBA API Studio (desarrollo)/CN=${CN}" \
  -addext "subjectAltName=DNS:${CN},DNS:*.${CN},IP:127.0.0.1,IP:::1" \
  -addext "keyUsage=digitalSignature,keyEncipherment" \
  -addext "extendedKeyUsage=serverAuth"

chmod 0600 "${OUT_DIR}/ceiba.key"
chmod 0644 "${OUT_DIR}/ceiba.crt"

# Este script acaba de escribir una CLAVE PRIVADA dentro del árbol de trabajo.
# Antes se afirmaba aquí que `.gitignore` ya la excluía. ERA FALSO: comprobado
# el 2026-10-14, `git check-ignore -v tls/ceiba.key` sale con código 1 y sin
# salida, es decir, NO está ignorada. Así que en vez de afirmarlo, se
# COMPRUEBA, en cada ejecución, y se dice lo que haya.
if git rev-parse --git-dir >/dev/null 2>&1; then
  if git check-ignore -q "${OUT_DIR}/ceiba.key" 2>/dev/null; then
    IGNORADA="SI (lo confirma git check-ignore)"
  else
    IGNORADA="NO  <<< PELIGRO: anade '${OUT_DIR%/}/' y '*.key' a .gitignore ANTES de hacer commit"
  fi
else
  IGNORADA="desconocido (esto no es un repositorio git)"
fi

cat <<EOF

Certificado de DESARROLLO generado en ${OUT_DIR}:
  ceiba.crt  (publico)
  ceiba.key  (PRIVADO, 0600)

Ignorada por git la clave privada: ${IGNORADA}

El navegador avisara de que no confia en el certificado. Es lo esperado.
EOF
