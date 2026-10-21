/** SUPERFICIE PÚBLICA de `request` (ADR-0004 §2). */
export { ModuloDePeticiones } from './request.module.ts';
export { ServicioDePeticiones } from './request.service.ts';
export { RepositorioDePeticiones } from './request.repository.ts';
export { generarCurl, PREFIJO_DE_SECRETO } from './curl.ts';
export type { PeticionParaCurl, ResultadoCurl } from './curl.ts';
