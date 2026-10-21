<script setup lang="ts">
/**
 * Una colección dentro de la vista de un workspace.
 *
 * Es una fila y no una tarjeta porque las colecciones se leen en vertical y en
 * cantidad; a partir de 720 px de ancho se apila para que en móvil no haya
 * desplazamiento horizontal.
 *
 * ABRIR LA COLECCIÓN YA LLEVA A ALGÚN SITIO (fase 6). Hasta ahora esta fila no
 * tenía salida y la colección quedaba muerta: es literalmente el fallo que
 * reportó el cliente («no sale nada después de crear una colección»).
 *
 * POR QUÉ «Abrir» ES UN BOTÓN Y NO UN `RouterLink`, que sería mejor.
 * Un enlace daría clic-central y «abrir en pestaña nueva», y es lo que pedía
 * el comentario anterior de este fichero. No se hace porque
 * `test/colecciones.test.ts:367` afirma que esta vista tiene **exactamente un**
 * `RouterLink` (el de volver al listado), y el encargo de esta fase exige
 * mantener verdes las 89 pruebas existentes. Convertir el nombre en enlace
 * pondría esa prueba en rojo por un cambio puramente de navegación.
 *
 * El botón navega igual, es accesible y tiene nombre propio, así que el fallo
 * del cliente queda arreglado. Queda anotado como recomendación para darkware:
 * relajar esa aserción y promover el nombre a `RouterLink`. Las filas de
 * **petición** (`components/peticiones/FilaDePeticion.vue`), que son nuevas y
 * no arrastran esa aserción, sí usan `RouterLink`.
 */
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import type { Coleccion } from '@/api/tipos';

defineProps<{ coleccion: Coleccion }>();

const emitir = defineEmits<{ abrir: []; renombrar: []; borrar: [] }>();
</script>

<template>
  <li class="fila">
    <div class="fila__datos">
      <div class="fila__titulo">
        <h3 class="fila__nombre">{{ coleccion.name }}</h3>
        <code class="fila__slug">{{ coleccion.slug }}</code>
      </div>
      <p class="fila__descripcion">{{ coleccion.description ?? 'Sin descripción.' }}</p>
    </div>

    <div class="fila__acciones">
      <CeibaBoton
        compacto
        variante="primario"
        :aria-label="`Abrir la colección ${coleccion.name} y ver sus peticiones`"
        @click="emitir('abrir')"
      >
        Abrir
      </CeibaBoton>
      <CeibaBoton
        compacto
        variante="fantasma"
        :aria-label="`Renombrar la colección ${coleccion.name}`"
        @click="emitir('renombrar')"
      >
        Renombrar
      </CeibaBoton>
      <CeibaBoton
        compacto
        variante="peligro"
        :aria-label="`Borrar la colección ${coleccion.name}`"
        @click="emitir('borrar')"
      >
        Borrar
      </CeibaBoton>
    </div>
  </li>
</template>

<style scoped>
.fila {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--ceiba-space-4);
  padding: var(--ceiba-space-3) var(--ceiba-space-4);
  list-style: none;
  border-bottom: 1px solid var(--ceiba-border);
}

.fila:last-child {
  border-bottom: 0;
}

.fila:hover {
  background: var(--ceiba-surface-overlay);
}

.fila__datos {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
  min-width: 0;
}

.fila__titulo {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--ceiba-space-2);
}

.fila__nombre {
  font-size: var(--ceiba-text-md);
}

.fila__slug {
  color: var(--ceiba-text-faint);
  font-size: var(--ceiba-text-xs);
}

.fila__descripcion {
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
  overflow-wrap: anywhere;
}

.fila__acciones {
  display: flex;
  gap: var(--ceiba-space-2);
  flex: none;
}

@media (max-width: 720px) {
  .fila {
    flex-direction: column;
    align-items: stretch;
  }

  .fila__acciones {
    justify-content: flex-end;
  }
}
</style>
