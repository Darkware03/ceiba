/** SUPERFICIE PÚBLICA de `file` (ADR-0004 §2). */
export { ModuloDeFicheros } from './file.module.ts';
export { ServicioDeFicheros, vistaBreveDeFichero, vistaDeFichero } from './file.service.ts';
export { RepositorioDeFicheros, PROPOSITOS_PERMITIDOS } from './file.repository.ts';
export type { FilaFichero, PropositoDeFichero } from './file.repository.ts';
export type { VistaDeFichero } from './file.service.ts';
export { CargaDemasiadoGrande } from './file.tokens.ts';
export { LIMITE_POR_DEFECTO_BYTES } from './file.config.ts';
