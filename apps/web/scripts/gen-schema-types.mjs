// Genera src/schema/*.ts desde packages/schema (fuente de verdad).
// Uso: pnpm gen:schema       -> escribe los archivos
//      pnpm check:schema     -> falla si alguno no está al día (CI)
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

/** Un schema de packages/schema -> un archivo de src/schema, con el nombre del tipo raíz. */
const targets = [
  { schema: 'walkie-graph.schema.json', out: 'walkie-graph.ts', name: 'WalkieGraph' },
  // `http` y `database` son los del grafo (`$ref`): la definición compartida es la misma estructura.
  {
    schema: 'walkie-catalog-item.schema.json',
    out: 'walkie-catalog-item.ts',
    name: 'WalkieCatalogItem',
    imports: ["import type { Database, Http, Resource } from './walkie-graph';"],
  },
  { schema: 'walkie-asset.schema.json', out: 'walkie-asset.ts', name: 'WalkieAsset' },
  { schema: 'walkie-package.schema.json', out: 'walkie-package.ts', name: 'WalkiePackage' },
  { schema: 'walkie-import-summary.schema.json', out: 'walkie-import-summary.ts', name: 'WalkieImportSummary' },
  {
    schema: 'walkie-ai-context.schema.json',
    out: 'walkie-ai-context.ts',
    // Sin `imports`: así declara sus propios `$defs` (component, connection, flow) y los del grafo que usa.
    name: 'WalkieAiContext',
  },
  {
    schema: 'walkie-app-ai-context.schema.json',
    out: 'walkie-app-ai-context.ts',
    name: 'WalkieAppAiContext',
    imports: [
      "import type { Database, Http, Resource } from './walkie-graph';",
      "import type { WalkieAIContextV0 } from './walkie-ai-context';",
    ],
  },
  { schema: 'walkie-share.schema.json', out: 'walkie-share.ts', name: 'WalkieShare' },
  { schema: 'walkie-app-map.schema.json', out: 'walkie-app-map.ts', name: 'WalkieAppMap' },
  // Usa `$ref` a otros schemas: sus tipos se importan de su propio archivo en vez de repetirse.
  {
    schema: 'walkie-shared-feature.schema.json',
    out: 'walkie-shared-feature.ts',
    name: 'WalkieSharedFeature',
    imports: [
      "import type { WalkieCanvasGraphV0 } from './walkie-graph';",
      "import type { WalkieCatalogItemV0 } from './walkie-catalog-item';",
    ],
  },
];

const check = process.argv.includes('--check');
let stale = false;

for (const target of targets) {
  const schemaPath = fileURLToPath(new URL(`../../../packages/schema/${target.schema}`, import.meta.url));
  const outPath = fileURLToPath(new URL(`../src/schema/${target.out}`, import.meta.url));
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
  const banner = `/* Generado desde packages/schema/${target.schema}. No editar a mano: \`pnpm gen:schema\`. */`;
  const ts = await compile(schema, target.name, {
    bannerComment: [banner, ...(target.imports ?? [])].join('\n'),
    additionalProperties: false,
    cwd: fileURLToPath(new URL('../../../packages/schema/', import.meta.url)),
    declareExternallyReferenced: !target.imports,
    style: { singleQuote: true },
  });

  if (check) {
    const current = await readFile(outPath, 'utf8').catch(() => '');
    if (current !== ts) {
      console.error(`src/schema/${target.out} está desactualizado. Ejecuta \`pnpm gen:schema\`.`);
      stale = true;
    }
  } else {
    await writeFile(outPath, ts);
    console.log(`Escrito ${outPath}`);
  }
}

if (check) {
  if (stale) process.exit(1);
  console.log('Tipos del schema al día.');
}
