import type { ConfiguracionApp } from '../config/app-config.ts';
import type { OpcionesCookie, RespuestaHttp } from '../http/http-types.ts';

/**
 * Emisión de las dos cookies del ADR-0009 §2 y §5.
 *
 * `__Host-` es un prefijo **impuesto por el navegador**: obliga a `Secure`, a
 * `Path=/` y a que NO haya `Domain`. Por eso `domain` no se pasa nunca y `path`
 * es siempre `/`. Si alguien añadiera `domain`, el navegador descartaría la
 * cookie entera y el síntoma sería «no inicia sesión», no un error claro.
 */

export function opcionesCookieSesion(
  config: ConfiguracionApp,
  expiraEn: Date,
  ahora: Date,
): OpcionesCookie {
  const maxAge = Math.max(0, Math.floor((expiraEn.getTime() - ahora.getTime()) / 1000));
  return {
    httpOnly: true, // C-31: el JavaScript de la página no la lee.
    secure: config.cookies.secure,
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}

/** La cookie CSRF **no** es `HttpOnly`: la SPA tiene que leerla (§5, barrera 2). */
export function opcionesCookieCsrf(config: ConfiguracionApp): OpcionesCookie {
  return {
    httpOnly: false,
    secure: config.cookies.secure,
    sameSite: 'lax',
    path: '/',
  };
}

export function emitirCookieDeSesion(
  respuesta: RespuestaHttp,
  config: ConfiguracionApp,
  valor: string,
  expiraEn: Date,
  ahora: Date,
): void {
  respuesta.setCookie(
    config.cookies.nombreSesion,
    valor,
    opcionesCookieSesion(config, expiraEn, ahora),
  );
}

export function borrarCookieDeSesion(respuesta: RespuestaHttp, config: ConfiguracionApp): void {
  respuesta.clearCookie(config.cookies.nombreSesion, {
    httpOnly: true,
    secure: config.cookies.secure,
    sameSite: 'lax',
    path: '/',
  });
}

export function emitirCookieCsrf(
  respuesta: RespuestaHttp,
  config: ConfiguracionApp,
  valor: string,
): void {
  respuesta.setCookie(config.cookies.nombreCsrf, valor, opcionesCookieCsrf(config));
}
