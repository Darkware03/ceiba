/**
 * ════════════════════════════════════════════════════════════════════════════
 * ADAPTADOR: fila de `request_bodies` → `bodySchema` del MOTOR.
 *
 * POR QUÉ EXISTE ESTE FICHERO, Y POR QUÉ ESTÁ AQUÍ Y NO EN `studio`
 * -----------------------------------------------------------------
 * El §3.A.4 del BRIEF-FASE7 exige que «el motor tenga que poder enviarlo». El
 * motor ya puede: `apps/engine/src/http/build-body.ts` serializa multipart con
 * ficheros desde `parts[].content` (base64 inline, porque el motor es SIN
 * ESTADO y no comparte sistema de ficheros con la API, ADR-0002).
 *
 * Pero **quien llama al motor es `modules/studio`**, que construye hoy el
 * cuerpo así (`studio-core.service.ts:855-860`):
 *
 *     body: { mode: modoCuerpoDelMotor(input.bodyType), raw: cuerpoInterpolado }
 *
 * — es decir, **nunca manda `parts`**. `modules/studio` está **fuera de mi
 * ámbito de escritura** en la fase 7 y hay otro agente trabajando en él ahora
 * mismo, así que no lo toco. Lo que sí puedo hacer, y hago, es dejar el
 * adaptador **escrito y probado** dentro de mi ámbito, para que cerrar el hueco
 * sea sustituir esas dos líneas por una llamada. Ver el informe
 * `CUERPO-Y-CURL.md` §8.
 *
 * LO QUE ESTE ADAPTADOR NO HACE
 * -----------------------------
 *  - **No interpola `{{variables}}` ni resuelve secretos.** Eso es de quien
 *    ejecuta, y el motor recibe el cuerpo YA RESUELTO (ADR-0002).
 *  - **No materializa secretos.** Un campo con `secret_id` sale marcado como
 *    pendiente en `camposSecretosOmitidos`, para que quien ejecute lo resuelva
 *    con la clave que esta capa no tiene.
 * ════════════════════════════════════════════════════════════════════════════
 */

/** `bodySchema.mode` del motor. Los siete, literal del contrato. */
export type ModoDelMotor = 'none' | 'raw' | 'json' | 'form' | 'urlencoded' | 'binary' | 'graphql';

export interface ParteParaElMotor {
  readonly name: string;
  readonly type: 'text' | 'file';
  readonly value?: string;
  /** Bytes en base64. Sólo en `type: 'file'`. */
  readonly content?: string;
  readonly filename?: string;
  readonly contentType?: string;
}

export interface CuerpoParaElMotor {
  readonly mode: ModoDelMotor;
  readonly raw?: string;
  readonly parts?: readonly ParteParaElMotor[];
  readonly contentType?: string;
}

export interface ResultadoCuerpoParaElMotor {
  readonly body: CuerpoParaElMotor | null;
  /** Campos secretos que quien ejecuta tiene que resolver antes de enviar. */
  readonly camposSecretosOmitidos: readonly string[];
  /** Ficheros referenciados cuyos bytes no se pudieron leer. */
  readonly ficherosNoDisponibles: readonly string[];
  /**
   * `true` si los adjuntos juntos superan `maxBytesTotales`. Cuando pasa,
   * `body` sale `null`: **nunca** se devuelve un cuerpo a medias.
   */
  readonly limiteDeBytesSuperado: boolean;
}

/**
 * Tope del cuerpo saliente ENTERO, en bytes ya codificados en base64.
 *
 * POR QUÉ EXISTE ESTE TOPE
 * ------------------------
 * El límite de subida (§2.2) es **por fichero**: 10 MiB por defecto. Pero
 * `bodyFields` admite **200 entradas**, y nada impide que cada una apunte a un
 * fichero distinto de 10 MiB. Sin este tope, un multipart construido a mano
 * haría que la API leyera ~2 GiB a memoria y los inflara un 33 % al pasarlos a
 * base64, antes siquiera de hablar con el motor. Eso es agotamiento de memoria
 * del proceso de la API, no del motor.
 *
 * El motor tampoco se protege: `buildBody` concatena en memoria y sus topes
 * (`maxResponseBytes`) son de **respuesta**, no de petición. Así que el tope
 * tiene que estar aquí, que es donde se decide cuánto se lee.
 *
 * 25 MiB es holgado para adjuntos reales y acotado para la memoria. Es
 * configurable por parámetro; su sitio natural a medio plazo es
 * `platform/config/app-config.ts`, que no es mío en esta fase.
 */
export const MAX_BYTES_DEL_CUERPO_SALIENTE = 25 * 1024 * 1024;

export interface OpcionesCuerpoParaElMotor {
  readonly maxBytesTotales?: number;
}

/** Traducción `body_mode` → `bodySchema.mode`. Los 10 valores del enum. */
export function modoDelMotor(bodyMode: string): ModoDelMotor {
  switch (bodyMode) {
    case 'raw_json':
      return 'json';
    case 'raw_text':
    case 'raw_xml':
    case 'raw_html':
      return 'raw';
    case 'graphql':
      return 'graphql';
    case 'form_urlencoded':
      return 'urlencoded';
    case 'multipart_form_data':
      return 'form';
    case 'binary_file':
      return 'binary';
    // `custom` no tiene forma definida en el esquema y el motor no lo conoce:
    // se envía como `raw`, que es lo más fiel que hay sin inventarse nada.
    case 'custom':
      return 'raw';
    case 'none':
    default:
      return 'none';
  }
}

export interface CampoDeCuerpoParaElMotor {
  readonly fieldName: string;
  readonly fieldValue: string | null;
  readonly fileId: string | null;
  readonly contentType: string | null;
  readonly isSecret: boolean;
  readonly isEnabled: boolean;
}

export interface EntradaCuerpoParaElMotor {
  readonly bodyMode: string;
  readonly rawContent: string | null;
  readonly contentType: string | null;
  readonly binaryFileId: string | null;
  readonly campos: readonly CampoDeCuerpoParaElMotor[];
}

/** Lo que el adaptador necesita de los ficheros: bytes y metadatos. */
export type LectorDeBytes = (
  fileId: string,
) => Promise<{ base64: string; fileName: string | null; contentType: string } | null>;

export async function construirCuerpoParaElMotor(
  entrada: EntradaCuerpoParaElMotor,
  leerBytes: LectorDeBytes,
  opciones: OpcionesCuerpoParaElMotor = {},
): Promise<ResultadoCuerpoParaElMotor> {
  const modo = modoDelMotor(entrada.bodyMode);
  const maxBytes = opciones.maxBytesTotales ?? MAX_BYTES_DEL_CUERPO_SALIENTE;
  const camposSecretosOmitidos: string[] = [];
  const ficherosNoDisponibles: string[] = [];
  const contentType = entrada.contentType ?? undefined;
  let bytesAcumulados = 0;

  if (modo === 'none') {
    return { body: null, camposSecretosOmitidos, ficherosNoDisponibles, limiteDeBytesSuperado: false };
  }

  if (modo === 'binary') {
    if (entrada.binaryFileId === null) {
      return { body: null, camposSecretosOmitidos, ficherosNoDisponibles, limiteDeBytesSuperado: false };
    }
    const bytes = await leerBytes(entrada.binaryFileId);
    if (bytes === null) {
      ficherosNoDisponibles.push(entrada.binaryFileId);
      return { body: null, camposSecretosOmitidos, ficherosNoDisponibles, limiteDeBytesSuperado: false };
    }
    if (bytes.base64.length > maxBytes) {
      return { body: null, camposSecretosOmitidos, ficherosNoDisponibles, limiteDeBytesSuperado: true };
    }
    // En `binary` el motor interpreta `raw` como base64 (contrato, L60-61).
    return {
      body: { mode: 'binary', raw: bytes.base64, contentType: contentType ?? bytes.contentType },
      camposSecretosOmitidos,
      ficherosNoDisponibles,
      limiteDeBytesSuperado: false,
    };
  }

  if (modo === 'form') {
    const parts: ParteParaElMotor[] = [];
    for (const campo of entrada.campos) {
      if (!campo.isEnabled) continue;
      if (campo.isSecret) {
        camposSecretosOmitidos.push(campo.fieldName);
        continue;
      }
      if (campo.fileId !== null) {
        const bytes = await leerBytes(campo.fileId);
        if (bytes === null) {
          ficherosNoDisponibles.push(campo.fileId);
          continue;
        }
        bytesAcumulados += bytes.base64.length;
        if (bytesAcumulados > maxBytes) {
          // Se corta EN CUANTO se pasa, no al final: lo que se protege es la
          // memoria, y acumular los 200 ficheros para luego decir que no
          // caben sería haberlos leído igualmente.
          return {
            body: null,
            camposSecretosOmitidos,
            ficherosNoDisponibles,
            limiteDeBytesSuperado: true,
          };
        }
        parts.push({
          name: campo.fieldName,
          type: 'file',
          content: bytes.base64,
          ...(bytes.fileName === null ? {} : { filename: bytes.fileName }),
          contentType: campo.contentType ?? bytes.contentType,
        });
        continue;
      }
      parts.push({
        name: campo.fieldName,
        type: 'text',
        value: campo.fieldValue ?? '',
        ...(campo.contentType === null ? {} : { contentType: campo.contentType }),
      });
    }
    return {
      body: { mode: 'form', parts, ...(contentType === undefined ? {} : { contentType }) },
      camposSecretosOmitidos,
      ficherosNoDisponibles,
      limiteDeBytesSuperado: false,
    };
  }

  if (modo === 'urlencoded') {
    // El motor espera el texto ya serializado (`bodySchema.raw`), no filas.
    const serializado = new URLSearchParams();
    for (const campo of entrada.campos) {
      if (!campo.isEnabled) continue;
      if (campo.isSecret) {
        camposSecretosOmitidos.push(campo.fieldName);
        continue;
      }
      if (campo.fileId !== null) continue; // urlencoded no lleva ficheros
      serializado.append(campo.fieldName, campo.fieldValue ?? '');
    }
    return {
      body: {
        mode: 'urlencoded',
        raw: serializado.toString(),
        ...(contentType === undefined ? {} : { contentType }),
      },
      camposSecretosOmitidos,
      ficherosNoDisponibles,
      limiteDeBytesSuperado: false,
    };
  }

  return {
    body: {
      mode: modo,
      raw: entrada.rawContent ?? '',
      ...(contentType === undefined ? {} : { contentType }),
    },
    camposSecretosOmitidos,
    ficherosNoDisponibles,
    limiteDeBytesSuperado: false,
  };
}
