import { Module } from '@nestjs/common';
import {
  CLIENTE_PRISMA,
  type InstanciaClientePrisma,
  PrismaClientService,
} from '../../platform/persistence/prisma/prisma-client.js';
import { StudioCollaborationService } from './studio-collab.service.js';
import { StudioController } from './studio.controller.js';
import { StudioService } from './studio-core.service.js';

@Module({
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
