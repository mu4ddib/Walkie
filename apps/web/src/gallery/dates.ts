const format = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });

/** Fecha corta en español, ej. "8 nov 2026". */
export const shortDate = (iso: string) => format.format(new Date(iso));

/** La más reciente de las fechas ISO dadas (ignora las vacías). */
export const latest = (...dates: (string | undefined)[]) =>
  dates.filter((d): d is string => !!d).reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
