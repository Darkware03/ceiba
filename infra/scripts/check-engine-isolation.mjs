#!/usr/bin/env node
// CEIBA — comprobación automática del aislamiento del motor HTTP.
//
// Hace que la decisión C-25 del cliente y las reglas duras del ADR-0002 dejen
// de ser un acuerdo entre personas y pasen a ser una condición que una máquina
// verifica en cada cambio. Si alguien «sólo para depurar» le enchufa
// DATABASE_URL al motor o lo cuelga de la red de datos, CI se pone en rojo.
//
// SIN DEPENDENCIAS: sólo Node, para que corra igual en CI, en un portátil y en
// este contenedor sin Docker.
//
// USO
//   Donde SÍ hay Docker (forma canónica, usa la configuración ya resuelta):
//     docker compose -f infra/compose.yaml config --format json \
//       | node infra/scripts/check-engine-isolation.mjs
//
//   Donde NO hay Docker (lo que se hizo el 2026-10-14):
//     se convierte el YAML a JSON con un parser y se le pasa el fichero:
//     node infra/scripts/check-engine-isolation.mjs /tmp/compose.json
//
// Salida: una línea por comprobación. Código 0 si todas pasan, 1 si alguna no.

import { readFileSync } from 'node:fs'

const ENGINE = 'engine'
const DATA_SERVICES = ['postgres', 'redis']

// Variables que el motor NO puede ver. Reglas 1 y 2 del ADR-0002.
const FORBIDDEN_ENV = [
  'DATABASE_URL',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'REDIS_URL',
  'REDIS_PASSWORD',
  'CEIBA_SECRETS_MASTER_KEY',
  'CEIBA_SECRETS_KEY_PROVIDER',
  'CEIBA_JWT_SECRET',
  'CEIBA_SHARE_CODE_PEPPER',
  'CEIBA_SMTP_URL',
  'GOOGLE_APPLICATION_CREDENTIALS',
]

// Esquemas que delatan una cadena de conexión colada en cualquier variable.
const FORBIDDEN_VALUE_PATTERNS = [
  /postgres(ql)?:\/\//i,
  /redis(s)?:\/\//i,
  /mysql:\/\//i,
]

const results = []
let failed = 0

function check(ok, title, detail = '') {
  results.push({ ok, title, detail })
  if (!ok) failed++
}

// --- normalización: el YAML crudo y `docker compose config` no dan la misma forma
function envToMap(env) {
  if (!env) return {}
  if (Array.isArray(env)) {
    const out = {}
    for (const item of env) {
      const s = String(item)
      const i = s.indexOf('=')
      if (i === -1) out[s] = null
      else out[s.slice(0, i)] = s.slice(i + 1)
    }
    return out
  }
  return { ...env }
}

function netsToList(nets) {
  if (!nets) return []
  if (Array.isArray(nets)) return nets.map(String)
  return Object.keys(nets)
}

function readInput() {
  const arg = process.argv[2]
  if (arg) return readFileSync(arg, 'utf8')
  return readFileSync(0, 'utf8')
}

let doc
let raw
try {
  raw = readInput()
  doc = JSON.parse(raw)
} catch (err) {
  console.error('No se pudo leer la configuracion de compose como JSON:', err.message)
  console.error('Pasa un fichero JSON o canaliza `docker compose config --format json`.')
  process.exit(2)
}

// Entrada invalida != topologia insegura. Si llegan claves de fusion sin
// resolver, media comprobacion fallaria culpando a la topologia de un error
// de quien convirtio el YAML. Mejor parar con un diagnostico correcto.
if (raw.includes('"<<"')) {
  console.error('La configuracion trae claves de fusion "<<" SIN RESOLVER.')
  console.error('Usa `docker compose config --format json`, o un parser con la')
  console.error('opcion merge activada. Tal cual, el resultado seria enganoso.')
  process.exit(2)
}

const services = doc.services ?? {}
const networks = doc.networks ?? {}
const volumes = doc.volumes ?? {}
const engine = services[ENGINE]

if (!engine) {
  console.error(`No existe el servicio "${ENGINE}" en la configuracion.`)
  process.exit(2)
}

// ---------------------------------------------------------------------------
// 1. Sin env_file: las variables del motor se enumeran una a una.
// ---------------------------------------------------------------------------
check(
  engine.env_file === undefined ||
    (Array.isArray(engine.env_file) && engine.env_file.length === 0),
  'El motor no usa env_file',
  'Un env_file compartido arrastraria DATABASE_URL y la clave maestra al motor.',
)

// ---------------------------------------------------------------------------
// 2. Ninguna variable prohibida, ni por nombre ni por valor.
// ---------------------------------------------------------------------------
const engineEnv = envToMap(engine.environment)
const leakedNames = Object.keys(engineEnv).filter((k) => FORBIDDEN_ENV.includes(k))
check(
  leakedNames.length === 0,
  'El motor no recibe ninguna variable de base de datos ni de secretos',
  leakedNames.length ? `Variables prohibidas presentes: ${leakedNames.join(', ')}` : '',
)

const leakedValues = Object.entries(engineEnv)
  .filter(([, v]) => v != null && FORBIDDEN_VALUE_PATTERNS.some((re) => re.test(String(v))))
  .map(([k]) => k)
check(
  leakedValues.length === 0,
  'Ninguna variable del motor contiene una cadena de conexion',
  leakedValues.length ? `Sospechosas: ${leakedValues.join(', ')}` : '',
)

// ---------------------------------------------------------------------------
// 3. Aislamiento de red: el motor no comparte red con postgres ni con redis.
// ---------------------------------------------------------------------------
const engineNets = netsToList(engine.networks)
check(engineNets.length > 0, 'El motor declara sus redes explicitamente')

for (const name of DATA_SERVICES) {
  const svc = services[name]
  if (!svc) {
    check(false, `Existe el servicio "${name}"`, 'No encontrado en la configuracion.')
    continue
  }
  const shared = netsToList(svc.networks).filter((n) => engineNets.includes(n))
  check(
    shared.length === 0,
    `El motor no comparte ninguna red con "${name}"`,
    shared.length
      ? `Redes compartidas: ${shared.join(', ')}. Es la decision C-25: el motor no debe tener ni ruta hacia los datos.`
      : '',
  )
}

// ---------------------------------------------------------------------------
// 3bis. Vias INDIRECTAS. Son las que sobreviven a una revision humana.
// ---------------------------------------------------------------------------
// La mas barata de todas: `network_mode: "service:api"`. El motor pasaria a
// compartir el espacio de red de la API y alcanzaria postgres y redis por
// 127.0.0.1 — y la comprobacion de redes de arriba daria OK, porque
// `engine.networks` quedaria vacio.
check(
  engine.network_mode === undefined,
  'El motor no reutiliza el espacio de red de otro contenedor (network_mode)',
  engine.network_mode
    ? `network_mode=${engine.network_mode}: compartir red con la API le daria postgres y redis por 127.0.0.1.`
    : '',
)

for (const campo of ['links', 'extra_hosts', 'dns', 'dns_search', 'cap_add', 'devices', 'group_add']) {
  const v = engine[campo]
  const vacio =
    v === undefined ||
    (Array.isArray(v) && v.length === 0) ||
    (v && typeof v === 'object' && Object.keys(v).length === 0)
  check(vacio, `El motor no declara "${campo}"`, vacio ? '' : `Presente: ${JSON.stringify(v)}`)
}

for (const campo of ['pid', 'ipc', 'userns_mode']) {
  check(
    engine[campo] === undefined,
    `El motor no comparte "${campo}" con el host ni con otro servicio`,
    engine[campo] ? `${campo}=${engine[campo]}` : '',
  )
}

check(
  !engine.build?.secrets && !engine.build?.env_file && !engine.build?.args?.DATABASE_URL,
  'El build del motor no recibe secretos ni env_file',
  'Un secreto pasado al build queda en una capa de la imagen, aunque no se use.',
)

// ---------------------------------------------------------------------------
// 4. El motor no se publica al host.
// ---------------------------------------------------------------------------
check(
  !engine.ports || engine.ports.length === 0,
  'El motor no publica ningun puerto al host',
  'Solo la API habla con el motor, por la red interna engine_link.',
)

// ---------------------------------------------------------------------------
// 5. Nada de sockets del host montados en el motor (C-SSRF-03).
// ---------------------------------------------------------------------------
const engineMounts = (engine.volumes ?? []).map((v) =>
  typeof v === 'string' ? v : `${v.source ?? ''}:${v.target ?? ''}`,
)
const dangerous = engineMounts.filter((m) => /docker\.sock|\/var\/run|\/proc|\/sys/.test(m))
check(
  dangerous.length === 0,
  'El motor no monta sockets ni directorios sensibles del host',
  dangerous.length ? `Montajes peligrosos: ${dangerous.join(', ')}` : '',
)

// ---------------------------------------------------------------------------
// 6. Endurecimiento del proceso que ejecuta entrada hostil.
// ---------------------------------------------------------------------------
check(engine.privileged !== true, 'El motor no corre en modo privilegiado')
check(
  (engine.cap_drop ?? []).map(String).map((c) => c.toUpperCase()).includes('ALL'),
  'El motor suelta todas las capacidades (cap_drop: ALL)',
)
check(
  (engine.security_opt ?? []).some((o) => String(o).includes('no-new-privileges')),
  'El motor arranca con no-new-privileges',
)
check(engine.read_only === true, 'El motor tiene el sistema de ficheros raiz en solo lectura')

// ---------------------------------------------------------------------------
// 7. C-SSRF-10: sin proxy heredado del entorno.
// ---------------------------------------------------------------------------
const proxyVars = ['HTTP_PROXY', 'HTTPS_PROXY', 'http_proxy', 'https_proxy']
const badProxy = proxyVars.filter((v) => engineEnv[v] !== undefined && engineEnv[v] !== '')
check(
  badProxy.length === 0,
  'El motor no hereda ningun proxy HTTP del entorno (C-SSRF-10)',
  badProxy.length ? `Definidas con valor: ${badProxy.join(', ')}` : '',
)

// ---------------------------------------------------------------------------
// 8. §21: PostgreSQL y Redis no se exponen.
// ---------------------------------------------------------------------------
for (const name of DATA_SERVICES) {
  const svc = services[name]
  if (!svc) continue
  check(
    !svc.ports || svc.ports.length === 0,
    `"${name}" no publica puertos al host`,
    'El prompt maestro §21 lo prohibe expresamente.',
  )
}

// ---------------------------------------------------------------------------
// 9. Redes de datos declaradas como internas.
// ---------------------------------------------------------------------------
for (const netName of ['data', 'engine_link']) {
  const net = networks[netName]
  if (!net) {
    check(false, `Existe la red "${netName}"`)
    continue
  }
  check(net.internal === true, `La red "${netName}" es interna (sin salida a Internet)`)
}

// ---------------------------------------------------------------------------
// 10. Criterio 15 del §24: los datos sobreviven a un reinicio.
// ---------------------------------------------------------------------------
for (const [svcName, mountPath] of [
  ['postgres', '/var/lib/postgresql/data'],
  ['redis', '/data'],
]) {
  const svc = services[svcName]
  if (!svc) continue
  const mounts = (svc.volumes ?? []).map((v) =>
    typeof v === 'string' ? v : `${v.source ?? ''}:${v.target ?? ''}`,
  )
  const hit = mounts.find((m) => m.includes(mountPath))
  check(
    Boolean(hit),
    `"${svcName}" persiste en un volumen montado en ${mountPath}`,
    hit ? '' : 'Sin volumen, los datos viven en la capa de escritura y se pierden al recrear.',
  )
  if (hit) {
    const source = hit.split(':')[0]
    check(
      Boolean(volumes[source]) || Boolean(volumes[source?.replace(/^\.\//, '')]),
      `El volumen de "${svcName}" ("${source}") esta declarado como volumen con nombre`,
      'Un bind mount relativo depende del directorio de trabajo y no es portable.',
    )
  }
}

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------
console.log('Aislamiento del motor HTTP — decision C-25 y ADR-0002\n')
for (const r of results) {
  console.log(`${r.ok ? '  OK  ' : ' FALLA'}  ${r.title}`)
  if (!r.ok && r.detail) console.log(`        ${r.detail}`)
}
console.log(`\n${results.length - failed}/${results.length} comprobaciones superadas`)

if (failed > 0) {
  console.error(`\n${failed} comprobacion(es) FALLIDAS. La topologia incumple C-25 / ADR-0002.`)
  process.exit(1)
}
process.exit(0)
