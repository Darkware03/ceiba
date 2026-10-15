import { Injectable, Logger } from '@nestjs/common';
import type { EventoDeAuditoria, PuertoDeAuditoria } from './ports.ts';

/**
 * Sumidero de auditoría de esta ronda.
 *
 * **Lo que hace:** valida la forma del verbo contra el `CHECK` de `audit_logs`,
 * filtra las claves prohibidas de `metadata` y lo escribe al log estructurado.
 * **Lo que NO hace:** escribir en la tabla `audit_logs`. No hay PostgreSQL en
 * este contenedor y el módulo `audit` con su repositorio Prisma es trabajo de
 * la rebanada siguiente. No se simula una escritura que no ocurre.
 */

/** El mismo patrón del `CHECK (action ~ ...)` de `audit_logs`. */
const PATRON_ACCION = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/u;

/**
 * Claves que NUNCA pueden viajar en `metadata` (ADR-0009 §10). La lista se
 * aplica por coincidencia de subcadena sobre el nombre de la clave, en
 * minúsculas: es deliberadamente agresiva.
 */
const CLAVES_PROHIBIDAS = [
  'password',
  'contrasena',
  'contraseña',
  'token',
  'testigo',
  'selector',
  'verifier',
  'verificador',
  'secret',
  'cookie',
  'authorization',
];

@Injectable()
export class SumideroDeAuditoriaEnLog implements PuertoDeAuditoria {
  readonly #log = new Logger('audit');
  readonly #registrados: EventoDeAuditoria[] = [];

  registrar(evento: EventoDeAuditoria): void {
    if (!PATRON_ACCION.test(evento.accion)) {
      // Rechazar aquí es preferible a que PostgreSQL rechace la fila más tarde.
      this.#log.error(`verbo de auditoría inválido: ${evento.accion}`);
      return;
    }
    const saneado: EventoDeAuditoria = {
      ...evento,
      metadata: sanearMetadata(evento.metadata),
    };
    this.#registrados.push(saneado);
    this.#log.log(
      JSON.stringify({
        accion: saneado.accion,
        actorUserId: saneado.actorUserId,
        sessionId: saneado.sessionId,
        workspaceId: saneado.workspaceId,
        recursoTipo: saneado.recursoTipo,
        recursoId: saneado.recursoId,
        metadata: saneado.metadata,
      }),
    );
  }

  /** Sólo para aserciones de prueba. */
  eventos(): readonly EventoDeAuditoria[] {
    return this.#registrados;
  }
}

export function sanearMetadata(
  metadata: EventoDeAuditoria['metadata'],
): EventoDeAuditoria['metadata'] {
  if (metadata === undefined) return undefined;
  const salida: Record<string, string | number | boolean | null> = {};
  for (const [clave, valor] of Object.entries(metadata)) {
    const normalizada = clave.toLowerCase();
    if (CLAVES_PROHIBIDAS.some((prohibida) => normalizada.includes(prohibida))) {
      salida[clave] = '[REDACTADO]';
      continue;
    }
    salida[clave] = valor;
  }
  return salida;
}
