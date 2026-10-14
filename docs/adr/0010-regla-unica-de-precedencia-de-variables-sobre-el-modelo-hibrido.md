# ADR-0010 — Regla única de precedencia de variables sobre el modelo híbrido

- **Estado:** Aceptada
- **Fecha:** 2026-10-14
- **Decide:** `software-architect`
- **Ámbito:** 3.A.2 del `BRIEF-FASE1.md`; decisión **C-23** del cliente; §12 del `PROMPT-MAESTRO.md`
- **Depende de:** ADR-0006 (define los seis ámbitos y el algoritmo), ADR-0002 (el motor recibe todo resuelto), ADR-0003, ADR-0004
- **Implementa:** `packages/variables` (paquete **puro**) + la carga de capas en `apps/api`
- **No sustituye al ADR-0006.** Lo **aterriza sobre el esquema real** y le añade lo que el
  esquema tiene y el ADR-0006 no podía conocer. Donde este ADR amplía al 0006, lo digo
  explícitamente en la §9.

## Contexto

La decisión **C-23** se aprobó **con enmienda**. Dice dos cosas, y las dos son vinculantes:

1. **Se conserva el modelo híbrido**: `scoped_variables` para los ámbitos persistentes +
   `environments`/`environment_variables` en tablas separadas.
   **Queda prohibida la reestructuración destructiva del esquema.**
2. Antes de implementar hay que **documentar y probar una regla única** de precedencia que
   cubra los **seis** niveles, **incluido el ámbito de ejecución efímero**.

El ADR-0006 dejó la precedencia cerrada en el plano lógico: seis ámbitos, prioridad
numérica, mayor gana, con siete ejemplos resueltos. Lo que no podía hacer es explicar cómo
se obtienen esos seis ámbitos de un esquema que **no los almacena en seis sitios
simétricos**. Ése es exactamente el hueco que cierra este ADR.

### Lo que verifiqué yo en el esquema, hoy

No lo doy por supuesto porque de ello depende toda la decisión. Comprobado sobre
`docs/schema/ceiba.dbml` el 2026-10-14:

| Hecho | Evidencia |
| --- | --- |
| El enum `variable_scope` tiene **cuatro** valores, no seis | `Enum variable_scope { global · workspace · collection · api_request }` (línea 198) |
| El ámbito **entorno** no está en ese enum | vive en `environments` (1072) + `environment_variables` (1107) |
| El ámbito **ejecución** no está en el esquema | no hay tabla; es efímero por diseño |
| El valor **local** es transversal a todos los ámbitos | `variable_local_values` (1143), con `environment_variable_id` **XOR** `scoped_variable_id` |
| `environment_variables` tiene **tres** columnas de valor | `initial_value`, `current_value`, + local en la tabla anterior |
| `scoped_variables` tiene **una** columna de valor | `value`, + local en la tabla anterior |

### El problema real, en una frase

`scoped_variables` **atraviesa** el nivel del entorno: suministra las prioridades
**10, 20, 30 y 50**, mientras que la **40** sale de otra tabla y la **60** no sale de
ninguna. No es «una consulta ordenada por `scope`»: es una **fusión de tres fuentes
heterogéneas** en un único orden total.

```
   fuente física                         prioridad lógica
   ─────────────────────────────────     ────────────────
   scoped_variables  (scope=global)      10  ┐
   scoped_variables  (scope=workspace)   20  │ una sola tabla…
   scoped_variables  (scope=collection)  30  │
   environment_variables (env activo)    40  ├─ …pero otra tabla se intercala aquí
   scoped_variables  (scope=api_request) 50  ┘
   efímero, en memoria                   61·62·63
```

Si ese entrelazado no se fija por escrito, cada implementación lo resolverá a su manera y
la precedencia dejará de ser inequívoca, que es justo lo que el §12 prohíbe.

## Decisión

### 1. Mapa físico: de dónde sale cada uno de los seis niveles

| Prioridad | Ámbito (ADR-0006) | Fuente física | Filtro obligatorio | Unicidad garantizada por |
| --- | --- | --- | --- | --- |
| **10** | `global` | `scoped_variables` | `scope='global'` | `uq_scopedvar_identity` |
| **20** | `workspace` | `scoped_variables` | `scope='workspace' AND workspace_id=:ws` | `uq_scopedvar_identity` |
| **30** | `collection` | `scoped_variables` | `scope='collection' AND collection_id=:col` | `uq_scopedvar_identity` |
| **40** | `environment` | `environment_variables` | `environment_id=:envActivo` | `uq_envvar_env_key` |
| **50** | `request` | `scoped_variables` | `scope='api_request' AND api_request_id=:req` | `uq_scopedvar_identity` |
| **61** | `execution` · sustitución de la llamada a la API | efímero | — | el resolutor |
| **62** | `execution` · fila del fichero de datos | efímero | — | el resolutor |
| **63** | `execution` · script *pre-request* | efímero | — | el resolutor |

El valor **local** no es un nivel: es un **eje perpendicular** que se une a cualquiera de
los cinco niveles persistentes por `variable_local_values`, filtrando siempre por
`user_id = :actor`.

### 2. La regla única

> **Una variable se resuelve eligiendo, entre todas las capas que la definen y la tienen
> habilitada, la de mayor prioridad; y dentro de esa capa —y sólo dentro de ella— se toma
> el primer valor que exista en el orden `local → current → compartido`.**

Todo lo demás de este ADR es la mecánica necesaria para que esa frase sea aplicable sobre
tres tablas distintas. La regla **no** cambia según la fuente: cambia la **proyección**
que lleva cada fuente a una forma común.

### 3. Normalización: la proyección canónica (la pieza que faltaba)

Las tres fuentes se proyectan a **una misma estructura** antes de ordenar. Ésta es la
razón por la que hay *una* regla y no tres:

```ts
interface Capa {
  priority: number          // 10 | 20 | 30 | 40 | 50 | 61 | 62 | 63
  scope: 'global'|'workspace'|'collection'|'environment'|'request'|'execution'
  origin: 'scoped_variables' | 'environment_variables' | 'efimero'
  defs: Map<string, Definicion>
}

interface Definicion {
  enabled: boolean                  // is_enabled de la FILA DE LA VARIABLE
  shared: string | null             // scoped_variables.value | environment_variables.initial_value
  current: string | null | undefined // environment_variables.current_value; `undefined` en scoped
  local: string | null | undefined  // variable_local_values.local_value; `undefined` si no hay fila
  localEnabled: boolean             // variable_local_values.is_enabled
  secretId: string | null           // secret_id de la FILA DE LA VARIABLE
  localSecretId: string | null | undefined // variable_local_values.secret_id
  valueKindEnum: VariableValueKind  // para detectar `secret`
}
```

> **Convenio de los tres estados, porque se va a implementar literal.** `undefined` = **la
> columna o la fila no existe** en esa fuente (p. ej. `current` en `scoped_variables`, o
> `local` cuando el usuario no tiene override). `null` = **la columna existe y vale NULL**.
> `""` = **cadena vacía definida**, que **gana** (ADR-0006 §3). Confundir `undefined` con
> `null` aquí cambia el resultado de los casos E-04 y E-06.

Correspondencia exacta, columna a columna:

| Campo canónico | desde `scoped_variables` | desde `environment_variables` | desde ejecución |
| --- | --- | --- | --- |
| `enabled` | `is_enabled` | `is_enabled` | siempre `true` |
| `shared` | `value` | `initial_value` | el valor en memoria |
| `current` | **no existe** → `undefined` | `current_value` | `undefined` |
| `local` | `variable_local_values.local_value` vía `scoped_variable_id` | ídem vía `environment_variable_id` | `undefined` |
| `localEnabled` | `variable_local_values.is_enabled` | ídem | `false` |
| `secretId` | `secret_id` | `secret_id` | `null` |

### 4. Los dos ejes, sin mezclarlos

**Eje 1 — entre capas (lo decide la prioridad).** Candidatas: las capas que definen la
clave **con `enabled = true`**. Gana la de mayor prioridad. Sin empates (§6).

**Eje 2 — dentro de la capa ganadora (lo decide la disponibilidad del valor):**

```
pickValue(def):
    si def.local  está definido  Y  def.localEnabled   → local      ("" cuenta como definido)
    si def.current está definido Y no es NULL          → current    (sólo entorno)
    en otro caso                                       → shared
```

**El caso secreto, que no sale por esta puerta.** Si `value_kind = 'secret'`, el `CHECK`
`ck_envvar_secret_xor` **obliga** a que `initial_value` y `current_value` sean `NULL`:
`pickValue` devolvería `NULL`. El valor **no está en estas tablas**, está cifrado en
`secrets`. Por tanto la selección es:

```
resolverValor(def):
    elegido ← pickValue(def)                  # decide QUE capa de valor gana
    si def.valueKindEnum = 'secret' O elegido.secretId ≠ NULL:
        devolver descifrar(elegido.secretId)   # el texto plano NO sale de scoped/env_vars
    devolver elegido.raw
```

Dos consecuencias que hay que respetar:

- **La precedencia es idéntica para secretos y no secretos** (ADR-0006 §4). Lo único que
  cambia es **de dónde se lee el texto**: de `secrets`, no de la columna de valor.
- El `secret_id` se toma de **la capa de valor que ganó**: si gana el override local, se usa
  `variable_local_values.secret_id`; si gana el compartido, el de la fila de la variable.
  Es decir, **un valor local puede ser secreto por su cuenta**, porque
  `variable_local_values` tiene su propia columna `secret_id`.

> **Dónde ocurre el descifrado, para que no se filtre.** `packages/variables` es **puro**
> (ADR-0006 §7): no descifra nada. Recibe los secretos ya resueltos por la API, que es
> quien habla con `secrets` y con el proveedor de claves. El resolutor sólo decide **cuál**
> gana y marca `secret: true` para que el enmascarado de la vista `masked` sea obligatorio.
> El criptosistema es de `appsec-engineer`; aquí sólo fijo el punto de entrada.

> **El eje 2 nunca hace que una capa pierda frente a otra.** Es la regla del ADR-0006 §2 y
> sigue intacta: un `local_value` en `workspace` (20) **no** gana a un `initial_value` en
> `environment` (40). Demostrado en el caso **P-02**.

### 5. Habilitación en dos niveles, que no es lo mismo

El esquema tiene `is_enabled` en **dos** sitios distintos, y significan cosas distintas.
El ADR-0006 sólo conocía el primero.

| Dónde | Valor | Efecto |
| --- | --- | --- |
| `scoped_variables.is_enabled` / `environment_variables.is_enabled` | `false` | **La capa NO define la clave.** Se cae a la capa inferior. |
| `variable_local_values.is_enabled` | `false` | **Se ignora sólo el valor local.** La capa **sigue definiendo** la clave con `current`/`shared`. **No** se cae. |

Esta distinción no es cosmética: confundirla hace que desactivar tu override personal te
mande a otro entorno en vez de devolverte el valor del equipo. Casos **E-02**, **E-02b** y
**E-07** existen exactamente para fijarla.

### 6. Por qué no puede haber empates (y qué pasa si los hubiera)

El determinismo no es una promesa del resolutor: está **garantizado por el esquema**.

- `uq_scopedvar_identity` sobre `(scope, workspace_id, collection_id, api_request_id, key)`
  → como máximo **una** fila por capa y clave.
- `uq_envvar_env_key` sobre `(environment_id, key)` → ídem en el entorno.
- `uq_varlocal_envvar_user` y `uq_varlocal_scopedvar_user` → como máximo **un** override
  local por variable y usuario.

**Precondición explícita:** el índice de `scoped_variables` necesita `NULLS NOT DISTINCT`
(PostgreSQL 15+), como ya advierte la nota del DBML. Sin esa cláusula, dos filas `global`
con la misma clave **no colisionan** y el empate se vuelve posible.

**Defensa en profundidad:** si pese a todo aparecieran dos definiciones en la misma capa,
el resolutor **no** elige al azar: ordena por `created_at` ascendente y, a igualdad, por
`id` ascendente, y emite `AMBIGUOUS_DEFINITION`. Determinista y ruidoso, nunca silencioso.
Caso **A-01**.

### 7. Entorno activo: cómo se elige, y por qué sigue siendo un solo nivel

`environments` admite entornos de **workspace** (`collection_id IS NULL`) y de
**colección** (`collection_id = :col`), compartidos (`is_shared = true`) o **personales**
(`is_shared = false` con `owner_user_id`). Podría parecer que son varios niveles. **No lo
son.** Todos aterrizan en la prioridad **40** y sólo hay **uno activo** por ejecución
(ADR-0006 §1: los entornos no se apilan).

El entorno activo es **explícito**: lo envía el cliente en la llamada. Reglas de
elegibilidad, todas obligatorias:

1. `deleted_at IS NULL`.
2. `workspace_id` = el workspace de la solicitud.
3. Si `collection_id IS NOT NULL`, debe coincidir con la colección de la solicitud.
4. Si `is_shared = false`, entonces `owner_user_id` **debe ser el actor**.
5. Si no se envía ninguno, **el nivel 40 simplemente no existe** en esa resolución.

> **`is_default` no activa nada por su cuenta.** Es una ayuda de interfaz para preseleccionar;
> el servidor no infiere el entorno activo. Resolver distinto según un valor por defecto
> implícito rompería la reproducibilidad de una ejecución. Casos **P-03**, **ENV-P**, **ENV-C**.

### 8. Carga: dos consultas y una superposición, nunca una vista SQL

```sql
-- (1) las cuatro capas de scoped_variables, con el override local del actor
SELECT sv.*, lv.local_value, lv.is_enabled AS local_enabled
  FROM scoped_variables sv
  LEFT JOIN variable_local_values lv
         ON lv.scoped_variable_id = sv.id AND lv.user_id = :actor
 WHERE (sv.scope = 'global')
    OR (sv.scope = 'workspace'   AND sv.workspace_id   = :ws)
    OR (sv.scope = 'collection'  AND sv.collection_id  = :col)
    OR (sv.scope = 'api_request' AND sv.api_request_id = :req);

-- (2) la capa del entorno activo, si lo hay
SELECT ev.*, lv.local_value, lv.is_enabled AS local_enabled
  FROM environment_variables ev
  LEFT JOIN variable_local_values lv
         ON lv.environment_variable_id = ev.id AND lv.user_id = :actor
 WHERE ev.environment_id = :envActivo;

-- (3) la capa de ejecución no se consulta: se superpone en memoria y no se persiste.
```

**La ordenación no se hace en SQL.** Se hace en `packages/variables`, que es puro. Tres
razones, en orden de peso:

1. **Verificabilidad hoy.** Una regla que vive en un `ORDER BY` sólo se prueba con
   PostgreSQL delante. En este contenedor no lo hay. Fuera de la base de datos, la regla se
   ejecuta y se demuestra hoy mismo, como se ha hecho para este ADR.
2. **El nivel 61/62/63 no está en la base de datos.** Una vista nunca podría ordenarlo junto
   al resto; haría falta fusionar fuera de todos modos. Mejor una fusión que una y media.
3. **Secretos.** El valor secreto no está en estas tablas (`secret_id` apunta a `secrets`).
   Una vista que «resolviera» obligaría a arrastrar el descifrado al plano SQL.

### 9. Cambios de contrato respecto al ADR-0006 §8 (declarados, no silenciosos)

Dos, y el `backend-engineer` necesita ambos antes de teclear:

| # | Qué | ADR-0006 | ADR-0010 | Motivo |
| --- | --- | --- | --- | --- |
| 1 | `used[].valueKind` | `'local' \| 'initial'` | `'local' \| 'current' \| 'initial'` | `environment_variables.current_value` existe en el esquema y el ADR-0006 no lo contemplaba |
| 2 | `used[].origin` | — (nuevo) | `'scoped_variables' \| 'environment_variables' \| 'efimero'` | para que la interfaz pueda decir **de qué tabla** salió el valor, no sólo de qué ámbito |
| 3 | **Algoritmo**, línea `bruto ← ganador.localValue ?? ganador.initialValue` | dos valores | **tres**: `local → current → shared` | misma causa que (1) |
| 4 | **Algoritmo**, condición del valor local | «si `localValue` está definido» | «si está definido **y `localEnabled`**» | `variable_local_values.is_enabled` existe y el ADR-0006 no lo conocía (§5) |

> **Declaración expresa:** la §4 de este ADR **sustituye** el bloque «Algoritmo (referencia
> normativa)» del ADR-0006 en esas dos líneas. Todo lo demás de aquel algoritmo —selección
> del ámbito ganador, recursión, ciclos, profundidad— **sigue vigente sin cambios**. Lo digo
> aquí porque el ADR-0006 es normativo y nadie debe implementar su pseudocódigo literal sin
> leer esta tabla.

Todo lo demás del contrato (`resolved`, `masked`, `unresolved`, `warnings`, `shadowed`) se
mantiene **sin cambios**. Se añade un código de aviso: `AMBIGUOUS_DEFINITION`.

**Qué significan `initial` y `current`, para que nadie los invierta:**
`initial_value` es el valor **compartido que se exporta**; `current_value` es el valor
**efectivo del equipo**. Por eso `current` gana a `initial` dentro del entorno: es el que
el equipo está usando ahora. Exportar sigue exportando `initial_value`.

### 10. Lo que este ADR NO cambia

- **Cero cambios en `docs/schema/ceiba.dbml`.** C-23 respetada al pie de la letra: ni una
  tabla, ni un enum, ni una columna. No pido añadir `environment` ni `execution` al enum
  `variable_scope`; **el enum de cuatro valores es correcto** y debe quedarse así.
- `project` y `folder` **siguen sin ser ámbitos** de variables en la v1 (ADR-0006 §9).
  Las prioridades **25** y **35** siguen reservadas para ellos.
- El motor sigue recibiendo todo resuelto (ADR-0002). La API resuelve; el motor no interpola.

---

## Casos de prueba tabulados

Esta es la parte que el `backend-engineer` puede implementar **tal cual**. Los valores
esperados **no están supuestos**: están calculados ejecutando la regla (ver §Verificación).

### Fixture (filas literales, con los nombres de columna del DBML)

Contexto base: actor `U1`, workspace `W1`, colección `C1`, solicitud `R1`, entorno activo
`env-staging`. `U2` es otro usuario.

**`scoped_variables`** — `(id, scope, workspace_id, collection_id, api_request_id, key, value, is_enabled)`

| id | scope | ws | col | req | key | value | is_enabled |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `sv-01` | `global` | — | — | — | `base_url` | `https://api.ceiba.dev` | ✔ |
| `sv-02` | `global` | — | — | — | `timeout` | `30` | ✔ |
| `sv-03` | `workspace` | W1 | — | — | `base_url` | `https://api.equipo.dev` | ✔ |
| `sv-04` | `workspace` | W1 | — | — | `user_id` | `u-000` | ✔ |
| `sv-05` | `collection` | W1 | C1 | — | `base_url` | `https://api.coleccion.dev` | ✔ |
| `sv-06` | `collection` | W1 | C1 | — | `api_version` | `v1` | ✔ |
| `sv-07` | `api_request` | W1 | C1 | R1 | `api_version` | `v2` | ✔ |
| `sv-08` | `collection` | W1 | C1 | — | `page_size` | `25` | ✔ |
| `sv-09` | `collection` | W1 | C1 | — | `nested_url` | `https://{{host}}/{{api_version}}` | ✔ |
| `sv-10` | `collection` | W1 | C1 | — | `a` | `{{b}}` | ✔ |
| `sv-11` | `collection` | W1 | C1 | — | `b` | `{{a}}` | ✔ |
| `sv-d1`…`sv-d12` | `collection` | W1 | C1 | — | `d1`…`d12` | `{{d2}}`…`{{d13}}` | ✔ |
| `sv-d13` | `collection` | W1 | C1 | — | `d13` | `fin` | ✔ |

**`environment_variables`** — `(id, environment_id, key, initial_value, current_value, value_kind, secret_id, is_enabled)`

| id | environment_id | key | initial_value | current_value | value_kind | is_enabled |
| --- | --- | --- | --- | --- | --- | --- |
| `ev-01` | `env-staging` | `base_url` | `https://staging.ceiba.dev` | NULL | string | ✔ |
| `ev-02` | `env-staging` | `access_token` | NULL | NULL | **secret** (`sec-01`) | ✔ |
| `ev-03` | `env-staging` | `user_id` | `u-staging-42` | NULL | string | **✘** |
| `ev-04` | `env-staging` | `region` | `eu-west-1` | `eu-central-1` | string | ✔ |
| `ev-05` | `env-staging` | `host` | `staging.ceiba.dev` | NULL | string | ✔ |
| `ev-06` | `env-staging` | `empty_on_purpose` | `` (cadena vacía) | NULL | string | ✔ |
| `ev-10` | `env-personal` | `base_url` | `http://127.0.0.1:3000` | NULL | string | ✔ |
| `ev-20` | `env-col` | `base_url` | `https://col-env.ceiba.dev` | NULL | string | ✔ |

`env-personal`: `is_shared=false`, `owner_user_id=U1`. `env-col`: `collection_id=C1`.
`secrets['sec-01'] = tok-staging-AAA`.

**`variable_local_values`** — `(id, scoped_variable_id, environment_variable_id, user_id, local_value, is_enabled)`

| id | apunta a | user | local_value | is_enabled |
| --- | --- | --- | --- | --- |
| `lv-01` | `sv-03` (workspace `base_url`) | U1 | `http://localhost:8080` | ✔ |
| `lv-02` | `ev-04` (`region`) | U1 | `eu-south-2` | **✘** |
| `lv-03` | `ev-05` (`host`) | **U2** | `otro.example` | ✔ |
| `lv-04` | `sv-08` (`page_size`) | U1 | `` (cadena vacía) | ✔ |
| `lv-05` | `ev-03` (`user_id`, var deshabilitada) | U1 | `u-local-override` | ✔ |

### Tabla de casos — salida literal del resolutor de referencia

| # | Contexto del caso | Plantilla | resolved | masked | Capa ganadora de la 1.a variable | Valor | Avisos |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P-01 | fixture base, entorno activo `env-staging` | `{{base_url}}/{{api_version}}/users/{{user_id}}` | `https://staging.ceiba.dev/v2/users/u-000` | `https://staging.ceiba.dev/v2/users/u-000` | environment(40) | initial | - |
| P-02 | fixture base, entorno activo `env-staging` | `{{base_url}}/health` | `https://staging.ceiba.dev/health` | `https://staging.ceiba.dev/health` | environment(40) | initial | - |
| P-03 | **sin entorno activo** | `{{base_url}}/health` | `https://api.coleccion.dev/health` | `https://api.coleccion.dev/health` | collection(30) | initial | - |
| P-04 | **sin entorno activo** + `sv-05` deshabilitada | `{{base_url}}/health` | `http://localhost:8080/health` | `http://localhost:8080/health` | workspace(20) | local | - |
| P-05 | **sin entorno activo** + `sv-05` y `sv-03` deshabilitadas | `{{base_url}}/health` | `https://api.ceiba.dev/health` | `https://api.ceiba.dev/health` | global(10) | initial | - |
| E-01 | fixture base, entorno activo `env-staging` | `{{region}}` | `eu-central-1` | `eu-central-1` | environment(40) | current | - |
| E-02 | fixture base, entorno activo `env-staging` (incluye `lv-02` **deshabilitado**) | `{{region}}` | `eu-central-1` | `eu-central-1` | environment(40) | current | - |
| E-02b | `lv-02` **habilitado** (unico cambio sobre E-02) | `{{region}}` | `eu-south-2` | `eu-south-2` | environment(40) | local | - |
| E-07 | fixture base, entorno activo `env-staging` (incluye `lv-05` habilitado sobre `ev-03` deshabilitada) | `{{user_id}}` | `u-000` | `u-000` | workspace(20) | initial | - |
| E-03 | fixture base, entorno activo `env-staging` | `{{host}}` | `staging.ceiba.dev` | `staging.ceiba.dev` | environment(40) | initial | - |
| E-04 | fixture base, entorno activo `env-staging` | `[{{page_size}}]` | `[]` | `[]` | collection(30) | local | - |
| E-05 | fixture base, entorno activo `env-staging` | `{{user_id}}` | `u-000` | `u-000` | workspace(20) | initial | - |
| E-06 | fixture base, entorno activo `env-staging` | `[{{empty_on_purpose}}]` | `[]` | `[]` | environment(40) | initial | - |
| X-01 | efimero 61 `{base_url: https://api-override.ceiba.dev}` | `{{base_url}}/health` | `https://api-override.ceiba.dev/health` | `https://api-override.ceiba.dev/health` | execution:apiOverride(61) | initial | - |
| X-02 | efimero 61 + 62 `{base_url: https://canary.ceiba.dev}` | `{{base_url}}/health` | `https://canary.ceiba.dev/health` | `https://canary.ceiba.dev/health` | execution:dataRow(62) | initial | - |
| X-03 | efimero 61 + 62 + 63 `{base_url: https://hotfix.ceiba.dev}` | `{{base_url}}/{{api_version}}/users/{{user_id}}` | `https://hotfix.ceiba.dev/v2/users/u-000` | `https://hotfix.ceiba.dev/v2/users/u-000` | execution:script(63) | initial | - |
| X-04 | fixture base, entorno activo `env-staging`, **sin capa efimera** | `{{base_url}}/health` | `https://staging.ceiba.dev/health` | `https://staging.ceiba.dev/health` | environment(40) | initial | - |
| S-01 | fixture base, entorno activo `env-staging`, `secrets['sec-01']='tok-staging-AAA'` | `Bearer {{access_token}}` | `Bearer tok-staging-AAA` | `Bearer ••••••` | environment(40) | initial | - |
| N-01 | fixture base, entorno activo `env-staging` | `{{nested_url}}/users` | `https://staging.ceiba.dev/v2/users` | `https://staging.ceiba.dev/v2/users` | collection(30) | initial | - |
| C-01 | fixture base, entorno activo `env-staging` | `{{a}}` | `{{a}}` | `{{a}}` | collection(30) | initial | CIRCULAR_REFERENCE |
| D-01 | fixture base, entorno activo `env-staging` | `{{d1}}` | `{{d12}}` | `{{d12}}` | collection(30) | initial | MAX_DEPTH_EXCEEDED |
| U-01 | fixture base, entorno activo `env-staging` | `{{base_url}}/{{api_version}}/orders/{{order_id}}` | `https://staging.ceiba.dev/v2/orders/{{order_id}}` | `https://staging.ceiba.dev/v2/orders/{{order_id}}` | environment(40) | initial | UNRESOLVED_VARIABLE |
| ESC-01 | fixture base, entorno activo `env-staging` | `\{{base_url}}` | `{{base_url}}` | `{{base_url}}` | - | - | - |
| ENV-P | entorno activo = `env-personal` | `{{base_url}}/health` | `http://127.0.0.1:3000/health` | `http://127.0.0.1:3000/health` | environment(40) | initial | - |
| ENV-C | entorno activo = `env-col` | `{{base_url}}/health` | `https://col-env.ceiba.dev/health` | `https://col-env.ceiba.dev/health` | environment(40) | initial | - |
| A-01 | + `sv-z1`/`sv-z2`: dos filas `global` con la clave `dup_key` (estado imposible) | `{{dup_key}}` | `primera` | `primera` | global(10) | initial | AMBIGUOUS_DEFINITION |

### Qué demuestra cada grupo, y por qué no sobra ninguno

| Grupo | Invariante que fija |
| --- | --- |
| **P-01…P-05** | La escalera completa 40 → 30 → 20 → 10 y el entrelazado con el nivel 50. P-04 es el único punto donde un valor local llega a ganar: cuando su propia capa ya ha ganado. |
| **E-01 / E-02 / E-02b** | `current` gana a `initial`; un override local **deshabilitado** se ignora **sin** tirar la capa; el **mismo** override habilitado sí gana. Los tres juntos, y no uno suelto, son los que fijan la §5. |
| **E-05 / E-07** | Variable deshabilitada en el entorno: la capa **no la define** y se cae a workspace(20); y sigue sin definirla **aunque** exista un override local habilitado sobre ella. El `is_enabled` de la variable manda sobre el del override. |
| **E-03** | El override local de **otro usuario** es invisible. Prueba el filtro `user_id = :actor`. |
| **E-04 / E-06** | Cadena vacía **definida** gana y resuelve a `""`, tanto en `local_value` como en `initial_value`. Deshabilitada ≠ vacía (ADR-0006 §3). |
| **X-01…X-04** | Los tres subniveles efímeros en su orden interno 61 < 62 < 63, y que no se persisten: X-04 repite la petición sin capa de ejecución y vuelve al entorno. **Éste es el nivel que C-23 exige cubrir explícitamente.** |
| **S-01** | La precedencia es idéntica para secretos; sólo cambia la visibilidad. El valor en claro existe únicamente en `resolved`. |
| **N-01** | Una referencia anidada **no hereda** el ámbito del contenedor: `nested_url` viene de collection(30) pero `host` se resuelve en environment(40) y `api_version` en request(50). |
| **C-01 / D-01 / U-01** | Los tres modos de fallo son **avisos**, no excepciones, y conservan el texto original. |
| **ESC-01** | `\{{…}}` no es una referencia. |
| **ENV-P / ENV-C** | Entorno personal y entorno de colección siguen siendo el **nivel 40**, no niveles nuevos. |
| **A-01** | Si el esquema fallara, el desempate es determinista y **ruidoso**. |

> **Honestidad sobre el recuento: son 26 filas, pero 24 entradas distintas.** `E-02`
> repite la entrada de `E-01`, y `E-07` la de `E-05`. **No son relleno:** son pruebas de
> **no regresión**. El fixture contiene `lv-02` (override local deshabilitado) y `lv-05`
> (override local sobre una variable deshabilitada) precisamente para que esos dos casos
> afirmen que **añadir esas filas no cambia el resultado**. Si alguien implementa mal la
> §5, `E-01` y `E-05` seguirían pasando y sólo caerían `E-02`/`E-07`. Quien prefiera
> contar entradas distintas, son **24**.

---

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
| --- | --- |
| Añadir `environment` y `execution` al enum `variable_scope` y migrar todo a `scoped_variables` | **Prohibido por C-23** (reestructuración destructiva). Además `environment_variables` tiene `initial_value`/`current_value` y pertenencia a un entorno conmutable; moverlo dejaría tres columnas nulas en los otros cuatro niveles. Y `execution` no se persiste: nunca tendría filas. |
| Una vista SQL `UNION ALL` que devuelva las seis capas ya ordenadas | No puede incluir los niveles 61/62/63 (no están en la base de datos), obliga a descifrar secretos en SQL y hace que la regla sólo sea comprobable con PostgreSQL delante. Hoy no lo hay. |
| Resolver la precedencia con `ORDER BY priority DESC LIMIT 1` en la consulta | Mueve la regla al motor de base de datos, donde no se puede probar sin infraestructura ni cubrir el ámbito efímero. Se perdería la pureza de `packages/variables` (ADR-0006 §7). |
| Tratar «entorno de colección» y «entorno de workspace» como dos niveles (40 y 45) | El §12 lista **un** nivel de entorno y el ADR-0006 fija un solo entorno activo. Dos niveles reintroducirían el apilado que se rechazó. |
| Hacer que `is_default` active el entorno implícitamente | Una misma petición resolvería distinto según un estado que el cliente no envió. Rompe la reproducibilidad de una ejecución. |
| Que `variable_local_values.is_enabled = false` tire la capa entera | Desactivar tu override personal te mandaría a **otro ámbito** en lugar de devolverte el valor del equipo. Contraintuitivo y peligroso con entornos de producción. |
| Unificar `initial_value` y `current_value` en una sola columna | Sería destructivo (C-23) y perdería la distinción del §12 entre «valor inicial» y «valor compartido efectivo», que es la que permite exportar sin filtrar el estado actual del equipo. |

## Consecuencias

**Positivas** — hay **una** regla y está escrita; el entrelazado `scoped_variables` ↔
`environment_variables` deja de ser interpretable; el esquema no se toca, así que el
`database-engineer` puede traducir el DBML sin esperarme; los 26 casos son ejecutables
**hoy, sin PostgreSQL**, y ya se han ejecutado; `used[].origin` permite a la interfaz
explicar de qué tabla salió cada valor.

**Negativas, asumidas** — la fusión de tres fuentes vive en código de aplicación, no en
SQL, así que una consulta manual a la base de datos **no** muestra el valor efectivo:
hay que pasar por el resolutor. La asimetría entre `scoped_variables.value` (un valor) y
`environment_variables` (dos) obliga a recordar que `current` sólo existe en el entorno.
Y el determinismo depende de una precondición de PostgreSQL 15+ (`NULLS NOT DISTINCT`)
que hay que verificar cuando exista la base de datos.

## Verificación

Separo **escrito**, **ejecutado** y **verificado**, y no mezclo.

| Qué | Cómo se demostró | Estado |
| --- | --- | --- |
| Los 26 casos de la tabla producen exactamente esos valores | implementación de referencia de la regla en `/tmp/ceiba-precedence/` (Node 24.21.0, sin dependencias), ejecutada hoy; la tabla de este ADR es la **transcripción literal de su salida**, insertada por script y no a mano | **[EJECUTADO]** 2026-10-14 |
| **Determinismo** | 1000 resoluciones por caso, 26 casos → salida idéntica: `DETERMINISMO 1000x por caso (26 casos): IDENTICO` | **[EJECUTADO]** |
| **Totalidad** (nunca lanza) | 12 entradas degeneradas (`{{`, `}}`, `{{ host }}`, `{{{{base_url}}}}`, 5000 caracteres…) → `TOTALIDAD: OK` | **[EJECUTADO]** |
| **Pureza** (no muta la entrada) | comparación del contexto serializado antes y después → `PUREZA: OK` | **[EJECUTADO]** |
| El secreto en claro no aparece fuera de `resolved` | búsqueda del literal en el resultado completo sin `resolved` → `FUGA DE SECRETO fuera de resolved: NO` | **[EJECUTADO]** |
| El valor local no cruza de ámbito | aserción explícita sobre P-02 → `OK` | **[EJECUTADO]** |
| Los cuatro valores del enum `variable_scope` y las columnas citadas | lectura directa de `docs/schema/ceiba.dbml` (líneas 198, 1072, 1107, 1143, 1184) | **[VERIFICADO]** |
| La tabla de casos de este ADR es **exactamente** la salida del resolutor, sin retoques | `diff` entre la salida del ejecutor y las 26 filas transcritas aquí: **0 diferencias** | **[VERIFICADO]** hoy |
| Las dos consultas de carga de la §8 son **sintaxis PostgreSQL válida** | analizadas con `node-sql-parser` en `/tmp`, dialecto `postgresql`: 2 sentencias, 0 fallos. **Prueba la sintaxis, no la semántica contra tablas reales** | **[VERIFICADO]** hoy |
| La regla implementada en `packages/variables` se comporta así | el paquete **no existe todavía**; es trabajo del `backend-engineer`. La implementación de referencia **no es** código de producción | **[NO VERIFICADO]** |
| `NULLS NOT DISTINCT` se comporta como se espera en PostgreSQL 15+ | requiere PostgreSQL, que **no existe en este contenedor** | **[NO VERIFICADO]** |

> La implementación de referencia prueba que **la regla** es total, determinista, pura y
> coherente con el esquema, y que los valores esperados de la tabla no son suposiciones.
> **No** prueba el código de producción, que todavía no está escrito. Tampoco prueba la
> rama de secretos de la §4: la implementación de referencia simula `descifrar()` con un
> mapa en memoria, porque el criptosistema real es de `appsec-engineer`.

---

## HUECOS que este ADR deja abiertos

**HUECO: `scoped_variables` tiene una sola columna de valor (`value`) mientras
`environment_variables` tiene `initial_value` y `current_value`, y el §12 pide «valores
iniciales, valores locales y valores compartidos» para las variables en general — creo que
pertenece a `database-engineer`.** La regla de este ADR **funciona con la asimetría tal y
como está** y no la bloquea: para los cuatro ámbitos de `scoped_variables`, `value` juega el
papel de valor compartido y el escalón `current` simplemente no existe. Lo señalo porque
«restablecer al valor inicial» sólo será posible en el ámbito de entorno. Añadir una columna
anulable **no sería destructivo**, pero el esquema no es mío y C-23 prohibe reestructurar.

**HUECO: el descifrado de `secrets` y el control de acceso a esa operación — creo que
pertenece a `appsec-engineer`.** Yo fijo **dónde** entra en la resolución (§4, tras elegir la
capa de valor ganadora) y que `packages/variables` **no** descifra nada por ser puro; el
mecanismo de sobre, las claves y quién puede invocarlo no son míos.
