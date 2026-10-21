import { Module } from '@nestjs/common';
import { ModuloDePlataforma } from './platform/platform.module.ts';
import { GUARDS_GLOBALES_DE_LA_RAIZ } from './root-guards.ts';
import { ModuloDeColecciones } from './modules/collection/collection.public.ts';
import { ModuloDeIdentidad } from './modules/identity/identity.public.ts';
import { ModuloDeComparticion } from './modules/sharing/sharing.public.ts';
import { StudioModule } from './modules/studio/studio.module.ts';
import { ModuloDeWorkspaces } from './modules/workspace/workspace.public.ts';

@Module({
  imports: [
    ModuloDePlataforma.forRoot(),
    ModuloDeColecciones,
    ModuloDeIdentidad,
    ModuloDeWorkspaces,
    ModuloDeComparticion,
    StudioModule,
  ],
  providers: [...GUARDS_GLOBALES_DE_LA_RAIZ],
})
export class AppModule {}
