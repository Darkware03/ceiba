<script setup lang="ts">
/**
 * Indicador visible del autoguardado (P1 del `BRIEF-FASE7`, §3.C.1).
 *
 * «Un **indicador de estado visible**» es uno de los tres requisitos que el
 * brief marca como no opcionales, y la razón es dura: un guardado que ocurre
 * solo y no se ve es, desde el lado del usuario, indistinguible de uno que no
 * ocurrió. El cliente que no ve nada vuelve a pulsar, duda, o —peor— cierra la
 * pestaña creyendo que ya está.
 *
 * `role="status"` y `aria-live="polite"` para que el cambio se **anuncie** sin
 * robar el foco: quien usa lector de pantalla también tiene derecho a saber
 * que su trabajo está a salvo.
 *
 * El giro de la marca mientras se guarda lo pone `CeibaSpinner`, nunca un
 * spinner propio (estándar visual §2.2.3).
 */
import { computed } from 'vue';
import { CeibaSpinner } from '@ceiba/brand';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import type { EstadoDeGuardado } from '@/stores/constructor';

const props = withDefaults(
  defineProps<{
    estado: EstadoDeGuardado;
    error?: string | null;
    /** Marca ISO del último guardado confirmado. */
    guardadoEn?: string | null;
  }>(),
  { error: null, guardadoEn: null },
);

const emitir = defineEmits<{ reintentar: [] }>();

const TEXTOS: Readonly<Record<EstadoDeGuardado, string>> = {
  inactivo: 'Borrador sin guardar',
  sinGuardar: 'Sin guardar',
  guardando: 'Guardando…',
  guardado: 'Guardado',
  error: 'No se pudo guardar',
  conflicto: 'Cambiada por otra persona',
};

const texto = computed(() => TEXTOS[props.estado]);

/** Hora del último guardado, sin fecha: la fecha es hoy casi siempre. */
const hora = computed(() => {
  if (props.guardadoEn === null) return '';
  const fecha = new Date(props.guardadoEn);
  if (Number.isNaN(fecha.getTime())) return '';
  return fecha.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
});

const esFallo = computed(() => props.estado === 'error' || props.estado === 'conflicto');
</script>

<template>
  <div class="guardado" :class="`guardado--${estado}`">
    <p class="guardado__linea" role="status" aria-live="polite" data-prueba="estado-de-guardado">
      <CeibaSpinner v-if="estado === 'guardando'" size="xs" />
      <span class="guardado__punto" aria-hidden="true" />
      <span>{{ texto }}</span>
      <span v-if="estado === 'guardado' && hora" class="guardado__hora">a las {{ hora }}</span>
    </p>

    <!--
      El motivo va SIEMPRE que haya fallo, nunca escondido tras un icono: el
      brief exige «"Sin guardar" con el error», no sólo la etiqueta.
    -->
    <p v-if="esFallo && error" class="guardado__motivo">{{ error }}</p>

    <CeibaBoton
      v-if="esFallo"
      compacto
      variante="secundario"
      data-prueba="reintentar-guardado"
      @click="emitir('reintentar')"
    >
      Reintentar ahora
    </CeibaBoton>

    <p v-if="estado === 'inactivo'" class="guardado__nota">
      Esta solicitud no pertenece a ninguna colección todavía, así que no se guarda sola.
    </p>
  </div>
</template>

<style scoped>
.guardado {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ceiba-space-2);
  min-width: 0;
}

.guardado__linea {
  display: inline-flex;
  align-items: center;
  gap: var(--ceiba-space-2);
  margin: 0;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

/* El punto es redundante con el texto a propósito: el color solo no puede ser
 * el portador de la información (estándar visual §2.2.6). */
.guardado__punto {
  width: 8px;
  height: 8px;
  border-radius: var(--ceiba-radius-pill);
  background: var(--ceiba-text-faint);
  flex: none;
}

.guardado--guardado .guardado__punto {
  background: var(--ceiba-success);
}

.guardado--sinGuardar .guardado__punto {
  background: var(--ceiba-warning);
}

.guardado--error .guardado__punto,
.guardado--conflicto .guardado__punto {
  background: var(--ceiba-danger);
}

.guardado--guardando .guardado__punto {
  display: none;
}

.guardado__hora {
  color: var(--ceiba-text-faint);
}

.guardado__motivo {
  flex-basis: 100%;
  margin: 0;
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-danger);
}

.guardado__nota {
  margin: 0;
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}
</style>
