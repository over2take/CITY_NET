import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useApi } from '../useApi';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const ok = (body: unknown) =>
  Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response);
const fail = (status: number) =>
  Promise.resolve({ ok: false, status, json: () => Promise.resolve({}) } as Response);

beforeEach(() => mockFetch.mockReset());

describe('useApi', () => {
  describe('authHeaders', () => {
    it('includes Authorization header when token is provided', () => {
      const { result } = renderHook(() => useApi('my-token'));
      const headers = result.current.authHeaders() as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer my-token');
    });

    it('omits Authorization header when token is empty string', () => {
      const { result } = renderHook(() => useApi(''));
      const headers = result.current.authHeaders() as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });

    it('always includes Content-Type application/json', () => {
      const { result } = renderHook(() => useApi('tok'));
      const headers = result.current.authHeaders() as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
    });
  });

  describe('get', () => {
    it('calls fetch with the correct URL and returns parsed JSON', async () => {
      mockFetch.mockReturnValue(ok({ id: 1 }));
      const { result } = renderHook(() => useApi('tok'));
      const data = await result.current.get<{ id: number }>('/api/test');
      expect(mockFetch).toHaveBeenCalledWith('/api/test');
      expect(data).toEqual({ id: 1 });
    });

    it('throws when response is not ok', async () => {
      mockFetch.mockReturnValue(fail(404));
      const { result } = renderHook(() => useApi('tok'));
      await expect(result.current.get('/api/missing')).rejects.toThrow('404');
    });
  });

  describe('post', () => {
    it('sends POST with JSON body and auth header', async () => {
      mockFetch.mockReturnValue(ok({ created: true }));
      const { result } = renderHook(() => useApi('tok'));
      const data = await result.current.post('/api/items', { name: 'x' });
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/items');
      expect(opts.method).toBe('POST');
      expect(opts.body).toBe(JSON.stringify({ name: 'x' }));
      expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
      expect(data).toEqual({ created: true });
    });

    it('throws when response is not ok', async () => {
      mockFetch.mockReturnValue(fail(500));
      const { result } = renderHook(() => useApi('tok'));
      await expect(result.current.post('/api/items', {})).rejects.toThrow('500');
    });
  });

  describe('put', () => {
    it('sends PUT with JSON body and auth header', async () => {
      mockFetch.mockReturnValue(ok({ updated: true }));
      const { result } = renderHook(() => useApi('tok'));
      await result.current.put('/api/items/1', { name: 'y' });
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/items/1');
      expect(opts.method).toBe('PUT');
      expect(opts.body).toBe(JSON.stringify({ name: 'y' }));
    });

    it('throws when response is not ok', async () => {
      mockFetch.mockReturnValue(fail(403));
      const { result } = renderHook(() => useApi('tok'));
      await expect(result.current.put('/api/items/1', {})).rejects.toThrow('403');
    });
  });

  describe('del', () => {
    it('sends DELETE with auth header', async () => {
      mockFetch.mockReturnValue(ok({ deleted: true }));
      const { result } = renderHook(() => useApi('tok'));
      const data = await result.current.del('/api/items/1');
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/items/1');
      expect(opts.method).toBe('DELETE');
      expect((opts.headers as Record<string, string>)['Authorization']).toBe('Bearer tok');
      expect(data).toEqual({ deleted: true });
    });

    it('throws when response is not ok', async () => {
      mockFetch.mockReturnValue(fail(401));
      const { result } = renderHook(() => useApi('tok'));
      await expect(result.current.del('/api/items/1')).rejects.toThrow('401');
    });
  });
});
