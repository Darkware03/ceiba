import { defineStore } from 'pinia';
import * as autenticacion from '@/api/autenticacion';
import { ErrorDeApi } from '@/api/errores';
import { exigeSegundoFactor, type PerfilPublico, type RespuestaDeInicio } from '@/api/tipos';

/**
 * Estado de sesión de la interfaz.
 *
 * LO QUE AQUÍ **NO** HAY, y es el punto entero de la decisión C-31: no hay
 * testigo, ni cookie, ni cabecera `Authorization`, ni nada escrito en
 * `localStorage`. La sesión vive en la cookie `__Host-ceiba_session`, que es
 * `HttpOnly` y que este código **no puede leer**. Lo único que guarda este
 * almacén es el **perfil** devuelto por la API y un indicador de si ya se
 * preguntó. Si el navegador no tiene cookie válida, `GET /auth/me` responde
 * 401 y aquí queda `usuario = null`. Esa es toda la lógica.
 *
 * Consecuencia que conviene tener presente: tras recargar la página la
 * interfaz **no sabe** si hay sesión hasta que `comprobar()` termina. Por eso
 * existe `comprobada`, y por eso el guard del router espera a esa llamada en
 * vez de asumir que no hay sesión y mandar al login a un usuario que sí la
 * tenía.
 */

interface RetoDeSegundoFactor {
  readonly retoId: string;
  readonly retoTestigo: string;
  readonly expiraEn: string;
}

interface EstadoDeSesion {
  usuario: PerfilPublico | null;
  /** `true` mientras hay una llamada de autenticación en vuelo. */
  cargando: boolean;
  /** `true` en cuanto se ha preguntado una vez a `GET /auth/me`. */
  comprobada: boolean;
  /** Reto pendiente si la cuenta tiene segundo factor activo. */
  reto: RetoDeSegundoFactor | null;
  error: string | null;
}

export const usarAlmacenDeSesion = defineStore('sesion', {
  state: (): EstadoDeSesion => ({
    usuario: null,
    cargando: false,
    comprobada: false,
    reto: null,
    error: null,
  }),

  getters: {
    autenticado: (estado): boolean => estado.usuario !== null,
    nombreVisible: (estado): string => estado.usuario?.displayName ?? '',
    iniciales: (estado): string => {
      const nombre = estado.usuario?.displayName ?? '';
      const partes = nombre.trim().split(/\s+/u).filter(Boolean);
      if (partes.length === 0) return '·';
      const primera = partes[0]?.[0] ?? '';
      const segunda = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : '';
      return (primera + segunda).toUpperCase();
    },
  },

  actions: {
    /**
     * Pregunta a la API quién es el usuario de la cookie actual.
     *
     * Un 401 **no es un fallo**: es la respuesta normal cuando no hay sesión.
     * Por eso no se registra como error de la interfaz. Cualquier otro fallo sí.
     */
    async comprobar(): Promise<void> {
      this.cargando = true;
      try {
        const { usuario } = await autenticacion.perfilActual();
        this.usuario = usuario;
        this.error = null;
      } catch (error) {
        this.usuario = null;
        if (error instanceof ErrorDeApi && error.esNoAutenticado) {
          this.error = null;
        } else {
          this.error = error instanceof Error ? error.message : 'No se pudo comprobar la sesión.';
        }
      } finally {
        this.comprobada = true;
        this.cargando = false;
      }
    },

    /** Aplica el resultado de `login` o `mfa/verify`. */
    aplicarInicio(respuesta: RespuestaDeInicio): boolean {
      if (exigeSegundoFactor(respuesta)) {
        this.reto = {
          retoId: respuesta.retoId,
          retoTestigo: respuesta.retoTestigo,
          expiraEn: respuesta.expiraEn,
        };
        this.usuario = null;
        return false;
      }
      this.usuario = respuesta.usuario;
      this.reto = null;
      this.comprobada = true;
      return true;
    },

    /** @returns `true` si la sesión quedó abierta; `false` si falta el 2FA. */
    async iniciar(email: string, password: string): Promise<boolean> {
      this.cargando = true;
      this.error = null;
      try {
        return this.aplicarInicio(await autenticacion.iniciarSesion({ email, password }));
      } finally {
        this.cargando = false;
      }
    },

    async verificarSegundoFactor(codigo: string): Promise<boolean> {
      if (this.reto === null) throw new Error('No hay ningún reto de segundo factor pendiente.');
      this.cargando = true;
      this.error = null;
      try {
        return this.aplicarInicio(
          await autenticacion.verificarSegundoFactor({
            retoId: this.reto.retoId,
            retoTestigo: this.reto.retoTestigo,
            codigo,
          }),
        );
      } finally {
        this.cargando = false;
      }
    },

    /**
     * Registro y, a continuación, inicio de sesión.
     *
     * `POST /auth/register` **no** emite cookie de sesión (comprobado en
     * `identity.controller.ts`: devuelve sólo `{ usuario }`). Así que para que
     * el usuario acabe dentro hay que encadenar el `login`. Se hace aquí, y no
     * en la vista, para que no haya dos sitios que lo recuerden.
     */
    async registrarEIniciar(
      email: string,
      password: string,
      displayName: string,
    ): Promise<boolean> {
      this.cargando = true;
      this.error = null;
      try {
        await autenticacion.registrar({ email, password, displayName });
      } finally {
        this.cargando = false;
      }
      return this.iniciar(email, password);
    },

    /**
     * Cierra la sesión en el servidor y limpia el estado local.
     *
     * El estado local se limpia **pase lo que pase**: si la llamada falla
     * porque la sesión ya estaba revocada, dejar la interfaz como si siguiera
     * dentro sería peor que un cierre optimista.
     */
    async cerrar(): Promise<void> {
      this.cargando = true;
      try {
        await autenticacion.cerrarSesion();
      } catch {
        // Se ignora a propósito: ver comentario de arriba.
      } finally {
        this.usuario = null;
        this.reto = null;
        this.error = null;
        this.comprobada = true;
        this.cargando = false;
      }
    },

    /** Lo invoca el cliente cuando la API responde 401 a media navegación. */
    marcarSesionCaducada(): void {
      this.usuario = null;
      this.reto = null;
      this.comprobada = true;
    },
  },
});
