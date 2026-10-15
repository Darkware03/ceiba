#!/usr/bin/env bash
# Levanta CEIBA completo en local, SIN Docker: PostgreSQL + motor + API + web.
#
# Existe porque el entorno no tiene Docker y `infra/compose.yaml` no se puede
# ejecutar aquí. Esto no lo sustituye en producción; sirve para tener el
# producto funcionando y usable hoy.
#
#   ./infra/levantar-local.sh          arranca todo
#   ./infra/levantar-local.sh --parar  detiene todo
#   ./infra/levantar-local.sh --estado estado de los procesos
set -uo pipefail

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$RAIZ/.run"
PG_HOME="${CEIBA_PG_HOME:-/software-factory/.toolchain/pg}"

PUERTO_MOTOR="${CEIBA_ENGINE_PORT:-3001}"
PUERTO_API="${CEIBA_API_PORT:-3000}"
PUERTO_WEB="${CEIBA_WEB_PORT:-8443}"
PUERTO_PG="${CEIBA_PG_PORT:-55432}"

# El contenedor impone un proxy de egreso con credenciales en línea. El motor se
# niega a arrancar con él (C-SSRF-10) y haría salir el tráfico por fuera de la
# política de destino, que es justo lo que no queremos.
unset HTTP_PROXY HTTPS_PROXY http_proxy https_proxy NODE_USE_ENV_PROXY ALL_PROXY all_proxy
export COREPACK_HOME="${COREPACK_HOME:-/tmp/corepack-home}"

mkdir -p "$RUN"

parar_pid() {
  # Declaraciones separadas: en un mismo `local a=.. b="$a"` la segunda no ve
  # a la primera, y con `set -u` eso aborta el script.
  local nombre
  local f
  local pid
  nombre="$1"
  f="$RUN/$nombre.pid"
  [[ -f "$f" ]] || return 0
  pid="$(cat "$f")"
  # Por PID, nunca por patrón: un `pkill -f` en un contenedor compartido
  # alcanza al propio comando y a procesos de otros.
  if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null; sleep 1; kill -9 "$pid" 2>/dev/null; fi
  rm -f "$f"
  echo "  $nombre detenido (pid $pid)"
}

if [[ "${1:-}" == "--parar" ]]; then
  echo "deteniendo CEIBA..."
  parar_pid web; parar_pid api; parar_pid motor
  "$PG_HOME/dist/bin/pg_ctl" -D "$PG_HOME/data" -m fast -w stop >/dev/null 2>&1 \
    && echo "  postgres detenido" || echo "  postgres no estaba en marcha"
  exit 0
fi

if [[ "${1:-}" == "--estado" ]]; then
  for s in motor api web; do
    f="$RUN/$s.pid"
    if [[ -f "$f" ]] && kill -0 "$(cat "$f")" 2>/dev/null; then
      echo "  $s: EN MARCHA (pid $(cat "$f"))"
    else
      echo "  $s: parado"
    fi
  done
  "$PG_HOME/dist/bin/pg_ctl" -D "$PG_HOME/data" status >/dev/null 2>&1 \
    && echo "  postgres: EN MARCHA" || echo "  postgres: parado"
  exit 0
fi

# esperar <url> <nombre> <huella> [intentos]
#
# `huella` es un texto que SOLO puede venir de nuestro servicio. No basta con
# un 200: la primera version de este script daba "web responde" cuando el
# puerto 8080 lo ocupaba una aplicacion ajena y nuestro proceso habia muerto
# con EADDRINUSE. Una comprobacion que no distingue tu servicio del de un
# desconocido no comprueba nada, y estuvo a punto de publicarse como "listo".
esperar() {
  local url nombre huella n cuerpo
  url="$1"; nombre="$2"; huella="$3"; n="${4:-40}"
  for ((i=1; i<=n; i++)); do
    cuerpo="$(curl -sSk --max-time 2 "$url" 2>/dev/null)"
    if [[ -n "$cuerpo" ]] && grep -qF "$huella" <<<"$cuerpo"; then
      echo "  $nombre responde"; return 0
    fi
    sleep 0.5
  done
  if [[ -n "${cuerpo:-}" ]]; then
    echo "  $nombre: el puerto responde pero NO es nuestro servicio (falta '$huella')"
    echo "           recibido: $(head -c 120 <<<"$cuerpo" | tr -d '\n')"
  else
    echo "  $nombre NO responde tras $((n/2))s"
  fi
  return 1
}

# Devuelve el primer puerto libre a partir del dado.
puerto_libre() {
  local p="$1"
  while timeout 1 bash -c "echo > /dev/tcp/127.0.0.1/$p" 2>/dev/null; do
    p=$((p + 1))
  done
  echo "$p"
}

# ---------------------------------------------------------------- secretos
# De desarrollo, deterministas y locales. En producción vienen del gestor de
# secretos, nunca de un script.
export CEIBA_ENGINE_TOKEN="${CEIBA_ENGINE_TOKEN:-desarrollo-motor-$(printf '%048d' 1)}"
export CEIBA_CSRF_SECRET="${CEIBA_CSRF_SECRET:-desarrollo-csrf-secreto-de-mas-de-32-caracteres}"
export CEIBA_SECRETS_MASTER_KEY="${CEIBA_SECRETS_MASTER_KEY:-$(printf 'd%.0s' {1..64})}"
export CEIBA_SHARE_CODE_PEPPER="${CEIBA_SHARE_CODE_PEPPER:-$(printf 'p%.0s' {1..64})}"
export CEIBA_JWT_SECRET="${CEIBA_JWT_SECRET:-no-se-usa-sesion-con-estado-c31}"

echo "CEIBA — arranque local sin Docker"
echo

# EL PUERTO DE LA WEB SE RESUELVE ANTES QUE NADA, y no justo antes de
# arrancarla. La API recibe `CEIBA_PUBLIC_URL` con ese puerto y lo usa para
# validar la cabecera `Origin` del CSRF. Si se calcula despues, la API autoriza
# un puerto y la web acaba en otro: todas las mutaciones mueren con
# `csrf_invalido: Origen no permitido`, que es exactamente lo que paso la
# primera vez.
PUERTO_WEB="$(puerto_libre "$PUERTO_WEB")"

# DOS MODOS, Y LA DIFERENCIA NO ES COSMETICA.
#
# Las cookies se llaman `__Host-ceiba_session` y `__Host-ceiba_csrf` cuando hay
# TLS. Ese prefijo obliga por norma a `Secure`: sin TLS el cliente DESCARTA la
# cookie y el registro muere con `csrf_invalido: Falta el testigo CSRF`.
# Comprobado en ambos sentidos.
#
#   CEIBA_WEB_TLS=1 (por defecto)  HTTPS con certificado autofirmado. Es el
#                                  modo fiel a produccion: cookies `__Host-`.
#   CEIBA_WEB_TLS=0                HTTP plano. Necesario para exponerlo por el
#                                  portal del Gateway, que solo proxya HTTP y
#                                  devuelve 502 contra un upstream HTTPS. La
#                                  API arranca con `CEIBA_COOKIE_SECURE=false`
#                                  y las cookies pierden el prefijo para seguir
#                                  siendo almacenables.
USAR_TLS="${CEIBA_WEB_TLS:-1}"
if [[ "$USAR_TLS" == "0" ]]; then
  ESQUEMA=http; COOKIE_SECURE=false
else
  ESQUEMA=https; COOKIE_SECURE=true
fi
ORIGEN_WEB="$ESQUEMA://127.0.0.1:$PUERTO_WEB"

# ---------------------------------------------------------------- postgres
echo "[1/4] PostgreSQL"
if "$PG_HOME/dist/bin/pg_ctl" -D "$PG_HOME/data" status >/dev/null 2>&1; then
  echo "  ya en marcha en :$PUERTO_PG"
else
  node "$RAIZ/prisma/tools/provision-postgres.mjs" >/dev/null 2>&1 \
    && echo "  arrancado en :$PUERTO_PG" || { echo "  FALLO al arrancar"; exit 1; }
fi
export DATABASE_URL="postgresql://ceiba@127.0.0.1:$PUERTO_PG/ceiba"

# ---------------------------------------------------------------- motor
echo "[2/4] Motor HTTP (:$PUERTO_MOTOR)"
parar_pid motor
(
  cd "$RAIZ/apps/engine"
  # ENTORNO LIMPIO, Y NO ES CEREMONIA.
  # El motor comprueba al arrancar que NO recibe `DATABASE_URL`,
  # `CEIBA_SECRETS_MASTER_KEY`, `CEIBA_JWT_SECRET` ni `CEIBA_SHARE_CODE_PEPPER`,
  # y aborta si los ve (ADR-0002, reglas 1 y 2; decision C-25). La primera
  # version de este script las exportaba globalmente y el motor **se nego a
  # arrancar**: el aislamiento no es una promesa del documento, es una
  # comprobacion en el codigo, y pillo a quien escribio esto.
  #
  # `env -i` construye el entorno desde cero en lugar de confiar en acordarse
  # de borrar cada variable peligrosa. Lo que no se nombra aqui, el motor no lo
  # ve. Es la misma garantia que da `compose.yaml` al no pasarle `env_file`.
  nohup env -i \
    PATH="$PATH" HOME="$HOME" \
    NODE_ENV=development \
    CEIBA_ENGINE_HOST=127.0.0.1 \
    CEIBA_ENGINE_PORT="$PUERTO_MOTOR" \
    CEIBA_ENGINE_TOKEN="$CEIBA_ENGINE_TOKEN" \
    CEIBA_SSRF_PROTECTION=on \
    node src/index.ts > "$RUN/motor.log" 2>&1 &
  echo $! > "$RUN/motor.pid"
)
esperar "http://127.0.0.1:$PUERTO_MOTOR/healthz" "motor" "ok" || { tail -15 "$RUN/motor.log"; exit 1; }

# ---------------------------------------------------------------- api
echo "[3/4] API (:$PUERTO_API)"
parar_pid api
# La API se COMPILA antes de arrancar. Node no puede ejecutar su fuente con
# stripping de tipos: NestJS usa decoradores y `emitDecoratorMetadata`, y
# `--experimental-strip-types` revienta con `SyntaxError` en el primer
# `@Module({`. Por eso el paquete declara `build` y `start` por separado.
if [[ ! -f "$RAIZ/apps/api/dist/main.js" ]] \
   || [[ -n "$(find "$RAIZ/apps/api/src" -newer "$RAIZ/apps/api/dist/main.js" -name '*.ts' -print -quit 2>/dev/null)" ]]; then
  echo "  compilando..."
  ( cd "$RAIZ/apps/api" && npm run build >"$RUN/api-build.log" 2>&1 ) \
    || { echo "  FALLO al compilar"; tail -20 "$RUN/api-build.log"; exit 1; }
fi
(
  cd "$RAIZ/apps/api"
  # NODE_ENV=development es obligatorio aqui, no cosmetico: sin el, la API
  # asume produccion y aborta en fallo cerrado porque la cookie de sesion lleva
  # prefijo __Host-, que el navegador solo acepta con Secure, y eso exige HTTPS
  # (ADR-0009 §6.2 y §6.4). En local no hay TLS. En produccion se arranca con
  # NODE_ENV=production, CEIBA_COOKIE_SECURE=true y CEIBA_PUBLIC_URL https.
  NODE_ENV=development \
  CEIBA_API_PORT="$PUERTO_API" CEIBA_API_HOST=127.0.0.1 \
  CEIBA_PERSISTENCE_DRIVER=prisma \
  CEIBA_PUBLIC_URL="$ORIGEN_WEB" \
  CEIBA_COOKIE_SECURE="$COOKIE_SECURE" \
  CEIBA_TRUSTED_PROXIES=127.0.0.1/32 \
  CEIBA_SESSION_ABSOLUTE_TTL=7d CEIBA_SESSION_IDLE_TTL=12h CEIBA_SESSION_ROTATE_AFTER=1h \
  CEIBA_ENGINE_URL="http://127.0.0.1:$PUERTO_MOTOR" \
  nohup node dist/main.js > "$RUN/api.log" 2>&1 &
  echo $! > "$RUN/api.pid"
)
esperar "http://127.0.0.1:$PUERTO_API/healthz" "api" "ok" 60 || { tail -25 "$RUN/api.log"; exit 1; }

# ---------------------------------------------------------------- web
echo "[4/4] Interfaz (:$PUERTO_WEB)"
parar_pid web
if [[ ! -d "$RAIZ/apps/web/dist" ]]; then
  ( cd "$RAIZ/apps/web" && npm run build >/dev/null 2>&1 ) && echo "  build hecho"
fi
# Certificado de desarrollo, si no existe.
if [[ ! -f "$RUN/tls/dev.crt" ]]; then
  mkdir -p "$RUN/tls"
  openssl req -x509 -newkey rsa:2048 -nodes -keyout "$RUN/tls/dev.key" \
    -out "$RUN/tls/dev.crt" -days 365 -subj "/CN=localhost/O=CEIBA desarrollo" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>/dev/null \
    && echo "  certificado de desarrollo generado"
fi
(
  cd "$RAIZ/apps/web"
  CEIBA_WEB_TLS="$USAR_TLS" \
  nohup node "$RAIZ/infra/servir-web.mjs" "$PUERTO_WEB" "$PUERTO_API" > "$RUN/web.log" 2>&1 &
  echo $! > "$RUN/web.pid"
)
# La huella es el titulo que emite nuestro index.html, no un 200 cualquiera.
# `-k` porque el certificado es autofirmado.
esperar "$ORIGEN_WEB/" "web" "CEIBA" || { tail -15 "$RUN/web.log"; exit 1; }

echo
echo "CEIBA en marcha:"
if [[ "$USAR_TLS" == "0" ]]; then
  echo "  interfaz : $ORIGEN_WEB/   (HTTP plano, para exponer por el portal)"
else
  echo "  interfaz : $ORIGEN_WEB/   (certificado autofirmado: el navegador avisara)"
fi
echo "  api      : http://127.0.0.1:$PUERTO_API/"
echo "  motor    : http://127.0.0.1:$PUERTO_MOTOR/"
echo "  registros: $RUN/{motor,api,web}.log"
echo
echo "  detener  : ./infra/levantar-local.sh --parar"
