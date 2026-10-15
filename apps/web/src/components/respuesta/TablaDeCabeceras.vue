<script setup lang="ts">
/**
 * Cabeceras de la respuesta.
 *
 * AVISO QUE NO ES COSMÉTICO: cuando la solicitud se ejecuta desde el
 * navegador, una respuesta de otro origen sólo deja leer las siete cabeceras
 * «CORS-safelisted» (`cache-control`, `content-language`, `content-length`,
 * `content-type`, `expires`, `last-modified`, `pragma`) más las que el
 * servidor publique en `Access-Control-Expose-Headers`. Las demás EXISTEN
 * pero el navegador no las entrega. Si no se dijera, esta tabla parecería
 * afirmar que el servidor no mandó `Authorization` ni `Set-Cookie`.
 */
import CeibaVacio from '@/components/ui/CeibaVacio.vue';
import type { CabeceraDeRespuesta } from '@/api/ejecucion';

withDefaults(
  defineProps<{ cabeceras: readonly CabeceraDeRespuesta[]; avisoDeCors?: boolean }>(),
  { avisoDeCors: false },
);
</script>

<template>
  <div class="cabeceras" data-prueba="cabeceras">
    <CeibaVacio
      v-if="cabeceras.length === 0"
      titulo="Sin cabeceras legibles"
      detalle="La respuesta no trae cabeceras o el navegador no permite leerlas."
    />

    <template v-else>
      <table class="cabeceras__tabla">
        <caption class="cabeceras__titulo">
          {{ cabeceras.length }} cabecera(s) de respuesta
        </caption>
        <thead>
          <tr>
            <th scope="col">Nombre</th>
            <th scope="col">Valor</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(cabecera, indice) in cabeceras" :key="`${cabecera.name}-${indice}`">
            <th scope="row" class="cabeceras__nombre">{{ cabecera.name }}</th>
            <td class="cabeceras__valor">{{ cabecera.value }}</td>
          </tr>
        </tbody>
      </table>

      <p v-if="avisoDeCors" class="cabeceras__nota">
        Ejecutando desde el navegador sólo se leen las cabeceras permitidas por CORS; puede
        haber más que el servidor no expone.
      </p>
    </template>
  </div>
</template>

<style scoped>
.cabeceras {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-2);
}

.cabeceras__tabla {
  width: 100%;
  border-collapse: collapse;
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-sm);
}

.cabeceras__titulo {
  text-align: left;
  padding-bottom: var(--ceiba-space-2);
  font-family: var(--ceiba-font-sans);
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

.cabeceras__tabla th,
.cabeceras__tabla td {
  padding: var(--ceiba-space-1) var(--ceiba-space-2);
  border-bottom: 1px solid var(--ceiba-border);
  text-align: left;
  vertical-align: top;
  word-break: break-word;
}

.cabeceras__tabla thead th {
  font-family: var(--ceiba-font-sans);
  font-size: var(--ceiba-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ceiba-text-faint);
  font-weight: 500;
}

.cabeceras__nombre {
  width: 34%;
  color: var(--ceiba-accent);
  font-weight: 500;
}

.cabeceras__valor {
  color: var(--ceiba-text-muted);
}

.cabeceras__nota {
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}
</style>
