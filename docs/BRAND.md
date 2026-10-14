# Marca CEIBA y pantallas de carga

## 1. Origen de la marca

El usuario entregó el logo como dos PNG (fondo negro y fondo transparente). Ambos
se conservan sin tocar en `packages/brand/assets/source/`.

El SVG maestro **no es un redibujo**: se obtuvo trazando el contorno del PNG con
marching squares e interpolación sub-píxel, y después se verificó contra el
original píxel a píxel.

```
packages/brand/scripts/trace-logo.py    PNG  -> contorno -> SVG
packages/brand/scripts/verify-logo.py   SVG  -> rasterizado -> IoU contra el PNG
```

Medición registrada (14-10-2026, PNG de 1691×930):

| Métrica | Valor |
| --- | --- |
| Contornos detectados | 1 árbol + 1 semilla |
| Puntos tras simplificar (RDP ε=0,45) | 517 |
| Área del SVG respecto al original | 99,12 % |
| **IoU contra el PNG original** | **0,9337** |
| Tamaño del SVG | 7.948 B |

El residuo del 6 % **no es error de forma**: es el borde suavizado del PNG. Se
comprobó bajando ε a 0,15, lo que cuadruplica los puntos (2.185) y el tamaño
(32 KB) sin mejorar el IoU (0,9326). Por eso el maestro se queda en ε=0,45.

## 2. Artefactos derivados

Todo se deriva de `assets/ceiba-mark.svg` con `node scripts/build-brand.mjs`.
No edites los derivados a mano: se sobrescriben.

| Archivo | Uso |
| --- | --- |
| `assets/ceiba-mark.svg` | **fuente de verdad.** Árbol en `currentColor`, semilla en verde salvia |
| `assets/ceiba-mark-mono.svg` | una sola tinta, para grabados y fondos difíciles |
| `assets/favicon.svg` | icono con fondo carbón y esquinas redondeadas |
| `assets/apple-touch-icon.svg` | variante sólida 180×180 |
| `assets/ceiba-spinner.svg` | marca pre-escalada para girar |
| `src/mark-path.ts` / `.js` | trazados y constantes para los componentes |

## 3. Paleta

| Token | Oscuro | Claro | Uso |
| --- | --- | --- | --- |
| `--ceiba-bg` | `#0E100F` | `#F7F6F0` | fondo de la aplicación |
| `--ceiba-surface` | `#161917` | `#FFFFFF` | paneles y tarjetas |
| `--ceiba-text` | `#F3F1E7` | `#1A1D1B` | texto principal (blanco cálido) |
| `--ceiba-accent` | `#9DBE8C` | `#4F6F42` | verde salvia: acentos y estado positivo |

El tema oscuro es el predeterminado. El claro se activa con `data-theme="light"`.
El verde salvia se oscurece en tema claro para conservar el contraste sobre blanco.

## 4. El logo giratorio

> Requisito del usuario: *«las pantallas de cargando deben llevar el logo girando»*.

El giro es CSS puro (`@keyframes ceiba-spin`, rotación continua de 360°) sobre la
clase `.ceiba-spinner`, definida en `packages/brand/src/loader.css`. Está en CSS
sin dependencias **a propósito**: la pantalla de arranque de `index.html` debe
girar antes de que exista la aplicación Vue.

### 4.1 El recorte al girar: fallo encontrado y corregido

Un SVG recorta su contenido al `viewBox`. La marca ocupa el cuadro completo, así
que al rotarla las puntas se salían: **19,82 px fuera del lienzo en el peor ángulo
(43°)**. El spinner habría mostrado un árbol mutilado en cada vuelta.

Corrección: el spinner envuelve la marca en un `<g>` que la reduce al círculo
inscrito en el `viewBox`.

```
radio circunscrito de la marca : 147,82
radio seguro (círculo inscrito): 128,00
escala aplicada                : 0,865
desbordamiento tras corregir   : 0,0000 px en los 360°
```

La escala **no está escrita a mano**: `build-brand.mjs` la calcula desde el radio
circunscrito real del trazado, de modo que sigue siendo correcta si algún día se
vuelve a trazar el logo. `scripts/check-spin.mjs` barre los 360° y falla con
código 1 si algún punto se sale. Es una prueba del paquete (`pnpm test`).

### 4.2 Componentes

| Componente | Para qué |
| --- | --- |
| `CeibaMark` | marca estática (cabecera, vacíos, documentos) |
| `CeibaSpinner` | solo el logo girando; `size` entre `xs` y `xl` |
| `CeibaLoadingScreen` | pantalla de carga completa: logo + mensaje + detalle |

`CeibaLoadingScreen` admite `inline` (cubre su contenedor en lugar de la ventana)
y `boot` (fondo opaco, para el arranque).

### 4.3 Accesibilidad

Con `prefers-reduced-motion: reduce` **se detiene el giro**. No se pierde la señal
de actividad: la semilla pasa a una pulsación de opacidad, que no produce
movimiento rotatorio. La pantalla de carga es `role="status"` con `aria-live="polite"`;
los SVG decorativos van con `aria-hidden`.

La clase `.ceiba-spinner--static` congela la animación para capturas y pruebas
visuales deterministas.

## 5. Revisión visual

```sh
pnpm --filter @ceiba/brand run demo     # http://127.0.0.1:4317/
```

Muestra los cinco tamaños girando, la pantalla de carga embebida, el tema claro y
la paleta.

> **No verificado:** la comprobación del giro de esta fase es geométrica y
> numérica, no una captura de navegador — la automatización de navegador está
> bloqueada por política en este entorno. La página de revisión existe y se sirve
> correctamente (HTTP 200 en HTML, CSS, módulo y favicon), pero nadie ha mirado
> todavía el resultado renderizado.
