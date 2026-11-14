/**
 * Lists inside lists (7a5a1). Approved mockup nested-choices (2026-10-28): a list picked THROUGH
 * FEATURES gets a pick under each unlocked feature that opens it (as many as the feature says, stored
 * with `from`), BOTH adds its own picks too; a pick whose feature locks again is kept, not counted, and
 * counts again once it unlocks; nesting goes as deep as the lists do, never round in a loop.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { PICKS_KEY, heldOf, picksOf, workedOf, overlayOf, choicesShown, loopsOf, unlockedOf, unlocksByLevelOf } = require_('../systemBuilder/choices');
const { pickAction } = require_('../systemBuilder/picking');
const { checkDefinition } = require_('../systemBuilder/definition');
const citysys = require_('../systemBuilder/citysys');

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
const withChoice = (def, id, patch) => ({ ...def, choices: def.choices.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
const withList = (id, patch) => withChoice(HEARTH, id, patch);

describe('the checks', () => {
  it('takes the system as it is', () => {
    expect(problems(HEARTH)).toEqual([]);
  });

  it('a list is picked on its own, through features or both; a feature opening a list says how many, 1 to 10', () => {
    expect(problems(withList('origins', { picked: 'sometimes' }))).toEqual(['list origins, picked: own (on its own), features (through the features that open it), both, or everyone (every character has it)']);
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
      { list: 'specialties', option: 'duelist', level: 6, from: 'specialty' },
      { list: 'schools', option: 'iron', level: 1, from: 'school' },
      { list: 'feats', option: 'tough', level: 6, from: 'feat_6' },
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

describe('a list everyone has (7a5a2)', () => {
  const COMMONS = { id: 'commons', one: 'Common', many: 'Commons', picked: 'everyone', options: [
    { id: 'all_breath', label: 'Second Wind', features: [
      { id: 'breath', label: 'Breath', uses: { count: '1', refill: 'short_rest' } },
      { id: 'knack', label: 'Knack', at: 2, choice: 'specialties' },
      { id: 'improve', label: 'Improvement', at: 4, modifiers: [{ target: 'defense', amount: '1' }] },
    ] },
    { id: 'strong', label: 'Strong Back', requires: '@int >= 13', features: [{ id: 'carry', label: 'Carry' }] },
  ] };
  const EVERYONE = { ...HEARTH, choices: [...HEARTH.choices, COMMONS] };
  const mine = (def, data) => heldOf(def, data).filter((p) => p.list.id === 'commons').map((p) => `${p.option.id}@${p.level}`);

  it('checks clean, its features unlocking at a level though the list has none of its own', () => {
    expect(problems(EVERYONE)).toEqual([]);
    expect(problems({ ...EVERYONE, choices: [...HEARTH.choices, { ...COMMONS, levelled: true }] }))
      .toEqual(['list commons, levelled: A list everyone has has no levels of its own: its features unlock by the character\'s level']);
  });

  it('every character has each option whose requirement they meet, at their total level', () => {
    expect(mine(EVERYONE, sheet(soldierAt(3)))).toEqual(['all_breath@3']);
    expect(mine(EVERYONE, sheet(soldierAt(3), { int: 14 }))).toEqual(['all_breath@3', 'strong@3']);
    // No class yet: level 1, so what comes at the start counts; a system with no levels: everything.
    expect(mine(EVERYONE, sheet({}))).toEqual(['all_breath@1']);
    const flat = { format: 1, name: 'Flat', choices: [COMMONS] };
    expect(mine(flat, sheet({}))).toEqual(['all_breath@null']);
    expect(overlayOf({ ...flat, derived: HEARTH.derived }, sheet({})).add).toEqual({ defense: 1 });
    expect(workedOf(EVERYONE, sheet(soldierAt(3))).unmet).toEqual(['vanguard', 'strong']);
  });

  it('a system with its own level stat: that is the level', () => {
    const own = { ...EVERYONE, stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'int', label: 'Intellect' }, { id: 'level', label: 'Level' }] }] };
    expect(problems(own)).toEqual([]);
    expect(mine(own, sheet(soldierAt(1), { level: 7 }))).toEqual(['all_breath@7']);
    expect(mine(own, sheet(soldierAt(1), { level: 0 }))).toEqual(['all_breath@1']);
  });

  it('its features count by that level: uses, a bonus at 4, a list opened at 2', () => {
    expect(overlayOf(EVERYONE, sheet(soldierAt(3))).add).toEqual({});
    expect(overlayOf(EVERYONE, sheet(soldierAt(4))).add).toEqual({ defense: 1 });
    expect(workedOf(EVERYONE, sheet(soldierAt(1))).uses).toEqual({ breath: { max: 1, spent: 0 } });
    const r = pickAction(EVERYONE, sheet(soldierAt(2)), { kind: 'pick', list: 'specialties', option: 'duelist', from: 'knack' });
    expect(r.ok).toBe(true);
    expect(ids(picksOf(EVERYONE, r.data))).toContain('specialties:duelist<knack');
    expect(pickAction(EVERYONE, sheet(soldierAt(1)), { kind: 'pick', list: 'specialties', option: 'duelist', from: 'knack' }))
      .toEqual({ ok: false, error: 'Nothing unlocked there opens the Specialties' });
  });

  it('nothing in it is picked, dropped or levelled, by anyone', () => {
    for (const kind of ['pick', 'drop', 'level']) {
      expect(pickAction(EVERYONE, sheet(soldierAt(3)), { kind, list: 'commons', option: 'all_breath', level: 2 }, { gm: true }))
        .toEqual({ ok: false, error: 'Every character has the Commons: nothing to pick' });
    }
  });

  it('is told to the sheet as a list everyone has, its picks at the character\'s level', () => {
    const commons = choicesShown(EVERYONE).find((c) => c.id === 'commons');
    expect(commons.picked).toBe('everyone');
    // Its features keep their level, though the list has none of its own.
    expect(commons.options[0].features.map((f) => [f.id, f.at])).toEqual([['breath', 1], ['knack', 2], ['improve', 4]]);
    expect(workedOf(EVERYONE, sheet(soldierAt(3))).picks).toContainEqual({ list: 'commons', option: 'all_breath', level: 3 });
  });
});

describe('a list under a feature takes the level of what opened it (7a5d)', () => {
  // The user's own case: Fighter's Martial Archetype opens the archetypes at 3; Champion's features
  // come at Fighter 3, 7 and 15; Battle Master's maneuvers are a list deeper still.
  const FIGHTER = {
    format: 1, name: 'Forge',
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Strength' }] }],
    derived: [{ id: 'crit', label: 'Critical range', formula: '20' }],
    choices: [
      { id: 'classes', one: 'Class', many: 'Classes', levelled: true, again: true, options: [
        { id: 'fighter', label: 'Fighter', features: [{ id: 'martial_archetype', label: 'Martial Archetype', at: 3, choice: 'archetypes' }] },
        { id: 'rogue', label: 'Rogue' },
      ] },
      { id: 'archetypes', one: 'Archetype', many: 'Archetypes', picked: 'features', options: [
        { id: 'champion', label: 'Champion', features: [
          { id: 'improved_critical', label: 'Improved Critical', at: 3, modifiers: [{ target: 'crit', amount: '-1' }] },
          { id: 'remarkable_athlete', label: 'Remarkable Athlete', at: 7 },
          { id: 'superior_critical', label: 'Superior Critical', at: 15, modifiers: [{ target: 'crit', amount: '-1' }] },
        ] },
        { id: 'battle_master', label: 'Battle Master', features: [
          { id: 'combat_superiority', label: 'Combat Superiority', at: 3, choice: 'maneuvers', choice_count: 3 },
          { id: 'more_maneuvers', label: 'More Maneuvers', at: 7, choice: 'maneuvers', choice_count: 2 },
        ] },
      ] },
      { id: 'maneuvers', one: 'Maneuver', many: 'Maneuvers', picked: 'features', options: [
        { id: 'riposte', label: 'Riposte', features: [{ id: 'riposte_strike', label: 'Strike' }, { id: 'riposte_sure', label: 'Sure', at: 10 }] },
        { id: 'parry', label: 'Parry' }, { id: 'feint', label: 'Feint' }, { id: 'trip', label: 'Trip' },
      ] },
      { id: 'feats', one: 'Feat', many: 'Feats', options: [{ id: 'adept', label: 'Martial Adept', features: [{ id: 'adept_pick', label: 'Maneuvers', choice: 'tricks' }] }] },
      { id: 'tricks', one: 'Trick', many: 'Tricks', picked: 'features', options: [
        { id: 'flourish', label: 'Flourish', features: [{ id: 'flourish_1', label: 'One' }, { id: 'flourish_9', label: 'Nine', at: 9 }] },
      ] },
    ],
  };
  const fighterAt = (level, more = {}) => sheet({ classes: [{ option: 'fighter', level }], ...more });
  const unlocked = (data) => unlockedOf(picksOf(FIGHTER, data)).map((u) => u.feature.id);

  it('takes a level on the features of a list opened from one with levels, never one opened only by a feat', () => {
    expect(problems(FIGHTER)).toEqual([
      'list tricks, option flourish, feature flourish_9, at: Only the features of a list with levels unlock at a level: a levelled list, one everyone has, or one a feature of those opens',
    ]);
  });

  it('unlocks an archetype\'s features by the Fighter\'s level, not all at once', () => {
    const champion = { archetypes: [{ option: 'champion', from: 'martial_archetype' }] };
    expect(unlocked(fighterAt(3, champion))).toEqual(['martial_archetype', 'improved_critical']);
    expect(unlocked(fighterAt(7, champion))).toEqual(['martial_archetype', 'improved_critical', 'remarkable_athlete']);
    expect(unlocked(fighterAt(15, champion))).toEqual(['martial_archetype', 'improved_critical', 'remarkable_athlete', 'superior_critical']);
    expect(overlayOf(FIGHTER, fighterAt(14, champion)).add).toEqual({ crit: -1 });
    expect(overlayOf(FIGHTER, fighterAt(15, champion)).add).toEqual({ crit: -2 });
  });

  it('the sheet is told the archetype\'s level, which is never added to the levels formulas read', () => {
    const data = fighterAt(7, { classes: [{ option: 'fighter', level: 7 }, { option: 'rogue', level: 2 }], archetypes: [{ option: 'champion', from: 'martial_archetype' }] });
    const worked = workedOf(FIGHTER, data);
    expect(worked.picks).toContainEqual({ list: 'archetypes', option: 'champion', level: 7, from: 'martial_archetype' });
    expect(worked.levels).toEqual({ fighter_level: 7, rogue_level: 2, classes_level: 9, level: 9 });
  });

  it('goes down the lists: a maneuver follows Battle Master, which follows the Fighter', () => {
    const stored = { archetypes: [{ option: 'battle_master', from: 'martial_archetype' }],
      maneuvers: ['riposte', 'parry', 'feint', 'trip'].map((option) => ({ option, from: 'combat_superiority' })) };
    expect(ids(heldOf(FIGHTER, fighterAt(3, stored)))).toEqual(['classes:fighter', 'archetypes:battle_master<martial_archetype',
      'maneuvers:riposte<combat_superiority', 'maneuvers:parry<combat_superiority', 'maneuvers:feint<combat_superiority', 'maneuvers:trip<combat_superiority (waiting)']);
    expect(heldOf(FIGHTER, fighterAt(10, stored)).map((p) => p.level)).toEqual([10, 10, 10, 10, 10, 10]);
    expect(unlocked(fighterAt(9, stored))).not.toContain('riposte_sure');
    expect(unlocked(fighterAt(10, stored))).toContain('riposte_sure');
    // An archetype feature's own list opens at its level: More Maneuvers at Fighter 7.
    expect(workedOf(FIGHTER, fighterAt(6, stored)).opens.map((o) => o.feature)).toEqual(['martial_archetype', 'combat_superiority']);
    expect(workedOf(FIGHTER, fighterAt(7, stored)).opens.map((o) => o.feature)).toEqual(['martial_archetype', 'combat_superiority', 'more_maneuvers']);
  });

  it('settles down the lists in any order, a waiting pick at its opener\'s level too', () => {
    // The maneuvers listed before the archetypes that open them, and the Fighter too low for either.
    const def = { ...FIGHTER, choices: [FIGHTER.choices[0], FIGHTER.choices[2], FIGHTER.choices[1], ...FIGHTER.choices.slice(3)] };
    const stored = { archetypes: [{ option: 'battle_master', from: 'martial_archetype' }], maneuvers: [{ option: 'riposte', from: 'combat_superiority' }] };
    expect(heldOf(def, fighterAt(2, stored)).map((p) => [p.option.id, p.level, p.active])).toEqual([['fighter', 2, true], ['riposte', 2, false], ['battle_master', 2, false]]);
    expect(heldOf(def, fighterAt(10, stored)).map((p) => [p.option.id, p.level, p.active])).toEqual([['fighter', 10, true], ['riposte', 10, true], ['battle_master', 10, true]]);
  });

  it('opened by a pick with no level, has everything at once', () => {
    const data = sheet({ feats: ['adept'], tricks: [{ option: 'flourish', from: 'adept_pick' }] });
    expect(heldOf(FIGHTER, data).map((p) => p.level)).toEqual([null, null]);
    expect(unlocked(data)).toEqual(['adept_pick', 'flourish_1', 'flourish_9']);
  });

  it('opened from a list everyone has, at the character\'s level', () => {
    const def = { ...FIGHTER, choices: [...FIGHTER.choices.filter((c) => c.id !== 'feats'),
      { id: 'feats', one: 'Feat', many: 'Feats', picked: 'everyone', options: [{ id: 'adept', label: 'Martial Adept', features: [{ id: 'adept_pick', label: 'Maneuvers', choice: 'tricks' }] }] }] };
    const at = (level) => sheet({ classes: [{ option: 'rogue', level }], tricks: [{ option: 'flourish', from: 'adept_pick' }] });
    expect(unlockedOf(picksOf(def, at(9))).map((u) => u.feature.id).sort()).toEqual(['adept_pick', 'flourish_1', 'flourish_9']);
    expect(unlockedOf(picksOf(def, at(8))).map((u) => u.feature.id).sort()).toEqual(['adept_pick', 'flourish_1']);
    expect(problems(def)).toEqual([]);
  });

  it('travels in a system file: exported and installed with its levels and no problems', () => {
    const def = { ...FIGHTER, choices: FIGHTER.choices.filter((c) => c.id !== 'feats' && c.id !== 'tricks') };
    const read = citysys.readFile(JSON.stringify(citysys.buildFile({ definition: def, version: 1, origin: 'forge' })));
    expect(read.problems).toEqual([]);
    expect(read.file.definition.choices[1].options[0].features.map((f) => f.at)).toEqual([3, 7, 15]);
  });

  it('which lists unlock by a level, and the sheet is told each feature\'s', () => {
    expect([...unlocksByLevelOf(FIGHTER)].sort()).toEqual(['archetypes', 'classes', 'maneuvers']);
    // Picked on its own, a list has no opener to follow, nor do the lists it opens.
    expect([...unlocksByLevelOf(withChoice(FIGHTER, 'archetypes', { picked: 'own' }))].sort()).toEqual(['classes']);
    const shown = choicesShown(FIGHTER);
    expect(shown[1].options[0].features.map((f) => f.at)).toEqual([3, 7, 15]);
    expect(shown[4].options[0].features.map((f) => f.at)).toEqual([undefined, undefined]);
  });
});
