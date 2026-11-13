/**
 * Revisión liviana de lo que se escribe en el intercambio (spec interacciones): avisos, no errores. No es un parser
 * de SQL ni de protobuf: señala lo que suele ser un descuido (comillas o paréntesis sin cerrar, parámetros usados que
 * no se documentaron, un UPDATE o DELETE sin WHERE, nombres de gRPC inválidos) para que quien documenta lo revise.
 */

const SQL_STARTS = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'WITH',
  'MERGE',
  'UPSERT',
  'REPLACE',
  'CALL',
  'EXEC',
  'EXECUTE',
  'BEGIN',
  'DECLARE',
  'CREATE',
  'ALTER',
  'DROP',
  'TRUNCATE',
  'VALUES',
  'SET',
  'SHOW',
  'EXPLAIN',
];

/** El texto sin comentarios ni literales (para buscar palabras y paréntesis); `open` dice qué quedó sin cerrar. */
function scan(text: string): { code: string; open?: "'" | '"' | '/*' } {
  let code = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    const next = text[i + 1];
    if (c === '-' && next === '-') {
      const end = text.indexOf('\n', i);
      i = end < 0 ? text.length : end;
    } else if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) return { code, open: '/*' };
      i = end + 2;
      code += ' ';
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      for (;;) {
        if (j >= text.length) return { code, open: c };
        if (text[j] === c && text[j + 1] === c) j += 2; // comilla escapada: ''
        else if (text[j] === c) break;
        else j++;
      }
      code += c === "'" ? " '' " : ' "" ';
      i = j + 1;
    } else {
      code += c;
      i++;
    }
  }
  return { code };
}

/**
 * Avisos sobre un comando o query. `params` son los nombres documentados: un `:nombre` o `@nombre` usado que no está
 * entre ellos se señala. Solo SQL y procedimientos; un comando, ORM o descripción no se revisa.
 */
export function sqlIssues(text: string, language: string, params: readonly string[] = []): string[] {
  if ((language !== 'sql' && language !== 'procedure') || !text.trim()) return [];
  const issues: string[] = [];
  const { code, open } = scan(text);
  if (open === "'") issues.push('Hay una comilla simple sin cerrar.');
  if (open === '"') issues.push('Hay una comilla doble sin cerrar.');
  if (open === '/*') issues.push('Hay un comentario /* sin cerrar.');

  let depth = 0;
  for (const c of code) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (depth < 0) break;
  }
  if (depth > 0) issues.push('Falta cerrar un paréntesis.');
  if (depth < 0) issues.push('Sobra un paréntesis de cierre.');

  const first = /^\s*([A-Za-z]+)/.exec(code)?.[1]?.toUpperCase();
  if (language === 'sql' && first && !SQL_STARTS.includes(first)) {
    issues.push(`«${first}» no es el comienzo habitual de una sentencia SQL (SELECT, INSERT, UPDATE, DELETE…).`);
  }
  for (const statement of code.split(';')) {
    const verb = /^\s*(UPDATE|DELETE)\b/i.exec(statement)?.[1]?.toUpperCase();
    if (verb && !/\bWHERE\b/i.test(statement)) issues.push(`${verb} sin WHERE: afecta a todas las filas.`);
  }

  // `:nombre` (no `::tipo`, la conversión de PostgreSQL) y `@nombre` (no `@@variable` del sistema).
  const declared = new Set(params.map((p) => p.trim().replace(/^[:@]/, '').toLowerCase()).filter(Boolean));
  const used = [...code.matchAll(/(?<![:\w]):([A-Za-z_]\w*)|(?<![@\w])@([A-Za-z_]\w*)/g)].map((m) => ({
    shown: m[0],
    name: (m[1] ?? m[2])!.toLowerCase(),
  }));
  const missing = [...new Map(used.filter((u) => !declared.has(u.name)).map((u) => [u.name, u.shown])).values()];
  if (missing.length > 0) {
    issues.push(
      `${missing.length === 1 ? 'Parámetro usado' : 'Parámetros usados'} sin documentar: ${missing.join(', ')}. Agrégalos en «Parámetros».`,
    );
  }
  return issues;
}

/** Avisos sobre el servicio y el método de gRPC (`paquete.v1.Servicio` y `Metodo`). */
export function grpcIssues(service: string | undefined, method: string | undefined): string[] {
  const issues: string[] = [];
  if (service?.trim() && !/^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$/.test(service.trim())) {
    issues.push('El servicio gRPC va como paquete.Servicio (letras, números y _, separados por puntos).');
  }
  if (method?.trim() && !/^[A-Za-z_]\w*$/.test(method.trim())) {
    issues.push('El método gRPC es un solo nombre, sin puntos, barras ni espacios (ej. ObtenerSaldo).');
  }
  return issues;
}
