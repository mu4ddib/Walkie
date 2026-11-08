const day = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric' });
const dayAndTime = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** "8 de diciembre de 2026" (hora local del navegador). */
export const formatDay = (iso: string) => day.format(new Date(iso));

/** "8 de diciembre de 2026, 15:04". */
export const formatDayAndTime = (iso: string) => dayAndTime.format(new Date(iso));
