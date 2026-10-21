import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ControladorDeFicheros, ControladorDeSubidaDeFicheros } from './file.controller.ts';
import { RepositorioDeFicheros } from './file.repository.ts';
import { ServicioDeFicheros } from './file.service.ts';
import { AlmacenDeFicheros } from './file.storage.ts';
import { cargarConfiguracionDeFicheros } from './file.config.ts';
import { CONFIGURACION_DE_FICHEROS, type ConfiguracionDeFicheros } from './file.tokens.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * `file` — subida y metadatos de ficheros (§2.2 del BRIEF-FASE7).
 *
 * POR QUÉ EL ANALIZADOR DE `multipart/form-data` SE REGISTRA AQUÍ
 * ---------------------------------------------------------------
 * Fastify responde **415** a cualquier `Content-Type` para el que no haya
 * analizador registrado, y la API no declara `@fastify/multipart` (y
 * `apps/api/package.json` está fuera de mi ámbito en esta fase). El registro
 * tiene que ocurrir sobre la instancia de Fastify **antes** de que el servidor
 * escuche; `onModuleInit` corre dentro de `app.init()`, que es exactamente
 * antes. Se usa `HttpAdapterHost` para no tocar `main.ts` ni `bootstrap.ts`,
 * que tampoco son míos.
 *
 * `parseAs: 'buffer'` + `bodyLimit` es lo que convierte el límite de tamaño en
 * un **413 real de Fastify**, antes de asignar el cuerpo: el 10 MiB del §2.2
 * se aplica en el transporte, no después de haberlo leído entero en memoria.
 * El servicio lo vuelve a comprobar, porque una defensa que sólo existe en una
 * capa no es una defensa.
 *
 * El analizador se registra para `multipart/form-data` **con expresión
 * regular**, porque la cabecera real siempre trae `; boundary=…` detrás.
 * ════════════════════════════════════════════════════════════════════════════
 */

interface FastifyConAnalizadores {
  addContentTypeParser(
    tipo: RegExp,
    opciones: { parseAs: 'buffer'; bodyLimit: number },
    manejador: (peticion: unknown, cuerpo: Buffer, hecho: (e: Error | null, r?: unknown) => void) => void,
  ): void;
}

const PATRON_MULTIPART = /^multipart\/form-data/iu;

@Module({
  controllers: [ControladorDeSubidaDeFicheros, ControladorDeFicheros],
  providers: [
    {
      provide: CONFIGURACION_DE_FICHEROS,
      useFactory: (): ConfiguracionDeFicheros => cargarConfiguracionDeFicheros(),
    },
    RepositorioDeFicheros,
    AlmacenDeFicheros,
    ServicioDeFicheros,
  ],
  exports: [ServicioDeFicheros, RepositorioDeFicheros],
})
export class ModuloDeFicheros implements OnModuleInit {
  readonly #log = new Logger('ficheros');

  constructor(private readonly adaptador: HttpAdapterHost) {}

  onModuleInit(): void {
    const instancia = this.adaptador.httpAdapter?.getInstance<FastifyConAnalizadores>();
    if (instancia === undefined || typeof instancia.addContentTypeParser !== 'function') {
      // Un adaptador que no es Fastify (o una aplicación sin HTTP) no es un
      // error aquí: simplemente no hay dónde registrar nada.
      return;
    }
    const config = cargarConfiguracionDeFicheros();
    try {
      instancia.addContentTypeParser(
        PATRON_MULTIPART,
        // Un pelín por encima del límite de fichero: las cabeceras de parte y
        // el delimitador también ocupan, y un fichero de exactamente 10 MiB
        // tiene que poder subirse. El tamaño del FICHERO lo comprueba el
        // servicio sobre la parte ya extraída.
        { parseAs: 'buffer', bodyLimit: config.maxBytes + 64 * 1024 },
        (_peticion, cuerpo, hecho) => {
          hecho(null, cuerpo);
        },
      );
    } catch (error) {
      // Fastify lanza si el tipo ya está registrado. No es motivo para tumbar
      // el arranque: significa que alguien lo registró antes.
      this.#log.warn(
        `no se pudo registrar el analizador multipart: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
