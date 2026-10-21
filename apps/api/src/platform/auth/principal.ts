/**
 * Principales del ADR-0009 §7.1. Son tres y **no se traducen entre sí**.
 * En esta ronda sólo se implementa el primero (usuario con sesión); el
 * visitante de enlace pertenece a `sharing` (fase posterior del orden C-02) y
 * el principal API→motor lo valida el motor, no la API.
 */
export interface PrincipalUsuario {
  readonly tipo: 'usuario';
  readonly usuarioId: string;
  readonly sesionId: string;
  readonly userId?: string;
  readonly email?: string;
  readonly esPlatformAdmin?: boolean;
}

/*
 * POR QUÉ EL PRINCIPAL NO LLEVA NI CORREO NI ROL.
 *
 *  - El **rol** no viaja nunca en la credencial ni en la fila de sesión
 *    (ADR-0009 §7.2): rompería la revalidación por operación, crearía el ciclo
 *    `identity → workspace` que el ADR-0004 prohíbe, y además un usuario tiene
 *    N roles, uno por workspace: no hay «el rol» que meter.
 *  - El **correo** se deja fuera para que validar una sesión siga costando UNA
 *    lectura indexada a `sessions`, que es el coste que el ADR-0009 declara
 *    como consecuencia negativa asumida. Añadir aquí el correo obligaría a leer
 *    también `users` en cada petición autenticada. Quien necesite el perfil lo
 *    pide explícitamente (`GET /api/v1/auth/me`).
 */

export type Principal = PrincipalUsuario;

/** Clave con la que el guard deja el principal en la petición. */
export const CLAVE_PRINCIPAL = 'ceibaPrincipal';

/**
 * Datos de la petición que la sesión necesita: IP real (ya resuelta por el
 * `trustProxy` acotado, ADR-0009 §6.1) y `User-Agent`. La huella
 * `ip + user-agent` es la que decide si una reutilización cae en la ventana de
 * gracia de 10 s o es un robo (§4).
 */
export interface ContextoDePeticion {
  readonly ip: string;
  readonly userAgent: string | undefined;
}

export type PrincipalAutenticado = PrincipalUsuario;

/**
 * Identificador del usuario, siempre presente.
 *
 * El principal lleva `usuarioId` (obligatorio, el del ADR-0009) y un alias
 * `userId` opcional que anadio el modulo `studio`. Usar el alias suelto da
 * `string | undefined`, y escribir `undefined` en una columna de autoria la
 * deja a NULL sin que nadie se entere. Esta funcion colapsa los dos nombres en
 * uno y garantiza el tipo.
 */
export function idDeUsuario(principal: PrincipalUsuario): string {
  return principal.userId ?? principal.usuarioId;
}

/**
 * Convierte cualquier vista de bytes en la forma exacta que exigen las columnas
 * `Bytes` del cliente Prisma generado (`Uint8Array<ArrayBuffer>`). El `Buffer`
 * de Node es `Uint8Array<ArrayBufferLike>` y no es asignable: copiarlo es
 * barato (32 bytes en todos los usos) y evita una asercion de tipo.
 */
export function aBytesDePrisma(datos: Uint8Array): Uint8Array<ArrayBuffer> {
  const salida = new Uint8Array(datos.byteLength);
  salida.set(datos);
  return salida;
}
