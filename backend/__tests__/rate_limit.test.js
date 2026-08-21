/**
 * The ceiling on how often one caller can make us do something expensive.
 *
 * Time is injected rather than waited for, so the window can be crossed in a test that
 * still runs in milliseconds. The cases that matter are the ones a limiter usually gets
 * wrong: counting everyone as one caller, letting a fixed window be spent twice across
 * its boundary, and growing without bound because the key is attacker-chosen.
 */

import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { rateLimit, clientKey } = require('../middleware/rateLimit.js');

/** Just enough of req/res for the middleware, plus what it did. */
const run = (limiter, ip) => {
  const req = { ip };
  const out = { status: null, body: null, headers: {}, passed: false };
  const res = {
    set: (k, v) => { out.headers[k] = v; return res; },
    status: (code) => { out.status = code; return res; },
    json: (body) => { out.body = body; return res; },
  };
  limiter(req, res, () => { out.passed = true; });
  return out;
};

describe('rateLimit', () => {
  it('lets a caller through up to the limit and then stops them', () => {
    const limiter = rateLimit({ limit: 3, windowMs: 1000 });
    expect(run(limiter, '1.1.1.1').passed).toBe(true);
    expect(run(limiter, '1.1.1.1').passed).toBe(true);
    expect(run(limiter, '1.1.1.1').passed).toBe(true);

    const blocked = run(limiter, '1.1.1.1');
    expect(blocked.passed).toBe(false);
    expect(blocked.status).toBe(429);
  });

  it('counts each caller separately', () => {
    // The failure mode worth guarding: if this counted everyone together, one player
    // importing a character would lock out the rest of the table.
    const limiter = rateLimit({ limit: 2, windowMs: 1000 });
    run(limiter, '1.1.1.1');
    run(limiter, '1.1.1.1');
    expect(run(limiter, '1.1.1.1').passed).toBe(false);
    expect(run(limiter, '2.2.2.2').passed).toBe(true);
  });

  it('says when to come back rather than failing silently', () => {
    let clock = 10_000;
    const limiter = rateLimit({ limit: 1, windowMs: 60_000, now: () => clock });
    run(limiter, '1.1.1.1');
    clock += 15_000;

    const blocked = run(limiter, '1.1.1.1');
    expect(blocked.status).toBe(429);
    // 60s window, 15s spent: 45 left.
    expect(blocked.body.retryAfter).toBe(45);
    expect(blocked.headers['Retry-After']).toBe('45');
  });

  it('forgives a caller once their window has passed', () => {
    let clock = 0;
    const limiter = rateLimit({ limit: 2, windowMs: 1000, now: () => clock });
    run(limiter, '1.1.1.1');
    run(limiter, '1.1.1.1');
    expect(run(limiter, '1.1.1.1').passed).toBe(false);

    clock += 1001;
    expect(run(limiter, '1.1.1.1').passed).toBe(true);
  });

  it('slides, so the allowance cannot be spent twice across a boundary', () => {
    // A fixed window lets someone spend the whole limit at the end of one and the whole
    // limit again at the start of the next — twice the rate, at exactly the moment it
    // matters. These requests are 600ms apart in a 1000ms window, so only two can ever
    // be live at once.
    let clock = 0;
    const limiter = rateLimit({ limit: 2, windowMs: 1000, now: () => clock });

    expect(run(limiter, '1.1.1.1').passed).toBe(true);   // t=0
    clock = 600;
    expect(run(limiter, '1.1.1.1').passed).toBe(true);   // t=600
    clock = 900;
    expect(run(limiter, '1.1.1.1').passed).toBe(false);  // both still inside the window
    clock = 1100;
    expect(run(limiter, '1.1.1.1').passed).toBe(true);   // t=0 has aged out, t=600 has not
    clock = 1200;
    expect(run(limiter, '1.1.1.1').passed).toBe(false);  // t=600 and t=1100 are live
  });

  it('does not grow without bound when the caller varies their address', () => {
    // The key comes from whoever is asking, so an unbounded map is a memory leak anyone
    // can drive. Well past the cap, it is still near the cap.
    let clock = 0;
    const limiter = rateLimit({ limit: 1, windowMs: 60_000, now: () => clock, maxKeys: 50 });
    for (let i = 0; i < 500; i++) {
      clock += 1;
      run(limiter, `10.0.0.${i}`);
    }
    expect(limiter.size()).toBeLessThanOrEqual(51);
  });

  it('drops the least recently seen rather than blocking anyone', () => {
    // Failing open is the right direction here: forgetting a caller costs one extra
    // request, while evicting the wrong way would lock out whoever is actually using it.
    let clock = 0;
    const limiter = rateLimit({ limit: 1, windowMs: 60_000, now: () => clock, maxKeys: 2 });
    run(limiter, 'old');
    clock += 10;
    run(limiter, 'newer');
    clock += 10;
    run(limiter, 'newest');
    clock += 10;
    run(limiter, 'overflow');

    // 'old' was forgotten, so it is allowed again.
    expect(run(limiter, 'old').passed).toBe(true);
  });

  it('refuses to be configured into doing nothing', () => {
    expect(() => rateLimit({ windowMs: 1000 })).toThrow(/limit/);
    expect(() => rateLimit({ limit: 5 })).toThrow(/windowMs/);
    expect(() => rateLimit()).toThrow();
  });

  it('still identifies a caller when req.ip is missing', () => {
    expect(clientKey({ ip: '1.2.3.4' })).toBe('1.2.3.4');
    expect(clientKey({ socket: { remoteAddress: '5.6.7.8' } })).toBe('5.6.7.8');
    // Never undefined: an unkeyable caller shares one bucket rather than escaping the
    // limit entirely.
    expect(clientKey({})).toBe('unknown');
  });
});
