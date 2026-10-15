<script setup lang="ts">
/**
 * Armazón de la aplicación autenticada: cabecera, navegación lateral y área
 * principal. Responsive: por debajo de 860 px la lateral pasa a bloque
 * superior en vez de desaparecer (§2: «diseño responsive para escritorio,
 * tablet y móvil»).
 */
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { CeibaMark } from '@ceiba/brand';
import BarraLateral from './BarraLateral.vue';
import ConmutadorDeTema from '@/components/ui/ConmutadorDeTema.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import { usarAlmacenDeSesion } from '@/stores/sesion';
import { RUTA_LOGIN } from '@/router/nombres';

const sesion = usarAlmacenDeSesion();
const enrutador = useRouter();
const saliendo = ref(false);

async function salir(): Promise<void> {
  saliendo.value = true;
  try {
    await sesion.cerrar();
    await enrutador.push({ name: RUTA_LOGIN });
  } finally {
    saliendo.value = false;
  }
}
</script>

<template>
  <div class="armazon">
    <a class="ceiba-salto" href="#principal">Saltar al contenido</a>

    <header class="armazon__cabecera">
      <RouterLink to="/" class="armazon__marca">
        <CeibaMark :size="24" title="CEIBA API Studio" />
        <span class="armazon__nombre">CEIBA<span class="armazon__sufijo"> API Studio</span></span>
      </RouterLink>

      <div class="armazon__acciones">
        <ConmutadorDeTema />
        <span v-if="sesion.autenticado" class="armazon__usuario" :title="sesion.usuario?.email">
          <span class="armazon__iniciales" aria-hidden="true">{{ sesion.iniciales }}</span>
          <span class="armazon__nombre-usuario">{{ sesion.nombreVisible }}</span>
        </span>
        <CeibaBoton v-if="sesion.autenticado" variante="fantasma" compacto :cargando="saliendo"
                    @click="salir">
          Salir
        </CeibaBoton>
      </div>
    </header>

    <div class="armazon__cuerpo">
      <BarraLateral />
      <main id="principal" class="armazon__principal" tabindex="-1">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
.armazon {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  flex: 1;
}

.armazon__cabecera {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--ceiba-space-4);
  padding: var(--ceiba-space-2) var(--ceiba-space-4);
  height: 48px;
  flex: none;
  border-bottom: 1px solid var(--ceiba-border);
  background: var(--ceiba-surface);
}

.armazon__marca {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-2);
  color: var(--ceiba-text);
  text-decoration: none;
}

.armazon__marca:hover {
  text-decoration: none;
}

.armazon__nombre {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.armazon__sufijo {
  color: var(--ceiba-text-muted);
  font-weight: 400;
}

.armazon__acciones {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-2);
}

.armazon__usuario {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-2);
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.armazon__iniciales {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--ceiba-radius-pill);
  background: var(--ceiba-accent-surface);
  color: var(--ceiba-accent-strong);
  font-size: var(--ceiba-text-xs);
  font-weight: 600;
}

.armazon__cuerpo {
  display: flex;
  flex: 1;
  min-height: 0;
}

.armazon__principal {
  flex: 1;
  min-width: 0;
  overflow: auto;
}

.armazon__principal:focus {
  outline: none;
}

@media (max-width: 860px) {
  .armazon__cuerpo {
    flex-direction: column;
  }

  .armazon__sufijo,
  .armazon__nombre-usuario {
    display: none;
  }
}
</style>
