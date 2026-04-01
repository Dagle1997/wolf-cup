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

export async function apiFetchFormData<T>(path: string, formData: FormData, headers?: Record<string, string>): Promise<T> {
  if (!path.startsWith('/')) throw new Error(`apiFetch path must start with '/': ${path}`);
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    body: formData,
    // Do not set Content-Type — browser sets multipart/form-data with boundary
    ...(headers ? { headers } : {}),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { code?: string; error?: string };
    throw new Error(body.code ?? body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}
