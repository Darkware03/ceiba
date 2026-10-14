# ADR-0006 — Precedencia de variables y resolución determinista

- **Estado:** Aceptada
- **Fecha:** 2026-10-14
- **Decide:** `software-architect`
- **Ámbito:** 4.A.6 del `BRIEF.md`; §12 del `PROMPT-MAESTRO.md`
- **Depende de:** ADR-0002 (el motor recibe todo ya resuelto), ADR-0004
- **Implementa:** `packages/variables` (paquete **puro**, sin I/O)

## Contexto

El §12 del prompt maestro pide seis niveles de variables y exige: «Define y
documenta una precedencia **inequívoca** entre niveles». Añade valores
sensibles, valores iniciales, valores locales y valores compartidos, y
«herramientas para detectar variables sin resolver y mostrar advertencias antes
de ejecutar una solicitud».

«Inequívoca» significa que para cualquier combinación de entradas existe **una
sola** respuesta posible y que se puede explicar. No basta con una lista
ordenada: hay que decidir qué pasa con variables deshabilitadas, con valores
vacíos, con referencias anidadas, con ciclos y con los niveles de la jerarquía
que **no** son niveles de variables.

## Decisión

### 1. Seis ámbitos, prioridad numérica, mayor gana

| # | Ámbito | Quién lo define | Dónde vive |
| --- | --- | --- | --- |
| **10** | `global` | administrador de la instancia | tabla global |
| **20** | `workspace` | miembros con permiso | `Workspace` |
| **30** | `collection` | editores de la colección | `Collection` |
| **40** | `environment` | el entorno **activo** | `Environment` + `EnvironmentVariable` |
| **50** | `request` | la propia solicitud | `ApiRequest` |
| **60** | `execution` | esta ejecución concreta | efímero, nunca se persiste |

```
global(10) < workspace(20) < collection(30) < environment(40) < request(50) < execution(60)
                                                                                      ↑ gana
```

Coincide exactamente con el orden del `BRIEF.md` §4.A.6 y del §12 del prompt
maestro. **Sólo hay un entorno activo por ejecución**; los entornos no se
apilan.

El ámbito `execution` (60) agrupa, **en este orden interno**:

| | Fuente | Prioridad |
| --- | --- | --- |
| 63 | variable escrita por un script *pre-request* | mayor |
| 62 | fila del fichero de datos del *collection runner* |  |
| 61 | sustitución explícita enviada en la llamada a la API |  |

Un script pre-request gana a todo porque se ejecuta **inmediatamente antes** de
enviar: es, literalmente, la última palabra.

### 2. Segundo eje, independiente: valor local vs. compartido

Es el punto donde más implementaciones se vuelven ambiguas, porque se confunde
con la precedencia entre ámbitos. **No es lo mismo y no interactúa con ella.**

Cada variable, **dentro de su ámbito**, puede tener dos valores:

- **`initialValue`** (compartido) — se sincroniza, se comparte y **se exporta**.
- **`localValue`** (local) — sólo del usuario en su navegador/sesión; **nunca
  se comparte ni se exporta**.

**Regla:** dentro de un ámbito, si `localValue` está definido (incluida la
cadena vacía), gana. Si no, se usa `initialValue`.

**La resolución es en dos pasos y en este orden:**

1. Elegir el **ámbito ganador**: el de mayor prioridad que defina la variable y
   la tenga **habilitada**.
2. Dentro de ese ámbito, elegir `localValue` si existe; si no, `initialValue`.

> **El paso 2 NUNCA hace que un ámbito pierda frente a otro.** Un `localValue`
> en `workspace` (20) **no** gana a un `initialValue` en `environment` (40).
> Ésta es la regla que hay que leer dos veces; es el origen del 90 % de los
> «no entiendo qué valor se está enviando» en herramientas de este tipo.

### 3. Deshabilitada ≠ vacía

| Estado | `enabled` | Efecto |
| --- | --- | --- |
| Deshabilitada | `false` | **El ámbito no la define.** Se cae al siguiente ámbito inferior. |
| Definida y vacía | `true`, valor `""` | **El ámbito la define, con la cadena vacía.** Gana y resuelve a `""`. |
| No definida | — | se cae al siguiente ámbito inferior |

Una variable vacía es una decisión del usuario: «quiero que esto vaya vacío».
Deshabilitarla es «ignórame». Confundirlas es un error silencioso.

### 4. Variables sensibles

`secret: true` sólo cambia **quién puede ver el valor**, nunca la precedencia:

- El valor resuelto se envía al motor (es necesario para la petición).
- **Nunca** se devuelve al cliente en vistas previas, resoluciones ni respuestas
  de la API: se enmascara como `••••••`.
- **Nunca** aparece en logs, en el historial, en el cURL generado ni en una
  exportación.
- En el contrato del motor viaja con `"secret": true` para que el motor sepa que
  **no debe registrarla** (ADR-0002).

> El cifrado en reposo, la gestión de claves y la prevención de fugas en
> exportaciones son de `appsec-engineer` (ámbito 4.C.3 y 4.C.5). Yo fijo que la
> **precedencia es idéntica** para secretas y no secretas, y que la resolución
> devuelve dos vistas: una **resuelta** (hacia el motor) y una **enmascarada**
> (hacia el usuario).

### 5. Interpolación: recursiva, acotada y con detección de ciclos

Sintaxis: `{{nombre}}`. Nombre válido: `[A-Za-z0-9_.-]+`. Sin espacios dentro de
las llaves (`{{ host }}` **no** es una referencia; es texto literal).

- **Recursiva:** si el valor resuelto contiene a su vez `{{…}}`, se resuelve
  también. Cada paso parte de nuevo desde el ámbito de mayor prioridad: **la
  resolución de una referencia anidada no hereda el ámbito donde apareció.**
- **Profundidad máxima: 10.** Al superarla → `MAX_DEPTH_EXCEEDED`.
- **Ciclos:** detectados por el camino de resolución, no por la profundidad →
  `CIRCULAR_REFERENCE`, con el ciclo completo en el mensaje.
- **Escape:** `\{{literal}}` produce el texto `{{literal}}`.
- **No resuelta:** si ningún ámbito la define, **el texto `{{nombre}}` se deja
  tal cual** y se añade una advertencia. No se sustituye por cadena vacía:
  enviar `GET https:///v1/users` por una variable olvidada es peor que enviar
  algo visiblemente roto.

### 6. Dónde se aplica

En la URL, los nombres y valores de cabeceras, los parámetros de *query* y de
ruta, el cuerpo (raw/JSON/form/urlencoded/GraphQL), y los campos de
configuración de autenticación. **No** en los nombres de fichero binario ni en
los scripts (un script accede a las variables por API, no por interpolación de
texto).

### 7. Quién resuelve, y por qué importa

**La API resuelve. El motor no.** Invariante del ADR-0002. La API llama a
`packages/variables`, obtiene la solicitud completamente resuelta y se la pasa
al motor.

Dos razones: una sola implementación de la precedencia (si el motor también
interpolara, habría dos y divergirían), y el motor no necesita ver los secretos
de todos los ámbitos, sólo los valores de la petición en curso.

`packages/variables` es **puro**: `resolve(scopes, template) → resultado`. Sin
base de datos, sin red, sin `process.env`. Por eso sus pruebas **se ejecutan
hoy, en este contenedor, sin PostgreSQL**.

### 8. Resultado de la resolución (contrato)

```ts
// packages/contracts/src/variables/
interface ResolutionResult {
  resolved: string                 // texto final (hacia el motor)
  masked: string                   // igual, con secretos como ••••••  (hacia el usuario)
  used: Array<{
    name: string
    scope: 'global'|'workspace'|'collection'|'environment'|'request'|'execution'
    priority: number
    valueKind: 'local' | 'initial'
    secret: boolean
    maskedValue: string
  }>
  unresolved: string[]             // nombres no definidos en ningún ámbito
  warnings: Array<{ code: 'UNRESOLVED_VARIABLE'|'CIRCULAR_REFERENCE'|'MAX_DEPTH_EXCEEDED'|'EMPTY_VALUE', ... }>
  shadowed: Array<{ name: string, winner: Scope, losers: Scope[] }>
}
```

`used` y `shadowed` existen para que la interfaz pueda responder **«¿por qué se
está enviando este valor?»** señalando el ámbito ganador y los ámbitos
ensombrecidos. Esa pregunta se hace todos los días; si la resolución no la
contesta, se contesta a base de prueba y error.

`unresolved` alimenta la advertencia **previa** a la ejecución que pide el §12.

### 9. Lo que NO es un ámbito de variables, y por qué

El §4 del prompt maestro define la jerarquía `Workspace → Proyectos →
Colecciones → Carpetas → Subcarpetas → Endpoints`, pero el §12 lista seis
niveles de variables que **no incluyen ni Proyecto ni Carpeta**.

**Decisión: `project` y `folder` NO son ámbitos de variables en la v1.** Me
atengo literalmente a la lista del §12 y del brief §4.A.6. Razón: añadir
`folder` obligaría a resolver la precedencia **entre carpetas anidadas a
profundidad arbitraria**, lo que convierte una lista de seis niveles en un árbol
y hace mucho más difícil explicar un resultado. Si se quiere después, encaja sin
romper nada: `project` entre workspace y collection (25), y `folder` entre
collection y environment (35, de la raíz hacia la hoja). El algoritmo ya es
una lista ordenada de ámbitos; añadir entradas no cambia su forma.

**Lo señalo como ambigüedad del prompt maestro**, no lo resuelvo en silencio:
la jerarquía del §4 y los niveles del §12 no coinciden. Ver `ARQUITECTURA.md`
§11 HUECOS.

---

## Ejemplos resueltos

Todos sobre el mismo escenario. Entorno activo: **Staging**.

| Ámbito | Variable | `initialValue` | `localValue` | `enabled` | `secret` |
| --- | --- | --- | --- | --- | --- |
| global (10) | `base_url` | `https://api.ceiba.dev` | — | ✔ | — |
| global (10) | `timeout` | `30` | — | ✔ | — |
| workspace (20) | `base_url` | `https://api.equipo.dev` | `http://localhost:8080` | ✔ | — |
| workspace (20) | `user_id` | `u-000` | — | ✔ | — |
| collection (30) | `base_url` | `https://api.coleccion.dev` | — | ✔ | — |
| collection (30) | `api_version` | `v1` | — | ✔ | — |
| environment (40) | `base_url` | `https://staging.ceiba.dev` | — | ✔ | — |
| environment (40) | `access_token` | `tok-staging-AAA` | — | ✔ | **✔** |
| environment (40) | `user_id` | `u-staging-42` | — | **✘** | — |
| request (50) | `api_version` | `v2` | — | ✔ | — |

### Ejemplo 1 — Precedencia pura

**Plantilla:** `{{base_url}}/{{api_version}}/users/{{user_id}}`

| Variable | Ámbitos que la definen | Ganador | Valor | Por qué |
| --- | --- | --- | --- | --- |
| `base_url` | global(10), workspace(20), collection(30), **environment(40)** | `environment` | `https://staging.ceiba.dev` | 40 > 30 > 20 > 10 |
| `api_version` | collection(30), **request(50)** | `request` | `v2` | 50 > 30 |
| `user_id` | **workspace(20)**, ~~environment(40)~~ | `workspace` | `u-000` | la de `environment` está **deshabilitada**, así que ese ámbito no la define |

**Resultado:** `https://staging.ceiba.dev/v2/users/u-000`

Obsérvese el caso de `user_id`: es el que distingue «deshabilitada» de
«definida». Una implementación que tratase `enabled:false` como «valor vacío»
produciría `.../users/`, que es un error silencioso con un 404 al final.

### Ejemplo 2 — Local vs compartido, y lo que **no** hace

**Plantilla:** `{{base_url}}/health`

`base_url` tiene un `localValue` en `workspace` (`http://localhost:8080`), que
parece «más específico». No importa:

| Paso | Resultado |
| --- | --- |
| 1. Ámbito ganador | `environment` (40) — es el de mayor prioridad que la define |
| 2. Valor dentro de ese ámbito | `environment` no tiene `localValue` → se usa `initialValue` |

**Resultado:** `https://staging.ceiba.dev/health`

El `localValue` de `workspace` **no se usa**, porque `workspace` ya perdió en el
paso 1. Para que ese `localValue` ganase habría que deshabilitar o borrar
`base_url` en `environment` y en `collection`.

Si en cambio desactivamos el entorno (sin entorno activo):

| Paso | Resultado |
| --- | --- |
| 1. Ámbito ganador | `collection` (30) |
| 2. Valor | `initialValue` → `https://api.coleccion.dev` |

**Resultado:** `https://api.coleccion.dev/health`

Y si además se deshabilita en `collection`, gana `workspace` (20), y **ahí sí**
aplica su `localValue`: **`http://localhost:8080/health`**.

### Ejemplo 3 — Ejecución gana a todo; script gana dentro de ejecución

Ejecución de colección con fichero de datos; la fila 7 trae
`base_url = https://canary.ceiba.dev`. Y un script pre-request hace
`ceiba.variables.set('base_url', 'https://hotfix.ceiba.dev')`.

| # | Ámbito | Valor |
| --- | --- | --- |
| 40 | environment | `https://staging.ceiba.dev` |
| 62 | execution · fila de datos | `https://canary.ceiba.dev` |
| **63** | **execution · script pre-request** | **`https://hotfix.ceiba.dev`** ← gana |

**Resultado:** `https://hotfix.ceiba.dev/v2/users/u-000`

La variable escrita por el script **no se persiste**: vive sólo en esta
ejecución. La siguiente iteración del runner vuelve a partir de la fila 7.

### Ejemplo 4 — Referencia anidada

Añádase a `collection` (30): `base_url = https://{{host}}/{{api_version}}`,
y a `environment` (40): `host = staging.ceiba.dev`. Supóngase que `base_url`
**no** está definida en `environment`.

**Plantilla:** `{{base_url}}/users`

| Paso | Acción | Estado |
| --- | --- | --- |
| 0 | — | `{{base_url}}/users` |
| 1 | `base_url` → gana `collection`(30) | `https://{{host}}/{{api_version}}/users` |
| 2 | `host` → gana `environment`(40) | `https://staging.ceiba.dev/{{api_version}}/users` |
| 3 | `api_version` → gana `request`(50) | `https://staging.ceiba.dev/v2/users` |
| 4 | sin `{{…}}` | **fin** |

**Resultado:** `https://staging.ceiba.dev/v2/users` — profundidad 2 de 10.

Nótese el paso 3: `api_version` apareció **dentro** de un valor de
`collection`, y aun así se resuelve con el de `request` (50). **Una referencia
anidada no hereda el ámbito donde apareció**; vuelve a resolverse desde arriba.
Es la regla que mantiene la precedencia inequívoca; la alternativa (resolver en
el ámbito del contenedor) haría que el mismo nombre valiera cosas distintas
según dónde se escribió.

### Ejemplo 5 — Ciclo

`collection`: `a = {{b}}` · `collection`: `b = {{a}}`. Plantilla: `{{a}}`

```
a → {{b}} → {{a}} → ciclo
```

Resolución abortada para esa variable:

```jsonc
{ "resolved": "{{a}}",
  "warnings": [{ "code": "CIRCULAR_REFERENCE", "name": "a", "path": ["a","b","a"],
                 "message": "Referencia circular: a → b → a" }] }
```

El texto se deja intacto y **la ejecución se avisa antes de lanzarse** (§12).
No se envía una petición con un ciclo a medio expandir.

### Ejemplo 6 — Secreto y enmascarado

**Plantilla (cabecera):** `Authorization: Bearer {{access_token}}`

| Vista | Valor |
| --- | --- |
| `resolved` → hacia el motor | `Bearer tok-staging-AAA` |
| `masked` → hacia el usuario, logs, historial, cURL y exportación | `Bearer ••••••` |

`used` registra `{ name: 'access_token', scope: 'environment', priority: 40,
valueKind: 'initial', secret: true, maskedValue: '••••••' }`. El valor en claro
**no aparece en ningún campo del resultado**: existe únicamente dentro de
`resolved`, que sólo viaja al motor.

### Ejemplo 7 — No resuelta, con advertencia previa

**Plantilla:** `{{base_url}}/{{api_version}}/orders/{{order_id}}`

`order_id` no está en ningún ámbito.

```jsonc
{ "resolved":  "https://staging.ceiba.dev/v2/orders/{{order_id}}",
  "unresolved": ["order_id"],
  "warnings": [{ "code": "UNRESOLVED_VARIABLE", "name": "order_id",
                 "location": "url",
                 "message": "La variable {{order_id}} no está definida en ningún ámbito." }] }
```

La interfaz **avisa antes de ejecutar** y marca el fragmento en la URL. El texto
`{{order_id}}` se conserva: una URL visiblemente rota es mejor diagnóstico que
una URL silenciosamente mutilada.

---

## Algoritmo (referencia normativa)

```
resolveValue(name, scopes, path):
    si name ∈ path:                       → CIRCULAR_REFERENCE
    si |path| > 10:                       → MAX_DEPTH_EXCEEDED
    candidatos ← [s ∈ scopes : s define name ∧ s.enabled]
    si candidatos = ∅:                    → UNRESOLVED, devolver "{{name}}"
    ganador   ← argmax(candidatos, .priority)        # mayor prioridad gana
    bruto     ← ganador.localValue ?? ganador.initialValue   # ?? = "definido", "" cuenta
    devolver interpolate(bruto, scopes, path + [name])

interpolate(texto, scopes, path):
    reemplazar cada {{nombre}} no escapado por resolveValue(nombre, scopes, path)
```

Propiedades exigidas, y cada una tiene su prueba:

- **Determinista:** misma entrada → misma salida. Sin relojes, sin azar, sin I/O.
- **Total:** nunca lanza excepción; los fallos son advertencias en el resultado.
- **Pura:** no muta los ámbitos de entrada.
- **Explicable:** `used` + `shadowed` justifican cada valor enviado.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
| --- | --- |
| Variable no resuelta → cadena vacía | Produce URLs y cuerpos silenciosamente incorrectos. Peor de diagnosticar que un fallo visible. |
| Variable no resuelta → abortar siempre | Demasiado rígido: a veces se quiere enviar y ver qué pasa. Se avisa; bloquear es opción de configuración, no comportamiento fijo. |
| `localValue` gana **entre** ámbitos | Rompe la precedencia: un valor local olvidado en `workspace` ganaría al entorno de producción. Es exactamente el fallo que un entorno debe impedir. |
| Resolución no recursiva | Impide `{{base_url}} = https://{{host}}`, que es un patrón básico. |
| Resolver en el motor | Dos implementaciones de la precedencia y secretos de más en el motor. Prohibido por ADR-0002. |
| Apilar varios entornos activos | El §12 no lo pide y multiplica la ambigüedad. Un entorno activo. |
| Añadir `folder` y `project` como ámbitos | El §12 no los lista; convierte la lista en un árbol y dificulta explicar el resultado. Encaja después sin romper nada. |

## Consecuencias

**Positivas** — precedencia inequívoca y explicable; la interfaz puede
justificar cada valor; advertencias antes de ejecutar; implementación única,
pura y **verificable hoy sin infraestructura**.

**Negativas, asumidas** — la distinción local/compartido es contraintuitiva la
primera vez y hay que explicarla en la interfaz (de ahí `shadowed`); la
resolución recursiva obliga a detección de ciclos; sin ámbito de carpeta, quien
lo espere tendrá que usar colección o entorno.

## Verificación

| Qué | Cómo se demuestra | Estado |
| --- | --- | --- |
| Los 7 ejemplos de este ADR | tabla de casos en `packages/variables/__tests__/precedence.test.ts`, uno por ejemplo, con el resultado literal | [ESCRITO] — Fase 2, **ejecutable sin infraestructura** |
| Deshabilitada ≠ vacía | caso dedicado (Ejemplo 1, `user_id`) | [ESCRITO] — Fase 2 |
| `localValue` no cruza ámbitos | caso dedicado (Ejemplo 2) | [ESCRITO] — Fase 2 |
| Ciclos y profundidad | casos `CIRCULAR_REFERENCE` y `MAX_DEPTH_EXCEEDED` | [ESCRITO] — Fase 2 |
| Secretos nunca en `masked`, logs ni exportación | prueba que recorre el resultado y falla si el valor en claro aparece fuera de `resolved` | [ESCRITO] — Fase 2 (y §20.18, con `appsec-engineer`) |
| Determinismo | 1000 resoluciones de la misma entrada, salida idéntica | [ESCRITO] — Fase 2 |
| El motor recibe todo resuelto | prueba de contrato: el cuerpo enviado al motor no contiene `{{` | [ESCRITO] — Fase 2 |
