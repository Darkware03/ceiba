/**
 * ════════════════════════════════════════════════════════════════════════════
 * C-CODE-03 — Límite de intentos y rate limiting.
 * C-CODE-07 — Lista de permitidos por permiso del enlace.
 *
 * Los dos son política pura: sin estado, sin inyección y sin red, para que se
 * puedan probar sin levantar nada.
 * ════════════════════════════════════════════════════════════════════════════
 */

// ---------------------------------------------------------------------------
// C-CODE-03 — Los tres contadores. Cada uno para un ataque distinto.
// ---------------------------------------------------------------------------

export const VENTANA_POR_ENLACE_MS = 3_600_000; // 1 h
export const UMBRAL_POR_ENLACE = 10;

export const VENTANA_POR_IP_MS = 3_600_000; // 1 h
export const UMBRAL_POR_IP = 30;

export const VENTANA_REVOCACION_MS = 86_400_000; // 24 h
export const UMBRAL_REVOCACION_AUTOMATICA = 100;

export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_TECHO_MS = 60_000;

/**
 * **Backoff exponencial, no bloqueo binario.** Es la decisión deliberada de
 * C-CODE-03 sobre AM-CODE-14: un bloqueo duro permite que un tercero deje fuera
 * al destinatario legítimo con 10 intentos. Aquí el coste crece —1 s, 2 s, 4 s …
 * hasta 60 s— y degrada la fuerza bruta a cero sin inutilizar el enlace.
 *
 * Los primeros `UMBRAL_POR_ENLACE` fallos de la ventana no cuestan nada: quien
 * se equivoca tecleando no debe pagar.
 *
 * Número de fallos **acumulados en la ventana de una hora**, no consecutivos:
 * reiniciar con un acierto permitiría a un atacante que conoce un código válido
 * de otro enlace limpiar el contador.
 */
export function calcularBackoffDeEnlaceMs(
  fallosEnVentana: number,
  umbral: number = UMBRAL_POR_ENLACE,
): number {
  const limite = Number.isFinite(umbral) && umbral > 0 ? umbral : UMBRAL_POR_ENLACE;
  if (!Number.isFinite(fallosEnVentana) || fallosEnVentana <= limite) return 0;
  const exponente = Math.min(fallosEnVentana - limite - 1, 32);
  return Math.min(BACKOFF_BASE_MS * 2 ** exponente, BACKOFF_TECHO_MS);
}

/** Claves del `RateLimitStore`. Centralizadas para que no se escriban a mano. */
export const CLAVES = Object.freeze({
  fallosPorEnlace: (slug: string) => `share:fallos:enlace:${slug}`,
  fallosPorIp: (ip: string) => `share:fallos:ip:${ip}`,
  fallosDiariosPorEnlace: (slug: string) => `share:fallos24:enlace:${slug}`,
  esperaPorEnlace: (slug: string) => `share:espera:enlace:${slug}`,
});

// ---------------------------------------------------------------------------
// C-CODE-07 — Permisos. **Manda el esquema**, no la grafía de CONTROLES.md.
// ---------------------------------------------------------------------------

/**
 * El enum aplicado es `share_permission = viewer | viewer_export | executor`.
 * C-CODE-07 los nombra `reader | reader_export | executor`. Mismo concepto,
 * otra grafía; el esquema es la fuente, como ordena el encargo de fase 5.
 *
 * El enum **no contiene ningún valor de edición**, y eso no es casual: el
 * comentario de `shared_links` lo declara como el mecanismo que hace
 * *imposible* conceder escritura por enlace. No se añade ninguna operación de
 * escritura a la lista de abajo, ni siquiera comentada.
 */
export type PermisoDeComparticion = 'viewer' | 'viewer_export' | 'executor';

export const PERMISOS: readonly PermisoDeComparticion[] = Object.freeze([
  'viewer',
  'viewer_export',
  'executor',
]);

export function esPermisoValido(valor: unknown): valor is PermisoDeComparticion {
  return typeof valor === 'string' && (PERMISOS as readonly string[]).includes(valor);
}

/**
 * Operaciones que una sesión de compartición puede intentar. **Lista cerrada**:
 * todo lo que no esté aquí se deniega por defecto, y no hay comodín.
 */
export type OperacionCompartida =
  | 'leer_coleccion'
  | 'leer_solicitud'
  | 'exportar'
  | 'ejecutar';

/** Techo por permiso. Las dos banderas del enlace recortan por debajo. */
const TECHO_POR_PERMISO: Readonly<Record<PermisoDeComparticion, readonly OperacionCompartida[]>> =
  Object.freeze({
    viewer: Object.freeze(['leer_coleccion', 'leer_solicitud'] as const),
    viewer_export: Object.freeze(['leer_coleccion', 'leer_solicitud', 'exportar'] as const),
    executor: Object.freeze([
      'leer_coleccion',
      'leer_solicitud',
      'exportar',
      'ejecutar',
    ] as const),
  });

export interface AlcanceDelEnlace {
  readonly permiso: PermisoDeComparticion;
  /** `shared_links.allow_export`. */
  readonly permiteExportar: boolean;
  /** `shared_links.allow_execution`. Desactivado por defecto (C-CODE-08). */
  readonly permiteEjecutar: boolean;
}

/**
 * **Las dos banderas se comprueban además del permiso.** Es el punto 6 de la
 * nota de validación de `share_sessions` en el esquema, y no es un detalle:
 * `allow_export` y `allow_execution` cambian el alcance real **sin tocar**
 * `permission`, así que comparar sólo el permiso dejaría a una sesión
 * exportando después de que el propietario desactivara la exportación.
 */
export function permiteOperacion(
  alcance: AlcanceDelEnlace,
  operacion: OperacionCompartida,
): boolean {
  if (!TECHO_POR_PERMISO[alcance.permiso].includes(operacion)) return false;
  if (operacion === 'exportar') return alcance.permiteExportar;
  if (operacion === 'ejecutar') return alcance.permiteEjecutar && alcance.permiso === 'executor';
  return true;
}

// ---------------------------------------------------------------------------
// Duraciones de la sesión de compartición (C-CODE-06)
// ---------------------------------------------------------------------------

/**
 * Vida de la sesión de compartición. Corta a propósito: la revocación es
 * inmediata porque se revalida en base de datos en **cada** petición, pero una
 * sesión corta limita además el daño de una cookie robada.
 */
export const TTL_SESION_COMPARTIDA_MS = 2 * 3_600_000; // 2 h

/** `last_seen_at` se escribe como mucho una vez cada 60 s, igual que `sessions`. */
export const INTERVALO_MINIMO_LAST_SEEN_MS = 60_000;

/**
 * Piso de tiempo de la respuesta del endpoint de acceso (C-CODE-04).
 *
 * Medido en este contenedor: una verificación Argon2id con el perfil del
 * registro (`m=19456, t=2, p=1`) cuesta 43–65 ms (mediana 45 ms). El señuelo
 * iguala el **coste criptográfico**, pero no iguala lo demás: una lectura
 * indexada que no encuentra nada vuelve antes que tres lecturas más un UPDATE.
 *
 * Con un piso de 150 ms todos los caminos de fallo terminan en el mismo
 * instante y la diferencia que queda es ruido del planificador, no información.
 * El coste es una conexión retenida 150 ms; los tres contadores de C-CODE-03
 * son los que impiden que eso sea aprovechable.
 */
export const PISO_DE_RESPUESTA_MS = 150;
