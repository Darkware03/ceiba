<script setup lang="ts">
/**
 * Raíz de la aplicación.
 *
 * Decide una sola cosa: si la ruta actual es pública (acceso, registro, 404)
 * se pinta desnuda; si no, dentro del armazón con navegación. La vista no
 * tiene que saber en qué marco vive.
 *
 * `CeibaLoadingScreen` cubre las esperas de navegación. Es el componente del
 * paquete de marca, no un indicador propio: el giro del logo es requisito del
 * cliente y `packages/brand` ya lo resuelve con el recorte corregido
 * (docs/BRAND.md §4.1).
 */
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { CeibaLoadingScreen } from '@ceiba/brand';
import ArmazonDeAplicacion from '@/components/layout/ArmazonDeAplicacion.vue';
import { usarAlmacenDeSesion } from '@/stores/sesion';

const ruta = useRoute();
const sesion = usarAlmacenDeSesion();

const esPublica = computed(() => ruta.meta.publica === true);

/** Sólo mientras no se sabe todavía si hay sesión y la ruta la necesita. */
const comprobandoSesion = computed(() => !sesion.comprobada && !esPublica.value);
</script>

<template>
  <CeibaLoadingScreen
    v-if="comprobandoSesion"
    message="Comprobando sesión…"
    detail="GET /api/v1/auth/me"
    boot
  />

  <RouterView v-else-if="esPublica" v-slot="{ Component }">
    <component :is="Component" />
  </RouterView>

  <ArmazonDeAplicacion v-else>
    <RouterView v-slot="{ Component }">
      <component :is="Component" />
    </RouterView>
  </ArmazonDeAplicacion>
</template>
