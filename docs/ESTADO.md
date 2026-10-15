# Estado real de CEIBA API Studio

Inventario vivo. **Regla: nada figura como hecho sin una comprobación que lo
respalde, y lo preparado-pero-no-ejecutado se etiqueta como tal.**

Última actualización: 2026-10-15 · 14 commits · **proyecto entregado**

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

> **C-01 nunca llegó a desbloquearse.** Comprobado de nuevo el 2026-10-15: no hay
> `docker`, ni socket, ni Compose, ni runner de CI, ni remoto git, ni PostgreSQL,
> ni Redis, ni root. Toda la infraestructura se entrega escrita y **sin ejecutar**.

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
| `prisma/` — esquema y 6 migraciones | **Escrito** | aditividad y fidelidad sin discrepancias; **ninguna migración aplicada** |
| `docs/schema/ceiba.dbml` — 41 tablas, 38 enums, 148 refs | **Escrito** | validado sólo sintácticamente |
| `docs/adr/` — 10 ADR | **Escrito** | — |
| `infra/` — Compose, Nginx, 5 Dockerfiles | **Escrito** | sólo análisis estático; **nunca levantado** |
| `.github/workflows` — CI | **Escrito** | **nunca ejecutado**, no hay runner |
| `apps/web` — interfaz de usuario | **No iniciado** | sin ella no hay producto utilizable |

## 3. Lo que falta para que exista producto

1. Levantar la pila una vez, en una máquina con Docker o en un runner de CI.
2. Aplicar las 6 migraciones contra PostgreSQL 16 y correr las 18 pruebas de
   integridad ya escritas.
3. Construir `apps/web`.
4. Cerrar los huecos abiertos: puerto de autorización de plataforma, transporte
   de ficheros API↔motor, límite de concurrencia por usuario.
5. Decidir la licencia de PrimeVue (la 4 es MIT; la 5 es propietaria).

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
