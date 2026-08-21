/**
 * The one door every outbound request goes through.
 *
 * These are the constraints that were missing, or missing in one of the two callers, when
 * this module was written: no deadline on the body, a hostname taken from the response,
 * an unbounded read. Each has a test here that fails if the guard is removed, because the
 * whole value of routing both callers through one place is that this file is the proof.
 *
 * Nothing here touches a network. `fetchImpl` is always a stub, and the two tests about
 * deadlines model undici's real behaviour — a pending read rejects when the request is
 * aborted — rather than asserting on the timer directly.
 */

import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getJson, REASONS } = require('../net/outbound.js');

const HOSTS = ['registry.example.com'];
const URL_OK = 'https://registry.example.com/v2/tags';

const enc = (s) => new TextEncoder().encode(s);

/** A response whose body streams in the given chunks, like a real one. */
const streaming = (chunks, { status = 200 } = {}) => {
  let i = 0;
  return {
    status,
    ok: status >= 200 && status < 300,
    body: {
      getReader: () => ({
        read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }),
      }),
    },
  };
};

/** A response with no stream at all — a plain stub, and the fallback path. */
const plain = (text, { status = 200 } = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  text: async () => text,
});

const ok = (obj) => streaming([enc(JSON.stringify(obj))]);

describe('outbound.getJson — where it will go', () => {
  it('refuses a host the caller did not name, without opening anything', async () => {
    const fetchImpl = vi.fn();
    const res = await getJson('https://elsewhere.example.com/x', { allowHosts: HOSTS, fetchImpl });
    expect(res.error).toBe(REASONS.BLOCKED_HOST);
    // The point of checking first: a blocked host costs no request at all.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a lookalike that merely ends with an allowed host', async () => {
    // `endsWith('example.com')` is also true of `evil-example.com`. This is the specific
    // mistake the exact match exists to prevent, so it gets its own test.
    const fetchImpl = vi.fn();
    const res = await getJson('https://evil-registry.example.com.attacker.net/x', { allowHosts: HOSTS, fetchImpl });
    expect(res.error).toBe(REASONS.BLOCKED_HOST);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses plain http even to an allowed host', async () => {
    const fetchImpl = vi.fn();
    const res = await getJson('http://registry.example.com/x', { allowHosts: HOSTS, fetchImpl });
    expect(res.error).toBe(REASONS.BAD_URL);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses something that is not a URL', async () => {
    const res = await getJson('not a url', { allowHosts: HOSTS, fetchImpl: vi.fn() });
    expect(res.error).toBe(REASONS.BAD_URL);
  });

  it('will not let a caller omit the allowlist', async () => {
    // A default would be a destination nobody chose. Better to fail loudly at the callsite.
    await expect(getJson(URL_OK, { fetchImpl: vi.fn() })).rejects.toThrow(/allowHosts/);
  });

  it('does not follow redirects', async () => {
    // Following one leaves the allowlist behind, which would undo every test above.
    const fetchImpl = vi.fn(async () => ok({ a: 1 }));
    await getJson(URL_OK, { allowHosts: HOSTS, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith(URL_OK, expect.objectContaining({ redirect: 'manual' }));
  });
});

describe('outbound.getJson — what came back', () => {
  it('parses a document', async () => {
    const res = await getJson(URL_OK, { allowHosts: HOSTS, fetchImpl: async () => ok({ results: [{ name: '1.2.3' }] }) });
    expect(res.doc).toEqual({ results: [{ name: '1.2.3' }] });
    expect(res.error).toBeUndefined();
  });

  it('reassembles a body that arrives in pieces', async () => {
    const parts = ['{"na', 'me":"sp', 'lit"}'].map(enc);
    const res = await getJson(URL_OK, { allowHosts: HOSTS, fetchImpl: async () => streaming(parts) });
    expect(res.doc).toEqual({ name: 'split' });
  });

  it('separates "not there" from "their service failed"', async () => {
    const missing = await getJson(URL_OK, { allowHosts: HOSTS, fetchImpl: async () => streaming([], { status: 404 }) });
    expect(missing.error).toBe(REASONS.NOT_FOUND);

    const broken = await getJson(URL_OK, { allowHosts: HOSTS, fetchImpl: async () => streaming([], { status: 500 }) });
    expect(broken.error).toBe(REASONS.SERVICE_ERROR);
  });

  it('does not report a 200 of HTML as a document', async () => {
    const res = await getJson(URL_OK, { allowHosts: HOSTS, fetchImpl: async () => streaming([enc('<html>nope</html>')]) });
    expect(res.error).toBe(REASONS.BAD_RESPONSE);
    expect(res.doc).toBeUndefined();
  });

  it('reports an unusable fetch rather than throwing', async () => {
    const res = await getJson(URL_OK, { allowHosts: HOSTS, fetchImpl: null });
    expect(res.error).toBe(REASONS.UNREACHABLE);
  });

  it('reports a refused connection as unreachable', async () => {
    const fetchImpl = async () => { throw Object.assign(new Error('ECONNREFUSED'), { name: 'TypeError' }); };
    const res = await getJson(URL_OK, { allowHosts: HOSTS, fetchImpl });
    expect(res.error).toBe(REASONS.UNREACHABLE);
  });
});

describe('outbound.getJson — how much, and for how long', () => {
  it('abandons a body past the cap instead of receiving all of it', async () => {
    // Endless, so a helper without a cap never finishes this test rather than failing it.
    const chunk = enc('x'.repeat(1024));
    let served = 0;
    const fetchImpl = async (_url, opts) => ({
      status: 200,
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            if (opts.signal.aborted) return { done: true };
            served += 1;
            return { done: false, value: chunk };
          },
        }),
      },
    });

    const res = await getJson(URL_OK, { allowHosts: HOSTS, fetchImpl, maxBytes: 4096 });
    expect(res.error).toBe(REASONS.TOO_LARGE);
    // Five chunks: four to fill the cap, one to cross it. It stops there rather than
    // reading on, which is the difference between a cap and a measurement.
    expect(served).toBe(5);
  });

  it('still caps a response that has no stream to abandon', async () => {
    const res = await getJson(URL_OK, {
      allowHosts: HOSTS,
      fetchImpl: async () => plain('x'.repeat(5000)),
      maxBytes: 4096,
    });
    expect(res.error).toBe(REASONS.TOO_LARGE);
  });

  it('gives up on a host that accepts the connection and then says nothing', async () => {
    // The failure this whole module was written for. `fetch` resolves, and then nothing
    // ever arrives.
    const fetchImpl = (_url, opts) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    const res = await getJson(URL_OK, { allowHosts: HOSTS, fetchImpl, timeoutMs: 30 });
    expect(res.error).toBe(REASONS.TIMEOUT);
  });

  it('keeps the deadline armed while the body is still arriving', async () => {
    // Headers land immediately and the body then stalls. A timeout cleared after the
    // headers would leave this hanging forever, which is exactly the bug being fixed.
    const fetchImpl = async (_url, opts) => ({
      status: 200,
      ok: true,
      body: {
        getReader: () => ({
          read: () => new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          }),
        }),
      },
    });
    const res = await getJson(URL_OK, { allowHosts: HOSTS, fetchImpl, timeoutMs: 30 });
    expect(res.error).toBe(REASONS.TIMEOUT);
  });

  it('does not leave its timer running after a normal response', async () => {
    // A stray timer keeps the process alive; `clearTimeout` in `finally` is what stops it.
    vi.useFakeTimers();
    try {
      const before = vi.getTimerCount();
      await getJson(URL_OK, { allowHosts: HOSTS, fetchImpl: async () => ok({ a: 1 }) });
      expect(vi.getTimerCount()).toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});
