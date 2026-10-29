/**
 * Lists inside lists (7a5a1). Approved mockup nested-choices (2026-10-28): a list picked THROUGH
 * FEATURES gets a pick under each unlocked feature that opens it (as many as the feature says, stored
 * with `from`), BOTH adds its own picks too; a pick whose feature locks again is kept, not counted, and
 * counts again once it unlocks; nesting goes as deep as the lists do, never round in a loop.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { PICKS_KEY, heldOf, picksOf, workedOf, overlayOf, choicesShown, loopsOf } = require_('../systemBuilder/choices');
const { pickAction } = require_('../systemBuilder/picking');
const { checkDefinition } = require_('../systemBuilder/definition');

const HEARTH = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'int', label: 'Intellect' }] }],
  derived: [{ id: 'defense', label: 'Defense', formula: '10' }],
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, again: true, options: [
      { id: 'soldier', label: 'Soldier', features: [
        { id: 'specialty', label: 'Specialty', at: 3, choice: 'specialties' },
        { id: 'feat_6', label: 'Feat', at: 6, choice: 'feats', choice_count: 2 },
      ] },
      { id: 'mage', label: 'Mage', features: [{ id: 'cantrip', label: 'Cantrip', choice: 'feats' }] },
    ] },
    { id: 'specialties', one: 'Specialty', many: 'Specialties', picked: 'features', options: [
      { id: 'duelist', label: 'Duelist', features: [
        { id: 'riposte', label: 'Riposte', modifiers: [{ target: 'defense', amount: '1' }] },
        { id: 'school', label: 'School', choice: 'schools' },
      ] },
      { id: 'vanguard', label: 'Vanguard', requires: '@int >= 13' },
    ] },
    { id: 'schools', one: 'School', many: 'Schools', picked: 'features', levelled: true, options: [{ id: 'iron', label: 'Iron' }] },
    { id: 'feats', one: 'Feat', many: 'Feats', picked: 'both', options: [
      { id: 'tough', label: 'Tough' }, { id: 'quick', label: 'Quick' }, { id: 'keen', label: 'Keen' }, { id: 'lucky', label: 'Lucky' },
    ] },
    { id: 'origins', one: 'Origin', many: 'Origins', options: [{ id: 'port', label: 'Port' }] },
  ],
};
const sheet = (stored, extra = {}) => ({ int: 10, ...extra, [PICKS_KEY]: stored });
const soldierAt = (level) => ({ classes: [{ option: 'soldier', level }] });
const ids = (picks) => picks.map((p) => `${p.list.id}:${p.option.id}${p.from ? `<${p.from}` : ''}${p.active === false ? ' (waiting)' : ''}`);
const problems = (def) => checkDefinition(def).problems.map((p) => `${p.where}: ${p.message}`);
const withList = (id, patch) => ({ ...HEARTH, choices: HEARTH.choices.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

describe('the checks', () => {
  it('takes the system as it is', () => {
    expect(problems(HEARTH)).toEqual([]);
  });

  it('a list is picked on its own, through features or both; a feature opening a list says how many, 1 to 10', () => {
    expect(problems(withList('origins', { picked: 'sometimes' }))).toEqual(['list origins, picked: own (on its own), features (through the features that open it) or both']);
    const count = (f) => ({ ...HEARTH, choices: HEARTH.choices.map((c) => (c.id === 'origins' ? { ...c, options: [{ id: 'port', label: 'Port', features: [f] }] } : c)) });
    expect(problems(count({ id: 'dock', label: 'Dock', choice_count: 2 }))).toEqual(['list origins, option port, feature dock, choice_count: Only a feature that opens a list says how many']);
    expect(problems(count({ id: 'dock', label: 'Dock', choice: 'feats', choice_count: 11 }))).toEqual(['list origins, option port, feature dock, choice_count: A number from 1 to 10']);
    expect(problems(count({ id: 'dock', label: 'Dock', choice: 'feats', choice_count: 1.5 }))).toEqual(['list origins, option port, feature dock, choice_count: A number from 1 to 10']);
  });

  it('lists never open each other in a loop, the way round named for each list on it', () => {
    const loop = withList('schools', { options: [{ id: 'iron', label: 'Iron', features: [{ id: 'back', label: 'Back', choice: 'classes' }] }] });
    expect(problems(loop)).toEqual([
      'list classes: Its features open lists that lead back to it: CLASSES → SPECIALTIES → SCHOOLS → CLASSES',
      'list specialties: Its features open lists that lead back to it: SPECIALTIES → SCHOOLS → CLASSES → SPECIALTIES',
      'list schools: Its features open lists that lead back to it: SCHOOLS → CLASSES → SPECIALTIES → SCHOOLS',
    ]);
    expect(loopsOf(HEARTH)).toEqual([]);
  });
});

describe('reading the picks', () => {
  it('counts a pick under a feature while that feature is unlocked, and keeps it waiting when it locks', () => {
    const stored = { ...soldierAt(3), specialties: [{ option: 'duelist', from: 'specialty' }] };
    expect(ids(heldOf(HEARTH, sheet(stored)))).toEqual(['classes:soldier', 'specialties:duelist<specialty']);
    const lowered = { ...stored, ...soldierAt(2) };
    expect(ids(heldOf(HEARTH, sheet(lowered)))).toEqual(['classes:soldier', 'specialties:duelist<specialty (waiting)']);
    expect(ids(picksOf(HEARTH, sheet(lowered)))).toEqual(['classes:soldier']);
    // The class taken away: kept the same way, in case it comes back.
    expect(ids(heldOf(HEARTH, sheet({ specialties: stored.specialties })))).toEqual(['specialties:duelist<specialty (waiting)']);
  });

  it('gives as many picks under a feature as it says, the rest waiting', () => {
    const stored = { ...soldierAt(6), feats: [{ option: 'tough', from: 'feat_6' }, { option: 'quick', from: 'feat_6' }, { option: 'keen', from: 'feat_6' }] };
    expect(ids(heldOf(HEARTH, sheet(stored)))).toEqual(['classes:soldier', 'feats:tough<feat_6', 'feats:quick<feat_6', 'feats:keen<feat_6 (waiting)']);
  });

  it('counts a pick only under a feature opening its own list, whatever a sheet says', () => {
    const stored = { ...soldierAt(3), feats: [{ option: 'tough', from: 'specialty' }] };
    expect(ids(heldOf(HEARTH, sheet(stored)))).toEqual(['classes:soldier', 'feats:tough<specialty (waiting)']);
  });

  it('a list picked both ways counts its own picks and those under features apart', () => {
    const stored = { ...soldierAt(6), feats: [{ option: 'lucky' }, { option: 'keen' }, { option: 'tough', from: 'feat_6' }] };
    // Its own: one (A CHARACTER PICKS); the second own pick past that was never kept.
    expect(ids(heldOf(HEARTH, sheet(stored)))).toEqual(['classes:soldier', 'feats:lucky', 'feats:tough<feat_6']);
  });

  it('keeps picks a list\'s way of picking no longer counts, for if it changes back', () => {
    const own = withList('specialties', { picked: 'own' });
    expect(ids(heldOf(own, sheet({ ...soldierAt(3), specialties: [{ option: 'duelist', from: 'specialty' }] })))).toEqual(['classes:soldier', 'specialties:duelist<specialty (waiting)']);
    expect(ids(heldOf(HEARTH, sheet({ specialties: [{ option: 'duelist' }] })))).toEqual(['specialties:duelist (waiting)']);
    // A feature opening a list picked on its own gives nothing to pick under it.
    expect(workedOf(own, sheet(soldierAt(3))).opens).toEqual([]);
  });

  it('goes as deep as the lists go, each level waiting on the one above', () => {
    const stored = { ...soldierAt(3), specialties: [{ option: 'duelist', from: 'specialty' }], schools: [{ option: 'iron', level: 2, from: 'school' }] };
    expect(ids(heldOf(HEARTH, sheet(stored)))).toEqual(['classes:soldier', 'specialties:duelist<specialty', 'schools:iron<school']);
    expect(ids(heldOf(HEARTH, sheet({ ...stored, ...soldierAt(1) })))).toEqual(['classes:soldier', 'specialties:duelist<specialty (waiting)', 'schools:iron<school (waiting)']);
    // Order on the sheet doesn't matter: a deeper pick stored first still counts.
    const reversed = { schools: stored.schools, specialties: stored.specialties, ...soldierAt(3) };
    expect(ids(picksOf(HEARTH, sheet(reversed)))).toEqual(['classes:soldier', 'specialties:duelist<specialty', 'schools:iron<school']);
  });

  it('only what counts reaches the numbers: a waiting pick\'s bonus and level are gone', () => {
    const stored = { ...soldierAt(3), specialties: [{ option: 'duelist', from: 'specialty' }], schools: [{ option: 'iron', level: 2, from: 'school' }] };
    expect(overlayOf(HEARTH, sheet(stored))).toMatchObject({ add: { defense: 1 }, levels: { iron_level: 2, schools_level: 2 } });
    expect(overlayOf(HEARTH, sheet({ ...stored, ...soldierAt(2) }))).toMatchObject({ add: {}, levels: { iron_level: 0, schools_level: 0 } });
  });
});

describe('what the sheet is told', () => {
  it('every pick kept, those waiting marked, and each feature\'s picks open', () => {
    const stored = { ...soldierAt(6), specialties: [{ option: 'duelist', from: 'specialty' }], feats: [{ option: 'tough', from: 'feat_6' }], schools: [{ option: 'iron', from: 'school', level: 1 }] };
    const worked = workedOf(HEARTH, sheet({ ...stored, ...soldierAt(6) }));
    expect(worked.picks).toEqual([
      { list: 'classes', option: 'soldier', level: 6 },
      { list: 'specialties', option: 'duelist', from: 'specialty' },
      { list: 'schools', option: 'iron', level: 1, from: 'school' },
      { list: 'feats', option: 'tough', from: 'feat_6' },
    ]);
    expect(worked.opens).toEqual([
      { feature: 'specialty', list: 'specialties', count: 1, used: 1 },
      { feature: 'feat_6', list: 'feats', count: 2, used: 1 },
      { feature: 'school', list: 'schools', count: 1, used: 1 },
    ]);
    const lowered = workedOf(HEARTH, sheet({ ...stored, ...soldierAt(2) }));
    expect(lowered.picks.filter((p) => p.waiting).map((p) => p.option)).toEqual(['duelist', 'iron', 'tough']);
    expect(lowered.opens).toEqual([]);
  });

  it('each list\'s way of picking, and how many a feature opens', () => {
    const shown = choicesShown(HEARTH);
    expect(shown.map((c) => c.picked)).toEqual(['own', 'features', 'features', 'both', 'own']);
    expect(shown[0].options[0].features.map((f) => [f.opens, f.opensCount])).toEqual([['specialties', 1], ['feats', 2]]);
  });
});

describe('picking under a feature', () => {
  const at = (level, more = {}) => sheet({ ...soldierAt(level), ...more });

  it('picks under a feature that is unlocked and has room, storing which', () => {
    const r = pickAction(HEARTH, at(3), { kind: 'pick', list: 'specialties', option: 'duelist', from: 'specialty' });
    expect(r.ok).toBe(true);
    expect(r.data[PICKS_KEY].specialties).toEqual([{ option: 'duelist', from: 'specialty' }]);
    expect(pickAction(HEARTH, r.data, { kind: 'pick', list: 'specialties', option: 'vanguard', from: 'specialty', gm: true }, { gm: true }))
      .toEqual({ ok: false, error: 'No more Specialties can be picked there' });
  });

  it('refuses a feature not yet unlocked, one opening another list, and a list picked through features without one', () => {
    expect(pickAction(HEARTH, at(2), { kind: 'pick', list: 'specialties', option: 'duelist', from: 'specialty' })).toEqual({ ok: false, error: 'Nothing unlocked there opens the Specialties' });
    expect(pickAction(HEARTH, at(6), { kind: 'pick', list: 'specialties', option: 'duelist', from: 'feat_6' })).toEqual({ ok: false, error: 'Nothing unlocked there opens the Specialties' });
    expect(pickAction(HEARTH, at(3), { kind: 'pick', list: 'specialties', option: 'duelist' })).toEqual({ ok: false, error: 'The Specialties are picked under the features that open them' });
    expect(pickAction(HEARTH, at(3), { kind: 'pick', list: 'origins', option: 'port', from: 'specialty' })).toEqual({ ok: false, error: 'The Origins aren\'t picked under features' });
  });

  it('a list picked both ways: its own picks up to what it allows, and under features apart', () => {
    const own = pickAction(HEARTH, at(6), { kind: 'pick', list: 'feats', option: 'lucky' });
    expect(own.ok).toBe(true);
    expect(pickAction(HEARTH, own.data, { kind: 'pick', list: 'feats', option: 'keen' })).toEqual({ ok: false, error: 'No more Feats can be picked' });
    const under = pickAction(HEARTH, own.data, { kind: 'pick', list: 'feats', option: 'keen', from: 'feat_6' });
    expect(under.data[PICKS_KEY].feats).toEqual([{ option: 'lucky' }, { option: 'keen', from: 'feat_6' }]);
  });

  it('keeps a waiting pick when another is stored, and won\'t pick it twice', () => {
    const waiting = at(2, { specialties: [{ option: 'duelist', from: 'specialty' }], feats: [{ option: 'tough', from: 'cantrip' }] });
    expect(pickAction(HEARTH, waiting, { kind: 'pick', list: 'specialties', option: 'duelist', from: 'specialty' })).toEqual({ ok: false, error: 'Duelist is already picked' });
    const levelled = pickAction(HEARTH, waiting, { kind: 'level', list: 'classes', option: 'soldier', level: 1 });
    expect(levelled.data[PICKS_KEY].specialties).toEqual([{ option: 'duelist', from: 'specialty' }]);
    const mage = pickAction(HEARTH, waiting, { kind: 'pick', list: 'feats', option: 'quick' });
    expect(mage.data[PICKS_KEY].feats).toEqual([{ option: 'tough', from: 'cantrip' }, { option: 'quick' }]);
  });

  it('the GM takes a waiting pick away; a requirement still holds under a feature', () => {
    const waiting = at(2, { specialties: [{ option: 'duelist', from: 'specialty' }] });
    expect(pickAction(HEARTH, waiting, { kind: 'drop', list: 'specialties', option: 'duelist' }, { gm: true }).data[PICKS_KEY].specialties).toEqual([]);
    expect(pickAction(HEARTH, at(3), { kind: 'pick', list: 'specialties', option: 'vanguard', from: 'specialty' })).toEqual({ ok: false, error: 'Vanguard needs INTELLECT >= 13' });
    expect(pickAction(HEARTH, at(3), { kind: 'pick', list: 'specialties', option: 'vanguard', from: 'specialty' }, { gm: true }).ok).toBe(true);
  });
});
