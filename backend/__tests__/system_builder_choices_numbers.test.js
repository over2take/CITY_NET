/**
 * What a character's picks do to their numbers (7a1b; approved mockup docs/mockups/builder-choices.html,
 * 2026-10-27): the picks as stored on a sheet, kept only where they hold; the levels formulas read
 * (@soldier_level, @classes_level, and @level unless the system has its own); the features each
 * pick has unlocked; and their modifiers, worked out on every save and never written into a stat,
 * read by formulas, by rolls and by PUBLISH's preview. Players can't write the picks as a field.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const { PICKS_KEY, picksOf, levelsOf, unlockedOf, overlayOf, effectiveData, levelNamesOf } = require_('../systemBuilder/choices');
const { metaOf } = require_('../systemBuilder/runtime');
const { rollField } = require_('../systemBuilder/tableRolls');
const { characterChanges } = require_('../systemBuilder/versionDiff');
const templates = require_('../sheets/templates');

const CLASSES = {
  id: 'classes', one: 'Class', many: 'Classes', levelled: true, again: true,
  options: [
    { id: 'soldier', label: 'Soldier', features: [
      { id: 'guard_stance', label: 'Guard Stance', modifiers: [{ target: 'defense', amount: '1' }] },
      { id: 'hardy', label: 'Hardy', at: 2, modifiers: [{ target: 'con', amount: '2' }] },
      { id: 'veteran', label: 'Veteran', at: 5, modifiers: [{ target: 'defense', amount: '2' }] },
    ] },
    { id: 'mage', label: 'Mage', features: [
      { id: 'ward', label: 'Ward', modifiers: [{ target: 'defense', amount: '@mage_level' }] },
    ] },
  ],
};
const FEATS = { id: 'feats', one: 'Feat', many: 'Feats', picks: 2, options: [
  { id: 'tough', label: 'Tough', features: [{ id: 'tough_hp', label: 'Tough', modifiers: [{ target: 'max_hp', amount: '2 * @level' }] }] },
  { id: 'alert', label: 'Alert', features: [{ id: 'alert_init', label: 'Alert', modifiers: [{ target: 'initiative', amount: '5' }] }] },
  { id: 'lucky', label: 'Lucky' },
] };

const HEARTH = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Constitution' }, { id: 'dex', label: 'Dexterity' }] }],
  derived: [
    { id: 'max_hp', formula: '10 + @con' },
    { id: 'defense', formula: '10 + @dex' },
    { id: 'guard', label: 'Guard', formula: '@defense + 1' },
    { id: 'initiative', formula: '@dex' },
  ],
  rolls: [{ id: 'save', label: 'Save', dice: [{ count: '1', sides: 20 }], add: '@this + @soldier_level', by: ['con'] }],
  choices: [CLASSES, FEATS],
};
const sheet = (picks, typed = {}) => ({ con: 14, dex: 2, ...typed, [PICKS_KEY]: picks });
const ids = (picks) => picks.map((p) => `${p.list.id}:${p.option.id}${p.level === null ? '' : `@${p.level}`}`);

describe('a character\'s picks', () => {
  it('the system with them checks clean', () => {
    expect(checkDefinition(HEARTH).problems).toEqual([]);
  });

  it('are read from the sheet, each an option of its list with a level where the list has them', () => {
    expect(ids(picksOf(HEARTH, sheet({ classes: [{ option: 'soldier', level: 3 }, { option: 'mage', level: 1 }], feats: ['tough'] }))))
      .toEqual(['classes:soldier@3', 'classes:mage@1', 'feats:tough']);
    expect(picksOf(HEARTH, {})).toEqual([]);
    expect(picksOf(HEARTH, { [PICKS_KEY]: 'soldier' })).toEqual([]);
  });

  it('keep only what holds: a known option, once, no more than the list allows, a level from 1', () => {
    const read = (stored) => ids(picksOf(HEARTH, sheet(stored)));
    expect(read({ classes: [{ option: 'wizard', level: 2 }, 'soldier', { option: 'soldier', level: 4 }] })).toEqual(['classes:soldier@1']);
    expect(read({ classes: [{ option: 'soldier', level: 0 }, { option: 'mage', level: 2.5 }] })).toEqual(['classes:soldier@1', 'classes:mage@1']);
    expect(read({ classes: [{ option: 'soldier', level: 999 }] })).toEqual(['classes:soldier@30']);
    // Feats picks 2: a third is past it. A list that isn't levelled has no level.
    expect(read({ feats: ['tough', { option: 'alert', level: 3 }, 'lucky'] })).toEqual(['feats:tough', 'feats:alert']);
    expect(read({ skills: ['tough'], feats: 'tough' })).toEqual([]);
  });

  it('a list picked once holds one; MORE THAN ONCE (multiclassing) holds as many as there are', () => {
    const once = { ...HEARTH, choices: [{ ...CLASSES, again: false }, FEATS] };
    const two = { classes: [{ option: 'soldier', level: 3 }, { option: 'mage', level: 1 }] };
    expect(ids(picksOf(once, sheet(two)))).toEqual(['classes:soldier@3']);
    expect(ids(picksOf(HEARTH, sheet(two)))).toEqual(['classes:soldier@3', 'classes:mage@1']);
  });
});

describe('levels', () => {
  const levels = (stored, def = HEARTH) => levelsOf(def, picksOf(def, sheet(stored)));

  it('each option\'s (0 when not taken), the list\'s sum, and @level the sum of every levelled list', () => {
    expect(levels({ classes: [{ option: 'soldier', level: 3 }, { option: 'mage', level: 1 }] }))
      .toEqual({ soldier_level: 3, mage_level: 1, classes_level: 4, level: 4 });
    expect(levels({})).toEqual({ soldier_level: 0, mage_level: 0, classes_level: 0, level: 0 });
  });

  it('a system with its own level keeps it: @level is not touched, the list\'s sum still read', () => {
    const own = { ...HEARTH, stats: [...HEARTH.stats, { id: 'character', label: 'CHARACTER', stats: [{ id: 'level', label: 'Level' }] }] };
    expect(checkDefinition(own).problems).toEqual([]);
    expect(levels({ classes: [{ option: 'soldier', level: 3 }] }, own)).toEqual({ soldier_level: 3, mage_level: 0, classes_level: 3 });
    expect(levelNamesOf(own).has('level')).toBe(false);
    expect(levelNamesOf(HEARTH).has('level')).toBe(true);
  });

  it('a system with no levelled list reads no levels at all', () => {
    const flat = { ...HEARTH, choices: [FEATS] };
    expect(levels({ feats: ['tough'] }, flat)).toEqual({});
    expect([...levelNamesOf(flat)]).toEqual([]);
  });
});

describe('features unlocked', () => {
  const unlocked = (stored) => unlockedOf(picksOf(HEARTH, sheet(stored))).map((u) => u.feature.id);

  it('by the pick\'s level in a levelled list (no level given is 1); every one in a list that isn\'t', () => {
    expect(unlocked({ classes: [{ option: 'soldier', level: 1 }] })).toEqual(['guard_stance']);
    expect(unlocked({ classes: [{ option: 'soldier', level: 4 }] })).toEqual(['guard_stance', 'hardy']);
    expect(unlocked({ classes: [{ option: 'soldier', level: 5 }], feats: ['tough', 'lucky'] })).toEqual(['guard_stance', 'hardy', 'veteran', 'tough_hp']);
  });
});

describe('what the picks do to the numbers, on a save', () => {
  const save = (data, def = HEARTH) => { metaOf(def).recompute(data); return data; };

  it('a stat\'s modifier reaches the formulas reading it; the stat stays as typed', () => {
    const d = save(sheet({ classes: [{ option: 'soldier', level: 2 }] }));
    expect(d.con).toBe(14);
    expect(d.max_hp).toBe(10 + 16);
  });

  it('a formula\'s modifiers are added once it is worked out, before anything reading it', () => {
    const d = save(sheet({ classes: [{ option: 'soldier', level: 5 }, { option: 'mage', level: 3 }] }));
    // 10 + DEX 2, +1 GUARD STANCE, +2 VETERAN, +3 WARD (@mage_level).
    expect(d.defense).toBe(18);
    expect(d.guard).toBe(19);
  });

  it('an amount reads levels and the sheet as typed: @level counts every class', () => {
    const d = save(sheet({ classes: [{ option: 'soldier', level: 3 }, { option: 'mage', level: 1 }], feats: ['tough', 'alert'] }));
    expect(d.max_hp).toBe(10 + 16 + 2 * 4);
    expect(d.initiative).toBe(2 + 5);
  });

  it('taking a pick away takes its effects with it on the next save', () => {
    const d = save(sheet({ classes: [{ option: 'soldier', level: 5 }] }));
    expect([d.max_hp, d.defense]).toEqual([26, 15]);
    d[PICKS_KEY] = {};
    save(d);
    expect([d.con, d.max_hp, d.defense]).toEqual([14, 24, 12]);
  });

  it('a sheet with no picks is worked out as it always was', () => {
    const d = save({ con: 14, dex: 2 });
    expect([d.max_hp, d.defense, d.guard, d.initiative]).toEqual([24, 12, 13, 2]);
  });

  it('says where each change came from, for the sheet to name', () => {
    const { from, add, sheet: over } = overlayOf(HEARTH, sheet({ classes: [{ option: 'soldier', level: 2 }, { option: 'mage', level: 2 }] }));
    expect(from.defense).toEqual([{ feature: 'Guard Stance', amount: 1 }, { feature: 'Ward', amount: 2 }]);
    expect(from.con).toEqual([{ feature: 'Hardy', amount: 2 }]);
    expect(add).toEqual({ defense: 3 });
    expect(over.con).toBe(16);
  });
});

describe('what a modifier\'s amount may read', () => {
  const amount = (text) => checkDefinition({ ...HEARTH, choices: [CLASSES, { ...FEATS, options: [{ id: 'tough', label: 'Tough', features: [{ id: 'tough_hp', label: 'Tough', modifiers: [{ target: 'max_hp', amount: text }] }] }] }] })
    .problems.map((p) => `${p.where}: ${p.message}`);

  it('stats as typed and levels; never a formula, which could read the modifier back', () => {
    expect(amount('@con + @level + @soldier_level + @classes_level')).toEqual([]);
    expect(amount('@defense')).toEqual(['list feats, option tough, feature tough_hp, modifier 1, amount: Reads @defense, a formula: an amount reads the sheet as typed and levels']);
  });

  it('a levelled list\'s sum needs its name free', () => {
    const taken = { ...HEARTH, derived: [...HEARTH.derived, { id: 'classes_level', formula: '1' }] };
    expect(checkDefinition(taken).problems.map((p) => `${p.where}: ${p.message}`)).toEqual(['list classes: Its levels add up as @classes_level, which a stat, formula or option already has']);
    const option = { ...HEARTH, choices: [{ ...CLASSES, options: [...CLASSES.options, { id: 'classes', label: 'Classes' }] }, FEATS] };
    expect(checkDefinition(option).problems.map((p) => `${p.where}: ${p.message}`)).toEqual(['list classes: Its levels add up as @classes_level, which a stat, formula or option already has']);
  });
});

describe('rolls read the same numbers', () => {
  const rng = () => 0.5; // a d20 lands 11
  it('@this is the stat with its modifiers, a pick\'s level is read, and nothing is written', () => {
    const data = sheet({ classes: [{ option: 'soldier', level: 2 }] });
    const made = rollField({ definition: HEARTH, data, fieldId: 'con', rng, who: 'Wren' });
    // 11 + CON 16 (14, +2 HARDY) + SOLDIER 2.
    expect(made.total).toBe(11 + 16 + 2);
    expect(data.con).toBe(14);
    expect(effectiveData(HEARTH, data)).toMatchObject({ con: 16, soldier_level: 2, level: 2 });
  });
});

describe('PUBLISH\'s preview', () => {
  it('a feature changed shows in each character\'s values', () => {
    const data = { ...sheet({ classes: [{ option: 'soldier', level: 1 }] }), defense: 13 };
    const after = { ...HEARTH, choices: [{ ...CLASSES, options: [{ ...CLASSES.options[0], features: [{ id: 'guard_stance', label: 'Guard Stance', modifiers: [{ target: 'defense', amount: '3' }] }] }, CLASSES.options[1]] }, FEATS] };
    expect(characterChanges(HEARTH, after, data).filter((c) => c.kind === 'formula').map((c) => [c.id, c.from, c.to]))
      .toEqual([['defense', 13, 15], ['guard', 14, 16]]);
  });
});

describe('the picks as a field', () => {
  it('are never a player\'s to write, under any system; the GM still can, and other fields are as they were', () => {
    expect(templates.PICKS_KEY).toBe(PICKS_KEY);
    for (const system of ['cwn', 'dnd5e', 'some_custom_id']) expect(templates.playerMayEdit(system, PICKS_KEY)).toBe(false);
    expect(templates.playerMayEdit('cwn', 'str')).toBe(true);
  });
});
