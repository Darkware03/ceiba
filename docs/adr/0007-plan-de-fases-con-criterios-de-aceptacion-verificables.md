# ADR-0007 — Plan de fases con criterios de aceptación verificables

- **Estado:** Aceptada
- **Fecha:** 2026-10-14
- **Decide:** `software-architect`
- **Ámbito:** 4.A.7 del `BRIEF.md`; §22 y §20 del `PROMPT-MAESTRO.md`
- **Depende de:** ADR-0001 … ADR-0006, ADR-0008

## Contexto

El §22 del prompt maestro define ocho fases (0–7) y exige «mantén el proyecto
ejecutable durante todo el desarrollo». El §20 lista 22 pruebas obligatorias y
cierra con una frase que es el criterio de aceptación de todo el proyecto:

> No marques una función como terminada solamente porque existe una pantalla o
> un endpoint de backend. **Debe existir una prueba que demuestre su
> comportamiento.**

Este plan conserva las ocho fases del §22 y les añade lo que les falta para ser
utilizables: **una puerta de salida comprobable con un comando concreto**.

### Regla que atraviesa todo el plan

Cada criterio lleva una de estas tres marcas:

- 🟢 **Ejecutable aquí** — no necesita PostgreSQL, Redis ni Docker. Se ejecuta
  en este contenedor y se pega la salida literal.
- 🟡 **Necesita base de datos** — requiere PostgreSQL y/o Redis.
  **[NO VERIFICADO] hasta que exista infraestructura.**
- 🔴 **Necesita despliegue** — requiere Docker/Compose/Nginx.
  **[NO VERIFICADO] por definición en este contenedor.**

Una fase **no se declara cerrada** si sus criterios 🟢 no se han ejecutado de
verdad. Los 🟡 y 🔴 se declaran **preparados y no verificados**, con esas
palabras. Esto es la aplicación literal del `BRIEF.md` §3.1.

### Reordenación deliberada respecto del §22

El §22 pone el motor HTTP en la Fase 2, después de configurar PostgreSQL y
Docker en la Fase 1. **Lo adelanto parcialmente**, y explico por qué:

> El motor y los paquetes puros (`variables`, `importers`, `exporters`) son
> **lo único que hoy se puede llevar hasta [VERIFICADO]**. Dejarlos detrás de
> una Fase 1 que depende de infraestructura inexistente significa que el
> proyecto no produce **ni un solo entregable demostrable** hasta que alguien
> instale PostgreSQL.

No altero el orden de las fases; añado una **Fase 1b paralela** que no depende
de la base de datos. Es una desviación consciente del §22 y la declaro aquí.

---

## Fase 0 — Auditoría y decisiones · **COMPLETADA** 🟢

| | |
| --- | --- |
| **Objetivo** | Inspeccionar, medir el entorno, fijar decisiones. |
| **Entregables** | `ARQUITECTURA.md`, ADR-0001…0008, `MODELO-DATOS.md` (4.B), modelo de amenazas (4.C), `ALCANCE.md` (4.D). |

**Criterios de aceptación**

| # | Criterio | Marca | Estado |
| --- | --- | --- | --- |
| 0.1 | Repositorio inspeccionado: commit, rama, árbol, `package.json`, `pnpm-workspace.yaml`, `.env.example`, `packages/brand` | 🟢 | **CUMPLIDO** — commit `a0e7021`, rama `master` |
| 0.2 | Entorno medido con comandos, no leído | 🟢 | **CUMPLIDO** — ver `ARQUITECTURA.md` §0 |
| 0.3 | Versiones consultadas al registro, no supuestas | 🟢 | **CUMPLIDO** — ADR-0008 |
| 0.4 | Framework elegido y cerrado | 🟢 | **CUMPLIDO** — ADR-0001 |
| 0.5 | ORM elegido con la trampa de la RC documentada | 🟢 | **CUMPLIDO** — ADR-0003 |
| 0.6 | Precedencia de variables con ejemplos resueltos | 🟢 | **CUMPLIDO** — ADR-0006 |
| 0.7 | Riesgos y huecos declarados | 🟢 | **CUMPLIDO** — `ARQUITECTURA.md` §10 y §11 |

**Puerta:** ningún módulo empieza sin su contrato en `packages/contracts`
(ADR-0004).

---

## Fase 1 — Fundación 🟡

| | |
| --- | --- |
| **Objetivo** | Esqueleto del monorepo, TypeScript, esquema, migraciones, autenticación, CI. |
| **Entregables** | `apps/api` arrancando, `prisma/schema/*.prisma`, migración inicial, `packages/contracts` v1, CI. |

**Criterios de aceptación**

| # | Criterio | Comando / prueba | Marca |
| --- | --- | --- | --- |
| 1.1 | Instalación reproducible | `pnpm install --frozen-lockfile --prod=false` sin `ERESOLVE` | 🟢 |
| 1.2 | Una sola versión de TypeScript, `~6.0.3` | `pnpm ls typescript -r` muestra una única versión | 🟢 |
| 1.3 | Guardia anti-RC de Prisma | `node scripts/check-prisma-pin.mjs` sale 0; **falla si alguien pone `^` o una RC** | 🟢 |
| 1.4 | Esquema válido con 25+ entidades | `prisma validate` → «The schemas at prisma/schema are valid» | 🟢 |
| 1.5 | Migración inicial generada y **revisada** | `prisma migrate diff --from-empty --to-schema ./prisma/schema --script` produce DDL; el `migration.sql` está en el repositorio y revisado | 🟢 |
| 1.6 | Límites de módulo exigidos | `pnpm lint` falla ante un import profundo deliberado | 🟢 |
| 1.7 | Sin ciclos entre módulos | `madge --circular` sale 0 | 🟢 |
| 1.8 | Toda ruta tiene guard | prueba que recorre el `RouterExplorer` y falla si falta | 🟢 |
| 1.9 | Type-check y build limpios | `pnpm typecheck && pnpm build` | 🟢 |
| 1.10 | Migración **aplicada** a PostgreSQL 17 vacío | `prisma migrate deploy` + `\dt` | 🟡 |
| 1.11 | Alta de usuario y login (§20.1) | prueba de integración: `POST /auth/register` → `POST /auth/login` → token válido | 🟡 |
| 1.12 | Conocer un ID no basta (§19) | usuario B pide el recurso de A → **404**, no 403 | 🟡 |
| 1.13 | OpenAPI generado | `GET /api/v1/openapi.json` válido y comparado con snapshot | 🟡 |
| 1.14 | CI en verde en un clon limpio | pipeline completo | 🟢 |

**Puerta de salida:** 1.1–1.9 y 1.14 ejecutados con salida literal. 1.10–1.13
**preparados y no verificados** mientras no haya PostgreSQL.

> 1.12 exige **404 y no 403**: un 403 confirma que el recurso existe, y eso es
> una fuga de información por enumeración de IDs.

---

## Fase 1b — Núcleo puro · **en paralelo con la Fase 1** 🟢

**Esta fase es íntegramente verificable hoy. Es la que impide que el proyecto
se quede sin entregables demostrables.** No depende de la Fase 1.

| | |
| --- | --- |
| **Entregables** | `packages/contracts`, `packages/variables`, `apps/engine`. |

| # | Criterio | Comando / prueba | Marca |
| --- | --- | --- | --- |
| 1b.1 | Contratos compilan y son fuente única | `pnpm --filter @ceiba/contracts typecheck` | 🟢 |
| 1b.2 | **Los 7 ejemplos del ADR-0006** pasan uno a uno | `pnpm --filter @ceiba/variables test` | 🟢 |
| 1b.3 | Deshabilitada ≠ vacía; `localValue` no cruza ámbitos | casos dedicados | 🟢 |
| 1b.4 | Ciclos y profundidad máxima detectados | `CIRCULAR_REFERENCE`, `MAX_DEPTH_EXCEEDED` | 🟢 |
| 1b.5 | Resolución determinista | 1000 iteraciones, salida idéntica | 🟢 |
| 1b.6 | Motor responde a `/healthz` | arrancar `apps/engine` y hacer `curl` | 🟢 |
| 1b.7 | Motor ejecuta una petición real | servidor `node:http` en `127.0.0.1`; `POST /v1/execute`; comprobar `status`, `headers`, `timings` | 🟢 |
| 1b.8 | Timeout, tamaño máximo y redirecciones | servidor que cuelga / devuelve 30 MB / encadena 10 redirecciones → `TIMEOUT`, `RESPONSE_TOO_LARGE`, `TOO_MANY_REDIRECTS` | 🟢 |
| 1b.9 | **El motor no puede hablar con la base de datos** | prueba que falla si `@prisma/client`, `pg` o `DATABASE_URL` aparecen en `apps/engine` | 🟢 |
| 1b.10 | El motor no registra secretos | ejecutar con cabecera `secret: true` y comprobar que el valor no está en el log | 🟢 |

**Puerta:** los diez criterios ejecutados, con salida literal. **Sin excusas de
infraestructura: ninguno la necesita.**

---

## Fase 2 — Cliente API 🟡

| | |
| --- | --- |
| **Objetivo** | Prioridad 1 del cliente: cliente HTTP realmente funcional. |
| **Entregables** | Constructor de solicitudes, visualización de respuestas, historial, variables y entornos en la interfaz. |

| # | Criterio | Comando / prueba | Marca |
| --- | --- | --- | --- |
| 2.1 | Solicitud con query, cabeceras y JSON (§20.8) | prueba contra servidor local controlado | 🟢 |
| 2.2 | Respuestas de éxito y errores HTTP (§20.9) | 200/201/400/401/404/500 mostrados correctamente | 🟢 |
| 2.3 | Los 7 tipos de cuerpo (§7) | `none`, `raw`, `json`, `form`, `urlencoded`, `binary`, `graphql` | 🟢 |
| 2.4 | **El motor no recibe `{{` nunca** | prueba de contrato sobre el cuerpo enviado al motor | 🟢 |
| 2.5 | Advertencia de variables sin resolver **antes** de ejecutar (§12) | prueba de interfaz con `{{order_id}}` indefinida | 🟢 |
| 2.6 | Ejecutar y crear endpoint (§20.7) | extremo a extremo | 🟡 |
| 2.7 | Historial persiste y **no guarda cuerpos indefinidamente** (§17) | política de retención aplicada y comprobada | 🟡 |
| 2.8 | Toda pantalla de carga lleva el logo girando (`BRIEF.md` §1) | prueba de interfaz: no hay otro spinner; se usa `CeibaLoadingScreen`/`CeibaSpinner` | 🟢 |

**Puerta:** 2.1–2.5 y 2.8 ejecutados. **Es el entregable que más le importa al
cliente**; no se avanza a la Fase 3 sin esto en verde.

---

## Fase 3 — Organización y colaboración 🟡

| # | Criterio | Comando / prueba | Marca |
| --- | --- | --- | --- |
| 3.1 | Crear workspace (§20.2) | integración | 🟡 |
| 3.2 | Invitar usuario (§20.3) | integración | 🟡 |
| 3.3 | Roles y permisos (§20.4) | matriz rol × operación, **en el servidor** | 🟡 |
| 3.4 | **Un lector no puede modificar (§20.17)** | cada endpoint de escritura con rol lector → 403 | 🟡 |
| 3.5 | Colección, carpetas y subcarpetas (§20.5, §20.6) | incluye mover, duplicar, archivar | 🟡 |
| 3.6 | **Sin sobrescrituras silenciosas (§20.20)** | dos `PATCH` con la misma `expectedVersion` → uno 200, otro 409 | 🟡 |
| 3.7 | Lógica de permisos con dobles | pruebas unitarias sin base de datos | 🟢 |
| 3.8 | Tiempo real en instancia única, **sin Redis** | cliente Socket.IO; `collection.updated` llega | 🟡 |
| 3.9 | Revocar permiso expulsa de la sala | dejan de llegar eventos sin reconectar | 🟡 |
| 3.10 | Difusión entre dos instancias vía Redis | emitido en A, recibido en B | 🔴 |
| 3.11 | Versiones de colección (§15) | crear, listar y restaurar | 🟡 |

**Puerta:** 3.7 ejecutado; el resto preparado. 3.4 y 3.6 son **bloqueantes para
producción**: sin ellos no hay colaboración segura.

---

## Fase 4 — Importación y exportación 🟢

**Casi íntegramente verificable hoy:** los parsers son puros (ADR-0004).

| # | Criterio | Comando / prueba | Marca |
| --- | --- | --- | --- |
| 4.1 | Importar Postman v2.1 (§20.10) | fixture real → N solicitudes, carpetas y variables esperadas | 🟢 |
| 4.2 | Importar Postman v2.0 | fixture real | 🟢 |
| 4.3 | Importar OpenAPI 3.x y Swagger 2.0 (§20.11) | fixture real; `paths` → endpoints, `servers` → `{{base_url}}` | 🟢 |
| 4.4 | Importar cURL (§20.12) | método, URL, cabeceras, cuerpo, autenticación | 🟢 |
| 4.5 | **Ida y vuelta de cURL (§20.13)** | solicitud → cURL → *parsear* → solicitud equivalente | 🟢 |
| 4.6 | **Los secretos no se filtran al exportar (§20.18)** | exportar una colección con variables secretas y comprobar que el valor en claro **no aparece**; igual para el cURL generado | 🟢 |
| 4.7 | Entrada malformada no rompe el proceso | JSON truncado, YAML inválido, cURL imposible → error claro, sin excepción no controlada | 🟢 |
| 4.8 | Límite de tamaño de importación | `CEIBA_MAX_IMPORT_BYTES` aplicado | 🟢 |
| 4.9 | Importación persistida en una colección | extremo a extremo | 🟡 |

**Puerta:** 4.1–4.8 ejecutados con salida literal. **4.6 es bloqueante**: una
fuga de secretos en exportación es un fallo de seguridad, no una incidencia.

---

## Fase 5 — Compartición 🟡

| # | Criterio | Comando / prueba | Marca |
| --- | --- | --- | --- |
| 5.1 | Colección pública accesible (§20.14) | sin sesión | 🟡 |
| 5.2 | Colección privada con código válido (§20.15) | acceso concedido | 🟡 |
| 5.3 | **Código incorrecto, expirado y revocado rechazados (§20.16)** | los tres casos, por separado | 🟡 |
| 5.4 | **Los códigos se guardan con hash** | inspección: la tabla no contiene el valor en claro | 🟡 |
| 5.5 | El mensaje de error no revela si el código existe | respuesta idéntica para código inexistente e incorrecto | 🟢 |
| 5.6 | Límite de intentos y rate limiting | `CEIBA_SHARE_CODE_MAX_ATTEMPTS` / `_LOCKOUT_SECONDS` | 🟡 |
| 5.7 | El código nunca aparece en logs ni en URLs | búsqueda en los logs de la prueba | 🟢 |
| 5.8 | **Publicar no arrastra credenciales** | la vista pública no incluye `AuthConfigurations` ni variables secretas | 🟢 |
| 5.9 | Permisos del enlace respetados | enlace de sólo lectura no permite escritura | 🟡 |

> El **diseño** de estos controles es de `appsec-engineer` (ámbito 4.C.2). Aquí
> sólo fijo **en qué fase se exigen y qué los demuestra**.

---

## Fase 6 — Tests, ejecución de colecciones e IA 🟡

| # | Criterio | Comando / prueba | Marca |
| --- | --- | --- | --- |
| 6.1 | Definición y ejecución de tests sobre respuestas | aserciones de estado, cabeceras, cuerpo y tiempo | 🟡 |
| 6.2 | Ejecución de colección con fichero de datos | N iteraciones, informe por iteración | 🟡 |
| 6.3 | Progreso en tiempo real (`run.progress`) | evento por iteración | 🟡 |
| 6.4 | **Precedencia del ámbito `execution` (ADR-0006, ejemplo 3)** | fila de datos < script pre-request | 🟢 |
| 6.5 | **Aislamiento de scripts verificado** | intentos de `require('fs')`, `process.exit`, bucle infinito, agotar memoria y abrir un socket → **todos rechazados o acotados** | 🟢 |
| 6.6 | **La plataforma funciona sin IA (§20.22)** | arrancar con `CEIBA_AI_ENABLED=false` (valor por defecto del `.env.example`) y ejecutar el recorrido completo | 🟡 |
| 6.7 | El proveedor de IA está desacoplado | interfaz con doble; ningún módulo importa el SDK directamente | 🟢 |

> El **mecanismo** de aislamiento (6.5) lo elige `appsec-engineer` (4.C.4). El
> criterio de aceptación es mío y no es negociable: **si los cinco intentos de
> escape no se prueban, la fase no cierra.**

---

## Fase 7 — Endurecimiento y producción 🔴

| # | Criterio | Comando / prueba | Marca |
| --- | --- | --- | --- |
| 7.1 | Suite completa en verde en un clon limpio | `pnpm install --frozen-lockfile --prod=false && pnpm test` | 🟡 |
| 7.2 | **SSRF: las redirecciones no evaden la política (§20.19)** | destino que redirige a `169.254.169.254`, a `127.0.0.1`, a una IP privada y a una IPv6 equivalente → **bloqueado en cada salto** | 🟢 |
| 7.3 | SSRF: DNS rebinding | nombre que resuelve a IP pública en la comprobación y a privada al conectar → bloqueado **al conectar** | 🟢 |
| 7.4 | Revisión de seguridad cerrada | hallazgos confirmados del ámbito 4.C resueltos o aceptados por escrito | 🟡 |
| 7.5 | Migraciones y persistencia tras reiniciar (§20.21) | `docker compose restart` y los datos siguen ahí | 🔴 |
| 7.6 | Despliegue desde entorno limpio | `docker compose up` sobre un clon nuevo | 🔴 |
| 7.7 | Health checks y logs estructurados | `/healthz` en los tres servicios; logs en JSON sin secretos | 🟡 |
| 7.8 | PostgreSQL y Redis **no** expuestos a Internet (§21) | revisión de redes de Compose | 🔴 |
| 7.9 | Backup y restauración probados | restaurar en una instancia limpia | 🔴 |
| 7.10 | Documentación operativa y guía GCP | entregable escrito | 🔴 **[NO VERIFICADO]** |

> 7.2 y 7.3 son 🟢 y eso **no es obvio**: se prueban contra un servidor local
> que redirige a direcciones prohibidas. No hacen falta ni nube ni Docker. Dado
> que el motor es la superficie de ataque principal, **estas dos pruebas se
> adelantan a la Fase 1b** en cuanto el motor exista; aparecen aquí porque la
> Fase 7 es donde se auditan en conjunto.

---

## Mapa: las 22 pruebas obligatorias del §20 → fase

| §20 | Prueba | Fase |
| --- | --- | --- |
| 1 | Usuario e inicio de sesión | 1 |
| 2 | Crear workspace | 3 |
| 3 | Invitar usuario | 3 |
| 4 | Roles y permisos | 3 |
| 5 | Crear colección | 3 |
| 6 | Carpetas y subcarpetas | 3 |
| 7 | Crear y ejecutar endpoint | 2 |
| 8 | Query params, cabeceras y JSON | 2 |
| 9 | Respuestas y errores HTTP | 2 |
| 10 | Importar Postman v2.1 | 4 |
| 11 | Importar OpenAPI | 4 |
| 12 | Importar cURL | 4 |
| 13 | Copiar como cURL y verificar equivalencia | 4 |
| 14 | Compartir colección pública | 5 |
| 15 | Colección privada con código válido | 5 |
| 16 | Códigos incorrectos, expirados y revocados | 5 |
| 17 | Un lector no puede modificar | 3 |
| 18 | Secretos no se filtran en exportaciones | 4 |
| 19 | Redirecciones no evaden SSRF | 1b/7 |
| 20 | La colaboración no pierde cambios | 3 |
| 21 | Migraciones y persistencia tras reiniciar | 7 🔴 |
| 22 | Funciona sin el proveedor de IA | 6 |

**Las 22 están asignadas. Ninguna queda sin dueño de fase.**

## Resumen de verificabilidad

| Fase | Criterios 🟢 ejecutables hoy | Dependientes de infraestructura |
| --- | --- | --- |
| 0 | 7 de 7 | 0 |
| 1 | 10 de 14 | 4 🟡 |
| 1b | **10 de 10** | 0 |
| 2 | 6 de 8 | 2 🟡 |
| 3 | 1 de 11 | 9 🟡 · 1 🔴 |
| 4 | 8 de 9 | 1 🟡 |
| 5 | 3 de 9 | 6 🟡 |
| 6 | 3 de 7 | 4 🟡 |
| 7 | 2 de 10 | 3 🟡 · 5 🔴 |

**Aproximadamente la mitad del plan es demostrable sin PostgreSQL, Redis ni
Docker.** Esa cifra no es casual: es la consecuencia de tres decisiones
tomadas a propósito —el motor separado (ADR-0002), los paquetes puros
(ADR-0004) y «Redis escala, no habilita» (ADR-0005)—. Diseñar para la
verificabilidad en el entorno que realmente hay es lo que evita un proyecto
entero en estado [ESCRITO].

## Verificación de este ADR

| Qué | Estado |
| --- | --- |
| Las 8 fases del §22 están cubiertas | **[VERIFICADO]** por lectura del §22 |
| Las 22 pruebas del §20 están asignadas | **[VERIFICADO]** — tabla anterior |
| Cada fase tiene criterio comprobable con un comando | **[VERIFICADO]** — tablas |
| Los criterios 🟢 se han ejecutado | **[NO VERIFICADO]** — sólo los de la Fase 0; el resto no tiene código todavía |
