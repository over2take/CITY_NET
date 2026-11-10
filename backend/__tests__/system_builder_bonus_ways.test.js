import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

/**
 * Three ways a bonus counts (7e1a; approved mockup docs/mockups/items.html, 2026-11-10): ADD, summed; BONUSES STOP AT on
 * a stat or formula, after them; AT LEAST, last. Each bonus says what it really gave, for the sheet to name what the
 * cap cut. The example: a Ring of Constitution's +2 CON, up to 20.
 */

const require_ = createRequire(import.meta.url);
const { applyBonuses, stopOf } = require_('../systemBuilder/bonuses');
const { PICKS_KEY, overlayOf, effectiveData, workedOf } = require_('../systemBuilder/choices');
const { checkDefinition } = require_('../systemBuilder/definition');
const { compileSystem } = require_('../systemBuilder/derived');
const { bonusOf } = require_('../systemBuilder/tokenMax');

const f = (feature, amount) => ({ feature, amount });

describe('applyBonuses', () => {
  it('ADD sums them all', () => {
    expect(applyBonuses(14, { adds: [f('A', 2), f('B', 1)] })).toEqual({ value: 17, lines: [{ ...f('A', 2), got: 2 }, { ...f('B', 1), got: 1 }] });
  });

  it('BONUSES STOP AT: the latest bonus loses what passes it; two +2s never pass it', () => {
    const done = applyBonuses(18, { adds: [f('Tough', 1), f('Ring', 2)], stop: 20 });
    expect(done.value).toBe(20);
    expect(done.lines).toEqual([{ ...f('Tough', 1), got: 1 }, { ...f('Ring', 2), got: 1, stop: 20 }]);
    const both = applyBonuses(19, { adds: [f('A', 2), f('B', 2)], stop: 20 });
    expect(both.value).toBe(20);
    expect(both.lines.map((l) => l.got)).toEqual([1, 0]);
  });

  it('a cut that passes the latest bonus reaches the one before; a negative one is never cut', () => {
    const done = applyBonuses(19, { adds: [f('A', 3), f('Curse', -1), f('B', 1)], stop: 20 });
    expect(done.value).toBe(20);
    // 19 + 3 âˆ’ 1 + 1 = 22, 2 over: B's 1, then 1 of A's.
    expect(done.lines.map((l) => [l.feature, l.got])).toEqual([['A', 2], ['Curse', -1], ['B', 0]]);
  });

  it('a value already over the cap is never cut back, and takes no more', () => {
    const done = applyBonuses(22, { adds: [f('Ring', 2)], stop: 20 });
    expect(done.value).toBe(22);
    expect(done.lines).toEqual([{ ...f('Ring', 2), got: 0, stop: 20 }]);
  });

  it('bonuses that take away are never capped', () => {
    expect(applyBonuses(25, { adds: [f('Curse', -2)], stop: 20 }).value).toBe(23);
    expect(applyBonuses(20, { adds: [f('A', 2), f('B', -3)], stop: 20 }).value).toBe(19);
  });

  it('AT LEAST, last: sets it unless already higher, passing the cap (a Belt\'s 21)', () => {
    const done = applyBonuses(10, { adds: [f('A', 2)], least: [f('Amulet', 19)], stop: 20 });
    expect(done).toEqual({ value: 19, lines: [{ ...f('A', 2), got: 2 }, { ...f('Amulet', 19), got: 7, least: true }] });
    expect(applyBonuses(18, { adds: [f('Ring', 2)], least: [f('Belt', 21)], stop: 20 }).value).toBe(21);
    expect(applyBonuses(20, { least: [f('Amulet', 19)] }).lines).toEqual([{ ...f('Amulet', 19), got: 0, least: true }]);
    // Two: each in turn.
    expect(applyBonuses(10, { least: [f('A', 15), f('B', 12)] }).lines.map((l) => l.got)).toEqual([5, 0]);
  });

  it('nothing to count: as it is', () => {
    expect(applyBonuses(7)).toEqual({ value: 7, lines: [] });
    expect(applyBonuses(7, { stop: 5 })).toEqual({ value: 7, lines: [] });
  });

  it('a cap: a whole number from -9999 to 9999', () => {
    expect(stopOf(20)).toBe(20);
    expect(stopOf(-9999)).toBe(-9999);
    for (const bad of [10000, -10000, 2.5, '20', null, undefined]) expect(stopOf(bad), String(bad)).toBeNull();
  });
});

const HARDY = {
  format: 1, name: 'Hardy', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Con', stop: 20 }, { id: 'str', label: 'Str' }] }],
  derived: [{ id: 'defense', label: 'Defense', formula: '10 + @con', stop: 32 }, { id: 'grit', formula: '@defense + 1' }],
  choices: [{ id: 'feats', one: 'Feat', many: 'Feats', picks: 'any', options: [
    { id: 'tough', label: 'Tough', features: [{ id: 'tough_f', label: 'Tough', modifiers: [{ target: 'con', amount: '1' }, { target: 'defense', amount: '2' }] }] },
    { id: 'ring', label: 'Ring', features: [{ id: 'ring_f', label: 'Ring of Constitution', modifiers: [{ target: 'con', amount: '2' }, { target: 'hp_max', amount: '3' }] }] },
    { id: 'amulet', label: 'Amulet', features: [{ id: 'amulet_f', label: 'Amulet of Health', modifiers: [{ target: 'con', amount: '19', how: 'least' }] }] },
    { id: 'belt', label: 'Belt', features: [{ id: 'belt_f', label: 'Belt of Giant Strength', modifiers: [{ target: 'str', amount: '21', how: 'least' }, { target: 'defense', amount: '25', how: 'least' }] }] },
  ] }],
};
const holding = (...feats) => ({ [PICKS_KEY]: { feats } });

describe('on a stat', () => {
  it('a feat\'s +1 and a ring\'s +2 stop at 20, the ring named as cut', () => {
    const data = { con: 18, ...holding('tough', 'ring') };
    expect(effectiveData(HARDY, data).con).toBe(20);
    expect(overlayOf(HARDY, data).from.con).toEqual([
      { feature: 'Tough', amount: 1 }, { feature: 'Ring of Constitution', amount: 2, got: 1, stop: 20 },
    ]);
  });

  it('AT LEAST sets it, unless higher; a stat with no cap takes all', () => {
    expect(effectiveData(HARDY, { con: 12, ...holding('amulet') }).con).toBe(19);
    expect(overlayOf(HARDY, { con: 12, ...holding('amulet') }).from.con).toEqual([{ feature: 'Amulet of Health', amount: 19, got: 7, least: true }]);
    expect(effectiveData(HARDY, { con: 20, ...holding('amulet') }).con).toBe(20);
    expect(effectiveData(HARDY, { str: 23, ...holding('belt') }).str).toBe(23);
    expect(effectiveData(HARDY, { str: 15, ...holding('belt') }).str).toBe(21);
    expect(effectiveData({ ...HARDY, stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Con' }] }] }, { con: 18, ...holding('tough', 'ring') }).con).toBe(21);
  });

  it('the token\'s maximum only adds, as before', () => {
    const data = { ...holding('ring') };
    expect(overlayOf(HARDY, data).from.hp_max).toEqual([{ feature: 'Ring of Constitution', amount: 3 }]);
    expect(bonusOf(HARDY, data)).toBe(3);
  });
});

describe('on a formula', () => {
  const worked = (data) => {
    const sheet = { ...data };
    const overlay = overlayOf(HARDY, sheet);
    compileSystem({ derived: HARDY.derived }).system.apply(sheet, overlay);
    return { sheet, overlay, from: workedOf(HARDY, sheet, overlay).from };
  };

  it('its bonuses stop at its cap once it is worked out, and what reads it reads that', () => {
    // Con 18 +1 (Tough) +2 (Ring, cut to +1) = 20: Defense 30, +2 from Tough stops at 32.
    const { sheet, from } = worked({ con: 18, ...holding('tough', 'ring') });
    expect(sheet.defense).toBe(32);
    expect(sheet.grit).toBe(33);
    expect(from.defense).toEqual([{ feature: 'Tough', amount: 2 }]);
    // Con typed 25, over its cap and kept: Defense 35, already past 32, takes nothing more.
    const over = worked({ con: 25, ...holding('tough') });
    expect(over.sheet.defense).toBe(35);
    expect(over.from.defense).toEqual([{ feature: 'Tough', amount: 2, got: 0, stop: 32 }]);
    // Con 21 (cut to 20 by its cap... typed 21 is over it, kept): Defense 31 +2 cut to +1.
    const part = worked({ con: 21 });
    expect(part.sheet.defense).toBe(31);
    const cut = worked({ con: 21, ...holding('tough') });
    expect(cut.sheet.defense).toBe(32);
    expect(cut.from.defense).toEqual([{ feature: 'Tough', amount: 2, got: 1, stop: 32 }]);
  });

  it('AT LEAST on a formula, after its cap', () => {
    const { sheet, from } = worked({ con: 10, ...holding('belt') });
    expect(sheet.defense).toBe(25);
    expect(from.defense).toEqual([{ feature: 'Belt of Giant Strength', amount: 25, got: 5, least: true }]);
  });

  it('read without working it out, a formula\'s bonuses are named as they are', () => {
    expect(workedOf(HARDY, { con: 20, ...holding('tough', 'belt') }).from.defense).toEqual([
      { feature: 'Tough', amount: 2 }, { feature: 'Belt of Giant Strength', amount: 25, least: true },
    ]);
    expect(overlayOf(HARDY, { ...holding('tough') }).add).toEqual({ defense: 2 });
  });
});

describe('the system file', () => {
  it('carries AT LEAST and BONUSES STOP AT there and back, unchanged and sound', () => {
    const { buildFile, readFile } = require_('../systemBuilder/citysys');
    const read = readFile(JSON.stringify(buildFile({ definition: HARDY, version: 1, origin: 'sys_hardyhardyhardy' })));
    expect(read.problems).toEqual([]);
    expect(read.file.definition.stats).toEqual(HARDY.stats);
    expect(read.file.definition.derived).toEqual(HARDY.derived);
    expect(read.file.definition.choices).toEqual(HARDY.choices);
  });
});

describe('the checks', () => {
  const said = (definition) => checkDefinition(definition).problems.map((p) => `${p.where}: ${p.message}`);
  const withMod = (m) => ({ ...HARDY, choices: [{ ...HARDY.choices[0], options: [{ id: 'x', label: 'X', features: [{ id: 'x_f', label: 'X', modifiers: [m] }] }] }] });

  it('a sound system has none', () => {
    expect(said(HARDY)).toEqual([]);
  });

  it('a modifier ADDs or is AT LEAST; never AT LEAST on the token\'s maximum', () => {
    expect(said(withMod({ target: 'con', amount: '1', how: 'most' }))).toEqual(['list feats, option x, feature x_f, modifier 1, how: ADD, or AT LEAST']);
    expect(said(withMod({ target: 'hp_max', amount: '1', how: 'least' }))).toEqual(['list feats, option x, feature x_f, modifier 1, how: The token\'s maximum is only added to']);
    expect(said(withMod({ target: 'con', amount: '1', how: 'least' }))).toEqual([]);
  });

  it('BONUSES STOP AT on a stat or a formula: a whole number in range', () => {
    const stat = (stop) => ({ ...HARDY, stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Con', stop }, { id: 'str', label: 'Str' }] }] });
    for (const bad of [2.5, '20', 10000]) expect(said(stat(bad)), String(bad)).toEqual(['stat con, stop: A whole number from -9999 to 9999']);
    const formula = (stop) => ({ ...HARDY, derived: [{ id: 'defense', label: 'Defense', formula: '10 + @con', stop }, HARDY.derived[1]] });
    expect(said(formula('x'))).toEqual(['derived defense, stop: A whole number from -9999 to 9999']);
    expect(said({ ...HARDY, derived: [{ id: 'defense', formula: '10', stop: -1e5 }, HARDY.derived[1]] })).toEqual(['derived defense, stop: A whole number from -9999 to 9999']);
  });
});
