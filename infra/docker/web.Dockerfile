# syntax=docker/dockerfile:1.7
#
# CEIBA — imagen de producción del frontend (Vue 3 + Vite), servido estático.
#
# [NO VERIFICADO] Nunca construida. No hay Docker aquí. Ver DESPLIEGUE.md §3.
#
# CONTEXTO DE BUILD: LA RAÍZ DEL REPOSITORIO.
#   docker build -f infra/docker/web.Dockerfile -t ceiba/web:dev .
#
# La SPA se construye contra rutas RELATIVAS (`/api`, `/socket.io`). Así el
# mismo artefacto vale para localhost, preproducción y producción, y no hay que
# reconstruir la imagen al cambiar de dominio. Lo que cambia es Nginx, no el
# JavaScript.

ARG NODE_IMAGE=node:24-bookworm-slim
ARG NGINX_IMAGE=nginx:1.29-alpine

# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    CI=true
WORKDIR /app

RUN node -e "const [M,m]=process.versions.node.split('.').map(Number); if (M<24 || (M===24 && m<15)) { console.error('Node '+process.versions.node+' < 24.15.0 exigido por engines.node'); process.exit(1) } console.log('node '+process.versions.node+' OK')"

COPY package.json ./
RUN corepack enable && corepack prepare --activate && pnpm --version

COPY . .

# Al 2026-10-14 el árbol AÚN NO TIENE `apps/web` ni `pnpm-lock.yaml` en la
# raíz: este build FALLA HOY, a propósito y con un mensaje legible.
RUN set -eu; \
    missing=0; \
    [ -f pnpm-lock.yaml ]        || { echo "FALTA pnpm-lock.yaml en la raiz del repositorio." >&2; missing=1; }; \
    [ -f apps/web/package.json ] || { echo "FALTA apps/web/package.json: el frontend todavia no existe." >&2; missing=1; }; \
    [ "$missing" -eq 0 ] || { \
      echo "" >&2; \
      echo "Esta imagen no se puede construir todavia. Ver DESPLIEGUE.md 3.4 y el riesgo R3." >&2; \
      exit 1; }

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile

# `packages/brand` se construye antes que `apps/web` por el `...` del filtro:
# la marca genera favicon, icono y datos de trazado que la SPA importa.
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
RUN pnpm --filter "@ceiba/web..." run build

# Falla pronto y con un mensaje legible si el build no dejó artefactos.
RUN test -f /app/apps/web/dist/index.html \
 || { echo "No existe apps/web/dist/index.html: el build de la SPA no produjo nada" >&2; exit 1; }

# ---------------------------------------------------------------------------
# runtime — Nginx sirviendo ficheros estáticos en 8080
# ---------------------------------------------------------------------------
FROM ${NGINX_IMAGE} AS runtime

# Puerto 8080, no 80: no hace falta CAP_NET_BIND_SERVICE para servir la SPA.
COPY infra/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

RUN nginx -t

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["wget", "--quiet", "--tries=1", "--spider", "http://127.0.0.1:8080/healthz"]

CMD ["nginx", "-g", "daemon off;"]
