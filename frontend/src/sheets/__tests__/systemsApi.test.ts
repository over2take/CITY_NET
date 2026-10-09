/**
 * SYSTEMS.EXE's requests (4a1b2): each goes to backend/routes/systems.js with the GM's token, and
 * every answer comes back as { ok, value } or { ok: false, error } in the server's own words.
 */
import { describe, it, expect, vi } from 'vitest';
import { systemsApi } from '../systemsApi';

const ID = 'sys_aaaaaaaaaaaaaaaa';

/** A fetch that answers `body` with `status`, recording what was asked. */
const server = (status = 200, body: unknown = {}, headers: Record<string, string> = {}) => vi.fn(async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  headers: { get: (k: string) => headers[k] ?? null },
}) as unknown as Response);

const asked = (f: ReturnType<typeof server>) => {
  const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
  return { url, method: init?.method ?? 'GET', headers: init?.headers, body: init?.body ? JSON.parse(String(init.body)) : undefined };
};

describe('the requests', () => {
  it('each goes where the server expects, with the token', async () => {
    const cases: [(api: ReturnType<typeof systemsApi>) => Promise<unknown>, string, string, unknown][] = [
      [(a) => a.list(), '/api/systems', 'GET', undefined],
      [(a) => a.get(ID), `/api/systems/${ID}`, 'GET', undefined],
      [(a) => a.saveDraft(ID, { format: 1, name: 'Hearth' }), `/api/systems/${ID}/draft`, 'PUT', { definition: { format: 1, name: 'Hearth' } }],
      [(a) => a.publish(ID), `/api/systems/${ID}/publish`, 'POST', {}],
      [(a) => a.previewValues({ format: 1, name: 'H' }), '/api/systems/preview-values', 'POST', { definition: { format: 1, name: 'H' } }],
      [(a) => a.previewSheet({ format: 1, name: 'H' }), '/api/systems/preview-sheet', 'POST', { definition: { format: 1, name: 'H' } }],
      [(a) => a.tryTier({ format: 1, name: 'H' }, 'boss', 6), '/api/systems/try-tier', 'POST', { definition: { format: 1, name: 'H' }, tier: 'boss', level: 6 }],
      [(a) => a.tryHealth({ format: 1, name: 'H' }, { token: { current: 5, max: 9 }, action: { kind: 'damage', amount: 2 } }), '/api/systems/try-health', 'POST',
        { definition: { format: 1, name: 'H' }, token: { current: 5, max: 9 }, action: { kind: 'damage', amount: 2 } }],
      [(a) => a.create('Hearth'), '/api/systems', 'POST', { name: 'Hearth' }],
      [(a) => a.rename(ID, 'Emberhold'), `/api/systems/${ID}/name`, 'PUT', { name: 'Emberhold' }],
      [(a) => a.duplicate(ID), `/api/systems/${ID}/duplicate`, 'POST', {}],
      [(a) => a.remove(ID), `/api/systems/${ID}`, 'DELETE', undefined],
      [(a) => a.preview('{"citysys":1}'), '/api/systems/install/preview', 'POST', { file: '{"citysys":1}' }],
      [(a) => a.install('{}', 'keep_both'), '/api/systems/install', 'POST', { file: '{}', mode: 'keep_both' }],
      [(a) => a.install('{}', 'update', true), '/api/systems/install', 'POST', { file: '{}', mode: 'update', replaceChanges: true }],
    ];
    for (const [run, url, method, body] of cases) {
      const f = server();
      await run(systemsApi('tok', f));
      const got = asked(f);
      expect({ url: got.url, method: got.method, body: got.body }, url).toEqual({ url, method, body });
      expect(got.headers, url).toMatchObject({ Authorization: 'Bearer tok' });
      expect(Object.keys(got.headers as object).includes('Content-Type'), url).toBe(body !== undefined);
    }
  });

  it('escapes an id it is given', async () => {
    const f = server();
    await systemsApi('tok', f).get('a/b');
    expect(asked(f).url).toBe('/api/systems/a%2Fb');
  });

  it('answers with what the server sent', async () => {
    const list = [{ id: ID, name: 'Hearth' }];
    expect(await systemsApi('tok', server(200, list)).list()).toEqual({ ok: true, value: list });
  });

  it('passes on a refusal in the server\'s words, with what came with it', async () => {
    expect(await systemsApi('tok', server(409, { error: 'Another system is already called Ember.' })).rename(ID, 'Ember'))
      .toEqual({ ok: false, status: 409, error: 'Another system is already called Ember.' });
    const changed = await systemsApi('tok', server(409, { error: 'Changed here.', changed: true })).install('{}', 'update');
    expect(changed).toEqual({ ok: false, status: 409, error: 'Changed here.', changed: true });
    const problems = [{ where: 'derived a', message: 'Depends on itself' }];
    expect(await systemsApi('tok', server(409, { error: 'Fix these', problems })).install('{}', 'update'))
      .toEqual({ ok: false, status: 409, error: 'Fix these', problems });
  });

  it('says the server could not be reached when it wasn\'t, or answered nothing readable', async () => {
    const down = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect(await systemsApi('tok', down as never).list()).toEqual({ ok: false, status: 0, error: 'Could not reach the server.' });
    const garbled = vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new Error('not json'); } }) as unknown as Response);
    expect(await systemsApi('tok', garbled).list()).toEqual({ ok: false, status: 502, error: 'Could not reach the server.' });
    expect(await systemsApi('tok', server(500, { error: 42, changed: 'yes', problems: 'many' })).list())
      .toEqual({ ok: false, status: 500, error: 'Could not reach the server.' });
  });
});

describe('uploading a currency icon', () => {
  it('sends the file as a form with the token, and answers with its address', async () => {
    const f = server(200, { icon: '/uploads/currency_icons/abc.png' });
    const file = new File(['x'], 'coin.png', { type: 'image/png' });
    expect(await systemsApi('tok', f).uploadIcon(file)).toEqual({ ok: true, value: { icon: '/uploads/currency_icons/abc.png' } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/systems/currency-icons');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
    expect((init.body as FormData).get('icon')).toBe(file);
  });

  it('passes on a refusal, a garbled answer, and an unreachable server', async () => {
    const file = new File(['x'], 'coin.gif');
    expect(await systemsApi('tok', server(400, { error: 'Only .png, .webp, .svg' })).uploadIcon(file)).toEqual({ ok: false, status: 400, error: 'Only .png, .webp, .svg' });
    expect(await systemsApi('tok', server(200, { nope: 1 })).uploadIcon(file)).toEqual({ ok: false, status: 200, error: 'The icon could not be uploaded.' });
    const down = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect(await systemsApi('tok', down as never).uploadIcon(file)).toEqual({ ok: false, status: 0, error: 'Could not reach the server.' });
  });

  it('sends a condition\'s icon to the conditions\' own folder (4e1b)', async () => {
    const f = server(200, { icon: `/uploads/condition_icons/${'d'.repeat(64)}.svg` });
    const file = new File(['x'], 'hex.svg', { type: 'image/svg+xml' });
    expect(await systemsApi('tok', f).uploadIcon(file, 'condition')).toEqual({ ok: true, value: { icon: `/uploads/condition_icons/${'d'.repeat(64)}.svg` } });
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('/api/systems/condition-icons');
  });
});

describe('exporting', () => {
  it('fetches the file with the token and names it as the server does', async () => {
    const f = server(200, '{"citysys":1}', { 'Content-Disposition': 'attachment; filename="vault-knights.citysys"' });
    expect(await systemsApi('tok', f).exportFile(ID)).toEqual({ ok: true, value: { fileName: 'vault-knights.citysys', text: '{"citysys":1}' } });
    expect(asked(f)).toMatchObject({ url: `/api/systems/${ID}/export`, method: 'GET', headers: { Authorization: 'Bearer tok' } });
  });

  it('falls back to a plain name', async () => {
    expect((await systemsApi('tok', server(200, 'x')).exportFile(ID))).toEqual({ ok: true, value: { fileName: 'system.citysys', text: 'x' } });
  });

  it('passes on a refusal, and an unreachable server', async () => {
    expect(await systemsApi('tok', server(409, { error: 'Publish the system before sharing it' })).exportFile(ID))
      .toEqual({ ok: false, status: 409, error: 'Publish the system before sharing it' });
    const down = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    expect(await systemsApi('tok', down as never).exportFile(ID)).toEqual({ ok: false, status: 0, error: 'Could not reach the server.' });
    const garbled = vi.fn(async () => ({ ok: false, status: 500, json: async () => { throw new Error('x'); } }) as unknown as Response);
    expect(await systemsApi('tok', garbled).exportFile(ID)).toEqual({ ok: false, status: 500, error: 'Could not reach the server.' });
  });
});
