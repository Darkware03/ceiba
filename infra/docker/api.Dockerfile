# syntax=docker/dockerfile:1.7
#
# CEIBA — imagen de producción de la API (NestJS sobre adaptador Fastify, ADR-0001).
#
# [NO VERIFICADO] Esta imagen NUNCA se ha construido. No hay Docker en el
# contenedor donde se escribió. Validado sólo el parseo del Dockerfile; ver
# DESPLIEGUE.md §3 para el comando exacto de construcción real.
#
# CONTEXTO DE BUILD: LA RAÍZ DEL REPOSITORIO.
#   docker build -f infra/docker/api.Dockerfile -t ceiba/api:dev .
# El Dockerfile vive en `infra/` y no en `apps/api/` a propósito: `apps/` es de
# otros autores y no quiero colisiones de fichero (BRIEF-FASE1 §3.D).
#
# Exclusiones de contexto: `infra/docker/api.Dockerfile.dockerignore`
# (BuildKit busca `<dockerfile>.dockerignore` antes que el `.dockerignore` de
# la raíz; por eso no hace falta tocar la raíz del repositorio).

ARG NODE_IMAGE=node:24-bookworm-slim

# ---------------------------------------------------------------------------
# base — runtime mínimo común
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    CI=true
WORKDIR /app

# `openssl` lo necesita el motor de consultas de Prisma en imágenes slim.
# `ca-certificates` para TLS saliente (SMTP, Vertex AI).
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# El proyecto declara `engines.node >=24.15.0` en el package.json de la raíz.
# Esto lo comprueba la imagen, no un humano leyendo el tag.
RUN node -e "const [M,m]=process.versions.node.split('.').map(Number); if (M<24 || (M===24 && m<15)) { console.error('Node '+process.versions.node+' < 24.15.0 exigido por engines.node'); process.exit(1) } console.log('node '+process.versions.node+' OK')"

# ---------------------------------------------------------------------------
# build — instala el workspace completo, compila y empaqueta sólo la API
# ---------------------------------------------------------------------------
FROM base AS build

# corepack toma la versión de pnpm del campo `packageManager` de la raíz, para
# que la imagen no se desincronice del repositorio cuando esa versión cambie.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/engine/package.json ./apps/engine/
COPY apps/web/package.json ./apps/web/
COPY packages/brand/package.json ./packages/brand/
COPY prisma/package.json ./prisma/
COPY prisma/prisma.config.ts ./prisma/
COPY prisma/schema ./prisma/schema
RUN corepack enable && corepack prepare --activate && pnpm --version

# `--frozen-lockfile` es deliberado: una imagen de producción no resuelve
# versiones. Si el lockfile no está al día, el build debe fallar.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile

# Cliente de Prisma. Antes del podado de devDependencies: el CLI `prisma` es
# una devDependency (ADR-0003).
#
# `--config` y no `--schema`: Prisma 7 sacó la URL de conexión del `.prisma`
# (P1012) y CEIBA la declara en `prisma/prisma.config.ts`, que además apunta
# al esquema. Comprobado con prisma 7.10.0 el 2026-10-14 (ver
# migrator.Dockerfile).
RUN DATABASE_URL="postgresql://validacion:validacion@127.0.0.1:5432/validacion" \
    pnpm --filter ./prisma exec prisma generate --config ./prisma.config.ts

COPY . .

RUN rm -rf apps/api/dist && pnpm --filter "@ceiba/api..." run build

# `pnpm deploy` produce un árbol autocontenido, sin enlaces simbólicos hacia el
# almacén y sin devDependencies. El `||` cubre el cambio de semántica del flag
# entre pnpm 9 y 10+; si ninguna forma funciona, el build falla y se ve.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm --filter "@ceiba/api" deploy --prod /deploy \
 || pnpm --filter "@ceiba/api" deploy --prod --legacy /deploy
RUN cd /deploy/node_modules/@prisma \
 && ln -sf ../.pnpm/@prisma+client-runtime-utils@*/node_modules/@prisma/client-runtime-utils client-runtime-utils \
 && test -e /deploy/node_modules/@prisma/client-runtime-utils/package.json

RUN test -f /deploy/dist/apps/api/src/main.js \
 || { echo "No existe /deploy/dist/apps/api/src/main.js." >&2; \
      ls -la /deploy /deploy/dist >&2 2>/dev/null || true; exit 1; }

# ---------------------------------------------------------------------------
# runtime — sin pnpm, sin código fuente, sin devDependencies, sin root
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production \
    CEIBA_API_PORT=3000 \
    CEIBA_UPLOAD_DIR=/var/lib/ceiba/uploads

# La imagen `node` ya trae el usuario `node` (uid 1000). No se crea otro.
RUN mkdir -p "${CEIBA_UPLOAD_DIR}" && chown -R node:node "${CEIBA_UPLOAD_DIR}" /app

COPY --from=build --chown=node:node /deploy /app

# El generador de Prisma emite a `prisma/generated/client` (ver
# `prisma/schema/schema.prisma`: `output = "../generated/client"`), que está
# FUERA de `apps/api/`. `pnpm deploy` copia el grafo del paquete, no ese
# directorio, así que el cliente generado hay que traerlo aparte o la API
# arranca sin él.
COPY --from=build --chown=node:node /app/prisma/generated /app/prisma/generated

USER 1000:1000
EXPOSE 3000

# El healthcheck real lo define compose.yaml; este es el de un `docker run` suelto.
HEALTHCHECK --interval=15s --timeout=5s --start-period=90s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.CEIBA_API_PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# Sin shell: `node` es PID 1 y recibe SIGTERM directamente, que es lo que
# permite un apagado ordenado. Con `init: true` en compose se reapean zombis.
CMD ["node", "--enable-source-maps", "dist/apps/api/src/main.js"]
