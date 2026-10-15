<script setup lang="ts">
/**
 * Navegación lateral (§18).
 *
 * La §18 enumera nueve destinos (workspaces, colecciones, carpetas, historial,
 * entornos, ejecuciones, documentación, importar, configuración) y **a la vez**
 * exige: «No muestres botones que no tengan funcionalidad implementada. Si una
 * función está pendiente, identifícala claramente en la interfaz».
 *
 * Las dos cosas se cumplen así: lo implementado es un enlace de verdad; lo que
 * aún no existe aparece como entrada **inerte**, con `aria-disabled` y la
 * etiqueta «pendiente» visible. No hay ningún control que parezca funcionar y
 * no haga nada, que es exactamente lo que la regla prohíbe.
 */
import { RUTA_CONSTRUCTOR, RUTA_WORKSPACES } from '@/router/nombres';

interface Destino {
  readonly clave: string;
  readonly etiqueta: string;
  readonly ruta?: string;
  readonly icono: string;
}

/** Implementado y navegable en esta ronda. */
const disponibles: readonly Destino[] = [
  { clave: 'workspaces', etiqueta: 'Workspaces', ruta: RUTA_WORKSPACES, icono: 'M3 7h18M3 12h18M3 17h18' },
  {
    clave: 'constructor',
    etiqueta: 'Constructor',
    ruta: RUTA_CONSTRUCTOR,
    icono: 'M4 12h6m4 0h6M9 7l-5 5 5 5m6-10 5 5-5 5',
  },
];

/** Declarado en la §18, **todavía no implementado**. Ver FRONTEND.md. */
const pendientes: readonly Destino[] = [
  { clave: 'historial', etiqueta: 'Historial', icono: 'M12 7v5l3 2M3 12a9 9 0 1 0 2.6-6.4M3 4v4h4' },
  { clave: 'entornos', etiqueta: 'Entornos', icono: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c3 3.5 3 14 0 18' },
  { clave: 'ejecuciones', etiqueta: 'Ejecuciones', icono: 'M8 5l11 7-11 7V5Z' },
  { clave: 'documentacion', etiqueta: 'Documentación', icono: 'M5 4h10l4 4v12H5V4ZM15 4v4h4M8 13h8M8 17h5' },
  { clave: 'importar', etiqueta: 'Importar', icono: 'M12 4v10m0 0 4-4m-4 4-4-4M4 19h16' },
  { clave: 'configuracion', etiqueta: 'Configuración', icono: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM4.2 12l-1.4-2.2 1.6-2.8 2.5.5 1.9-1.1L9.4 3.6h5.2l.6 2.8 1.9 1.1 2.5-.5 1.6 2.8L19.8 12l1.4 2.2-1.6 2.8-2.5-.5-1.9 1.1-.6 2.8H9.4l-.6-2.8-1.9-1.1-2.5.5-1.6-2.8L4.2 12Z' },
];
</script>

<template>
  <nav class="lateral" aria-label="Navegación principal">
    <ul class="lateral__lista">
      <li v-for="destino in disponibles" :key="destino.clave">
        <RouterLink class="lateral__enlace" :to="{ name: destino.ruta }">
          <svg class="lateral__icono" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path :d="destino.icono" />
          </svg>
          <span>{{ destino.etiqueta }}</span>
        </RouterLink>
      </li>
    </ul>

    <p class="lateral__rotulo">Pendiente en esta versión</p>
    <ul class="lateral__lista">
      <li v-for="destino in pendientes" :key="destino.clave">
        <span class="lateral__enlace lateral__enlace--inerte" aria-disabled="true">
          <svg class="lateral__icono" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path :d="destino.icono" />
          </svg>
          <span>{{ destino.etiqueta }}</span>
          <span class="lateral__marca">pendiente</span>
        </span>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.lateral {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-2);
  padding: var(--ceiba-space-3);
  width: 232px;
  flex: none;
  border-right: 1px solid var(--ceiba-border);
  background: var(--ceiba-bg-sunken);
  overflow-y: auto;
}

.lateral__lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lateral__enlace {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-3);
  padding: var(--ceiba-space-2) var(--ceiba-space-3);
  border-radius: var(--ceiba-radius-md);
  color: var(--ceiba-text-muted);
  font-size: var(--ceiba-text-md);
  text-decoration: none;
}

.lateral__enlace:hover {
  background: var(--ceiba-surface-overlay);
  color: var(--ceiba-text);
  text-decoration: none;
}

.lateral__enlace.router-link-active {
  background: var(--ceiba-accent-surface);
  color: var(--ceiba-accent-strong);
}

.lateral__enlace--inerte {
  color: var(--ceiba-text-faint);
  cursor: not-allowed;
}

.lateral__enlace--inerte:hover {
  background: transparent;
  color: var(--ceiba-text-faint);
}

.lateral__icono {
  width: 17px;
  height: 17px;
  flex: none;
}

.lateral__marca {
  margin-left: auto;
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ceiba-text-faint);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-pill);
  padding: 1px 6px;
}

.lateral__rotulo {
  margin-top: var(--ceiba-space-4);
  padding: 0 var(--ceiba-space-3);
  font-size: var(--ceiba-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ceiba-text-faint);
}

@media (max-width: 860px) {
  .lateral {
    width: 100%;
    border-right: 0;
    border-bottom: 1px solid var(--ceiba-border);
  }
}
</style>
