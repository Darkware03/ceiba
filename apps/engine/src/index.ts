/**
 * Arranque del motor de ejecución HTTP de CEIBA (ADR-0002).
 *
 * Proceso independiente: sin credenciales de base de datos, sin clave maestra,
 * sin noción de usuario/workspace/permiso, único con salida arbitraria y SIN
 * ESTADO.
 */
import { loadConfig } from './config.ts';
import { buildServer } from './server.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const app = buildServer({ config });

  // Aviso explícito en el arranque: `globalThis.fetch` usa la copia interna de
  // undici de Node (7.29.1 en Node 24.21.0), que NO lleva nuestra política.
  app.log.info(
    {
      node: process.versions.node,
      undiciInterno: process.versions.undici,
      contrato: 'v1',
      ssrf: 'on',
    },
    'motor CEIBA: fetch global prohibido; toda salida pasa por el dispatcher guardado',
  );

  const shutdown = (signal: string): void => {
    app.log.info({ signal }, 'cerrando motor');
    void app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((err: unknown) => {
  // Fallo cerrado: si la configuración no es segura, el motor no arranca.
  console.error('[ceiba-engine] arranque abortado:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
