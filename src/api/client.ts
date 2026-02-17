import { API_URL } from "../env";

let getAuthHeader: (() => Promise<string | null>) | null = null;

export function setAuthHeaderProvider(fn: () => Promise<string | null>) {
  getAuthHeader = fn;
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  };

  if (getAuthHeader) {
    const auth = await getAuthHeader();
    if (auth) headers["Authorization"] = auth;
  }

  const res = await fetch(`${API_URL}${path}`, { ...init, headers });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}
