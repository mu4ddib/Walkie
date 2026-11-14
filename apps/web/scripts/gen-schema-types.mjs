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
  { schema: 'walkie-operations.schema.json', out: 'walkie-operations-catalog.ts', name: 'WalkieOperationsCatalog' },
  { schema: 'walkie-module-summary.schema.json', out: 'walkie-module-summary.ts', name: 'WalkieModuleSummary' },
  { schema: 'walkie-share.schema.json', out: 'walkie-share.ts', name: 'WalkieShare' },
  { schema: 'walkie-app-map.schema.json', out: 'walkie-app-map.ts', name: 'WalkieAppMap' },
  // .walkiepack (spec walkie-live, ADR-0013). Sin `imports`: declaran los `$defs` del grafo y del discovery que usan.
  { schema: 'walkie-discovery.schema.json', out: 'walkie-discovery.ts', name: 'WalkieDiscovery' },
  { schema: 'walkie-discovery-pack.schema.json', out: 'walkie-discovery-pack.ts', name: 'WalkieDiscoveryPack' },
  // Usa `$ref` a otros schemas: sus tipos se importan de su propio archivo en vez de repetirse.
  {
    schema: 'walkie-shared-feature.schema.json',
    out: 'walkie-shared-feature.ts',
    name: 'WalkieSharedFeature',
    imports: [
      "import type { WalkieCanvasGraphV0 } from './walkie-graph';",
      "import type { WalkieCatalogItemV0 } from './walkie-catalog-item';",
      "import type { WalkieModuleSummaryV0 } from './walkie-module-summary';",
    ],
  },
  {
    schema: 'walkie-shared-module.schema.json',
    out: 'walkie-shared-module.ts',
    name: 'WalkieSharedModule',
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

// Datos (no solo tipos): el catálogo de operaciones de las conexiones (spec interacciones, ADR-0011), la misma fuente
// que embebe la API. Se escribe con su tipo y los datos tal cual, para que la web no repita nada.
{
  const dataPath = fileURLToPath(new URL('../../../packages/schema/walkie-operations.json', import.meta.url));
  const outPath = fileURLToPath(new URL('../src/schema/walkie-operations.ts', import.meta.url));
  const data = JSON.parse(await readFile(dataPath, 'utf8'));
  delete data.$schema;
  const banner =
    '/* Generado desde packages/schema/walkie-operations.json. No editar a mano: `pnpm gen:schema`. */\n' +
    "import type { WalkieOperationsCatalog } from './walkie-operations-catalog';\n\n";
  const ts = `${banner}export const WALKIE_OPERATIONS: WalkieOperationsCatalog = ${JSON.stringify(data, null, 2)};\n`;
  if (check) {
    const current = await readFile(outPath, 'utf8').catch(() => '');
    if (current !== ts) {
      console.error('src/schema/walkie-operations.ts está desactualizado. Ejecuta `pnpm gen:schema`.');
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
