import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) sobre HOTP (RFC 4226), implementado con `node:crypto`.
 *
 * Por qué sin dependencia: el algoritmo son veinte líneas, los vectores de
 * prueba del RFC 6238 son públicos y verificables aquí mismo, y el ADR-0008
 * fija una lista cerrada de paquetes en la que no hay ninguna librería TOTP.
 * Añadir una dependencia nueva a un estándar de 20 líneas no compensa.
 *
 * ALCANCE REAL, sin venderlo de más: esto verifica un código TOTP. El flujo
 * completo de segundo factor del ADR-0009 §8 («la contraseña emite un reto de
 * corta vida y la sesión se crea sólo tras validar el TOTP») necesita una tabla
 * para ese reto que **no existe en el esquema**: es un HUECO declarado por el
 * propio ADR-0009. Ver `mfa-challenge.store.ts`.
 */

export type AlgoritmoTotp = 'sha1' | 'sha256' | 'sha512';

export interface OpcionesTotp {
  readonly pasoSegundos?: number;
  readonly digitos?: number;
  readonly algoritmo?: AlgoritmoTotp;
  /** Ventanas de tolerancia a cada lado. 1 = ±1 paso (±30 s por defecto). */
  readonly ventana?: number;
}

const POR_DEFECTO = {
  pasoSegundos: 30,
  digitos: 6,
  algoritmo: 'sha1' as AlgoritmoTotp,
  ventana: 1,
};

/** Decodifica una semilla en base32 (RFC 4648, sin padding obligatorio). */
export function decodificarBase32(texto: string): Buffer {
  const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const limpio = texto.toUpperCase().replace(/=+$/u, '').replace(/\s+/gu, '');
  let bits = 0;
  let valor = 0;
  const salida: number[] = [];
  for (const caracter of limpio) {
    const indice = alfabeto.indexOf(caracter);
    if (indice === -1) throw new Error(`carácter base32 inválido: ${JSON.stringify(caracter)}`);
    valor = (valor << 5) | indice;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      salida.push((valor >>> bits) & 0xff);
    }
  }
  return Buffer.from(salida);
}

/** HOTP (RFC 4226). `contador` es un entero de 64 bits big-endian. */
export function hotp(
  secreto: Buffer,
  contador: bigint,
  digitos: number,
  algoritmo: AlgoritmoTotp,
): string {
  const bloque = Buffer.alloc(8);
  bloque.writeBigUInt64BE(contador);
  const resumen = createHmac(algoritmo, secreto).update(bloque).digest();
  const desplazamiento = (resumen[resumen.length - 1] as number) & 0x0f;
  const binario =
    (((resumen[desplazamiento] as number) & 0x7f) << 24) |
    (((resumen[desplazamiento + 1] as number) & 0xff) << 16) |
    (((resumen[desplazamiento + 2] as number) & 0xff) << 8) |
    ((resumen[desplazamiento + 3] as number) & 0xff);
  return (binario % 10 ** digitos).toString().padStart(digitos, '0');
}

export function generarTotp(secreto: Buffer, instanteMs: number, opciones: OpcionesTotp = {}): string {
  const paso = opciones.pasoSegundos ?? POR_DEFECTO.pasoSegundos;
  const digitos = opciones.digitos ?? POR_DEFECTO.digitos;
  const algoritmo = opciones.algoritmo ?? POR_DEFECTO.algoritmo;
  const contador = BigInt(Math.floor(instanteMs / 1000 / paso));
  return hotp(secreto, contador, digitos, algoritmo);
}

/**
 * Verifica un código con tolerancia de `ventana` pasos a cada lado.
 * La comparación final es en tiempo constante.
 */
export function verificarTotp(
  secreto: Buffer,
  codigo: string,
  instanteMs: number,
  opciones: OpcionesTotp = {},
): boolean {
  const paso = opciones.pasoSegundos ?? POR_DEFECTO.pasoSegundos;
  const digitos = opciones.digitos ?? POR_DEFECTO.digitos;
  const algoritmo = opciones.algoritmo ?? POR_DEFECTO.algoritmo;
  const ventana = opciones.ventana ?? POR_DEFECTO.ventana;

  const normalizado = codigo.trim();
  if (!new RegExp(`^\\d{${digitos}}$`, 'u').test(normalizado)) return false;

  const contadorBase = BigInt(Math.floor(instanteMs / 1000 / paso));
  const esperado = Buffer.from(normalizado, 'utf8');
  let valido = false;
  for (let delta = -ventana; delta <= ventana; delta += 1) {
    const contador = contadorBase + BigInt(delta);
    if (contador < 0n) continue;
    const candidato = Buffer.from(hotp(secreto, contador, digitos, algoritmo), 'utf8');
    // Sin cortocircuito: se recorren todas las ventanas siempre.
    if (candidato.length === esperado.length && timingSafeEqual(candidato, esperado)) {
      valido = true;
    }
  }
  return valido;
}
