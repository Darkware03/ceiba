# ADR-0008 — Cadena de herramientas y política de fijación de versiones

- **Estado:** Aceptada
- **Fecha:** 2026-10-14
- **Decide:** `software-architect`
- **Ámbito:** §3 del `PROMPT-MAESTRO.md` («Usa versiones estables y compatibles entre sí. Verifica las versiones disponibles antes de fijarlas»)
- **Relacionada con:** ADR-0003 (el caso Prisma)

## Contexto

El `BRIEF.md` §2.2 lista versiones del registro y advierte: «No las fijes a
ciegas: comprueba la compatibilidad entre ellas». Lo hice. **Tres de las
combinaciones por defecto están rotas**, y ninguna de las tres la detecta un
`pnpm install` que acabe en verde.

Todo lo de este ADR se ejecutó en este contenedor el 2026-10-14 contra
`registry.npmjs.org`, en directorios temporales fuera del repositorio.

## Hallazgo 1 — TypeScript 7 rompe el proyecto por los dos extremos [VERIFICADO]

`npm view typescript version` → **`7.0.2`**. Es el `latest`. Y no sirve.

**Backend.** `@nestjs/swagger@12.0.2` declara
`peerDependencies.typescript = "^5.5.0 || ^6.0.0"`:

```
npm error code ERESOLVE
npm error While resolving: @nestjs/swagger@12.0.2
npm error Found: typescript@7.0.2
npm error Could not resolve dependency:
npm error peerOptional typescript@"^5.5.0 || ^6.0.0" from @nestjs/swagger@12.0.2
npm error Conflicting peer dependency: typescript@6.0.3
```

**Frontend.** Aquí es peor, porque **npm no se queja**: `vue-tsc@3.3.13` declara
`peer typescript >=5.0.0`, que TS 7 satisface. La instalación termina en verde y
el fallo aparece al *ejecutar* el type-check:

```
TS7_VUE_TSC_EXIT=1
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './lib/tsc' is not defined
by "exports" in .../node_modules/typescript/package.json
```

TypeScript 7 (el puerto nativo) ya no expone `./lib/tsc`, que `vue-tsc` 3.x
necesita. No hay una versión de `vue-tsc` que lo soporte:
`vue-tsc dist-tags = { "v3.0": "3.0.11", "latest": "3.3.13" }`.

**Son dos equipos distintos, con dos mecanismos de fallo distintos, llegando al
mismo techo.** Eso es lo que convierte esto en una decisión de arquitectura y no
en una anécdota de instalación.

### Decisión: **TypeScript `~6.0.3` en todo el monorepo, sin excepciones**

Rango `~` (parches sí, minors no, **nunca** salto a 7.x). Satisface además
`typescript >= 5.4.0` de `@prisma/client@7.10.0` y `typescript >= 5.6.0` de
`pinia@4.1.0`. Verificado funcionando: `vue-tsc --noEmit` con TS 6.0.3 → **0
errores, exit 0**.

La versión de TypeScript se declara **una sola vez en la raíz** del monorepo.
Ningún paquete la redeclara: con varios autores, dos versiones de TS en el árbol
producen errores de tipos que no se reproducen en la máquina del vecino.

## Hallazgo 2 — `prisma@latest` es una RC y el desajuste es silencioso [VERIFICADO]

Tratado en profundidad en **ADR-0003**. Resumen: `prisma@latest` =
`8.0.0-rc.22`, `@prisma/client@latest` = `7.10.0`; `latest` + `latest` instala
majors cruzados **sin error**, porque `@prisma/client` declara
`peerDependencies = { prisma: "*" }`. Se pinean ambos a `7.10.0` exacto.

## Hallazgo 3 — Doble instancia de Fastify [VERIFICADO]

`@nestjs/platform-fastify@12.1.3` trae Fastify como **dependencia normal con
versión exacta**, no como peer:

```
dependencies = { fastify: '5.12.5', '@fastify/cors': '11.3.1', '@fastify/middie': '9.3.5', … }
```

Declarar `fastify` en la raíz de `apps/api` produce dos instancias en el árbol:

```
+-- @nestjs/platform-fastify@12.1.3
| `-- fastify@5.12.5
`-- fastify@5.12.7
```

Dos instancias de Fastify significan que un plugin o un `decorate` registrado en
una **no existe** en la otra. Es un fallo en tiempo de ejecución, intermitente y
muy caro de diagnosticar.

### Decisión

**`apps/api` NO declara `fastify` como dependencia directa.** Usa la que trae
`@nestjs/platform-fastify`. Si hiciera falta declararla (por tipos), se pinea a
la versión exacta que empaqueta el adaptador (`5.12.5` hoy) y se añade una nota
al `package.json` apuntando a este ADR.

`apps/engine` **sí** declara `fastify` directamente (`5.12.7`), porque no usa
NestJS y es su único dueño. Son árboles de dependencias separados: no colisionan.

## Hallazgo 4 — Este contenedor omite devDependencies en silencio [VERIFICADO]

El entorno tiene `NODE_ENV=production` y `npm config omit=dev`. Un
`npm install` sin `--include=dev` **instala las dependencias de producción y
deja `vitest`, `vue-tsc` y `@vitejs/plugin-vue` como UNMET, sin error visible**.

Esto no es un detalle del contenedor: es exactamente lo que pasa en un
`Dockerfile` de producción mal escrito, y produce un CI que «pasa» porque nunca
llegó a ejecutar las pruebas.

### Decisión

- Los scripts de CI y los `Dockerfile` de etapa de build usan
  `pnpm install --frozen-lockfile --prod=false` de forma **explícita**.
- La verificación de la Fase 1 incluye una comprobación que **falla si el runner
  de pruebas no está instalado**, en lugar de saltarse las pruebas.

## Hallazgo 5 — PrimeVue 5 necesita el paquete de temas aparte, y arrastra un gestor de licencias [VERIFICADO]

`primevue@5.0.2` **no** incluye `@primeuix/themes` en su árbol de dependencias:

```
=== does primevue dep tree include @primeuix/themes? ===
NO '@primeuix/themes' IN primevue@5.0.2 dependencies
```

Hay que instalarlo explícitamente (`@primeuix/themes@3.0.1`) e iconos
(`primeicons@8.0.2`). Verificado compilando: `import Aura from
'@primeuix/themes/aura'` + `app.use(PrimeVue, { theme: { preset: Aura } })`
construye sin errores.

**Riesgo abierto, y lo señalo porque no es mío resolverlo:** `primevue@5.0.2`
trae `@primeui/license-manager@1.1.0` como **dependencia directa**. No he
investigado el modelo de licencia de PrimeVue 5 y **no voy a especular sobre
él**. Es una decisión de producto y legal, no de arquitectura. Ver HUECOS en
`ARQUITECTURA.md` §11.

Nota de marca: la biblioteca de componentes **no sustituye a `@ceiba/brand`**.
El `BRIEF.md` §1 es explícito: las pantallas de carga usan `CeibaLoadingScreen`
/ `CeibaSpinner`, **no el spinner de PrimeVue**. El tema de PrimeVue se somete a
los tokens de `packages/brand/src/tokens.css`.

## Hallazgo 6 — pnpm del repositorio ≠ pnpm del contenedor [VERIFICADO]

| Fuente | Valor |
| --- | --- |
| `package.json` → `packageManager` | `pnpm@9.15.4` |
| `package.json` → `engines.pnpm` | `>=9.12.0` |
| `pnpm -v` aquí | **`12.5.1`** |

`packageManager` es el campo que Corepack usa para **forzar** una versión. Con
Corepack activo se descargaría pnpm 9.15.4 ignorando el 12.5.1 instalado; sin
Corepack, pnpm 12.5.1 ejecuta y `>=9.12.0` lo admite. Las dos rutas generan
lockfiles de formato distinto, y con varios agentes instalando a la vez eso
destruye la reproducibilidad.

### Decisión

Unificar en la versión que realmente hay: `"packageManager": "pnpm@12.5.1"` y
`"engines": { "pnpm": ">=12.0.0" }`.

**No lo aplico yo:** el `package.json` raíz está fuera de mi ámbito de escritura
(`BRIEF.md` §4.A). Queda como instrucción de dos líneas para quien lo posea.

## Hallazgo 7 — mínimo real de Node: **24.15.0**, no 22.12 [VERIFICADO]

`engines` que impone cada pieza:

```
vite@8.3.4          ^20.19.0 || >=22.12.0
vitest@5.0.4        ^22.12.0 || ^24.0.0 || >=26.0.0
jsdom@30.1.2        ^22.22.2 || ^24.15.0 || >=26.0.0   ← el más restrictivo
undici@8.12.1       >=22.19.0
prisma@7.10.0       ^20.19 || ^22.12 || >=24.0
isolated-vm@7.0.1   >=24.0.0
@nestjs/core@12.1.3 >= 20
```

El mínimo efectivo lo marca `jsdom@30.1.2`: **Node >= 24.15.0**. El
`package.json` raíz declara hoy `>=22.12.0`, que es **demasiado permisivo**:
admite Node 23.x, que `prisma@7.10.0` excluye explícitamente
(`^20.19 || ^22.12 || >=24.0`). Node de este contenedor: `v24.21.0`, cumple todo.

**Recomendación:** subir `engines.node` a `>=24.15.0`. Tampoco lo aplico yo.

## Versiones fijadas (todas comprobadas contra el registro el 2026-10-14)

### Backend — `apps/api`

| Paquete | Versión | Nota |
| --- | --- | --- |
| `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-fastify`, `@nestjs/websockets`, `@nestjs/platform-socket.io`, `@nestjs/testing` | `12.1.3` | |
| `@nestjs/swagger` | `12.0.2` | impone el techo de TS |
| `@nestjs/config` | `12.0.1` | |
| `fastify` | **no declarar** | viene `5.12.5` del adaptador (Hallazgo 3) |
| `prisma` / `@prisma/client` | `7.10.0` **exacto** | ADR-0003 |
| `rxjs` | `7.8.2` | Nest 12 exige `^7.1.0`; **rxjs 8 no es opción** |
| `reflect-metadata` | `0.2.2` | |
| `bullmq` | `6.3.15` | peer `ioredis >=5.0.0` |
| `ioredis` | `6.0.0` | |
| `socket.io` | `4.8.4` | |
| `@socket.io/redis-adapter` | `8.3.0` | peer real: `socket.io-adapter ^2.5.4` |
| `zod` | `4.6.7` | |
| `pino` | `10.4.0` | |
| `argon2` | `0.45.1` | **compila nativo** (`node-gyp-build`) |
| `supertest` | `7.3.1` | |

### Motor — `apps/engine`

| Paquete | Versión |
| --- | --- |
| `fastify` | `5.12.7` (dueño único, sin Nest) |
| `undici` | `8.12.1` |
| `zod` | `4.6.7` |
| `pino` | `10.4.0` |

Sandbox de scripts: **lo elige `appsec-engineer`**. Datos medidos, sin
recomendación mía: `isolated-vm@7.0.1` (`engines: node >=24.0.0`, `gypfile:
true`, compila nativo, sin restricción de `os`/`cpu`, no deprecado);
`quickjs-emscripten@0.32.0` (WASM puro, `engines: node >=16`, sin build nativo);
`vm2@3.12.2` (65 de sus 83 versiones llevan flag `deprecated` con el mensaje
«The library contains critical security issues and should not be used for
production! […] Consider migrating your code to isolated-vm», pero **las 18 más
recientes no lo llevan** y `npm view vm2 deprecated` sobre `latest` devuelve
vacío).

### Frontend — `apps/web` [VERIFICADO end-to-end]

| Paquete | Versión |
| --- | --- |
| `vue` | `^3.5.44` |
| `vue-router` | `^5.4.0` |
| `pinia` | `^4.1.0` |
| `primevue` | `^5.0.2` |
| `@primeuix/themes` | `^3.0.1` |
| `primeicons` | `^8.0.2` |
| `monaco-editor` | `^0.57.0` |
| `socket.io-client` | `^4.8.4` |
| `vite` | `^8.3.4` |
| `@vitejs/plugin-vue` | `^6.0.10` |
| `typescript` | `~6.0.3` |
| `vue-tsc` | `^3.3.13` |
| `vitest` / `@vitest/coverage-v8` | `5.0.4` **exacto en ambos** |
| `jsdom` | `^30.1.2` |
| `@playwright/test` | `^1.64.1` |

Detalles que no se adivinan y cuestan una tarde cada uno:

- `@vitest/coverage-v8` declara `peer vitest: "5.0.4"` **exacto**. Se mueven
  juntos y sin `^`.
- `pinia@4.1.0` declara `@vue/devtools-api ^8.2.1` como peer **no opcional**.
  npm lo resuelve solo; con pnpm estricto hay que declararlo.
- Si `vite.config.ts` incluye bloque `test`, debe importar `defineConfig` de
  `vitest/config`, no de `vite`, o el type-check falla con `TS2769`.

## Compatibilidad vue 3.5.44 + vite 8.3.4 + pinia 4.1.0 — respuesta directa

El brief pedía comprobarlo. **Son compatibles, y no es sólo resolución de
dependencias: se construyó y se ejecutó.**

```
=== install ===        added 282 packages in 17s   (sin ERESOLVE, sin warnings de peer)
=== vue-tsc --noEmit ===  exit 0   (0 errores)
=== vite build ===        exit 0   ✓ 158 modules transformed  ✓ built in 361ms
                                   dist/assets/index-BARB-PNc.js 332.37 kB │ gzip: 83.37 kB
=== vitest run ===        exit 0   ✓ src/counter.test.ts (1 test)  Test Files 1 passed
```

`pinia@4.1.0` declara `peer vue ^3.5.11` → `3.5.44` entra.
`@vitejs/plugin-vue@6.0.10` declara `peer vite ^5||^6||^7||^8` → `8.3.4` entra.
`vue-router@5.4.0` declara `peer vue ^3.5.34 || ^4.0.0` → `3.5.44` entra.

**El único cambio obligatorio respecto de la lista del brief §2.2 es
TypeScript: `6.0.3`, no `7.0.2`.**

## Política de fijación (vinculante)

1. **Nada de `latest`, nunca.** El caso Prisma demuestra por qué.
2. **Versión exacta** (sin `^`) para: `prisma`, `@prisma/client`, `vitest`,
   `@vitest/coverage-v8`. Son los que tienen acoplamientos exactos o publicación
   poco fiable.
3. **`~` para `typescript`.** Parches sí, major jamás.
4. **`^` para el resto**, con `pnpm-lock.yaml` versionado y
   `--frozen-lockfile` en CI.
5. **Una sola versión de TypeScript en todo el monorepo**, declarada en la raíz.
6. **Toda subida de major pasa por un ADR.** Instalar y que no dé error **no es
   verificar**: el fallo de `vue-tsc` con TS 7 instalaba en verde.

## Verificación

| Qué | Cómo se demuestra | Estado |
| --- | --- | --- |
| Stack frontend instala, compila, tipa y pasa pruebas | `added 282 packages` · `vite build` exit 0 · `vue-tsc --noEmit` exit 0 · `vitest run` exit 0 | **[VERIFICADO]** |
| Stack backend instala sin `ERESOLVE` con TS 6.0.3 | `added 270 packages in 21s` | **[VERIFICADO]** |
| TS 7 rompe `@nestjs/swagger` | `ERESOLVE` literal | **[VERIFICADO]** |
| TS 7 rompe `vue-tsc` | `ERR_PACKAGE_PATH_NOT_EXPORTED` | **[VERIFICADO]** |
| Doble Fastify | árbol `npm ls fastify` | **[VERIFICADO]** |
| `prisma@latest` es RC | `npm view prisma dist-tags --json` | **[VERIFICADO]** |
| Compilación nativa de `argon2` / `isolated-vm` | — | **[NO VERIFICADO]** — el install se validó con `--ignore-scripts`; la *toolchain* nativa no se ejerció |
| Modelo de licencia de PrimeVue 5 | — | **[NO VERIFICADO]** — no investigado, no es decisión de arquitectura |
