import { Global, Module, type DynamicModule, type Provider } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import {
  CONFIGURACION_APP,
  cargarConfiguracion,
  type ConfiguracionApp,
} from './config/app-config.ts';
import { RELOJ, RelojDelSistema, type Reloj } from './time/clock.ts';
import { TESTIGO_CSRF, TestigoCsrf } from './csrf/csrf-token.ts';
import {
  HASHER_DE_CONTRASENA,
  HasherArgon2id,
} from './crypto/password-hasher.ts';
import { PUERTO_DE_AUDITORIA } from './audit/ports.ts';
import { SumideroDeAuditoriaEnLog } from './audit/logging-audit.service.ts';
import {
  RATE_LIMIT_STORE,
  RateLimitStoreEnMemoria,
} from './ratelimit/rate-limit-store.ts';
import { RegistroDeResolutores } from './auth/resource-resolver.registry.ts';
import { GuardDeLimiteDeTasa } from './guards/rate-limit.guard.ts';
import { GuardCsrf } from './guards/csrf.guard.ts';
import { FiltroDeErroresDeDominio } from './errors/domain-error.filter.ts';
import { ControladorDeSalud } from './health/health.controller.ts';
import {
  REPOSITORIO_DE_COLECCIONES,
  REPOSITORIO_DE_SESIONES,
  REPOSITORIO_DE_USUARIOS,
  REPOSITORIO_DE_WORKSPACES,
} from './persistence/repositories.ts';
import {
  RepositorioDeColeccionesEnMemoria,
  RepositorioDeSesionesEnMemoria,
  RepositorioDeUsuariosEnMemoria,
  RepositorioDeWorkspacesEnMemoria,
} from './persistence/in-memory/in-memory.repositories.ts';
import {
  CLIENTE_PRISMA,
  cargarClientePrisma,
  type ClientePrismaCeiba,
} from './persistence/prisma/prisma-client.ts';
import {
  RepositorioDeColeccionesPrisma,
  RepositorioDeSesionesPrisma,
  RepositorioDeUsuariosPrisma,
  RepositorioDeWorkspacesPrisma,
} from './persistence/prisma/prisma.repositories.ts';

/**
 * Infraestructura compartida. `platform` tiene **cero dependencias** hacia
 * `modules/` (ADR-0004 §6): publica puertos, y son los módulos los que los
 * implementan y los registran.
 *
 * ORDEN DE LOS GUARDS GLOBALES, que no es cosmético:
 *   1. `GuardDeLimiteDeTasa`— corta el abuso antes de cualquier trabajo caro.
 *   2. `GuardCsrf`          — rechaza la mutación antes de tocar la base de datos.
 *   3. `GuardDeSesion`      — resuelve el principal (y rota la sesión si toca).
 *   4. `GuardDeAutorizacion`— necesita el principal del paso 3.
 *
 * **Aqui solo se registran los dos primeros.** `GuardDeSesion` y
 * `GuardDeAutorizacion` inyectan `PUERTO_DE_SESION` y
 * `PUERTO_AUTORIZACION_WORKSPACE`, que implementan `modules/identity` y
 * `modules/workspace`. Nest resuelve un `APP_GUARD` en el contexto del modulo
 * que lo declara, y `platform` —por el ADR-0004 §6— no importa `modules/`:
 * declararlos aqui rompe la inyeccion. Se registran en `AppModule`, que ve
 * ambos lados. El orden se conserva porque `AppModule` importa
 * `ModuloDePlataforma` antes de declarar sus propios proveedores.
 */
@Global()
@Module({})
export class ModuloDePlataforma {
  static forRoot(entorno: NodeJS.ProcessEnv = process.env): DynamicModule {
    const config = cargarConfiguracion(entorno);

    const proveedores: Provider[] = [
      { provide: CONFIGURACION_APP, useValue: config },
      { provide: RELOJ, useClass: RelojDelSistema },
      { provide: TESTIGO_CSRF, useValue: new TestigoCsrf(config.csrfSecret) },
      { provide: HASHER_DE_CONTRASENA, useClass: HasherArgon2id },
      { provide: PUERTO_DE_AUDITORIA, useClass: SumideroDeAuditoriaEnLog },
      {
        provide: RATE_LIMIT_STORE,
        useFactory: (reloj: Reloj) => new RateLimitStoreEnMemoria(reloj),
        inject: [RELOJ],
      },
      RegistroDeResolutores,
      ...proveedoresDePersistencia(config),
      { provide: APP_GUARD, useClass: GuardDeLimiteDeTasa },
      { provide: APP_GUARD, useClass: GuardCsrf },
      { provide: APP_FILTER, useClass: FiltroDeErroresDeDominio },
    ];

    return {
      module: ModuloDePlataforma,
      controllers: [ControladorDeSalud],
      providers: proveedores,
      exports: [
        CONFIGURACION_APP,
        RELOJ,
        TESTIGO_CSRF,
        HASHER_DE_CONTRASENA,
        PUERTO_DE_AUDITORIA,
        RATE_LIMIT_STORE,
        RegistroDeResolutores,
        REPOSITORIO_DE_USUARIOS,
        REPOSITORIO_DE_SESIONES,
        REPOSITORIO_DE_WORKSPACES,
        REPOSITORIO_DE_COLECCIONES,
      ],
    };
  }
}

/**
 * Selección de driver. `memory` sólo fuera de producción: `cargarConfiguracion`
 * ya aborta el arranque si alguien lo intenta con `NODE_ENV=production`.
 */
function proveedoresDePersistencia(config: ConfiguracionApp): Provider[] {
  if (config.driverPersistencia === 'memory') {
    return [
      { provide: REPOSITORIO_DE_USUARIOS, useClass: RepositorioDeUsuariosEnMemoria },
      { provide: REPOSITORIO_DE_SESIONES, useClass: RepositorioDeSesionesEnMemoria },
      { provide: REPOSITORIO_DE_WORKSPACES, useClass: RepositorioDeWorkspacesEnMemoria },
      { provide: REPOSITORIO_DE_COLECCIONES, useClass: RepositorioDeColeccionesEnMemoria },
    ];
  }

  return [
    {
      provide: CLIENTE_PRISMA,
      // [NO VERIFICADO]: el cliente no está generado en este árbol. Si falta,
      // `cargarClientePrisma` lanza con el comando exacto y el arranque aborta.
      useFactory: async () => cargarClientePrisma(config.databaseUrl as string),
    },
    {
      provide: REPOSITORIO_DE_USUARIOS,
      useFactory: (p: ClientePrismaCeiba) => new RepositorioDeUsuariosPrisma(p),
      inject: [CLIENTE_PRISMA],
    },
    {
      provide: REPOSITORIO_DE_SESIONES,
      useFactory: (p: ClientePrismaCeiba) => new RepositorioDeSesionesPrisma(p),
      inject: [CLIENTE_PRISMA],
    },
    {
      provide: REPOSITORIO_DE_WORKSPACES,
      useFactory: (p: ClientePrismaCeiba) => new RepositorioDeWorkspacesPrisma(p),
      inject: [CLIENTE_PRISMA],
    },
    {
      provide: REPOSITORIO_DE_COLECCIONES,
      useFactory: (p: ClientePrismaCeiba) => new RepositorioDeColeccionesPrisma(p),
      inject: [CLIENTE_PRISMA],
    },
  ];
}
