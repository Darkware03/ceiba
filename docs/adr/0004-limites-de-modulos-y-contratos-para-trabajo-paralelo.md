# ADR-0004 — Límites de módulos y contratos para trabajo paralelo

- **Estado:** Aceptada
- **Fecha:** 2026-10-14
- **Decide:** `software-architect`
- **Ámbito:** 4.A.4 del `BRIEF.md`; §22 del `PROMPT-MAESTRO.md`
- **Depende de:** ADR-0001, ADR-0002, ADR-0003

## Contexto

El prompt maestro cierra la §22 con una frase que es un requisito de
arquitectura, no un consejo de proceso:

> Puedes desarrollar módulos independientes en paralelo si sus contratos están
> definidos. **No permitas que varios agentes modifiquen simultáneamente los
> mismos archivos sin coordinación.**

Y el `BRIEF.md` §3.2 ya describe el daño concreto: compañeros con trabajo a
medias en el mismo árbol, prohibición de `git add -A`, prohibición de cambiar de
rama. Esto no es hipotético: **mientras escribía este ADR, otros tres agentes
estaban escribiendo en este mismo repositorio.**

Así que el objetivo no es «modularidad» en abstracto. Es una propiedad medible:

> **Dos agentes trabajando a la vez en dos capacidades distintas no deben tener
> que editar ningún fichero en común.**

Y donde eso sea imposible, hay que **nombrar** los ficheros compartidos y darles
un protocolo. Un diseño que afirme tener cero ficheros compartidos está
mintiendo; lo honesto es reducirlos a un puñado y hacerlos triviales de fusionar.

## Decisión

### 1. Partición por capacidad, no por capa

Nada de `controllers/`, `services/`, `repositories/` a nivel global: esa
partición garantiza que **todos** los agentes tocan **todas** las carpetas. Se
parte por capacidad vertical, igual que el `BRIEF.md` §4 reparte ámbitos.

```
apps/api/src/
  main.ts                     ← arranque.                     DUEÑO: integrador
  app.module.ts               ← COSTURA (ver §3)
  platform/                   ← infraestructura compartida.    DUEÑO: integrador
    config/      prisma/      redis/      logging/
    auth/        guards/      pagination/ errors/
  modules/
    identity/     workspace/    collection/   environment/
    execution/    importexport/ sharing/      testing/
    collab/       audit/        files/        ai/
```

Cada módulo es un directorio **autocontenido**:

```
modules/<capacidad>/
  <capacidad>.module.ts        ← NestJS @Module
  <capacidad>.controller.ts    ← rutas REST
  <capacidad>.service.ts       ← lógica
  <capacidad>.repository.ts    ← único punto que toca Prisma de este módulo
  <capacidad>.public.ts        ← ⭐ SUPERFICIE PÚBLICA. Lo único importable desde fuera.
  dto/                         ← DTO derivados de packages/contracts
  __tests__/
```

### 2. La regla dura: `*.public.ts` y nada más

**Un módulo sólo puede importar de otro módulo a través de su `*.public.ts`.**
Cualquier import profundo (`modules/workspace/workspace.repository`) es un
error de lint, no una cuestión de estilo.

```jsonc
// eslint.config.js — regla ejecutable, no una convención escrita en un README
"no-restricted-imports": ["error", { "patterns": [
  { "group": ["**/modules/*/!(*.public)"],
    "message": "Importa sólo desde <modulo>.public.ts. Ver ADR-0004." },
  { "group": ["**/platform/prisma/*"],
    "message": "Sólo el repositorio del propio módulo accede a Prisma. Ver ADR-0004." }
]}]
```

Esto convierte el límite en algo que **falla en CI**. Un límite que no falla no
es un límite: es una sugerencia, y las sugerencias no sobreviven a la prisa.

`<capacidad>.public.ts` exporta **sólo**: el `@Module`, interfaces de puerto y
tipos. **Nunca** repositorios, nunca entidades de Prisma, nunca utilidades
internas.

### 3. Ficheros de costura: los nombro y les doy protocolo

Hay exactamente **seis** ficheros que varios autores necesitan tocar. No lo
disimulo; lo acoto.

| Fichero | Qué se añade | Protocolo |
| --- | --- | --- |
| `apps/api/src/app.module.ts` | **una línea** en `imports[]` | append, orden alfabético |
| `packages/contracts/src/index.ts` | **una línea** `export *` | append, orden alfabético |
| `apps/web/src/router/routes.ts` | **una línea** `...<feature>Routes` | append, orden alfabético |
| `apps/web/src/stores/index.ts` | **una línea** de export | append, orden alfabético |
| `.env.example` | **un bloque** al final de su sección | append, nunca renombrar lo existente |
| `prisma/schema/<modulo>.prisma` | fichero propio por módulo | **no es costura**: un dueño cada uno |

**Protocolo de costura, vinculante:**

1. **Sólo se añade.** Nunca se reordena, nunca se reformatea, nunca se «limpia»
   un fichero de costura en el mismo cambio en que se añade una línea.
2. **Orden alfabético**, para que dos adiciones distintas caigan en líneas
   distintas.
3. **Resolución de conflictos = unión.** Si git marca conflicto en una costura,
   la resolución correcta es **quedarse con las dos líneas**. Siempre. Si
   alguna vez no lo es, el cambio no era una adición y no debía ir ahí.
4. **Una línea por módulo.** Si una integración necesita cinco líneas en
   `app.module.ts`, está mal diseñada: debe envolverse en un
   `forRoot()`/`register()` dentro del propio módulo.

Nada de esto requiere una herramienta: requiere que esté escrito y que se
respete. Por eso está aquí y no en un comentario del código.

### 4. `packages/contracts` se escribe **primero**, y tiene un solo dueño

Esquemas Zod + tipos derivados. **Fuente única de verdad** para los DTO REST,
los eventos WebSocket y el contrato con el motor (ADR-0002).

```
packages/contracts/src/
  engine/      ← ADR-0002: ExecuteRequest, ExecuteResponse, ErrorCode
  rest/        ← un fichero por capacidad: workspace.ts, collection.ts, …
  realtime/    ← ADR-0005: eventos y payloads
  variables/   ← ADR-0006: ámbitos y resultado de resolución
  index.ts     ← COSTURA
```

Regla de secuencia, y es la que hace posible el paralelismo:

> **El contrato de una capacidad se acuerda y se mergea ANTES de que empiece la
> implementación de esa capacidad.** Primero el fichero en
> `packages/contracts/src/rest/<capacidad>.ts`; después, en paralelo, el
> backend contra ese tipo y el frontend contra ese mismo tipo.

Sin esto, «trabajo en paralelo» significa «dos agentes inventando el mismo JSON
de dos formas distintas y descubriéndolo al integrar».

**Versionado:** los contratos son aditivos. Un cambio incompatible crea
`v2` junto al `v1`; no se edita el `v1` publicado. El prefijo `/api/v1` del §19
del prompt maestro se corresponde con `contracts/rest` v1.

### 5. Comunicación entre módulos: tres vías, en este orden

1. **Puerto síncrono** — el módulo A importa una interfaz del `*.public.ts` de
   B y la recibe por DI. Para consultas que A necesita *ahora*
   (`CollectionModule` preguntando a `WorkspaceModule` si el usuario puede
   leer). Acoplamiento explícito y tipado.
2. **Evento de dominio** — `EventEmitter2` en proceso. Para notificar sin
   esperar respuesta (`collection.updated` → `collab` emite por WebSocket,
   `audit` registra). **El emisor no sabe quién escucha.** Es la vía por defecto
   para todo lo transversal: auditoría, notificaciones, tiempo real.
3. **Cola** — BullMQ, para trabajo diferido o largo (ejecución de colección,
   importación de un OpenAPI grande, trabajos programados).

**Prohibido:** que un módulo lea las tablas de otro. El acceso a datos de una
entidad pasa **siempre** por el repositorio del módulo dueño de esa entidad. Si
`sharing` necesita datos de una colección, pregunta a `collection.public.ts`;
no hace un `prisma.collection.findMany()`.

Eso es lo que mantiene ejecutable la decisión de sustituir el ORM módulo a
módulo (ADR-0003, alternativa B).

### 6. Mapa de propiedad — quién escribe dónde

Disjunto por capacidad, como el `BRIEF.md` §4. Las entidades del §17 del prompt
maestro quedan repartidas sin solapamiento:

| Módulo | Entidades (§17) | Endpoints (§19) | Depende de (público) |
| --- | --- | --- | --- |
| `platform` | — | — | — |
| `identity` | Users, Sessions, Invitations | Autenticación, Usuarios | `platform` |
| `workspace` | Workspaces, WorkspaceMembers, Projects | Workspaces, Miembros | `identity` |
| `collection` | Collections, CollectionFolders, ApiRequests, RequestHeaders, RequestParams, RequestBodies, CollectionVersions | Colecciones, Carpetas, Solicitudes, Versiones | `workspace` |
| `environment` | Environments, EnvironmentVariables, AuthConfigurations | Entornos, Variables | `workspace` |
| `execution` | RequestHistory, CollectionRuns | Ejecuciones, Historial | `collection`, `environment` |
| `importexport` | — | Importación, Exportación | `collection` |
| `sharing` | SharedLinks, ShareAccessCodes | Compartición, Validación de códigos | `collection` |
| `testing` | TestDefinitions, TestRuns | Tests | `execution` |
| `collab` | Comments, Notifications | Notificaciones | `workspace` |
| `audit` | AuditLogs | Auditoría | — (sólo escucha eventos) |
| `files` | Files | — | `platform` |
| `ai` | — | — | `collection` |

El grafo de dependencias **no tiene ciclos** y es poco profundo:
`platform → identity → workspace → collection → {execution, sharing,
importexport}`. `audit` no depende de nadie: sólo consume eventos. `ai` es una
hoja, y **arranca desactivado** (`CEIBA_AI_ENABLED=false` en el `.env.example`
ya commiteado), lo que hace verificable el requisito 22 de la §20 («la
plataforma funcione sin el proveedor de IA»): se comprueba arrancando con el
`.env.example` tal cual.

> La asignación de entidades es **mi partición de módulos**, no el modelo de
> datos. El esquema lo define `database-engineer` en `MODELO-DATOS.md`
> (ámbito 4.B). Si su modelo difiere, **manda el suyo** y esta tabla se ajusta.

### 7. Paquetes puros: el paralelismo más barato

`packages/variables`, `packages/importers`, `packages/exporters` son **puros**:
sin red, sin base de datos, sin `process.env`.

Esa pureza tiene una consecuencia práctica que vale más que la elegancia:
**son los únicos entregables que hoy, en este contenedor y sin PostgreSQL ni
Redis, pueden pasar de [ESCRITO] a [VERIFICADO]**. Un agente puede construir
entero el parser de Postman v2.1 con sus pruebas reales mientras otro ni ha
levantado la base de datos.

Por eso el plan de fases (ADR-0007) los adelanta todo lo posible.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
| --- | --- |
| Partición por capa (`controllers/`, `services/`) | Garantiza que todos los agentes tocan todas las carpetas. Es justo el problema. |
| Un repositorio por módulo (poly-repo) | Versionado cruzado y despliegue coordinado para un equipo que hoy trabaja en un solo árbol. Coste muy superior al beneficio. |
| Monolito sin límites internos, «ya refactorizaremos» | Con autores concurrentes, los límites no emergen solos: emergen los atajos. |
| Microservicios por capacidad | Sobredimensionado. La única separación que la seguridad **exige** es el motor (ADR-0002), y ya está hecha. |
| Tipos duplicados en front y back | Divergen. Por eso `packages/contracts` es obligatorio y único. |

## Consecuencias

**Positivas** — dos agentes en dos capacidades no comparten fichero; los
límites fallan en CI; los contratos preceden a la implementación; el grafo sin
ciclos permite construir y probar un módulo sin levantar el resto.

**Negativas, asumidas** — más ficheros por capacidad (el `*.public.ts` es
burocracia real); los seis ficheros de costura siguen necesitando disciplina
humana; escribir el contrato antes frena el arranque de cada capacidad, y es
deliberado.

## Verificación

| Qué | Cómo se demuestra | Estado |
| --- | --- | --- |
| No hay imports profundos entre módulos | `pnpm lint` falla con `no-restricted-imports` | [ESCRITO] — Fase 1, **ejecutable sin infraestructura** |
| No hay ciclos entre módulos | `madge --circular` (o equivalente) en CI | [ESCRITO] — Fase 1 |
| Ningún módulo toca tablas ajenas | prueba que recorre cada `*.repository.ts` y comprueba que sólo usa los modelos de su módulo | [ESCRITO] — Fase 1 |
| Toda ruta tiene guard de autorización | recorrido del `RouterExplorer` (ADR-0001) | [ESCRITO] — Fase 1 |
| Los contratos son la única fuente de DTO | los DTO se derivan de Zod; un tipo divergente no compila | [ESCRITO] — Fase 1 |
| La plataforma arranca sin IA | arranque con `CEIBA_AI_ENABLED=false` + prueba de humo | [NO VERIFICADO] — necesita base de datos |
