export const RUTA_LOGIN = 'acceso';
export const RUTA_REGISTRO = 'registro';
export const RUTA_WORKSPACES = 'workspaces';
export const RUTA_WORKSPACE = 'workspace-detalle';
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
  CONSTRUCTOR: RUTA_CONSTRUCTOR,
  HISTORIAL: RUTA_HISTORIAL,
  ENTORNOS: RUTA_ENTORNOS,
  EJECUCIONES: RUTA_EJECUCIONES,
  DOCUMENTACION: RUTA_DOCUMENTACION,
  IMPORTAR: RUTA_IMPORTAR,
  CONFIGURACION: RUTA_CONFIGURACION,
  INVITACION: RUTA_INVITACION,
  NO_ENCONTRADA: RUTA_NO_ENCONTRADA,
} as const;

export type NombreDeRuta = (typeof NOMBRES_RUTAS)[keyof typeof NOMBRES_RUTAS];
export const NOMBRES_RUTA = NOMBRES_RUTAS;
