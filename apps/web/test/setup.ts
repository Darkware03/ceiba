import { afterEach, beforeEach } from 'vitest';
import { olvidarTestigoCsrf } from '../src/api/csrf';
import { usarFetch } from '../src/api/cliente';
import { olvidarComprobacionEnVuelo } from '../src/router/guardas';

/**
 * Preparación común de las pruebas.
 *
 * Deja el entorno **sin estado compartido** entre casos: sin `fetch` real, sin
 * testigo CSRF heredado, sin cookies y sin comprobación de sesión en vuelo. Un
 * caso que dependa del anterior es un caso que miente.
 */

beforeEach(() => {
  usarFetch(null);
  olvidarTestigoCsrf();
  olvidarComprobacionEnVuelo();
  limpiarCookies();
});

afterEach(() => {
  usarFetch(null);
  olvidarTestigoCsrf();
  olvidarComprobacionEnVuelo();
  limpiarCookies();
  globalThis.localStorage?.clear();
});

/**
 * Borra las cookies del caso anterior.
 *
 * El `; secure` NO es decorativo: una cookie con prefijo `__Host-` sólo se
 * puede escribir (y por tanto tampoco caducar) si la escritura cumple las
 * reglas del prefijo — `Secure`, `Path=/` y sin `Domain`. Sin `secure`, el
 * almacén de cookies descarta la escritura y la cookie sobrevive al borrado.
 * Medido en este entorno; ver FRONTEND.md.
 */
function limpiarCookies(): void {
  if (globalThis.document === undefined) return;
  for (const trozo of document.cookie.split(';')) {
    const nombre = trozo.split('=')[0]?.trim();
    if (nombre !== undefined && nombre.length > 0) {
      document.cookie = `${nombre}=; max-age=0; path=/; secure`;
    }
  }
}

/**
 * `jsdom` no implementa `<dialog>.showModal()`. Los componentes ya caen a
 * `setAttribute('open')` si no existe, pero se deja declarado aquí para que
 * quede claro que es una limitación del entorno, no de la aplicación.
 */
if (
  typeof globalThis.HTMLDialogElement === 'function' &&
  typeof globalThis.HTMLDialogElement.prototype.showModal !== 'function'
) {
  globalThis.HTMLDialogElement.prototype.showModal = function abrir(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  globalThis.HTMLDialogElement.prototype.close = function cerrar(this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}
