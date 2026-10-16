# syntax=docker/dockerfile:1.7
#
# CEIBA — imagen del proxy inverso (Nginx): terminación TLS, cabeceras de
# proxy para C-31 y WebSocket para el tiempo real del ADR-0005.
#
# [NO VERIFICADO] Nunca construida. No hay Docker ni Nginx aquí: `nginx -t`
# NO se ha ejecutado en este contenedor. Ver DESPLIEGUE.md §3 y §6.
#
# CONTEXTO DE BUILD: LA RAÍZ DEL REPOSITORIO.
#   docker build -f infra/docker/proxy.Dockerfile -t ceiba/proxy:dev .
#
# La configuración se HORNEA en la imagen (reproducible, versionada, auditable).
# Los CERTIFICADOS NO: se montan en /etc/nginx/tls desde fuera. §21: «No
# guardes secretos reales en el repositorio».

ARG NGINX_IMAGE=nginx:1.29-alpine

FROM ${NGINX_IMAGE} AS runtime

# La imagen oficial trae `/etc/nginx/conf.d/default.conf` (un `listen 80` con
# la página de bienvenida). `COPY dir/ dir/` FUSIONA, no reemplaza: si no se
# borra, sobrevive y `nginx.conf` lo carga por su `include conf.d/*.conf`.
# Resultado: un servidor fantasma en el 80, sin las cabeceras de seguridad.
# Se borra ANTES de copiar, para que la imagen contenga EXACTAMENTE lo que
# valida el `nginx -t` de más abajo y el paso equivalente de CI.
RUN rm -f /etc/nginx/conf.d/*.conf

COPY infra/nginx/nginx.conf        /etc/nginx/nginx.conf
COPY infra/nginx/snippets/         /etc/nginx/snippets/
COPY infra/nginx/conf.d/           /etc/nginx/conf.d/

# Directorio del reto HTTP-01 de ACME y del material TLS. Si no hay
# certificados montados, Nginx no arranca: es deliberado, preferible a servir
# en claro sin que nadie se entere.
RUN mkdir -p /etc/nginx/tls /var/www/acme \
 && chown -R nginx:nginx /var/www/acme

# `nginx -t` en tiempo de BUILD valida la sintaxis de la configuración contra
# el binario real. Falla si hay un certificado ausente, así que se genera uno
# efímero sólo para la comprobación y se borra en la misma capa: nunca viaja
# dentro de la imagen.
RUN apk add --no-cache openssl \
  && openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
      -subj "/CN=build-check.invalid" \
      -keyout /etc/nginx/tls/ceiba.key -out /etc/nginx/tls/ceiba.crt >/dev/null 2>&1 \
  && cp /etc/nginx/nginx.conf /tmp/nginx.conf.original \
  && sed -i 's/server api:3000/server 127.0.0.1:3000/; s/server web:8080/server 127.0.0.1:8080/' /etc/nginx/nginx.conf \
  && nginx -t \
  && mv /tmp/nginx.conf.original /etc/nginx/nginx.conf \
  && rm -f /etc/nginx/tls/ceiba.key /etc/nginx/tls/ceiba.crt \
  && apk del openssl

EXPOSE 8080 8443

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD ["wget", "--quiet", "--tries=1", "--spider", "http://127.0.0.1:8080/healthz"]

CMD ["nginx", "-g", "daemon off;"]
