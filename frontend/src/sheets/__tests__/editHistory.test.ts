/**
 * Undo and redo for the graph view (5b1). Approved mockup builder-graph (2026-10-17): undo/redo in
 * the map's toolbar. Each edit's step back, typing as one step, redo until a new edit, a cap.
 */
import { describe, it, expect } from 'vitest';
import { emptyHistory, recorded, undone, redone, SETTLE_MS, DEPTH } from '../editHistory';

describe('undo and redo', () => {
  it('takes each edit back in turn, and forward again', () => {
    let h = emptyHistory<string>();
    h = recorded(h, 'a', 0);
    h = recorded(h, 'b', 5000);
    // now showing 'c'
    const one = undone(h, 'c')!;
    expect(one.show).toBe('b');
    const two = undone(one.history, 'b')!;
    expect(two.show).toBe('a');
    expect(undone(two.history, 'a')).toBeNull();
    const back = redone(two.history, 'a')!;
    expect(back.show).toBe('b');
    expect(redone(back.history, 'b')!.show).toBe('c');
  });

  it('counts typing in one box as one step: edits close together join the first', () => {
    let h = emptyHistory<string>();
    h = recorded(h, '', 0, 'name');
    h = recorded(h, 'S', 200, 'name');
    h = recorded(h, 'St', 400, 'name');
    expect(h.past).toEqual(['']);
    expect(undone(h, 'Str')!.show).toBe('');
    h = recorded(h, 'Str', 400 + SETTLE_MS, 'name');
    expect(h.past).toEqual(['', 'Str']);
  });

  it("never joins edits that aren't typing in the same box, however quick", () => {
    let h = emptyHistory<string>();
    h = recorded(h, 'a', 0);
    h = recorded(h, 'b', 10);
    h = recorded(h, 'c', 20, 'name');
    h = recorded(h, 'd', 30, 'formula');
    expect(h.past).toEqual(['a', 'b', 'c', 'd']);
  });

  it('forgets what was undone once a new edit is made, and an undo ends a step', () => {
    let h = emptyHistory<string>();
    h = recorded(h, 'a', 0);
    const u = undone(h, 'b')!;
    expect(u.history.future).toEqual(['b']);
    // An edit straight after an undo starts a step of its own, and clears what could be redone.
    const after = recorded(u.history, 'a', 100);
    expect(after.future).toEqual([]);
    expect(after.past).toEqual(['a']);
    expect(redone(after, 'x')).toBeNull();
  });

  it('keeps no more than its depth', () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < DEPTH + 20; i += 1) h = recorded(h, i, i * 10_000);
    expect(h.past.length).toBe(DEPTH);
    expect(h.past[0]).toBe(20);
  });
});
