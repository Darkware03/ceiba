import { peticionApi } from './cliente';
import type {
  EntradaDeInicioDeSesion,
  EntradaDeRegistro,
  PerfilPublico,
  RespuestaDeInicio,
  SesionActiva,
} from './tipos';

/**
 * Familia «Autenticación» de la API (`/api/v1/auth`).
 * Cada función corresponde a una ruta que **existe hoy** en
 * `apps/api/src/modules/identity/identity.controller.ts`.
 */

/** `POST /auth/register` → 201. **No** abre sesión: no emite cookie. */
export function registrar(entrada: EntradaDeRegistro): Promise<{ usuario: PerfilPublico }> {
  return peticionApi<{ usuario: PerfilPublico }>('/auth/register', {
    metodo: 'POST',
    cuerpo: entrada,
  });
}

/** `POST /auth/login` → 200. Emite la cookie de sesión o pide segundo factor. */
export function iniciarSesion(entrada: EntradaDeInicioDeSesion): Promise<RespuestaDeInicio> {
  return peticionApi<RespuestaDeInicio>('/auth/login', { metodo: 'POST', cuerpo: entrada });
}

/** `POST /auth/mfa/verify` → 200. Cierra el flujo de segundo factor. */
export function verificarSegundoFactor(entrada: {
  retoId: string;
  retoTestigo: string;
  codigo: string;
}): Promise<RespuestaDeInicio> {
  return peticionApi<RespuestaDeInicio>('/auth/mfa/verify', { metodo: 'POST', cuerpo: entrada });
}

/** `GET /auth/me` → 200 con el perfil, 401 si no hay sesión válida. */
export function perfilActual(): Promise<{ usuario: PerfilPublico }> {
  return peticionApi<{ usuario: PerfilPublico }>('/auth/me');
}

/** `POST /auth/logout` → 204. Revoca la fila de sesión y borra la cookie. */
export function cerrarSesion(): Promise<void> {
  return peticionApi<void>('/auth/logout', { metodo: 'POST' });
}

/** `POST /auth/sessions/revoke-all` → 200. Cierra sesión en todos los dispositivos. */
export function cerrarTodasLasSesiones(): Promise<{ revocadas: number }> {
  return peticionApi<{ revocadas: number }>('/auth/sessions/revoke-all', { metodo: 'POST' });
}

/** `GET /auth/sessions` → 200. Lista de dispositivos (ADR-0009 §9). */
export function listarSesiones(): Promise<{ sesiones: SesionActiva[] }> {
  return peticionApi<{ sesiones: SesionActiva[] }>('/auth/sessions');
}

/** `DELETE /auth/sessions/:id` → 204. Cierra una sesión concreta. */
export function cerrarUnaSesion(sesionId: string): Promise<void> {
  return peticionApi<void>(`/auth/sessions/${encodeURIComponent(sesionId)}`, { metodo: 'DELETE' });
}
