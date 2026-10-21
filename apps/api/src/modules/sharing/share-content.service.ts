import { Inject, Injectable } from '@nestjs/common';
import { RELOJ, type Reloj } from '../../platform/time/clock.ts';
import { PUERTO_DE_AUDITORIA, type PuertoDeAuditoria } from '../../platform/audit/ports.ts';
import { RepositorioDeComparticion } from './sharing.repository.ts';
import {
  proyectarColeccionPublicable,
  verificarFronteraDeSecretos,
  type ColeccionPublicada,
  type SolicitudPublicada,
} from './publication.ts';
import { AccesoCompartidoInvalido } from './sharing.errors.ts';
import type { PrincipalDeComparticion } from './share-principal.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * CONTENIDO QUE VE EL VISITANTE.
 *
 * Todo lo que sale de aquí pasa por `proyectarColeccionPublicable`, que
 * construye la salida en **lista de permitidos** y la revisa después con
 * `verificarFronteraDeSecretos`. No hay un segundo camino: si mañana alguien
 * añade un endpoint compartido que devuelva filas crudas, no estará usando
 * este servicio y la revisión lo verá.
 *
 * El `collectionId` **siempre** viene del principal de la sesión, nunca de la
 * URL. Es lo que hace imposible —no «prohibido»— pedir otra colección.
 * ════════════════════════════════════════════════════════════════════════════
 */
@Injectable()
export class ServicioDeContenidoCompartido {
  constructor(
    private readonly repo: RepositorioDeComparticion,
    @Inject(RELOJ) private readonly reloj: Reloj,
    @Inject(PUERTO_DE_AUDITORIA) private readonly auditoria: PuertoDeAuditoria,
  ) {}

  async coleccion(visitante: PrincipalDeComparticion): Promise<ColeccionPublicada> {
    const enlace = await this.repo.buscarEnlacePorId(visitante.sharedLinkId);
    if (enlace === null) throw new AccesoCompartidoInvalido();

    const entrada = await this.repo.leerColeccionPublicable(
      visitante.collectionId,
      enlace.includeExamples,
    );
    if (entrada === null) throw new AccesoCompartidoInvalido();
    return proyectarColeccionPublicable(entrada);
  }

  async solicitud(
    visitante: PrincipalDeComparticion,
    requestId: string,
  ): Promise<SolicitudPublicada> {
    // Comprobación explícita de pertenencia: sin ella, un `requestId` de otra
    // colección se leería igual. Es el §19 del prompt maestro aplicado al
    // visitante anónimo: conocer el identificador no es autorización.
    const pertenece = await this.repo.buscarSolicitudDeColeccion(
      visitante.collectionId,
      requestId,
    );
    if (pertenece === null) throw new AccesoCompartidoInvalido();

    const publicada = await this.coleccion(visitante);
    const solicitud = publicada.requests.find((fila) => fila.id === requestId);
    if (solicitud === undefined) throw new AccesoCompartidoInvalido();
    return solicitud;
  }

  /**
   * Exportación. **Es la misma proyección**, no una segunda serialización: una
   * exportación escrita aparte es exactamente por donde se escapa un secreto
   * (`viewer_export` significa «lectura y descarga **sin secretos**», según el
   * propio comentario del enum).
   */
  async exportar(visitante: PrincipalDeComparticion): Promise<Record<string, unknown>> {
    const coleccion = await this.coleccion(visitante);
    const sobre = {
      ceiba: {
        format: 'ceiba-collection',
        version: 1,
        exportedAt: this.reloj.ahora().toISOString(),
        source: 'shared_link',
        /** Se dice explícitamente que esto NO lleva secretos ni entornos. */
        excludes: ['secrets', 'environments', 'credentials', 'scripts'],
      },
      collection: coleccion,
    };
    verificarFronteraDeSecretos(sobre);

    this.auditoria.registrar({
      accion: 'share.collection.exported',
      actorUserId: null,
      workspaceId: visitante.workspaceId,
      recursoTipo: 'shared_link',
      recursoId: visitante.sharedLinkId,
      outcome: 'success',
      detalles: { collectionId: visitante.collectionId, shareSessionId: visitante.sesionId },
    });
    return sobre;
  }
}
