import { useCallback } from 'react';

export function useApi(token: string) {
  const authHeaders = useCallback((): HeadersInit => ({
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }), [token]);

  const get = useCallback(async <T>(url: string): Promise<T> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    return res.json();
  }, []);

  const post = useCallback(async <T>(url: string, body: unknown): Promise<T> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`POST ${url} failed: ${res.status}`);
    return res.json();
  }, [authHeaders]);

  const put = useCallback(async <T>(url: string, body: unknown): Promise<T> => {
    const res = await fetch(url, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`PUT ${url} failed: ${res.status}`);
    return res.json();
  }, [authHeaders]);

  const del = useCallback(async <T>(url: string): Promise<T> => {
    const res = await fetch(url, { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) throw new Error(`DELETE ${url} failed: ${res.status}`);
    return res.json();
  }, [authHeaders]);

  return { get, post, put, del, authHeaders };
}
