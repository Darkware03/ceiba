import { Module } from '@nestjs/common';
import { PUERTO_DE_SESION } from '../../platform/auth/ports.ts';
import { ControladorDeIdentidad } from './identity.controller.ts';
import { ServicioDeIdentidad } from './identity.service.ts';
import { ServicioDeSesiones } from './session.service.ts';
import { ALMACEN_DE_RETOS_MFA, AlmacenDeRetosMfaEnMemoria } from './mfa-challenge.store.ts';
import {
  PROVEEDOR_DE_SEMILLA_TOTP,
  ProveedorDeSemillaTotpNoDisponible,
} from './totp-seed.provider.ts';

/**
 * `identity` — Users, Sessions, Invitations (ADR-0004 §6). Depende sólo de
 * `platform`.
 *
 * Aquí se **enlaza** la implementación del puerto `PUERTO_DE_SESION` que
 * declara `platform/auth/ports.ts`: el guard de `platform` llama a este
 * servicio sin importar nada de `modules/`.
 */
@Module({
  controllers: [ControladorDeIdentidad],
  providers: [
    ServicioDeIdentidad,
    ServicioDeSesiones,
    { provide: PUERTO_DE_SESION, useExisting: ServicioDeSesiones },
    { provide: ALMACEN_DE_RETOS_MFA, useClass: AlmacenDeRetosMfaEnMemoria },
    { provide: PROVEEDOR_DE_SEMILLA_TOTP, useClass: ProveedorDeSemillaTotpNoDisponible },
  ],
  exports: [PUERTO_DE_SESION, ServicioDeSesiones],
})
export class ModuloDeIdentidad {}
