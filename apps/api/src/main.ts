import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.ts';
import { configurarAplicacion } from './bootstrap.ts';
import { ErrorDeConfiguracion, cargarConfiguracion } from './platform/config/app-config.ts';

/**
 * Arranque de `apps/api`.
 *
 * **Fallo cerrado de principio a fin.** Si la configuración no valida, el
 * proceso no arranca: ni con avisos, ni con valores por defecto «razonables».
 * Un `CEIBA_COOKIE_SECURE=false` colado en producción o un
 * `CEIBA_TRUSTED_PROXIES` abierto son fallos de seguridad silenciosos, y lo
 * único que los hace visibles es que el servicio no levante.
 */
async function arrancar(): Promise<void> {
  const log = new Logger('arranque');

  const config = cargarConfiguracion(process.env);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // ADR-0009 §6.1 y §11.5: NUNCA `true`. El valor sale de
      // CEIBA_TRUSTED_PROXIES y `cargarConfiguracion` rechaza el comodín.
      // Con `trustProxy: true` cualquiera podría falsificar `X-Forwarded-For`,
      // evadir el límite por IP y envenenar `sessions.client_ip`.
      trustProxy: config.proxiesDeConfianza,
      bodyLimit: 1_048_576,
    }),
    { bufferLogs: true },
  );

  await configurarAplicacion(app, config);
  app.enableShutdownHooks();

  await app.listen({ port: config.puerto, host: config.host });
  log.log(`CEIBA API escuchando en ${config.host}:${config.puerto} (${config.entorno})`);
  log.log(`origen público: ${config.origenPublico} · persistencia: ${config.driverPersistencia}`);
}

arrancar().catch((error: unknown) => {
  if (error instanceof ErrorDeConfiguracion) {
    // Sin traza: el mensaje ya dice exactamente qué variable falla.
    process.stderr.write(`\n[CEIBA API] ${error.message}\n\n`);
    process.exit(78); // EX_CONFIG, sysexits.h
  }
  process.stderr.write(`\n[CEIBA API] fallo en el arranque: ${String(error)}\n\n`);
  process.exit(1);
});
