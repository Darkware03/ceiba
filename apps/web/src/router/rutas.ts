import type { RouteRecordRaw } from 'vue-router'
import { NOMBRES_RUTAS } from './nombres'

declare module 'vue-router' {
  interface RouteMeta {
    publica?: boolean
    /**
     * Forma equivalente heredada de la fase 1: `false` declara ruta pública.
     * El guard acepta las dos y sigue denegando por omisión (`guardas.ts`).
     */
    requiereSesion?: boolean
    soloInvitado?: boolean
    titulo?: string
    sinArmazon?: boolean
  }
}

export const rutas: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: { name: NOMBRES_RUTAS.WORKSPACES },
  },
  {
    path: '/acceso',
    name: NOMBRES_RUTAS.ACCESO,
    component: () => import('@/views/VistaDeAcceso.vue'),
    meta: {
      publica: true,
      soloInvitado: true,
      sinArmazon: true,
      titulo: 'Iniciar sesión — CEIBA',
    },
  },
  {
    path: '/registro',
    name: NOMBRES_RUTAS.REGISTRO,
    component: () => import('@/views/VistaDeRegistro.vue'),
    meta: {
      publica: true,
      soloInvitado: true,
      sinArmazon: true,
      titulo: 'Crear cuenta — CEIBA',
    },
  },
  {
    path: '/workspaces',
    name: NOMBRES_RUTAS.WORKSPACES,
    component: () => import('@/views/VistaDeWorkspaces.vue'),
    meta: {
      titulo: 'Espacios de trabajo — CEIBA',
    },
  },
  {
    path: '/workspaces/:workspaceId',
    name: NOMBRES_RUTAS.WORKSPACE_DETALLE,
    component: () => import('@/views/VistaDeWorkspace.vue'),
    props: true,
    meta: {
      titulo: 'Colecciones — CEIBA',
    },
  },
  {
    path: '/colecciones/:collectionId',
    name: NOMBRES_RUTAS.COLECCION,
    component: () => import('@/views/VistaDeColeccion.vue'),
    props: true,
    meta: {
      titulo: 'Peticiones de la colección — CEIBA',
    },
  },
  {
    path: '/constructor',
    name: NOMBRES_RUTAS.CONSTRUCTOR,
    component: () => import('@/views/VistaDeConstructor.vue'),
    /**
     * La petición a abrir viaja por **query**, no por path, y es deliberado:
     * `/constructor` sin nada sigue siendo el borrador en blanco de siempre —
     * las pruebas de la fase 5 lo montan así, sin router—. Pasarlo como
     * `props` en vez de leer `useRoute()` dentro de la vista mantiene el
     * componente montable sin router, que es lo que permite que esas pruebas
     * sigan en verde.
     */
    props: (ruta) => ({
      peticionId: typeof ruta.query.peticion === 'string' ? ruta.query.peticion : undefined,
      coleccionId: typeof ruta.query.coleccion === 'string' ? ruta.query.coleccion : undefined,
    }),
    meta: {
      titulo: 'Constructor HTTP — CEIBA',
    },
  },
  {
    path: '/historial',
    name: NOMBRES_RUTAS.HISTORIAL,
    component: () => import('@/views/VistaDeHistorial.vue'),
    meta: {
      titulo: 'Historial de cambios y peticiones — CEIBA',
    },
  },
  {
    path: '/entornos',
    name: NOMBRES_RUTAS.ENTORNOS,
    component: () => import('@/views/VistaDeEntornos.vue'),
    meta: {
      titulo: 'Entornos y variables — CEIBA',
    },
  },
  {
    path: '/ejecuciones',
    name: NOMBRES_RUTAS.EJECUCIONES,
    component: () => import('@/views/VistaDeEjecuciones.vue'),
    meta: {
      titulo: 'Ejecuciones de colecciones — CEIBA',
    },
  },
  {
    path: '/documentacion',
    name: NOMBRES_RUTAS.DOCUMENTACION,
    component: () => import('@/views/VistaDeDocumentacion.vue'),
    meta: {
      titulo: 'Documentación de API — CEIBA',
    },
  },
  {
    path: '/importar',
    name: NOMBRES_RUTAS.IMPORTAR,
    component: () => import('@/views/VistaDeImportar.vue'),
    meta: {
      titulo: 'Importar y exportar colecciones — CEIBA',
    },
  },
  {
    path: '/configuracion',
    name: NOMBRES_RUTAS.CONFIGURACION,
    component: () => import('@/views/VistaDeConfiguracion.vue'),
    meta: {
      titulo: 'Configuración y colaboradores — CEIBA',
    },
  },
  {
    path: '/invitacion/:token',
    name: NOMBRES_RUTAS.INVITACION,
    component: () => import('@/views/VistaDeInvitacion.vue'),
    props: true,
    meta: {
      // Pública a propósito: a quien recibe la invitación por correo todavía
      // no se le ha pedido que tenga cuenta. Sin esto el guard lo mandaba al
      // login y el enlace de invitación no servía para nada. La vista decide
      // qué puede hacer según haya sesión o no; la autorización real la hace
      // la API al aceptar (`POST /invitations/:token/accept`).
      publica: true,
      sinArmazon: true,
      titulo: 'Invitación a workspace — CEIBA',
    },
  },
  {
    path: '/:rutaNoReconocida(.*)*',
    name: NOMBRES_RUTAS.NO_ENCONTRADO,
    component: () => import('@/views/VistaNoEncontrada.vue'),
    meta: {
      publica: true,
      titulo: 'Página no encontrada — CEIBA',
    },
  },
]
