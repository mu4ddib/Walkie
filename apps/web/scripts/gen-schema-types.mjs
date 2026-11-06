// Genera src/schema/walkie-graph.ts desde packages/schema (fuente de verdad).
// Uso: pnpm gen:schema       -> escribe el archivo
//      pnpm check:schema     -> falla si el archivo no está al día (CI)
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compile } from 'json-schema-to-typescript';

const schemaPath = fileURLToPath(new URL('../../../packages/schema/walkie-graph.schema.json', import.meta.url));
const outPath = fileURLToPath(new URL('../src/schema/walkie-graph.ts', import.meta.url));

const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
const ts = await compile(schema, 'WalkieGraph', {
  bannerComment:
    '/* Generado desde packages/schema/walkie-graph.schema.json. No editar a mano: `pnpm gen:schema`. */',
  additionalProperties: false,
  style: { singleQuote: true },
});

if (process.argv.includes('--check')) {
  const current = await readFile(outPath, 'utf8').catch(() => '');
  if (current !== ts) {
    console.error('src/schema/walkie-graph.ts está desactualizado. Ejecuta `pnpm gen:schema`.');
    process.exit(1);
  }
  console.log('Tipos del schema al día.');
} else {
  await writeFile(outPath, ts);
  console.log(`Escrito ${outPath}`);
}
