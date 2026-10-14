# syntax=docker/dockerfile:1.7
#
# CEIBA — imagen de migraciones. «Migraciones automáticas controladas» (§21).
#
# [NO VERIFICADO] Nunca construida ni ejecutada. No hay Docker ni PostgreSQL
# aquí. Ninguna migración se ha aplicado contra ninguna base de datos.
#
# CONTEXTO DE BUILD: LA RAÍZ DEL REPOSITORIO.
#   docker build -f infra/docker/migrator.Dockerfile -t ceiba/migrator:dev .
#
# QUÉ HACE Y QUÉ NO HACE
#   SÍ:  `prisma migrate status` y `prisma migrate deploy`. Idempotente, sólo
#        aplica migraciones ya versionadas y revisadas en el repositorio.
#   NO:  `migrate dev`, `migrate reset`, `db push`, `db execute`. El ADR-0003
#        los prohíbe en cualquier entorno con datos y el entrypoint no los
#        expone. El §21 y el mandato del cliente exigen autorización explícita
#        para operaciones destructivas: esta imagen no puede concederla sola.
#
# ---------------------------------------------------------------------------
# POR QUÉ PRISMA SE INSTALA EN LOCAL Y NO EN GLOBAL
# ---------------------------------------------------------------------------
# Prisma 7 sacó la URL de conexión del `.prisma` (error P1012). En CEIBA vive
# en `prisma/prisma.config.ts`, que empieza con:
#
#     import { defineConfig, env } from 'prisma/config'
#
# Esa importación se resuelve **subiendo** por `node_modules` desde el fichero
# de configuración. Con un `npm install --global` no hay `node_modules` en la
# ruta de `/app/prisma/…` y la resolución no está garantizada. Con la
# instalación local en `/app/node_modules` sí la hay.
#
# [VERIFICADO el 2026-10-14] con prisma 7.10.0 instalado en /tmp con esta misma
# forma (local + config en un subdirectorio), sobre el `prisma/` real del
# repositorio:
#     $ prisma validate --config ./prisma/prisma.config.ts
#     Loaded Prisma config from prisma/prisma.config.ts.
#     Prisma schema loaded from prisma/schema.
#     The schemas at prisma/schema are valid 🚀
# Y sin `--config`, el CLI valida el esquema pero NO carga la configuración, es
# decir se queda sin `DATABASE_URL`. De ahí que el entrypoint use `--config`.
# Lo que sigue sin estar demostrado es `migrate deploy` contra PostgreSQL: no
# hay base de datos aquí.
#
# Imagen deliberadamente separada de la de la API: la API en producción no
# lleva el CLI de Prisma ni las credenciales de migración en su superficie.

ARG NODE_IMAGE=node:24-bookworm-slim
# ADR-0003: 7.10.0 EXACTO. `prisma@latest` es una release candidate (8.0.0-rc)
# y no entra en el núcleo del producto.
ARG PRISMA_VERSION=7.10.0

# ---------------------------------------------------------------------------
# src — recorta el contexto a lo único que necesita una migración
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS src
WORKDIR /src
COPY . .
RUN set -eu; \
    if [ ! -d prisma/schema ]; then \
      echo "No existe prisma/schema/. La imagen de migraciones necesita el esquema" >&2; \
      echo "versionado del 'database-engineer' (ambito 3.B de BRIEF-FASE1)." >&2; \
      exit 1; \
    fi; \
    if [ ! -f prisma/prisma.config.ts ]; then \
      echo "No existe prisma/prisma.config.ts. Prisma 7 saca la URL de conexion del" >&2; \
      echo "esquema (P1012) y sin ese fichero 'migrate deploy' no sabe a donde conectarse." >&2; \
      exit 1; \
    fi; \
    if [ ! -d prisma/migrations ]; then \
      echo "No existe prisma/migrations/. No hay nada que desplegar." >&2; \
      exit 1; \
    fi; \
    mkdir -p /out; \
    cp -R prisma /out/prisma; \
    ls -la /out/prisma

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ARG PRISMA_VERSION
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    PRISMA_HIDE_UPDATE_MESSAGE=true \
    CI=true \
    PATH=/app/node_modules/.bin:$PATH
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN node -e "const [M,m]=process.versions.node.split('.').map(Number); if (M<24 || (M===24 && m<15)) { console.error('Node '+process.versions.node+' < 24.15.0 exigido por engines.node'); process.exit(1) } console.log('node '+process.versions.node+' OK')"

# Instalación LOCAL (ver la nota de cabecera), con la versión fijada exacta.
RUN printf '{"name":"ceiba-migrator","private":true,"type":"module","dependencies":{"prisma":"%s"}}\n' "${PRISMA_VERSION}" > package.json \
 && npm install --no-fund --no-audit \
 && prisma --version

COPY --from=src --chown=node:node /out/prisma /app/prisma
COPY --chown=node:node infra/docker/migrator-entrypoint.sh /usr/local/bin/ceiba-migrate
RUN chmod 0555 /usr/local/bin/ceiba-migrate

USER 1000:1000

ENTRYPOINT ["/usr/local/bin/ceiba-migrate"]
