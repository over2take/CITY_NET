import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

/**
 * The ways a bonus counts (7e1; approved mockup docs/mockups/items.html, 2026-11-10; the cap moved onto the bonus, the
 * user's call the same day: "+2 Con, no higher than 20"): an ADD, which may say where it STOPS AT, and AT LEAST. Capped
 * ADDs first, then plain ones, then AT LEAST. Each bonus says what it really gave, for the sheet to name what a cap cut.
 */

const require_ = createRequire(import.meta.url);
const { applyBonuses, stopOf } = require_('../systemBuilder/bonuses');
const { PICKS_KEY, overlayOf, effectiveData, workedOf } = require_('../systemBuilder/choices');
const { checkDefinition } = require_('../systemBuilder/definition');
const { compileSystem } = require_('../systemBuilder/derived');
const { bonusOf } = require_('../systemBuilder/tokenMax');

const f = (feature, amount, cap) => ({ feature, amount, ...(cap === undefined ? {} : { cap }) });

describe('applyBonuses', () => {
  it('ADD sums them all', () => {
    expect(applyBonuses(14, { adds: [f('A', 2), f('B', 1)] })).toEqual({ value: 17, lines: [{ ...f('A', 2), got: 2 }, { ...f('B', 1), got: 1 }] });
  });

  it('a bonus that STOPS AT 20: two of them never pass it, the second named as cut', () => {
    const done = applyBonuses(19, { adds: [f('Tough', 2, 20), f('Ring', 2, 20)] });
    expect(done.value).toBe(20);
    expect(done.lines).toEqual([{ ...f('Tough', 2, 20), got: 1, stop: 20 }, { ...f('Ring', 2, 20), got: 0, stop: 20 }]);
  });

  it('capped ones first, judging the value before the plain ones join it, whatever order they are listed in', () => {
    const one = applyBonuses(19, { adds: [f('Belt', 5), f('Tough', 2, 20)] });
    const two = applyBonuses(19, { adds: [f('Tough', 2, 20), f('Belt', 5)] });
    expect(one.value).toBe(25);
    expect(two.value).toBe(25);
    // Lines in the order given.
    expect(one.lines.map((l) => [l.feature, l.got])).toEqual([['Belt', 5], ['Tough', 1]]);
  });

  it('caps of their own: each stops where it says', () => {
    expect(applyBonuses(18, { adds: [f('A', 2, 19), f('B', 2, 22)] }).lines.map((l) => l.got)).toEqual([1, 2]);
  });

  it('a value already past a cap is never cut back; that bonus adds nothing', () => {
    const done = applyBonuses(22, { adds: [f('Ring', 2, 20)] });
    expect(done.value).toBe(22);
    expect(done.lines).toEqual([{ ...f('Ring', 2, 20), got: 0, stop: 20 }]);
  });

  it('a bonus that takes away is never capped', () => {
    expect(applyBonuses(25, { adds: [f('Curse', -2, 20)] })).toEqual({ value: 23, lines: [{ ...f('Curse', -2, 20), got: -2 }] });
  });

  it('AT LEAST, last: sets it unless already higher, past any cap (a Belt\'s 21)', () => {
    const done = applyBonuses(10, { adds: [f('A', 2)], least: [f('Amulet', 19)] });
    expect(done).toEqual({ value: 19, lines: [{ ...f('A', 2), got: 2 }, { ...f('Amulet', 19), got: 7, least: true }] });
    expect(applyBonuses(18, { adds: [f('Ring', 2, 20)], least: [f('Belt', 21)] }).value).toBe(21);
    expect(applyBonuses(20, { least: [f('Amulet', 19)] }).lines).toEqual([{ ...f('Amulet', 19), got: 0, least: true }]);
    expect(applyBonuses(10, { least: [f('A', 15), f('B', 12)] }).lines.map((l) => l.got)).toEqual([5, 0]);
  });

  it('nothing to count: as it is', () => {
    expect(applyBonuses(7)).toEqual({ value: 7, lines: [] });
  });

  it('a cap: a whole number from -9999 to 9999', () => {
    expect(stopOf(20)).toBe(20);
    expect(stopOf(-9999)).toBe(-9999);
    for (const bad of [10000, -10000, 2.5, '20', null, undefined]) expect(stopOf(bad), String(bad)).toBeNull();
  });
});

const HARDY = {
  format: 1, name: 'Hardy', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Con' }, { id: 'str', label: 'Str' }] }],
  derived: [{ id: 'defense', label: 'Defense', formula: '10 + @con' }, { id: 'grit', formula: '@defense + 1' }],
  choices: [{ id: 'feats', one: 'Feat', many: 'Feats', picks: 'any', options: [
    { id: 'tough', label: 'Tough', features: [{ id: 'tough_f', label: 'Tough', modifiers: [{ target: 'con', amount: '1', cap: 20 }, { target: 'defense', amount: '2', cap: 32 }] }] },
    { id: 'ring', label: 'Ring', features: [{ id: 'ring_f', label: 'Ring of Constitution', modifiers: [{ target: 'con', amount: '2', cap: 20 }, { target: 'hp_max', amount: '3' }] }] },
    { id: 'amulet', label: 'Amulet', features: [{ id: 'amulet_f', label: 'Amulet of Health', modifiers: [{ target: 'con', amount: '19', how: 'least' }] }] },
    { id: 'belt', label: 'Belt', features: [{ id: 'belt_f', label: 'Belt of Giant Strength', modifiers: [{ target: 'str', amount: '21', how: 'least' }, { target: 'defense', amount: '25', how: 'least' }] }] },
    { id: 'plain', label: 'Plain', features: [{ id: 'plain_f', label: 'Plain', modifiers: [{ target: 'con', amount: '2' }] }] },
  ] }],
};
const holding = (...feats) => ({ [PICKS_KEY]: { feats } });

describe('on a stat', () => {
  it('Tough\'s +1 and the Ring\'s +2, each stopping at 20, the Ring named as cut', () => {
    const data = { con: 18, ...holding('tough', 'ring') };
    expect(effectiveData(HARDY, data).con).toBe(20);
    expect(overlayOf(HARDY, data).from.con).toEqual([
      { feature: 'Tough', amount: 1 }, { feature: 'Ring of Constitution', amount: 2, got: 1, stop: 20 },
    ]);
  });

  it('a bonus with no cap takes all', () => {
    expect(effectiveData(HARDY, { con: 19, ...holding('plain', 'ring') }).con).toBe(22);
  });

  it('AT LEAST sets it, unless higher', () => {
    expect(effectiveData(HARDY, { con: 12, ...holding('amulet') }).con).toBe(19);
    expect(overlayOf(HARDY, { con: 12, ...holding('amulet') }).from.con).toEqual([{ feature: 'Amulet of Health', amount: 19, got: 7, least: true }]);
    expect(effectiveData(HARDY, { con: 20, ...holding('amulet') }).con).toBe(20);
    expect(effectiveData(HARDY, { str: 23, ...holding('belt') }).str).toBe(23);
    expect(effectiveData(HARDY, { str: 15, ...holding('belt') }).str).toBe(21);
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
    return { sheet, from: workedOf(HARDY, sheet, overlay).from };
  };

  it('its bonuses counted once it is worked out, each stopping where it says; what reads it reads that', () => {
    // Con 21 typed: Defense 31, Tough's +2 stops at 32.
    const { sheet, from } = worked({ con: 21, ...holding('tough') });
    expect(sheet.defense).toBe(32);
    expect(sheet.grit).toBe(33);
    expect(from.defense).toEqual([{ feature: 'Tough', amount: 2, got: 1, stop: 32 }]);
    expect(worked({ con: 18, ...holding('tough') }).from.defense).toEqual([{ feature: 'Tough', amount: 2 }]);
  });

  it('AT LEAST on a formula, last', () => {
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
  it('carries AT LEAST and STOPS AT there and back, unchanged and sound', () => {
    const { buildFile, readFile } = require_('../systemBuilder/citysys');
    const read = readFile(JSON.stringify(buildFile({ definition: HARDY, version: 1, origin: 'sys_hardyhardyhardy' })));
    expect(read.problems).toEqual([]);
    expect(read.file.definition.choices).toEqual(HARDY.choices);
  });
});

describe('the checks', () => {
  const said = (definition) => checkDefinition(definition).problems.map((p) => `${p.where}: ${p.message}`);
  const withMod = (m) => ({ ...HARDY, choices: [{ ...HARDY.choices[0], options: [{ id: 'x', label: 'X', features: [{ id: 'x_f', label: 'X', modifiers: [m] }] }] }] });
  const at = 'list feats, option x, feature x_f, modifier 1';

  it('a sound system has none', () => {
    expect(said(HARDY)).toEqual([]);
  });

  it('a modifier ADDs or is AT LEAST; never AT LEAST on the token\'s maximum', () => {
    expect(said(withMod({ target: 'con', amount: '1', how: 'most' }))).toEqual([`${at}, how: ADD, or AT LEAST`]);
    expect(said(withMod({ target: 'hp_max', amount: '1', how: 'least' }))).toEqual([`${at}, how: The token's maximum is only added to`]);
    expect(said(withMod({ target: 'con', amount: '1', how: 'least' }))).toEqual([]);
  });

  it('STOPS AT: a whole number in range, on an ADD, never on the token\'s maximum', () => {
    for (const bad of [2.5, '20', 10000]) expect(said(withMod({ target: 'con', amount: '2', cap: bad })), String(bad)).toEqual([`${at}, cap: A whole number from -9999 to 9999`]);
    expect(said(withMod({ target: 'con', amount: '19', how: 'least', cap: 20 }))).toEqual([`${at}, cap: Only an ADD stops somewhere: AT LEAST is a value already`]);
    expect(said(withMod({ target: 'hp_max', amount: '2', cap: 20 }))).toEqual([`${at}, cap: The token's maximum is only added to`]);
    expect(said(withMod({ target: 'defense', amount: '2', cap: -5 }))).toEqual([]);
  });

  it('a stat or formula has no cap of its own', () => {
    const stat = { ...HARDY, stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Con', stop: 20 }, { id: 'str', label: 'Str' }] }] };
    expect(said(stat)).toEqual(['stat con, stop: Not part of a stat']);
  });
});
