# CEIBA API Studio

Plataforma para consumir, desarrollar, probar, organizar, compartir, documentar y
automatizar APIs.

**C**onectividad · **E**xploración · **I**ntegración · **B**enchmarking · **A**utomatización

> **Estado: fase 0 (fundación) en curso.** Este README describe lo que existe hoy y
> lo que todavía no. Ninguna sección afirma que algo funciona sin una comprobación
> que lo respalde. El inventario vivo está en
> [`docs/ESTADO.md`](docs/ESTADO.md).

---

## Qué hay hoy en el repositorio

| Componente | Estado | Evidencia |
| --- | --- | --- |
| `packages/brand` — identidad visual, marca vectorizada, logo giratorio | **funcional y verificado** | `pnpm --filter @ceiba/brand run check:spin` y `check:trace` |
| `apps/api` — backend NestJS | no iniciado | — |
| `apps/web` — frontend Vue 3 | no iniciado | — |
| `apps/engine` — motor HTTP aislado | no iniciado | — |
| `infra/` — Docker Compose, Nginx, migraciones | no iniciado | — |

## Stack acordado

Las decisiones y sus motivos están en [`docs/adr/`](docs/adr/).

- **Frontend:** Vue 3 · TypeScript · Vite · Pinia · Vue Router · PrimeVue · CodeMirror 6
- **Backend:** Node.js · TypeScript · NestJS (adaptador Fastify) · PostgreSQL · Redis · BullMQ
- **Motor HTTP:** servicio separado sobre `undici`, con control SSRF en el momento
  de conectar y tras cada redirección
- **Infraestructura:** Docker Compose, Nginx como proxy inverso, migraciones versionadas

---

## Marca y pantallas de carga

La marca es el ceibo geométrico que acompaña al producto. El archivo maestro es
`packages/brand/assets/ceiba-mark.svg`, **trazado desde el PNG original**, no
redibujado a mano.

```sh
pnpm --filter @ceiba/brand run build:brand   # regenera favicon, icono y datos de trazado
pnpm --filter @ceiba/brand run check:spin    # comprueba que el giro no recorta la marca
pnpm --filter @ceiba/brand run check:trace   # compara el SVG con el PNG original (IoU)
pnpm --filter @ceiba/brand run demo          # http://127.0.0.1:4317/
```

**Todas las esperas de la aplicación muestran el logo girando.** El giro vive en
`packages/brand/src/loader.css`, sin dependencias, para que la pantalla de arranque
de `index.html` pueda usarlo antes de que Vue esté montado.

```vue
<CeibaLoadingScreen boot message="Iniciando CEIBA…" />
<CeibaLoadingScreen inline message="Ejecutando colección…" detail="12 / 48 solicitudes" />
<CeibaSpinner size="sm" />
```

Detalles en [`docs/BRAND.md`](docs/BRAND.md).

---

## Puesta en marcha

> Todavía no existe un `compose.yaml`; esta sección se completará al cerrar la
> fase 1 y no debe darse por válida hasta entonces.

Requisitos previstos: Node.js ≥ 22.12, pnpm ≥ 9.12, Docker y Docker Compose.

```sh
cp .env.example .env     # y rellenar los valores marcados <generar>
pnpm install
```

## Licencia y marcas

CEIBA es un producto propio. No incorpora código, activos ni diseños protegidos de
Postman, Insomnia, Bruno ni de ninguna otra herramienta. La compatibilidad con sus
formatos de exportación se implementa a partir de especificaciones públicas.
