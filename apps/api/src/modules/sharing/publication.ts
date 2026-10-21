/**
 * ════════════════════════════════════════════════════════════════════════════
 * LA FRONTERA DE SECRETOS DE LA PUBLICACIÓN
 *
 * Requisito 6 del encargo y §6 del prompt maestro: *publicar una colección no
 * puede arrastrar secretos*. El esquema ya separa metadatos de `secrets`; aquí
 * se respeta esa frontera **y se comprueba en tiempo de ejecución**.
 *
 * Tres capas, porque una sola es una promesa:
 *
 *  1. **Se proyecta en lista de permitidos, no en lista de prohibidos.** Cada
 *     campo publicado se nombra uno a uno. Añadir una columna al esquema NO la
 *     publica sola; hay que venir aquí y escribirla. Lo contrario —copiar la
 *     fila y borrar lo sensible— falla el día que alguien añade una columna.
 *  2. **Los punteros a `secrets` no se proyectan nunca**, ni siquiera como
 *     identificador opaco. Un `secretId` publicado es una invitación a probar
 *     si otra ruta lo resuelve.
 *  3. **`verificarFronteraDeSecretos` recorre el resultado ya construido** y
 *     revienta si aparece una clave de la familia prohibida. Es la red: si un
 *     futuro cambio vuelve a meter `secretId` en la proyección, la respuesta se
 *     cae con 500 en vez de filtrar.
 *
 * Lo que **nunca** entra en una publicación, y por qué:
 *
 * | Fuera | Motivo |
 * | --- | --- |
 * | `environments` y `environment_variables` | Son el almacén de valores por entorno; el secreto vive ahí detrás (`value_kind='secret'` + `secret_id`) |
 * | `secret_id` de cabecera, parámetro y campo de cuerpo | Puntero a `secrets` |
 * | `auth_configuration_id`, `client_certificate_id` | Punteros a credenciales. Se publica el **modo** de auth (la forma), nunca su configuración |
 * | `pre_request_script`, `post_response_script` | Código del propietario; es un canal clásico de credenciales incrustadas. Se publica si **existe**, no su contenido (y C-CODE-08 prohíbe ejecutarlos en una sesión compartida) |
 * | Valores de `variables_doc` | El esquema promete que ahí sólo hay documentación, pero es un `jsonb` libre. Se publican **los nombres** de variable esperados y nada más |
 * | Autoría (`created_by_user_id`, correos) | PII del propietario; el visitante es anónimo y no la necesita |
 * ════════════════════════════════════════════════════════════════════════════
 */

// ---------------------------------------------------------------------------
// Entrada: la forma CRUDA que devuelve el repositorio
// ---------------------------------------------------------------------------

export interface FilaCabeceraCruda {
  readonly name: string;
  readonly value: string | null;
  readonly secretId: string | null;
  readonly description: string | null;
  readonly isSecret: boolean;
  readonly isEnabled: boolean;
  readonly sortOrder: number;
}

export interface FilaParametroCrudo extends FilaCabeceraCruda {
  readonly kind: string;
}

export interface FilaCampoDeCuerpoCrudo {
  readonly fieldName: string;
  readonly fieldValue: string | null;
  readonly secretId: string | null;
  readonly fileId: string | null;
  readonly contentType: string | null;
  readonly isSecret: boolean;
  readonly isEnabled: boolean;
  readonly sortOrder: number;
}

/**
 * `request_bodies` no tiene columna `graphql_query`: en los modos `graphql` y
 * `raw_*` el contenido vive en `raw_content`. Se proyecta como `example`, y
 * sólo si el enlace trae `include_examples`.
 */
export interface FilaCuerpoCrudo {
  readonly mode: string;
  readonly rawContent: string | null;
  readonly contentType: string | null;
  readonly requestBodyFields: readonly FilaCampoDeCuerpoCrudo[];
}

export interface FilaSolicitudCruda {
  readonly id: string;
  readonly folderId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly method: string;
  readonly methodCustom: string | null;
  readonly urlTemplate: string;
  readonly bodyMode: string;
  readonly authMode: string;
  readonly timeoutMs: number | null;
  readonly sortKey: string;
  readonly preRequestScript: string | null;
  readonly postResponseScript: string | null;
  readonly requestHeaders: readonly FilaCabeceraCruda[];
  readonly requestParams: readonly FilaParametroCrudo[];
  readonly requestBodies: FilaCuerpoCrudo | null;
}

export interface FilaCarpetaCruda {
  readonly id: string;
  readonly parentFolderId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly depth: number;
  readonly sortKey: string;
}

export interface FilaColeccionCruda {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly visibility: string;
  readonly defaultAuthMode: string;
  readonly defaultTimeoutMs: number;
  readonly variablesDoc: unknown;
  readonly requestCount: number;
  readonly updatedAt: Date;
}

export interface EntradaDePublicacion {
  readonly coleccion: FilaColeccionCruda;
  readonly carpetas: readonly FilaCarpetaCruda[];
  readonly solicitudes: readonly FilaSolicitudCruda[];
  /** `shared_links.include_examples`. Hoy sólo afecta al cuerpo de ejemplo. */
  readonly incluirEjemplos: boolean;
}

// ---------------------------------------------------------------------------
// Salida: lo único que sale por el cable
// ---------------------------------------------------------------------------

export interface ValorPublicado {
  readonly name: string;
  readonly value: string | null;
  readonly description: string | null;
  readonly enabled: boolean;
  /** `true` → el valor **no se publica**. Nunca se publica el puntero. */
  readonly secret: boolean;
}

export interface ParametroPublicado extends ValorPublicado {
  readonly kind: string;
}

export interface CuerpoPublicado {
  readonly mode: string;
  readonly contentType: string | null;
  readonly example: string | null;
  readonly fields: readonly ValorPublicado[];
}

export interface SolicitudPublicada {
  readonly id: string;
  readonly folderId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly method: string;
  readonly url: string;
  readonly authMode: string;
  readonly timeoutMs: number | null;
  readonly headers: readonly ValorPublicado[];
  readonly params: readonly ParametroPublicado[];
  readonly body: CuerpoPublicado | null;
  /** Se publica que EXISTE un script, jamás su contenido. */
  readonly hasPreRequestScript: boolean;
  readonly hasPostResponseScript: boolean;
}

export interface CarpetaPublicada {
  readonly id: string;
  readonly parentFolderId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly depth: number;
}

export interface ColeccionPublicada {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  readonly visibility: string;
  readonly defaultAuthMode: string;
  readonly defaultTimeoutMs: number;
  /** **Nombres** de variable esperados. Nunca sus valores. */
  readonly expectedVariables: readonly string[];
  readonly requestCount: number;
  readonly updatedAt: string;
  readonly folders: readonly CarpetaPublicada[];
  readonly requests: readonly SolicitudPublicada[];
}

// ---------------------------------------------------------------------------
// Proyección
// ---------------------------------------------------------------------------

function publicarValor(fila: FilaCabeceraCruda): ValorPublicado {
  // `is_secret` Y `secret_id`: el CHECK `ck_header_secret_xor` los ata, pero
  // una fila escrita por otra vía o una migración futura podrían desatarlos.
  // Aquí basta con que UNA de las dos señales esté encendida para ocultar.
  const esSecreto = fila.isSecret || fila.secretId !== null;
  return {
    name: fila.name,
    value: esSecreto ? null : fila.value,
    description: fila.description,
    enabled: fila.isEnabled,
    secret: esSecreto,
  };
}

function publicarCampoDeCuerpo(fila: FilaCampoDeCuerpoCrudo): ValorPublicado {
  const esSecreto = fila.isSecret || fila.secretId !== null;
  return {
    name: fila.fieldName,
    value: esSecreto ? null : fila.fieldValue,
    description: null,
    enabled: fila.isEnabled,
    secret: esSecreto,
  };
}

function publicarCuerpo(
  fila: FilaCuerpoCrudo | null,
  incluirEjemplos: boolean,
): CuerpoPublicado | null {
  if (fila === null) return null;
  return {
    mode: fila.mode,
    contentType: fila.contentType,
    example: incluirEjemplos ? fila.rawContent : null,
    fields: [...fila.requestBodyFields]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(publicarCampoDeCuerpo),
  };
}

/** Nombres de las variables documentadas. Si el `jsonb` no es un objeto, nada. */
function nombresDeVariablesEsperadas(variablesDoc: unknown): readonly string[] {
  if (variablesDoc === null || typeof variablesDoc !== 'object' || Array.isArray(variablesDoc)) {
    return [];
  }
  return Object.keys(variablesDoc as Record<string, unknown>).sort();
}

export function proyectarColeccionPublicable(entrada: EntradaDePublicacion): ColeccionPublicada {
  const { coleccion, carpetas, solicitudes, incluirEjemplos } = entrada;

  const publicada: ColeccionPublicada = {
    id: coleccion.id,
    name: coleccion.name,
    slug: coleccion.slug,
    description: coleccion.description,
    visibility: coleccion.visibility,
    defaultAuthMode: coleccion.defaultAuthMode,
    defaultTimeoutMs: coleccion.defaultTimeoutMs,
    expectedVariables: nombresDeVariablesEsperadas(coleccion.variablesDoc),
    requestCount: coleccion.requestCount,
    updatedAt: coleccion.updatedAt.toISOString(),
    folders: [...carpetas]
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
      .map((carpeta) => ({
        id: carpeta.id,
        parentFolderId: carpeta.parentFolderId,
        name: carpeta.name,
        description: carpeta.description,
        depth: carpeta.depth,
      })),
    requests: [...solicitudes]
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
      .map((solicitud) => ({
        id: solicitud.id,
        folderId: solicitud.folderId,
        name: solicitud.name,
        description: solicitud.description,
        method: solicitud.method === 'CUSTOM' ? (solicitud.methodCustom ?? 'CUSTOM') : solicitud.method,
        url: solicitud.urlTemplate,
        authMode: solicitud.authMode,
        timeoutMs: solicitud.timeoutMs,
        headers: [...solicitud.requestHeaders]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map(publicarValor),
        params: [...solicitud.requestParams]
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((parametro) => ({ ...publicarValor(parametro), kind: parametro.kind })),
        body: publicarCuerpo(solicitud.requestBodies, incluirEjemplos),
        hasPreRequestScript: solicitud.preRequestScript !== null,
        hasPostResponseScript: solicitud.postResponseScript !== null,
      })),
  };

  verificarFronteraDeSecretos(publicada);
  return publicada;
}

// ---------------------------------------------------------------------------
// La red de seguridad
// ---------------------------------------------------------------------------

/**
 * Familias de clave que **no pueden** aparecer en nada que salga por una sesión
 * de compartición. Se comparan en minúsculas y sin separadores, para que
 * `secret_id`, `secretId` y `SecretID` caigan los tres.
 */
const CLAVES_PROHIBIDAS: readonly string[] = Object.freeze([
  'secretid',
  'ciphertext',
  'nonce',
  'authtag',
  'dekwrapped',
  'kekreference',
  'password',
  'passphrase',
  'privatekey',
  'codeverifier',
  'codeselector',
  'tokenverifier',
  'tokenselector',
  'verifierhash',
  'accesscode',
  'prerequestscript',
  'postresponsescript',
  'authconfigurationid',
  'clientcertificateid',
  'createdbyuserid',
]);

export class FugaDeSecretoDetectada extends Error {
  override readonly name = 'FugaDeSecretoDetectada';
}

function normalizarClave(clave: string): string {
  return clave.toLowerCase().replace(/[^a-z0-9]/gu, '');
}

/**
 * Recorre el objeto ya construido y lanza si encuentra una clave prohibida.
 *
 * Lanzar es lo correcto: el filtro de errores lo convierte en un 500 genérico,
 * que es muchísimo mejor que un 200 con el puntero dentro. Falla **cerrado**.
 */
export function verificarFronteraDeSecretos(valor: unknown, ruta = '$'): void {
  if (valor === null || typeof valor !== 'object') return;

  if (Array.isArray(valor)) {
    valor.forEach((elemento, indice) => {
      verificarFronteraDeSecretos(elemento, `${ruta}[${indice}]`);
    });
    return;
  }

  for (const [clave, contenido] of Object.entries(valor as Record<string, unknown>)) {
    if (CLAVES_PROHIBIDAS.includes(normalizarClave(clave))) {
      throw new FugaDeSecretoDetectada(
        `La proyección publicable contiene la clave prohibida "${clave}" en ${ruta}. ` +
          'Se aborta la respuesta: publicar un puntero a `secrets` es una fuga.',
      );
    }
    verificarFronteraDeSecretos(contenido, `${ruta}.${clave}`);
  }
}
