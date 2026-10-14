# `@ceiba/engine` — motor de ejecución HTTP

Proceso **independiente** que ejecuta las solicitudes HTTP que escribe el
usuario. Implementa el contrato v1 del
[ADR-0002](../../docs/adr/0002-motor-de-ejecucion-http-como-servicio-separado.md)
y los controles `C-SSRF-*` del documento de controles de seguridad.

Informe completo de implementación y pruebas:
`/software-factory/deliverables/ceiba-api-studio/MOTOR-HTTP.md`.

## Las cinco reglas duras (ADR-0002)

1. **Sin credenciales de base de datos.** No hay `DATABASE_URL` ni
   `@prisma/client`; el arranque **aborta** si se los pasan.
2. **Sin clave maestra de secretos.** La API entrega valores ya descifrados.
3. **No sabe qué es un usuario, un workspace ni un permiso.**
4. **Único proceso con salida arbitraria a Internet.**
5. **Sin estado.** Dispatcher, auditoría y contadores nacen y mueren con cada
   ejecución.

Las cinco están comprobadas por `test/architecture.test.ts` y
`test/config.test.ts`.

## Rutas (tres, y sólo tres)

| Método | Ruta | Autenticación |
| --- | --- | --- |
| `POST` | `/v1/execute` | `X-Ceiba-Engine-Token` |
| `POST` | `/v1/execute/stream` | `X-Ceiba-Engine-Token` (SSE) |
| `GET` | `/healthz` | ninguna |

## Arranque

```bash
pnpm install --ignore-workspace        # desde apps/engine
pnpm run typecheck
pnpm test
CEIBA_ENGINE_TOKEN='…48 bytes…' pnpm start
```

El motor **se niega a arrancar** si falta `CEIBA_ENGINE_TOKEN`, si
`CEIBA_SSRF_PROTECTION` no vale `on`, si hay variables de proxy definidas
(`HTTP_PROXY`…) o si recibe credenciales que no le corresponden. Es
deliberado: una configuración insegura no debe degradarse en silencio.

## Por qué nunca se usa `fetch`

`process.versions.undici` en Node 24.21.0 es **7.29.1**: `globalThis.fetch`
sale por esa copia interna, que **no lleva la política de destino**. El motor
importa `undici` como dependencia declarada (8.12.1) y construye su propio
`Agent` con el connector guardado. Hay una prueba de arquitectura que falla si
alguien escribe `fetch(`, importa `node:http`/`node:https` o añade `axios`.
