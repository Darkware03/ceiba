# ADR-0001 — NestJS como framework de la API, sobre adaptador Fastify

- **Estado:** Aceptada
- **Fecha:** 2026-10-14
- **Decide:** `software-architect`
- **Ámbito:** 4.A.1 del `BRIEF.md`; §3 «Backend» del `PROMPT-MAESTRO.md`
- **Afecta a:** `apps/api`, `apps/engine`

## Contexto

El `PROMPT-MAESTRO.md` §3 dice literalmente:

> NestJS o Fastify con una arquitectura modular. Selecciona una opción y
> mantenla de forma consistente.

Es una elección obligada y excluyente. El brief §4.A.1 lo repite: «Elige una y
ciérrala.»

Lo que el sistema tiene que sostener no es un servidor HTTP cualquiera:

- API REST versionada con ~19 familias de endpoints (§19 del prompt maestro).
- Autorización **por recurso**, con roles de workspace y permisos de enlace
  compartido, aplicada en servidor (prioridad 4 del cliente).
- WebSockets para colaboración (§5 del prompt maestro).
- Colas para ejecuciones largas y programadas (§3, §13).
- Documentación OpenAPI **de la propia API de CEIBA** (§19).
- Varios agentes escribiendo módulos **en paralelo sin tocar los mismos
  ficheros** (§22 final y §4.A.4 del brief).

Ese último punto es el que decide. La restricción dominante de este proyecto no
es la latencia: es la **coordinación entre autores concurrentes**.

## Versiones comprobadas [VERIFICADO]

Ejecutado por mí el 2026-10-14 en este contenedor:

```
$ npm view @nestjs/core version
12.1.3
$ npm view @nestjs/platform-fastify version
12.1.3
$ npm view fastify version
5.12.7
```

Coincide con el `BRIEF.md` §2.2 (`@nestjs/core 12.1.3`). NestJS 12 es estable,
no RC.

## Decisión

**`apps/api` se construye con NestJS 12, usando el adaptador
`@nestjs/platform-fastify` en lugar de Express.**

Como corolario inseparable (y esto es lo que hace honesta a la decisión):

**`apps/engine` NO usa NestJS. Usa Fastify a secas.** Ver ADR-0002.

No es un empate salomónico. Son dos procesos con dos problemas distintos:

| | `apps/api` | `apps/engine` |
| --- | --- | --- |
| Problema dominante | organización, autorización, muchos autores | aislamiento, superficie mínima |
| Nº de endpoints | ~19 familias, decenas de rutas | **3 rutas** |
| Framework | NestJS 12 (+ Fastify adapter) | Fastify 5 desnudo |
| Dependencias | muchas, por diseño | las mínimas, por diseño |

## Justificación

### Por qué NestJS en la API

1. **La modularidad es estructural, no una convención escrita en un README.**
   Un `@Module` con `imports`/`providers`/`exports` convierte «no toques mi
   código» en un error de compilación. Con Fastify desnudo, los límites entre
   módulos son acuerdos de caballeros, y los acuerdos de caballeros entre
   agentes concurrentes duran hasta el primer `import` cómodo. Esto ataca
   directamente el §4.A.4 del brief.

2. **Un fichero por recurso, y los agentes no colisionan.** El árbol
   `modules/<dominio>/{controller,service,module,dto}.ts` da un mapa de
   propiedad trivial de repartir (ver ADR-0004). Con Fastify, el registro de
   rutas tiende a concentrarse en ficheros compartidos (`app.ts`,
   `routes/index.ts`) que se convierten en zona de conflictos de merge
   permanente. Lo he visto romper más entregas que cualquier problema de
   rendimiento.

3. **Autorización por recurso con `Guard` + metadatos.** El requisito «no
   permitas que conocer un ID sea suficiente para acceder a un recurso privado»
   (§19) se implementa como un guard transversal declarado por decorador, no
   como un `if` que alguien olvidará en la ruta nueva. **Que el control sea
   declarativo es lo que permite escribir una prueba que recorra todas las rutas
   y falle si alguna carece de guard.** Un control que no se puede enumerar no
   se puede auditar.

4. **OpenAPI generado desde el código.** `@nestjs/swagger` deriva el documento
   de los DTO y decoradores. El §19 exige documentación OpenAPI de la propia
   API; con Fastify existe `@fastify/swagger`, pero obliga a escribir el esquema
   JSON a mano junto a cada ruta, lo que en la práctica se desincroniza del
   código en la segunda semana.

5. **Inyección de dependencias = pruebas sin infraestructura.** Aquí no hay
   PostgreSQL ni Redis. La DI permite sustituir repositorios y el cliente del
   motor por dobles y **ejecutar de verdad** las pruebas de lógica de permisos
   en este contenedor, que es exactamente lo que el `BRIEF.md` §2.1 pide que se
   ejecute. Con Fastify se puede hacer, pero cada autor inventa su propio
   mecanismo de inyección y las pruebas dejan de parecerse entre sí.

6. **WebSockets y colas tienen integración de primera clase.**
   `@nestjs/websockets` + `@nestjs/platform-socket.io` y los procesadores de
   BullMQ viven en el mismo contenedor de DI que los servicios, y por tanto
   **reutilizan el mismo código de autorización** en vez de reimplementarlo.
   La §5 del prompt maestro exige «revalidación de permisos en cada operación»
   también por WebSocket: si el guard es el mismo objeto, es el mismo
   comportamiento; si son dos implementaciones, divergen.

### Por qué el adaptador Fastify y no Express

- Express es el adaptador por defecto de Nest y es el camino de menor
  resistencia, pero Fastify tiene mejor rendimiento de serialización y un
  parseo de cuerpos más estricto. **[NO VERIFICADO]** — no he medido
  rendimiento en este contenedor y no voy a citar cifras de terceros como si
  fueran mías.
- El argumento que sí sostengo sin medir nada: usar Fastify en los **dos**
  procesos reduce a uno el número de pilas HTTP que el equipo debe conocer,
  depurar y endurecer. Los límites de cuerpo, el manejo de `multipart` y el
  comportamiento ante cabeceras malformadas se razonan una sola vez.
- Riesgo asumido: algunos middlewares del ecosistema Express no tienen
  equivalente Fastify. Mitigación: la API no depende de ningún middleware de
  terceros crítico; los dos que importan (`@fastify/helmet`,
  `@fastify/multipart`) existen en el ecosistema Fastify. **[NO VERIFICADO]** —
  no he instalado la API todavía; la verificación cae en la Fase 1 (§9).

## Alternativas consideradas y por qué se rechazan

### A) Fastify desnudo en toda la plataforma

- **A favor:** menos dependencias, arranque más rápido, menos magia,
  sin `reflect-metadata` ni decoradores.
- **En contra, y es decisivo:** no aporta límites de módulo exigibles. Con
  varios agentes concurrentes, el registro de rutas y los *hooks* globales se
  convierten en ficheros compartidos de alta contención. Además, replicar
  guards, DTO validados y generación OpenAPI acaba produciendo **un mini-Nest
  casero y sin documentar**, que es el peor resultado posible: la complejidad de
  Nest sin su comunidad ni su documentación.
- **Dónde sí gana, y por eso se usa:** en el motor (ADR-0002), donde hay 3 rutas
  y lo que se quiere es superficie mínima.

### B) NestJS con adaptador Express

- Rechazada por coherencia: obligaría a dominar dos pilas HTTP distintas
  (Express en la API, Fastify en el motor) sin ninguna ventaja compensatoria.

### C) NestJS monolítico, con el motor HTTP dentro

- Rechazada en el ADR-0002. Es un problema de aislamiento, no de framework.

## Consecuencias

**Positivas**

- El reparto de trabajo entre agentes se vuelve mecánico (ADR-0004).
- La autorización es declarativa, enumerable y por tanto auditable.
- El OpenAPI de la §19 se mantiene solo.
- Las pruebas de permisos se ejecutan sin infraestructura.

**Negativas, y las acepto**

- NestJS arrastra `reflect-metadata`, `rxjs` y decoradores. Requiere
  `experimentalDecorators` y `emitDecoratorMetadata` en `tsconfig`, lo que
  limita el uso de transpiladores que no soportan metadatos de decoradores
  (afecta a la elección de *runner* de pruebas: se usa el que funcione con ese
  `tsconfig`, verificable en Fase 1).
- Mayor tiempo de arranque en frío que Fastify desnudo. Irrelevante para un
  servicio de larga vida; **relevante si alguien intentara desplegar la API en
  una función serverless, cosa que esta arquitectura no contempla**.
- Curva de aprendizaje para quien no conozca Nest. Mitigada porque el ADR-0004
  fija la forma exacta de cada módulo.

## Cumplimiento del prompt maestro

- §3 «NestJS o Fastify […] Selecciona una opción y mantenla»: **cumplido**. La
  API es NestJS y no se mezcla. El motor usa Fastify **porque es otro servicio
  con otro contrato**, no por inconsistencia; queda registrado aquí y en
  ADR-0002 para que no se lea como una desviación silenciosa.
- §3 «No introduzcas Laravel, PHP u otros lenguajes»: **cumplido**, todo
  TypeScript sobre Node 24.

## Verificación

| Qué | Cómo se demuestra | Estado |
| --- | --- | --- |
| Versiones existen y son estables | `npm view @nestjs/core version` → `12.1.3` | **[VERIFICADO]** |
| Nest 12 + Fastify 5 resuelven juntos | `pnpm install` en `apps/api` sin `ERESOLVE` | [NO VERIFICADO] — Fase 1 |
| Toda ruta tiene guard | prueba que recorre el `RouterExplorer` y falla si falta | [ESCRITO] — Fase 1 |
| OpenAPI se genera | arrancar y comparar el JSON con un *snapshot* versionado | [ESCRITO] — Fase 1 |
