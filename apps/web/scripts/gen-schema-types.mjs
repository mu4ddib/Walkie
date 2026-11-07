// Genera src/schema/*.ts desde packages/schema (fuente de verdad).
// Uso: pnpm gen:schema       -> escribe los archivos
//      pnpm check:schema     -> falla si alguno no está al día (CI)
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

/** Un schema de packages/schema -> un archivo de src/schema, con el nombre del tipo raíz. */
const targets = [
  { schema: 'walkie-graph.schema.json', out: 'walkie-graph.ts', name: 'WalkieGraph' },
  { schema: 'walkie-catalog-item.schema.json', out: 'walkie-catalog-item.ts', name: 'WalkieCatalogItem' },
  { schema: 'walkie-asset.schema.json', out: 'walkie-asset.ts', name: 'WalkieAsset' },
];

const check = process.argv.includes('--check');
let stale = false;

for (const target of targets) {
  const schemaPath = fileURLToPath(new URL(`../../../packages/schema/${target.schema}`, import.meta.url));
  const outPath = fileURLToPath(new URL(`../src/schema/${target.out}`, import.meta.url));
  const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
  const ts = await compile(schema, target.name, {
    bannerComment: `/* Generado desde packages/schema/${target.schema}. No editar a mano: \`pnpm gen:schema\`. */`,
    additionalProperties: false,
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
