/**
 * Duraciones del `.env.example` en formato `7d`, `12h`, `1h`, `30m`, `60s`.
 *
 * El `.env.example` ya commiteado usa ese formato (`CEIBA_SESSION_ABSOLUTE_TTL=7d`),
 * y ese fichero no está en mi ámbito de escritura: el parser se adapta al
 * fichero, no al revés.
 *
 * FALLA CERRADO: cualquier cosa que no encaje exactamente lanza. No hay
 * «interpretación razonable» de un TTL mal escrito; un TTL mal interpretado es
 * una sesión que no caduca.
 */

const PATRON = /^(\d+)(ms|s|m|h|d)$/;

const FACTOR_MS: Readonly<Record<string, number>> = Object.freeze({
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
});

export function parseDuracionAMs(valor: string): number {
  const bruto = valor.trim();
  const coincidencia = PATRON.exec(bruto);
  if (coincidencia === null) {
    throw new Error(
      `duración inválida: ${JSON.stringify(valor)}. Formato admitido: <entero><ms|s|m|h|d>, p. ej. "7d", "12h", "1h".`,
    );
  }
  const cantidad = Number.parseInt(coincidencia[1] as string, 10);
  const factor = FACTOR_MS[coincidencia[2] as string] as number;
  if (!Number.isSafeInteger(cantidad) || cantidad <= 0) {
    throw new Error(`duración inválida: ${JSON.stringify(valor)}. Debe ser un entero positivo.`);
  }
  return cantidad * factor;
}
