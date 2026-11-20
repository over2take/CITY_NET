import { describe, it, expect, vi, afterEach } from 'vitest';
const { sceneQueue } = require('../sockets/sceneQueue');

// One scene's initiative changes one after another (found by 8i2's journey on CI: rolls landing together lost one).
// The tracker's own test of it is initiative.test.js "rolls landing together".

/** Work that records its start, and is finished by hand. */
const recorder = () => {
  const started = [];
  const dones = {};
  const work = (name) => (done) => { started.push(name); dones[name] = done; };
  return { started, dones, work };
};
const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => vi.useRealTimers());

describe('sceneQueue', () => {
  it('one key: the next waits for the one before to say done', async () => {
    const { inTurn } = sceneQueue();
    const r = recorder();
    inTurn('city:0', r.work('a'));
    inTurn('city:0', r.work('b'));
    await settle();
    expect(r.started).toEqual(['a']);
    r.dones.a();
    await settle();
    expect(r.started).toEqual(['a', 'b']);
  });

  it('different keys never wait on each other', async () => {
    const { inTurn } = sceneQueue();
    const r = recorder();
    inTurn('city:0', r.work('street'));
    inTurn('7:0', r.work('roof'));
    await settle();
    expect(r.started).toEqual(['street', 'roof']);
  });

  it('done said twice lets only the next one go, not two', async () => {
    const { inTurn } = sceneQueue();
    const r = recorder();
    inTurn('k', r.work('a'));
    inTurn('k', r.work('b'));
    inTurn('k', r.work('c'));
    await settle();
    r.dones.a();
    r.dones.a();
    await settle();
    expect(r.started).toEqual(['a', 'b']);
  });

  it('work that throws is said, and the next goes', async () => {
    const onError = vi.fn();
    const { inTurn } = sceneQueue({ onError });
    const r = recorder();
    inTurn('k', () => { throw new Error('bad row'); });
    inTurn('k', r.work('b'));
    await settle();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'bad row' }));
    expect(r.started).toEqual(['b']);
  });

  it('work that never says done holds the key only till the timeout', async () => {
    vi.useFakeTimers();
    const { inTurn } = sceneQueue({ timeoutMs: 5000 });
    const r = recorder();
    inTurn('k', r.work('a'));
    inTurn('k', r.work('b'));
    await vi.advanceTimersByTimeAsync(4999);
    expect(r.started).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(1);
    expect(r.started).toEqual(['a', 'b']);
  });

  it('done in time clears the timer: the next is not let go a second time by it', async () => {
    vi.useFakeTimers();
    const { inTurn } = sceneQueue({ timeoutMs: 5000 });
    const r = recorder();
    inTurn('k', r.work('a'));
    inTurn('k', r.work('b'));
    inTurn('k', r.work('c'));
    await vi.advanceTimersByTimeAsync(0);
    r.dones.a();
    await vi.advanceTimersByTimeAsync(0);
    expect(r.started).toEqual(['a', 'b']);
    // Only b's timer left running, a's cleared: no 5 s timer left behind by every change.
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(r.started).toEqual(['a', 'b']);
  });

  it('a key is forgotten once its last work is done, and kept while any waits', async () => {
    const q = sceneQueue();
    const r = recorder();
    q.inTurn('k', r.work('a'));
    q.inTurn('k', r.work('b'));
    await settle();
    r.dones.a();
    await settle();
    expect(q.waiting()).toBe(1);
    r.dones.b();
    await settle();
    expect(q.waiting()).toBe(0);
  });
});
