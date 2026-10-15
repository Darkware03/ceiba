<script setup lang="ts">
/**
 * Inicio de sesión contra la API real (`POST /api/v1/auth/login`).
 *
 * Dos cosas que no se ven y son el núcleo de la decisión C-31:
 *  - Esta vista **no recibe ningún testigo**. La API responde con la cookie
 *    `__Host-ceiba_session`, que es `HttpOnly`: este código no puede leerla ni
 *    guardarla, y no lo intenta.
 *  - El `POST` lleva el testigo CSRF porque lo pone `api/cliente.ts`, no
 *    porque esta vista se acuerde. El inicio de sesión **también** está
 *    cubierto por CSRF en el servidor (ADR-0009 §5: el *login CSRF* es real).
 *
 * Si la cuenta tiene segundo factor, la API no abre sesión: devuelve un reto y
 * aquí se pinta el segundo paso. Ignorarlo dejaría al usuario en un login que
 * «no hace nada».
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
import { destinoDeVuelta } from '@/router/guardas';
import { RUTA_REGISTRO, RUTA_WORKSPACES } from '@/router/nombres';

const sesion = usarAlmacenDeSesion();
const ruta = useRoute();
const enrutador = useRouter();

const email = ref('');
const contrasena = ref('');
const codigo = ref('');
const error = ref<string | null>(null);

const pidiendoSegundoFactor = computed(() => sesion.reto !== null);

async function irAlDestino(): Promise<void> {
  const vuelta = destinoDeVuelta(ruta.query['redirect']);
  await (vuelta !== null
    ? enrutador.replace(vuelta)
    : enrutador.replace({ name: RUTA_WORKSPACES }));
}

async function enviar(): Promise<void> {
  error.value = null;
  try {
    const dentro = await sesion.iniciar(email.value.trim(), contrasena.value);
    contrasena.value = '';
    if (dentro) await irAlDestino();
  } catch (fallo) {
    error.value = mensajeDeError(fallo);
  }
}

async function enviarSegundoFactor(): Promise<void> {
  error.value = null;
  try {
    const dentro = await sesion.verificarSegundoFactor(codigo.value.trim());
    codigo.value = '';
    if (dentro) await irAlDestino();
  } catch (fallo) {
    error.value = mensajeDeError(fallo);
  }
}
</script>

<template>
  <div class="acceso">
    <div class="acceso__esquina"><ConmutadorDeTema /></div>

    <section class="acceso__tarjeta ceiba-panel">
      <header class="acceso__cabecera">
        <CeibaMark :size="40" title="CEIBA API Studio" />
        <h1 class="acceso__titulo">CEIBA API Studio</h1>
        <p class="acceso__lema">Conectividad · Exploración · Integración · Benchmarking · Automatización</p>
      </header>

      <CeibaAviso v-if="error" tono="error">{{ error }}</CeibaAviso>

      <form v-if="!pidiendoSegundoFactor" class="acceso__formulario" @submit.prevent="enviar">
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
          autocompletado="current-password"
          requerido
          :deshabilitado="sesion.cargando"
        />
        <CeibaBoton
          variante="primario"
          tipo="submit"
          ancho-completo
          :cargando="sesion.cargando"
          :deshabilitado="email.trim().length === 0 || contrasena.length === 0"
        >
          Entrar
        </CeibaBoton>
      </form>

      <form v-else class="acceso__formulario" @submit.prevent="enviarSegundoFactor">
        <CeibaAviso tono="info" titulo="Verificación en dos pasos">
          Esta cuenta tiene segundo factor. Introduce el código de 6 dígitos de tu aplicación
          de autenticación.
        </CeibaAviso>
        <CeibaCampo
          v-model="codigo"
          etiqueta="Código de verificación"
          autocompletado="one-time-code"
          marcador-de-posicion="000000"
          monoespaciada
          requerido
          :deshabilitado="sesion.cargando"
        />
        <CeibaBoton
          variante="primario"
          tipo="submit"
          ancho-completo
          :cargando="sesion.cargando"
          :deshabilitado="codigo.trim().length !== 6"
        >
          Verificar
        </CeibaBoton>
      </form>

      <p class="acceso__pie">
        ¿No tienes cuenta?
        <RouterLink :to="{ name: RUTA_REGISTRO, query: ruta.query }">Crear una</RouterLink>
      </p>
    </section>
  </div>
</template>

<style scoped>
.acceso {
  display: grid;
  place-items: center;
  min-height: 100vh;
  padding: var(--ceiba-space-5);
  background: var(--ceiba-bg);
}

.acceso__esquina {
  position: fixed;
  top: var(--ceiba-space-3);
  right: var(--ceiba-space-3);
}

.acceso__tarjeta {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-4);
  width: min(26rem, 100%);
  padding: var(--ceiba-space-6);
}

.acceso__cabecera {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--ceiba-space-2);
  text-align: center;
}

.acceso__titulo {
  font-size: var(--ceiba-text-xl);
}

.acceso__lema {
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
  max-width: 28ch;
}

.acceso__formulario {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-4);
}

.acceso__pie {
  text-align: center;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}
</style>
