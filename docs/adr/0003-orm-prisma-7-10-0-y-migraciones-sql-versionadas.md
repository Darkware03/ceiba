# ADR-0003 — ORM: Prisma **7.10.0** (no la 8 RC) y migraciones SQL versionadas

- **Estado:** Aceptada
- **Fecha:** 2026-10-14
- **Decide:** `software-architect`
- **Ámbito:** 4.A.3 del `BRIEF.md`; §3, §17 del `PROMPT-MAESTRO.md`
- **Afecta a:** `apps/api`, `prisma/`, CI
- **No afecta a:** `apps/engine` (ADR-0002: el motor no habla con la base de datos)

## Contexto

El prompt maestro exige PostgreSQL (§3) y «migraciones versionadas» (§3, §17).
El brief §4.A.3 remite al aviso sobre Prisma RC. En este contenedor **no hay
PostgreSQL ni `psql`** [VERIFICADO], así que la elección de ORM tiene una
restricción adicional poco habitual y muy concreta:

> **Hay que poder producir y revisar las migraciones sin un motor de base de
> datos delante.** Si el ORM elegido necesita una base de datos viva para
> generar o siquiera validar el esquema, el proyecto se queda bloqueado hoy.

Y una segunda, derivada del §4.A.4: el esquema de 25+ entidades lo van a tocar
varios autores. Si el esquema es **un solo fichero**, es el punto de conflicto
de merge más caliente del repositorio.

## El problema de la versión [VERIFICADO]

Comprobado por mí el 2026-10-14:

```
$ npm view prisma version
8.0.0-rc.22
$ npm view @prisma/client version
7.10.0
$ npm view prisma dist-tags --json
{ "next": "8.0.0-rc.10", "prev": "7.10.0", "latest": "8.0.0-rc.22", "dev": "8.0.0-rc.22-dev.148" }
$ npm view @prisma/client dist-tags --json
{ "prev": "6.19.3", "latest": "7.10.0", "dev": "8.1.0-dev.9" }
```

El brief tenía razón y además el problema es **peor de lo que parecía**:

1. El dist-tag `latest` de **`prisma`** apunta a una **release candidate**.
   Un `pnpm add prisma` instala una RC en el núcleo del producto sin avisar.
2. El dist-tag `latest` de **`@prisma/client`** apunta a **`7.10.0` estable**.
3. Por tanto **`latest` + `latest` instala majors cruzados: CLI 8-RC con
   cliente 7 estable**, y npm **no emite ningún error**, porque
   `@prisma/client` declara `peerDependencies = { prisma: "*" }`
   (comprobado: `npm view @prisma/client@7.10.0 peerDependencies`).

Esta última es la trampa de verdad: no es «la RC es inestable», es «la
combinación por defecto está rota y es silenciosa».

**Última estable de `prisma` = `7.10.0`** (igual a `dist-tags.prev` y a la
última que cumple `^\d+\.\d+\.\d+$`). Coincide con la de `@prisma/client`.

## Decisión

### 1. ORM: **Prisma 7.10.0**, pineado exacto, sin `^` ni `~`

```jsonc
// apps/api/package.json
"dependencies":    { "@prisma/client": "7.10.0" },
"devDependencies": { "prisma": "7.10.0" }
```

Sin rango. Un `^7.10.0` saltaría a 8.x en cuanto salga, y aquí ya hemos visto
que la publicación de esta librería no es de fiar para resolución automática.

**Guardia en CI** (y ejecutable en este contenedor, sin base de datos):

```
scripts/check-prisma-pin.mjs
  - falla si prisma y @prisma/client no son la MISMA versión exacta
  - falla si la versión contiene '-' (rc, beta, alpha, dev)
  - falla si el rango no es exacto (contiene ^ ~ * x latest)
```

Esta guardia es el entregable que impide que el problema vuelva. Sin ella, la
decisión dura hasta el primer `pnpm update`.

### 2. Migraciones: SQL plano versionado en `prisma/migrations/`

- **Desarrollo:** `prisma migrate dev --name <verbo_objeto>` genera un
  directorio `prisma/migrations/<timestamp>_<nombre>/migration.sql`.
- **El artefacto de registro es el `migration.sql`**, no el `schema.prisma`.
  Se revisa en el *pull request* como se revisa el código. Nadie aprueba una
  migración que no ha leído.
- **Producción:** **únicamente `prisma migrate deploy`.** Prohibido
  `prisma db push` (no deja rastro versionado) y prohibido `migrate dev` o
  `migrate reset` contra cualquier entorno con datos.
- **Sin destrucción automática.** Un `DROP COLUMN` / `DROP TABLE` no entra en
  una migración ordinaria: se parte en dos despliegues (expand/contract) y
  requiere autorización explícita, según el brief §3.3 y el §21 del prompt
  maestro («no elimines volúmenes ni datos existentes durante las
  actualizaciones»).
- Las migraciones son **aditivas y reversibles hacia delante**. No se usan
  *down migrations*: se escribe una migración nueva que corrige.

### 3. Esquema **multi-fichero**, uno por módulo

```
prisma/
  schema/
    00-datasource.prisma     ← generator + datasource.  Un solo dueño.
    identity.prisma          ← User, Session, Invitation
    workspace.prisma         ← Workspace, WorkspaceMember, Project
    collection.prisma        ← Collection, CollectionFolder, CollectionVersion
    request.prisma           ← ApiRequest, RequestHeader, RequestParam, RequestBody
    auth-config.prisma       ← AuthConfiguration  (secretos, separados a propósito)
    environment.prisma       ← Environment, EnvironmentVariable
    sharing.prisma           ← SharedLink, ShareAccessCode
    execution.prisma         ← RequestHistory, CollectionRun, TestDefinition, TestRun
    collab.prisma            ← Comment, Notification
    ops.prisma               ← AuditLog, File
  migrations/
  prisma.config.ts
```

Un fichero por módulo = **un dueño por fichero** = cero conflictos de merge
entre agentes. Esto es lo que hace que el §4.A.4 funcione también en la capa de
datos y no sólo en el código.

> El **contenido** de estos ficheros (entidades, FK, índices, políticas de
> borrado) es de `database-engineer`, ámbito 4.B. Yo fijo **la partición y el
> mecanismo**, no el modelo. Él trabaja en `MODELO-DATOS.md` y
> `docs/schema/ceiba.dbml`; la traducción a `prisma/schema/*.prisma` es una
> tarea posterior que debe respetar esta partición.

### 4. Configuración: `prisma.config.ts` (obligatorio en Prisma 7)

**Prisma 7 eliminó `url` del bloque `datasource`.** No es opcional ni
cosmético; lo comprobé ejecutándolo:

```
$ npx prisma validate --schema ./prisma/schema
Error code: P1012
error: The datasource property `url` is no longer supported in schema files.
Move connection URLs for Migrate to `prisma.config.ts` and pass either `adapter`
for a direct database connection or `accelerateUrl` for Accelerate to the
PrismaClient constructor.
```

Forma verificada que **sí** valida:

```ts
// prisma.config.ts
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  schema: './prisma/schema',
  migrations: { path: './prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
})
```

```prisma
// prisma/schema/00-datasource.prisma
generator client {
  provider = "prisma-client"
  output   = "../../generated"
}

datasource db {
  provider = "postgresql"   // sin `url`
}
```

**Impacto en el `.env.example` existente: ninguno.** `DATABASE_URL` sigue siendo
la variable; sólo cambia quién la lee. El `.env.example` del commit `a0e7021` no
necesita tocarse por esto. Lo que sí hace falta es que `PrismaClient` se
construya con un *driver adapter* de PostgreSQL en Prisma 7; eso es una línea de
`apps/api` (fuera de mi ámbito de escritura) y queda anotada en §Verificación
como **[NO VERIFICADO]**: no he instanciado el cliente contra una base de datos
porque aquí no hay ninguna.

## 🔑 Verificación ejecutada en este contenedor [VERIFICADO]

Esto es lo que convierte la decisión en algo más que una opinión. **Instalé
Prisma 7.10.0 y generé DDL de PostgreSQL sin ninguna base de datos.**

```
$ npm install prisma@7.10.0 @prisma/client@7.10.0
added 138 packages in 11s

$ npx prisma --version
prisma               : 7.10.0
@prisma/client       : 7.10.0
Operating System     : linux
Architecture         : x64
Node.js              : v24.21.0
Query Compiler       : enabled
PSL                  : @prisma/prisma-schema-wasm 7.10.0-4.0edf323…

$ npx prisma validate
Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from prisma/schema.
The schemas at prisma/schema are valid 🚀
```

Esquema de prueba repartido en **tres ficheros** (`schema.prisma`,
`workspace.prisma`, `collection.prisma`) con relación y `onDelete: Cascade`
entre ficheros distintos. Resultado de generar la migración **sin PostgreSQL**:

```
$ npx prisma migrate diff --from-empty --to-schema ./prisma/schema --script
Loaded Prisma config from prisma.config.ts.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Workspace" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);
…
-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_role_key" ON "WorkspaceMember"("workspaceId", "role");

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

**Cuatro cosas quedan demostradas, no supuestas:**

1. Prisma 7.10.0 **instala y funciona en Node 24.21.0** aquí, sin root.
2. El **esquema multi-fichero funciona** y resuelve relaciones entre ficheros
   distintos → la partición por módulo del punto 3 es real.
3. Se produce **DDL de PostgreSQL revisable (`UUID`, `JSONB`, `TIMESTAMP(3)`,
   índices parciales, FK con `ON DELETE CASCADE`) sin ninguna base de datos**.
   El bloqueo «no hay PostgreSQL» **no impide** generar y revisar migraciones;
   sólo impide *aplicarlas*.
4. `prisma validate` es una **puerta de CI ejecutable hoy**: valida 25+
   entidades sin infraestructura.

### Dos trampas de operación descubiertas al ejecutarlo

- El `postinstall` de `@prisma/engines` **descarga el binario del schema
  engine**. En este contenedor npm lo bloqueó por política de scripts y
  `migrate diff` falló con un `Error in Schema engine:` **vacío y sin causa
  legible**. Hay que aprobar ese script explícitamente, o el CI dará un error
  incomprensible. Queda documentado aquí porque costó tres intentos localizarlo.
- En Prisma 7 `migrate diff` exige `--to-schema` (el antiguo
  `--to-schema-datamodel` **fue eliminado**) y necesita un `datasource` resuelto
  vía `prisma.config.ts` aunque **no se conecte a nada**.

## Techo de TypeScript — restricción cruzada [VERIFICADO]

`typescript@latest` es **7.0.2**, pero `@nestjs/swagger@12.0.2` declara
`peerDependencies.typescript = "^5.5.0 || ^6.0.0"`. Instalar TS 7 produce
`ERESOLVE` reproducible:

```
npm error code ERESOLVE
npm error While resolving: @nestjs/swagger@12.0.2
npm error Found: typescript@7.0.2
npm error Could not resolve dependency:
npm error peerOptional typescript@"^5.5.0 || ^6.0.0" from @nestjs/swagger@12.0.2
npm error Conflicting peer dependency: typescript@6.0.3
```

**El techo real de TypeScript para este stack es `6.0.3`**, y satisface el peer
`typescript >= 5.4.0` de `@prisma/client@7.10.0`. Se fija `typescript 6.0.3`.
Con TS 6.0.3 el stack backend completo instala limpio: `added 270 packages`, sin
`ERESOLVE`.

## Alternativas consideradas

### A) Prisma 8.0.0-rc.22 — **rechazada**

Es una RC. El brief lo prohíbe en el núcleo y estoy de acuerdo: el ORM es la
dependencia más cara de revertir de todo el sistema, porque arrastra el formato
de las migraciones ya aplicadas en producción.

### B) Drizzle ORM 0.45.4 + drizzle-kit 0.31.11 — rechazada, pero por poco

[VERIFICADO: `npm view drizzle-orm version` → `0.45.4`;
`npm view drizzle-kit version` → `0.31.11`]

- **A favor, y es real:** el esquema se escribe en TypeScript, así que el
  troceado por módulo es nativo y no depende de una función del CLI; SQL más
  cercano al motor; sin binario de engine; `drizzle-orm` declara ~29 peers y
  **todos opcionales**, así que no arrastra nada.
- **En contra:**
  1. `drizzle-orm 0.45.4` y `drizzle-kit 0.31.11` están en **líneas de versión
     distintas** y la v1.0 de ambos sigue en **`rc` (1.0.0-rc.4)**. Adoptar
     Drizzle hoy significa construir sobre `0.x` sabiendo que la 1.0 es
     inminente: el mismo riesgo de RC que motiva rechazar Prisma 8, sólo que
     peor documentado.
  2. El `.env.example` ya commiteado usa la forma de DSN
     `postgresql://…?schema=public`, que es el dialecto de Prisma. Es una señal
     débil, pero apunta en la misma dirección.
  3. `drizzle-kit generate` también produce SQL revisable sin base de datos, así
     que en el criterio decisivo **empata**; no hay ventaja que compense el
     riesgo del punto 1.
- **Reevaluar** cuando Drizzle 1.0 sea estable. Mitigación de bloqueo: el acceso
  a datos queda detrás de interfaces de repositorio por módulo (ADR-0004), de
  modo que el ORM es sustituible módulo a módulo y no de golpe.

### C) Kysely / `node-pg-migrate` / SQL a mano — rechazada

Máximo control y cero magia, pero sin tipos derivados del esquema y con todo el
trabajo de consistencia a mano. Con 25+ entidades y varios autores
concurrentes, es la opción que más errores silenciosos produce.

### D) TypeORM — rechazada

`npm view typeorm version` devuelve `1.1.2`, un salto de major respecto de la
línea 0.3.x histórica. **No lo interpreto** porque no lo he investigado; sea
cual sea la razón, adoptar un ORM que acaba de cambiar de major sin que yo haya
verificado el porqué es exactamente el riesgo que este ADR intenta evitar.

### E) Sustituir PostgreSQL por SQLite para poder probar aquí — rechazada

Lo prohíbe el brief §2.1 y tiene razón: `jsonb`, índices parciales, tipos y
restricciones no se comportan igual. Un esquema validado en SQLite **no
demuestra nada** sobre producción. Además, como se demuestra arriba, **no hace
falta**: `prisma migrate diff` genera el DDL de PostgreSQL real sin motor.

## Consecuencias

**Positivas** — versiones pineadas y verificadas; migraciones en SQL legible y
revisable; esquema troceado por dueño; `prisma validate` y `migrate diff`
ejecutables hoy sin infraestructura; guardia de CI contra la regresión de la RC.

**Negativas, asumidas** — Prisma 7 obliga a `prisma.config.ts` y a un driver
adapter, una forma nueva con menos ejemplos en circulación; el binario del
schema engine debe poder descargarse en CI; quedamos un major por detrás del
`latest` publicado, que es deliberado; `typescript` se queda en `6.0.3` por el
peer de `@nestjs/swagger`.

## Verificación

| Qué | Cómo se demuestra | Estado |
| --- | --- | --- |
| `latest` de `prisma` es una RC | `npm view prisma dist-tags --json` | **[VERIFICADO]** |
| Última estable = 7.10.0 en CLI y cliente | dist-tags `prev` / `latest` | **[VERIFICADO]** |
| Prisma 7.10.0 funciona en Node 24 sin root | `npx prisma --version` | **[VERIFICADO]** |
| Esquema multi-fichero válido | `prisma validate --schema ./prisma/schema` → «The schemas at prisma/schema are valid 🚀» | **[VERIFICADO]** |
| DDL PostgreSQL generable sin base de datos | `prisma migrate diff --from-empty --to-schema --script` | **[VERIFICADO]** |
| TS 7 rompe el stack; techo 6.0.3 | `ERESOLVE` reproducido | **[VERIFICADO]** |
| Guardia anti-RC | `scripts/check-prisma-pin.mjs` en CI | [ESCRITO] — Fase 1 |
| Migración **aplicada** contra PostgreSQL 17 | `prisma migrate deploy` + `\d+` | **[NO VERIFICADO]** — no hay PostgreSQL |
| `PrismaClient` con driver adapter consulta datos | prueba de integración | **[NO VERIFICADO]** — no hay PostgreSQL |
| Persistencia tras reinicio (§20.21) | reinicio de Compose con volumen | **[NO VERIFICADO]** — no hay Docker |
