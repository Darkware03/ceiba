import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import {
  CONFIGURACION_DE_FICHEROS,
  type ConfiguracionDeFicheros,
} from './file.tokens.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * Almacén `local_fs`.
 *
 * TRES REGLAS QUE NO SE NEGOCIAN (§2.2 del BRIEF-FASE7)
 * ----------------------------------------------------
 *  1. **`storage_key` NUNCA se deriva del nombre que manda el cliente.** Se
 *     genera: `workspaces/<uuid-workspace>/<uuid-v4>`. El nombre original se
 *     guarda **sólo** como metadato en `files.original_filename`, que es una
 *     columna de texto y no una ruta. Así `../../etc/passwd`, `C:\…`, un `NUL`
 *     incrustado o un nombre de 4 KiB no pueden influir en dónde se escribe.
 *  2. **La ruta final se vuelve a comprobar contra la base antes de escribir.**
 *     Es redundante —la clave la generamos nosotros— y por eso está: si alguien
 *     cambia el generador en el futuro, la comprobación sigue aquí.
 *  3. **El fichero no es público jamás.** Esta capa no sirve bytes; sólo
 *     escribe y borra. No hay ningún método que devuelva el contenido al
 *     cliente web, que es lo que pide «nunca bytes al cliente».
 * ════════════════════════════════════════════════════════════════════════════
 */

export interface FicheroGuardado {
  readonly storageKey: string;
  readonly sizeBytes: number;
  readonly checksumSha256: Buffer;
}

@Injectable()
export class AlmacenDeFicheros {
  constructor(
    @Inject(CONFIGURACION_DE_FICHEROS) private readonly config: ConfiguracionDeFicheros,
  ) {}

  /** Clave generada. El nombre del cliente no participa. */
  nuevaClave(workspaceId: string): string {
    return `workspaces/${workspaceId}/${randomUUID()}`;
  }

  async guardar(storageKey: string, contenido: Buffer): Promise<FicheroGuardado> {
    const destino = this.#rutaSegura(storageKey);
    await mkdir(dirname(destino), { recursive: true });
    // `wx`: si la clave ya existiese —imposible con un UUID v4, pero el fallo
    // cerrado es gratis— se falla en vez de pisar el fichero de otro.
    await writeFile(destino, contenido, { flag: 'wx', mode: 0o600 });
    return {
      storageKey,
      sizeBytes: contenido.length,
      checksumSha256: createHash('sha256').update(contenido).digest(),
    };
  }

  /**
   * **El ÚNICO camino de lectura de bytes de todo el módulo**, y existe por un
   * motivo concreto: el motor de ejecución es un proceso aparte, SIN ESTADO y
   * sin sistema de ficheros compartido (ADR-0002), así que para enviar un
   * adjunto hay que leerlo aquí y mandárselo en base64.
   *
   * Esto **no** contradice el «nunca bytes al cliente web» del §2.2: no hay
   * ninguna ruta HTTP que llegue hasta aquí. Es tráfico servidor-a-servidor
   * dentro del despliegue. Si algún día alguien quisiera exponerlo, tendría
   * que escribir el controlador a mano, y este comentario estará ahí.
   */
  async leerParaElMotor(storageKey: string): Promise<Buffer> {
    return readFile(this.#rutaSegura(storageKey));
  }

  /**
   * Borra los bytes. El borrado de la FILA es lógico (`deleted_at`); esto es el
   * purgado del objeto. Se tolera que el fichero ya no esté: borrar dos veces
   * no es un error que deba propagarse al usuario.
   */
  async purgar(storageKey: string): Promise<void> {
    await rm(this.#rutaSegura(storageKey), { force: true });
  }

  #rutaSegura(storageKey: string): string {
    if (storageKey.includes('\u0000')) {
      throw new Error('storage_key con NUL');
    }
    const base = resolve(this.config.directorioBase);
    const destino = resolve(join(base, storageKey));
    if (destino !== base && !destino.startsWith(base + sep)) {
      // Defensa en profundidad: la clave la generamos nosotros, pero si algún
      // día dejara de ser así, aquí se corta.
      throw new Error('storage_key fuera del directorio base del almacén');
    }
    return destino;
  }
}
