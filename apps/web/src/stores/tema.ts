import { defineStore } from 'pinia';

/**
 * Tema de la interfaz: **oscuro por defecto**, claro bajo `data-theme="light"`.
 *
 * Los colores no se definen aquí: salen enteros de
 * `@ceiba/brand/tokens.css`, que ya trae las dos paletas (carbón / blanco
 * cálido / verde salvia) y oscurece el acento en claro para conservar el
 * contraste sobre blanco (docs/BRAND.md §3). Este almacén sólo decide **qué
 * atributo** lleva el `<html>` y lo recuerda entre visitas.
 *
 * El mismo valor lo lee el fragmento sincrónico de `index.html` antes del
 * primer pintado, para que no haya destello claro al arrancar.
 *
 * Sobre `localStorage`: la preferencia de tema **no es una credencial**. La
 * prohibición de C-31 es sobre testigos de sesión, y aquí no hay ninguno; la
 * clave está además en la lista blanca de `scripts/check-no-token-storage.mjs`.
 */

export type Tema = 'dark' | 'light';

export const CLAVE_TEMA = 'ceiba.tema';

export function leerTemaGuardado(): Tema | null {
  try {
    const valor = globalThis.localStorage?.getItem(CLAVE_TEMA);
    return valor === 'light' || valor === 'dark' ? valor : null;
  } catch {
    return null;
  }
}

function guardarTema(tema: Tema): void {
  try {
    globalThis.localStorage?.setItem(CLAVE_TEMA, tema);
  } catch {
    // Modo privado o almacenamiento bloqueado: el tema funciona igual durante
    // la sesión, simplemente no se recuerda.
  }
}

function aplicarAlDocumento(tema: Tema): void {
  globalThis.document?.documentElement?.setAttribute('data-theme', tema);
}

export const usarAlmacenDeTema = defineStore('tema', {
  state: (): { tema: Tema } => ({ tema: leerTemaGuardado() ?? 'dark' }),

  getters: {
    esOscuro: (estado): boolean => estado.tema === 'dark',
  },

  actions: {
    aplicar(tema: Tema): void {
      this.tema = tema;
      aplicarAlDocumento(tema);
      guardarTema(tema);
    },

    alternar(): void {
      this.aplicar(this.tema === 'dark' ? 'light' : 'dark');
    },

    /** Sincroniza el DOM con el estado inicial al arrancar la aplicación. */
    inicializar(): void {
      aplicarAlDocumento(this.tema);
    },
  },
});
