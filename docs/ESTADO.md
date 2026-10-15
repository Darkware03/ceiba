# Estado real de CEIBA API Studio

Inventario vivo. **Regla: nada figura como hecho sin una comprobación que lo
respalde, y lo preparado-pero-no-ejecutado se etiqueta como tal.**

Última actualización: 2026-10-15 · 21 commits · **CERRADO PARCIALMENTE**

> **Cerrado parcialmente a petición del cliente.** Se entrega una rebanada
> vertical **funcionando y usable** —autenticación, workspaces, colecciones y
> cliente HTTP sobre PostgreSQL real—, que es entre el **25 % y el 30 %** del
> catálogo funcional.
>
> **Lo que falta no es sólo Docker.** Por orden de importancia: (1) el envío de
> solicitudes no pasa por el motor, así que los 12 controles SSRF **no protegen
> el camino real del usuario**; (2) diez de las catorce áreas funcionales no
> existen; (3) Compose nunca se ha ejecutado.
>
> Acta completa en
> [`deliverables/ceiba-api-studio/CIERRE.md`](../../deliverables/ceiba-api-studio/CIERRE.md).

> El documento de entrega, con el veredicto completo y los pasos siguientes,
> está en [`deliverables/ceiba-api-studio/CIERRE.md`](../../deliverables/ceiba-api-studio/CIERRE.md).

## 0. Decisiones aprobadas por el cliente (vinculantes)

| # | Decisión | Resolución |
| --- | --- | --- |
| C-01 | Entorno de verificación | Docker persistente; CI como mínimo aceptable |
| C-02 | Orden de construcción | Motor HTTP y SSRF → organización → import/export → colaboración → compartición |
| C-25 | Aislamiento del motor | Contenedor propio, sin credenciales de BD, sin clave maestra. **Fusión prohibida** |
| C-31 | Sesiones | Cookie `HttpOnly`/`Secure`/`SameSite=Lax`, CSRF siempre activo, revocables. **Sin tokens en `localStorage`** |
| C-23 | Variables | **Enmendada:** se conserva el modelo híbrido. Prohibida la reestructuración destructiva |

> **C-01: resuelto a medias, y por otra vía.** Docker segúe sin existir —
> comprobado a fondo: el host del gateway es este mismo contenedor, no hay nodos
> emparejados, ni socket, ni demonio por TCP, ni runner, ni remoto git.
> **Pero la verificación de la base de datos ya no depende de Docker**: se
> levanta un PostgreSQL 16.15 real en espacio de usuario con los binarios
> relocalizables de Zonky (`prisma/tools/provision-postgres.mjs`). Lo que sigue
> sin ejecutarse es la **infraestructura de contenedores**: Compose, Nginx y CI.

## 1. Leyenda

| Estado | Significado |
| --- | --- |
| **Verificado** | existe, se ejecutó y la salida lo respalda |
| **Escrito** | existe en el repositorio, nadie lo ha ejecutado |
| **No iniciado** | no existe |

## 2. Componentes

| Componente | Estado | Comprobación del 2026-10-15 |
| --- | --- | --- |
| `apps/engine` — motor HTTP + SSRF | **Verificado** | `tests 83 · pass 83 · fail 0` |
| `apps/api` — identidad, sesión, CSRF, autorización | **Verificado** | `tests 13 · pass 13 · fail 0`; `tsc --noEmit` limpio |
| `packages/brand` — marca y pantallas de carga | **Verificado** | giro sin recorte en 360°; trazado IoU 0,9337 |
| `apps/web` — interfaz Vue 3 | **Verificado** | `7 ficheros, 78 pruebas`, typecheck limpio, build correcto, sin credenciales en `localStorage` |
| `prisma/` — esquema y 6 migraciones | **Verificado** | **6/6 aplicadas** contra PostgreSQL 16.15 real; **12/12 pruebas de integridad** |
| `docs/schema/ceiba.dbml` — 41 tablas, 38 enums, 148 refs | **Verificado** | en el motor: 41 tablas, 188 índices, 148 FK, 52 CHECK, 38 enums, 6 triggers |
| `docs/adr/` — 10 ADR | **Escrito** | — |
| `infra/` — Compose, Nginx, 5 Dockerfiles | **Escrito** | sólo análisis estático; **nunca levantado** |
| `.github/workflows` — CI | **Escrito** | **nunca ejecutado**, no hay runner |
| Envío de solicitudes **a través del motor** desde la interfaz | **No iniciado** | hoy la web envía directa desde el navegador y lo avisa en pantalla; así **no se aplica la política SSRF** |

## 3. Lo que falta

1. **Cablear el envío a través del motor** desde la interfaz. Es lo más
   importante que queda: mientras la web envíe directa desde el navegador, los
   12 controles SSRF del motor **no protegen nada en el camino real del
   usuario**.
2. **Levantar la pila en contenedores**, en una máquina con Docker o un runner.
   Es lo único que convierte `infra/` de escrito en funcionando.
3. Cerrar los huecos abiertos: puerto de autorización de plataforma (hoy
   `platform_admins` es una tabla que nadie consulta), transporte de ficheros
   API↔motor, límite de concurrencia por usuario.
4. El resto del catálogo funcional: importación/exportación, compartición,
   colaboración en tiempo real, scripts y ejecución de colecciones.

> La licencia de PrimeVue dejó de ser una decisión pendiente: **la interfaz no
> usa PrimeVue**. Componentes propios sobre los tokens de `@ceiba/brand` y
> CodeMirror 6 para los editores.

## 4. Desviación de la convención de rutas

`AGENTS.md` sitúa los repositorios en `/software-factory/projects/<proyecto>`. Ese
directorio pertenece a otro uid (1004) y no admite escritura desde esta cuenta
(uid 1000); la elevación está bloqueada por política. El repositorio está en
`/software-factory/ceiba-api-studio`. Para devolverlo a su sitio, con permisos:

```sh
install -d -o 1000 -g 1000 -m 2775 /software-factory/projects/ceiba-api-studio
mv /software-factory/ceiba-api-studio/* /software-factory/ceiba-api-studio/.??* \
   /software-factory/projects/ceiba-api-studio/
rmdir /software-factory/ceiba-api-studio
```

Los documentos sí están donde corresponde: `deliverables/ceiba-api-studio/` y
`security/ceiba-api-studio/`.
