import { createRouter, createWebHistory, type Router } from 'vue-router';
import { aplicarTitulo, guardaDeSesion } from './guardas';
import { rutas } from './rutas';

export function crearEnrutador(): Router {
  const enrutador = createRouter({
    history: createWebHistory(),
    routes: rutas,
    scrollBehavior: (_hacia, _desde, guardada) => guardada ?? { top: 0 },
  });

  enrutador.beforeEach(guardaDeSesion);
  enrutador.afterEach(aplicarTitulo);

  return enrutador;
}

export * from './nombres';
