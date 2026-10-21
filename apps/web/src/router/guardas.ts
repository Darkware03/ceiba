import type { NavigationGuardReturn, RouteLocationNormalized } from 'vue-router';
import { usarAlmacenDeSesion } from '@/stores/sesion';
import { RUTA_LOGIN, RUTA_REGISTRO, RUTA_WORKSPACES } from './nombres';

/**
 * Guard de navegación.
 *
 * **Deniega por omisión**: sólo pasa sin sesión la ruta que declara
 * explícitamente `meta.publica === true`. Una ruta nueva que se olvide
 * de declararlo queda protegida, no abierta.
 *
 * Tres comportamientos que el cliente pidió y que aquí quedan escritos:
 *
 *  1. Ruta protegida **sin sesión** → al login, llevando el destino en
 *     `?redirect=` para volver después.
 *  2. Ruta de acceso **con sesión** → fuera del login; si venía con
 *     `?redirect=`, a ese destino.
 *  3. Al recargar la página, la interfaz **todavía no sabe** si hay sesión: la
 *     cookie es `HttpOnly` y no se puede mirar. Por eso se espera a
 *     `comprobar()` antes de decidir. Sin esta espera, cada F5 echaría al
 *     login a un usuario con sesión válida.
 *
 * Y una advertencia que no sobra: esto es **comodidad de navegación, no un
 * control de seguridad**. La autorización real la hace la API en cada petición
 * (§5 del prompt maestro: «no basta con ocultar botones en el frontend»).
 */

/** Evita lanzar N peticiones a `/auth/me` si coinciden varias navegaciones. */
let comprobacionEnVuelo: Promise<void> | null = null;

export function olvidarComprobacionEnVuelo(): void {
  comprobacionEnVuelo = null;
}

async function asegurarSesionComprobada(): Promise<void> {
  const sesion = usarAlmacenDeSesion();
  if (sesion.comprobada) return;
  comprobacionEnVuelo ??= sesion.comprobar().finally(() => {
    comprobacionEnVuelo = null;
  });
  await comprobacionEnVuelo;
}

/** Saca un destino de vuelta **seguro** de la consulta: sólo rutas internas. */
export function destinoDeVuelta(valor: unknown): string | null {
  if (typeof valor !== 'string' || valor.length === 0) return null;
  // Sólo rutas absolutas internas. `//otro.sitio` y `https://…` quedan fuera:
  // sin esto, `?redirect=` sería un redirector abierto.
  if (!valor.startsWith('/') || valor.startsWith('//')) return null;
  return valor;
}

export async function guardaDeSesion(
  hacia: RouteLocationNormalized,
): Promise<NavigationGuardReturn> {
  await asegurarSesionComprobada();
  const sesion = usarAlmacenDeSesion();

  const esPublica = hacia.meta.publica === true;

  if (!esPublica && !sesion.autenticado) {
    return {
      name: RUTA_LOGIN,
      query: { redirect: hacia.fullPath },
      replace: true,
    };
  }

  if (esPublica && sesion.autenticado && (hacia.name === RUTA_LOGIN || hacia.name === RUTA_REGISTRO)) {
    const vuelta = destinoDeVuelta(hacia.query['redirect']);
    return vuelta !== null ? { path: vuelta, replace: true } : { name: RUTA_WORKSPACES, replace: true };
  }

  return true;
}

export function aplicarTitulo(hacia: RouteLocationNormalized): void {
  const titulo = hacia.meta.titulo;
  if (globalThis.document === undefined) return;
  document.title = typeof titulo === 'string' ? `${titulo} · CEIBA API Studio` : 'CEIBA API Studio';
}
