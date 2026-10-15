import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { crearEnrutador } from './router';
import { usarAlmacenDeTema } from './stores/tema';
import './styles/base.css';

/**
 * Arranque de la interfaz.
 *
 * Orden deliberado:
 *  1. Pinia y el tema, **antes** de montar, para que el primer fotograma de
 *     Vue salga ya con la paleta correcta.
 *  2. `router.isReady()`, para que la pantalla de arranque de `index.html`
 *     siga girando hasta que la primera ruta esté resuelta. El guard de sesión
 *     pregunta a `GET /auth/me` ahí dentro: si se retirase el logo antes, se
 *     vería un parpadeo de interfaz vacía o un login que desaparece solo.
 *  3. Retirar la pantalla de arranque.
 */
async function arrancar(): Promise<void> {
  const app = createApp(App);

  app.use(createPinia());
  usarAlmacenDeTema().inicializar();

  const enrutador = crearEnrutador();
  app.use(enrutador);

  app.mount('#app');

  detalleDeArranque('resolviendo sesión');
  try {
    await enrutador.isReady();
  } finally {
    retirarPantallaDeArranque();
  }
}

/** Actualiza la segunda línea del arranque; si no existe, no pasa nada. */
function detalleDeArranque(texto: string): void {
  const nodo = document.getElementById('ceiba-boot-detalle');
  if (nodo !== null) nodo.textContent = texto;
}

/**
 * Retira la pantalla de arranque de `index.html`.
 *
 * Con `prefers-reduced-motion` no hay transición, así que se oculta de
 * inmediato en vez de esperar un evento que no va a llegar.
 */
function retirarPantallaDeArranque(): void {
  const arranque = document.getElementById('ceiba-boot');
  if (arranque === null) return;

  const sinMovimiento =
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

  const ocultar = (): void => {
    arranque.setAttribute('hidden', '');
    arranque.remove();
  };

  if (sinMovimiento) {
    ocultar();
    return;
  }

  arranque.classList.add('ceiba-boot--saliendo');
  arranque.addEventListener('transitionend', ocultar, { once: true });
  // Red de seguridad: si la transición no dispara (pestaña en segundo plano),
  // el logo no se queda girando para siempre encima de la aplicación.
  globalThis.setTimeout(ocultar, 600);
}

void arrancar();
