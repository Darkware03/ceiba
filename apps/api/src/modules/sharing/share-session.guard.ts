import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CONFIGURACION_APP, type ConfiguracionApp } from '../../platform/config/app-config.ts';
import type { PeticionHttp } from '../../platform/http/http-types.ts';
import { permiteOperacion, type OperacionCompartida } from './share-policy.ts';
import {
  CLAVE_PRINCIPAL_COMPARTIDO,
  nombreCookieDeComparticion,
  type PrincipalDeComparticion,
} from './share-principal.ts';
import { AccesoCompartidoInvalido, CodigoEnLaUrl } from './sharing.errors.ts';
import { ServicioDeSesionesCompartidas } from './share-session.service.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * C-CODE-07 — El permiso del enlace se aplica EN EL SERVIDOR.
 *
 * *«Lista de permitidos de operaciones por permiso. Todo lo no listado se
 * deniega por defecto.»* Aquí eso es literal: una ruta compartida **sin**
 * `@RequiereOperacionCompartida` se deniega, igual que `GuardDeAutorizacion`
 * deniega una ruta con rol pero sin `@Recurso`. Fallar abierto por un decorador
 * que falta es exactamente el agujero que el guard existe para tapar.
 *
 * Dos propiedades estructurales, que valen más que cualquier comprobación:
 *
 *  1. **El principal compartido no es un `Principal`.** Vive en otra clave de
 *     la petición y tiene otro tipo, así que ningún guard de workspace ni
 *     ningún `@Usuario()` lo acepta por accidente. Un código de colección
 *     **jamás** concede acceso al workspace, a otras colecciones, a los
 *     miembros ni a la administración.
 *  2. **La colección sale de la SESIÓN, no de la URL.** Ninguna ruta compartida
 *     recibe un `collectionId`. Pedir «la otra colección» no es que esté
 *     prohibido: es que no hay forma de escribirlo.
 * ════════════════════════════════════════════════════════════════════════════
 */

export const META_OPERACION_COMPARTIDA = 'ceiba:operacion-compartida';

export const RequiereOperacionCompartida = (
  operacion: OperacionCompartida,
): MethodDecorator & ClassDecorator => SetMetadata(META_OPERACION_COMPARTIDA, operacion);

/** Inyecta el principal que dejó el guard. */
export const Visitante = createParamDecorator((_dato: unknown, contexto: ExecutionContext) => {
  const peticion = contexto.switchToHttp().getRequest<Record<string, unknown>>();
  return peticion[CLAVE_PRINCIPAL_COMPARTIDO] as PrincipalDeComparticion | undefined;
});

/**
 * Nombres de parámetro de consulta que **nunca** pueden llevar el código
 * (C-CODE-05). No se ignoran: abortan la petición, porque un código en la URL
 * ya ha quedado escrito en el log del proxy y en el historial del navegador
 * antes de que esta línea se ejecute, y lo mínimo es que el cliente se entere.
 */
const PARAMETROS_PROHIBIDOS_EN_URL: readonly string[] = Object.freeze([
  'code',
  'access_code',
  'accesscode',
  'codigo',
  'password',
  'secret',
]);

export function rechazarCodigoEnLaUrl(peticion: PeticionHttp): void {
  const consulta = (peticion as { query?: Record<string, unknown> }).query;
  if (consulta === undefined || consulta === null) return;
  for (const clave of Object.keys(consulta)) {
    if (PARAMETROS_PROHIBIDOS_EN_URL.includes(clave.toLowerCase())) {
      throw new CodigoEnLaUrl();
    }
  }
}

@Injectable()
export class GuardDeSesionCompartida implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(CONFIGURACION_APP) private readonly config: ConfiguracionApp,
    private readonly sesiones: ServicioDeSesionesCompartidas,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    if (contexto.getType() !== 'http') return true;

    const peticion = contexto.switchToHttp().getRequest<PeticionHttp>();
    rechazarCodigoEnLaUrl(peticion);

    const operacion = this.reflector.getAllAndOverride<OperacionCompartida | undefined>(
      META_OPERACION_COMPARTIDA,
      [contexto.getHandler(), contexto.getClass()],
    );
    if (operacion === undefined) {
      // Ruta compartida sin operación declarada: se deniega. No hay comodín.
      throw new AccesoCompartidoInvalido();
    }

    const nombreCookie = nombreCookieDeComparticion(this.config.cookies.secure);
    const principal = await this.sesiones.validar(peticion.cookies?.[nombreCookie]);
    if (principal === null) throw new AccesoCompartidoInvalido();

    if (
      !permiteOperacion(
        {
          permiso: principal.permiso,
          permiteExportar: principal.permiteExportar,
          permiteEjecutar: principal.permiteEjecutar,
        },
        operacion,
      )
    ) {
      // MISMA respuesta que «no hay sesión». Decir «tu permiso no alcanza»
      // confirmaría que la sesión es válida y que el recurso existe, que es lo
      // que C-CODE-04 y el ADR-0009 §7.4 evitan en el resto del producto.
      throw new AccesoCompartidoInvalido();
    }

    (peticion as Record<string, unknown>)[CLAVE_PRINCIPAL_COMPARTIDO] = principal;
    return true;
  }
}
