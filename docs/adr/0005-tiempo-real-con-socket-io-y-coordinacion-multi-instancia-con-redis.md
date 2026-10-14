# ADR-0005 — Tiempo real con Socket.IO y coordinación multi-instancia con Redis

- **Estado:** Aceptada
- **Fecha:** 2026-10-14
- **Decide:** `software-architect`
- **Ámbito:** 4.A.5 del `BRIEF.md`; §5 «Colaboración en tiempo real» del `PROMPT-MAESTRO.md`
- **Depende de:** ADR-0001, ADR-0004

## Contexto

El §5 del prompt maestro pide ocho cosas, y conviene leerlas como lo que son
—ocho requisitos distintos— y no como «hacer WebSockets»:

1. Actualizaciones de colecciones.
2. Sincronización de carpetas y endpoints.
3. Notificaciones de cambios.
4. Indicadores de usuarios conectados.
5. **Control de concurrencia.**
6. **Prevención de sobrescrituras silenciosas.**
7. **Revalidación de permisos en cada operación.**
8. Manejo de desconexiones y reconexiones.

Más: «No es necesario implementar edición simultánea carácter por carácter en la
primera versión, **pero la arquitectura debe permitir incorporarla**».

Los puntos 5 y 6 **no son problemas de WebSocket**. Son problemas de modelo de
datos y de API REST. Un WebSocket transporta avisos; no impide que dos usuarios
pisen el mismo recurso. Lo digo explícitamente porque es el error habitual al
leer esta sección: si la prevención de sobrescrituras se intenta resolver en la
capa de sockets, no se resuelve.

El `.env.example` ya commiteado describe `REDIS_URL` como «cache, colas,
**coordinacion de websockets**» [VERIFICADO], lo que confirma la intención.

**Aquí no hay Redis** [VERIFICADO: `command -v redis-server` → no existe]. Esa
restricción moldea la decisión en lugar de bloquearla.

## Decisión

### 1. Transporte: **Socket.IO 4.8.4**, vía `@nestjs/platform-socket.io 12.1.3`

[VERIFICADO: `npm view socket.io version` → `4.8.4`;
`@nestjs/platform-socket.io@12.1.3` trae `socket.io 4.8.4` como dependencia.]

Frente a `ws` desnudo (8.22.0), Socket.IO aporta tres cosas que de otro modo
habría que escribir y mantener a mano: **salas** (el mecanismo natural de
difusión por workspace/colección), **reconexión automática con backoff**
(requisito 8) y **un adaptador Redis oficial**. Reimplementar eso es trabajo sin
valor de producto y una fuente garantizada de errores sutiles.

Coste asumido: protocolo propio de Socket.IO, no WebSocket puro. Irrelevante
aquí, porque **el único cliente es nuestro frontend** (`socket.io-client
4.8.4`). Si algún día CEIBA expone tiempo real a terceros, se añade una pasarela
WebSocket estándar; no condiciona esta decisión.

### 2. `transports: ['websocket']` — sin *long-polling*

Decisión poco visible y de alto impacto operativo: **se desactiva el fallback a
HTTP long-polling.**

Con long-polling activo, una sesión se reparte en varias peticiones HTTP que
**deben** llegar a la misma instancia, lo que obliga a **sticky sessions** en el
proxy inverso. Eso ata el escalado a la configuración de Nginx y produce fallos
intermitentes dificilísimos de diagnosticar cuando alguien despliega sin esa
configuración.

Con `transports: ['websocket']`, la conexión es una sola y persistente: **no
hace falta sticky session**, y cualquier instancia sirve a cualquier cliente.
Se pierde compatibilidad con redes corporativas que bloquean WebSocket; el
degradado aceptado es que la interfaz funciona igual, sólo que sin tiempo real,
refrescando bajo demanda. **[NO VERIFICADO]** — no hay Nginx ni despliegue aquí.

### 3. Multi-instancia: `@socket.io/redis-adapter` 8.3.0

[VERIFICADO: versión `8.3.0`. Su peer real es `socket.io-adapter ^2.5.4`, no
`socket.io`; resuelve a `2.5.8` a través de `socket.io 4.8.4`.]

Con N instancias de la API detrás del proxy, los clientes de una misma
colección caen en instancias distintas. El adaptador propaga la difusión por
Redis pub/sub, de modo que `server.to('col:123').emit(…)` llega a todos los
sockets de esa sala **estén donde estén**.

Dos conexiones Redis dedicadas (una publica, otra se suscribe), separadas de las
de BullMQ y de las de caché: una conexión en modo suscriptor no puede ejecutar
comandos normales. **[NO VERIFICADO]** — no hay Redis aquí.

### 4. ⭐ Degradación sin Redis: Redis **escala**, no **habilita**

**Regla vinculante:** la plataforma debe arrancar y funcionar en tiempo real
**sin Redis**, en una sola instancia, con el adaptador en memoria de Socket.IO.

```ts
// platform/realtime/adapter.factory.ts  (forma, no implementación)
const url = config.get('REDIS_URL')
if (!url) {
  logger.warn('REDIS_URL ausente: tiempo real en modo instancia única. No escalar horizontalmente.')
  return // adaptador en memoria por defecto
}
return createAdapter(pubClient, subClient)
```

Tres razones, en orden de importancia:

1. **Hace la funcionalidad verificable hoy.** Aquí no hay Redis. Si el tiempo
   real dependiera de él, toda la §5 sería [NO VERIFICADO] y no habría forma de
   demostrar el requisito 20 de la §20 («la colaboración no pierda cambios
   silenciosamente») hasta tener infraestructura. Con esta regla, **esa prueba
   se ejecuta en este contenedor**.
2. Reduce el coste de desarrollo: un `pnpm dev` y nada más.
3. Si Redis cae en producción, el sistema **se degrada** (los avisos no cruzan
   instancias) en vez de caerse.

Arranque **sin** `REDIS_URL` → aviso explícito en el log. Arranque con varias
instancias **y sin** `REDIS_URL` → eso sí es un error de configuración y debe
fallar al arrancar, no silenciosamente.

### 5. Prevención de sobrescrituras silenciosas: **bloqueo optimista, en REST**

Aquí se cumplen los requisitos 5 y 6, y **no** en la capa de sockets.

- Todo recurso mutable (`ApiRequest`, `Collection`, `CollectionFolder`,
  `Environment`) lleva un entero `version`.
- Toda mutación envía la versión que el cliente creía tener:

```http
PATCH /api/v1/requests/{id}
If-Match: "7"                 ← o  { "expectedVersion": 7 }  en el cuerpo
```

- El servidor actualiza con `WHERE id = ? AND version = ?` y
  `SET version = version + 1`. **Si afecta a 0 filas, nadie gana por accidente:**

```http
409 Conflict
{ "error": { "code": "VERSION_CONFLICT", "currentVersion": 9,
             "current": { … }, "changedBy": { "id": "…", "name": "Ana" } } }
```

- El cliente recibe el estado actual y decide. **El servidor nunca fusiona por
  su cuenta.**

Esta es la pieza que hace demostrable el requisito 20 de la §20, y es **una
prueba de integración de API, sin WebSocket**: dos peticiones concurrentes con
la misma `expectedVersion`, una devuelve 200 y la otra 409. Determinista.

El WebSocket sólo **avisa** de que hubo cambio; no es quien lo protege.

### 6. Revalidación de permisos en cada operación (requisito 7)

El §5 lo pide literalmente y es el punto donde más fácil es hacer trampa: lo
cómodo es autorizar en el `handshake` y confiar durante el resto de la sesión.
Si a un usuario se le revoca el acceso, seguiría recibiendo eventos hasta
reconectar.

**Decisión:**

1. **En el `handshake`:** se valida el token de sesión. Sin token válido, no hay
   conexión.
2. **Al entrar en una sala:** se comprueba el permiso sobre ese recurso contra
   la base de datos.
3. **En cada evento entrante:** se vuelve a comprobar, usando **el mismo guard
   que REST** (posible porque ambos viven en el contenedor de DI de NestJS,
   ADR-0001). Una sola implementación, un solo comportamiento.
4. **En cada difusión saliente:** la pertenencia a la sala es el permiso. Por
   eso las salas se nombran por recurso y **un cambio de permisos expulsa de la
   sala** (`socket.leave`), en lugar de esperar a la siguiente conexión.
5. **Caché de permisos en Redis con TTL corto (≤ 30 s)** e invalidación por
   evento `permission.changed`. El TTL es el techo del tiempo que un permiso
   revocado puede sobrevivir; la invalidación es el camino rápido. Sin Redis, la
   caché es en memoria por instancia, con el mismo TTL.

### 7. Salas y eventos

```
user:<userId>             privado: notificaciones dirigidas
ws:<workspaceId>          miembros del workspace: altas/bajas, presencia
col:<collectionId>        quien puede leer la colección: árbol y solicitudes
run:<runId>               progreso de una ejecución de colección
```

Eventos servidor → cliente (definidos en `packages/contracts/src/realtime/`,
ADR-0004):

| Evento | Carga | Disparo |
| --- | --- | --- |
| `collection.updated` | `{ collectionId, version, patch }` | alta/baja/renombrado/movimiento en el árbol |
| `request.updated` | `{ requestId, version, patch }` | cambio en una solicitud |
| `folder.moved` | `{ folderId, parentId, position, version }` | reordenación |
| `member.changed` | `{ workspaceId, userId, role }` | roles y membresías |
| `presence.changed` | `{ scope, users[] }` | entradas/salidas |
| `notification.created` | `{ notification }` | notificaciones |
| `run.progress` | `{ runId, done, total, lastResult }` | ejecución de colección |
| `permission.changed` | `{ scope }` | invalida caché y reevalúa salas |

**Los eventos llevan `version` y un *patch*, no el recurso entero.** Dos
motivos: no desperdiciar ancho de banda con colecciones grandes, y —más
importante— **permitir que el cliente detecte un hueco**: si recibe `version 9`
teniendo la 7, sabe que se perdió la 8 y pide una resincronización en vez de
pintar un estado incoherente.

**Ningún evento transporta secretos.** Los valores de variables marcadas como
sensibles y las configuraciones de autenticación **no viajan por el socket**;
el evento dice «cambió», y el cliente lo pide por REST, donde se aplican los
controles de secretos. (Modelo de secretos: `appsec-engineer`, ámbito 4.C.)

### 8. Desconexión y reconexión (requisito 8)

- El cliente reconecta con backoff exponencial (lo da Socket.IO).
- Al reconectar envía, por sala, la **última versión conocida**.
- El servidor responde `resync.required` si no puede cubrir el hueco, y el
  cliente recarga el recurso por REST.
- **No se intenta una cola de eventos perdidos por cliente.** Es estado por
  conexión, caro y propenso a fugas. Resincronizar contra la fuente de verdad es
  más simple y siempre correcto.
- Presencia: conjuntos en Redis con TTL refrescado por heartbeat, para que una
  instancia que muere no deje usuarios «conectados» para siempre. Sin Redis:
  en memoria, instancia única.

### 9. Camino abierto a la edición carácter por carácter

El §5 pide que la arquitectura la permita sin implementarla. Tres propiedades
del diseño la dejan abierta sin coste hoy:

1. Los eventos ya son **patches con versión**, no estados completos: es el mismo
   contrato que consume una capa de operaciones.
2. Las salas ya están **por recurso**, que es la granularidad de un documento
   colaborativo.
3. La autorización ya se revalida **por evento**, no por sesión.

Incorporarla sería añadir un tipo de evento y un motor CRDT/OT en el módulo
`collab`, **sin tocar el transporte ni la autorización**. No se diseña más allá:
diseñar hoy un CRDT que nadie va a usar es exactamente el sobrecoste que el
brief pide evitar.

## Papel de Redis en el sistema (tres usos, tres clientes)

| Uso | Mecanismo | Sin Redis |
| --- | --- | --- |
| Difusión entre instancias | `@socket.io/redis-adapter` pub/sub | instancia única, adaptador en memoria |
| Colas de trabajo | BullMQ 6.3.15 sobre ioredis 6.0.0 | ejecución en proceso, sin programados |
| Caché y rate limiting | claves con TTL | caché en memoria por instancia |

Conexiones separadas por uso: BullMQ requiere opciones de cliente propias y una
conexión en modo suscriptor no puede ejecutar comandos normales. **[NO
VERIFICADO]** — no hay Redis en este contenedor.

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
| --- | --- |
| `ws` desnudo | Hay que escribir salas, reconexión y difusión entre instancias. Trabajo sin valor de producto. |
| SSE (Server-Sent Events) | Unidireccional. Vale para notificaciones, no para presencia ni eventos del cliente. Y sufre el mismo problema de sticky sessions. |
| Sondeo periódico (*polling*) | Simple y robusto, pero no cumple «indicadores de usuarios conectados» con latencia aceptable, y carga la base de datos de forma proporcional a los usuarios ociosos. |
| Redis Streams en vez de pub/sub | Da persistencia de eventos, que no necesitamos: la fuente de verdad es PostgreSQL y la recuperación es resincronizar. Más complejidad sin beneficio. |
| Postgres `LISTEN/NOTIFY` para difundir | Evitaría Redis, pero Redis ya es obligatorio por las colas (§3), y `NOTIFY` tiene límite de carga útil y no cubre presencia. |
| Sticky sessions + long-polling | Ata el escalado a la configuración del proxy y produce fallos intermitentes. Ver punto 2. |
| Autorizar sólo en el handshake | Incumple el requisito 7 del §5. Es la trampa cómoda. |

## Consecuencias

**Positivas** — escala horizontal sin sticky sessions; el tiempo real se puede
probar **hoy, aquí, sin Redis**; la prevención de sobrescrituras es
determinista y comprobable con dos peticiones REST; una sola implementación de
autorización para REST y WebSocket; la edición colaborativa queda abierta.

**Negativas, asumidas** — Socket.IO impone su protocolo; sin long-polling se
pierden clientes en redes que bloquean WebSocket; la caché de permisos con TTL
de 30 s admite una ventana de permiso revocado (acotada y documentada); el
bloqueo optimista obliga al frontend a manejar 409 en todas las mutaciones, que
es trabajo real de interfaz.

## Verificación

| Qué | Cómo se demuestra | Estado |
| --- | --- | --- |
| Versiones existen | `npm view socket.io version` → `4.8.4`; `@socket.io/redis-adapter` → `8.3.0` | **[VERIFICADO]** |
| Sobrescritura silenciosa imposible (§20.20) | dos `PATCH` concurrentes con la misma `expectedVersion`: uno 200, otro 409 | [ESCRITO] — Fase 3, **ejecutable sin Redis** |
| Tiempo real funciona en instancia única | cliente de prueba Socket.IO contra la API, sin `REDIS_URL` | [ESCRITO] — Fase 3, **ejecutable sin Redis** |
| Un lector no puede emitir mutaciones por socket | prueba con rol lector; el evento se rechaza | [ESCRITO] — Fase 3 |
| Revocar permiso expulsa de la sala | revocar y comprobar que dejan de llegar eventos | [ESCRITO] — Fase 3 |
| Difusión entre dos instancias vía Redis | dos procesos + Redis; evento emitido en A llega a B | **[NO VERIFICADO]** — no hay Redis |
| Sin sticky sessions en el proxy | Nginx con varias instancias | **[NO VERIFICADO]** — no hay Nginx ni Docker |
