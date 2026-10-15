import { APP_GUARD } from '@nestjs/core';
import { GuardDeSesion } from './platform/guards/session.guard.ts';
import { GuardDeAutorizacion } from './platform/guards/authorization.guard.ts';

/**
 * Guards globales que cruzan la frontera `platform` ↔ `modules`.
 *
 * POR QUÉ ESTÁN AQUÍ Y NO EN `platform.module.ts`
 * -----------------------------------------------
 * `GuardDeSesion` y `GuardDeAutorizacion` viven en `platform/guards/`, pero
 * inyectan `PUERTO_DE_SESION` y `PUERTO_AUTORIZACION_WORKSPACE`, que
 * implementan `modules/identity` y `modules/workspace`.
 *
 * Nest resuelve las dependencias de un `APP_GUARD` **en el contexto del módulo
 * que lo declara**. Declararlos en `ModuloDePlataforma` lanzaba
 * `Nest can't resolve Symbol(PUERTO_DE_SESION)`, porque `platform` no importa
 * `modules/` y no debe hacerlo (ADR-0004 §6: la dependencia va en un solo
 * sentido). El **código** del guard sigue en `platform`; sólo su **registro**
 * sube a la raíz, que es el único sitio que ve ambos lados.
 *
 * POR QUÉ ESTÁN EN SU PROPIO FICHERO Y NO EN `app.module.ts`
 * ---------------------------------------------------------
 * Porque el ayudante de pruebas necesita esta misma lista, y
 * `import … from './app.module.ts'` arrastra la evaluación de
 * `ModuloDePlataforma.forRoot()` en el decorador, que se ejecuta **al cargar el
 * módulo** y lee `process.env`. En las pruebas el entorno se pasa explícito,
 * no por `process.env`, así que la carga abortaba con
 * `CEIBA_CSRF_SECRET: expected string, received undefined` antes de que
 * empezara ninguna prueba.
 *
 * Este fichero no importa ningún módulo ni ejecuta nada al cargarse: sólo
 * nombra clases. Por eso puede compartirse sin efectos colaterales.
 *
 * MANTENIMIENTO
 * -------------
 * Añadir aquí un guard lo activa a la vez en la aplicación real y en las
 * pruebas. No dupliques la lista: el ayudante monta su propio
 * `Test.createTestingModule`, y cuando estos dos guards se añadieron sólo en la
 * raíz, las pruebas siguieron montando una aplicación **sin** ellos y 3 de 13
 * fallaron porque las peticiones legítimas se quedaban sin principal.
 */
export const GUARDS_GLOBALES_DE_LA_RAIZ = [
  { provide: APP_GUARD, useClass: GuardDeSesion },
  { provide: APP_GUARD, useClass: GuardDeAutorizacion },
];
