import { Module } from '@nestjs/common';
import {
  ControladorDePeticiones,
  ControladorDePeticionesDeColeccion,
} from './request.controller.ts';
import { RepositorioDePeticiones } from './request.repository.ts';
import { ServicioDePeticiones } from './request.service.ts';

/**
 * `request` — las peticiones dentro de una colección (ADR-0004 §6).
 *
 * Depende de `platform` (reloj, auditoría, registro de resolutores, cliente
 * Prisma) y **de nada más**: no importa `collection` ni `workspace`. La
 * relación petición → colección → workspace la resuelve el repositorio con una
 * consulta, y el guard la consume por el registro de resolutores. Ése es el
 * sentido único de dependencias que `madge --circular` vigila.
 *
 * Se declara como módulo propio y no como dos rutas más dentro de
 * `collection` porque el recurso que autoriza es distinto (`request`, no
 * `collection`) y porque `collection` no debe cargar con el árbol de
 * cabeceras, parámetros y cuerpos.
 */
@Module({
  controllers: [ControladorDePeticionesDeColeccion, ControladorDePeticiones],
  providers: [RepositorioDePeticiones, ServicioDePeticiones],
  exports: [ServicioDePeticiones, RepositorioDePeticiones],
})
export class ModuloDePeticiones {}
