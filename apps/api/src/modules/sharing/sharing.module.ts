import { Module } from '@nestjs/common';
import { RepositorioDeComparticion } from './sharing.repository.ts';
import { ServicioDeAccesoCompartido } from './share-access.service.ts';
import { ServicioDeSesionesCompartidas } from './share-session.service.ts';
import { ServicioDeContenidoCompartido } from './share-content.service.ts';
import { ServicioDeAdministracionDeComparticion } from './sharing-admin.service.ts';
import { GuardDeSesionCompartida } from './share-session.guard.ts';
import { ControladorPublicoDeComparticion } from './share-public.controller.ts';
import {
  ControladorDeComparticionDeColeccion,
  ControladorDeEnlacesCompartidos,
} from './sharing-admin.controller.ts';

/**
 * `sharing` — compartición pública y privada (ámbito SHR del catálogo).
 *
 * Depende de `platform` (reloj, hasher Argon2id, límite de tasa, auditoría,
 * cliente Prisma) y **de nada más**: no importa `collection`, `workspace` ni
 * `identity`. La resolución recurso → workspace va por el registro de
 * resolutores, igual que el resto del producto.
 *
 * `GuardDeSesionCompartida` se declara como proveedor —no como `APP_GUARD`—
 * porque sólo protege las rutas de este módulo. Registrarlo global obligaría a
 * marcar el resto de la API con un decorador de exclusión, que es justo el
 * patrón de «fallo abierto por decorador que falta» que el ADR-0009 evita.
 */
@Module({
  controllers: [
    ControladorPublicoDeComparticion,
    ControladorDeComparticionDeColeccion,
    ControladorDeEnlacesCompartidos,
  ],
  providers: [
    RepositorioDeComparticion,
    ServicioDeSesionesCompartidas,
    ServicioDeAccesoCompartido,
    ServicioDeContenidoCompartido,
    ServicioDeAdministracionDeComparticion,
    GuardDeSesionCompartida,
  ],
  exports: [
    ServicioDeAdministracionDeComparticion,
    ServicioDeSesionesCompartidas,
    ServicioDeAccesoCompartido,
    RepositorioDeComparticion,
  ],
})
export class ModuloDeComparticion {}
