import { Module } from '@nestjs/common';
import { ModuloDePlataforma } from './platform/platform.module.ts';
import { GUARDS_GLOBALES_DE_LA_RAIZ } from './root-guards.ts';
import { ModuloDeColecciones } from './modules/collection/collection.public.ts';
import { ModuloDeIdentidad } from './modules/identity/identity.public.ts';
import { ModuloDeWorkspaces } from './modules/workspace/workspace.public.ts';

/**
 * FICHERO DE COSTURA (ADR-0004 §3).
 *
 * Protocolo vinculante: **sólo se añade**, **una línea por módulo**, **orden
 * alfabético**, y si git marca conflicto aquí la resolución correcta es
 * quedarse con las dos líneas. Nunca se reordena ni se reformatea en el mismo
 * cambio en que se añade una línea.
 *
 * Los módulos se importan por su `*.public.ts`, nunca por su `*.module.ts`.
 *
 * GUARDS GLOBALES QUE CRUZAN LA FRONTERA platform↔modules
 * -------------------------------------------------------
 * `GuardDeSesion` y `GuardDeAutorizacion` viven en `platform/guards/`, pero
 * inyectan `PUERTO_DE_SESION` y `PUERTO_AUTORIZACION_WORKSPACE`, que
 * implementan `modules/identity` y `modules/workspace`.
 *
 * Nest resuelve las dependencias de un `APP_GUARD` **en el contexto del módulo
 * que lo declara**. Declararlos en `ModuloDePlataforma` lanzaba
 * `Nest can't resolve Symbol(PUERTO_DE_SESION)`, porque `platform` no importa
 * `modules/` y no debe hacerlo (ADR-0004 §6: la dependencia va en un solo
 * sentido). La raíz de composición es el único sitio que ve ambos lados, así
 * que el **registro** vive aquí aunque el **código** del guard siga en
 * `platform`. La frontera arquitectónica no se toca.
 *
 * El orden de ejecución documentado en `platform.module.ts` se conserva: Nest
 * recoge los `APP_GUARD` en orden de módulo, y `ModuloDePlataforma` (límite de
 * tasa, CSRF) se importa antes de que este módulo declare los suyos (sesión,
 * autorización).
 */
@Module({
  imports: [
    ModuloDePlataforma.forRoot(),
    ModuloDeColecciones,
    ModuloDeIdentidad,
    ModuloDeWorkspaces,
  ],
  providers: [...GUARDS_GLOBALES_DE_LA_RAIZ],
})
export class AppModule {}
