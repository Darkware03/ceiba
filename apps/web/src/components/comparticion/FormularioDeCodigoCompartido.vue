<script setup lang="ts">
/**
 * Formulario del código de acceso de un enlace compartido.
 *
 * ── Por qué este formulario dice tan poco ──────────────────────────────────
 *
 * Parece un formulario pobre, y es a propósito. No puede decir de qué
 * colección se trata, ni quién la compartió, ni cuándo caduca el enlace,
 * porque `GET /share/:slug` devuelve **literalmente** `{ estado }` y nada más
 * (`share-public.controller.ts:78-86`). El servidor se guarda esa información
 * para que nadie pueda recorrer slugs al azar averiguando cuáles existen.
 *
 * Así que la pantalla lo **declara** en vez de dejar un hueco mudo: «el
 * propietario no publica el nombre hasta que entras». Un hueco sin explicación
 * parece un fallo de carga; una frase corta convierte la misma ausencia en una
 * garantía entendible.
 *
 * ── Un solo mensaje de error ───────────────────────────────────────────────
 *
 * `C-CODE-04`. El código incorrecto, el enlace caducado y el enlace revocado
 * producen **el mismo texto**, `MENSAJE_ACCESO_INVALIDO`, porque en el servidor
 * producen la misma respuesta byte a byte. Este componente no recibe siquiera
 * un motivo que pudiera pintar distinto: sólo un booleano de fallo. No se puede
 * filtrar lo que no se tiene.
 */
import { computed, nextTick, onMounted, ref, useId } from 'vue';

import { CeibaLoadingScreen, CeibaMark } from '@ceiba/brand';

import { MENSAJE_ACCESO_INVALIDO } from '@/api/comparticion';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';

const props = withDefaults(
  defineProps<{
    /** `true` mientras se canjea el código. */
    enviando?: boolean;
    /** `true` si el último intento falló. El motivo NO se transmite. */
    fallido?: boolean;
  }>(),
  { enviando: false, fallido: false },
);

const emitir = defineEmits<{ enviar: [codigo: string] }>();

const codigo = ref('');
const idCampo = useId();
const campo = ref<HTMLInputElement | null>(null);

const vacio = computed(() => codigo.value.trim() === '');

function enviar(): void {
  if (props.enviando) return;
  // Se envía aunque esté vacío NO: un envío vacío gasta un intento del
  // limitador de tasa del servidor (`C-CODE-03`) sin posibilidad de acertar.
  if (vacio.value) return;
  emitir('enviar', codigo.value.trim());
}

onMounted(() => {
  // El foco va al campo: quien llega aquí viene de pulsar un enlace y lo único
  // que tiene que hacer es pegar el código.
  void nextTick(() => campo.value?.focus());
});
</script>

<template>
  <div class="codigo">
    <CeibaLoadingScreen
      v-if="enviando"
      inline
      size="md"
      message="Comprobando el código…"
      detail="Abriendo la sesión de compartición"
    />

    <header class="codigo__cabecera">
      <CeibaMark :size="40" class="codigo__marca" />
      <div>
        <p class="codigo__migas">Colección compartida</p>
        <h1 class="codigo__titulo">Este enlace pide un código</h1>
      </div>
    </header>

    <p class="codigo__explicacion">
      Quien te compartió la colección protegió el enlace con un código de acceso. Pégalo aquí
      para entrar.
    </p>

    <CeibaAviso v-if="fallido" tono="error" titulo="No se ha podido entrar">
      {{ MENSAJE_ACCESO_INVALIDO }}
    </CeibaAviso>

    <form class="codigo__formulario" @submit.prevent="enviar">
      <label class="codigo__etiqueta" :for="idCampo">Código de acceso</label>
      <input
        :id="idCampo"
        ref="campo"
        v-model="codigo"
        class="codigo__campo"
        type="password"
        autocomplete="one-time-code"
        spellcheck="false"
        :disabled="enviando"
        placeholder="Pega aquí el código que te pasaron"
        data-prueba="campo-codigo"
      />
      <CeibaBoton
        variante="primario"
        tipo="submit"
        ancho-completo
        :cargando="enviando"
        :deshabilitado="vacio"
      >
        Entrar
      </CeibaBoton>
    </form>

    <p class="codigo__nota">
      No se publica el nombre de la colección hasta que entras: es la misma protección que
      impide averiguar qué enlaces existen probando direcciones al azar.
    </p>
  </div>
</template>

<style scoped>
.codigo {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-4);
  min-height: 18rem;
}

.codigo__cabecera {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-3);
}

.codigo__marca {
  color: var(--ceiba-accent);
  flex: none;
}

.codigo__migas {
  margin: 0;
  font-size: var(--ceiba-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ceiba-text-faint);
}

.codigo__titulo {
  margin: var(--ceiba-space-1) 0 0;
  font-size: var(--ceiba-text-xl);
  color: var(--ceiba-text);
}

.codigo__explicacion {
  margin: 0;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.codigo__formulario {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-2);
}

.codigo__etiqueta {
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.codigo__campo {
  width: 100%;
  padding: var(--ceiba-space-3);
  border: 1px solid var(--ceiba-border-strong);
  border-radius: var(--ceiba-radius-md);
  background: var(--ceiba-bg-sunken);
  color: var(--ceiba-text);
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-md);
}

.codigo__campo:focus-visible {
  outline: 2px solid var(--ceiba-focus-ring);
  outline-offset: 2px;
}

.codigo__nota {
  margin: 0;
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}
</style>
