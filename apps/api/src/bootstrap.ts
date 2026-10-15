import fastifyCookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ConfiguracionApp } from './platform/config/app-config.ts';

/**
 * Configuración de la aplicación Nest+Fastify, compartida por el arranque real
 * (`main.ts`) y por las pruebas de integración, para que lo que se prueba sea
 * **la misma** aplicación y no una maqueta parecida.
 */
export async function configurarAplicacion(
  app: NestFastifyApplication,
  config: ConfiguracionApp,
): Promise<void> {
  // Cookies: sin `secret`, porque aquí no se usan cookies firmadas por el
  // plugin. La firma del testigo CSRF la hace `platform/csrf/csrf-token.ts`
  // con `CEIBA_CSRF_SECRET`, y el testigo de sesión es opaco con su hash en
  // base de datos.
  await app.register(fastifyCookie);

  await app.register(helmet, {
    // La API no sirve HTML; la CSP relevante es la de la SPA, que vive en
    // Nginx (ámbito de `devops-release`). Aquí se desactiva para no emitir una
    // política contradictoria desde dos sitios.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });

  // §19 del prompt maestro: la API vive bajo `/api/v1`.
  //
  // `/healthz` queda FUERA del prefijo porque así lo llaman el `HEALTHCHECK`
  // de `infra/docker/api.Dockerfile` y el de `infra/compose.yaml`, ya
  // commiteados: `fetch('http://127.0.0.1:'+PORT+'/healthz')`. Me adapto al
  // contrato que ya existe en vez de obligar a `devops-release` a cambiarlo.
  app.setGlobalPrefix('api/v1', { exclude: ['healthz'] });

  // CORS **no** se configura, y es deliberado (ADR-0009 §6.3): la SPA y la API
  // se sirven desde el mismo origen tras Nginx, así que no hay peticiones
  // legítimas entre sitios. Añadir `Access-Control-Allow-Credentials` sería
  // debilitar la postura sin necesidad.
  void config;
}
