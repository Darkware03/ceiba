import { isAbsolute, resolve } from 'node:path';

/**
 * Configuración del almacén de ficheros.
 *
 * **Por qué se lee de `process.env` aquí y no de `ConfiguracionApp`:**
 * `apps/api/src/platform/config/app-config.ts` es el sitio natural, pero está
 * **fuera de mi ámbito de escritura** en la fase 7 (§3.A del BRIEF-FASE7 me
 * limita a `modules/request/**`, `modules/file/**`, `app.module.ts` y
 * `test/**`). Se lee aquí, con los mismos criterios de aquel fichero: valores
 * por defecto explícitos, validación estricta y **fallo cerrado** si lo que
 * llega no es un número válido. Queda **declarado como petición de cambio
 * fuera de ámbito** en el informe: lo natural es moverlo a `app-config.ts`.
 */

/** §2.2 del BRIEF-FASE7: «límite de tamaño configurable con defecto 10 MiB». */
export const LIMITE_POR_DEFECTO_BYTES = 10 * 1024 * 1024;

/**
 * `ck_file_size` de la migración tope `size_bytes` a 104857600 (100 MiB). Un
 * `CEIBA_FILE_MAX_BYTES` por encima produciría filas que el CHECK rechaza, así
 * que el techo se impone aquí y se avisa en vez de reventar en la inserción.
 */
export const TOPE_ABSOLUTO_BYTES = 104_857_600;

export interface ConfiguracionDeFicheros {
  readonly maxBytes: number;
  /** Raíz del almacén `local_fs`. Siempre absoluta. */
  readonly directorioBase: string;
  readonly maxPartes: number;
}

export function cargarConfiguracionDeFicheros(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): ConfiguracionDeFicheros {
  const maxBytes = enteroPositivo(
    env['CEIBA_FILE_MAX_BYTES'],
    LIMITE_POR_DEFECTO_BYTES,
    'CEIBA_FILE_MAX_BYTES',
  );
  if (maxBytes > TOPE_ABSOLUTO_BYTES) {
    throw new Error(
      `CEIBA_FILE_MAX_BYTES=${maxBytes} supera el tope de ck_file_size (${TOPE_ABSOLUTO_BYTES}); la fila sería rechazada por PostgreSQL`,
    );
  }

  const bruto = env['CEIBA_FILE_STORAGE_DIR']?.trim();
  const directorioBase =
    bruto !== undefined && bruto !== ''
      ? isAbsolute(bruto)
        ? bruto
        : resolve(cwd, bruto)
      : resolve(cwd, 'var/ceiba-files');

  return Object.freeze({
    maxBytes,
    directorioBase,
    maxPartes: enteroPositivo(env['CEIBA_FILE_MAX_PARTS'], 16, 'CEIBA_FILE_MAX_PARTS'),
  });
}

function enteroPositivo(bruto: string | undefined, porDefecto: number, nombre: string): number {
  if (bruto === undefined || bruto.trim() === '') return porDefecto;
  const valor = Number(bruto);
  if (!Number.isSafeInteger(valor) || valor <= 0) {
    throw new Error(`${nombre} debe ser un entero positivo; llegó "${bruto}"`);
  }
  return valor;
}
