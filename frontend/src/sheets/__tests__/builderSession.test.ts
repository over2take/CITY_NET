/**
 * The builder's saving (4a2a). Decided with the user 2026-10-06: two layers. Autosave writes the
 * draft about five seconds after editing stops and always on leaving; SAVE saves now; EXIT TO MAP
 * warns only when a save failed.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createAutosave, saveStatus, exitWarning, leaveNeedsAsking, publishBlocked, publishedMessage,
  BUILDER_PAGES, AUTOSAVE_DELAY_MS, type SaveAnswer,
} from '../builderSession';

/** Timers the test runs by hand. `pending` is the last one waiting; `fire` runs every one. */
const fakeTimers = () => {
  let waiting: { fn: () => void; ms: number }[] = [];
  return {
    timers: {
      set: (fn: () => void, ms: number) => { const t = { fn, ms }; waiting.push(t); return t; },
      clear: (h: unknown) => { waiting = waiting.filter((t) => t !== h); },
    },
    get pending() { return waiting.at(-1) ?? null; },
    get count() { return waiting.length; },
    fire() { const all = waiting; waiting = []; all.forEach((t) => t.fn()); },
  };
};

/** A save the test answers by hand. */
const deferredSave = () => {
  const calls: { definition: unknown; answer: (a: SaveAnswer) => void; fail: () => void }[] = [];
  const save = vi.fn((definition: unknown) => new Promise<SaveAnswer>((resolve, reject) => {
    calls.push({ definition, answer: resolve, fail: () => reject(new Error('network')) });
  }));
  return { save, calls };
};

const tick = () => new Promise((r) => setTimeout(r, 0));
const AT = new Date(2026, 9, 6, 14, 2);
const PROBLEM = { where: 'derived a', message: 'Depends on itself' };

const setup = () => {
  const t = fakeTimers();
  const s = deferredSave();
  const changes = vi.fn();
  const autosave = createAutosave<{ n: number }>({ save: s.save, onChange: changes, now: () => AT, timers: t.timers, initialProblems: [PROBLEM] });
  return { t, s, changes, autosave };
};

describe('autosave', () => {
  it('starts saved, with the problems it was given', () => {
    const { autosave } = setup();
    expect(autosave.state).toEqual({ kind: 'saved', at: AT });
    expect(autosave.problems).toEqual([PROBLEM]);
  });

  it('saves the latest edit once editing pauses for five seconds', async () => {
    const { t, s, autosave, changes } = setup();
    autosave.edit({ n: 1 });
    expect(autosave.state).toEqual({ kind: 'pending' });
    expect(t.pending!.ms).toBe(AUTOSAVE_DELAY_MS);
    expect(AUTOSAVE_DELAY_MS).toBe(5000);
    autosave.edit({ n: 2 });
    // Each edit starts the wait over: one timer, never one per edit.
    expect(t.count).toBe(1);
    expect(s.save).not.toHaveBeenCalled();
    t.fire();
    await tick();
    expect(s.calls.map((c) => c.definition)).toEqual([{ n: 2 }]);
    expect(autosave.state).toEqual({ kind: 'saving' });
    s.calls[0].answer({ ok: true, problems: [] });
    await tick();
    expect(autosave.state).toEqual({ kind: 'saved', at: AT });
    expect(autosave.problems).toEqual([]);
    expect(changes).toHaveBeenCalled();
  });

  it('keeps an edit made during a save, and saves it at its own pause', async () => {
    const { t, s, autosave } = setup();
    autosave.edit({ n: 1 });
    t.fire();
    await tick();
    autosave.edit({ n: 2 });
    expect(autosave.state).toEqual({ kind: 'saving' });
    s.calls[0].answer({ ok: true, problems: [] });
    await tick();
    expect(autosave.state).toEqual({ kind: 'pending' });
    t.fire();
    await tick();
    expect(s.calls.map((c) => c.definition)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('waits for a save already on its way before the next, never two at once', async () => {
    const { t, s, autosave } = setup();
    autosave.edit({ n: 1 });
    t.fire();
    await tick();
    autosave.edit({ n: 2 });
    t.fire();
    await tick();
    expect(s.calls).toHaveLength(1);
    s.calls[0].answer({ ok: true, problems: [] });
    await tick();
    await tick();
    expect(s.calls.map((c) => c.definition)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('several waiting on one save start one more after it, not one each', async () => {
    const { t, s, autosave } = setup();
    autosave.edit({ n: 1 });
    const a = autosave.flush();
    await tick();
    autosave.edit({ n: 2 });
    const b = autosave.flush();
    t.fire();
    await tick();
    s.calls[0].answer({ ok: true, problems: [] });
    await tick();
    await tick();
    expect(s.calls).toHaveLength(2);
    s.calls[1].answer({ ok: true, problems: [] });
    expect([await a, await b]).toEqual([true, true]);
    expect(s.calls).toHaveLength(2);
  });

  it('flush saves at once, stops the timer, and says when all is saved', async () => {
    const { t, s, autosave } = setup();
    expect(await autosave.flush()).toBe(true);
    expect(s.save).not.toHaveBeenCalled();
    autosave.edit({ n: 1 });
    const done = autosave.flush();
    await tick();
    expect(t.pending).toBeNull();
    s.calls[0].answer({ ok: true, problems: [PROBLEM] });
    expect(await done).toBe(true);
    expect(autosave.problems).toEqual([PROBLEM]);
  });

  it('flush also saves an edit made while it waited', async () => {
    const { s, autosave } = setup();
    autosave.edit({ n: 1 });
    const done = autosave.flush();
    await tick();
    autosave.edit({ n: 2 });
    s.calls[0].answer({ ok: true, problems: [] });
    await tick();
    await tick();
    s.calls[1].answer({ ok: true, problems: [] });
    expect(await done).toBe(true);
    expect(s.calls.map((c) => c.definition)).toEqual([{ n: 1 }, { n: 2 }]);
    expect(autosave.state).toEqual({ kind: 'saved', at: AT });
  });

  it('a refused or unreachable save says why, keeps the edit, and tries again', async () => {
    const { s, autosave } = setup();
    autosave.edit({ n: 1 });
    const first = autosave.flush();
    await tick();
    s.calls[0].answer({ ok: false, error: 'Larger than 512 KB' });
    expect(await first).toBe(false);
    expect(autosave.state).toEqual({ kind: 'failed', error: 'Larger than 512 KB' });
    expect(autosave.problems).toEqual([PROBLEM]);
    const second = autosave.flush();
    await tick();
    s.calls[1].fail();
    expect(await second).toBe(false);
    expect(autosave.state).toEqual({ kind: 'failed', error: 'Could not reach the server.' });
    const third = autosave.flush();
    await tick();
    s.calls[2].answer({ ok: true, problems: [] });
    expect(await third).toBe(true);
    expect(s.calls.map((c) => c.definition)).toEqual([{ n: 1 }, { n: 1 }, { n: 1 }]);
  });

  it('dispose stops a waiting autosave', () => {
    const { t, autosave } = setup();
    autosave.edit({ n: 1 });
    autosave.dispose();
    expect(t.pending).toBeNull();
  });
});

describe('what it says', () => {
  it('the status line', () => {
    expect(saveStatus({ kind: 'saved', at: new Date(2026, 9, 6, 9, 5) })).toEqual({ text: 'DRAFT · SAVED 09:05', tone: 'quiet' });
    expect(saveStatus({ kind: 'pending' })).toEqual({ text: 'DRAFT · UNSAVED CHANGES', tone: 'warn' });
    expect(saveStatus({ kind: 'saving' })).toEqual({ text: 'DRAFT · SAVING…', tone: 'warn' });
    expect(saveStatus({ kind: 'failed', error: 'Could not reach the server.' })).toEqual({ text: 'NOT SAVED: Could not reach the server.', tone: 'bad' });
  });

  it('the warning when leaving couldn\'t save first, and when the browser tab should ask', () => {
    expect(exitWarning('Hearth', 'Could not reach the server.')).toEqual({
      title: 'EXIT.EXE · UNSAVED WORK',
      text: 'Your latest changes to Hearth couldn\'t be saved: Could not reach the server.',
      hint: 'Leaving now loses them. Try again, or stay and keep working.',
    });
    expect(leaveNeedsAsking({ kind: 'saved', at: AT })).toBe(false);
    for (const kind of ['pending', 'saving'] as const) expect(leaveNeedsAsking({ kind })).toBe(true);
    expect(leaveNeedsAsking({ kind: 'failed', error: 'x' })).toBe(true);
  });

  it('PUBLISH, before and after', () => {
    expect(publishBlocked([])).toBeNull();
    expect(publishBlocked([PROBLEM])).toBe('Fix this problem before publishing.');
    expect(publishBlocked([PROBLEM, PROBLEM])).toBe('Fix these 2 problems before publishing.');
    expect(publishedMessage(4, true)).toBe('Published v4. The game runs it from now on.');
    expect(publishedMessage(1, false)).toBe('Published v1. It\'s ready to pick in the game-system picker.');
  });

  it('the sidebar\'s pages, in order, each saying what it is for', () => {
    expect(BUILDER_PAGES.map((p) => p.label)).toEqual(['SETUP', 'WORDS', 'FEATURES', 'STATS & RULES', 'CHARACTER SHEET', 'NPCS', 'TRY IT', 'PROBLEMS']);
    for (const p of BUILDER_PAGES) expect(p.what, p.label).toMatch(/\.$/);
    expect(new Set(BUILDER_PAGES.map((p) => p.id)).size).toBe(BUILDER_PAGES.length);
  });
});
