/**
 * Reloj inyectable.
 *
 * El ADR-0009 §3 exige que «la caducidad se evalúa SIEMPRE con la hora del
 * servidor, nunca con una fecha enviada por el cliente», y la tabla de
 * verificación pide probar caducidad absoluta, inactividad, rotación y la
 * ventana de gracia de 10 s **con reloj inyectado**. Sin esta indirección esas
 * pruebas tendrían que dormir horas reales, es decir, no existirían.
 */
export interface Reloj {
  ahora(): Date;
}

export const RELOJ = Symbol('RELOJ');

export class RelojDelSistema implements Reloj {
  ahora(): Date {
    return new Date();
  }
}

/** Reloj de pruebas: avanza sólo cuando se le dice. */
export class RelojFalso implements Reloj {
  #instante: number;

  constructor(inicio: Date | number = 0) {
    this.#instante = typeof inicio === 'number' ? inicio : inicio.getTime();
  }

  ahora(): Date {
    return new Date(this.#instante);
  }

  avanzarMs(ms: number): void {
    this.#instante += ms;
  }

  fijar(instante: Date | number): void {
    this.#instante = typeof instante === 'number' ? instante : instante.getTime();
  }
}
