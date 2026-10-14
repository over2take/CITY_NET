/**
 * What a new version of a system changes (4h1a; approved mockup docs/mockups/version-preview.html,
 * 2026-10-13): the changes themselves, what they mean for one character's sheet, and the
 * worked-out values on the SAMPLE values for a system nobody plays yet. Nothing here writes.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { OTHER, versionChanges, characterChanges, sampleChanges } = require_('../systemBuilder/versionDiff');
const { PARTS } = require_('../systemBuilder/parts');

const sheet = (fields) => ({ tabs: ['MAIN'], sections: [{ id: 'main', label: 'MAIN', layout: 'list', fields }] });
const CALLING = { id: 'calling', label: 'Calling', type: 'select', options: [{ value: 'knight', label: 'Knight' }, { value: 'hedge', label: 'Hedge mage' }, { label: 'Bard' }] };

/** HEARTH v2, as the game runs it. */
const V2 = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'attrs', label: 'ATTRIBUTES', stats: [{ id: 'might', label: 'Might', min: 3, max: 20 }, { id: 'agility', label: 'Agility', min: 3, max: 18 }] }],
  samples: { might: 12, agility: 14 },
  derived: [{ id: 'defense', label: 'Defense', formula: '10 + @agility' }, { id: 'old_bonus', formula: '@might' }],
  sheet: sheet([
    { id: 'name', label: 'Name', type: 'text' },
    { id: 'grit', label: 'Grit', type: 'number' },
    { id: 'reputation', label: 'Reputation', type: 'number' },
    { id: 'wound_notes', label: 'Wound notes', type: 'textarea' },
    { id: 'secret', label: 'Secret', type: 'text', edit: 'gm' },
    CALLING,
    { id: 'defense', label: 'Defense', type: 'number' },
    { id: 'old_bonus', label: 'Old bonus', type: 'number' },
  ]),
  currencies: [{ id: 'gold', name: 'Gold' }, { id: 'favor', name: 'Favor' }],
  conditions: { cursed: { name: 'Cursed' } },
};

/** The draft, v3: a little of everything. */
const V3 = {
  ...V2,
  name: 'Hearth',
  words: { gm: { singular: 'Keeper' } },
  stats: [{ id: 'attrs', label: 'ATTRIBUTES', stats: [{ id: 'might', label: 'Might', min: 3, max: 18 }, { id: 'agility', label: 'Agility', min: 3, max: 18 }] }],
  derived: [
    { id: 'defense', label: 'Defense', formula: '10 + @agility + 2' },
    { id: 'carry', label: 'Carry limit', formula: '@might - 4' },
  ],
  sheet: sheet([
    { id: 'name', label: 'Name', type: 'text' },
    { id: 'grit', label: 'Resolve', type: 'number' },
    { id: 'wound_notes', label: 'Wound notes', type: 'textarea', edit: 'gm' },
    { id: 'secret', label: 'Secret', type: 'text' },
    { ...CALLING, options: [CALLING.options[0], CALLING.options[2]] },
    { id: 'defense', label: 'Defense', type: 'number' },
    { id: 'carry', label: 'Carry limit', type: 'number' },
    { id: 'oath', label: 'Oath', type: 'text' },
  ]),
  currencies: [{ id: 'gold', name: 'Gold' }, { id: 'coin', name: 'Coin' }],
  parts: { vehicles: { on: false } },
  conditions: { glitch: { name: 'Glitching' } },
  core: { health: { model: 'tracks' } },
};

const of = (changes, kind) => changes.filter((c) => c.kind === kind);

describe('what a new version changes', () => {
  const changes = versionChanges(V2, V3);

  it('on the sheet: gone, new, renamed, now GM-only, open to players again, and choices taken away', () => {
    expect(of(changes, 'sheet')).toEqual([
      { kind: 'sheet', change: 'renamed', id: 'grit', from: 'Grit', to: 'Resolve' },
      { kind: 'sheet', change: 'removed', id: 'reputation', label: 'Reputation' },
      { kind: 'sheet', change: 'gm_only', id: 'wound_notes', label: 'Wound notes' },
      { kind: 'sheet', change: 'player_edit', id: 'secret', label: 'Secret' },
      { kind: 'sheet', change: 'options_removed', id: 'calling', label: 'Calling', options: [{ value: 'hedge', label: 'Hedge mage' }] },
      { kind: 'sheet', change: 'added', id: 'oath', label: 'Oath' },
    ]);
  });

  it('formulas changed, new and gone, each said once (not again as a sheet field)', () => {
    expect(of(changes, 'formula')).toEqual([
      { kind: 'formula', change: 'changed', id: 'defense', label: 'Defense', from: '10 + @agility', to: '10 + @agility + 2' },
      { kind: 'formula', change: 'removed', id: 'old_bonus', label: 'OLD BONUS' },
      { kind: 'formula', change: 'added', id: 'carry', label: 'Carry limit', to: '@might - 4' },
    ]);
  });

  it('a stat\'s new range, the health model, money, features and conditions', () => {
    expect(of(changes, 'stat')).toEqual([{ kind: 'stat', change: 'range', id: 'might', label: 'Might', from: { min: 3, max: 20 }, to: { min: 3, max: 18 } }]);
    expect(of(changes, 'health')).toEqual([{ kind: 'health', change: 'changed', id: 'health', from: 'pool', to: 'tracks' }]);
    expect(of(changes, 'currency')).toEqual([
      { kind: 'currency', change: 'removed', id: 'favor', label: 'Favor' },
      { kind: 'currency', change: 'added', id: 'coin', label: 'Coin' },
    ]);
    expect(of(changes, 'part')).toEqual([{ kind: 'part', change: 'off', id: 'vehicles' }]);
    expect(of(changes, 'condition')).toEqual([
      { kind: 'condition', change: 'removed', id: 'cursed', label: 'Cursed' },
      { kind: 'condition', change: 'added', id: 'glitch', label: 'Glitching' },
    ]);
  });

  it('names the sections that change nothing on a character', () => {
    expect(of(changes, 'other')).toEqual([{ kind: 'other', change: 'changed', id: 'words' }]);
    expect(OTHER).toEqual(expect.arrayContaining(['words', 'rests', 'npc', 'buildings', 'lookups']));
  });

  it('is nothing at all between a version and itself, and turns back what it found the other way', () => {
    expect(versionChanges(V2, V2)).toEqual([]);
    expect(versionChanges(V2, JSON.parse(JSON.stringify(V2)))).toEqual([]);
    const back = versionChanges(V3, V2);
    expect(back).toContainEqual({ kind: 'part', change: 'on', id: 'vehicles' });
    expect(back).toContainEqual({ kind: 'sheet', change: 'removed', id: 'oath', label: 'Oath' });
    expect(back).toContainEqual({ kind: 'health', change: 'changed', id: 'health', from: 'tracks', to: 'pool' });
  });

  it('reads token health turned off as no health at all', () => {
    expect(of(versionChanges(V2, { ...V2, parts: { token_health: { on: false } } }), 'health'))
      .toEqual([{ kind: 'health', change: 'changed', id: 'health', from: 'pool', to: 'none' }]);
  });

  it('sees every part, either way', () => {
    const off = Object.fromEntries(PARTS.map((p) => [p, { on: false }]));
    expect(of(versionChanges(V2, { ...V2, parts: off }), 'part').map((c) => c.id)).toEqual(PARTS);
  });

  it('a choice with no value of its own, a field no longer a choice, and a stat new in this version', () => {
    const noBard = { ...V2, sheet: sheet([{ ...CALLING, options: CALLING.options.slice(0, 2) }]) };
    const v2 = { ...V2, sheet: sheet([CALLING]) };
    expect(of(versionChanges(v2, noBard), 'sheet')).toEqual([{ kind: 'sheet', change: 'options_removed', id: 'calling', label: 'Calling', options: [{ value: 'Bard', label: 'Bard' }] }]);
    expect(of(versionChanges(v2, { ...V2, sheet: sheet([{ id: 'calling', label: 'Calling', type: 'text' }]) }), 'sheet')).toEqual([]);
    expect(of(versionChanges({ ...V2, sheet: sheet([{ id: 'calling', label: 'Calling', type: 'text' }]) }, v2), 'sheet')).toEqual([]);
    const more = { ...V2, stats: [{ id: 'attrs', label: 'A', stats: [...V2.stats[0].stats, { id: 'wits', label: 'Wits', min: 1, max: 5 }] }] };
    expect(of(versionChanges(V2, more), 'stat')).toEqual([]);
  });

  it('works numbers out with the version\'s own lookup tables', () => {
    const tabled = (gives) => ({ ...V2, lookups: { size: { bands: [{ value: gives }] } }, derived: [{ id: 'bulk', label: 'Bulk', formula: 'size(@might)' }] });
    expect(characterChanges(tabled(2), tabled(3), { might: 10 }).filter((c) => c.kind === 'formula')).toEqual([{ kind: 'formula', change: 'value', id: 'bulk', label: 'Bulk', from: 2, to: 3 }]);
  });

  it('a field whose label is blank is named by its id', () => {
    const blank = { ...V2, sheet: sheet([{ id: 'grit', label: '', type: 'number' }]) };
    expect(of(versionChanges(blank, { ...V2, sheet: sheet([]) }), 'sheet')).toEqual([{ kind: 'sheet', change: 'removed', id: 'grit', label: 'grit' }]);
  });

  it('a condition formula reads as one', () => {
    const cond = { ...V2, derived: [{ id: 'defense', kind: 'condition', when: '@agility > 15', then: '14', else: '12' }] };
    expect(of(versionChanges(V2, cond), 'formula')[0]).toMatchObject({ change: 'changed', to: 'if @agility > 15 then 14 else 12' });
  });
});

describe('what it means for one character', () => {
  it('a value that stops showing, a choice that goes and a stat past its range, all kept, and numbers old to new', () => {
    const vex = { name: 'Vex', might: 19, agility: 14, reputation: 3, calling: 'hedge', grit: 2 };
    expect(characterChanges(V2, V3, vex)).toEqual([
      { kind: 'sheet', change: 'removed', id: 'reputation', label: 'Reputation', value: 3 },
      { kind: 'sheet', change: 'options_removed', id: 'calling', label: 'Calling', options: [{ value: 'hedge', label: 'Hedge mage' }], value: 'hedge' },
      { kind: 'stat', change: 'outside', id: 'might', label: 'Might', value: 19, min: 3, max: 18 },
      { kind: 'formula', change: 'value', id: 'defense', label: 'Defense', from: 24, to: 26 },
      { kind: 'formula', change: 'value', id: 'carry', label: 'Carry limit', from: null, to: 15 },
    ]);
  });

  it('nothing for a sheet the changes don\'t touch, beyond its numbers', () => {
    const rook = { name: 'Rook', might: 10, agility: 12, reputation: '  ', calling: 'knight' };
    expect(characterChanges(V2, V3, rook)).toEqual([
      { kind: 'formula', change: 'value', id: 'defense', label: 'Defense', from: 22, to: 24 },
      { kind: 'formula', change: 'value', id: 'carry', label: 'Carry limit', from: null, to: 6 },
    ]);
  });

  it('only the numbers that change', () => {
    const same = { ...V3, derived: [V2.derived[0], V3.derived[1]] };
    expect(characterChanges(V2, same, { might: 10, agility: 12 }).map((c) => c.id)).toEqual(['carry']);
  });

  it('a value below a new lowest is past it too; a blank or unreadable one is not', () => {
    const higher = { ...V2, stats: [{ id: 'attrs', label: 'A', stats: [{ id: 'might', label: 'Might', min: 8, max: 20 }] }] };
    expect(characterChanges(V2, higher, { might: 5 }).filter((c) => c.kind === 'stat')).toEqual([{ kind: 'stat', change: 'outside', id: 'might', label: 'Might', value: 5, min: 8, max: 20 }]);
    expect(characterChanges(V2, higher, { might: 8 }).filter((c) => c.kind === 'stat')).toEqual([]);
    expect(characterChanges(V2, higher, { might: '' }).filter((c) => c.kind === 'stat')).toEqual([]);
    expect(characterChanges(V2, higher, { might: 'lots' }).filter((c) => c.kind === 'stat')).toEqual([]);
    const open = { ...V2, stats: [{ id: 'attrs', label: 'A', stats: [{ id: 'might', label: 'Might' }] }] };
    expect(characterChanges(V2, open, { might: 99 }).filter((c) => c.kind === 'stat')).toEqual([]);
  });

  it('reads no sheet as an empty one', () => {
    expect(characterChanges(V2, V3, null).filter((c) => c.kind !== 'formula')).toEqual([]);
  });

  it('every number new where the old version\'s formulas can\'t run', () => {
    const broken = { ...V2, derived: [{ id: 'defense', formula: '10 +' }] };
    expect(characterChanges(broken, V3, { might: 10, agility: 12 }).map((c) => [c.id, c.from, c.to])).toEqual([['defense', null, 24], ['carry', null, 6]]);
    expect(characterChanges(V2, broken, { might: 10, agility: 12 }).filter((c) => c.kind === 'formula')).toEqual([]);
  });
});

describe('a system nobody plays yet', () => {
  it('shows the numbers that change on the draft\'s SAMPLE values', () => {
    expect(sampleChanges(V2, V3)).toEqual([
      { kind: 'formula', change: 'value', id: 'defense', label: 'Defense', from: 24, to: 26 },
      { kind: 'formula', change: 'value', id: 'carry', label: 'Carry limit', from: null, to: 8 },
    ]);
  });

  it('works out a draft with no samples on blank values', () => {
    expect(sampleChanges(V2, { ...V3, samples: undefined })).toEqual([
      { kind: 'formula', change: 'value', id: 'defense', label: 'Defense', from: 10, to: 12 },
      { kind: 'formula', change: 'value', id: 'carry', label: 'Carry limit', from: null, to: -4 },
    ]);
  });
});

describe('house rules (4j5c)', () => {
  const RULES = [{ id: 'magic', name: 'Magic' }, { id: 'gritty', name: 'Gritty', starts: true }];
  const base = { format: 1, name: 'Hearth', house_rules: RULES, derived: [{ id: 'hp', label: 'HP max', formula: '10' }, { id: 'mana', formula: '2', alternative: { rule: 'magic', formula: '4' } }] };
  const changes = (after, before = base) => versionChanges(before, after).filter((c) => c.kind === 'house_rule' || c.change === 'alternative');

  it('lists a rule added, gone, renamed, or starting the other way', () => {
    const plain = { format: 1, name: 'Hearth', house_rules: RULES };
    expect(changes({ ...plain, house_rules: [{ id: 'gritty', name: 'Grim', starts: false }, { id: 'markets', name: 'Markets', starts: true }] }, plain)).toEqual([
      { kind: 'house_rule', change: 'removed', id: 'magic', label: 'Magic' },
      { kind: 'house_rule', change: 'renamed', id: 'gritty', from: 'Gritty', to: 'Grim' },
      { kind: 'house_rule', change: 'starts', id: 'gritty', label: 'Grim', to: false },
      { kind: 'house_rule', change: 'added', id: 'markets', label: 'Markets', to: true },
    ]);
  });
  it('lists a formula\'s alternative added, rewritten, moved to another rule or gone, by the rule\'s name', () => {
    const with_ = (hp, mana) => ({ ...base, derived: [{ id: 'hp', label: 'HP max', formula: '10', ...(hp ? { alternative: hp } : {}) }, { id: 'mana', formula: '2', ...(mana ? { alternative: mana } : {}) }] });
    expect(changes(with_({ rule: 'gritty', formula: '6' }, { rule: 'magic', formula: '5' }))).toEqual([
      { kind: 'formula', change: 'alternative', id: 'hp', label: 'HP max', from: null, to: { rule: 'Gritty', formula: '6' } },
      { kind: 'formula', change: 'alternative', id: 'mana', label: 'MANA', from: { rule: 'Magic', formula: '4' }, to: { rule: 'Magic', formula: '5' } },
    ]);
    expect(changes(with_(null, { rule: 'gritty', formula: '4' }))).toEqual([
      { kind: 'formula', change: 'alternative', id: 'mana', label: 'MANA', from: { rule: 'Magic', formula: '4' }, to: { rule: 'Gritty', formula: '4' } },
    ]);
    expect(changes(with_(null, null))).toEqual([
      { kind: 'formula', change: 'alternative', id: 'mana', label: 'MANA', from: { rule: 'Magic', formula: '4' }, to: null },
    ]);
  });

  it('lists nothing when nothing about them changed, or a system has none', () => {
    expect(changes(base)).toEqual([]);
    expect(changes({ format: 1, name: 'Plain' }, { format: 1, name: 'Plain' })).toEqual([]);
  });
});