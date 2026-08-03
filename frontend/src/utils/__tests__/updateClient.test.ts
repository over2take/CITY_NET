import { describe, it, expect, vi, afterEach } from 'vitest';
import { hasModernUpdater, startUpdate, currentBootId, MANUAL_COMMAND } from '../updateClient';

/**
 * The shared update client.
 *
 * It exists because there were two implementations — the update modal and the nav panel
 * — and only the modal's was hardened. The panel, which is the button the upgrade guide
 * points people at, still had no deadline and still ignored the server's refusal, so the
 * original reported bug survived in the path most people use.
 */

const stubFetch = (impl: (url: string, opts?: any) => any) => vi.stubGlobal('fetch', vi.fn(impl));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('hasModernUpdater', () => {
  it('accepts a server that reports an update phase', () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ phase: 'idle' }) }));
    return expect(hasModernUpdater()).resolves.toBe(true);
  });

  it('rejects a server with no status route', () => {
    stubFetch(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    return expect(hasModernUpdater()).resolves.toBe(false);
  });

  it('rejects an index.html fallback answering 200 with a page', () => {
    // A status-code check alone would read that as "this server has the new updater".
    stubFetch(async () => ({ ok: true, json: async () => { throw new Error('not json'); } }));
    return expect(hasModernUpdater()).resolves.toBe(false);
  });

  it('rejects a server that cannot be reached', () => {
    stubFetch(async () => { throw new Error('offline'); });
    return expect(hasModernUpdater()).resolves.toBe(false);
  });
});

describe('startUpdate', () => {
  it('refuses to post to a container that cannot update itself', async () => {
    // Such a container answers "Update started" and does nothing, so asking first is the
    // difference between an immediate answer and a six-minute wait.
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/api/update/status')) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, json: async () => ({}) };
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await startUpdate('t');
    expect(res.ok).toBe(false);
    expect(res.command).toBe(MANUAL_COMMAND);

    const posted = fetchMock.mock.calls.some(([u, o]: any[]) => String(u).endsWith('/api/update') && o?.method === 'POST');
    expect(posted).toBe(false);
  });

  it('passes the server refusal through verbatim', async () => {
    stubFetch(async (url: string) => {
      if (String(url).includes('/api/update/status')) return { ok: true, json: async () => ({ phase: 'idle' }) };
      return { ok: false, status: 409, json: async () => ({ error: '/tmp/docker-compose.yml is not mounted' }) };
    });
    const res = await startUpdate('t');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('not mounted');
  });

  it('reports a refusal with no body rather than claiming success', async () => {
    stubFetch(async (url: string) => {
      if (String(url).includes('/api/update/status')) return { ok: true, json: async () => ({ phase: 'idle' }) };
      return { ok: false, status: 500, json: async () => { throw new Error('no body'); } };
    });
    const res = await startUpdate('t');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('500');
  });

  it('reports a network failure rather than throwing at the caller', async () => {
    stubFetch(async (url: string) => {
      if (String(url).includes('/api/update/status')) return { ok: true, json: async () => ({ phase: 'idle' }) };
      throw new Error('network error');
    });
    const res = await startUpdate('t');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('network error');
  });

  it('succeeds when the server accepts it', async () => {
    stubFetch(async (url: string) => {
      if (String(url).includes('/api/update/status')) return { ok: true, json: async () => ({ phase: 'idle' }) };
      return { ok: true, json: async () => ({ message: 'Update started' }) };
    });
    expect((await startUpdate('t')).ok).toBe(true);
  });
});

describe('currentBootId', () => {
  it('reads the boot id', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ bootId: 'boot-1' }) }));
    expect(await currentBootId()).toBe('boot-1');
  });

  it('returns empty for a server too old to have one, so the caller can fall back', async () => {
    stubFetch(async () => ({ ok: true, json: async () => ({ version: '1.7.0' }) }));
    expect(await currentBootId()).toBe('');
  });

  it('returns empty rather than throwing when the server is unreachable', async () => {
    stubFetch(async () => { throw new Error('offline'); });
    expect(await currentBootId()).toBe('');
  });
});
