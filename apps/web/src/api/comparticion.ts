/**
 * ════════════════════════════════════════════════════════════════════════════
 * CLIENTE DEL CONSUMO PÚBLICO DE UNA COLECCIÓN COMPARTIDA.
 *
 * Es la otra mitad de la compartición, y conviene no confundirla con la que ya
 * existe:
 *
 *  - **Administración** (`api/studio.ts`, del ámbito D): la hace el PROPIETARIO,
 *    con su sesión de usuario, contra `collections/:id/shares`. Crea el enlace,
 *    lista los vigentes y los revoca.
 *  - **Consumo** (este fichero): lo hace QUIEN RECIBE el enlace, que **no tiene
 *    cuenta**, contra `@Controller('share')`. Abre una sesión de compartición
 *    —otra cookie, otro principal— y lee.
 *
 * Son dos superficies distintas del servidor. Mezclarlas en un fichero sería el
 * error; separarlas no es duplicar.
 *
 * ── Tres reglas que esta capa hace cumplir ─────────────────────────────────
 *
 *  1. **El código de acceso viaja SÓLO en el cuerpo del POST.** Nunca en la
 *     URL. El servidor no se fía y lo comprueba: `rechazarCodigoEnLaUrl()` en
 *     `share-public.controller.ts` aborta con 400 `code_in_url` si aparece un
 *     parámetro de consulta con nombre de código. Medido en
 *     `sharing.errors.ts`: «si una integración lo pone en la URL, el `Referer`,
 *     el log de Nginx y el historial del navegador lo guardan».
 *
 *  2. **Un único mensaje de fallo.** El servidor tiene UNA sola clase de error
 *     para los seis escenarios (`AccesoCompartidoInvalido`, 401
 *     `invalid_access`) precisamente para que no se puedan distinguir código
 *     incorrecto, enlace caducado y enlace revocado. Esta capa **no intenta
 *     distinguirlos** y expone `MENSAJE_ACCESO_INVALIDO`, uno solo. La prueba
 *     `C-CODE-04` del servidor mide hasta los tiempos de respuesta.
 *
 *  3. **Ningún valor secreto se devuelve al llamante.** El servidor ya redacta
 *     (`publicarValor()` pone `value: null` cuando `secret`), pero
 *     `sanearValor()` lo vuelve a aplicar aquí. Dos cerrojos en serie: si
 *     mañana la proyección del servidor cambia, la interfaz sigue sin pintar
 *     un secreto. No es desconfianza del compañero, es que esta garantía no
 *     puede depender de un solo fichero de otro equipo.
 *
 * El testigo CSRF lo resuelve `cliente.ts` solo: `GET /api/v1/auth/csrf` está
 * marcado `@Publico()` en `identity.controller.ts:66` y «acuña la cookie CSRF
 * **sin sesión**», así que un visitante anónimo puede obtenerlo. Verificado
 * antes de escribir este fichero.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { clienteApi } from './cliente';

// ---------------------------------------------------------------------------
// Tipos — transcritos de `apps/api/src/modules/sharing/publication.ts`
// ---------------------------------------------------------------------------

/**
 * Los DOS únicos estados que devuelve `GET /share/:slug`.
 *
 * `code_required` NO significa sólo «este enlace pide código»: el servidor lo
 * devuelve **también** cuando el enlace no existe, cuando caducó y cuando lo
 * revocaron (`share-access.service.ts:118-123`). Es deliberado —«No se puede
 * enumerar slugs desde aquí»— y esta capa no intenta deshacerlo.
 */
export type EstadoDeEnlaceCompartido = 'open' | 'code_required';

/** Un valor publicado: cabecera, parámetro o campo de cuerpo. */
export interface ValorCompartido {
  readonly name: string;
  /** `null` cuando `secret` es `true`. El servidor nunca manda el valor. */
  readonly value: string | null;
  readonly description: string | null;
  readonly enabled: boolean;
  /** `true` → se pinta la marca, jamás el valor. */
  readonly secret: boolean;
}

export interface ParametroCompartido extends ValorCompartido {
  readonly kind: string;
}

export interface CuerpoCompartido {
  readonly mode: string;
  readonly contentType: string | null;
  /** Sólo llega si el enlace se creó con `includeExamples`. */
  readonly example: string | null;
  readonly fields: readonly ValorCompartido[];
}

export interface PeticionCompartida {
  readonly id: string;
  readonly folderId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly method: string;
  readonly url: string;
  readonly authMode: string;
  readonly timeoutMs: number | null;
  readonly headers: readonly ValorCompartido[];
  readonly params: readonly ParametroCompartido[];
  readonly body: CuerpoCompartido | null;
  /** Se publica que EXISTE un script, jamás su contenido. */
  readonly hasPreRequestScript: boolean;
  readonly hasPostResponseScript: boolean;
}

export interface CarpetaCompartida {
  readonly id: string;
  readonly parentFolderId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly depth: number;
}

export interface ColeccionCompartida {
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
  readonly folders: readonly CarpetaCompartida[];
  readonly requests: readonly PeticionCompartida[];
}

/**
 * Lo que devuelve `POST /share/:slug/access`.
 *
 * **`collectionName` es SIEMPRE `null`**, y no «a veces»: está fijado en el
 * controlador (`share-public.controller.ts:131`, literal `collectionName: null`).
 * Se declara por fidelidad al contrato, pero el nombre real sale de
 * `leerColeccionCompartida()`. Una vista que pinte este campo enseña un hueco
 * para siempre.
 */
export interface AccesoCompartidoConcedido {
  readonly permission: string;
  readonly expiresAt: string;
  readonly collectionName: string | null;
}

/**
 * Lo que devuelve `GET /share/session/me`.
 *
 * Los permisos se llaman **`canExport` y `canExecute`**. No `allowExport` ni
 * `allowExecution`: ésos no existen en el servidor, y programar contra ellos
 * habría dado `undefined` —*falsy*— escondiendo el fallo tras un botón que no
 * aparece nunca.
 */
export interface SesionCompartida {
  readonly permission: string;
  readonly expiresAt: string;
  readonly canExport: boolean;
  readonly canExecute: boolean;
}

// ---------------------------------------------------------------------------
// El único mensaje de fallo
// ---------------------------------------------------------------------------

/**
 * **El único** mensaje que ve quien no consigue entrar.
 *
 * Da igual que el código sea incorrecto, que el enlace haya caducado, que lo
 * hayan revocado o que nunca existiese: el texto es el mismo. No es pereza de
 * redacción, es el requisito `C-CODE-04`, que en el servidor está defendido
 * con una clase de error sin parámetros «para que **no se pueda** escribir un
 * caso que responda distinto». Si esta constante se convierte en varias, se
 * rompe la indistinguibilidad desde la interfaz, que es justo donde el atacante
 * mira.
 */
export const MENSAJE_ACCESO_INVALIDO =
  'El enlace o el código no son válidos. Comprueba que has copiado el enlace ' +
  'completo y que el código es el que te pasaron.';

// ---------------------------------------------------------------------------
// Saneado defensivo de secretos
// ---------------------------------------------------------------------------

/**
 * Vuelve a imponer la frontera de secretos del lado del cliente.
 *
 * El servidor ya manda `value: null` cuando `secret` es `true`. Esto lo repite
 * porque la regla «nunca enseñes un valor secreto» no debe depender de que un
 * fichero de otro equipo siga comportándose igual el mes que viene. Si llega un
 * `value` relleno con `secret: true`, aquí se cae.
 */
function sanearValor<T extends ValorCompartido>(valor: T): T {
  if (!valor.secret) return valor;
  return valor.value === null ? valor : { ...valor, value: null };
}

function sanearCuerpo(cuerpo: CuerpoCompartido | null): CuerpoCompartido | null {
  if (cuerpo === null) return null;
  return { ...cuerpo, fields: cuerpo.fields.map(sanearValor) };
}

/** Saneado de una petición completa. Exportado porque la vista lo reutiliza. */
export function sanearPeticionCompartida(peticion: PeticionCompartida): PeticionCompartida {
  return {
    ...peticion,
    headers: peticion.headers.map(sanearValor),
    params: peticion.params.map(sanearValor),
    body: sanearCuerpo(peticion.body),
  };
}

function sanearColeccion(coleccion: ColeccionCompartida): ColeccionCompartida {
  return { ...coleccion, requests: coleccion.requests.map(sanearPeticionCompartida) };
}

// ---------------------------------------------------------------------------
// Llamadas
// ---------------------------------------------------------------------------

/**
 * Estado de la página de acceso.
 *
 * Cualquier valor que no sea exactamente `'open'` se interpreta como
 * `'code_required'`. Falla **cerrado**: ante un estado desconocido se pide el
 * código en vez de dar por abierto un enlace que quizá no lo esté.
 */
export async function consultarEstadoDeEnlace(
  slug: string,
): Promise<EstadoDeEnlaceCompartido> {
  const respuesta = await clienteApi.get<{ estado?: unknown }>(
    `/share/${encodeURIComponent(slug)}`,
  );
  return respuesta.estado === 'open' ? 'open' : 'code_required';
}

/**
 * Canjea el código por una sesión de compartición.
 *
 * `codigo` es `null` para los enlaces abiertos: el esquema del servidor lo
 * declara `nullish` (`esquemaAcceder`: `code: z.string().max(512).nullish()`),
 * así que un enlace sin código se abre mandando `{ code: null }`.
 *
 * El `clienteApi` añade solo el testigo `x-ceiba-csrf`: esta ruta es pública
 * pero mutante, y sin la cabecera responde 403 `csrf_invalido`.
 */
export async function abrirSesionDeComparticion(
  slug: string,
  codigo: string | null,
): Promise<AccesoCompartidoConcedido> {
  return clienteApi.post<AccesoCompartidoConcedido>(
    `/share/${encodeURIComponent(slug)}/access`,
    { code: codigo },
  );
}

/** Datos de la sesión de compartición abierta. 401 si no hay ninguna. */
export async function consultarSesionCompartida(): Promise<SesionCompartida> {
  return clienteApi.get<SesionCompartida>('/share/session/me');
}

/** Cierra la sesión de compartición. Responde 204 y borra la cookie. */
export async function cerrarSesionCompartida(): Promise<void> {
  await clienteApi.post<void>('/share/session/logout');
}

/**
 * La colección compartida, con sus peticiones **embebidas**.
 *
 * No hace falta una segunda llamada para la lista: `ColeccionPublicada` ya trae
 * `requests[]` completas. El identificador de colección sale de la SESIÓN, no
 * de la URL, así que esta llamada no lleva parámetros: es lo que hace imposible
 * —no «prohibido»— pedir otra colección.
 */
export async function leerColeccionCompartida(): Promise<ColeccionCompartida> {
  const respuesta = await clienteApi.get<{ collection: ColeccionCompartida }>(
    '/share/content/collection',
  );
  return sanearColeccion(respuesta.collection);
}

/**
 * Una petición concreta de la colección compartida.
 *
 * Existe aunque la lista ya venga embebida porque el servidor comprueba
 * explícitamente la pertenencia: «conocer el identificador no es autorización».
 */
export async function leerPeticionCompartida(
  peticionId: string,
): Promise<PeticionCompartida> {
  const respuesta = await clienteApi.get<{ request: PeticionCompartida }>(
    `/share/content/requests/${encodeURIComponent(peticionId)}`,
  );
  return sanearPeticionCompartida(respuesta.request);
}

/**
 * Exportación de la colección. Sólo si el enlace la permite (`canExport`).
 *
 * El servidor devuelve el sobre **sin envoltorio**: `{ ceiba: {...}, collection }`
 * en el nivel superior, no `{ export: … }`.
 */
export async function exportarColeccionCompartida(): Promise<Record<string, unknown>> {
  return clienteApi.get<Record<string, unknown>>('/share/content/export');
}
