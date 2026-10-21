import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Ref } from 'vue';

/**
 * Autoguardado con rebote (P1 del `BRIEF-FASE7`).
 *
 * QUÉ RESUELVE Y POR QUÉ ASÍ
 * ---------------------------
 * El cliente pidió «que cuando modifique la petición se guarde en automático».
 * Guardar en cada pulsación sería una escritura por tecla: ruido en la
 * auditoría, carga inútil en PostgreSQL y una fila cuyo `lock_version` sube
 * cien veces por frase. Guardar sólo al salir perdería el trabajo de quien
 * cierra la pestaña de golpe. El rebote es el punto medio: **~800 ms tras la
 * última pulsación**, más un guardado **inmediato** en los tres momentos en
 * los que esperar ya no tiene sentido.
 *
 * LOS TRES DISPAROS INMEDIATOS, Y POR QUÉ CADA UNO
 * ------------------------------------------------
 *  1. **Al perder el foco un campo** (`alPerderFoco`). Lo pide el brief
 *     literalmente. Quien salta de la URL a las cabeceras ya ha terminado con
 *     la URL.
 *  2. **Al salir de la vista** (`onBeforeUnmount`). Navegar a otra pantalla
 *     con un rebote a medias perdería ese último cambio.
 *  3. **Al ocultarse la página** (`visibilitychange` → `hidden`, y
 *     `pagehide`). Es el único evento que los navegadores garantizan en el
 *     cierre de una pestaña móvil; `beforeunload` **no** se dispara ahí. No
 *     se usa `beforeunload` como disparo principal justamente por eso, y
 *     porque no admite esperar a una promesa: prometerlo sería mentir.
 *
 * LO QUE ESTE COMPOSABLE NO HACE, A PROPÓSITO
 * --------------------------------------------
 * No decide **qué** se guarda ni **si** se puede guardar: eso lo responde
 * `activo()`, que en el constructor es «hay una petición abierta». Así la
 * regla «no autoguardar una petición que todavía no existe» vive en un solo
 * sitio y no se puede olvidar en una rama.
 *
 * Tampoco reintenta solo. Un reintento automático contra un servidor que
 * rechaza convierte un error visible en un bucle silencioso; el indicador
 * enseña el fallo y el usuario decide.
 */

/** Rebote del §3.C.1: «~800 ms tras la última pulsación». */
export const RETARDO_DE_AUTOGUARDADO_MS = 800;

export interface OpcionesDeAutoguardado {
  /** Señal de «esto ha cambiado». Cualquier cadena estable sirve. */
  readonly huella: () => string;
  /** `false` ⇒ no se programa ni se ejecuta nada. */
  readonly activo: () => boolean;
  /** La escritura de verdad. Debe resolver, no lanzar. */
  readonly guardar: () => Promise<unknown>;
  readonly retardoMs?: number;
  /**
   * Inyectables para que las pruebas no dependan del reloj ni del DOM real.
   * Por defecto, los del entorno.
   */
  readonly programar?: (fn: () => void, ms: number) => unknown;
  readonly cancelarProgramado?: (id: unknown) => void;
}

export interface Autoguardado {
  /** `true` entre un cambio y su guardado. */
  readonly pendiente: Ref<boolean>;
  /**
   * Guarda ya, sin esperar al rebote y **sin exigir que el rebote lo haya
   * marcado antes**. Lo necesitan los disparos síncronos —renombrar, exportar
   * a cURL— que ocurren en el mismo tick que el cambio, cuando el observador
   * todavía no ha corrido. Sigue respetando `activo()`.
   */
  guardarYa(): Promise<void>;
  /** Para enganchar al `blur` de un campo. */
  alPerderFoco(): void;
  /** Olvida el rebote en vuelo sin guardar. */
  cancelar(): void;
}

export function usarAutoguardado(opciones: OpcionesDeAutoguardado): Autoguardado {
  const retardo = opciones.retardoMs ?? RETARDO_DE_AUTOGUARDADO_MS;
  const programar =
    opciones.programar ?? ((fn: () => void, ms: number) => globalThis.setTimeout(fn, ms));
  const cancelarProgramado =
    opciones.cancelarProgramado ??
    ((id: unknown) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>));

  const pendiente = ref(false);
  let temporizador: unknown = null;
  /**
   * Serializa los guardados. Sin esto, un `blur` durante un `PATCH` en vuelo
   * lanzaría el segundo antes de que el primero devolviese el `lock_version`,
   * y el cliente creería que hubo conflicto donde sólo hubo prisa.
   */
  let enVuelo: Promise<unknown> | null = null;

  function cancelar(): void {
    if (temporizador !== null) {
      cancelarProgramado(temporizador);
      temporizador = null;
    }
  }

  async function ejecutar(forzar = false): Promise<void> {
    cancelar();
    if (!forzar && !pendiente.value) return;
    if (!opciones.activo()) return;
    if (enVuelo !== null) {
      await enVuelo.catch(() => undefined);
      // Tras esperar, puede que el estado ya no permita guardar.
      if (!opciones.activo()) return;
    }
    pendiente.value = false;
    const promesa = opciones.guardar();
    enVuelo = promesa;
    try {
      await promesa;
    } finally {
      if (enVuelo === promesa) enVuelo = null;
    }
  }

  function guardarYa(): Promise<void> {
    return ejecutar(true);
  }

  function alPerderFoco(): void {
    if (!pendiente.value) return;
    void ejecutar();
  }

  watch(
    () => opciones.huella(),
    (nueva, anterior) => {
      if (nueva === anterior) return;
      if (!opciones.activo()) return;
      pendiente.value = true;
      cancelar();
      temporizador = programar(() => {
        temporizador = null;
        void ejecutar();
      }, retardo);
    },
  );

  function alOcultarse(): void {
    if (globalThis.document?.visibilityState === 'hidden') void ejecutar();
  }

  /** Oyente estable: una función distinta en cada registro no se podría quitar. */
  function alEsconderPagina(): void {
    void ejecutar();
  }

  onMounted(() => {
    globalThis.document?.addEventListener('visibilitychange', alOcultarse);
    globalThis.addEventListener?.('pagehide', alEsconderPagina);
  });

  onBeforeUnmount(() => {
    globalThis.document?.removeEventListener('visibilitychange', alOcultarse);
    globalThis.removeEventListener?.('pagehide', alEsconderPagina);
    // Salir de la vista con un rebote a medias perdería el último cambio.
    void ejecutar();
  });

  return { pendiente, guardarYa, alPerderFoco, cancelar };
}
