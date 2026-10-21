#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Guarda de compilación: el cliente Prisma generado TIENE que existir.
//
// Desde la fase 4 `src/platform/persistence/prisma/prisma-client.ts` toma los
// tipos de `prisma/generated/client` (opción (b) del BRIEF-FASE4 §3.A.1): es la
// fuente real y no se puede desincronizar del esquema. El precio, declarado, es
// que `prisma/generated/` está en `.gitignore`, así que en un árbol recién
// clonado **no existe** y `tsc` fallaría con un error de resolución de módulo
// que no dice nada útil.
//
// Esto falla cerrado y con el comando exacto. NO genera el cliente por su
// cuenta: `prisma/` es ámbito del `database-engineer` y generar es escribir
// allí.
// ---------------------------------------------------------------------------
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const raizRepo = resolve(aqui, '../../..');

// Las mismas dos disposiciones que contempla `rutasCandidatasDelCliente()`:
// árbol de desarrollo y copia de la imagen de producción.
const candidatas = [
  resolve(raizRepo, 'prisma/generated/client/index.d.ts'),
  resolve(aqui, '../prisma/generated/client/index.d.ts'),
];

const encontrada = candidatas.find((ruta) => existsSync(ruta));

if (encontrada === undefined) {
  process.stderr.write(
    '\n[CEIBA API] El cliente Prisma generado no está.\n\n' +
      'Rutas probadas:\n' +
      candidatas.map((r) => `  - ${r}\n`).join('') +
      '\nGenéralo desde la raíz del repositorio:\n\n' +
      '  pnpm exec prisma generate --config prisma/prisma.config.ts\n\n' +
      'Sin él, `apps/api` no compila: los tipos de la fachada de persistencia\n' +
      'salen de ahí a propósito, para que no se desincronicen del esquema.\n\n',
  );
  process.exit(1);
}

process.stdout.write(`cliente Prisma presente: ${encontrada}\n`);
