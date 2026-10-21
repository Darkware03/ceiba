<script setup lang="ts">
/**
 * Tabla de valores publicados: cabeceras, parámetros de consulta o campos de
 * cuerpo de una petición compartida.
 *
 * ESTE COMPONENTE ES LA FRONTERA DE SECRETOS DE LA INTERFAZ. Es el único sitio
 * de la vista pública que pinta pares nombre/valor, y por eso la regla vive
 * aquí y no repartida por tres plantillas:
 *
 *   **si `secret` es `true`, el valor NO se pinta. Nunca. Aunque llegue.**
 *
 * El servidor ya manda `value: null` en ese caso (`publicarValor()` en
 * `publication.ts`), y `api/comparticion.ts` lo vuelve a sanear. Esto es el
 * tercer cerrojo, y el que de verdad importa: es el que está pegado al DOM.
 * Se escribe así —comprobando `secret` antes que `value`— para que el orden de
 * evaluación no deje ningún hueco por el que un valor rellenado por error
 * acabe en la pantalla.
 *
 * Lo que se pinta en su lugar es la **marca**: el usuario tiene derecho a saber
 * que la cabecera existe y que es secreta. Ocultar la fila entera sería mentir
 * sobre la forma de la petición; enseñar el valor sería una fuga. La marca es
 * la única respuesta honesta.
 */
import { computed } from 'vue';

import type { ParametroCompartido, ValorCompartido } from '@/api/comparticion';

const props = withDefaults(
  defineProps<{
    titulo: string;
    valores: readonly (ValorCompartido | ParametroCompartido)[];
    /** Texto cuando no hay ninguno. La ausencia también es información. */
    vacio?: string;
  }>(),
  { vacio: 'No hay ninguno.' },
);

interface FilaVisible {
  readonly clave: string;
  readonly nombre: string;
  readonly secreto: boolean;
  readonly habilitado: boolean;
  readonly descripcion: string;
  /** `null` cuando no hay nada que enseñar (secreto o sin valor). */
  readonly valor: string | null;
  readonly kind: string;
}

const filas = computed<readonly FilaVisible[]>(() =>
  props.valores.map((valor, indice) => {
    const esSecreto = valor.secret === true;
    return {
      clave: `${valor.name}-${indice}`,
      nombre: valor.name,
      secreto: esSecreto,
      habilitado: valor.enabled !== false,
      descripcion: typeof valor.description === 'string' ? valor.description : '',
      // El secreto se decide ANTES de mirar el valor: si `secret` es cierto,
      // `value` ni se consulta.
      valor: esSecreto ? null : (valor.value ?? null),
      kind: 'kind' in valor && typeof valor.kind === 'string' ? valor.kind : '',
    };
  }),
);

const hayAlguno = computed(() => filas.value.length > 0);
</script>

<template>
  <section class="valores">
    <h3 class="valores__titulo">
      {{ titulo }}
      <span v-if="hayAlguno" class="valores__cuenta">{{ filas.length }}</span>
    </h3>

    <p v-if="!hayAlguno" class="valores__vacio">{{ vacio }}</p>

    <dl v-else class="valores__lista">
      <div
        v-for="fila in filas"
        :key="fila.clave"
        class="valores__fila"
        :class="{ 'valores__fila--inactiva': !fila.habilitado }"
      >
        <dt class="valores__nombre">
          <code>{{ fila.nombre }}</code>
          <span v-if="fila.kind" class="valores__kind">{{ fila.kind }}</span>
          <span v-if="!fila.habilitado" class="valores__insignia valores__insignia--inactiva">
            Desactivada
          </span>
        </dt>
        <dd class="valores__valor">
          <!--
            Rama de secreto: PRIMERA, y sin `v-else-if` encadenado al valor.
            Así ningún cambio futuro en el orden puede colar el valor.
          -->
          <span
            v-if="fila.secreto"
            class="valores__insignia valores__insignia--secreta"
            data-prueba="marca-secreta"
            :title="`El valor de «${fila.nombre}» es secreto y no se publica.`"
          >
            🔒 Secreto — no se publica
          </span>
          <code v-else-if="fila.valor !== null && fila.valor !== ''" class="valores__crudo">{{
            fila.valor
          }}</code>
          <span v-else class="valores__sin-dato">Sin valor</span>

          <span v-if="fila.descripcion" class="valores__descripcion">{{ fila.descripcion }}</span>
        </dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.valores {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-2);
}

.valores__titulo {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-2);
  margin: 0;
  font-size: var(--ceiba-text-sm);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ceiba-text-faint);
}

.valores__cuenta {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.5rem;
  padding: 0 var(--ceiba-space-1);
  border-radius: var(--ceiba-radius-pill);
  background: var(--ceiba-surface-overlay);
  color: var(--ceiba-text-muted);
  font-size: var(--ceiba-text-xs);
  letter-spacing: 0;
}

.valores__vacio {
  margin: 0;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-faint);
}

.valores__lista {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
  margin: 0;
}

.valores__fila {
  display: grid;
  grid-template-columns: minmax(8rem, 18rem) 1fr;
  gap: var(--ceiba-space-3);
  padding: var(--ceiba-space-2) var(--ceiba-space-3);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-sm);
  background: var(--ceiba-surface-raised);
}

.valores__fila--inactiva {
  opacity: 0.6;
}

.valores__nombre {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ceiba-space-2);
  min-width: 0;
}

.valores__nombre code {
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text);
  overflow-wrap: anywhere;
}

.valores__kind {
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

.valores__valor {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
  margin: 0;
  min-width: 0;
}

.valores__crudo {
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.valores__sin-dato {
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

.valores__descripcion {
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

.valores__insignia {
  display: inline-block;
  width: fit-content;
  padding: var(--ceiba-space-1) var(--ceiba-space-2);
  border-radius: var(--ceiba-radius-pill);
  border: 1px solid var(--ceiba-border-strong);
  background: var(--ceiba-surface-overlay);
  color: var(--ceiba-text-muted);
  font-size: var(--ceiba-text-xs);
  font-weight: 600;
}

.valores__insignia--secreta {
  color: var(--ceiba-warning);
  border-color: var(--ceiba-warning);
}

.valores__insignia--inactiva {
  color: var(--ceiba-text-faint);
}

@media (max-width: 640px) {
  .valores__fila {
    grid-template-columns: 1fr;
    gap: var(--ceiba-space-1);
  }
}
</style>
