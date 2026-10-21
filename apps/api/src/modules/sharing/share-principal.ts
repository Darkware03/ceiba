import type { ConfiguracionApp } from '../../platform/config/app-config.ts';
import type { OpcionesCookie, RespuestaHttp } from '../../platform/http/http-types.ts';
import type { PermisoDeComparticion } from './share-policy.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * EL VISITANTE DE ENLACE COMO PRINCIPAL DE PRIMERA CLASE (C-CODE-07).
 *
 * *«La sesión de compartición es un principal de primera clase con su propio
 * conjunto de permisos, nunca una traducción al usuario propietario. Las
 * peticiones que hace no heredan nada de él.»*
 *
 * Por eso este tipo **no entra** en la unión `Principal` de
 * `platform/auth/principal.ts` y se deja en **otra clave de la petición**. Si
 * compartiera la unión, cualquier `@Usuario()` o guard de workspace lo
 * aceptaría por accidente y el visitante empezaría a heredar autorizaciones.
 * Que sean tipos incompatibles es el control, no una molestia.
 *
 * `platform/auth/principal.ts` ya lo anticipaba: *«el visitante de enlace
 * pertenece a `sharing` (fase posterior)»*. Esto es esa fase.
 * ════════════════════════════════════════════════════════════════════════════
 */
export interface PrincipalDeComparticion {
  readonly tipo: 'comparticion';
  readonly sesionId: string;
  readonly sharedLinkId: string;
  readonly collectionId: string;
  /**
   * Presente porque el enlace lo denormaliza, **no** para autorizar nada del
   * workspace: ninguna ruta compartida lo usa como permiso. Sirve sólo para
   * que la auditoría del propietario caiga en su workspace.
   */
  readonly workspaceId: string;
  readonly permiso: PermisoDeComparticion;
  readonly permiteExportar: boolean;
  readonly permiteEjecutar: boolean;
  readonly expiraEn: Date;
}

/** Clave con la que el guard deja el principal compartido en la petición. */
export const CLAVE_PRINCIPAL_COMPARTIDO = 'ceibaPrincipalComparticion';

// ---------------------------------------------------------------------------
// Cookie de la sesión de compartición
// ---------------------------------------------------------------------------

/**
 * Ruta de la cookie. C-CODE-06 pide `Path=/share`; la API vive bajo el prefijo
 * global `api/v1`, así que la ruta real equivalente es ésta.
 */
export const RUTA_COOKIE_COMPARTICION = '/api/v1/share';

/**
 * POR QUÉ `__Secure-` Y NO `__Host-`.
 *
 * `__Host-` es el prefijo que usan las otras dos cookies del producto, pero el
 * navegador lo condiciona a **`Path=/`**. Acotar la cookie a `/api/v1/share` y
 * ponerle `__Host-` a la vez es imposible: el navegador descartaría la cookie
 * entera y el síntoma sería «la página de acceso no recuerda nada», no un error.
 *
 * Entre las dos protecciones gana el acotado de ruta, que es lo que C-CODE-06
 * pide expresamente: así la credencial del visitante **no viaja** a ninguna
 * ruta autenticada del producto. `__Secure-` conserva lo que sí es compatible
 * —exige `Secure`— y cierra la inyección desde un origen sin TLS.
 *
 * Sin TLS (`CEIBA_COOKIE_SECURE=false`, sólo fuera de producción) se cae el
 * prefijo, exactamente por la misma razón y con el mismo criterio que
 * `nombresDeCookie()` en `platform/config/app-config.ts`.
 */
export function nombreCookieDeComparticion(secure: boolean): string {
  return secure ? '__Secure-ceiba_share' : 'ceiba_share';
}

export function opcionesCookieDeComparticion(
  config: ConfiguracionApp,
  expiraEn: Date,
  ahora: Date,
): OpcionesCookie {
  const maxAge = Math.max(0, Math.floor((expiraEn.getTime() - ahora.getTime()) / 1000));
  return {
    httpOnly: true, // El JavaScript de la página de acceso no la lee.
    secure: config.cookies.secure,
    sameSite: 'lax',
    path: RUTA_COOKIE_COMPARTICION,
    maxAge,
  };
}

export function emitirCookieDeComparticion(
  respuesta: RespuestaHttp,
  config: ConfiguracionApp,
  valor: string,
  expiraEn: Date,
  ahora: Date,
): void {
  respuesta.setCookie(
    nombreCookieDeComparticion(config.cookies.secure),
    valor,
    opcionesCookieDeComparticion(config, expiraEn, ahora),
  );
}

export function borrarCookieDeComparticion(
  respuesta: RespuestaHttp,
  config: ConfiguracionApp,
): void {
  respuesta.clearCookie(nombreCookieDeComparticion(config.cookies.secure), {
    httpOnly: true,
    secure: config.cookies.secure,
    sameSite: 'lax',
    path: RUTA_COOKIE_COMPARTICION,
  });
}
