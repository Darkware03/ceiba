# Estado real de CEIBA API Studio

Inventario vivo. **Regla: nada figura como hecho sin una comprobación que lo
respalde, y lo preparado-pero-no-ejecutado se etiqueta como tal.**

Última actualización: 2026-10-14 · commit base `a0e7021`

---

## 1. Leyenda

| Estado | Significado |
| --- | --- |
| **Verificado** | existe, se ejecutó y la salida lo respalda |
| **Escrito** | existe en el repositorio, nadie lo ha ejecutado |
| **No iniciado** | no existe |
| **Bloqueado** | no se puede hacer aquí; el motivo está en §4 |

## 2. Componentes

| Componente | Estado | Comprobación |
| --- | --- | --- |
| `packages/brand` — marca, tokens, logo giratorio | **Verificado** | §3 |
| Monorepo pnpm (`package.json`, `pnpm-workspace.yaml`) | **Escrito** | `pnpm install` no ejecutado todavía |
| `.env.example` | **Escrito** | — |
| `apps/api` — backend | **No iniciado** | — |
| `apps/web` — frontend | **No iniciado** | — |
| `apps/engine` — motor HTTP | **No iniciado** | — |
| Esquema de base de datos | **No iniciado** | en curso: `database-engineer` |
| Arquitectura y ADR | **No iniciado** | en curso: `software-architect` |
| Modelo de amenazas | **No iniciado** | en curso: `appsec-engineer` |
| Backlog y alcance | **No iniciado** | en curso: `product-analyst` |
| Docker / Compose / despliegue | **No iniciado** | **Bloqueado** para ejecución (§4) |

## 3. Lo que sí está verificado

### 3.1 Vectorización de la marca

El SVG maestro se trazó desde el PNG entregado por el cliente y se comparó con él
píxel a píxel.

```
$ python3 scripts/verify-logo.py assets/source/ceiba-mark-on-dark.png assets/ceiba-mark.svg
area original=62188  area svg=61642  (99.12%)
IoU = 0.9337   pixeles solo-original=2395  solo-svg=1849
```

El 6 % restante es el borde suavizado del PNG, no error de forma: con ε=0,15 el
trazado pasa de 517 a 2.185 puntos y de 7,9 KB a 32 KB, y el IoU **empeora**
(0,9326). Comprobado, no supuesto.

### 3.2 El logo gira sin recortarse

Fallo encontrado y corregido en esta fase: la marca ocupa todo el `viewBox`, así
que al rotarla se salía **19,82 px en el peor ángulo (43°)**.

```
$ node scripts/check-spin.mjs
radio circunscrito     : 147.82
radio seguro (inscrito): 128.00
escala evaluada        : 0.865
desbordamiento sin escalar : 19.82 px
desbordamiento con escala  : 0.0000 px (peor angulo 0deg)
OK: la marca cabe en el viewBox en los 360 grados; el giro no recorta.
```

La escala la **deriva** `build-brand.mjs` del radio circunscrito real, no está
escrita a mano: si se vuelve a trazar el logo, sigue siendo correcta.
`check-spin.mjs` es la prueba del paquete y devuelve 1 si falla.

### 3.3 Coherencia de la hoja de estilos

Comprobado que las diez clases que usa el marcado existen en `loader.css`, que
`animation: ceiba-spin` y `@keyframes ceiba-spin` están ambas presentes, que hay
bloque `prefers-reduced-motion: reduce` y que el spinner aplica
`CEIBA_SPIN_TRANSFORM`.

### 3.4 La página de revisión se sirve

`node scripts/serve-demo.mjs` responde 200 en HTML, `mark-path.js`, `loader.css`,
`tokens.css`, favicon y spinner, tanto en directo como a través del portal.

## 4. Bloqueos del entorno (medidos el 2026-10-14)

| Bloqueo | Consecuencia |
| --- | --- |
| **No hay Docker** (`docker: not found`) | Compose y Dockerfiles se escribirán pero **nunca se ejecutarán aquí**. Todo lo relativo a despliegue es *no verificado* por definición. |
| **No hay PostgreSQL ni `psql`** | Las migraciones no se podrán correr. No se sustituye por SQLite: no demostraría nada sobre producción. |
| **No hay Redis** | Colas y coordinación de WebSocket no se podrán ejercer. |
| **No hay root ni `sudo`**; elevación denegada por política | No se pueden instalar servicios del sistema. |
| **Automatización de navegador bloqueada** | El giro está verificado por geometría y números, **no por captura**. Nadie ha visto todavía el render. |
| **`/software-factory/projects/` no es escribible** | El repositorio vive en `/software-factory/ceiba-api-studio`. Ver §5. |

El registro npm **sí** es accesible: instalación real comprobada.

## 5. Desviación de la convención de rutas

`AGENTS.md` sitúa los repositorios en `/software-factory/projects/<proyecto>`. Ese
directorio pertenece a otro uid (1004) y no admite escritura desde esta cuenta
(uid 1000); la elevación está bloqueada por política.

El repositorio está, por tanto, en `/software-factory/ceiba-api-studio`. Para
devolverlo a su sitio basta con que el operador ejecute, con permisos:

```sh
install -d -o 1000 -g 1000 -m 2775 /software-factory/projects/ceiba-api-studio
mv /software-factory/ceiba-api-studio/* /software-factory/ceiba-api-studio/.??* \
   /software-factory/projects/ceiba-api-studio/
rmdir /software-factory/ceiba-api-studio
```

Los documentos sí están donde corresponde: `deliverables/ceiba-api-studio/` y
`security/ceiba-api-studio/`.

## 6. Próximo paso

Consolidar los cuatro informes en curso (arquitectura, modelo de datos, seguridad,
alcance), comprobar que ninguna capacidad quedó en el hueco entre ámbitos, y
arrancar la fase 1 por la rebanada vertical de mayor valor: el motor HTTP con su
control SSRF y el constructor de solicitudes.
