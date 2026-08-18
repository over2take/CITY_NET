/**
 * Fetching a Companion character by code.
 *
 * `fetch` is injected, so every failure this can meet is reachable here without a network:
 * a timeout, a 404, a body that is not JSON, a document whose shape has changed under us.
 * That matters more than usual because **we do not own this endpoint**. It is a public
 * Firestore path a Foundry module found, not a published API, and the day it changes the
 * right behaviour is a dialog that says so rather than a hang or a stack trace.
 *
 * Nothing here contacts the real service. A test that did would be slow, flaky, and would
 * put someone else's infrastructure in our test suite.
 */

import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { fetchCharacter, isValidCode, normaliseCode, REASONS, BASE } = require('../sheets/companionFetch.js');

const str = (v) => ({ stringValue: v });
const int = (v) => ({ integerValue: String(v) });
const map = (fields) => ({ mapValue: { fields } });

const LOOKUP = { fields: { character_uuid: str('UOnVSlXN3dVaJYpwC53A') } };
const CHARACTER = {
  fields: {
    handle: str('Nyx'),
    health: int(35),
    stats: map({ Intelligence: int(8), Reflexes: int(6) }),
    skills: map({ Handgun: int(4) }),
  },
};

/** A fetch that answers each URL in turn, and records what it was asked for. */
const stubFetch = (responses) => {
  const calls = [];
  const impl = vi.fn(async (url) => {
    calls.push(url);
    const next = responses.shift();
    if (typeof next === 'function') return next(url);
    return { ok: true, status: 200, json: async () => next };
  });
  impl.calls = calls;
  return impl;
};

const ok = (doc) => ({ ok: true, status: 200, json: async () => doc });
const status = (code) => () => ({ ok: false, status: code, json: async () => ({}) });
const throws = (name) => () => { const e = new Error(name); e.name = name; throw e; };

describe('the code itself', () => {
  it('accepts six letters or digits, in any case', () => {
    expect(isValidCode('6LZKP7')).toBe(true);
    expect(isValidCode('6lzkp7')).toBe(true);
    expect(normaliseCode('  6lzkp7 ')).toBe('6LZKP7');
  });

  it('refuses anything else before a request is made', async () => {
    for (const bad of ['', '12345', '1234567', 'ABC-12', null, undefined, 'six!!!']) {
      expect(isValidCode(bad)).toBe(false);
    }
    const impl = stubFetch([]);
    expect(await fetchCharacter('nope', { fetchImpl: impl })).toEqual({ error: 'BAD_CODE' });
    // Nothing left the building.
    expect(impl).not.toHaveBeenCalled();
  });
});

describe('resolving a code', () => {
  it('takes two hops: code to uuid, uuid to character', async () => {
    const impl = stubFetch([LOOKUP, CHARACTER]);
    const result = await fetchCharacter('6LZKP7', { fetchImpl: impl });

    expect(impl.calls[0]).toBe(`${BASE}/code_to_character/6LZKP7`);
    expect(impl.calls[1]).toBe(`${BASE}/character_export/UOnVSlXN3dVaJYpwC53A`);
    expect(result.candidates).toMatchObject({ handle: 'Nyx', Intelligence: 8, Handgun: 4 });
  });

  it('upper-cases the code before asking', async () => {
    const impl = stubFetch([LOOKUP, CHARACTER]);
    await fetchCharacter('6lzkp7', { fetchImpl: impl });
    expect(impl.calls[0]).toContain('/6LZKP7');
  });

  it('carries the missing list through, so the preview can show it', async () => {
    const impl = stubFetch([LOOKUP, { fields: { ...CHARACTER.fields, vehicles: map({ x: map({ name: str('Galena') }) }) } }]);
    const result = await fetchCharacter('6LZKP7', { fetchImpl: impl });
    expect(result.missing.join(' ')).toMatch(/vehicle SDP/);
  });
});

describe('when it does not work', () => {
  const reasons = [
    ['a code nobody has', [status(404)], 'NOT_FOUND'],
    ['their service erroring', [status(500)], 'SERVICE_ERROR'],
    ['a timeout', [throws('AbortError')], 'TIMEOUT'],
    ['the network being down', [throws('TypeError')], 'UNREACHABLE'],
  ];

  it.each(reasons)('%s reports %s', async (_label, responses, expected) => {
    const result = await fetchCharacter('6LZKP7', { fetchImpl: stubFetch([...responses]) });
    expect(result).toEqual({ error: expected });
  });

  it('tells a bad code apart from their format changing', async () => {
    // A lookup that answers but holds no uuid is not the player mistyping. Reading it as
    // one would send them off to re-check a code that is perfectly fine.
    const impl = stubFetch([{ fields: {} }]);
    expect(await fetchCharacter('6LZKP7', { fetchImpl: impl })).toEqual({ error: 'BAD_RESPONSE' });
  });

  it('reports a body that is not JSON rather than throwing', async () => {
    const impl = stubFetch([() => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } })]);
    expect(await fetchCharacter('6LZKP7', { fetchImpl: impl })).toEqual({ error: 'BAD_RESPONSE' });
  });

  it('fails the second hop as clearly as the first', async () => {
    const impl = stubFetch([LOOKUP, status(404)]);
    expect(await fetchCharacter('6LZKP7', { fetchImpl: impl })).toEqual({ error: 'NOT_FOUND' });
  });

  it('calls an export it can read nothing out of empty rather than blank', async () => {
    // An empty preview looks like a character with nothing in it. This is not that.
    const impl = stubFetch([LOOKUP, { fields: {} }]);
    expect(await fetchCharacter('6LZKP7', { fetchImpl: impl })).toEqual({ error: 'EMPTY_EXPORT' });
  });

  it('survives a runtime with no fetch at all', async () => {
    // Explicitly null, not undefined: undefined falls through to the default, which is the
    // real global fetch — and a test that passed undefined here would quietly make a live
    // request to somebody else's service every run.
    expect(await fetchCharacter('6LZKP7', { fetchImpl: null })).toEqual({ error: 'UNREACHABLE' });
  });

  it('has something to say for every reason it can return', () => {
    // A reason with no message shows a player a blank error box.
    for (const key of ['BAD_CODE', 'NOT_FOUND', 'TIMEOUT', 'UNREACHABLE', 'SERVICE_ERROR', 'BAD_RESPONSE', 'EMPTY_EXPORT']) {
      expect(REASONS[key]).toBeTruthy();
    }
  });
});

describe('the deadline', () => {
  it('gives up rather than hanging on a service that never answers', async () => {
    // Their endpoint can stop responding without closing the connection, and a dialog that
    // waits forever is worse than one that says it could not reach them.
    const impl = vi.fn((url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const e = new Error('aborted');
        e.name = 'AbortError';
        reject(e);
      });
    }));
    const result = await fetchCharacter('6LZKP7', { fetchImpl: impl, timeoutMs: 10 });
    expect(result).toEqual({ error: 'TIMEOUT' });
  });
});
