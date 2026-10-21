import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  CLIENTE_PRISMA,
  type InstanciaClientePrisma,
} from '../persistence/prisma/prisma-client.js';
import type { EventoDeAuditoria, PuertoDeAuditoria } from './ports.js';

const PATRON_ACCION = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/u;

/**
 * `audit_logs.target_type` es el enum `AuditTargetType`, no texto libre.
 *
 * El codigo emitia `recursoTipo` de la aplicacion directamente con un `as any`,
 * y valores como `request_execution` o `collection_run` no estan (el primero no
 * existe en el enum). Un valor fuera del enum aborta el INSERT entero, asi que
 * la auditoria se perdia en silencio dentro del `catch`.
 *
 * Se traduce con una tabla explicita y se **falla al valor neutro `system`**,
 * nunca al literal recibido: perder la precision del tipo es aceptable, perder
 * el registro de auditoria no.
 */
const TIPOS_DE_OBJETIVO = new Set([
  'user',
  'session',
  'workspace',
  'workspace_member',
  'invitation',
  'project',
  'collection',
  'collection_folder',
  'api_request',
  'environment',
  'variable',
  'secret',
  'auth_configuration',
  'shared_link',
  'share_access_code',
  'collection_version',
  'test_definition',
  'collection_run',
  'file',
  'comment',
  'system',
]);

const ALIAS_DE_OBJETIVO: Readonly<Record<string, string>> = Object.freeze({
  auth: 'user',
  request_execution: 'api_request',
  request: 'api_request',
  folder: 'collection_folder',
  member: 'workspace_member',
  run: 'collection_run',
  env: 'environment',
});

function aTipoDeObjetivo(recursoTipo: string): 'system' {
  const directo = ALIAS_DE_OBJETIVO[recursoTipo] ?? recursoTipo;
  return (TIPOS_DE_OBJETIVO.has(directo) ? directo : 'system') as 'system';
}

/** `target_id` es `uuid`: un valor que no lo sea reventaria el INSERT. */
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

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

  constructor(
    @Optional() @Inject(CLIENTE_PRISMA) prisma?: InstanciaClientePrisma | null,
  ) {
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
      // Nombres reales de `audit_logs`: `target_type`/`target_id` (no
      // `resourceType`/`resourceId`, que no existen) y `actor_ip` (no
      // `ipAddress`). `user_agent` no es columna: se guarda su hash, y como aqui
      // no se calcula, no se escribe nada en vez de inventar un campo.
      await this.#prisma.auditLog.create({
        data: {
          action: accion,
          workspaceId: evento.workspaceId ?? null,
          actorUserId: evento.actorUserId ?? null,
          sessionId: evento.sessionId ?? null,
          targetType: aTipoDeObjetivo(recursoTipo),
          targetId: recursoId !== null && PATRON_UUID.test(recursoId) ? recursoId : null,
          targetLabel: actorEmail,
          outcome: evento.resultado ?? evento.outcome ?? 'success',
          actorIp: evento.clientIp ?? null,
          metadata: (metadata ?? {}) as Record<string, string>,
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
