<script setup lang="ts">
/**
 * Pantalla «Configuración y colaboradores».
 *
 * Qué resuelve y por qué está escrita así:
 *
 *  - **Permisos reales, no adivinados.** `GET /workspaces/:id/collaboration`
 *    devuelve `canEdit` y `canManageMembers` junto a los miembros y las
 *    invitaciones. Deducirlos de `myRole` en el cliente es inventarse la
 *    autorización: quien decide es el servidor, que responde 403.
 *  - **Los cuatro estados de §18 están separados**: carga (el logo girando de
 *    `@ceiba/brand`, nunca un indicador propio), error con reintento, vacío
 *    confirmado y datos. Hay tres cargas independientes —lista de workspaces,
 *    colaboración y ajustes—, cada una con su error y su reintento, para que
 *    un 403 en `/settings` no deje en blanco la tabla de miembros.
 *  - **Ocupado por fila.** Revocar, quitar y cambiar rol marcan la fila en
 *    vuelo (`invitacionEnCurso` / `miembroEnCurso`) en lugar de bloquear la
 *    tabla entera.
 *  - **Los ajustes generales van por `PATCH /workspaces/:id/settings`**, que
 *    es la vía del contrato. Como esa llamada no toca el almacén, después se
 *    recarga la lista: si no, el selector seguiría mostrando el nombre viejo.
 *  - Las funciones de `@/api/studio` **sí lanzan** (lo hace `clienteApi`), así
 *    que van en `try/catch`. Las acciones del almacén **no lanzan**: devuelven
 *    `null`/`false` y dejan el motivo en `storeWorkspaces.error`.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { CeibaLoadingScreen, CeibaSpinner } from '@ceiba/brand';
import {
  actualizarConfiguracionWorkspace,
  cambiarRolColaborador,
  eliminarColaborador,
  invitarColaborador,
  listarColaboradores,
  obtenerConfiguracionWorkspace,
  revocarInvitacion,
  type InvitacionCreadaDto,
  type InvitacionDeWorkspace,
  type MiembroDeWorkspace,
  type RolColaboracion,
} from '@/api/studio';
import CeibaAviso from '@/components/ui/CeibaAviso.vue';
import CeibaBoton from '@/components/ui/CeibaBoton.vue';
import CeibaCampo from '@/components/ui/CeibaCampo.vue';
import CeibaVacio from '@/components/ui/CeibaVacio.vue';
import { RUTA_WORKSPACES } from '@/router/nombres';
import { usarAlmacenDeWorkspaces } from '@/stores/workspaces';

/**
 * El servidor que atiende hoy `GET /workspaces/:id/collaboration` responde
 * `{ workspaceId, members: { myRole, permissions, members[] }, invitations[] }`
 * (`apps/api/src/modules/studio/studio.controller.ts:84` y
 * `studio-collab.service.ts:113`), mientras que la firma de
 * `listarColaboradores()` promete la forma plana `{ currentUserRole, canEdit,
 * canManageMembers, members[], invitations[] }`. `src/api/studio.ts` no es de
 * esta vista y no se toca, así que aquí se aceptan **las dos** formas: con la
 * anidada, `members` sería un objeto y el `v-for` pintaría sus claves como si
 * fueran miembros, y los permisos quedarían en `false` para todo el mundo.
 * Queda anotado como HUECO de contrato en el informe.
 */
interface BloqueDeMiembros {
  myRole?: RolColaboracion;
  permissions?: { canEdit?: boolean; canManageMembers?: boolean };
  members?: MiembroDeWorkspace[];
}

interface RespuestaDeColaboracion {
  currentUserRole?: RolColaboracion;
  canEdit?: boolean;
  canManageMembers?: boolean;
  members?: MiembroDeWorkspace[] | BloqueDeMiembros;
  invitations?: InvitacionDeWorkspace[];
}

/** Mismo motivo: el listado real trae `invitedBy`, el tipo dice `invitedByName`. */
interface InvitacionConInvitador {
  invitedByName?: string;
  invitedBy?: { displayName?: string; email?: string } | null;
}

/**
 * Y lo mismo con `GET /workspaces/:id/settings`: el tipo
 * `ConfiguracionDeWorkspace` anida todo bajo `workspace` y nombra la retención
 * `historyRetentionDays`/`runRetentionDays`/`auditRetentionDays`, pero el
 * servidor responde plano (`{ id, name, slug, description, myRole, counts,
 * retentionPolicy: { requestHistoryDays, collectionRunsDays, auditLogsDays } }`,
 * `studio-core.service.ts:1590`). Leer `datos.workspace.name` a ciegas lanzaba
 * un TypeError en plena carga, así que se admiten las dos formas y lo que no
 * venga se pinta como «—» en vez de inventarlo.
 */
interface AjustesLaxos {
  workspace?: { id?: string; name?: string; slug?: string; description?: string | null };
  name?: string;
  slug?: string;
  description?: string | null;
  myRole?: RolColaboracion;
  currentUserRole?: RolColaboracion;
  canEdit?: boolean;
  counts?: { members?: number; collections?: number; environments?: number };
  retentionPolicy?: {
    historyRetentionDays?: number;
    runRetentionDays?: number;
    auditRetentionDays?: number;
    requestHistoryDays?: number;
    collectionRunsDays?: number;
    auditLogsDays?: number;
  };
}

interface AjustesDeVista {
  nombre: string;
  slug: string;
  descripcion: string;
  rol: RolColaboracion | null;
  puedeEditar: boolean | null;
  miembros: number | null;
  colecciones: number | null;
  entornos: number | null;
  retenciones: ReadonlyArray<{ etiqueta: string; dias: number | null }>;
}

/** Roles que se pueden conceder desde aquí: `owner` no se transfiere. */
const ROLES_ASIGNABLES = ['viewer', 'executor', 'editor', 'admin'] as const;
type RolAsignable = (typeof ROLES_ASIGNABLES)[number];

/** Caducidades ofrecidas para el enlace de invitación, en días. */
const CADUCIDADES = [1, 7, 14, 30] as const;

const storeWorkspaces = usarAlmacenDeWorkspaces();

/* --- selección --- */
const workspaceSeleccionadoId = ref<string>('');

/* --- colaboración (miembros, invitaciones y permisos) --- */
const miembros = ref<MiembroDeWorkspace[]>([]);
const invitaciones = ref<InvitacionDeWorkspace[]>([]);
const permisos = ref<{
  rol: RolColaboracion | null;
  puedeEditar: boolean;
  puedeGestionarMiembros: boolean;
} | null>(null);
const cargandoColaboracion = ref(false);
const colaboracionCargada = ref(false);
const errorColaboracion = ref<string | null>(null);

/* --- ajustes generales --- */
const ajustes = ref<AjustesDeVista | null>(null);
const cargandoAjustes = ref(false);
const errorAjustes = ref<string | null>(null);
const errorGuardado = ref<string | null>(null);
const guardandoAjustes = ref(false);
const nombreWorkspace = ref('');
const descripcionWorkspace = ref('');
const errorNombre = ref<string | null>(null);

/* --- invitación --- */
const correoInvitado = ref('');
const errorCorreo = ref<string | null>(null);
const rolInvitado = ref<RolAsignable>('editor');
const diasExpiracion = ref<number>(7);
const generandoInvitacion = ref(false);
const errorInvitacion = ref<string | null>(null);
const ultimaInvitacionCreada = ref<InvitacionCreadaDto | null>(null);
const urlCopiada = ref(false);
const avisoDeCopia = ref<string | null>(null);
let temporizadorCopia: number | null = null;

/* --- acciones por fila --- */
const invitacionEnCurso = ref<string | null>(null);
const miembroEnCurso = ref<string | null>(null);
const errorAccion = ref<string | null>(null);
const mensajeExito = ref<string | null>(null);

const primeraCargaDeLista = computed(
  () => storeWorkspaces.cargando && !storeWorkspaces.cargada,
);
const puedeGestionarMiembros = computed(
  () => permisos.value?.puedeGestionarMiembros === true,
);
const puedeEditar = computed<boolean>(
  () => permisos.value?.puedeEditar ?? ajustes.value?.puedeEditar ?? false,
);
const rolPropio = computed<RolColaboracion | null>(
  () => permisos.value?.rol ?? ajustes.value?.rol ?? null,
);
const detalleColaboracion = computed(
  () => `GET /api/v1/workspaces/${workspaceSeleccionadoId.value}/collaboration`,
);
const detalleAjustes = computed(
  () => `GET /api/v1/workspaces/${workspaceSeleccionadoId.value}/settings`,
);

function mensajeDeFallo(error: unknown, respaldo: string): string {
  return error instanceof Error && error.message.length > 0 ? error.message : respaldo;
}

function etiquetaDeRol(rol: RolColaboracion | null): string {
  switch (rol) {
    case 'owner':
      return 'Propietario';
    case 'admin':
      return 'Administrador';
    case 'editor':
      return 'Mostrar y editar';
    case 'executor':
      return 'Mostrar y ejecutar';
    case 'viewer':
      return 'Solo mostrar';
    default:
      return 'Sin rol conocido';
  }
}

function descripcionRol(rol: RolColaboracion): string {
  switch (rol) {
    case 'owner':
      return 'Propietario: control total, incluido borrar el workspace.';
    case 'admin':
      return 'Administrador: mostrar, editar y gestionar miembros e invitaciones.';
    case 'editor':
      return 'Mostrar y editar: colecciones, carpetas, peticiones y entornos.';
    case 'executor':
      return 'Mostrar y ejecutar peticiones, sin editar la estructura.';
    case 'viewer':
      return 'Solo mostrar: acceso de lectura.';
  }
}

function etiquetaDeEstado(estado: string): string {
  switch (estado) {
    case 'pending':
      return 'Pendiente';
    case 'accepted':
      return 'Aceptada';
    case 'revoked':
      return 'Revocada';
    case 'expired':
      return 'Caducada';
    default:
      return estado;
  }
}

/**
 * Una invitación por URL no lleva correo. El tipo lo declara `string`, pero
 * aquí se admite también `null`/vacío: si el servidor manda uno, pintar
 * «null» en la lista sería peor que decir lo que de verdad es.
 */
function invitadaPor(invitacion: InvitacionDeWorkspace): string {
  const laxa: InvitacionConInvitador = invitacion;
  const nombre = laxa.invitedByName ?? laxa.invitedBy?.displayName ?? laxa.invitedBy?.email ?? '';
  return nombre.trim() === '' ? 'un administrador' : nombre;
}

function destinoDeInvitacion(correo: string | null | undefined): string {
  if (correo === null || correo === undefined || correo.trim() === '') {
    return 'Enlace abierto (sin correo)';
  }
  return correo;
}

function fechaCorta(iso: string | null): string {
  if (iso === null || iso === '') return '—';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '—';
  return fecha.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function esRolAsignable(valor: string): valor is RolAsignable {
  return (ROLES_ASIGNABLES as readonly string[]).includes(valor);
}

/** Olvida todo lo que pertenece al workspace anterior al cambiar de selección. */
function reiniciarPanel(): void {
  miembros.value = [];
  invitaciones.value = [];
  permisos.value = null;
  ajustes.value = null;
  colaboracionCargada.value = false;
  errorColaboracion.value = null;
  errorAjustes.value = null;
  errorGuardado.value = null;
  errorAccion.value = null;
  errorInvitacion.value = null;
  errorCorreo.value = null;
  errorNombre.value = null;
  mensajeExito.value = null;
  ultimaInvitacionCreada.value = null;
  urlCopiada.value = false;
  avisoDeCopia.value = null;
  nombreWorkspace.value = '';
  descripcionWorkspace.value = '';
}

async function cargarColaboracion(): Promise<void> {
  const id = workspaceSeleccionadoId.value;
  if (id === '') return;
  cargandoColaboracion.value = true;
  errorColaboracion.value = null;
  try {
    const datos: RespuestaDeColaboracion = await listarColaboradores(id);
    const bloque = datos.members;
    const anidado: BloqueDeMiembros | null = Array.isArray(bloque) ? null : (bloque ?? null);
    miembros.value = Array.isArray(bloque) ? bloque : (anidado?.members ?? []);
    invitaciones.value = datos.invitations ?? [];
    permisos.value = {
      rol: datos.currentUserRole ?? anidado?.myRole ?? null,
      puedeEditar: datos.canEdit ?? anidado?.permissions?.canEdit ?? false,
      puedeGestionarMiembros:
        datos.canManageMembers ?? anidado?.permissions?.canManageMembers ?? false,
    };
    colaboracionCargada.value = true;
  } catch (error) {
    errorColaboracion.value = mensajeDeFallo(
      error,
      'No se pudieron cargar los miembros ni las invitaciones de este workspace.',
    );
  } finally {
    cargandoColaboracion.value = false;
  }
}

function normalizarAjustes(datos: AjustesLaxos): AjustesDeVista {
  const ws = datos.workspace ?? {};
  const ret = datos.retentionPolicy ?? {};
  return {
    nombre: ws.name ?? datos.name ?? '',
    slug: ws.slug ?? datos.slug ?? '',
    descripcion: ws.description ?? datos.description ?? '',
    rol: datos.currentUserRole ?? datos.myRole ?? null,
    puedeEditar: datos.canEdit ?? null,
    miembros: datos.counts?.members ?? null,
    colecciones: datos.counts?.collections ?? null,
    entornos: datos.counts?.environments ?? null,
    retenciones: [
      {
        etiqueta: 'Historial',
        dias: ret.historyRetentionDays ?? ret.requestHistoryDays ?? null,
      },
      {
        etiqueta: 'Ejecuciones',
        dias: ret.runRetentionDays ?? ret.collectionRunsDays ?? null,
      },
      {
        etiqueta: 'Auditoría',
        dias: ret.auditRetentionDays ?? ret.auditLogsDays ?? null,
      },
    ],
  };
}

function aplicarAjustes(datos: AjustesLaxos): void {
  const normalizados = normalizarAjustes(datos);
  ajustes.value = normalizados;
  nombreWorkspace.value = normalizados.nombre;
  descripcionWorkspace.value = normalizados.descripcion;
}

async function cargarAjustes(): Promise<void> {
  const id = workspaceSeleccionadoId.value;
  if (id === '') return;
  cargandoAjustes.value = true;
  errorAjustes.value = null;
  try {
    const datos: AjustesLaxos = await obtenerConfiguracionWorkspace(id);
    aplicarAjustes(datos);
  } catch (error) {
    errorAjustes.value = mensajeDeFallo(
      error,
      'No se pudieron cargar los ajustes generales de este workspace.',
    );
  } finally {
    cargandoAjustes.value = false;
  }
}

/** Las dos cargas son independientes: una puede fallar sin tumbar la otra. */
async function cargarTodo(): Promise<void> {
  await Promise.all([cargarColaboracion(), cargarAjustes()]);
}

/** Mantiene la selección dentro de la lista disponible. */
function sincronizarSeleccion(): void {
  const lista = storeWorkspaces.lista;
  const sigueExistiendo = lista.some(
    (workspace) => workspace.id === workspaceSeleccionadoId.value,
  );
  if (sigueExistiendo) return;
  workspaceSeleccionadoId.value = lista[0]?.id ?? '';
}

async function recargarLista(): Promise<void> {
  await storeWorkspaces.cargar();
  sincronizarSeleccion();
}

async function generarInvitacion(): Promise<void> {
  const id = workspaceSeleccionadoId.value;
  if (id === '') return;
  const correo = correoInvitado.value.trim();
  if (correo !== '' && !correo.includes('@')) {
    errorCorreo.value = 'Escribe un correo válido o deja el campo vacío para un enlace abierto.';
    return;
  }
  errorCorreo.value = null;
  errorInvitacion.value = null;
  mensajeExito.value = null;
  avisoDeCopia.value = null;
  generandoInvitacion.value = true;
  try {
    const creada = await invitarColaborador(id, {
      ...(correo === '' ? {} : { email: correo }),
      role: rolInvitado.value,
      expiresInDays: diasExpiracion.value,
    });
    ultimaInvitacionCreada.value = creada;
    correoInvitado.value = '';
    mensajeExito.value = 'Enlace de invitación generado.';
    await cargarColaboracion();
  } catch (error) {
    errorInvitacion.value = mensajeDeFallo(error, 'No se pudo generar la invitación.');
  } finally {
    generandoInvitacion.value = false;
  }
}

/**
 * `navigator.clipboard` no existe fuera de un contexto seguro y `writeText`
 * puede rechazar por permisos. Sin este manejo quedaba una promesa rechazada
 * sin capturar y el usuario no se enteraba de que no se había copiado nada.
 */
async function copiarUrlInvitacion(): Promise<void> {
  const invitacion = ultimaInvitacionCreada.value;
  if (invitacion === null) return;
  avisoDeCopia.value = null;
  const respaldo =
    'El navegador no ha permitido copiar automáticamente. ' +
    'Selecciona el enlace del campo de arriba y cópialo a mano.';
  const portapapeles: Clipboard | undefined = navigator.clipboard;
  if (portapapeles === undefined) {
    urlCopiada.value = false;
    avisoDeCopia.value = respaldo;
    return;
  }
  try {
    await portapapeles.writeText(invitacion.inviteUrl);
    urlCopiada.value = true;
    if (temporizadorCopia !== null) window.clearTimeout(temporizadorCopia);
    temporizadorCopia = window.setTimeout(() => {
      urlCopiada.value = false;
      temporizadorCopia = null;
    }, 2500);
  } catch {
    urlCopiada.value = false;
    avisoDeCopia.value = respaldo;
  }
}

async function revocar(invitacion: InvitacionDeWorkspace): Promise<void> {
  const id = workspaceSeleccionadoId.value;
  if (id === '' || invitacionEnCurso.value !== null) return;
  errorInvitacion.value = null;
  mensajeExito.value = null;
  invitacionEnCurso.value = invitacion.id;
  try {
    await revocarInvitacion(id, invitacion.id);
    if (ultimaInvitacionCreada.value?.id === invitacion.id) {
      ultimaInvitacionCreada.value = null;
    }
    mensajeExito.value = 'Invitación revocada.';
    await cargarColaboracion();
  } catch (error) {
    errorInvitacion.value = mensajeDeFallo(error, 'No se pudo revocar la invitación.');
  } finally {
    invitacionEnCurso.value = null;
  }
}

async function cambiarRol(miembro: MiembroDeWorkspace, evento: Event): Promise<void> {
  const destino = evento.target as HTMLSelectElement;
  const id = workspaceSeleccionadoId.value;
  const nuevoRol = destino.value;
  if (id === '' || miembro.role === 'owner' || !esRolAsignable(nuevoRol)) return;
  errorAccion.value = null;
  mensajeExito.value = null;
  miembroEnCurso.value = miembro.userId;
  try {
    await cambiarRolColaborador(id, miembro.userId, nuevoRol);
    mensajeExito.value = `Permiso de ${miembro.displayName}: ${etiquetaDeRol(nuevoRol)}.`;
    await cargarColaboracion();
  } catch (error) {
    // El <select> ya muestra el valor nuevo aunque el servidor lo rechazara:
    // devolverlo al rol real evita afirmar un cambio que no ha ocurrido.
    destino.value = miembro.role;
    errorAccion.value = mensajeDeFallo(error, 'No se pudo cambiar el permiso del miembro.');
  } finally {
    miembroEnCurso.value = null;
  }
}

async function quitar(miembro: MiembroDeWorkspace): Promise<void> {
  const id = workspaceSeleccionadoId.value;
  if (id === '' || miembro.role === 'owner' || miembroEnCurso.value !== null) return;
  errorAccion.value = null;
  mensajeExito.value = null;
  miembroEnCurso.value = miembro.userId;
  try {
    await eliminarColaborador(id, miembro.userId);
    mensajeExito.value = `${miembro.displayName} ya no tiene acceso a este workspace.`;
    await cargarColaboracion();
  } catch (error) {
    errorAccion.value = mensajeDeFallo(error, 'No se pudo quitar al miembro.');
  } finally {
    miembroEnCurso.value = null;
  }
}

async function guardarAjustes(): Promise<void> {
  const id = workspaceSeleccionadoId.value;
  if (id === '') return;
  const nombre = nombreWorkspace.value.trim();
  if (nombre === '') {
    errorNombre.value = 'El nombre del workspace no puede quedar vacío.';
    return;
  }
  errorNombre.value = null;
  errorGuardado.value = null;
  mensajeExito.value = null;
  guardandoAjustes.value = true;
  try {
    const descripcion = descripcionWorkspace.value.trim();
    await actualizarConfiguracionWorkspace(id, {
      name: nombre,
      description: descripcion === '' ? null : descripcion,
    });
    // Se relee en vez de fiarse del cuerpo del PATCH, y después se recarga la
    // lista: `PATCH /settings` no pasa por el almacén, así que sin este
    // `cargar()` el selector de arriba seguiría con el nombre anterior.
    await cargarAjustes();
    await storeWorkspaces.cargar();
    mensajeExito.value = 'Ajustes del workspace guardados.';
  } catch (error) {
    errorGuardado.value = mensajeDeFallo(error, 'No se pudieron guardar los ajustes.');
  } finally {
    guardandoAjustes.value = false;
  }
}

/**
 * Aquí no se llama a `cargarTodo()`: `sincronizarSeleccion()` cambia
 * `workspaceSeleccionadoId` de `''` al primer workspace y de eso ya se encarga
 * el `watch` de abajo. Hacer las dos cosas duplicaba cada petición de
 * colaboración y de ajustes al abrir la pantalla.
 */
onMounted(async () => {
  if (!storeWorkspaces.cargada) await storeWorkspaces.cargar();
  sincronizarSeleccion();
});

onBeforeUnmount(() => {
  if (temporizadorCopia !== null) window.clearTimeout(temporizadorCopia);
});

watch(workspaceSeleccionadoId, (nuevoId, anterior) => {
  if (nuevoId === anterior) return;
  reiniciarPanel();
  if (nuevoId !== '') void cargarTodo();
});
</script>

<template>
  <section class="vista-config" aria-labelledby="titulo-config">
    <header class="vista-config__cabecera">
      <div class="vista-config__intro">
        <p class="vista-config__migas">Trabajo colaborativo y permisos</p>
        <h1 id="titulo-config" class="vista-config__titulo">Configuración y colaboradores</h1>
        <p class="vista-config__subtitulo">
          Invita a otros usuarios por enlace o por correo y decide si pueden
          <strong>solo mostrar</strong>, <strong>ejecutar</strong> o <strong>editar</strong>.
          Quien autoriza cada acción es el servidor.
        </p>
      </div>

      <label class="vista-config__selector">
        <span class="vista-config__selector-texto">Workspace</span>
        <select
          v-model="workspaceSeleccionadoId"
          class="vista-config__select"
          :disabled="storeWorkspaces.lista.length === 0"
        >
          <option v-if="storeWorkspaces.lista.length === 0" value="">
            Sin workspaces disponibles
          </option>
          <option v-for="ws in storeWorkspaces.lista" :key="ws.id" :value="ws.id">
            {{ ws.name }}
          </option>
        </select>
      </label>
    </header>

    <!-- Estado 1: primera carga de la lista de workspaces. -->
    <div v-if="primeraCargaDeLista" class="vista-config__espera">
      <CeibaLoadingScreen
        inline
        size="md"
        message="Cargando workspaces…"
        detail="GET /api/v1/workspaces"
      />
    </div>

    <template v-else>
      <CeibaAviso
        v-if="storeWorkspaces.error !== null"
        tono="error"
        titulo="No se pudo cargar la lista de workspaces"
      >
        {{ storeWorkspaces.error }}
        <p class="vista-config__reintento">
          <CeibaBoton compacto :cargando="storeWorkspaces.cargando" @click="recargarLista">
            Reintentar
          </CeibaBoton>
        </p>
      </CeibaAviso>

      <CeibaAviso v-if="mensajeExito !== null" tono="exito" titulo="Hecho">
        {{ mensajeExito }}
      </CeibaAviso>

      <!-- Estado 2: vacío confirmado, no «todavía no se sabe». -->
      <CeibaVacio
        v-if="storeWorkspaces.estaVacia"
        titulo="Todavía no perteneces a ningún workspace"
        detalle="Los colaboradores, las invitaciones y los ajustes pertenecen a un workspace: crea
                 uno para poder configurarlo."
      >
        <RouterLink class="vista-config__enlace-accion" :to="{ name: RUTA_WORKSPACES }">
          Ir a workspaces
        </RouterLink>
      </CeibaVacio>

      <CeibaVacio
        v-else-if="workspaceSeleccionadoId === ''"
        titulo="Selecciona un workspace"
        detalle="Elige uno en el selector de la cabecera para ver sus miembros y sus ajustes."
      />

      <template v-else>
        <div class="vista-config__grid">
          <!-- ---------------------------- Invitaciones ---------------------------- -->
          <section class="vista-config__panel" aria-labelledby="titulo-invitaciones">
            <h2 id="titulo-invitaciones" class="vista-config__panel-titulo">
              Invitar colaboradores
            </h2>
            <p class="vista-config__ayuda">
              El enlace sirve para cualquier usuario registrado; con correo queda reservado a esa
              persona.
            </p>

            <div
              v-if="cargandoColaboracion && !colaboracionCargada"
              class="vista-config__espera vista-config__espera--panel"
            >
              <CeibaLoadingScreen
                inline
                size="md"
                message="Cargando colaboración…"
                :detail="detalleColaboracion"
              />
            </div>

            <CeibaAviso
              v-else-if="errorColaboracion !== null"
              tono="error"
              titulo="No se pudo cargar la colaboración"
            >
              {{ errorColaboracion }}
              <p class="vista-config__reintento">
                <CeibaBoton compacto :cargando="cargandoColaboracion" @click="cargarColaboracion">
                  Reintentar
                </CeibaBoton>
              </p>
            </CeibaAviso>

            <template v-else>
              <p v-if="cargandoColaboracion" class="vista-config__refresco">
                <CeibaSpinner size="xs" label="Actualizando colaboración" />
                <span>Actualizando datos…</span>
              </p>

              <!-- Estado 3: sin permiso, con el rol real que devuelve la API. -->
              <CeibaAviso
                v-if="!puedeGestionarMiembros"
                tono="info"
                titulo="No puedes gestionar miembros aquí"
              >
                Tu rol en este workspace es «{{ etiquetaDeRol(rolPropio) }}». Pide a un propietario
                o administrador que genere la invitación.
              </CeibaAviso>

              <form v-else class="vista-config__form" @submit.prevent="generarInvitacion">
                <CeibaCampo
                  v-model="correoInvitado"
                  etiqueta="Correo del invitado"
                  tipo="email"
                  marcador-de-posicion="colaborador@empresa.com"
                  ayuda="Opcional: déjalo vacío para un enlace abierto por URL."
                  :error="errorCorreo"
                />

                <div class="vista-config__fila">
                  <label class="vista-config__campo">
                    <span class="vista-config__campo-texto">Nivel de permiso</span>
                    <select v-model="rolInvitado" class="vista-config__select">
                      <option v-for="rol in ROLES_ASIGNABLES" :key="rol" :value="rol">
                        {{ etiquetaDeRol(rol) }}
                      </option>
                    </select>
                  </label>

                  <label class="vista-config__campo">
                    <span class="vista-config__campo-texto">Validez del enlace</span>
                    <select v-model.number="diasExpiracion" class="vista-config__select">
                      <option v-for="dias in CADUCIDADES" :key="dias" :value="dias">
                        {{ dias }} {{ dias === 1 ? 'día' : 'días' }}
                      </option>
                    </select>
                  </label>
                </div>

                <p class="vista-config__nota">{{ descripcionRol(rolInvitado) }}</p>

                <CeibaBoton tipo="submit" variante="primario" :cargando="generandoInvitacion">
                  Generar enlace de invitación
                </CeibaBoton>
              </form>

              <CeibaAviso
                v-if="errorInvitacion !== null"
                tono="error"
                titulo="La operación sobre la invitación no se aplicó"
              >
                {{ errorInvitacion }}
              </CeibaAviso>

              <div v-if="ultimaInvitacionCreada !== null" class="vista-config__url">
                <p class="vista-config__url-titulo">
                  Enlace listo · {{ etiquetaDeRol(ultimaInvitacionCreada.role) }} · caduca el
                  {{ fechaCorta(ultimaInvitacionCreada.expiresAt) }}
                </p>
                <div class="vista-config__url-fila">
                  <label class="vista-config__url-campo">
                    <span class="vista-config__oculto">Enlace de invitación</span>
                    <input
                      class="vista-config__url-input"
                      type="text"
                      readonly
                      :value="ultimaInvitacionCreada.inviteUrl"
                    />
                  </label>
                  <CeibaBoton compacto variante="primario" @click="copiarUrlInvitacion">
                    {{ urlCopiada ? '¡Enlace copiado!' : 'Copiar enlace' }}
                  </CeibaBoton>
                </div>
                <CeibaAviso
                  v-if="avisoDeCopia !== null"
                  tono="aviso"
                  titulo="Copia manual necesaria"
                >
                  {{ avisoDeCopia }}
                </CeibaAviso>
              </div>

              <h3 class="vista-config__seccion">Invitaciones ({{ invitaciones.length }})</h3>

              <ul v-if="invitaciones.length > 0" class="vista-config__lista">
                <li v-for="inv in invitaciones" :key="inv.id" class="vista-config__item">
                  <div class="vista-config__item-datos">
                    <strong class="vista-config__item-destino">
                      {{ destinoDeInvitacion(inv.email) }}
                    </strong>
                    <span class="vista-config__insignia">{{ etiquetaDeRol(inv.role) }}</span>
                    <span class="vista-config__insignia" :data-estado="inv.status">
                      {{ etiquetaDeEstado(inv.status) }}
                    </span>
                    <span class="vista-config__item-meta">
                      Invitó {{ invitadaPor(inv) }} · caduca {{ fechaCorta(inv.expiresAt) }}
                    </span>
                  </div>
                  <CeibaBoton
                    v-if="puedeGestionarMiembros && inv.status === 'pending'"
                    compacto
                    variante="peligro"
                    :cargando="invitacionEnCurso === inv.id"
                    :deshabilitado="invitacionEnCurso !== null && invitacionEnCurso !== inv.id"
                    @click="revocar(inv)"
                  >
                    Revocar
                  </CeibaBoton>
                </li>
              </ul>

              <!-- Estado 4: vacío de invitaciones, antes un <p> suelto. -->
              <CeibaVacio
                v-else
                titulo="Sin invitaciones"
                detalle="Aquí aparecerán los enlaces generados, con su estado y su caducidad."
              />
            </template>
          </section>

          <!-- ------------------------------ Miembros ------------------------------ -->
          <section class="vista-config__panel" aria-labelledby="titulo-miembros">
            <h2 id="titulo-miembros" class="vista-config__panel-titulo">
              Miembros ({{ miembros.length }})
            </h2>
            <p class="vista-config__ayuda">
              Cambia el nivel de acceso de cada colaborador o retíralo del workspace. El rol
              «Propietario» no se edita desde aquí.
            </p>

            <div
              v-if="cargandoColaboracion && !colaboracionCargada"
              class="vista-config__espera vista-config__espera--panel"
            >
              <CeibaLoadingScreen
                inline
                size="md"
                message="Cargando miembros…"
                :detail="detalleColaboracion"
              />
            </div>

            <CeibaAviso
              v-else-if="errorColaboracion !== null"
              tono="error"
              titulo="No se pudieron cargar los miembros"
            >
              {{ errorColaboracion }}
              <p class="vista-config__reintento">
                <CeibaBoton compacto :cargando="cargandoColaboracion" @click="cargarColaboracion">
                  Reintentar
                </CeibaBoton>
              </p>
            </CeibaAviso>

            <template v-else>
              <CeibaAviso
                v-if="errorAccion !== null"
                tono="error"
                titulo="La última acción no se aplicó"
              >
                {{ errorAccion }}
              </CeibaAviso>

              <CeibaAviso v-if="!puedeGestionarMiembros" tono="info" titulo="Lista en solo lectura">
                Con el rol «{{ etiquetaDeRol(rolPropio) }}» puedes ver quién colabora, pero no
                cambiar permisos ni expulsar a nadie.
              </CeibaAviso>

              <div v-if="miembros.length > 0" class="vista-config__tabla-caja">
                <table class="vista-config__tabla" :aria-busy="cargandoColaboracion">
                  <caption class="vista-config__tabla-titulo">
                    Miembros con acceso al workspace, su permiso actual y su fecha de alta.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Usuario</th>
                      <th scope="col">Permiso</th>
                      <th scope="col">Desde</th>
                      <th v-if="puedeGestionarMiembros" scope="col">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="m in miembros" :key="m.id">
                      <td>
                        <span class="vista-config__usuario">
                          <strong>{{ m.displayName }}</strong>
                          <span class="vista-config__usuario-correo">{{ m.email }}</span>
                        </span>
                      </td>
                      <td>
                        <select
                          v-if="puedeGestionarMiembros && m.role !== 'owner'"
                          class="vista-config__select"
                          :value="m.role"
                          :disabled="miembroEnCurso !== null"
                          :aria-label="`Permiso de ${m.displayName}`"
                          @change="cambiarRol(m, $event)"
                        >
                          <option v-for="rol in ROLES_ASIGNABLES" :key="rol" :value="rol">
                            {{ etiquetaDeRol(rol) }}
                          </option>
                        </select>
                        <span v-else class="vista-config__insignia">
                          {{ etiquetaDeRol(m.role) }}
                        </span>
                        <CeibaSpinner
                          v-if="miembroEnCurso === m.userId"
                          size="xs"
                          label="Aplicando el cambio de esta fila"
                          class="vista-config__giro-fila"
                        />
                      </td>
                      <td class="vista-config__celda-meta">{{ fechaCorta(m.joinedAt) }}</td>
                      <td v-if="puedeGestionarMiembros">
                        <CeibaBoton
                          v-if="m.role !== 'owner'"
                          compacto
                          variante="peligro"
                          :cargando="miembroEnCurso === m.userId"
                          :deshabilitado="miembroEnCurso !== null && miembroEnCurso !== m.userId"
                          @click="quitar(m)"
                        >
                          Quitar
                        </CeibaBoton>
                        <span v-else class="vista-config__celda-meta">—</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <!-- Estado 5: antes la tabla se quedaba muda y vacía. -->
              <CeibaVacio
                v-else
                titulo="Sin miembros que mostrar"
                detalle="La API no ha devuelto ningún miembro activo para este workspace."
              />
            </template>
          </section>
        </div>

        <!-- --------------------------- Ajustes generales --------------------------- -->
        <section class="vista-config__panel" aria-labelledby="titulo-ajustes">
          <h2 id="titulo-ajustes" class="vista-config__panel-titulo">
            Ajustes generales del workspace
          </h2>

          <div
            v-if="cargandoAjustes && ajustes === null"
            class="vista-config__espera vista-config__espera--panel"
          >
            <CeibaLoadingScreen
              inline
              size="md"
              message="Cargando ajustes…"
              :detail="detalleAjustes"
            />
          </div>

          <CeibaAviso
            v-else-if="errorAjustes !== null"
            tono="error"
            titulo="No se pudieron cargar los ajustes"
          >
            {{ errorAjustes }}
            <p class="vista-config__reintento">
              <CeibaBoton compacto :cargando="cargandoAjustes" @click="cargarAjustes">
                Reintentar
              </CeibaBoton>
            </p>
          </CeibaAviso>

          <template v-else>
            <CeibaAviso v-if="!puedeEditar" tono="info" titulo="Ajustes en solo lectura">
              Tu rol «{{ etiquetaDeRol(rolPropio) }}» no permite modificar el nombre ni la
              descripción de este workspace.
            </CeibaAviso>

            <form v-else class="vista-config__form" @submit.prevent="guardarAjustes">
              <CeibaCampo
                v-model="nombreWorkspace"
                etiqueta="Nombre del workspace"
                requerido
                :error="errorNombre"
              />
              <CeibaCampo
                v-model="descripcionWorkspace"
                etiqueta="Descripción"
                multilinea
                :filas="3"
                ayuda="Opcional. Se muestra en la lista de workspaces."
              />
              <div class="vista-config__acciones">
                <CeibaBoton tipo="submit" variante="primario" :cargando="guardandoAjustes">
                  Guardar cambios
                </CeibaBoton>
              </div>
            </form>

            <CeibaAviso
              v-if="errorGuardado !== null"
              tono="error"
              titulo="No se guardaron los cambios"
            >
              {{ errorGuardado }}
            </CeibaAviso>

            <dl v-if="ajustes !== null" class="vista-config__datos">
              <div class="vista-config__dato">
                <dt>Identificador</dt>
                <dd class="vista-config__mono">
                  {{ ajustes.slug === '' ? '—' : ajustes.slug }}
                </dd>
              </div>
              <div class="vista-config__dato">
                <dt>Miembros</dt>
                <dd>{{ ajustes.miembros ?? '—' }}</dd>
              </div>
              <div class="vista-config__dato">
                <dt>Colecciones</dt>
                <dd>{{ ajustes.colecciones ?? '—' }}</dd>
              </div>
              <div class="vista-config__dato">
                <dt>Entornos</dt>
                <dd>{{ ajustes.entornos ?? '—' }}</dd>
              </div>
              <div
                v-for="retencion in ajustes.retenciones"
                :key="retencion.etiqueta"
                class="vista-config__dato"
              >
                <dt>{{ retencion.etiqueta }}</dt>
                <dd>{{ retencion.dias === null ? '—' : `${retencion.dias} días` }}</dd>
              </div>
            </dl>
          </template>
        </section>
      </template>
    </template>
  </section>
</template>

<style scoped>
.vista-config {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-5);
  max-width: 1180px;
  width: 100%;
  margin: 0 auto;
  padding: var(--ceiba-space-5);
}

.vista-config__cabecera {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--ceiba-space-4);
  flex-wrap: wrap;
}

.vista-config__intro {
  max-width: 68ch;
}

.vista-config__migas {
  margin: 0;
  font-size: var(--ceiba-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ceiba-text-faint);
}

.vista-config__titulo {
  margin: var(--ceiba-space-1) 0;
  font-size: var(--ceiba-text-2xl);
  color: var(--ceiba-text);
}

.vista-config__subtitulo {
  margin: 0;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.vista-config__selector {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-2);
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text-muted);
}

.vista-config__select {
  padding: var(--ceiba-space-2) var(--ceiba-space-3);
  border: 1px solid var(--ceiba-border-strong);
  border-radius: var(--ceiba-radius-md);
  background: var(--ceiba-surface);
  color: var(--ceiba-text);
  font-family: var(--ceiba-font-sans);
  font-size: var(--ceiba-text-sm);
  transition: border-color var(--ceiba-duration-fast) var(--ceiba-ease);
}

.vista-config__select:hover:not(:disabled) {
  border-color: var(--ceiba-accent-dim);
}

.vista-config__select:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.vista-config__select:focus-visible,
.vista-config__url-input:focus-visible,
.vista-config__enlace-accion:focus-visible {
  outline: none;
  box-shadow: var(--ceiba-focus-ring);
  border-radius: var(--ceiba-radius-sm);
}

/* El contenedor de una espera `inline` tiene que estar posicionado: si no,
 * `CeibaLoadingScreen` se ancla al viewport y tapa la aplicación entera. */
.vista-config__espera {
  position: relative;
  min-height: 220px;
}

.vista-config__espera--panel {
  min-height: 180px;
}

.vista-config__giro-fila {
  display: inline-block;
  margin-left: var(--ceiba-space-2);
  vertical-align: middle;
}

.vista-config__refresco {
  display: flex;
  align-items: center;
  gap: var(--ceiba-space-2);
  margin: 0;
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-muted);
}

.vista-config__reintento {
  margin: var(--ceiba-space-2) 0 0;
}

.vista-config__enlace-accion {
  display: inline-flex;
  align-items: center;
  padding: var(--ceiba-space-2) var(--ceiba-space-4);
  border: 1px solid var(--ceiba-border-strong);
  border-radius: var(--ceiba-radius-md);
  background: var(--ceiba-surface-raised);
  color: var(--ceiba-text);
  font-size: var(--ceiba-text-md);
  font-weight: 500;
  text-decoration: none;
}

.vista-config__enlace-accion:hover {
  background: var(--ceiba-surface-overlay);
  border-color: var(--ceiba-accent-dim);
  text-decoration: none;
}

.vista-config__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--ceiba-space-5);
  align-items: start;
}

.vista-config__panel {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-3);
  padding: var(--ceiba-space-5);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-lg);
  background: var(--ceiba-surface);
}

.vista-config__panel-titulo {
  margin: 0;
  font-size: var(--ceiba-text-lg);
  color: var(--ceiba-text);
}

.vista-config__seccion {
  margin: var(--ceiba-space-3) 0 0;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text);
}

.vista-config__ayuda,
.vista-config__nota {
  margin: 0;
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-muted);
}

.vista-config__form {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-3);
}

.vista-config__fila {
  display: flex;
  gap: var(--ceiba-space-3);
  flex-wrap: wrap;
}

.vista-config__campo {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-1);
  flex: 1 1 14rem;
}

.vista-config__campo-texto {
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-muted);
}

.vista-config__acciones {
  display: flex;
  gap: var(--ceiba-space-2);
}

.vista-config__url {
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-2);
  padding: var(--ceiba-space-3);
  border: 1px solid var(--ceiba-accent-dim);
  border-radius: var(--ceiba-radius-md);
  background: var(--ceiba-accent-surface);
}

.vista-config__url-titulo {
  margin: 0;
  font-size: var(--ceiba-text-xs);
  font-weight: 600;
  color: var(--ceiba-text);
}

.vista-config__url-fila {
  display: flex;
  gap: var(--ceiba-space-2);
  align-items: center;
  flex-wrap: wrap;
}

.vista-config__url-campo {
  flex: 1 1 18rem;
}

.vista-config__url-input {
  width: 100%;
  padding: var(--ceiba-space-2);
  border: 1px solid var(--ceiba-border-strong);
  border-radius: var(--ceiba-radius-sm);
  background: var(--ceiba-surface);
  color: var(--ceiba-text);
  font-family: var(--ceiba-font-mono);
  font-size: var(--ceiba-text-xs);
}

/* Etiqueta sólo para lectores de pantalla: el campo tiene nombre accesible
 * sin repetir en pantalla el título que ya está encima. */
.vista-config__oculto {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.vista-config__lista {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--ceiba-space-2);
}

.vista-config__item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--ceiba-space-3);
  padding: var(--ceiba-space-2) var(--ceiba-space-3);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-md);
  background: var(--ceiba-surface-raised);
}

.vista-config__item-datos {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--ceiba-space-2);
  min-width: 0;
}

.vista-config__item-destino {
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text);
  overflow-wrap: anywhere;
}

.vista-config__item-meta,
.vista-config__celda-meta {
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
}

.vista-config__insignia {
  display: inline-block;
  padding: var(--ceiba-space-1) var(--ceiba-space-2);
  border: 1px solid var(--ceiba-border);
  border-radius: var(--ceiba-radius-pill);
  background: var(--ceiba-surface-raised);
  color: var(--ceiba-text-muted);
  font-size: var(--ceiba-text-xs);
  white-space: nowrap;
}

/* No hay tokens de fondo teñido por estado: el color lo lleva el texto sobre
 * la superficie elevada, que sí funciona en tema claro y oscuro. */
.vista-config__insignia[data-estado='pending'] {
  color: var(--ceiba-warning);
}

.vista-config__insignia[data-estado='accepted'] {
  color: var(--ceiba-success);
}

.vista-config__insignia[data-estado='revoked'],
.vista-config__insignia[data-estado='expired'] {
  color: var(--ceiba-danger);
}

.vista-config__tabla-caja {
  overflow-x: auto;
}

.vista-config__tabla {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text);
}

.vista-config__tabla-titulo {
  caption-side: bottom;
  padding-top: var(--ceiba-space-2);
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
  text-align: left;
}

.vista-config__tabla th,
.vista-config__tabla td {
  padding: var(--ceiba-space-2);
  border-bottom: 1px solid var(--ceiba-border);
  text-align: left;
  vertical-align: middle;
}

.vista-config__tabla th {
  font-size: var(--ceiba-text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ceiba-text-muted);
}

.vista-config__usuario {
  display: flex;
  flex-direction: column;
}

.vista-config__usuario-correo {
  font-size: var(--ceiba-text-xs);
  color: var(--ceiba-text-faint);
  overflow-wrap: anywhere;
}

.vista-config__datos {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: var(--ceiba-space-3);
  margin: var(--ceiba-space-2) 0 0;
  padding-top: var(--ceiba-space-3);
  border-top: 1px solid var(--ceiba-border);
}

.vista-config__dato dt {
  font-size: var(--ceiba-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ceiba-text-faint);
}

.vista-config__dato dd {
  margin: var(--ceiba-space-1) 0 0;
  font-size: var(--ceiba-text-sm);
  color: var(--ceiba-text);
}

.vista-config__mono {
  font-family: var(--ceiba-font-mono);
}

@media (max-width: 900px) {
  .vista-config__grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 600px) {
  .vista-config {
    padding: var(--ceiba-space-4) var(--ceiba-space-3);
  }

  .vista-config__panel {
    padding: var(--ceiba-space-4);
  }

  .vista-config__item {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
