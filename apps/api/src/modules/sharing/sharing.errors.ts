import { ErrorDeDominio } from '../../platform/errors/domain-errors.ts';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * C-CODE-04 — La ÚNICA respuesta de fallo del acceso compartido.
 *
 * *«El endpoint de validación no revela si el enlace existe, si existió, si
 * expiró, si fue revocado o si el código es incorrecto.»*
 *
 * Una sola clase, sin mensaje variable y sin detalles, para que **no se pueda**
 * escribir un caso que responda distinto: no hay constructor al que pasarle un
 * motivo. El motivo real se escribe en `share_access_attempts.result`, que es
 * la auditoría del propietario, y nunca sale por el cable.
 *
 * `FiltroDeErroresDeDominio` la serializa como
 * `{"error":"invalid_access","mensaje":"El enlace o el código no son válidos."}`,
 * byte a byte igual en los seis escenarios de fallo.
 *
 * DESVIACIÓN DECLARADA respecto a la letra de C-CODE-04, que escribe la clave
 * del cuerpo como `message`. El serializador de errores de este producto emite
 * `mensaje` para **todos** los errores, y `apps/web/src/api/errores.ts` lee esa
 * clave. Emitir aquí `message` obligaría a la SPA a tratar esta ruta aparte, o
 * a duplicar la clave. Lo que C-CODE-04 exige de verdad —cuerpo, estado y
 * cabeceras IDÉNTICOS entre causas— se cumple igual.
 * ════════════════════════════════════════════════════════════════════════════
 */
export class AccesoCompartidoInvalido extends ErrorDeDominio {
  override readonly name = 'AccesoCompartidoInvalido';
  readonly estadoHttp = 401;
  readonly codigo = 'invalid_access';

  constructor() {
    super('El enlace o el código no son válidos.');
  }
}

/**
 * C-CODE-05 — *«El código viaja SOLO en el cuerpo de un POST. Nunca en query
 * string, nunca en path, nunca en un GET.»*
 *
 * No basta con no documentarlo: si una integración lo pone en la URL, el
 * `Referer`, el log de Nginx y el historial del navegador lo guardan. Por eso
 * la presencia de un parámetro de consulta con nombre de código **aborta la
 * petición**, en vez de ignorarlo en silencio.
 */
export class CodigoEnLaUrl extends ErrorDeDominio {
  override readonly name = 'CodigoEnLaUrl';
  readonly estadoHttp = 400;
  readonly codigo = 'code_in_url';

  constructor() {
    super(
      'El código de acceso no puede viajar en la URL. Envíalo en el cuerpo de ' +
        'POST /api/v1/share/:slug/access.',
    );
  }
}
