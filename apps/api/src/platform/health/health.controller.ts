import { Controller, Get, Inject } from '@nestjs/common';
import { CONFIGURACION_APP, type ConfiguracionApp } from '../config/app-config.ts';
import { Publico } from '../auth/decorators.ts';

/**
 * Salud del proceso.
 *
 * `GET /healthz` va **fuera** del prefijo `/api/v1`. No es un capricho: el
 * `HEALTHCHECK` de `infra/docker/api.Dockerfile` y el de `infra/compose.yaml`
 * —ya commiteados por `devops-release`— llaman literalmente a
 * `http://127.0.0.1:${CEIBA_API_PORT}/healthz`. Si la sonda no encuentra esa
 * ruta, el contenedor se reinicia en bucle y `depends_on: service_healthy`
 * bloquea a Nginx. La exclusión del prefijo se declara en `bootstrap.ts`.
 *
 * Todas son `@Publico()` porque la sonda no tiene cookie, y **no revelan
 * nada**: ni versiones, ni URL de base de datos, ni nombres de host internos.
 * Un endpoint de salud locuaz es un regalo para el reconocimiento previo.
 */
@Controller()
export class ControladorDeSalud {
  constructor(@Inject(CONFIGURACION_APP) private readonly config: ConfiguracionApp) {}

  /** Contrato con `infra/`. NO cambiar la ruta sin avisar a `devops-release`. */
  @Publico()
  @Get('healthz')
  sonda(): { estado: 'ok' } {
    return { estado: 'ok' };
  }

  @Publico()
  @Get('health')
  estado(): { estado: 'ok'; entorno: string } {
    return { estado: 'ok', entorno: this.config.entorno };
  }

  @Publico()
  @Get('health/live')
  vivo(): { estado: 'ok' } {
    return { estado: 'ok' };
  }

  /**
   * Hoy sólo mira la configuración, porque no hay dependencias externas que
   * sondear en este contenedor. Cuando existan PostgreSQL y Redis, aquí es
   * donde se comprueban, y entonces debe poder responder «no listo».
   */
  @Publico()
  @Get('health/ready')
  listo(): { estado: 'ok'; persistencia: string } {
    return { estado: 'ok', persistencia: this.config.driverPersistencia };
  }
}
