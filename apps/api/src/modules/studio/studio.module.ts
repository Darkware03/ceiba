import { Module } from '@nestjs/common';
import {
  CLIENTE_PRISMA,
  type InstanciaClientePrisma,
  PrismaClientService,
} from '../../platform/persistence/prisma/prisma-client.js';
import { ModuloDeFicheros } from '../file/file.public.js';
import { StudioCollaborationService } from './studio-collab.service.js';
import { StudioController } from './studio.controller.js';
import { StudioService } from './studio-core.service.js';

/**
 * `ModuloDeFicheros` entra aquí por una razón concreta y medida.
 *
 * La fase 7 añadió cuerpos `multipart_form_data` y `binary_file`, que se
 * guardan bien y se exportan bien a cURL... y **nunca se enviaban**: la
 * ejecución (`studio-core.service.ts`) mandaba al motor sólo `{ mode, raw }`,
 * sin `parts` y sin bytes. Un modo que se guarda pero no se envía es peor que
 * no ofrecerlo, así que la ejecución pasa ahora por
 * `construirCuerpoParaElMotor`, y ese adaptador necesita leer los bytes de los
 * ficheros adjuntos: eso es `ServicioDeFicheros.bytesEnBase64`.
 */
@Module({
  imports: [ModuloDeFicheros],
  controllers: [StudioController],
  providers: [
    {
      provide: PrismaClientService,
      useFactory: (client: InstanciaClientePrisma) => new PrismaClientService(client),
      inject: [CLIENTE_PRISMA],
    },
    StudioService,
    StudioCollaborationService,
  ],
  exports: [StudioService, StudioCollaborationService],
})
export class StudioModule {}
