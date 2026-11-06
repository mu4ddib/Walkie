const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:5080';

export interface Health {
  status: string;
  schemaVersion: number;
}

export async function getHealth(signal?: AbortSignal): Promise<Health> {
  const res = await fetch(`${baseUrl}/api/health`, { signal });
  if (!res.ok) throw new Error(`API respondió ${res.status}`);
  return (await res.json()) as Health;
}
