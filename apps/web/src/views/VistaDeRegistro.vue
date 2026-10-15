<script setup lang="ts">
/**
 * Alta de cuenta (`POST /api/v1/auth/register`) y entrada inmediata.
 *
 * El registro de la API **no abre sesión**: devuelve el perfil y nada más
 * (comprobado en `identity.controller.ts`). El almacén encadena el `login`
 * después, para que el usuario no tenga que escribir sus datos dos veces.
 *
 * La validación de contraseña replica la del servidor (`esquemaContrasena`:
 * mínimo 12 caracteres) **sólo para avisar antes de enviar**. La validación
 * que cuenta sigue siendo la de la API; esto es cortesía, no un control.
 */
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { CeibaMark } from '@ceiba/brand';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import CeibaCampo from '@/components/ui/CeibaCampo.vue';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import ConmutadorDeTema from '@/components/ui/ConmutadorDeTema.vue';
import { usarAlmacenDeSesion } from '@/stores/sesion';
import { mensajeDeError } from '@/api/errores';
import { LONGITUD_MINIMA_CONTRASENA } from '@/api/tipos';
import { destinoDeVuelta } from '@/router/guardas';
import { RUTA_LOGIN, RUTA_WORKSPACES } from '@/router/nombres';

const sesion = usarAlmacenDeSesion();
const ruta = useRoute();
const enrutador = useRouter();

const nombre = ref('');
const email = ref('');
const contrasena = ref('');
const error = ref<string | null>(null);
const tocadaContrasena = ref(false);

const errorContrasena = computed(() => {
  if (!tocadaContrasena.value || contrasena.value.length === 0) return null;
  return contrasena.value.length < LONGITUD_MINIMA_CONTRASENA
    ? `La contraseña necesita al menos ${LONGITUD_MINIMA_CONTRASENA} caracteres.`
    : null;
});

const puedeEnviar = computed(
  () =>
    nombre.value.trim().length > 0 &&
    email.value.trim().length > 0 &&
    contrasena.value.length >= LONGITUD_MINIMA_CONTRASENA,
);

async function enviar(): Promise<void> {
  error.value = null;
  tocadaContrasena.value = true;
  if (!puedeEnviar.value) return;

  try {
    const dentro = await sesion.registrarEIniciar(
      email.value.trim(),
      contrasena.value,
      nombre.value.trim(),
    );
    contrasena.value = '';
    if (dentro) {
      const vuelta = destinoDeVuelta(ruta.query['redirect']);
      await (vuelta !== null
        ? enrutador.replace(vuelta)
        : enrutador.replace({ name: RUTA_WORKSPACES }));
    } else {
      // Cuenta recién creada con segundo factor: el login lo resuelve.
      await enrutador.replace({ name: RUTA_LOGIN, query: ruta.query });
    }
  } catch (fallo) {
    error.value = mensajeDeError(fallo);
  }
}
</script>

<template>
  <div class="registro">
    <div class="registro__esquina"><ConmutadorDeTema /></div>

    <section class="registro__tarjeta ceiba-panel">
      <header class="registro__cabecera">
        <CeibaMark :size="40" title="CEIBA API Studio" />
        <h1 class="registro__titulo">Crear cuenta</h1>
      </header>

      <CeibaAviso v-if="error" tono="error">{{ error }}</CeibaAviso>

      <form class="registro__formulario" @submit.prevent="enviar">
        <CeibaCampo
          v-model="nombre"
          etiqueta="Nombre"
          autocompletado="name"
          marcador-de-posicion="Nombre y apellido"
          requerido
          :deshabilitado="sesion.cargando"
        />
        <CeibaCampo
          v-model="email"
          etiqueta="Correo electrónico"
          tipo="email"
          autocompletado="username"
          marcador-de-posicion="persona@ejemplo.sv"
          requerido
          :deshabilitado="sesion.cargando"
        />
        <CeibaCampo
          v-model="contrasena"
          etiqueta="Contraseña"
          tipo="password"
          autocompletado="new-password"
          :ayuda="`Mínimo ${LONGITUD_MINIMA_CONTRASENA} caracteres. La entropía la pone la longitud, no los símbolos.`"
          :error="errorContrasena"
          requerido
          :deshabilitado="sesion.cargando"
          @update:model-value="tocadaContrasena = true"
        />
        <CeibaBoton
          variante="primario"
          tipo="submit"
          ancho-completo
          :cargando="sesion.cargando"
          :deshabilitado="!puedeEnviar"
        >
          Crear cuenta y entrar
        </CeibaBoton>
      </form>

      <p class="registro__pie">
        ¿Ya tienes cuenta?
        <RouterLink :to="{ name: RUTA_LOGIN, query: ruta.query }">Entrar</RouterLink>
      </p>
    </section>
  </div>
</template>

<style scoped>
.registro {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: var(--ceiba-space-5);
  background: var(--ceiba-bg);
}

.registro__esquina {
  position: fixed;
  top: var(--ceiba-space-3);
  right: var(--ceiba-space-3);
}

.registro__tarjeta {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-4);
  width: min(26rem, 100%);
  padding: var(--ceiba-space-6);
}

.registro__cabecera {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ceiba-space-2);
  text-align: center;
}

.registro__titulo {
  font-size: var(--ceiba-text-xl);
}

.registro__formulario {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-4);
}

.registro__pie {
  text-align: center;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}
</style>
