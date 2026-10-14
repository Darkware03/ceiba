# syntax=docker/dockerfile:1.7
#
# CEIBA — imagen de producción del MOTOR DE EJECUCIÓN HTTP.
# Decisión C-25 del cliente + ADR-0002. Este es el proceso que ejecuta entrada
# hostil: cada dependencia que entra aquí es superficie de ataque.
#
# [NO VERIFICADO] Esta imagen NUNCA se ha construido. No hay Docker en el
# contenedor donde se escribió. Ver DESPLIEGUE.md §3.
#
# CONTEXTO DE BUILD: LA RAÍZ DEL REPOSITORIO.
#   docker build -f infra/docker/engine.Dockerfile -t ceiba/engine:dev .
#
# ---------------------------------------------------------------------------
# INSTALACIÓN AISLADA, NO DESDE EL WORKSPACE DE LA RAÍZ
# ---------------------------------------------------------------------------
# `apps/engine` trae SU PROPIO `pnpm-lock.yaml` y SU PROPIO
# `pnpm-workspace.yaml`, y se instala con `--ignore-workspace` (así lo dejó el
# `backend-engineer` para no pelearse por el lockfile de la raíz mientras
# varios agentes trabajan en el mismo árbol). Esta imagen respeta esa
# decisión, y de paso gana dos cosas:
#   · no depende del lockfile de la raíz, que hoy no existe; y
#   · el árbol de dependencias que entra en la imagen es EXACTAMENTE el del
#     motor —`fastify`, `undici`, `zod`— y nada más. El aislamiento del
#     ADR-0002 empieza en el `npm install`, no en el `docker run`.
#
# LA IMAGEN SE NIEGA A CONSTRUIRSE si aparece un cliente de base de datos.
# Ver la etapa `guard`.

ARG NODE_IMAGE=node:24-bookworm-slim

# ---------------------------------------------------------------------------
# base
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    CI=true
WORKDIR /app

# SIN `openssl` de Prisma: el motor no habla con ninguna base de datos.
# `ca-certificates` SÍ: el motor hace TLS saliente contra destinos del usuario
# y sin almacén de confianza validaría mal todos los certificados.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN node -e "const [M,m]=process.versions.node.split('.').map(Number); if (M<24 || (M===24 && m<15)) { console.error('Node '+process.versions.node+' < 24.15.0 exigido por engines.node'); process.exit(1) } console.log('node '+process.versions.node+' OK')"

# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
FROM base AS build

# La versión de pnpm se toma del `packageManager` del package.json de la RAÍZ,
# que es la fuente única del monorepo (ADR-0008). `apps/engine/package.json` no
# lo declara, así que se lee de la raíz en vez de cablearlo aquí y que se
# desincronice en silencio.
COPY package.json /tmp/root-package.json
RUN corepack enable \
 && PM="$(node -p "require('/tmp/root-package.json').packageManager || 'pnpm@12.11.2'")" \
 && echo "usando $PM" \
 && corepack prepare "$PM" --activate \
 && pnpm --version

# Sólo el motor. El `.dockerignore` de este Dockerfile ya excluye
# `**/node_modules` y `**/dist`, así que no entra nada construido en el host.
COPY apps/engine/ ./

RUN --mount=type=cache,id=pnpm-store-engine,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --ignore-workspace

RUN pnpm run build

# `tsconfig.build.json` fija `rootDir: src`, así que el punto de entrada
# emitido es `dist/index.js`. Si eso cambiara, es mejor romper el build aquí
# que descubrirlo con el contenedor reiniciándose en bucle en producción.
RUN test -f dist/index.js \
 || { echo "No existe dist/index.js: 'pnpm run build' no emitio el punto de entrada" >&2; \
      ls -la dist 2>/dev/null >&2 || true; exit 1; }

# Poda de devDependencies (typescript, @types/node). Después del build, nunca
# antes: el build los necesita.
RUN --mount=type=cache,id=pnpm-store-engine,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --ignore-workspace --prod --ignore-scripts

# ---------------------------------------------------------------------------
# guard — las reglas duras del ADR-0002, comprobadas en el build
# ---------------------------------------------------------------------------
FROM build AS guard
RUN set -eu; \
    fail=0; \
    for forbidden in @prisma/client prisma pg postgres mysql2 ioredis; do \
      if [ -e "/app/node_modules/${forbidden}" ]; then \
        echo "ADR-0002 ROTO: el motor incluye '${forbidden}'." >&2; \
        fail=1; \
      fi; \
    done; \
    if grep -rqI --exclude-dir=node_modules \
         -e 'process\.env\.DATABASE_URL' \
         -e 'process\.env\.CEIBA_SECRETS_MASTER_KEY' \
         -e 'process\.env\.CEIBA_JWT_SECRET' \
         /app/dist 2>/dev/null; then \
      echo "ADR-0002 ROTO: el motor LEE una variable que no le corresponde." >&2; \
      grep -rnI --exclude-dir=node_modules \
         -e 'process\.env\.DATABASE_URL' \
         -e 'process\.env\.CEIBA_SECRETS_MASTER_KEY' \
         -e 'process\.env\.CEIBA_JWT_SECRET' \
         /app/dist >&2 || true; \
      fail=1; \
    fi; \
    if [ "$fail" -ne 0 ]; then \
      echo "" >&2; \
      echo "El motor HTTP no puede tener acceso a la base de datos ni a la clave" >&2; \
      echo "maestra (decision C-25 del cliente, reglas 1 y 2 del ADR-0002)." >&2; \
      exit 1; \
    fi; \
    echo "guard OK: sin cliente de base de datos, sin clave maestra"

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM base AS runtime

# C-SSRF-10: `undici` construye un EnvHttpProxyAgent si encuentra HTTP_PROXY /
# HTTPS_PROXY en el entorno. Con un proxy delante, la política anti-SSRF se
# evaluaría contra el proxy en lugar de contra el destino real. Se neutralizan
# aquí además de en compose.yaml: defensa en dos capas, por si alguien arranca
# la imagen fuera de la pila.
#
# Valor VACÍO, no ausente: `assertNoProxyEnvironment()` del motor sólo aborta
# con variables de proxy no vacías, así que `""` es seguro y además pisa
# cualquier valor que inyecte el entorno del host.
ENV NODE_ENV=production \
    CEIBA_ENGINE_PORT=3001 \
    CEIBA_ENGINE_HOST=0.0.0.0 \
    HTTP_PROXY="" \
    HTTPS_PROXY="" \
    http_proxy="" \
    https_proxy="" \
    ALL_PROXY="" \
    all_proxy="" \
    NO_PROXY="*" \
    no_proxy="*"

# Se copia desde `guard`, no desde `build`: así el contenido de la imagen final
# sólo existe si las comprobaciones del ADR-0002 pasaron. Y sólo lo necesario
# para ejecutar: ni código fuente, ni pruebas, ni lockfile.
COPY --from=guard --chown=node:node /app/package.json  /app/package.json
COPY --from=guard --chown=node:node /app/node_modules  /app/node_modules
COPY --from=guard --chown=node:node /app/dist          /app/dist

USER 1000:1000
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=45s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.CEIBA_ENGINE_PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Sin shell: `node` es PID 1 y recibe SIGTERM directamente, que es lo que
# permite un apagado ordenado. Con `init: true` en compose se reapean zombis.
CMD ["node", "--enable-source-maps", "dist/index.js"]
