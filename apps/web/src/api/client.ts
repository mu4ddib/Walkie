const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:5080';

export interface Health {
  status: string;
  schemaVersion: number;
}

export interface Me {
  id: string;
  name: string;
  email?: string | null;
}

export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(`API respondió ${status}`);
  }
}

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = init;
  const res = await fetch(`${baseUrl}${path}`, {
    ...rest,
    headers: { ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new ApiError(res.status);
  return (await res.json()) as T;
}

export function getHealth(signal?: AbortSignal): Promise<Health> {
  return request('/api/health', { signal });
}

export function getMe(token: string, signal?: AbortSignal): Promise<Me> {
  return request('/api/me', { token, signal });
}
