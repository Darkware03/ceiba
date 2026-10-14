# ADR-0002 — El motor de ejecución HTTP es un servicio separado

- **Estado:** Aceptada
- **Fecha:** 2026-10-14
- **Decide:** `software-architect`
- **Ámbito:** 4.A.2 del `BRIEF.md`; §3, §16 del `PROMPT-MAESTRO.md`
- **Depende de:** ADR-0001
- **Afecta a:** `apps/engine`, `apps/api`, `packages/contracts`

## Contexto

CEIBA ejecuta solicitudes HTTP **cuya URL, cabeceras, cuerpo y scripts los
escribe el usuario**. Eso es, literalmente, un proxy de salida controlado por
entrada no confiable. El `BRIEF.md` §4.C lo dice sin rodeos: «El motor de
ejecución es la superficie de ataque principal.»

El `.env.example` que ya está en el commit `a0e7021` **ya declara el motor como
servicio remoto** [VERIFICADO]:

```
CEIBA_ENGINE_URL=http://engine:3001
CEIBA_SSRF_PROTECTION=on
CEIBA_ENGINE_MAX_RESPONSE_BYTES=26214400
CEIBA_ENGINE_TIMEOUT_MS=30000
CEIBA_ENGINE_MAX_REDIRECTS=5
```

Un host (`engine`) y un puerto (`3001`) distintos de la API. Este ADR no inventa
la separación: la formaliza, le pone contrato y explica por qué es obligatoria.

El §21 del prompt maestro permite combinar servicios «si eso reduce complejidad
**sin comprometer el aislamiento del motor HTTP**». La excepción está escrita en
la propia especificación: el motor es lo que no se puede fusionar.

## Decisión

**El motor vive en `apps/engine`, es un proceso independiente, con su propia
imagen, su propio usuario, su propia red de salida y su propio ciclo de vida.**

Reglas duras, no recomendaciones:

1. **El motor no tiene credenciales de base de datos.** No se le pasa
   `DATABASE_URL`. No importa `@prisma/client`. Si alguien añade esa dependencia
   a `apps/engine/package.json`, la decisión queda rota, y por eso la Fase 2
   incluye una prueba que falla si aparece (§Verificación).
2. **El motor no tiene la clave maestra de secretos.** No ve
   `CEIBA_SECRETS_MASTER_KEY`. La API descifra y le entrega **valores ya
   resueltos**, de un solo uso, en el cuerpo de la petición.
3. **El motor no sabe qué es un usuario, un workspace ni un permiso.** Recibe
   una solicitud completamente resuelta. La autorización ocurre **antes**, en la
   API. El motor no es un punto de decisión de seguridad de negocio; es un punto
   de aplicación de seguridad de red.
4. **El motor es el único proceso con salida a Internet arbitraria.** La API y
   el frontend no abren conexiones hacia destinos del usuario. En producción
   esto se traduce en dos redes Docker separadas y reglas de egreso distintas
   **[NO VERIFICADO]** — no hay Docker en este contenedor.
5. **El motor es sin estado.** No persiste nada. Devuelve el resultado y olvida.
   La persistencia de historial es de la API (ADR-0004).

### Framework del motor: Fastify 5 desnudo [VERIFICADO: `fastify 5.12.7`]

Sin NestJS. Tres rutas no justifican un contenedor de DI, y cada dependencia
añadida al proceso que ejecuta entrada hostil es superficie de ataque que
alguien tendrá que auditar. Ver ADR-0001 para la asimetría deliberada.

Cliente HTTP de salida: **`undici`** [VERIFICADO: `8.12.1`]. Razón decisiva: su
API de `Dispatcher`/`connect` permite interceptar **el socket en el momento de
conectar**, que es donde el control anti-SSRF tiene que vivir para resistir DNS
rebinding. Un cliente que sólo deja validar la URL de entrada no puede
implementar el control que el `BRIEF.md` §4.C.1 exige. `fetch` global de Node
usa undici por debajo pero no expone ese punto de extensión con garantías.

> El **diseño** del control anti-SSRF, la lista de rangos, el tratamiento de
> IPv6 y el comportamiento tras cada redirección **son de `appsec-engineer`**
> (ámbito 4.C). Yo fijo *dónde* se engancha y *que el contrato lo permite*.
> Ver HUECOS en `ARQUITECTURA.md` §11.

## Por qué NO puede vivir dentro de la API

Cinco razones. Cada una bastaría; juntas no dejan alternativa.

### 1. Compromiso del motor = compromiso de toda la base de datos

Es el argumento central. Si el motor corre dentro del proceso de la API, ese
proceso tiene a la vez `DATABASE_URL`, `CEIBA_SECRETS_MASTER_KEY` y la capacidad
de conectarse a donde el usuario diga. **Un SSRF exitoso pasa de «leer un
endpoint interno» a «leer todas las colecciones, secretos y sesiones de todos
los usuarios»**, porque las credenciales están en el mismo espacio de memoria y
en el mismo `process.env`.

Separado, un SSRF exitoso en el motor concede: la red de egreso y los secretos
de *esa única petición en vuelo*. Sigue siendo grave. No es catastrófico. La
diferencia entre «incidente» y «fin del producto» es exactamente este límite de
proceso.

### 2. Agotamiento de recursos y aislamiento de fallos

Una respuesta de 25 MB (`CEIBA_ENGINE_MAX_RESPONSE_BYTES=26214400`), un destino
que responde a 1 byte/s hasta el timeout de 30 s, o una colección de 500
solicitudes lanzada por un usuario, consumen memoria, *event loop* y sockets.
Dentro de la API, eso degrada el login, la navegación y los WebSockets de
**todos los usuarios**. Node es monohilo: no hay forma de que un parseo de 25 MB
en el mismo proceso no se note en la latencia del resto.

Separado, el motor se escala y se reinicia **solo**, con sus propios límites de
CPU y memoria, y la API sigue sirviendo la interfaz aunque el motor esté
saturado. El usuario ve «el motor está ocupado», no «CEIBA no carga».

### 3. Los scripts pre-request y post-response no se pueden aislar dentro de la API

El §13 del prompt maestro pide scripts de usuario. El `BRIEF.md` §4.C.4 exige
aislamiento real: sin filesystem, sin procesos, sin red arbitraria, con límites
de CPU, tiempo y memoria. Un escape del sandbox dentro de la API es un
compromiso total por la razón 1. En el motor, el escape se topa con un proceso
sin base de datos, sin clave maestra y sin estado.

Además, el sandbox probablemente necesite un binario nativo o un runtime
adicional. Encerrar esa dependencia en una imagen que **no** es la que sirve la
API mantiene la imagen de la API pequeña y auditable.

> La **elección del mecanismo de sandbox** es de `appsec-engineer` (4.C.4). Yo
> sólo reservo el sitio: vive dentro de `apps/engine`, nunca en `apps/api`.

### 4. Escalado con perfil opuesto

La API escala por **concurrencia de usuarios**: muchas peticiones cortas, con
base de datos. El motor escala por **trabajo saliente**: pocas peticiones
larguísimas, sin base de datos, limitadas por sockets y ancho de banda.
Meterlos en el mismo proceso obliga a dimensionar por el peor de los dos y a
pagar réplicas de base de datos que el motor no usa. **[NO VERIFICADO]** — no he
medido nada; es un argumento de forma, no de cifras.

### 5. Verificabilidad

Separado, el motor se prueba **de verdad, hoy, en este contenedor**: se arranca
contra un servidor de pruebas local (`node:http` en `127.0.0.1`), se le lanza
una petición y se comprueba la respuesta. No necesita PostgreSQL ni Redis. Eso
cumple el `BRIEF.md` §2.1 («las pruebas que no necesitan servicios externos sí
se ejecutan») y la Fase 2 del §22 («prueba las solicitudes contra un servidor de
prueba controlado»). Dentro de la API, probar el motor exigiría levantar la API
entera, y por tanto la base de datos que aquí no existe.

## Contrato del motor (v1)

Contrato **HTTP interno**, no expuesto a Internet. Esquemas Zod en
`packages/contracts/src/engine/`, **fuente única de verdad** para ambos lados.

### Autenticación entre servicios

Cabecera `X-Ceiba-Engine-Token`, comparada en tiempo constante contra un secreto
compartido. Es una barrera de defensa en profundidad; la barrera real es de red
(el motor no es alcanzable desde fuera). **Requiere una variable nueva,
`CEIBA_ENGINE_TOKEN`, que hoy no está en el `.env.example`.** Se añade, no se
renombra nada. Ver HUECOS.

### Rutas

| Método | Ruta | Para qué |
| --- | --- | --- |
| `POST` | `/v1/execute` | Ejecuta **una** solicitud. Síncrono. |
| `POST` | `/v1/execute/stream` | Igual, con SSE para respuestas grandes o lentas. |
| `GET` | `/healthz` | Liveness. Sin autenticación. No toca la red de salida. |

Eso es todo. **Tres rutas.** Cualquier cuarta ruta necesita un ADR nuevo: el
valor del motor está en su superficie mínima, y la forma más común de perder
esa propiedad es añadirle «una cosita más».

### `POST /v1/execute` — petición

```jsonc
{
  "executionId": "01JB2X…",        // ULID, generado por la API. Idempotencia y trazas.
  "request": {
    "method": "POST",
    "url": "https://api.example.com/v1/users?page=2",   // YA RESUELTA: sin {{var}}
    "headers": [ { "name": "Authorization", "value": "Bearer …", "secret": true } ],
    "body": {
      "mode": "json",              // none|raw|json|form|urlencoded|binary|graphql
      "contentType": "application/json",
      "raw": "{\"name\":\"ana\"}",
      "parts": null,               // multipart: [{name,type:text|file,value|fileRef}]
      "fileRef": null              // referencia opaca a un fichero subido
    }
  },
  "policy": {
    "timeoutMs": 30000,            // ≤ CEIBA_ENGINE_TIMEOUT_MS
    "maxRedirects": 5,             // ≤ CEIBA_ENGINE_MAX_REDIRECTS
    "maxResponseBytes": 26214400,  // ≤ CEIBA_ENGINE_MAX_RESPONSE_BYTES
    "followRedirects": true,
    "ssrfProfile": "default",      // default | allowlisted. NUNCA "off" por petición.
    "allowedDestinations": [],     // sólo con ssrfProfile=allowlisted; lo fija el admin
    "tls": { "rejectUnauthorized": true, "clientCertRef": null }
  },
  "scripts": {
    "preRequest": null,            // string | null
    "postResponse": null,
    "limits": { "cpuMs": 1000, "memoryMb": 64, "wallMs": 2000 }
  },
  "capture": {
    "storeBody": true,
    "maxStoredBytes": 1048576      // la API decide cuánto cuerpo quiere de vuelta
  }
}
```

**Invariante de diseño (y la más importante del contrato):** el campo `url` y
todos los `headers` llegan **ya resueltos**. El motor **no conoce `{{variables}}`
y no las interpola**. La resolución es de `packages/variables`, ocurre en la API
(ADR-0006) y es determinista y probada aparte. Si el motor interpolase, la
precedencia de variables tendría **dos** implementaciones y divergirían; además
el motor necesitaría ver los secretos de todos los ámbitos, no sólo los de esta
petición.

### `POST /v1/execute` — respuesta 200

```jsonc
{
  "executionId": "01JB2X…",
  "outcome": "completed",          // completed | failed | blocked | timeout | too_large
  "response": {
    "status": 200,
    "statusText": "OK",
    "httpVersion": "2.0",
    "headers": [ { "name": "content-type", "value": "application/json" } ],
    "bodyEncoding": "utf8",        // utf8 | base64
    "body": "…",                   // truncado a capture.maxStoredBytes
    "bodyTruncated": false,
    "sizeBytes": 10234
  },
  "timings": { "dnsMs": 12, "tcpMs": 30, "tlsMs": 55, "ttfbMs": 180, "totalMs": 220 },
  "redirects": [ { "status": 301, "from": "http://…", "to": "https://…" } ],
  "tls": { "protocol": "TLSv1.3", "cipher": "…", "peerCN": "…", "validTo": "…" },
  "resolvedAddresses": [ "93.184.216.34" ],   // qué IP se usó realmente. Para auditoría.
  "scriptResults": {
    "preRequest": { "ok": true, "logs": [], "durationMs": 3, "mutations": [] },
    "postResponse": { "ok": true, "logs": [], "assertions": [] }
  },
  "error": null                    // { code, message } cuando outcome != completed
}
```

Un fallo de red, un bloqueo por SSRF o un timeout **son HTTP 200 con
`outcome != "completed"`**, no un 5xx. Razón: son resultados normales del
dominio «el usuario pidió algo y esto pasó», y convertirlos en errores de
transporte obliga a la API a distinguir «el motor está roto» de «el destino del
usuario está roto» mirando cuerpos de error. Los 5xx del motor quedan reservados
para que el motor esté realmente roto.

### Códigos de `error.code` (cerrados, en `packages/contracts`)

`SSRF_BLOCKED`, `DNS_FAILURE`, `CONNECTION_REFUSED`, `CONNECTION_RESET`,
`TLS_ERROR`, `TIMEOUT`, `TOO_MANY_REDIRECTS`, `RESPONSE_TOO_LARGE`,
`SCRIPT_ERROR`, `SCRIPT_TIMEOUT`, `INVALID_REQUEST`, `ENGINE_OVERLOADED`.

`SSRF_BLOCKED` **no revela** qué IP ni qué regla disparó el bloqueo en el mensaje
que llega al usuario final; el detalle va al log estructurado del motor. (El
texto exacto es de `appsec-engineer`.)

### Reglas transversales

- **El motor nunca registra cabeceras marcadas `secret: true`, ni cuerpos
  completos, ni la URL con *query string*.** Loguea `executionId`, método, host,
  `outcome`, timings y tamaños.
- **Límite de cuerpo aplicado en streaming**, cortando el socket al superar
  `maxResponseBytes`. No se bufferiza primero y se comprueba después: eso es el
  propio agotamiento de memoria que se quiere evitar.
- **Sin reintentos automáticos.** Reenviar la solicitud de un usuario sin que lo
  pida puede duplicar un `POST` con efectos. Si hace falta reintentar, lo decide
  la capa de colas de la API, con idempotencia explícita.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
| --- | --- |
| Motor como librería dentro de la API | Razones 1–5. Es la opción que el §21 del prompt maestro excluye explícitamente. |
| Motor como `worker_thread` de la API | Comparte `process.env`, el sistema de ficheros y los límites del contenedor. Mitiga la razón 2 a medias y **no mitiga nada de la razón 1**: aislamiento aparente. |
| Motor como proceso hijo (`child_process`) en el mismo contenedor | Mejor, pero comparte imagen, red y ciclo de vida; no se escala por separado y el `.env.example` ya apunta a otra cosa. |
| Motor invocado por cola (sólo asíncrono) | Rechazado como mecanismo **único**: la prioridad 1 del cliente es un cliente HTTP interactivo, y meter Redis en el camino crítico de cada clic añade latencia y una dependencia dura donde hoy no hay Redis. **Sí** se usa cola para ejecuciones de colección y programadas (ADR-0005). |

## Consecuencias

**Positivas** — el radio de explosión de un SSRF queda acotado; el motor se
prueba sin base de datos; se escala por separado; la superficie auditable es de
tres rutas.

**Negativas, asumidas** — un salto de red por ejecución (irrelevante frente a la
latencia del destino externo); dos despliegues en vez de uno; el contrato hay
que versionarlo y mantenerlo; en desarrollo hay que arrancar dos procesos (se
resuelve con un script `dev` del monorepo).

## Verificación

| Qué | Cómo se demuestra | Estado |
| --- | --- | --- |
| `undici` y `fastify` existen y son estables | `npm view undici version` → `8.12.1`; `npm view fastify version` → `5.12.7` | **[VERIFICADO]** |
| El motor no puede hablar con la base de datos | Prueba que lee `apps/engine/package.json` y falla si aparece `@prisma/client`, `pg` o `DATABASE_URL` en el código. Se ejecuta sin infraestructura. | [ESCRITO] — Fase 2 |
| El motor ejecuta una solicitud real | Servidor `node:http` en `127.0.0.1`, `POST /v1/execute`, comprobar `status`, `headers`, `timings` | [ESCRITO] — Fase 2, **ejecutable aquí** |
| Timeout, límite de tamaño y redirecciones | Servidor de pruebas que cuelga / devuelve 30 MB / encadena 10 redirecciones | [ESCRITO] — Fase 2, **ejecutable aquí** |
| Aislamiento de red real entre contenedores | Redes Docker separadas | **[NO VERIFICADO]** — no hay Docker |
