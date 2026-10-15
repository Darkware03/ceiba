/**
 * Testigo anti-CSRF del lado del navegador (ADR-0009 §5, barrera 2).
 *
 * Cómo funciona el doble envío firmado, y por qué esta capa es pequeña:
 *
 *  - La API acuña la cookie `__Host-ceiba_csrf` **sin** `HttpOnly`, porque la
 *    SPA tiene que leerla (`apps/api/src/platform/auth/cookies.ts`).
 *  - En toda operación mutante hay que mandar **el mismo valor** en la cabecera
 *    `x-ceiba-csrf` (`apps/api/src/platform/guards/csrf.guard.ts`).
 *  - Si la cookie falta, hay un endpoint explícito que la acuña:
 *    `GET /api/v1/auth/csrf`.
 *
 * LO QUE ESTO **NO** HACE, y es deliberado: no guarda, no lee y no toca la
 * cookie de sesión `__Host-ceiba_session`. Es `HttpOnly` por la decisión C-31 y
 * el navegador la envía solo con `credentials: "include"`. Nada de esta
 * aplicación escribe credenciales en `localStorage` ni en `sessionStorage`;
 * `scripts/check-no-token-storage.mjs` lo comprueba de forma automatizada.
 */

export const NOMBRE_COOKIE_CSRF = '__Host-ceiba_csrf';
export const NOMBRE_CABECERA_CSRF = 'x-ceiba-csrf';

/**
 * Copia en memoria del último testigo acuñado.
 *
 * Existe para un caso concreto: si el navegador **rechaza** la cookie
 * `__Host-` (exige contexto seguro), `document.cookie` queda vacío y no habría
 * nada que mandar en la cabecera. En memoria, no en almacenamiento persistente,
 * y **no es una credencial de sesión**: es un testigo anti-CSRF público por
 * diseño, cuyo valor el servidor también manda en una cookie legible.
 */
let testigoEnMemoria: string | null = null;

/** Lee una cookie por nombre. Devuelve `null` si no está. */
export function leerCookie(nombre: string, origen: string = document.cookie): string | null {
  for (const trozo of origen.split(';')) {
    const separador = trozo.indexOf('=');
    if (separador === -1) continue;
    const clave = trozo.slice(0, separador).trim();
    if (clave === nombre) return decodeURIComponent(trozo.slice(separador + 1).trim());
  }
  return null;
}

/** Vale cualquier `<nonce>.<hmac>` no vacío; la firma la valida el servidor. */
function pareceTestigo(valor: string | null): valor is string {
  return typeof valor === 'string' && valor.length > 0 && valor.includes('.');
}

export function testigoCsrfActual(): string | null {
  const deLaCookie = leerCookie(NOMBRE_COOKIE_CSRF);
  if (pareceTestigo(deLaCookie)) return deLaCookie;
  return pareceTestigo(testigoEnMemoria) ? testigoEnMemoria : null;
}

export function recordarTestigoCsrf(valor: string | null): void {
  testigoEnMemoria = pareceTestigo(valor) ? valor : null;
}

/** Sólo para pruebas: deja el módulo sin estado entre casos. */
export function olvidarTestigoCsrf(): void {
  testigoEnMemoria = null;
}

/**
 * Garantiza que hay testigo antes de una operación mutante.
 *
 * `pedirTestigo` se inyecta para que las pruebas no necesiten red; en la
 * aplicación lo rellena `cliente.ts` con la llamada real a `GET /auth/csrf`.
 */
export async function asegurarTestigoCsrf(
  pedirTestigo: () => Promise<string | null>,
): Promise<string | null> {
  const actual = testigoCsrfActual();
  if (actual !== null) return actual;

  const acunado = await pedirTestigo();
  recordarTestigoCsrf(acunado);
  // Se vuelve a mirar la cookie: lo normal es que la respuesta la haya puesto,
  // y entonces manda la cookie sobre la copia en memoria.
  return testigoCsrfActual();
}
