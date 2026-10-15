/**
 * Nombres de ruta, **separados de la tabla de rutas** a propósito.
 *
 * `rutas.ts` importa las vistas en diferido; las vistas, a su vez, necesitan
 * los nombres para construir enlaces. Si los nombres viviesen en `rutas.ts`,
 * cualquier módulo que sólo quisiera un nombre (el guard, una vista, una
 * prueba) arrastraría la tabla entera y con ella **todas** las vistas. Es un
 * ciclo `rutas → vista → rutas` que el import diferido disimula en ejecución
 * pero que rompe las pruebas unitarias del guard.
 *
 * Por eso este fichero no importa nada. Es la hoja del grafo.
 */

export const RUTA_LOGIN = 'login';
export const RUTA_REGISTRO = 'registro';
export const RUTA_WORKSPACES = 'workspaces';
export const RUTA_WORKSPACE = 'workspace';
export const RUTA_CONSTRUCTOR = 'constructor';
export const RUTA_NO_ENCONTRADA = 'no-encontrada';
