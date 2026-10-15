import { Module } from '@nestjs/common';
import {
  ControladorDeColecciones,
  ControladorDeColeccionesDeWorkspace,
} from './collection.controller.ts';
import { ServicioDeColecciones } from './collection.service.ts';

/** `collection` — Collections y su árbol (ADR-0004 §6). Depende de `workspace`. */
@Module({
  controllers: [ControladorDeColeccionesDeWorkspace, ControladorDeColecciones],
  providers: [ServicioDeColecciones],
  exports: [ServicioDeColecciones],
})
export class ModuloDeColecciones {}
