# ADR-0009 — Autenticación, sesiones, CSRF y modelo de roles

- **Estado:** Aceptada
- **Fecha:** 2026-10-14
- **Decide:** `software-architect`
- **Ámbito:** 3.A.1 del `BRIEF-FASE1.md`; decisión **C-31** del cliente; §5, §16 y §19 del `PROMPT-MAESTRO.md`
- **Depende de:** ADR-0001 (guardias declarativas y enumerables), ADR-0004 (límites de módulos), ADR-0003 (Prisma), ADR-0005 (Redis y tiempo real)
- **Implementa:** `apps/api/src/platform/auth/`, `apps/api/src/platform/guards/`, `modules/identity/`, y un puerto publicado por `modules/workspace/workspace.public.ts`
- **Cierra:** la capacidad que `CONTROLES.md` §11 declara literalmente *«pertenece a nadie en esta ronda»*

## Contexto

La decisión **C-31** ya está tomada por el cliente y **no se rediscute aquí**: sesión en
cookie `HttpOnly`, `Secure`, `SameSite=Lax`; CSRF en toda operación mutante; sesiones
revocables; expiración y renovación; **prohibidos los tokens de sesión en `localStorage`**.
Este ADR decide **cómo** se implementa eso sobre el esquema y los módulos que ya existen.

Hasta hoy no existía: lo comprobé antes de escribir. Sobre los ocho ADR de la fase 0
**tal y como quedaron en el commit `bf020a3`**, `csrf`, `cookie`, `HttpOnly`, `SameSite`,
`refresh token` y `rbac` dan **cero coincidencias**; `roles` aparece 6 veces y ninguna
diseña nada.

### Lo que pide el prompt maestro, y una corrección de referencia

El §16 «Seguridad obligatoria» es la fuente. Exige, literalmente: «Autenticación segura»,
«Autorización en el servidor», «**Protección contra CSRF cuando corresponda**», «Rate
limiting», «**Gestión segura de sesiones**», «**Gestión segura de cookies**», «**Política
de expiración de sesiones**» y «Auditoría de operaciones sensibles». El §5 define los cinco
roles y cierra con: «**Implementa autorización en el backend. No basta con ocultar botones
en el frontend.**» El §19 añade: «**No permitas que conocer un ID sea suficiente para
acceder a un recurso privado.**»

> **Corrección de referencia, con evidencia.** El encargo me remite a «el apartado §20.4
> (roles y permisos)». **No existe tal apartado.** El §20 es «Pruebas obligatorias» y su
> punto 4 es `4. Asignar roles y verificar permisos.`, es decir **un requisito de prueba**.
> La especificación de roles está en el **§5 → `### Roles`**. Diseño contra el §5 y dejo
> el §20.4 como la prueba que este ADR debe hacer superable. No cambio el fondo: sólo
> nombro bien la fuente.

### Lo que el esquema ya decidió por mí

La tabla `sessions` de `docs/schema/ceiba.dbml` no es neutra: ya impone un diseño, y es el
correcto. La leí entera antes de decidir (líneas 411–440) y **diseño sobre ella**:

| Columna | Qué impone |
| --- | --- |
| `token_selector` + `token_verifier_hash` | Patrón **selector/verificador**: búsqueda O(1) por índice único, comparación en tiempo constante. **Nada de JWT**: no hay columna de firma ni de *claims*. |
| `parent_session_id` | **Rotación con detección de reutilización**. La columna existe exactamente para esto. |
| `absolute_expires_at` | Caducidad dura, «no se extiende con el uso». |
| `idle_expires_at` | Caducidad por inactividad, «se desplaza al refrescar». |
| `revoked_at` / `revoked_reason` | **Revocación explícita desde el servidor**. |
| `user_agent`, `client_ip`, `device_label`, `last_seen_at` | La lista de dispositivos y el cierre de sesión en todos ellos. |

Y `workspace_members` lleva su propia instrucción: *«Tabla de autorizacion canonica: TODA
comprobacion de permiso del backend resuelve contra esta fila, no contra el frontend
(seccion 5).»*

## Decisión

### 1. Sesión con estado en servidor. Nunca un JWT

**La fila de `sessions` *es* la sesión.** La cookie sólo transporta un identificador opaco.
No hay testigo firmado que lleve dentro la identidad, el rol ni la caducidad.

Tres razones, y la tercera es la que cierra el debate:

1. **Revocación inmediata.** El §16 exige política de expiración y el §5 «revalidación de
   permisos en cada operación». Un JWT emitido sigue siendo válido hasta que caduca.
2. **El esquema no admite otra cosa:** `sessions` no tiene dónde guardar una firma, y sí
   tiene `revoked_at`, `parent_session_id` y doble caducidad.
3. **Ya es jurisprudencia del proyecto.** `CONTROLES.md` C-CODE-06 razona, para la sesión
   de compartición: *«Si se decidiera usar JWT, su vida máxima sería de 60 segundos y haría
   falta igualmente la comprobación en base de datos: entonces el JWT no aporta nada.»*
   Lo mismo vale, con más motivo, para la sesión de usuario. **Dos mecanismos distintos
   para el mismo problema en el mismo producto sería una incoherencia gratuita.**

> **Contradicción detectada con `.env.example`.** El fichero declara hoy
> `CEIBA_JWT_SECRET`, `CEIBA_ACCESS_TOKEN_TTL=15m` y `CEIBA_REFRESH_TOKEN_TTL=30d`, es
> decir, **presupone JWT**. Es incompatible con C-31 y con la tabla `sessions`.
> `.env.example` **no está en mi ámbito de escritura**; queda como HUECO al final.

### 2. La cookie de sesión

| Atributo | Valor | Por qué |
| --- | --- | --- |
| Nombre | `__Host-ceiba_session` | El prefijo `__Host-` lo **impone el navegador**: obliga a `Secure`, a `Path=/` y a **no** tener `Domain`. Un subdominio comprometido no puede sobrescribirla. |
| Valor | `<selector>.<verificador>` opaco, base64url | selector 128 bits, verificador 256 bits, de `crypto.randomBytes`. Sin significado, sin PII, sin estructura adivinable. |
| `HttpOnly` | sí | **C-31.** El JavaScript de la página no la lee: un XSS no exfiltra la sesión. |
| `Secure` | sí | **C-31.** |
| `SameSite` | `Lax` | **C-31.** Primera barrera CSRF; ver §5. |
| `Path` | `/` | Exigido por `__Host-`. |
| `Domain` | **ausente** | Exigido por `__Host-`. La cookie no se filtra a subdominios. |
| `Max-Age` | el de `absolute_expires_at` | La cookie no sobrevive a la sesión del servidor. |

**Validación en cada petición:** separar `selector`, buscar por `uq_sessions_selector`,
comparar `SHA-256(verificador)` contra `token_verifier_hash` con `crypto.timingSafeEqual`,
y exigir `revoked_at IS NULL AND now() < absolute_expires_at AND now() < idle_expires_at`.
Si algo falla: **una sola respuesta** `401` idéntica para todos los casos.

> **Por qué SHA-256 aquí y Argon2id en las contraseñas.** El verificador son 256 bits
> aleatorios: no hay diccionario que atacar, y un KDF lento convertiría cada petición
> autenticada en trabajo costoso. La contraseña sí es de baja entropía y va con Argon2id
> (§8). Es la misma lógica que `share_access_codes` aplica con sus parámetros.

**Sin caché por defecto.** La validación es una lectura por índice único. Si la medición lo
exigiera, se admite caché de **≤ 5 s** con invalidación activa por el canal Redis del
ADR-0005 — el mismo techo que C-CODE-06 fija para la sesión de compartición. Nunca más.

### 3. Expiración absoluta y por inactividad

| Parámetro | Valor por defecto | Comportamiento |
| --- | --- | --- |
| `absolute_expires_at` | `issued_at + 30 d` | **Nunca se extiende**, tampoco al rotar. 30 d es el techo habitual de una sesión «recuérdame»; no lo tomo del `.env.example`, cuyo `CEIBA_REFRESH_TOKEN_TTL` pertenece al esquema JWT que este ADR deroga. |
| `idle_expires_at` | `last_seen_at + 7 d` | Se **recalcula** a partir de `last_seen_at` cada vez que éste se escribe. |
| Escritura de `last_seen_at` | como mucho **1 vez / 60 s** por sesión | Evita un `UPDATE` por petición. **Consecuencia aceptada:** la inactividad se mide con granularidad de 60 s, no al segundo. Con una ventana de 7 d es irrelevante. |

La caducidad se evalúa **siempre con la hora del servidor**, nunca con una fecha enviada
por el cliente. Las filas caducadas se purgan físicamente a los 30 días, como manda la nota
del esquema.

### 4. Renovación: rotación del testigo y detección de reutilización

Ésta es la parte que `parent_session_id` existe para soportar.

**Rotación.** Cada **24 h de uso continuado**, y obligatoriamente tras cualquier cambio de
credenciales, la sesión se rota en una sola transacción:

1. Se inserta una fila **nueva** con `parent_session_id = <sesión actual>`, selector y
   verificador nuevos, `absolute_expires_at` **heredado sin cambios** (la rotación no
   alarga la vida absoluta) e `idle_expires_at` recalculado.
2. La fila anterior se marca `revoked_at = now()`, `revoked_reason = 'rotated'`.
3. Se emite la cookie nueva en la misma respuesta.

**Detección de reutilización.** Si llega una petición cuyo selector resuelve a una fila con
`revoked_reason = 'rotated'`, eso significa que **alguien está usando un testigo ya
rotado**: o es un robo, o es una carrera de red. Se trata como robo:

```sql
-- Revocar la FAMILIA entera: se sube hasta la raiz y se baja por todos sus descendientes.
WITH RECURSIVE ancestros AS (
    -- (1) subir: de la sesion presentada hacia sus padres
    SELECT id, parent_session_id FROM sessions WHERE id = :sesionPresentada
  UNION ALL
    SELECT s.id, s.parent_session_id
      FROM sessions s JOIN ancestros a ON s.id = a.parent_session_id
),
raiz AS (
    -- (2) la raiz es la unica sin padre, NO la de menor id
    SELECT id FROM ancestros WHERE parent_session_id IS NULL
),
familia AS (
    -- (3) bajar: la raiz y toda su descendencia.
    -- UNION (no UNION ALL): deduplica y corta cualquier ciclo accidental.
    SELECT id FROM raiz
  UNION
    SELECT s.id FROM sessions s JOIN familia f ON s.parent_session_id = f.id
)
UPDATE sessions SET revoked_at = now(), revoked_reason = 'reuse_detected'
 WHERE revoked_at IS NULL
   AND (
     id IN (SELECT id FROM familia)
     -- Fallo CERRADO: si por lo que sea la familia saliera vacia, se revoca
     -- todo lo vivo del usuario. Nunca 0 filas ante una reutilizacion.
     OR (NOT EXISTS (SELECT 1 FROM familia) AND user_id = :usuarioDeLaSesion)
   );
```

El índice `ix_sessions_parent` sostiene el recorrido descendente (3); el ascendente (1) va
por clave primaria. Tras revocar: evento de auditoría `session.reuse_detected` y
notificación al usuario. **El atacante y la víctima pierden la sesión a la vez**, que es el
comportamiento correcto: sin revocar la familia, el ladrón se queda dentro y el legítimo
sólo nota una molestia.

> **Hasta dónde llega realmente esta detección, sin venderla de más.** Detecta el **uso
> del testigo viejo tras una rotación**, no el robo en sí. Mientras el ladrón y la
> víctima no crucen un límite de rotación, **ambos coexisten sin alarma**: con rotación
> cada 24 h, la latencia de detección en el peor caso es de **24 h**. Se acorta rotando
> también ante operaciones sensibles (cambio de correo, de rol, creación de enlaces
> compartidos), que es lo que recomiendo; reducir el periodo general es caro en escrituras.
> Lo que **no** hace es sustituir a la expiración ni a la lista de dispositivos del §9.

> **Tres precisiones de implementación, porque aquí es fácil equivocarse.**
> **(a)** La raíz se identifica por `parent_session_id IS NULL`, **no** por el `id` más
> bajo: aunque UUIDv7 sea ordenable en el tiempo, apoyarse en eso sería un acoplamiento
> silencioso al formato de la clave.
> **(b)** La purga física **no** deja huérfana la cadena: la FK `fk_sessions_parent` es
> `ON DELETE SET NULL`, así que al borrar un eslabón su hijo pasa a tener
> `parent_session_id = NULL` y **se convierte él mismo en raíz**. Aun así, la rama
> `NOT EXISTS` del `UPDATE` existe para que una familia vacía **nunca** se traduzca en
> cero filas revocadas: ante una reutilización, fallar abierto es inaceptable.
> **(c)** Se usa `UNION`, no `UNION ALL`, en el descenso: `sessions.parent_session_id` es
> autorreferencial y el esquema **no** tiene `CHECK (id <> parent_session_id)`, así que un
> ciclo por corrupción colgaría una recursión infinita manteniendo bloqueos de escritura.
> `UNION` deduplica y corta el ciclo.
>
> Variante más simple y **igualmente aceptable**: revocar siempre todas las sesiones vivas
> del usuario ante una reutilización detectada. Cuesta una molestia al usuario legítimo y
> elimina el recorrido recursivo entero.

> **Tolerancia a la carrera de red, acotada.** Un cliente lento puede reintentar con el
> testigo viejo legítimamente. Se admite una ventana de gracia de **10 s** desde
> `revoked_at`, **sólo** si la petición llega con el mismo `client_ip` y el mismo
> `user_agent`.
>
> **Qué se hace exactamente en esa ventana, porque lo obvio es imposible.** El servidor
> **no puede reenviar la cookie vigente**: de la sesión hija sólo guarda
> `token_verifier_hash`, y el verificador en claro se destruyó al emitirlo
> (`«El token en claro nunca se guarda»`, nota del esquema). Lo que se hace es:
> localizar la **hija viva** de la sesión presentada (`parent_session_id = :presentada`,
> `revoked_at IS NULL`), **rotarla otra vez** —fila nueva, nieta de la presentada, con
> selector y verificador nuevos—, revocar la hija intermedia con `rotated`, y devolver
> **esa** cookie nueva. No se revoca la familia. Fuera de la ventana, o con huella
> distinta, es reutilización y se aplica el `UPDATE` de arriba.
>
> Sin esta cláusula el diseño expulsa a usuarios legítimos con mala red; con ella sin
> acotar, no detecta nada.

**Vocabulario normativo de `revoked_reason`** (la columna es texto libre; lo cierro aquí):
`logout` · `logout_all` · `rotated` · `reuse_detected` · `expired_idle` ·
`expired_absolute` · `password_changed` · `mfa_changed` · `admin_revoked` ·
`membership_revoked` · `user_deactivated`.

### 5. CSRF en toda operación mutante

**Tres barreras independientes.** Ninguna basta sola, y el esquema no tiene dónde guardar
estado de CSRF, así que la segunda es sin estado por diseño.

| # | Barrera | Qué hace |
| --- | --- | --- |
| 1 | `SameSite=Lax` | El navegador no envía la cookie en POST entre sitios. No cubre navegadores viejos ni `GET` mutantes. |
| 2 | **Doble envío firmado** | Cookie `__Host-ceiba_csrf` (**sin** `HttpOnly`, la SPA debe leerla) + cabecera `x-ceiba-csrf` con el mismo valor firmado con HMAC. El atacante entre sitios no puede leer la cookie ni, por tanto, poner la cabecera. Implementado con `@fastify/csrf-protection`. |

**De dónde sale la cookie CSRF en el primer POST**, que es el detalle que suele faltar: se
acuña **sin sesión**. Cualquier `GET` de navegación que no la traiga recibe una
`__Host-ceiba_csrf` nueva en la respuesta, y hay un `GET /api/v1/auth/csrf` explícito para
que la SPA la pida antes de su primer envío. Al iniciar sesión **se rota**, para que el
testigo previo a la autenticación no siga siendo válido después. Sin esto, el propio
`POST /auth/login` sería imposible de proteger.
| 3 | **Comprobación de `Origin`/`Referer`** | En **toda** petición mutante se exige que `Origin` (o `Referer` si falta) coincida con `CEIBA_PUBLIC_URL`. Si no hay ninguna de las dos cabeceras, **se deniega**. Falla cerrado. |

**Alcance:** `POST`, `PUT`, `PATCH` y `DELETE`, **sin excepciones**, incluidos el inicio de
sesión (el *login CSRF* es real: fija la sesión del atacante en el navegador de la víctima)
y los endpoints de la sesión de compartición. **Ningún `GET`, `HEAD` u `OPTIONS` puede
mutar estado**; esto es enumerable y se prueba recorriendo el `RouterExplorer`, igual que
la prueba de guardias del ADR-0001.

> **WebSocket: `SameSite` no protege el handshake.** Un `WebSocket`/`socket.io` abierto
> desde otro origen **lleva las cookies** y no está sujeto a la política de formularios.
> Por eso el handshake de Socket.IO (ADR-0005) **valida `Origin` contra
> `CEIBA_PUBLIC_URL` y rechaza la conexión si no coincide**, además de validar la sesión.
> Es un punto que se olvida con frecuencia y aquí queda escrito.

### 6. Detrás de Nginx y HTTPS

El cliente pidió esto expresamente. Es donde un diseño correcto se rompe en producción.

#### 6.1 `trust proxy` es un control de seguridad, no un ajuste

Fastify arranca con `trustProxy` **limitado a la red del proxy**, nunca `true`:

```ts
// apps/api/src/main.ts  — el valor sale de CEIBA_TRUSTED_PROXIES, nunca fijo en código
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter({ trustProxy: process.env.CEIBA_TRUSTED_PROXIES /* p.ej. '10.0.0.0/8' */ }),
);
```

**Por qué importa más de lo que parece:** `sessions.client_ip` y
`share_access_attempts.client_ip_prefix` alimentan la limitación de intentos de C-CODE-03 y
la auditoría. Con `trustProxy: true`, **cualquiera puede falsificar `X-Forwarded-For`** y
con ello evadir el límite por IP y envenenar el registro de auditoría. Con `trustProxy`
acotado al CIDR del proxy, la IP del cliente se toma del último salto de confianza.

Correlato obligatorio en Nginx: **borrar las cabeceras `X-Forwarded-*` que lleguen del
cliente** antes de fijar las suyas. Si Nginx añade sin borrar, la lista queda contaminada
por la izquierda y `trustProxy` vuelve a ser engañable.

#### 6.2 Lo que Nginx debe enviar

| Cabecera | Valor | Si falta |
| --- | --- | --- |
| `Host` | `$host` | Las URL absolutas y la comprobación de `Origin` fallan |
| `X-Forwarded-Proto` | `$scheme` | **La aplicación cree que es HTTP y puede omitir `Secure`** |
| `X-Forwarded-For` | `$proxy_add_x_forwarded_for` | Todas las IP registradas son las del proxy |
| `X-Forwarded-Host` | `$host` | Redirecciones y enlaces de invitación mal formados |
| `Upgrade` / `Connection` | para `/ws` | El WebSocket del ADR-0005 no establece |

> Esto es **requisito para `devops-release`** (ámbito 3.D), que es quien escribe
> `infra/`. Yo fijo el contrato; no escribo su fichero.

#### 6.3 Dominios: el origen único es un requisito, no una casualidad

La topología de `ARQUITECTURA.md` §2 sirve la SPA en `/` y la API en `/api` y `/ws`
**detrás del mismo Nginx**. Eso significa **mismo origen**, y de ahí se derivan tres cosas:

- `SameSite=Lax` **basta**: no hay peticiones legítimas entre sitios que deban llevar la cookie.
- **No hace falta CORS con credenciales.** No se configura `Access-Control-Allow-Credentials`.
- El prefijo `__Host-` es viable, porque no se necesita compartir la cookie entre subdominios.

> **Si alguna vez la SPA se sirve desde otro dominio**, habría que pasar a
> `SameSite=None; Secure` + CORS con credenciales, lo que **elimina la barrera 1 de la §5**
> y deja el CSRF colgando del doble envío y del `Origin`. **Es un cambio de postura de
> seguridad, no de despliegue, y exige un ADR nuevo.** Queda escrito para que nadie lo
> haga por comodidad.

El visor de respuestas remotas va en **dominio separado**, no en un subdominio
(C-LEAK-06). Siendo un dominio registrable distinto, la cookie de sesión no llega allí por
la propia política de origen, con prefijo o sin él; lo que `__Host-` añade es impedir que
un **subdominio** de CEIBA la sobrescriba o la lea.

#### 6.4 `Secure` en desarrollo

`Secure` exige contexto seguro. Los navegadores tratan `http://localhost` como contexto
seguro, así que la cookie `__Host-` **debería** funcionar en desarrollo sin TLS.
**[NO VERIFICADO]:** la automatización de navegador está bloqueada por política y no lo he
comprobado. Por eso el valor se expone como `CEIBA_COOKIE_SECURE` (por defecto `true`) y
**sólo** puede ponerse a `false` si `NODE_ENV !== 'production'`; en producción, un intento
de desactivarlo **aborta el arranque**. La decisión no se delega a una variable mal puesta.

### 7. Dónde se evalúan los roles

**Respuesta corta:** en **un único guard declarativo de `platform/guards/`**, que resuelve
contra `workspace_members` a través de un puerto publicado por `workspace.public.ts`.

#### 7.1 Tres principales distintos, sin herencia entre ellos

| Principal | Credencial | Dónde se valida | Qué puede |
| --- | --- | --- | --- |
| **Usuario** | cookie `__Host-ceiba_session` | `SessionGuard` + `AuthorizationGuard` | lo que diga su fila de `workspace_members` |
| **Visitante de enlace** | cookie de sesión de compartición, `Path=/share` (C-CODE-06) | guard propio de `sharing` | **sólo** la lista blanca de C-CODE-07 |
| **API → motor** | `CEIBA_ENGINE_TOKEN` (ADR-0002) | el motor | ejecutar HTTP; no sabe qué es un usuario |

**No se traducen entre sí.** Una sesión de compartición **nunca** se convierte en el
usuario propietario (C-CODE-07 es explícito). Un usuario con sesión que abre un enlace
compartido sigue siendo evaluado por el permiso del enlace en las rutas de `/share`.

#### 7.2 Por qué el rol **no** viaja en la cookie ni en la fila de `sessions`

Tres razones independientes, y cualquiera bastaría:

1. **Revocación.** El §5 exige revalidar permisos en cada operación. Un rol incrustado en
   la credencial sobrevive al cambio de rol hasta que la sesión caduque.
2. **Propiedad de módulos (ADR-0004).** `Sessions` es de `identity`; `WorkspaceMembers` es
   de `workspace`. Y **`workspace` depende de `identity`, no al revés**: que `identity`
   consultara roles crearía un ciclo y rompería la verificación `madge --circular`.
3. **Un usuario tiene N roles**, uno por workspace. No hay «el rol» que meter en la cookie.

#### 7.3 Forma del guard

Declarativo y **enumerable**, como exige el ADR-0001 («un control que no se puede enumerar
no se puede auditar»):

```ts
@RequireWorkspaceRole('editor')          // mínimo exigido; la jerarquía la resuelve el guard
@Patch(':collectionId')
update(/* … */) {}
```

- Vive en `platform/guards/authorization.guard.ts` y **no toca Prisma**.
- **Un solo objeto** reutilizado por REST, por los *gateways* de Socket.IO y por los
  procesadores de BullMQ (ADR-0001 §6). Si fueran dos implementaciones, divergirían.

> **Inversión de dependencia obligatoria, o el grafo de módulos se rompe.** El ADR-0004
> declara `platform` con **cero dependencias** y el grafo
> `platform → identity → workspace → collection`. Si `platform/guards` importara
> `workspace.public.ts`, el grafo quedaría `platform → workspace → identity → platform`:
> **un ciclo**, y `madge --circular` dejaría de salir en verde. Sería exactamente el mismo
> error que la §7.2 usa para rechazar el rol dentro de la sesión. Por eso:
>
> - La **interfaz** `WorkspaceAuthorizationPort` y su testigo de inyección
>   `WORKSPACE_AUTHORIZATION_PORT` se declaran en **`platform/auth/ports.ts`**.
> - **`modules/workspace` la implementa** y registra el enlace. `workspace` importando
>   `platform` es la dirección **permitida**, la que ya existe en el grafo.
> - El guard la recibe **por testigo de DI**, sin ningún import estático hacia `modules/`.
>
> Así, el código que conoce `workspace_members` sigue siendo sólo el de `workspace`
> (ADR-0004 §5), pero la flecha de compilación apunta al revés que la flecha de llamada.
> **Esto matiza al ADR-0004**, que suponía que todo puerto se publica en un
> `*.public.ts`: para un consumidor en `platform` eso es imposible, y la salida es que
> **`platform` declare el puerto y el módulo lo implemente**. Lo digo aquí en vez de
> dejar que aparezca como un ciclo sorpresa en la primera ejecución de `madge`.
- Testable con dobles, **sin base de datos**: es la prueba obligatoria n.º 4 del §20 y se
  puede ejecutar en este contenedor.
- Caché de la resolución de rol: **TTL ≤ 30 s** con invalidación por el evento
  `permission.changed`, exactamente como ya fijó `ARQUITECTURA.md` §7.5. No lo cambio.

#### 7.4 Resolución por recurso: conocer el ID no basta (§19)

Todo recurso protegido resuelve **a su `workspace_id`** antes de autorizar, y el guard
comprueba la fila `workspace_members (workspace_id, user_id)` con `status = 'active'`.
No existe ninguna ruta que autorice por posesión del identificador. La denegación devuelve
**`404`**, no `403`, cuando revelar la existencia del recurso ya sería una fuga.

#### 7.5 Matriz rol × operación (normativa)

Jerarquía: `owner > admin > editor > executor > viewer`. **Lista de permitidos: lo que no
está, se deniega.**

| Operación | owner | admin | editor | executor | viewer |
| --- | :-: | :-: | :-: | :-: | :-: |
| Borrar el workspace · transferir propiedad | ✔ | ✘ | ✘ | ✘ | ✘ |
| Cambiar ajustes del workspace (`allow_public_sharing`, retención) | ✔ | ✔ | ✘ | ✘ | ✘ |
| Invitar · cambiar rol · expulsar miembros | ✔ | ✔ | ✘ | ✘ | ✘ |
| Leer la auditoría del workspace | ✔ | ✔ | ✘ | ✘ | ✘ |
| Crear · revocar enlaces compartidos y códigos | ✔ | ✔ | ✘ | ✘ | ✘ |
| Crear/modificar/borrar colecciones, carpetas, solicitudes | ✔ | ✔ | ✔ | ✘ | ✘ |
| Crear/modificar entornos, variables y configuraciones de auth | ✔ | ✔ | ✔ | ✘ | ✘ |
| Crear/rotar secretos | ✔ | ✔ | ✔ | ✘ | ✘ |
| **Ejecutar** solicitudes, ejecuciones de colección y tests | ✔ | ✔ | ✔ | ✔ | ✘ |
| Usar un secreto **dentro de una ejecución** (sin verlo) | ✔ | ✔ | ✔ | ✔ | ✘ |
| Leer colecciones, entornos (valores no secretos) e historial propio | ✔ | ✔ | ✔ | ✔ | ✔ |
| **Ver el valor en claro de un secreto** | ✘ | ✘ | ✘ | ✘ | ✘ |
| Escribir variables de ámbito `global` | ✘ | ✘ | ✘ | ✘ | ✘ |

Las dos últimas filas no son erratas:

- **Ningún rol de workspace revela un secreto en claro.** Se usan en ejecución y se
  devuelven enmascarados (ADR-0006 §4, C-LEAK-04). Esto responde al punto que
  `CONTROLES.md` C-SEC deja abierto como «control de acceso por rol al descifrado»: **el
  rol que permite leer un secreto no existe**. El criptosistema sigue siendo de
  `appsec-engineer`.
- `scoped_variables` con `scope = 'global'` está anotado «Solo administradores de
  plataforma», y **ese rol no existe en el esquema**. Hasta que exista, la escritura global
  no es alcanzable por la API. Va como HUECO.

**Nomenclatura:** se usa la del esquema — `viewer | viewer_export | executor` para
`share_permission`. `CONTROLES.md` C-CODE-07 los llama `reader | reader_export | executor`;
son los mismos tres conceptos y **manda el esquema**, según la cláusula de deferencia del
ADR-0004.

### 8. Inicio de sesión, bloqueo y no enumeración

- **Contraseña:** Argon2id en `users.password_hash`, con el perfil de C-CODE-02
  (`m=19456, t=2, p=1`, sal de 16 bytes, formato PHC) para no tener dos perfiles
  criptográficos en el producto. `password_updated_at` se actualiza siempre.
- **No enumeración:** respuesta y tiempo idénticos para «correo inexistente», «contraseña
  incorrecta», «cuenta bloqueada», «cuenta no activa». Si el correo no existe se calcula
  **igualmente** un hash señuelo (misma técnica que C-CODE-04). El motivo real sólo va al
  registro interno.
- **Fuerza bruta:** `failed_login_count` y `locked_until`. Backoff exponencial, **no**
  bloqueo binario, por la misma razón que C-CODE-03: un bloqueo duro permite que un tercero
  deje fuera a un usuario legítimo. Límite adicional por IP.
- **Estado:** sólo `status = 'active'` y `deleted_at IS NULL` obtienen sesión.
- **Segundo factor:** si `mfa_enabled`, la contraseña **no** emite sesión. Emite un reto de
  corta vida y la fila de `sessions` se crea **sólo** tras validar el TOTP contra
  `mfa_secret_id`. No hay sesión «a medias» en la tabla.
- **Al cambiar la contraseña o el 2FA:** se revocan **todas** las sesiones del usuario con
  `password_changed` / `mfa_changed`, salvo la que ejecuta el cambio, que se **rota**.

### 9. Cierre de sesión, y cierre en todos los dispositivos

| Operación | Efecto |
| --- | --- |
| `POST /api/v1/auth/logout` | `revoked_at = now()`, `revoked_reason = 'logout'` en **esa** fila; cookie borrada |
| `POST /api/v1/auth/sessions/revoke-all` | revoca **todas** las filas vivas del usuario (`logout_all`) |
| `DELETE /api/v1/auth/sessions/:id` | revoca **una** sesión concreta: `logout` si la cierra su propio dueño desde la lista de dispositivos, `admin_revoked` sólo si la cierra un tercero autorizado |
| `GET /api/v1/auth/sessions` | lista `device_label`, `user_agent`, `client_ip`, `last_seen_at`, `issued_at` |

La revocación **debe expulsar también las conexiones vivas**: emite `session.revoked` por
el canal Redis del ADR-0005 para que **todas** las instancias cierren los sockets de esa
sesión. Sin eso, un WebSocket ya establecido sobrevive al cierre de sesión, que es
precisamente el fallo que el §5 pide evitar.

Al expulsar a un miembro de un workspace **no** se revoca su sesión (puede pertenecer a
otros): se invalida su caché de permisos con `permission.changed` y el guard deniega en la
siguiente operación.

### 10. Auditoría

Por **evento de dominio** hacia `audit`, nunca por llamada directa (ADR-0004: `audit` no
depende de nadie). `audit_logs.session_id` **se puebla siempre** que haya sesión. Verbos,
conformes al `CHECK (action ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')`:

`auth.login` · `auth.login_failed` · `auth.locked_out` · `auth.logout` · `auth.logout_all` ·
`auth.mfa_enabled` · `auth.password_changed` · `session.rotated` · `session.revoked` ·
`session.reuse_detected` · `member.invited` · `member.role_changed` · `member.removed`.

`metadata` **nunca** contiene contraseñas, testigos, selectores ni verificadores.

### 11. Lo explícitamente prohibido

1. **Tokens de sesión en `localStorage` o `sessionStorage`** (C-31). Es verificable: una
   prueba recorre `apps/web` y falla si aparece `localStorage.setItem` con algo marcado
   como credencial.
2. **JWT como sesión de usuario.**
3. **El rol dentro de la cookie o de la fila de sesión.**
4. **Autorización sólo en el frontend** (§5, literal).
5. **`trustProxy: true`.**

### 12. Dependencias nuevas

Amplían la lista del ADR-0001, que sólo nombraba `@fastify/helmet` y `@fastify/multipart`.
No lo contradigo; lo extiendo, y lo digo:

| Paquete | Versión en el registro hoy | Nota |
| --- | --- | --- |
| `@fastify/cookie` | **11.1.3** | depende de `fastify-plugin ^6.0.0` |
| `@fastify/csrf-protection` | **8.0.2** | depende de `@fastify/csrf ^8`, `fastify-plugin ^6` |
| `@fastify/rate-limit` | **11.2.1** | para el límite global del §16, hoy sin dueño |

`fastify-plugin@6` es la generación de **Fastify 5**, que es la línea fijada por el
ADR-0001 (`fastify 5.12.7`). **[VERIFICADO]** que las versiones existen y cuáles son sus
dependencias (consulta al registro npm, hoy). **[NO VERIFICADO]** que instalen y resuelvan
juntas: no ejecuto `pnpm install` en la raíz, por la contención de lockfile de la fase 1.

Registro en `app.module.ts` con **una sola línea** vía `AuthModule.forRoot()`, según la
regla de ficheros de costura del ADR-0004.

---

## Alternativas consideradas

| Alternativa | Por qué se rechaza |
| --- | --- |
| JWT de acceso corto + refresh en cookie | Dos mecanismos donde basta uno. La revocación sigue exigiendo consulta a la base de datos, así que el JWT no ahorra nada; y el esquema no tiene dónde guardar la firma. C-CODE-06 ya razonó esto para la compartición. |
| Token de sesión en `localStorage` con cabecera `Authorization` | **Prohibido por C-31.** Un XSS lo exfiltra; una cookie `HttpOnly`, no. |
| `SameSite=Strict` | Rompe la navegación entrante legítima (abrir un enlace de invitación desde el correo deja al usuario deslogueado). `Lax` + doble envío + `Origin` da mejor relación seguridad/usabilidad. C-31 además fija `Lax`. |
| Sólo `SameSite=Lax`, sin testigo CSRF | Deja fuera navegadores antiguos y cualquier hueco de implementación del navegador. El §16 pide protección CSRF explícita. |
| Patrón sincronizador con estado de CSRF en base de datos | No hay tabla para ello en el esquema y añadirla sería pedir un cambio destructivo en plena fase 1. El doble envío firmado no necesita estado. |
| Guardar el rol en la sesión para ahorrar una consulta | Rompe la revalidación del §5, crea un ciclo `identity → workspace` prohibido por ADR-0004, y no hay «un» rol: hay uno por workspace. |
| `trustProxy: true` | Permite falsificar `X-Forwarded-For` y con ello evadir el límite por IP y envenenar la auditoría. |
| Sesión en memoria del proceso o en Redis con *sticky sessions* | `ARQUITECTURA.md` §7.2 ya eliminó el long-polling **precisamente** para no necesitar *sticky sessions*. Reintroducirlas por la sesión sería revertir esa decisión. |
| Un único principal que unifique usuario y visitante de enlace | C-CODE-07 lo prohíbe: la sesión de compartición no hereda nada del propietario. |

## Consecuencias

**Positivas** — la revocación es inmediata y real, no una promesa; el robo de un testigo se
**detecta** en vez de pasar inadvertido; el diseño usa el esquema que ya existe sin pedir
ni una columna nueva; la autorización es declarativa, enumerable y auditable, y es **el
mismo objeto** en REST, WebSocket y colas; la mayor parte es probable **sin PostgreSQL**
con dobles, que es lo que permite avanzar hoy.

**Negativas, asumidas** — cada petición autenticada hace una lectura indexada a
`sessions` (mitigable con caché ≤ 5 s, no por defecto); la rotación introduce una carrera
de red real que obliga a la ventana de gracia de 10 s, que es complejidad que hay que
probar; `__Host-` impide compartir la cookie entre subdominios, lo que **cierra la puerta**
a servir la SPA en otro dominio sin un ADR nuevo; y el producto queda con dos perfiles de
hash (SHA-256 para verificadores, Argon2id para contraseñas y códigos), lo que hay que
explicar a quien lo lea por primera vez.

## Verificación

Separo **escrito**, **ejecutado** y **verificado**.

| Qué | Cómo se demuestra | Estado |
| --- | --- | --- |
| Los ocho ADR previos no cubrían auth/CSRF/roles | `grep -ric` sobre **los ocho ADR en su estado previo a esta ronda** (`git show bf020a3:docs/adr/…`): `csrf`=0, `cookie`=0, `HttpOnly`=0, `SameSite`=0, `refresh token`=0, `rbac`=0, `roles`=6. **Acotado al commit a propósito:** este ADR y el 0007 revisado ya contienen esas palabras, así que sobre el árbol de trabajo el recuento ya no da cero | **[VERIFICADO]** hoy |
| Las columnas de `sessions` y `users` que uso existen con ese nombre | lectura directa de `docs/schema/ceiba.dbml`, líneas 376–440 | **[VERIFICADO]** hoy |
| `.env.example` presupone JWT y contradice C-31 | lectura del fichero: `CEIBA_JWT_SECRET`, `CEIBA_ACCESS_TOKEN_TTL=15m` | **[VERIFICADO]** hoy |
| Las versiones de `@fastify/cookie` y `@fastify/csrf-protection` existen y su generación es la de Fastify 5 | consulta al registro npm: `11.1.3` y `8.0.2`, ambas con `fastify-plugin ^6.0.0` | **[VERIFICADO]** hoy |
| El SQL de revocación de la familia (§4) es **sintaxis PostgreSQL válida** | analizado con `node-sql-parser` en `/tmp`, dialecto `postgresql`: 1 sentencia, 0 fallos. **Prueba la sintaxis, no la semántica contra tablas reales** | **[VERIFICADO]** hoy |
| El guard deniega por defecto y toda ruta tiene guard | recorrido del `RouterExplorer` (prueba ya exigida por ADR-0001) | **[ESCRITO]** — Fase 1 |
| Matriz rol × operación (**prueba 4 del §20**) | tabla de la §7.5 como casos parametrizados con dobles, sin base de datos | **[ESCRITO]** — Fase 1, ejecutable sin infraestructura |
| Un lector no puede modificar (**prueba 17 del §20**) | caso de la misma matriz | **[ESCRITO]** — Fase 1 |
| Rotación y detección de reutilización | prueba con reloj y repositorio inyectados: rotar → reusar el viejo → la familia entera queda revocada | **[ESCRITO]** — Fase 1, ejecutable sin infraestructura |
| Ventana de gracia de 10 s | misma prueba, con huella igual y distinta | **[ESCRITO]** — Fase 1 |
| Caducidad absoluta e inactividad | reloj inyectado; la absoluta no se extiende al rotar | **[ESCRITO]** — Fase 1 |
| Cierre en todos los dispositivos | N sesiones → `revoke-all` → las N quedan revocadas y los sockets se cierran | **[ESCRITO]** — Fase 1 (los sockets, Fase 3) |
| CSRF: mutación sin cabecera o con `Origin` ajeno → 403 | prueba de integración HTTP sobre la app Nest con dobles | **[ESCRITO]** — Fase 1 |
| Ningún `GET` muta estado | recorrido del `RouterExplorer`, falla si un `@Get` invoca un repositorio de escritura | **[ESCRITO]** — Fase 1 |
| No hay credenciales en `localStorage` | barrido de `apps/web` | **[ESCRITO]** — Fase 2 |
| La cookie `__Host-` se comporta así en navegadores reales, incluido `http://localhost` | **requiere navegador; la automatización está bloqueada por política** | **[NO VERIFICADO]** |
| `trust proxy` + Nginx entregan la IP real del cliente | requiere Nginx y despliegue; **no existen aquí** | **[NO VERIFICADO]** |
| `@fastify/cookie` y `@fastify/csrf-protection` resuelven con Nest 12 y Fastify 5 | exige `pnpm install`, **prohibido en la raíz en esta fase** | **[NO VERIFICADO]** |
| Argon2id compila en la imagen | `argon2` es dependencia nativa; riesgo R10 ya declarado en `ARQUITECTURA.md` | **[NO VERIFICADO]** |

---

## HUECOS que este ADR deja abiertos

**HUECO: `.env.example` presupone JWT (`CEIBA_JWT_SECRET`, `CEIBA_ACCESS_TOKEN_TTL`) y hay
que sustituirlo por la configuración de sesión con estado (`CEIBA_SESSION_ABSOLUTE_TTL`,
`CEIBA_SESSION_IDLE_TTL`, `CEIBA_SESSION_ROTATE_AFTER`, `CEIBA_CSRF_SECRET`,
`CEIBA_COOKIE_SECURE`, `CEIBA_TRUSTED_PROXIES`) — creo que pertenece a quien posea
`.env.example`.** Es una contradicción con C-31, no una preferencia. Yo no escribo ese
fichero.

**HUECO: no existe rol de administrador de plataforma en el esquema, y dos sitios lo
exigen (`variable_scope.global` «Solo administradores de plataforma» y C-SSRF-11
«rol de administrador de la instancia, no propietario de workspace») — creo que pertenece a
`database-engineer` decidir la columna o tabla, y al cliente confirmar que quiere ese
rol.** Mientras no exista, ambas capacidades quedan inalcanzables desde la API.

**HUECO: no hay modelo para el restablecimiento de contraseña ni para la verificación de
correo; `users` sólo tiene `email_verified_at` y ningún testigo — creo que pertenece a
`database-engineer`.** El patrón selector/verificador de `invitations` sirve igual; es una
tabla nueva, no un cambio destructivo.

**HUECO: `CONTROLES.md` C-CODE-06 especifica una tabla `ShareSession { id, share_link_id,
permission, expires_at, revoked_at }` que no existe en el DBML — creo que pertenece a
`database-engineer`.** Sin ella, la sesión de compartición no tiene dónde vivir y C-CODE-06
no es implementable.

**Rate limiting general de la API: lo acepto, no es un hueco.** Lo corrijo respecto a un
borrador previo de este ADR, que lo devolvía a `appsec-engineer` citando mal su informe.
El texto real de `CONTROLES.md` §11 es: *«HUECO: rate limiting general de la API y
protección contra abuso de importaciones (§16) — creo que pertenece a
`software-architect` **o a nadie**»*. Es decir, **me lo asignaba a mí**. Lo asumo aquí:
`@fastify/rate-limit` (11.2.1) en `platform/`, detrás de la **misma interfaz
`RateLimitStore`** de C-CODE-03 —memoria en desarrollo, Redis en producción— para no tener
dos contadores distintos en el producto. Se aplica **después** de resolver la IP real
(§6.1) y **antes** de cualquier trabajo costoso. Los **umbrales concretos** por endpoint
sí los dejo a `appsec-engineer`, que ya fijó los de compartición.

**HUECO: no hay modelo para el reto de segundo factor entre la contraseña y la sesión —
creo que pertenece a `database-engineer`.** La §8 dice que con `mfa_enabled` la contraseña
emite «un reto de corta vida» y que no hay sesión a medias en `sessions`; pero **no existe
tabla donde viva ese reto**. Es el mismo patrón que el restablecimiento de contraseña:
selector/verificador con caducidad corta. Sin él, el flujo de 2FA no es implementable.

**HUECO: las pruebas obligatorias 1, 2 y 3 del §20 (crear usuario e iniciar sesión, crear
workspace, invitar usuario) no aparecen en la tabla de cobertura de `CONTROLES.md` — creo
que pertenece a `backend-engineer` implementarlas.** Este ADR las hace especificables; no
las escribe.
