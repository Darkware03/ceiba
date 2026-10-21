/** SUPERFICIE PÚBLICA de `sharing` (ADR-0004 §2). */
export { ModuloDeComparticion } from './sharing.module.ts';
export { ServicioDeAdministracionDeComparticion } from './sharing-admin.service.ts';
export { ServicioDeSesionesCompartidas } from './share-session.service.ts';
export { ServicioDeAccesoCompartido } from './share-access.service.ts';
export { RepositorioDeComparticion } from './sharing.repository.ts';
export type { PrincipalDeComparticion } from './share-principal.ts';
export type { PermisoDeComparticion, OperacionCompartida } from './share-policy.ts';
