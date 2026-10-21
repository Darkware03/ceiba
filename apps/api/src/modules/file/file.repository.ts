import { Inject, Injectable } from '@nestjs/common';
import {
  CLIENTE_PRISMA,
  type InstanciaClientePrisma,
} from '../../platform/persistence/prisma/prisma-client.ts';

/**
 * Acceso a `files`. **No se crea ni se modifica ninguna columna**: la tabla ya
 * está aplicada (`prisma/schema/09-collaboration-audit.prisma:159`) con
 * `purpose`, `storage`, `storage_key`, `checksum_sha256`, `scan_status`,
 * `reference_count`, `is_public`, `deleted_at` y `purged_at`.
 *
 * Dos restricciones del esquema mandan sobre lo que se puede escribir:
 *  - `ck_file_public`: `is_public = false` salvo avatares e iconos. Los
 *    adjuntos de petición se escriben SIEMPRE con `is_public = false`.
 *  - `ck_file_size`: `0 <= size_bytes <= 104857600`.
 */

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function esUuid(valor: unknown): valor is string {
  return typeof valor === 'string' && PATRON_UUID.test(valor);
}

/** Los dos únicos propósitos que esta API acepta crear (§2.2). */
export const PROPOSITOS_PERMITIDOS = ['form_field_file', 'request_body_binary'] as const;
export type PropositoDeFichero = (typeof PROPOSITOS_PERMITIDOS)[number];

export interface FilaFichero {
  readonly id: string;
  readonly workspaceId: string | null;
  readonly ownerUserId: string | null;
  readonly purpose: string;
  readonly storage: string;
  readonly storageKey: string;
  readonly originalFilename: string | null;
  readonly contentType: string;
  readonly sizeBytes: bigint;
  readonly checksumSha256: Uint8Array;
  readonly scanStatus: string;
  readonly isPublic: boolean;
  readonly referenceCount: number;
  readonly uploadedAt: Date;
  readonly deletedAt: Date | null;
}

const SELECCION = {
  id: true,
  workspaceId: true,
  ownerUserId: true,
  purpose: true,
  storage: true,
  storageKey: true,
  originalFilename: true,
  contentType: true,
  sizeBytes: true,
  checksumSha256: true,
  scanStatus: true,
  isPublic: true,
  referenceCount: true,
  uploadedAt: true,
  deletedAt: true,
} as const;

export interface DatosDeAlta {
  readonly workspaceId: string;
  readonly ownerUserId: string;
  readonly purpose: PropositoDeFichero;
  readonly storageKey: string;
  readonly originalFilename: string | null;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly checksumSha256: Buffer;
  readonly subidoEn: Date;
}

@Injectable()
export class RepositorioDeFicheros {
  constructor(@Inject(CLIENTE_PRISMA) private readonly prisma: InstanciaClientePrisma) {}

  /**
   * Resolución recurso → workspace para el guard (ADR-0009 §7.4). Un fichero
   * borrado lógicamente resuelve a `null` → 404, igual que una petición
   * borrada: devolver su workspace dejaría accesible algo que el usuario cree
   * eliminado.
   */
  async workspaceIdDeFichero(ficheroId: string): Promise<string | null> {
    if (!esUuid(ficheroId)) return null;
    const fila = await this.prisma.file.findFirst({
      where: { id: ficheroId, deletedAt: null },
      select: { workspaceId: true },
    });
    return fila?.workspaceId ?? null;
  }

  async crear(datos: DatosDeAlta): Promise<FilaFichero> {
    return this.prisma.file.create({
      data: {
        workspaceId: datos.workspaceId,
        ownerUserId: datos.ownerUserId,
        purpose: datos.purpose,
        storage: 'local_fs',
        storageKey: datos.storageKey,
        originalFilename: datos.originalFilename,
        contentType: datos.contentType,
        sizeBytes: BigInt(datos.sizeBytes),
        // `Uint8Array.from` y no el `Buffer` tal cual: el tipo generado exige
        // `Uint8Array<ArrayBuffer>` y un `Buffer` puede respaldarse en un
        // `SharedArrayBuffer`. La copia es de 32 bytes.
        checksumSha256: Uint8Array.from(datos.checksumSha256),
        // `scan_status` se queda en `pending`: no hay antivirus en este
        // despliegue y marcarlo `clean` sería mentir. Lo que importa es que
        // **nunca se sirve el contenido**, así que `pending` no bloquea nada
        // real y deja la puerta abierta a enchufar el escáner después.
        isPublic: false,
        uploadedAt: datos.subidoEn,
      },
      select: SELECCION,
    });
  }

  async buscar(ficheroId: string): Promise<FilaFichero | null> {
    if (!esUuid(ficheroId)) return null;
    return this.prisma.file.findFirst({
      where: { id: ficheroId, deletedAt: null },
      select: SELECCION,
    });
  }

  /**
   * Comprueba que un conjunto de identificadores existe, está vivo y pertenece
   * al workspace indicado. Devuelve los que **no** cumplen, para que el
   * servicio pueda dar un 422 preciso sin hacer N consultas.
   *
   * Es la frontera que impide adjuntar a una petición un fichero de OTRO
   * workspace conociendo su UUID.
   */
  async idsInvalidosEnWorkspace(
    ids: readonly string[],
    workspaceId: string,
  ): Promise<readonly string[]> {
    const candidatos = [...new Set(ids)];
    if (candidatos.length === 0) return [];
    const malFormados = candidatos.filter((id) => !esUuid(id));
    const bienFormados = candidatos.filter((id) => esUuid(id));
    if (bienFormados.length === 0) return malFormados;

    const vivos = await this.prisma.file.findMany({
      where: { id: { in: bienFormados }, workspaceId, deletedAt: null },
      select: { id: true },
    });
    const encontrados = new Set(vivos.map((f) => f.id));
    return [...malFormados, ...bienFormados.filter((id) => !encontrados.has(id))];
  }

  /** Metadatos de varios ficheros de golpe, para la proyección de lectura. */
  async metadatosDe(ids: readonly string[]): Promise<Map<string, FilaFichero>> {
    const candidatos = [...new Set(ids)].filter(esUuid);
    if (candidatos.length === 0) return new Map();
    const filas = await this.prisma.file.findMany({
      where: { id: { in: candidatos } },
      select: SELECCION,
    });
    return new Map(filas.map((f) => [f.id, f]));
  }

  /** Borrado **lógico**. Los bytes los purga el servicio aparte. */
  async borrarLogicamente(ficheroId: string, ahora: Date): Promise<void> {
    await this.prisma.file.update({
      where: { id: ficheroId },
      data: { deletedAt: ahora },
    });
  }

  async marcarPurgado(ficheroId: string, ahora: Date): Promise<void> {
    await this.prisma.file.update({
      where: { id: ficheroId },
      data: { purgedAt: ahora },
    });
  }

  /**
   * ¿Sigue referenciado por algún cuerpo o campo de formulario vivo? Si lo
   * está, el borrado se rechaza: dejaría una petición apuntando a un fichero
   * fantasma. `request_bodies.binary_file_id` y `request_body_fields.file_id`
   * son `ON DELETE SET NULL`, así que PostgreSQL no nos protege de esto.
   */
  async referenciasVivas(ficheroId: string): Promise<number> {
    if (!esUuid(ficheroId)) return 0;
    const [cuerpos, campos] = await Promise.all([
      this.prisma.requestBody.count({
        where: { binaryFileId: ficheroId, apiRequest: { deletedAt: null } },
      }),
      this.prisma.requestBodyField.count({
        where: { fileId: ficheroId, requestBody: { apiRequest: { deletedAt: null } } },
      }),
    ]);
    return cuerpos + campos;
  }
}
