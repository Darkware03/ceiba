import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { DemasiadasPeticiones } from '../errors/domain-errors.ts';
import { RATE_LIMIT_STORE, type RateLimitStore } from '../ratelimit/rate-limit-store.ts';
import type { PeticionHttp } from '../http/http-types.ts';

/** Límite global por IP. Umbral deliberadamente holgado: es un tope de abuso. */
export const VENTANA_GLOBAL_MS = 60_000;
export const MAX_PETICIONES_GLOBAL = 300;

/**
 * Límite de tasa general de la API (§16 del prompt maestro; el ADR-0009 lo
 * asume explícitamente y lo pone en `platform/`).
 *
 * DESVIACIÓN DECLARADA respecto al ADR-0009 §12, que nombra
 * `@fastify/rate-limit@11.2.1`. Está implementado como **guard de Nest** sobre
 * la **misma interfaz `RateLimitStore` de C-CODE-03** que usa el backoff de
 * inicio de sesión. La razón es la que el propio ADR da para exigir esa
 * interfaz: «para no tener dos contadores distintos en el producto». El plugin
 * de Fastify trae su propio almacén y su propio contrato de `store`; usarlo
 * obligaría a mantener un adaptador hacia un contrato privado del plugin, o a
 * tener dos contadores. Además, un plugin registrado como `onRequest` no
 * aparece en el recorrido de rutas que audita los controles.
 *
 * Se aplica **después** de resolver la IP real (`trustProxy` acotado, §6.1):
 * `peticion.ip` ya es la del último salto de confianza, no la del proxy.
 */
@Injectable()
export class GuardDeLimiteDeTasa implements CanActivate {
  constructor(@Inject(RATE_LIMIT_STORE) private readonly almacen: RateLimitStore) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    if (contexto.getType() !== 'http') return true;
    const peticion = contexto.switchToHttp().getRequest<PeticionHttp>();
    const ip = peticion.ip ?? '0.0.0.0';
    const conteo = await this.almacen.incrementar(`global:${ip}`, VENTANA_GLOBAL_MS);
    if (conteo.contador > MAX_PETICIONES_GLOBAL) {
      throw new DemasiadasPeticiones(conteo.restanteMs / 1000);
    }
    return true;
  }
}
