import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  rankLists, withNewRankList, withRankListLabel, withoutRankList, withNewRank, withRank, withRankMoved, withoutRank,
  withStatRank, withStatAtStart, rankListOf, statsHolding, PRESETS, LIMITS, type RankedStat,
} from '../ranks';
import { statGroups } from '../statsRules';
import type { Definition } from '../systemsApi';

/**
 * The builder's ranks as logic (7f1b; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): lists made from a
 * preset or empty, renamed, their ranks added, changed, moved and removed; a stat's HOLDS and AT START, all held to the
 * server's own check (backend systemBuilder/definition.js).
 */

const req = createRequire(import.meta.url);
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');

const HEARTH = {
  format: 1, name: 'Hearth', core: { health: { model: 'pool' } },
  stats: [
    { id: 'abilities', label: 'ABILITIES', stats: [{ id: 'level', label: 'Level', min: 1, max: 20 }] },
    { id: 'skills', label: 'SKILLS', stats: [{ id: 'athletics', label: 'Athletics', min: 0, max: 5 }, { id: 'stealth', label: 'Stealth' }] },
  ],
} as unknown as Definition;
const sound = (def: Definition) => expect(checkDefinition(def).problems).toEqual([]);
const stat = (def: Definition, id: string) => statGroups(def).flatMap((g) => g.stats).find((s) => s.id === id) as RankedStat;
const withProficiency = () => withNewRankList(HEARTH, 'proficiency')!.definition;

describe('lists', () => {
  it('made from each preset, sound as the server checks it; empty with one rank; ids of their own', () => {
    for (const p of PRESETS) {
      const made = withNewRankList(HEARTH, p.id)!;
      expect(rankLists(made.definition)).toEqual([{ id: made.id, label: p.label, list: p.list }]);
      sound(made.definition);
    }
    expect(PRESETS.map((p) => [p.label, p.list.length])).toEqual([['PROFICIENCY', 5], ['DOTS', 5], ['THE LADDER', 11], ['SKILL RANKS', 6]]);
    const empty = withNewRankList(HEARTH)!;
    expect(rankLists(empty.definition)[0]).toEqual({ id: 'new_ranks', label: 'NEW RANKS', list: [{ name: 'NONE', worth: '0' }] });
    sound(empty.definition);
    const twice = withNewRankList(withProficiency(), 'proficiency')!;
    expect(twice.id).toBe('proficiency_2');
    // A preset's ranks are copies: a draft's rank changed in place never changes the preset.
    ((withProficiency() as unknown as { ranks: { list: { name: string }[] }[] }).ranks[0].list[0]).name = 'X';
    expect(PRESETS[0].list[0].name).toBe('UNTRAINED');
  });

  it('renamed; removed, a stat holding it back to a number; never past the most; read only those with an id', () => {
    const held = withStatAtStart(withStatRank(withProficiency(), 'athletics', 'proficiency'), 'athletics', 1);
    expect(rankLists(withRankListLabel(held, 'proficiency', 'TRAINING'))[0].label).toBe('TRAINING');
    const gone = withoutRankList(held, 'proficiency');
    expect(gone).not.toHaveProperty('ranks');
    expect(stat(gone, 'athletics')).toEqual({ id: 'athletics', label: 'Athletics' });
    sound(gone);
    const full = { ...HEARTH, ranks: Array.from({ length: LIMITS.lists }, (_, i) => ({ id: `r${i}`, label: 'R', list: [{ name: 'A', worth: '0' }] })) } as unknown as Definition;
    expect(withNewRankList(full)).toBeNull();
    expect(rankLists({ ranks: [null, { label: 'no id' }, { id: 'x', list: [null, { name: 'A' }] }] } as unknown as Definition))
      .toEqual([{ id: 'x', label: '', list: [{ name: 'A', worth: '' }] }]);
  });
});

describe('ranks', () => {
  it('a new one at the top, a step on from a number, 0 after a formula; changed; never past the most', () => {
    const dots = withNewRankList(HEARTH, 'dots')!;
    const more = withNewRank(dots.definition, dots.id)!;
    expect(rankLists(more)[0].list[5]).toEqual({ name: 'RANK 6', worth: '6' });
    const prof = withNewRank(withProficiency(), 'proficiency')!;
    expect(rankLists(prof)[0].list[5]).toEqual({ name: 'RANK 6', worth: '0' });
    expect(rankLists(withRank(prof, 'proficiency', 1, { name: 'SKILLED', worth: '3' }))[0].list[1]).toEqual({ name: 'SKILLED', worth: '3' });
    const full = { ...HEARTH, ranks: [{ id: 'p', label: 'P', list: Array.from({ length: LIMITS.ranks }, (_, i) => ({ name: `R${i}`, worth: '0' })) }] } as unknown as Definition;
    expect(withNewRank(full, 'p')).toBeNull();
    expect(withNewRank(HEARTH, 'nope')).toBeNull();
  });

  it('moved down and up, a highest at the start following its rank; never off either end', () => {
    const held = withStatAtStart(withStatRank(withProficiency(), 'athletics', 'proficiency'), 'athletics', 1);
    const up = withRankMoved(held, 'proficiency', 1, 1);
    expect(rankLists(up)[0].list.slice(0, 3).map((k) => k.name)).toEqual(['UNTRAINED', 'EXPERT', 'TRAINED']);
    expect(stat(up, 'athletics').atStart).toBe(2);
    // Another rank moved past it carries it the other way.
    expect(stat(withRankMoved(held, 'proficiency', 0, 1), 'athletics').atStart).toBe(0);
    expect(stat(withRankMoved(held, 'proficiency', 3, -1), 'athletics').atStart).toBe(1);
    expect(withRankMoved(held, 'proficiency', 0, -1)).toBe(held);
    expect(withRankMoved(held, 'proficiency', 4, 1)).toBe(held);
    expect(withRankMoved(held, 'nope', 1, 1)).toBe(held);
  });

  it('removed, never the last; a highest at the start above it comes down a step, at it holds or comes down to the top', () => {
    const held = withStatAtStart(withStatRank(withProficiency(), 'athletics', 'proficiency'), 'athletics', 2);
    expect(stat(withoutRank(held, 'proficiency', 0), 'athletics').atStart).toBe(1);
    expect(stat(withoutRank(held, 'proficiency', 3), 'athletics').atStart).toBe(2);
    const top = withStatAtStart(held, 'athletics', 4);
    expect(stat(withoutRank(top, 'proficiency', 4), 'athletics').atStart).toBe(3);
    sound(withoutRank(top, 'proficiency', 4));
    const one = { ...HEARTH, ranks: [{ id: 'p', label: 'P', list: [{ name: 'A', worth: '0' }] }] } as unknown as Definition;
    expect(withoutRank(one, 'p', 0)).toBe(one);
    expect(withoutRank(held, 'proficiency', 9)).toBe(held);
  });
});

describe('a stat\'s HOLDS and AT START', () => {
  it('held as a list: its lowest and highest gone, sound; back to a number, its rank and start gone', () => {
    const held = withStatRank(withProficiency(), 'athletics', 'proficiency');
    expect(stat(held, 'athletics')).toEqual({ id: 'athletics', label: 'Athletics', rank: 'proficiency' });
    sound(held);
    expect(rankListOf(held, stat(held, 'athletics'))!.id).toBe('proficiency');
    expect(rankListOf(held, stat(held, 'stealth'))).toBeNull();
    expect(statsHolding(held, 'proficiency')).toEqual(['Athletics']);
    const back = withStatRank(withStatAtStart(held, 'athletics', 1), 'athletics', null);
    expect(stat(back, 'athletics')).toEqual({ id: 'athletics', label: 'Athletics' });
    // A list there isn't is a number.
    expect(stat(withStatRank(held, 'athletics', 'nope'), 'athletics')).toEqual({ id: 'athletics', label: 'Athletics' });
    // Moved to another list, the old start goes with the old list.
    const dots = withNewRankList(withStatAtStart(held, 'athletics', 3), 'dots')!.definition;
    expect(stat(withStatRank(dots, 'athletics', 'dots'), 'athletics')).toEqual({ id: 'athletics', label: 'Athletics', rank: 'dots' });
  });

  it('AT START: a step, or any; nothing on a stat holding a number', () => {
    const held = withStatRank(withProficiency(), 'athletics', 'proficiency');
    const one = withStatAtStart(held, 'athletics', 1);
    expect(stat(one, 'athletics').atStart).toBe(1);
    sound(one);
    expect(stat(withStatAtStart(one, 'athletics', null), 'athletics')).not.toHaveProperty('atStart');
    expect(stat(withStatAtStart(one, 'athletics', -1), 'athletics')).not.toHaveProperty('atStart');
    expect(stat(withStatAtStart(one, 'athletics', 1.5), 'athletics')).not.toHaveProperty('atStart');
    expect(stat(withStatAtStart(held, 'stealth', 1), 'stealth')).not.toHaveProperty('atStart');
    // A system without stats is left as it is.
    expect(withStatRank({ format: 1, name: 'X' } as Definition, 'a', null)).toEqual({ format: 1, name: 'X' });
  });
});
