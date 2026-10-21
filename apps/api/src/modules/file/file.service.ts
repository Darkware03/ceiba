import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { RELOJ, type Reloj } from '../../platform/time/clock.ts';
import { Conflicto, EntradaInvalida, RecursoNoEncontrado } from '../../platform/errors/domain-errors.ts';
import { PUERTO_DE_AUDITORIA, type PuertoDeAuditoria } from '../../platform/audit/ports.ts';
import type { ResolutorDeRecurso } from '../../platform/auth/ports.ts';
import { RegistroDeResolutores } from '../../platform/auth/resource-resolver.registry.ts';
import {
  PROPOSITOS_PERMITIDOS,
  RepositorioDeFicheros,
  type FilaFichero,
  type PropositoDeFichero,
} from './file.repository.ts';
import { AlmacenDeFicheros } from './file.storage.ts';
import {
  CONFIGURACION_DE_FICHEROS,
  CargaDemasiadoGrande,
  type ConfiguracionDeFicheros,
} from './file.tokens.ts';
import { analizarMultipart, ErrorMultipart, type ParteMultipart } from './multipart.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * §2.2 del BRIEF-FASE7 — subida, metadatos y borrado lógico de ficheros.
 *
 * AUTORIZACIÓN: igual que el resto del producto. El servicio **no** comprueba
 * permisos; se registra como `ResolutorDeRecurso` de tipo `file` y el guard
 * global hace la cadena `fileId → files.workspace_id → workspace_members`. La
 * subida cuelga de `/workspaces/:workspaceId/files`, donde el recurso ya ES el
 * workspace.
 *
 * LO QUE ESTE SERVICIO **NO** HACE, A PROPÓSITO:
 *  - **No devuelve bytes.** No hay ningún método que lea el contenido. «nunca
 *    bytes al cliente web» del §2.2 se cumple por ausencia de código, que es
 *    la única forma en que una prohibición así se cumple de verdad.
 *  - **No marca `scan_status = 'clean'`.** No hay antivirus en este
 *    despliegue. Dejarlo en `pending` es la verdad; mentirle al esquema sería
 *    peor que no escanear.
 * ════════════════════════════════════════════════════════════════════════════
 */

/** Tipo declarado por el cliente que NUNCA se confía tal cual. */
const CONTENT_TYPE_POR_DEFECTO = 'application/octet-stream';

/**
 * `Content-Type` sólo puede ser un `type/subtype` con parámetros simples. Un
 * valor con CR/LF o con caracteres de control iría a una columna de texto y
 * de ahí, algún día, a una cabecera: se normaliza aquí.
 */
const CONTENT_TYPE_VALIDO = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+\/[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/u;

export interface VistaDeFichero {
  readonly id: string;
  readonly fileName: string | null;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly checksumSha256: string;
  readonly purpose: string;
  readonly scanStatus: string;
  readonly uploadedAt: string;
}

@Injectable()
export class ServicioDeFicheros implements ResolutorDeRecurso, OnModuleInit {
  readonly tipo = 'file';

  constructor(
    private readonly repo: RepositorioDeFicheros,
    private readonly almacen: AlmacenDeFicheros,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(PUERTO_DE_AUDITORIA) private readonly auditoria: PuertoDeAuditoria,
    @Inject(CONFIGURACION_DE_FICHEROS) private readonly config: ConfiguracionDeFicheros,
    private readonly resolutores: RegistroDeResolutores,
  ) {}

  onModuleInit(): void {
    this.resolutores.registrar(this);
  }

  async resolverWorkspaceId(ficheroId: string): Promise<string | null> {
    return this.repo.workspaceIdDeFichero(ficheroId);
  }

  get limiteBytes(): number {
    return this.config.maxBytes;
  }

  // -------------------------------------------------------------------------
  // POST /workspaces/:workspaceId/files
  // -------------------------------------------------------------------------

  async subir(
    workspaceId: string,
    cuerpo: Buffer,
    contentType: string | undefined,
    actorId: string,
    ip: string,
  ): Promise<VistaDeFichero> {
    // El 413 se decide ANTES de mirar el contenido. Fastify ya corta por
    // `bodyLimit`, pero el cuerpo podría llegar por otra vía (p. ej. `inject`
    // en pruebas) y el límite tiene que valer igual.
    if (cuerpo.length > this.config.maxBytes) {
      throw new CargaDemasiadoGrande(
        `El fichero supera el límite de ${this.config.maxBytes} bytes.`,
      );
    }

    let partes: ParteMultipart[];
    try {
      partes = analizarMultipart(cuerpo, contentType, { maxPartes: this.config.maxPartes });
    } catch (error) {
      if (error instanceof ErrorMultipart) {
        throw new EntradaInvalida(`El cuerpo multipart no es válido: ${error.message}`, [
          'file: multipart mal formado',
        ]);
      }
      throw error;
    }

    const parteDeFichero = partes.find((p) => p.nombre === 'file');
    if (parteDeFichero === undefined) {
      throw new EntradaInvalida('Falta el campo «file» del formulario.', ['file: obligatorio']);
    }
    if (parteDeFichero.contenido.length === 0) {
      throw new EntradaInvalida('El fichero está vacío.', ['file: vacío']);
    }
    if (parteDeFichero.contenido.length > this.config.maxBytes) {
      throw new CargaDemasiadoGrande(
        `El fichero supera el límite de ${this.config.maxBytes} bytes.`,
      );
    }

    const proposito = this.#propositoDe(partes);
    const tipoDeclarado = normalizarContentType(parteDeFichero.contentType);

    const clave = this.almacen.nuevaClave(workspaceId);
    const guardado = await this.almacen.guardar(clave, parteDeFichero.contenido);

    let fila: FilaFichero;
    try {
      fila = await this.repo.crear({
        workspaceId,
        ownerUserId: actorId,
        purpose: proposito,
        storageKey: guardado.storageKey,
        originalFilename: parteDeFichero.nombreDeFichero,
        contentType: tipoDeclarado,
        sizeBytes: guardado.sizeBytes,
        checksumSha256: guardado.checksumSha256,
        subidoEn: this.reloj.ahora(),
      });
    } catch (error) {
      // Si la fila no entra, los bytes no se quedan huérfanos en el disco.
      await this.almacen.purgar(guardado.storageKey).catch(() => undefined);
      throw error;
    }

    this.auditoria.registrar({
      accion: 'file.uploaded',
      actorUserId: actorId,
      sessionId: null,
      workspaceId,
      recursoTipo: 'file',
      recursoId: fila.id,
      clientIp: ip,
      // NUNCA el contenido ni la ruta de almacenamiento.
      detalles: {
        purpose: proposito,
        sizeBytes: guardado.sizeBytes,
        contentType: tipoDeclarado,
      },
    });

    return vistaDeFichero(fila);
  }

  // -------------------------------------------------------------------------
  // GET /files/:fileId — metadatos, NUNCA bytes
  // -------------------------------------------------------------------------

  async obtener(ficheroId: string): Promise<VistaDeFichero> {
    const fila = await this.repo.buscar(ficheroId);
    if (fila === null) throw new RecursoNoEncontrado('Fichero no encontrado.');
    return vistaDeFichero(fila);
  }

  // -------------------------------------------------------------------------
  // DELETE /files/:fileId — borrado lógico
  // -------------------------------------------------------------------------

  async borrar(ficheroId: string, actorId: string, ip: string): Promise<void> {
    const fila = await this.repo.buscar(ficheroId);
    if (fila === null) throw new RecursoNoEncontrado('Fichero no encontrado.');

    const referencias = await this.repo.referenciasVivas(ficheroId);
    if (referencias > 0) {
      // `ON DELETE SET NULL` dejaría el cuerpo de la petición apuntando a nada
      // y, en `binary_file`, violaría `ck_body_mode_shape` en el siguiente
      // guardado. Se rechaza con 409 y se dice cuántas referencias hay.
      throw new Conflicto(
        `El fichero sigue adjunto a ${referencias} petición(es). Quítalo de ellas antes de borrarlo.`,
      );
    }

    const ahora = this.reloj.ahora();
    await this.repo.borrarLogicamente(ficheroId, ahora);
    await this.almacen.purgar(fila.storageKey).catch(() => undefined);
    await this.repo.marcarPurgado(ficheroId, ahora);

    this.auditoria.registrar({
      accion: 'file.deleted',
      actorUserId: actorId,
      sessionId: null,
      workspaceId: fila.workspaceId,
      recursoTipo: 'file',
      recursoId: ficheroId,
      clientIp: ip,
      detalles: { purpose: fila.purpose },
    });
  }

  /**
   * Bytes en base64 para el MOTOR de ejecución. Ver el comentario de
   * `AlmacenDeFicheros.leerParaElMotor`: no hay ninguna ruta HTTP que llegue
   * aquí, es tráfico interno. Devuelve `null` si el fichero ya no existe, para
   * que quien ejecute pueda avisar en vez de reventar.
   */
  async bytesEnBase64(
    ficheroId: string,
  ): Promise<{ base64: string; fileName: string | null; contentType: string } | null> {
    const fila = await this.repo.buscar(ficheroId);
    if (fila === null) return null;
    try {
      const bytes = await this.almacen.leerParaElMotor(fila.storageKey);
      return {
        base64: bytes.toString('base64'),
        fileName: fila.originalFilename,
        contentType: fila.contentType,
      };
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------

  #propositoDe(partes: readonly ParteMultipart[]): PropositoDeFichero {
    const bruto = partes.find((p) => p.nombre === 'purpose');
    if (bruto === undefined) return 'form_field_file';
    const valor = bruto.contenido.toString('utf8').trim();
    if (valor === '') return 'form_field_file';
    if (!(PROPOSITOS_PERMITIDOS as readonly string[]).includes(valor)) {
      throw new EntradaInvalida(
        `«purpose» debe ser uno de: ${PROPOSITOS_PERMITIDOS.join(', ')}.`,
        ['purpose: valor no permitido'],
      );
    }
    return valor as PropositoDeFichero;
  }
}

export function normalizarContentType(bruto: string | null): string {
  if (bruto === null) return CONTENT_TYPE_POR_DEFECTO;
  const sinParametros = bruto.split(';')[0]?.trim() ?? '';
  if (sinParametros === '' || !CONTENT_TYPE_VALIDO.test(sinParametros)) {
    return CONTENT_TYPE_POR_DEFECTO;
  }
  return sinParametros.toLowerCase().slice(0, 255);
}

/**
 * Proyección de salida, lista de permitidos explícita (C-LEAK-04). **No sale
 * `storage_key`**: es una ruta interna del servidor y conocerla no le sirve de
 * nada al cliente, pero sí a quien busque un recorrido de directorios.
 */
export function vistaDeFichero(fila: FilaFichero): VistaDeFichero {
  return {
    id: fila.id,
    fileName: fila.originalFilename,
    contentType: fila.contentType,
    sizeBytes: Number(fila.sizeBytes),
    checksumSha256: Buffer.from(fila.checksumSha256).toString('hex'),
    purpose: fila.purpose,
    scanStatus: fila.scanStatus,
    uploadedAt: fila.uploadedAt.toISOString(),
  };
}

/** Resumen reducido que se incrusta en el detalle de una petición (§2.1). */
export function vistaBreveDeFichero(fila: FilaFichero): Record<string, unknown> {
  return {
    id: fila.id,
    fileName: fila.originalFilename,
    contentType: fila.contentType,
    sizeBytes: Number(fila.sizeBytes),
  };
}
