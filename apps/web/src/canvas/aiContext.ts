/** Tokens aproximados de un texto (≈ 4 caracteres por token en un modelo de lenguaje). */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
