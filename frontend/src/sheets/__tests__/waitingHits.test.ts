import { describe, it, expect } from 'vitest';
import { rowParts, newestFirst, headWords, badgeWords, applyLabel, type WaitingHit, type WaitingView } from '../waitingHits';

// Hits waiting under CONFIRM as HEALTH and the vitals box show them (8b6b2; approved mockup waiting-hits, sections 3 and 4).

const hit = (id: number, over: Partial<WaitingHit> = {}): WaitingHit => ({ id, from: 'KES', what: 'Flame Tongue', words: 'RESISTS FIRE: 6 → 3 · WOULD TAKE 7 OF 10', taken: 7, ...over });
const may = (n: number): WaitingView => ({ ok: true, may: true, hits: Array.from({ length: n }, (_, i) => hit(i + 1)) });

describe('a hit\'s row', () => {
  it('its notes, and what it would take said last', () => {
    expect(rowParts('RESISTS FIRE: 6 → 3 · HIDDEN FROM PLAYERS · WOULD TAKE 7 OF 10')).toEqual({ notes: ['RESISTS FIRE: 6 → 3', 'HIDDEN FROM PLAYERS'], would: 'WOULD TAKE 7 OF 10' });
    expect(rowParts('WOULD TAKE 5')).toEqual({ notes: [], would: 'WOULD TAKE 5' });
    // Told nothing of its numbers: nothing to say.
    expect(rowParts('')).toEqual({ notes: [], would: null });
    expect(rowParts('RESISTS FIRE')).toEqual({ notes: ['RESISTS FIRE'], would: null });
  });
  it('newest first, the server\'s oldest-first left as it was', () => {
    const hits = [hit(1), hit(2), hit(3)];
    expect(newestFirst(hits).map((h) => h.id)).toEqual([3, 2, 1]);
    expect(hits.map((h) => h.id)).toEqual([1, 2, 3]);
  });
  it('APPLY with what it would take where they may know it', () => {
    expect(applyLabel(hit(1))).toBe('APPLY 7');
    expect(applyLabel(hit(1, { taken: null }))).toBe('APPLY');
    expect(applyLabel(hit(1, { taken: 0 }))).toBe('APPLY 0');
  });
});

describe('the box\'s head and HEALTH\'s tab', () => {
  it('to whoever may apply them: how many and in what order; none, nothing', () => {
    expect(headWords(may(1), 'GM')).toBe('1 HIT WAITING · NEWEST FIRST');
    expect(headWords(may(3), 'GM')).toBe('3 HITS WAITING · NEWEST FIRST');
    expect(headWords(may(0), 'GM')).toBeNull();
    expect(badgeWords(may(3))).toBe('3 WAITING');
    expect(badgeWords(may(0))).toBeNull();
  });
  it('to the one who made some: how many, and who applies them, in the game\'s word', () => {
    const mine = (n: number): WaitingView => ({ ok: true, may: false, hits: [], mine: n });
    expect(headWords(mine(2), 'Referee')).toBe('2 HITS WAITING · THE REFEREE APPLIES THEM');
    expect(headWords(mine(1), 'GM')).toBe('1 HIT WAITING · THE GM APPLIES IT');
    expect(headWords(mine(0), 'GM')).toBeNull();
    expect(badgeWords(mine(2))).toBe('2 WAITING');
    expect(badgeWords(mine(0))).toBeNull();
  });
  it('not read, or refused: nothing', () => {
    expect(headWords(null, 'GM')).toBeNull();
    expect(headWords({ ok: false, error: 'No such token' }, 'GM')).toBeNull();
    expect(badgeWords(null)).toBeNull();
    expect(badgeWords({ ok: false, error: 'x' })).toBeNull();
  });
});
