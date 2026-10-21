/**
 * Copia al portapapeles, con la implementación inyectable.
 *
 * POR QUÉ ESTO ES UN MÓDULO Y NO UNA LÍNEA SUELTA EN EL COMPONENTE
 * ----------------------------------------------------------------
 * Tres razones medidas, no estéticas:
 *
 *  1. **`navigator.clipboard` no existe siempre.** Sólo está en contextos
 *     seguros (HTTPS o `localhost`). La pila local se puede levantar en HTTP
 *     (`CEIBA_WEB_TLS=0 ./infra/levantar-local.sh`), y ahí `navigator.clipboard`
 *     es `undefined`. Un botón «Copiar» que no hace nada y no lo dice es peor
 *     que no tener botón.
 *  2. **Puede fallar aunque exista.** El usuario puede denegar el permiso. La
 *     promesa se rechaza y hay que contarlo, no tragárselo.
 *  3. **`jsdom` no lo implementa.** Sin un punto de inyección, la prueba del
 *     botón de cURL no podría comprobar *qué* se copió, que es justo lo que
 *     hay que vigilar: que se copia el comando **del servidor** y no uno
 *     fabricado aquí.
 *
 * Mismo patrón que `usarFetch` en `api/cliente.ts`: una función para sustituir
 * la implementación, y las pruebas no tocan nada global.
 */

export type EscritorDePortapapeles = (texto: string) => Promise<void>;

let escritorActual: EscritorDePortapapeles | null = null;

/** Sustituye el escritor (pruebas). `null` restaura el del navegador. */
export function usarPortapapeles(implementacion: EscritorDePortapapeles | null): void {
  escritorActual = implementacion;
}

/** El resultado dice **por qué** falló, para poder enseñarlo. */
export type ResultadoDeCopia =
  | { readonly copiado: true }
  | { readonly copiado: false; readonly motivo: string };

const MOTIVO_SIN_API =
  'El navegador no permite copiar automáticamente aquí (hace falta HTTPS). ' +
  'El comando está abajo: selecciónalo y cópialo a mano.';

const MOTIVO_DENEGADO =
  'El navegador ha denegado el acceso al portapapeles. ' +
  'El comando está abajo: selecciónalo y cópialo a mano.';

/**
 * Último recurso para contextos no seguros: `document.execCommand('copy')`.
 *
 * Está obsoleto y se sabe. Sigue siendo el único camino cuando no hay
 * `navigator.clipboard`, y el coste de intentarlo es cero. Si tampoco funciona
 * se devuelve `false` y la interfaz enseña el texto para copiarlo a mano.
 */
function copiarALaAntigua(texto: string): boolean {
  if (typeof document === 'undefined') return false;
  const cuerpo = document.body;
  if (cuerpo === null) return false;

  const area = document.createElement('textarea');
  area.value = texto;
  // Fuera de la vista pero enfocable: `execCommand` exige selección real.
  area.setAttribute('aria-hidden', 'true');
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.opacity = '0';
  cuerpo.appendChild(area);

  try {
    area.select();
    const ejecutar = (document as Document & { execCommand?: (orden: string) => boolean })
      .execCommand;
    return typeof ejecutar === 'function' ? ejecutar.call(document, 'copy') === true : false;
  } catch {
    return false;
  } finally {
    cuerpo.removeChild(area);
  }
}

/** Copia `texto`. Nunca lanza: devuelve el motivo del fallo. */
export async function copiarTexto(texto: string): Promise<ResultadoDeCopia> {
  if (escritorActual !== null) {
    try {
      await escritorActual(texto);
      return { copiado: true };
    } catch (error) {
      return {
        copiado: false,
        motivo: error instanceof Error ? error.message : MOTIVO_DENEGADO,
      };
    }
  }

  const portapapeles = globalThis.navigator?.clipboard;
  if (portapapeles !== undefined && typeof portapapeles.writeText === 'function') {
    try {
      await portapapeles.writeText(texto);
      return { copiado: true };
    } catch {
      return copiarALaAntigua(texto)
        ? { copiado: true }
        : { copiado: false, motivo: MOTIVO_DENEGADO };
    }
  }

  return copiarALaAntigua(texto)
    ? { copiado: true }
    : { copiado: false, motivo: MOTIVO_SIN_API };
}
