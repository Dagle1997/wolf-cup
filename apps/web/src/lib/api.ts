const BASE = '/api';

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  if (!path.startsWith('/')) throw new Error(`apiFetch path must start with '/': ${path}`);
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { code?: string; error?: string };
    throw new Error(body.code ?? body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}
