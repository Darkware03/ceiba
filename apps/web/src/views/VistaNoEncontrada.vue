<script setup lang="ts">
import CeibaVacio from '@/components/ui/CeibaVacio.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import { useRouter } from 'vue-router';
import { RUTA_WORKSPACES } from '@/router/nombres';

const enrutador = useRouter();
</script>

<template>
  <div class="no-encontrada">
    <CeibaVacio
      titulo="Esta página no existe"
      detalle="La dirección no corresponde a ninguna pantalla de CEIBA API Studio."
    >
      <CeibaBoton variante="primario" @click="enrutador.push({ name: RUTA_WORKSPACES })">
        Ir a mis workspaces
      </CeibaBoton>
    </CeibaVacio>
  </div>
</template>

<style scoped>
.no-encontrada {
  display: grid;
  place-items: center;
  min-height: 100vh;
  background: var(--ceiba-bg);
}
</style>
