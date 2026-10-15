import type { RouteRecordRaw } from 'vue-router';
import {
  RUTA_CONSTRUCTOR,
  RUTA_LOGIN,
  RUTA_NO_ENCONTRADA,
  RUTA_REGISTRO,
  RUTA_WORKSPACE,
  RUTA_WORKSPACES,
} from './nombres';

/**
 * Tabla de rutas.
 *
 * `requiereSesion` es el único interruptor: el guard de `guardas.ts` lo lee y
 * **deniega por omisión** — una ruta que no diga nada se considera protegida.
 * Es la misma postura que el guard de la API (ADR-0001: «un control que no se
 * puede enumerar no se puede auditar»), y evita el fallo clásico de olvidar la
 * marca en una ruta nueva y publicarla sin querer.
 *
 * Las vistas van en carga diferida (`() => import(...)`) salvo el login: es la
 * primera pantalla de un usuario sin sesión y no merece un salto de red extra.
 */

declare module 'vue-router' {
  interface RouteMeta {
    /** `false` SÓLO en las rutas que deben verse sin sesión. */
    requiereSesion?: boolean;
    /** Título que se escribe en `document.title`. */
    titulo?: string;
  }
}

export * from './nombres';

export const rutas: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: { name: RUTA_WORKSPACES },
  },
  {
    path: '/entrar',
    name: RUTA_LOGIN,
    component: () => import('@/views/VistaDeAcceso.vue'),
    meta: { requiereSesion: false, titulo: 'Entrar' },
  },
  {
    path: '/registro',
    name: RUTA_REGISTRO,
    component: () => import('@/views/VistaDeRegistro.vue'),
    meta: { requiereSesion: false, titulo: 'Crear cuenta' },
  },
  {
    path: '/workspaces',
    name: RUTA_WORKSPACES,
    component: () => import('@/views/VistaDeWorkspaces.vue'),
    meta: { requiereSesion: true, titulo: 'Workspaces' },
  },
  {
    path: '/workspaces/:workspaceId',
    name: RUTA_WORKSPACE,
    component: () => import('@/views/VistaDeWorkspace.vue'),
    props: true,
    meta: { requiereSesion: true, titulo: 'Colecciones' },
  },
  {
    path: '/constructor',
    name: RUTA_CONSTRUCTOR,
    component: () => import('@/views/VistaDeConstructor.vue'),
    meta: { requiereSesion: true, titulo: 'Constructor de solicitudes' },
  },
  {
    path: '/:ruta(.*)*',
    name: RUTA_NO_ENCONTRADA,
    component: () => import('@/views/VistaNoEncontrada.vue'),
    meta: { requiereSesion: false, titulo: 'Página no encontrada' },
  },
];
