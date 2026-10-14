# ADR-0007 — Plan de fases con criterios de aceptación verificables

- **Estado:** Aceptada · **revisada el 2026-10-14** para aplicar la decisión **C-02**
- **Fecha:** 2026-10-14
- **Decide:** `software-architect`
- **Ámbito:** 4.A.7 del `BRIEF.md`; **§6, §20, §22 y la INSTRUCCIÓN FINAL** del `PROMPT-MAESTRO.md`; apartado 1 del `BRIEF.md`
- **Depende de:** ADR-0001 … ADR-0006, ADR-0008, **ADR-0009** (autenticación y roles), **ADR-0010** (precedencia sobre el esquema real)

> **Revisión de 2026-10-14.** La versión anterior de este ADR declaraba «No altero el
> orden de las fases» y colocaba el motor HTTP en una «Fase 1b» paralela, SSRF en la
> última fase y organización fusionada con colaboración. **La decisión C-02 del cliente
> deroga ese orden.** Esta revisión lo sustituye. Lo que cambió y por qué está en la
> §«Qué cambió en esta revisión».

## Contexto

El §20 del prompt maestro lista 22 pruebas obligatorias y cierra con la frase que es el
criterio de aceptación de todo el proyecto:

> No marques una función como terminada solamente porque existe una pantalla o
> un endpoint de backend. **Debe existir una prueba que demuestre su
> comportamiento.**

El §22 propone ocho fases. **No son vinculantes en su orden**: lo vinculante es **C-02**,
que coincide literalmente con el apartado 1 del `BRIEF.md` y con la INSTRUCCIÓN FINAL del
propio prompt maestro («*priorizando un cliente HTTP realmente funcional, seguido por la
organización de colecciones, la importación y exportación, la colaboración y la
compartición segura*»). Este plan sigue ese orden y añade a cada fase lo que al §22 le
falta: **una puerta de salida comprobable con un comando concreto**.

### El orden vinculante (C-02)

| C-02 | Bloque | Fase de este plan |
| --- | --- | --- |
| **1** | Motor HTTP y SSRF · constructor y respuestas | **Fase 2** |
| **2** | Organización | **Fase 3** |
| **3** | Importación y exportación | **Fase 4** |
| **4** | Colaboración | **Fase 5** |
| **5** | Compartición | **Fase 6** |

Las fases 0 y 1 son **habilitadores**, no prioridades del cliente. Las fases 7 y 8
recogen lo que el cliente no numeró pero el §20 y el §21 exigen.

### «Prioritaria» en el §6 no significa «primera»

El §6 («Colecciones públicas y privadas») abre con una sola frase sobre prioridad:
«**Esta es una funcionalidad prioritaria.**» La versión anterior de este ADR **no citaba
el §6 en ninguna de sus 320 líneas** y dejaba la compartición en la penúltima fase sin
explicar la aparente incoherencia. Eso era una contradicción por omisión. Se resuelve
aquí, con la lectura que fijó el cliente en **C-02**:

> **«Prioritaria» = imprescindible en alcance. No = primera en el calendario.**

Consecuencias concretas, para que la lectura no se quede en una frase:

- La compartición es la **posición 5** del calendario (Fase 6).
- Y es **bloqueante para la aceptación final**: el §24 exige que «las colecciones privadas
  soliciten un código de acceso válido» y que «los códigos puedan revocarse y expirar».
- Por tanto la Fase 6 **tiene puerta de salida propia** (antes no la tenía) y ninguno de
  sus criterios es opcional.

No hay ninguna otra frase sobre orden de entrega en el prompt maestro: lo comprobé. La
palabra «prioridad» aparece en tres líneas, y sólo la de la INSTRUCCIÓN FINAL habla de
secuencia — y coincide con C-02.

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
palabras. Esto es la aplicación literal del `BRIEF.md` §3.1 y de **C-01**.

### La Fundación no bloquea al cliente HTTP

El §22 ponía el motor detrás de una Fase 1 que depende de PostgreSQL y Docker. Si se
respeta esa dependencia, **el proyecto no produce ni un solo entregable demostrable**
hasta que alguien instale infraestructura que hoy no existe. Por eso:

> **La Fase 1 (Fundación) corre en paralelo con la Fase 2 y NO es su puerta de entrada.**
> La Fase 2 sólo necesita de la Fase 1 los contratos (`packages/contracts`), que son
> código puro. No necesita base de datos, ni migraciones, ni CI.

Esto ya no es «una desviación consciente del §22»: es la consecuencia directa de C-02,
que pone el motor en la posición 1.

---

## Fase 0 — Auditoría y decisiones · **COMPLETADA** 🟢

| | |
| --- | --- |
| **Objetivo** | Inspeccionar, medir el entorno, fijar decisiones. |
| **Entregables** | `ARQUITECTURA.md`, ADR-0001…0010, `MODELO-DATOS.md` (4.B), modelo de amenazas (4.C), `ALCANCE.md` (4.D). |

**Criterios de aceptación**

| # | Criterio | Marca | Estado |
| --- | --- | --- | --- |
| 0.1 | Repositorio inspeccionado: commit, rama, árbol, `package.json`, `pnpm-workspace.yaml`, `.env.example`, `packages/brand` | 🟢 | **CUMPLIDO** — commit `a0e7021`, rama `master` |
| 0.2 | Entorno medido con comandos, no leído | 🟢 | **CUMPLIDO** — ver `ARQUITECTURA.md` §0 |
| 0.3 | Versiones consultadas al registro, no supuestas | 🟢 | **CUMPLIDO** — ADR-0008 |
| 0.4 | Framework elegido y cerrado | 🟢 | **CUMPLIDO** — ADR-0001 |
| 0.5 | ORM elegido con la trampa de la RC documentada | 🟢 | **CUMPLIDO** — ADR-0003 |
| 0.6 | Precedencia de variables con ejemplos resueltos | 🟢 | **CUMPLIDO** — ADR-0006 |
| 0.7 | Riesgos y huecos declarados | 🟢 | **CUMPLIDO** — `ARQUITECTURA.md` §11 (Riesgos) y §12 (HUECOS), renumeradas al insertarse la §10 |
| 0.8 | **Autenticación, sesiones, CSRF y modelo de roles decididos** | 🟢 | **CUMPLIDO** — ADR-0009, escrito en la ronda de fase 1 |
| 0.9 | **Regla única de precedencia sobre el esquema real, con casos ejecutados** | 🟢 | **CUMPLIDO** — ADR-0010, escrito en la ronda de fase 1 |

> La Fase 0 se cerró con ocho ADR; 0.8 y 0.9 se añadieron después, en la ronda de fase 1,
> porque eran **decisiones de arquitectura pendientes**, no trabajo de otra fase. Por eso
> la fase sigue marcada **COMPLETADA** y sus entregables son ADR-0001…0010.

**Puerta:** ningún módulo empieza sin su contrato en `packages/contracts`
(ADR-0004).

---

## Fase 1 — Fundación · *habilitador, en paralelo con la Fase 2* 🟡

**No es una de las cinco prioridades de C-02.** Es la infraestructura que las sostiene.
Sólo bloquea a las fases que tocan base de datos (3 en adelante).

| | |
| --- | --- |
| **Objetivo** | Esqueleto del monorepo, TypeScript, esquema, migraciones, autenticación, CI. |
| **Entregables** | `apps/api` arrancando, `prisma/schema/*.prisma`, migración inicial, `packages/contracts` v1, CI. |

| # | Criterio | Comando / prueba | Marca |
| --- | --- | --- | --- |
| 1.1 | Instalación reproducible | `pnpm install --frozen-lockfile --prod=false` sin `ERESOLVE` | 🟢 |
| 1.2 | Una sola versión de TypeScript, `~6.0.3` | `pnpm ls typescript -r` muestra una única versión | 🟢 |
| 1.3 | Guardia anti-RC de Prisma | `node scripts/check-prisma-pin.mjs` sale 0; **falla si alguien pone `^` o una RC** | 🟢 |
| 1.4 | Esquema válido con **las 38 tablas y 36 enums** del DBML | `prisma validate` → «The schemas at prisma/schema are valid», y el recuento de modelos y enums coincide con `docs/schema/ceiba.dbml`; cualquier desvío se declara | 🟢 |
| 1.5 | Migración inicial generada y **revisada** | `prisma migrate diff --from-empty --to-schema ./prisma/schema --script` produce DDL; el `migration.sql` está en el repositorio y revisado | 🟢 |
| 1.6 | Límites de módulo exigidos | `pnpm lint` falla ante un import profundo deliberado | 🟢 |
| 1.7 | Sin ciclos entre módulos | `madge --circular` sale 0 | 🟢 |
| 1.8 | **Toda ruta tiene guard** (ADR-0001, ADR-0009 §7.3) | prueba que recorre el `RouterExplorer` y falla si falta | 🟢 |
| 1.9 | Type-check y build limpios | `pnpm typecheck && pnpm build` | 🟢 |
| 1.10 | Migración **aplicada** a PostgreSQL 17 vacío | `prisma migrate deploy` + `\dt` | 🟡 |
| 1.11 | Alta de usuario y login (§20.1) con **sesión en cookie** (ADR-0009) | `POST /auth/register` → `POST /auth/login` → cookie `__Host-ceiba_session` emitida; **ningún testigo en el cuerpo** | 🟡 |
| 1.12 | Conocer un ID no basta (§19) | usuario B pide el recurso de A → **404**, no 403 | 🟡 |
| 1.13 | OpenAPI generado | `GET /api/v1/openapi.json` válido y comparado con snapshot | 🟡 |
| 1.14 | CI en verde en un clon limpio | pipeline completo | 🟢 |

**Puerta de salida:** 1.1–1.9 y 1.14 ejecutados con salida literal. 1.10–1.13
**preparados y no verificados** mientras no haya PostgreSQL.

> 1.12 exige **404 y no 403**: un 403 confirma que el recurso existe, y eso es
> una fuga de información por enumeración de IDs.

---

## Fase 2 — Cliente HTTP: motor, SSRF, constructor y respuestas · **C-02 #1** 🟢

**Es la primera prioridad del cliente y la que más riesgo retira.** El `BRIEF.md` §1 la
define literalmente como «Cliente HTTP realmente funcional (**motor + constructor +
respuestas**)», así que las tres cosas están en esta fase, con **dos puertas**.

| | |
| --- | --- |
| **Entregables** | `packages/contracts`, `packages/variables`, `apps/engine`, constructor de solicitudes y visor de respuestas. |

### 2A — Motor HTTP y controles SSRF

**Íntegramente ejecutable hoy, sin PostgreSQL, Redis ni Docker.**

| # | Criterio | Comando / prueba | Marca |
| --- | --- | --- | --- |
| 2.1 | Contratos compilan y son fuente única | `pnpm --filter @ceiba/contracts typecheck` | 🟢 |
| 2.2 | **Los 7 ejemplos del ADR-0006 y los 26 casos del ADR-0010** pasan uno a uno | `pnpm --filter @ceiba/variables test` | 🟢 |
| 2.3 | Deshabilitada ≠ vacía; el valor local no cruza ámbitos; override local deshabilitado no tira la capa (ADR-0010 §5) | casos E-02/E-02b/E-07 | 🟢 |
| 2.4 | Ciclos y profundidad máxima detectados | `CIRCULAR_REFERENCE`, `MAX_DEPTH_EXCEEDED` | 🟢 |
| 2.5 | Resolución determinista | 1000 iteraciones, salida idéntica | 🟢 |
| 2.6 | Motor responde a `/healthz` | arrancar `apps/engine` y hacer `curl` | 🟢 |
| 2.7 | Motor ejecuta una petición real | servidor `node:http` en `127.0.0.1`; `POST /v1/execute`; comprobar `status`, `headers`, `timings` | 🟢 |
| 2.8 | Timeout, tamaño máximo y redirecciones | servidor que cuelga / devuelve 30 MB / encadena 10 redirecciones → `TIMEOUT`, `RESPONSE_TOO_LARGE`, `TOO_MANY_REDIRECTS` | 🟢 |
| 2.9 | **El motor no puede hablar con la base de datos** | prueba que falla si `@prisma/client`, `pg` o `DATABASE_URL` aparecen en `apps/engine` | 🟢 |
| 2.10 | El motor no registra secretos | ejecutar con cabecera `secret: true` y comprobar que el valor no está en el log | 🟢 |
| 2.11 | **El motor rechaza toda petición sin `CEIBA_ENGINE_TOKEN`** | petición sin testigo y con testigo erróneo → 401 | 🟢 |
| 2.12 | **SSRF: las redirecciones no evaden la política (§20.19)** | destino que redirige a `169.254.169.254`, a `127.0.0.1`, a una IP privada y a una IPv6 equivalente → **bloqueado en cada salto** | 🟢 |
| 2.13 | **SSRF: DNS rebinding** | nombre que resuelve a IP pública en la comprobación y a privada al conectar → bloqueado **al conectar** | 🟢 |
| 2.14 | **SSRF: la política falla cerrado** | `0.0.0.0`, `100.64.0.0/10` y entradas basura al comprobador → **denegadas**; una excepción interna **deniega**, nunca permite | 🟢 |

**Puerta 2A:** los catorce criterios ejecutados con salida literal. **Sin excusas de
infraestructura: ninguno la necesita.** 2.12–2.14 son **bloqueantes**: el motor es la
superficie de ataque principal del producto.

### 2B — Constructor de solicitudes y visor de respuestas

| # | Criterio | Comando / prueba | Marca |
| --- | --- | --- | --- |
| 2.15 | Solicitud con query, cabeceras y JSON (§20.8) | prueba contra servidor local controlado | 🟢 |
| 2.16 | Respuestas de éxito y errores HTTP (§20.9) | 200/201/400/401/404/500 mostrados correctamente | 🟢 |
| 2.17 | Los 7 tipos de cuerpo (§7) | `none`, `raw`, `json`, `form`, `urlencoded`, `binary`, `graphql` | 🟢 |
| 2.18 | **El motor no recibe `{{` nunca** | prueba de contrato sobre el cuerpo enviado al motor | 🟢 |
| 2.19 | Advertencia de variables sin resolver **antes** de ejecutar (§12) | prueba de interfaz con `{{order_id}}` indefinida | 🟢 |
| 2.20 | Ejecutar y crear endpoint (§20.7) | extremo a extremo | 🟡 |
| 2.21 | Historial persiste y **no guarda cuerpos indefinidamente** (§17) | política de retención aplicada y comprobada | 🟡 |
| 2.22 | Toda pantalla de carga lleva el logo girando (`BRIEF.md` §1) | prueba de interfaz: no hay otro spinner; se usa `CeibaLoadingScreen`/`CeibaSpinner` | 🟢 |

**Puerta 2B:** 2.15–2.19 y 2.22 ejecutados. 2.20 y 2.21 preparados y no verificados.
**Es el entregable que más le importa al cliente**; no se avanza a la Fase 3 sin las dos
puertas de esta fase en verde.

---

## Fase 3 — Organización · **C-02 #2** 🟡

Workspaces, proyectos, colecciones, carpetas, endpoints, entornos y variables. **La
colaboración ya no está aquí**: C-02 la separa y la coloca después de importación y
exportación.

| # | Criterio | Comando / prueba | Marca |
| --- | --- | --- | --- |
| 3.1 | Crear workspace (§20.2) | integración | 🟡 |
| 3.2 | Crear colección (§20.5) | integración | 🟡 |
| 3.3 | Carpetas y subcarpetas (§20.6) | incluye mover, duplicar y archivar | 🟡 |
| 3.4 | Proyectos dentro del workspace (§4) | jerarquía completa `Workspace → Proyecto → Colección → Carpeta → Endpoint` | 🟡 |
| 3.5 | CRUD de entornos y de los cuatro ámbitos de `scoped_variables` | integración | 🟡 |
| 3.6 | **La precedencia compone las tres fuentes reales (ADR-0010 §1 y §8)** | los 26 casos, ahora con datos en PostgreSQL y el entorno activo conmutado | 🟡 |
| 3.7 | Versiones de colección (§15) | crear, listar y restaurar | 🟡 |
| 3.8 | **La composición de capas se prueba sin base de datos** | repositorio doble que devuelve las filas de `scoped_variables` y `environment_variables`; mismos 26 resultados | 🟢 |

**Puerta:** 3.8 ejecutado; 3.1–3.7 preparados y no verificados. 3.6 es **bloqueante**: si
la precedencia sobre el esquema real diverge de la del resolutor puro, hay dos
implementaciones y el ADR-0010 no se está cumpliendo.

---

## Fase 4 — Importación y exportación · **C-02 #3** 🟢

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

## Fase 5 — Colaboración · **C-02 #4** 🟡

Miembros, invitaciones, roles, permisos aplicados en el servidor y tiempo real.
El modelo normativo es el **ADR-0009**.

| # | Criterio | Comando / prueba | Marca |
| --- | --- | --- | --- |
| 5.1 | Invitar usuario (§20.3) | integración; invitación con selector/verificador, no con el testigo en claro | 🟡 |
| 5.2 | **Roles y permisos (§20.4)** | la matriz rol × operación del **ADR-0009 §7.5**, **en el servidor** | 🟡 |
| 5.3 | **Un lector no puede modificar (§20.17)** | cada endpoint de escritura con rol `viewer` → denegado | 🟡 |
| 5.4 | **Sin sobrescrituras silenciosas (§20.20)** | dos `PATCH` con la misma `expectedVersion` → uno 200, otro 409 | 🟡 |
| 5.5 | Lógica de permisos con dobles | pruebas unitarias sin base de datos | 🟢 |
| 5.6 | **La matriz completa del ADR-0009 §7.5 con dobles** | 5 roles × 13 operaciones, todas afirmadas, sin base de datos | 🟢 |
| 5.7 | Tiempo real en instancia única, **sin Redis** | cliente Socket.IO; `collection.updated` llega | 🟡 |
| 5.8 | Revocar permiso expulsa de la sala | dejan de llegar eventos sin reconectar | 🟡 |
| 5.9 | **Revocar una sesión cierra sus sockets vivos** (ADR-0009 §9) | `revoke-all` → los WebSocket de esa sesión se cierran | 🟡 |
| 5.10 | Difusión entre dos instancias vía Redis | emitido en A, recibido en B | 🔴 |

**Puerta:** 5.5 y 5.6 ejecutados; el resto preparado. **5.2, 5.3 y 5.4 son bloqueantes
para producción**: sin ellos no hay colaboración segura. El §5 es explícito —
«**Implementa autorización en el backend. No basta con ocultar botones en el frontend.**»

---

## Fase 6 — Compartición · **C-02 #5** 🟡

> **El §6 la llama «funcionalidad prioritaria».** Por **C-02** eso significa
> **imprescindible en alcance**, no primera en el calendario. Va la quinta, y **ninguno
> de sus criterios es opcional**: el §24 los convierte en criterios de aceptación final.

| # | Criterio | Comando / prueba | Marca |
| --- | --- | --- | --- |
| 6.1 | Colección pública accesible (§20.14) | sin sesión | 🟡 |
| 6.2 | Colección privada con código válido (§20.15) | acceso concedido | 🟡 |
| 6.3 | **Código incorrecto, expirado y revocado rechazados (§20.16)** | los tres casos, por separado | 🟡 |
| 6.4 | **Los códigos se guardan con hash** | inspección: la tabla no contiene el valor en claro | 🟡 |
| 6.5 | El mensaje de error no revela si el código existe | respuesta idéntica para código inexistente e incorrecto | 🟢 |
| 6.6 | Límite de intentos y rate limiting | `CEIBA_SHARE_CODE_MAX_ATTEMPTS` / `_LOCKOUT_SECONDS` | 🟡 |
| 6.7 | El código nunca aparece en logs ni en URLs | búsqueda en los logs de la prueba | 🟢 |
| 6.8 | **Publicar no arrastra credenciales** | la vista pública no incluye `AuthConfigurations` ni variables secretas | 🟢 |
| 6.9 | Permisos del enlace respetados | enlace de sólo lectura no permite escritura | 🟡 |
| 6.10 | **La revocación surte efecto en la petición siguiente** | revocar el enlace → la sesión de compartición ya emitida falla, sin esperas | 🟡 |

**Puerta:** 6.5, 6.7 y 6.8 ejecutados; el resto preparado y no verificado. **6.3, 6.4 y
6.10 son bloqueantes para la aceptación final** (§24). Antes esta fase no tenía puerta;
ahora la tiene, porque una «funcionalidad prioritaria» sin criterio de cierre no se puede
declarar terminada.

> El **diseño** de estos controles es de `appsec-engineer` (ámbito 4.C.2). Aquí
> sólo fijo **en qué fase se exigen y qué los demuestra**.

---

## Fase 7 — Tests, ejecución de colecciones e IA 🟡

| # | Criterio | Comando / prueba | Marca |
| --- | --- | --- | --- |
| 7.1 | Definición y ejecución de tests sobre respuestas | aserciones de estado, cabeceras, cuerpo y tiempo | 🟡 |
| 7.2 | Ejecución de colección con fichero de datos | N iteraciones, informe por iteración | 🟡 |
| 7.3 | Progreso en tiempo real (`run.progress`) | evento por iteración | 🟡 |
| 7.4 | **Precedencia del ámbito `execution`** (ADR-0006 ej. 3; ADR-0010 casos X-01…X-04) | 61 < 62 < 63 y la capa efímera no se persiste | 🟢 |
| 7.5 | **Aislamiento de scripts verificado** | intentos de `require('fs')`, `process.exit`, bucle infinito, agotar memoria y abrir un socket → **todos rechazados o acotados** | 🟢 |
| 7.6 | **La plataforma funciona sin IA (§20.22)** | arrancar con `CEIBA_AI_ENABLED=false` (valor por defecto del `.env.example`) y ejecutar el recorrido completo | 🟡 |
| 7.7 | El proveedor de IA está desacoplado | interfaz con doble; ningún módulo importa el SDK directamente | 🟢 |

**Puerta:** 7.4, 7.5 y 7.7 ejecutados; el resto preparado.

> El **mecanismo** de aislamiento (7.5) lo elige `appsec-engineer` (4.C.4). El
> criterio de aceptación es mío y no es negociable: **si los cinco intentos de
> escape no se prueban, la fase no cierra.**

---

## Fase 8 — Endurecimiento y producción 🔴

**SSRF ya no está aquí.** C-02 lo sitúa en la Fase 2, junto al motor, y así figura
(2.12–2.14). Esta fase audita el conjunto, no estrena controles.

| # | Criterio | Comando / prueba | Marca |
| --- | --- | --- | --- |
| 8.1 | Suite completa en verde en un clon limpio | `pnpm install --frozen-lockfile --prod=false && pnpm test` | 🟡 |
| 8.2 | Revisión de seguridad cerrada | hallazgos confirmados del ámbito 4.C resueltos o aceptados por escrito | 🟡 |
| 8.3 | Migraciones y persistencia tras reiniciar (§20.21) | `docker compose restart` y los datos siguen ahí | 🔴 |
| 8.4 | Despliegue desde entorno limpio | `docker compose up` sobre un clon nuevo | 🔴 |
| 8.5 | Health checks y logs estructurados | `/healthz` en los tres servicios; logs en JSON sin secretos | 🟡 |
| 8.6 | PostgreSQL y Redis **no** expuestos a Internet (§21) | revisión de redes de Compose | 🔴 |
| 8.7 | Backup y restauración probados | restaurar en una instancia limpia | 🔴 |
| 8.8 | **Cookies seguras tras Nginx y HTTPS** (ADR-0009 §6) | `Secure`, `SameSite=Lax` y `__Host-` presentes en la respuesta real tras el proxy; `X-Forwarded-*` del cliente descartadas; la IP registrada es la real | 🔴 |
| 8.9 | Documentación operativa y guía GCP | entregable escrito | 🔴 **[NO VERIFICADO]** |

**Puerta:** ninguno de los criterios 🔴 se puede ejecutar en este contenedor. La fase se
declara **preparada y no verificada** hasta que exista despliegue, y así debe constar en
el informe de cierre. Antes esta fase tampoco tenía puerta.

---

## Mapa: las 22 pruebas obligatorias del §20 → fase

| §20 | Prueba | Fase |
| --- | --- | --- |
| 1 | Usuario e inicio de sesión | 1 |
| 2 | Crear workspace | 3 |
| 3 | Invitar usuario | **5** |
| 4 | Roles y permisos | **5** |
| 5 | Crear colección | 3 |
| 6 | Carpetas y subcarpetas | 3 |
| 7 | Crear y ejecutar endpoint | 2 |
| 8 | Query params, cabeceras y JSON | 2 |
| 9 | Respuestas y errores HTTP | 2 |
| 10 | Importar Postman v2.1 | 4 |
| 11 | Importar OpenAPI | 4 |
| 12 | Importar cURL | 4 |
| 13 | Copiar como cURL y verificar equivalencia | 4 |
| 14 | Compartir colección pública | **6** |
| 15 | Colección privada con código válido | **6** |
| 16 | Códigos incorrectos, expirados y revocados | **6** |
| 17 | Un lector no puede modificar | **5** |
| 18 | Secretos no se filtran en exportaciones | 4 |
| 19 | Redirecciones no evaden SSRF | **2** |
| 20 | La colaboración no pierde cambios | **5** |
| 21 | Migraciones y persistencia tras reiniciar | **8** 🔴 |
| 22 | Funciona sin el proveedor de IA | **7** |

**Las 22 están asignadas y cada una tiene exactamente una fase.** La prueba 19 ya no
figura como «1b/7»: era la única con dos dueños, y una prueba con dos dueños no tiene
ninguno.

## Resumen de verificabilidad

| Fase | Criterios | 🟢 ejecutables hoy | Dependientes de infraestructura |
| --- | --- | --- | --- |
| 0 Auditoría | 9 | **9 de 9** | 0 |
| 1 Fundación | 14 | 10 de 14 | 4 🟡 |
| **2 Cliente HTTP (C-02 #1)** | 22 | **20 de 22** | 2 🟡 |
| 3 Organización (C-02 #2) | 8 | 1 de 8 | 7 🟡 |
| 4 Importación/exportación (C-02 #3) | 9 | 8 de 9 | 1 🟡 |
| 5 Colaboración (C-02 #4) | 10 | 2 de 10 | 7 🟡 · 1 🔴 |
| 6 Compartición (C-02 #5) | 10 | 3 de 10 | 7 🟡 |
| 7 Tests e IA | 7 | 3 de 7 | 4 🟡 |
| 8 Endurecimiento | 9 | 0 de 9 | 3 🟡 · 6 🔴 |
| **Total** | **98** | **56** | 35 🟡 · 7 🔴 |

**57 % del plan es demostrable sin PostgreSQL, Redis ni Docker**, y la fase más grande
—la primera prioridad del cliente— lo es al **91 %**. Esa cifra no es casual: es la
consecuencia de cuatro decisiones tomadas a propósito —el motor separado (ADR-0002), los
paquetes puros (ADR-0004), «Redis escala, no habilita» (ADR-0005) y la regla de
precedencia fuera de SQL (ADR-0010)—. Diseñar para la verificabilidad en el entorno que
realmente hay es lo que evita un proyecto entero en estado [ESCRITO].

> Las cifras de esta tabla son un recuento de las tablas de criterios de este documento.
> **No significan que esos criterios se hayan ejecutado**: significan que *pueden*
> ejecutarse aquí. Lo ejecutado hasta hoy es la Fase 0.

## Qué cambió en esta revisión

| # | Antes | Ahora | Motivo |
| --- | --- | --- | --- |
| 1 | «No altero el orden de las fases» | El orden es el de **C-02** | La frase negaba literalmente el mandato aprobado |
| 2 | Motor en una «Fase 1b» paralela y accesoria | **Fase 2, bloque 2A**, primera prioridad | C-02 #1 |
| 3 | SSRF en la Fase 7 (última), criterios `7.2`/`7.3` | **2.12–2.14**, junto al motor, bloqueantes | C-02 pone «motor HTTP **y SSRF**» juntos en la posición 1 |
| 4 | Prueba §20.19 asignada a «1b/7» | Asignada a la **Fase 2** | Una prueba con dos fases no tiene puerta |
| 5 | «Fase 3 — Organización y colaboración» fusionadas | **Fase 3 Organización** y **Fase 5 Colaboración**, separadas | C-02 las separa e intercala importación/exportación |
| 6 | Importación/exportación después de colaboración | **Fase 4**, antes de colaboración | C-02 #3 antes que #4 |
| 7 | Fases 5, 6 y 7 sin puerta de salida | Todas con puerta | Una fase sin criterio de cierre no se puede declarar terminada |
| 8 | El §6 no se citaba en ninguna línea | Sección propia que fija «prioritaria» = imprescindible en alcance | Era una contradicción por omisión |
| 9 | «Las 8 fases del §22 están cubiertas» como criterio de corrección | Sustituido por la alineación con C-02 | El ADR se auto-validaba contra la norma derogada |
| 10 | Ámbito: «§22 y §20» | «§6, §20, §22 y la INSTRUCCIÓN FINAL» + C-02 | Faltaban las dos fuentes que fijan el orden |
| 11 | 8 fases | 9 fases (0–8) | Separar organización de colaboración y dar fase propia al endurecimiento |
| 12 | ADR-0009 y ADR-0010 no existían | Integrados en los criterios 0.8, 0.9, 1.8, 1.11, 2.2, 2.3, 3.6, 3.8, 5.2, 5.6, 5.9, 7.4, 8.8 | Son normativos para autenticación, roles y precedencia |

## Verificación de este ADR

| Qué | Estado |
| --- | --- |
| El orden de las fases 2–6 es el de **C-02** | **[VERIFICADO]** — tabla de la §«El orden vinculante» |
| C-02 coincide con el `BRIEF.md` §1 y con la INSTRUCCIÓN FINAL del prompt maestro | **[VERIFICADO]** por lectura de ambas fuentes |
| La contradicción con el §6 está resuelta de forma explícita | **[VERIFICADO]** — el §6 se cita y se interpreta; antes no aparecía |
| Las 22 pruebas del §20 están asignadas, cada una a **una sola** fase | **[VERIFICADO]** — tabla anterior |
| Cada fase tiene puerta de salida | **[VERIFICADO]** — las nueve la tienen; antes faltaba en tres |
| Cada criterio es comprobable con un comando o una prueba nombrada | **[VERIFICADO]** — tablas |
| Los criterios 🟢 se han ejecutado | **[NO VERIFICADO]** — sólo los de la Fase 0. El resto no tiene código todavía |
| El recuento de la tabla de verificabilidad | **[VERIFICADO]** por conteo sobre este documento; **no** implica ejecución |
