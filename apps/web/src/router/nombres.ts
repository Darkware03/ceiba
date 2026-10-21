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
 *
 * `login` y `workspace` son los nombres **del contrato de la fase 1**, el que
 * ejercitan `test/ruta-protegida.test.ts` y `test/workspaces.test.ts`.
 * Renombrarlos a `acceso` y `workspace-detalle` dejó cinco pruebas en rojo sin
 * aportar nada: el nombre de una ruta es un identificador interno —las URL
 * públicas siguen siendo `/acceso` y `/workspaces/:id`—. Se restauran, y el
 * mapa `NOMBRES_RUTAS` que añadió el cliente se conserva entero para que las
 * vistas nuevas sigan funcionando sin tocarlas.
 */

export const RUTA_LOGIN = 'login';
export const RUTA_REGISTRO = 'registro';
export const RUTA_WORKSPACES = 'workspaces';
export const RUTA_WORKSPACE = 'workspace';
/**
 * Detalle de una colección: sus peticiones.
 *
 * Hasta la fase 6 no existía, y por eso `FilaDeColeccion.vue` decía «esa
 * pantalla todavía no existe en esta ronda». Abrir una colección no llevaba a
 * ningún sitio: es el fallo que reportó el cliente.
 */
export const RUTA_COLECCION = 'coleccion';
export const RUTA_CONSTRUCTOR = 'constructor';
export const RUTA_HISTORIAL = 'historial';
export const RUTA_ENTORNOS = 'entornos';
export const RUTA_EJECUCIONES = 'ejecuciones';
export const RUTA_DOCUMENTACION = 'documentacion';
export const RUTA_IMPORTAR = 'importar';
export const RUTA_CONFIGURACION = 'configuracion';
export const RUTA_INVITACION = 'invitacion';
export const RUTA_NO_ENCONTRADA = 'no-encontrada';

export const NOMBRES_RUTAS = {
  ACCESO: RUTA_LOGIN,
  REGISTRO: RUTA_REGISTRO,
  WORKSPACES: RUTA_WORKSPACES,
  WORKSPACE_DETALLE: RUTA_WORKSPACE,
  COLECCION: RUTA_COLECCION,
  COLECCION_DETALLE: RUTA_COLECCION,
  CONSTRUCTOR: RUTA_CONSTRUCTOR,
  HISTORIAL: RUTA_HISTORIAL,
  ENTORNOS: RUTA_ENTORNOS,
  EJECUCIONES: RUTA_EJECUCIONES,
  DOCUMENTACION: RUTA_DOCUMENTACION,
  IMPORTAR: RUTA_IMPORTAR,
  CONFIGURACION: RUTA_CONFIGURACION,
  INVITACION: RUTA_INVITACION,
  NO_ENCONTRADA: RUTA_NO_ENCONTRADA,
  /** Alias: `rutas.ts` lo escribe en masculino. Un nombre, dos puertas. */
  NO_ENCONTRADO: RUTA_NO_ENCONTRADA,
} as const;

export type NombreDeRuta = (typeof NOMBRES_RUTAS)[keyof typeof NOMBRES_RUTAS];
export const NOMBRES_RUTA = NOMBRES_RUTAS;
