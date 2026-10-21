import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  CLIENTE_PRISMA,
  type InstanciaClientePrisma,
} from '../persistence/prisma/prisma-client.js';
import type { EventoDeAuditoria, PuertoDeAuditoria } from './ports.js';

const PATRON_ACCION = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/u;

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
  readonly #prisma: InstanciaClientePrisma | null;

  constructor(@Optional() @Inject(CLIENTE_PRISMA) prisma?: any) {
    this.#prisma = prisma ?? null;
  }

  registrar(evento: EventoDeAuditoria): void {
    const accion = evento.accion ?? evento.action ?? 'studio.event';
    if (!PATRON_ACCION.test(accion)) {
      this.#log.error(`verbo de auditoría inválido: ${accion}`);
      return;
    }
    const recursoTipo = evento.recursoTipo ?? evento.resource?.type ?? 'workspace';
    const recursoId = evento.recursoId ?? evento.resource?.id ?? null;
    const rawMeta = evento.metadata ?? evento.detalles ?? evento.details;
    const metadataSaneada = sanearMetadata(rawMeta);

    const saneado: EventoDeAuditoria = {
      ...evento,
      accion,
      recursoTipo,
      recursoId,
      metadata: metadataSaneada,
    };
    this.#registrados.push(saneado);
    this.#log.log(
      JSON.stringify({
        accion,
        actorUserId: saneado.actorUserId ?? null,
        sessionId: saneado.sessionId ?? null,
        workspaceId: saneado.workspaceId ?? null,
        recursoTipo,
        recursoId,
        metadata: metadataSaneada,
      }),
    );

    if (this.#prisma) {
      void this.#persistirEnBaseDeDatos(saneado, accion, recursoTipo, recursoId, metadataSaneada);
    }
  }

  async #persistirEnBaseDeDatos(
    evento: EventoDeAuditoria,
    accion: string,
    recursoTipo: string,
    recursoId: string | null,
    metadata: Record<string, unknown> | undefined,
  ): Promise<void> {
    if (!this.#prisma) return;
    try {
      let actorEmail = evento.actorEmail ?? null;
      if (!actorEmail && evento.actorUserId) {
        const u = await this.#prisma.user.findUnique({
          where: { id: evento.actorUserId },
          select: { email: true },
        });
        actorEmail = u?.email ?? null;
      }
      await this.#prisma.auditLog.create({
        data: {
          
          
          
          action: accion,
          resourceType: recursoTipo,
          targetType: (recursoTipo === 'auth' || recursoTipo === 'user' || recursoTipo === 'session') ? 'user' : (recursoTipo as any),
          resourceId: recursoId,
          outcome: evento.resultado ?? evento.outcome ?? 'success',
          ipAddress: evento.clientIp ?? null,
          userAgent: evento.userAgent ?? null,
          metadata: (metadata ?? undefined) as never,
        },
      });
    } catch (err) {
      this.#log.warn(
        `No se pudo persistir evento de auditoría (${accion}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  eventos(): readonly EventoDeAuditoria[] {
    return this.#registrados;
  }
}

export { SumideroDeAuditoriaEnLog as ServicioDeAuditoriaEnLog };

export function sanearMetadata(
  metadata: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
  if (metadata === undefined) return undefined;
  const salida: Record<string, unknown> = {};
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
