import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

import { MAX_BYTES, exampleFile, giftMoneyText, listFile, fileName, withImported, lineRange, partText, addedFeatureText } from '../choicesImport';
import { parseKitItems } from '../newCharacter';
import { choiceLists, type ChoiceList } from '../choices';
import type { Definition } from '../systemsApi';

/**
 * The CHOICES page's IMPORT as logic (choices import 2; approved mockup choices-import, 2026-10-28):
 * the files it hands out, read back by the server's own reader (backend/systemBuilder/choicesImport.js),
 * so a list downloaded and imported unchanged changes nothing and the example reads without a mistake.
 */

const req = createRequire(import.meta.url);
const { readChoicesFile, MAX_BYTES: SERVER_MAX } = req('../../../../backend/systemBuilder/choicesImport.js');
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');

const HEARTH = {
  format: 1, name: 'Hearth & Home',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'STR' }, { id: 'int', label: 'INT' }] }],
  derived: [{ id: 'guard', label: 'Guard', formula: '@str + 10' }],
  rests: { end_of_scene: { on: false }, dawn_prayer: { name: 'Dawn prayer' } },
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, again: true, options: [
      { id: 'soldier', label: 'Soldier', description: 'Holds a line, a wall, "anything".', features: [
        { id: 'second_wind', label: 'Second Wind', text: 'Breathe;\tthen\nkeep going.', uses: { count: '@soldier_level + 1', refill: 'short_rest' } },
        { id: 'guard_stance', label: 'Guard Stance', at: 2, modifiers: [{ target: 'guard', amount: '1' }] },
        { id: 'asi', label: 'Ability Score Improvement', at: 4, text: 'Raise one stat by 2.' },
        { id: 'asi_8', label: 'Ability Score Improvement', at: 8, text: 'Raise one stat by 2.' },
        { id: 'stand_firm', label: 'Stand Firm', at: 3, uses: { count: '1', refill: 'end_of_scene' } },
      ] },
      { id: 'hash', label: '#1 Fan', description: '  Spaces at the ends  ', requires: '@int >= 13', features: [
        { id: 'pray', label: 'Pray', uses: { count: '2', refill: 'dawn_prayer' } },
      ] },
    ] },
    { id: 'backgrounds', one: 'Background', many: 'Backgrounds', options: [
      { id: 'sailor', label: 'Sailor', description: 'Years before the mast.', features: [{ id: 'sea_legs', label: 'Sea Legs', text: 'Never thrown by a deck.' }] },
    ] },
  ],
} as unknown as Definition;
const list = (def: Definition, id: string) => choiceLists(def).find((c) => c.id === id) as ChoiceList;
const problems = (def: Definition) => checkDefinition(def).problems.map((p: { where: string; message: string }) => `${p.where}: ${p.message}`);

describe('held to the server', () => {
  it('the same size limit, and a system the server takes', () => {
    expect(MAX_BYTES).toBe(SERVER_MAX);
    expect(problems(HEARTH)).toEqual([]);
  });
});

describe('a levelled list\'s die in the files (R1a)', () => {
  it('has a die column, the example\'s dice and the list\'s own, and comes back unchanged', () => {
    const def = { ...HEARTH, choices: (HEARTH.choices as { id: string; options: object[] }[]).map((c) => (c.id === 'classes' ? { ...c, options: c.options.map((o, i) => (i ? o : { ...o, die: 10 })) } : c)) } as unknown as Definition;
    const example = exampleFile(def, list(def, 'classes'));
    expect(example).toContain('\nname, description, requires, die, gives, money\n');
    expect(example).toContain('# die is an option\'s die, like d10');
    expect(example).toMatch(/\nVeteran, .*, d10, /);
    const text = listFile(def, list(def, 'classes'));
    expect(text).toContain('\nname, description, requires, die, gives, money\n');
    // The list's own die, written as d10; an option without one has an empty cell.
    expect(text).toMatch(/\nSoldier, .*, d10, , \n/);
    const r = readChoicesFile(def, 'classes', text);
    expect([r.skipped, r.changes]).toEqual([[], 0]);
    expect(r.list).toEqual(list(def, 'classes'));
    // Not where the list isn't levelled.
    expect(listFile(def, list(def, 'backgrounds'))).toContain('\nname, description, requires, gives, money\n');
  });
});

describe('a table\'s rolls in the files (7a5b)', () => {
  it('has a roll column where the list has a table, the example\'s shared evenly, and comes back unchanged', () => {
    const def = { ...HEARTH, choices: (HEARTH.choices as { id: string; options: object[] }[]).map((c) => (c.id === 'backgrounds'
      ? { ...c, table: 'd6', options: [...c.options.map((o) => ({ ...o, roll: '1-3' })), { id: 'scribe', label: 'Scribe', roll: '4-6' }] } : c)) } as unknown as Definition;
    const example = exampleFile(def, list(def, 'backgrounds'));
    expect(example).toContain('\nname, description, requires, roll, gives, money\n');
    expect(example).toContain('# roll is what a d6 roll gives it on the table: a number, or a range like 3-4.');
    expect(example).toMatch(/\nVeteran, .*, 1-3, /);
    expect(example).toMatch(/\nScholar, .*, 4-6, , \n/);
    const text = listFile(def, list(def, 'backgrounds'));
    expect(text).toContain('\nname, description, requires, roll, gives, money\n');
    expect(text).toMatch(/\nScribe, , , 4-6, , \n/);
    const r = readChoicesFile(def, 'backgrounds', text);
    expect([r.skipped, r.notes, r.changes]).toEqual([[], [], 0]);
    expect(r.list).toEqual(list(def, 'backgrounds'));
    // A levelled list with a table has both, die first; one without a table, neither roll nor its note.
    const both = { ...def, choices: (def.choices as object[]).map((c) => ((c as { id: string }).id === 'classes' ? { ...c, table: 'd20' } : c)) } as unknown as Definition;
    expect(listFile(both, list(both, 'classes'))).toContain('\nname, description, requires, die, roll, gives, money\n');
    expect(listFile(def, list(def, 'classes'))).not.toMatch(/, roll,|# roll is/);
  });
});

describe('DOWNLOAD THIS LIST', () => {
  it('imported back unchanged changes nothing, words with commas, quotes, #, spaces and line breaks included', () => {
    for (const id of ['classes', 'backgrounds']) {
      const r = readChoicesFile(HEARTH, id, listFile(HEARTH, list(HEARTH, id)));
      expect(r.skipped).toEqual([]);
      expect(r.changes).toBe(0);
      // The words kept as written, line break and all, though the file could only hold a space.
      expect(r.list).toEqual(list(HEARTH, id));
    }
  });

  it('writes the list as it is, rests by name where the reader finds them by name, a note for what else a feature does', () => {
    const text = listFile(HEARTH, list(HEARTH, 'classes'));
    expect(text).toContain('\n[options]\nname, description, requires, die, gives, money\nSoldier, "Holds a line, a wall, ""anything"".", , , , \n"#1 Fan", "  Spaces at the ends  ", @int >= 13, , , \n');
    expect(text).toContain('\noption, feature, level, words, uses, refill\nSoldier, Second Wind, 1, "Breathe; then keep going.", @soldier_level + 1, Short rest\n');
    expect(text).toContain('\n# Soldier · Guard Stance also has modifiers, set in the builder\nSoldier, Guard Stance, 2, , , \n');
    // A rest turned off is found by its id only.
    expect(text).toContain('\nSoldier, Stand Firm, 3, , 1, end_of_scene\n');
    expect(text).toContain('\n"#1 Fan", Pray, 1, , 2, Dawn prayer\n');
    expect(listFile(HEARTH, list(HEARTH, 'backgrounds'))).toContain('\noption, feature, words, uses, refill\nSailor, Sea Legs, Never thrown by a deck., , \n');
  });

  it('names a rest by its id when two of those on share its name', () => {
    const twins = { ...HEARTH, rests: { dawn_prayer: { name: 'Short rest' } } } as unknown as Definition;
    const text = listFile(twins, list(twins, 'classes'));
    expect(text).toContain(', Pray, 1, , 2, dawn_prayer\n');
    expect(text).toContain(', Second Wind, 1, "Breathe; then keep going.", @soldier_level + 1, short_rest\n');
  });
});

describe('DOWNLOAD EXAMPLE', () => {
  it('reads without a mistake and leaves a system the server takes, levelled or not', () => {
    for (const id of ['classes', 'backgrounds']) {
      const r = readChoicesFile(HEARTH, id, exampleFile(HEARTH, list(HEARTH, id)));
      expect(r.skipped).toEqual([]);
      expect(r.added.options.map((o: { option: string }) => o.option)).toEqual(['Veteran', 'Scholar']);
      expect(problems(withImported(HEARTH, r.list))).toEqual([]);
    }
  });

  it('is made from the system: its names, its rests, a level column only for a levelled list', () => {
    const levelled = exampleFile(HEARTH, list(HEARTH, 'classes'));
    expect(levelled).toContain('# CLASSES for Hearth & Home, to import on the builder\'s CHOICES page (IMPORT on the CLASSES list).');
    expect(levelled).toContain('They can read @str, @int, @guard, @level, @classes_level, each option\'s own level, like @soldier_level.');
    expect(levelled).toContain('# refill is one of this system\'s rests, by name: Short rest, Long rest, End of session, Dawn prayer. It needs uses.');
    expect(levelled).toContain('\nVeteran, "Has seen worse, and says so.", @str >= 13, d10, "Crowbar, 3x Rations", 3d6 * 10\n');
    expect(levelled).toContain('\noption, feature, level, words, uses, refill\n');
    expect(levelled).toContain('\nScholar, Training, 8, Raise one stat., , \n');
    const flat = exampleFile(HEARTH, list(HEARTH, 'backgrounds'));
    expect(flat).toContain('# BACKGROUNDS has no levels, so features have no level.');
    expect(flat).toContain('\noption, feature, words, uses, refill\nVeteran, Hard to Rattle, Keeps a cool head when it counts., , \n');
    expect(flat).not.toContain('Training');
  });

  it('gives a list following its opener\'s level a level column, saying whose, and reads it back (7a5d)', () => {
    const forge = { format: 1, name: 'Forge', choices: [
      { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter', features: [{ id: 'arch', label: 'Martial Archetype', at: 3, choice: 'archetypes' }] }] },
      { id: 'archetypes', one: 'Archetype', many: 'Archetypes', picked: 'features', options: [{ id: 'champion', label: 'Champion', features: [
        { id: 'improved_critical', label: 'Improved Critical', at: 3 }, { id: 'remarkable_athlete', label: 'Remarkable Athlete', at: 7 },
      ] }] },
    ] } as unknown as Definition;
    const example = exampleFile(forge, list(forge, 'archetypes'));
    expect(example).toContain('# level is when a feature unlocks, 1 to 30: the level of the pick that opened it (FIGHTER). Features of one name');
    expect(example).toContain('\noption, feature, level, words, uses, refill\n');
    expect(example).toContain('\nScholar, Training, 8, Raise one stat., , \n');
    const text = listFile(forge, list(forge, 'archetypes'));
    expect(text).toContain('\nChampion, Remarkable Athlete, 7, , , \n');
    const r = readChoicesFile(forge, 'archetypes', text);
    expect([r.skipped, r.changes]).toEqual([[], 0]);
    expect(r.list).toEqual(list(forge, 'archetypes'));
    expect(problems(withImported(forge, r.list))).toEqual([]);
  });

  it('still reads for a system with no stats and no rests on', () => {
    const bare = { format: 1, name: 'Bare', rests: { short_rest: { on: false }, long_rest: { on: false }, end_of_scene: { on: false }, end_of_session: { on: false } },
      choices: [{ id: 'paths', one: 'Path', many: 'Paths', levelled: true, options: [] }] } as unknown as Definition;
    const text = exampleFile(bare, list(bare, 'paths'));
    expect(text).toContain('They can read @level, @paths_level, each option\'s own level, like @soldier_level.');
    expect(text).toContain('by name: none (it has none on).');
    expect(text).toContain('\nVeteran, "Has seen worse, and says so.", , d10, "Crowbar, 3x Rations", 3d6 * 10\n');
    const r = readChoicesFile(bare, 'paths', text);
    expect(r.skipped).toEqual([]);
    expect(problems(withImported(bare, r.list))).toEqual([]);
  });
});

describe('the rest', () => {
  it('names the files by system and list', () => {
    expect(fileName(HEARTH, list(HEARTH, 'classes'), 'example')).toBe('hearth-home-classes-example.csv');
    expect(fileName({ format: 1 } as unknown as Definition, { id: 'x', one: '', many: '', options: [] }, 'list')).toBe('system-x.csv');
  });

  it('puts a previewed list in place of its own, the others untouched', () => {
    const next = withImported(HEARTH, { id: 'backgrounds', one: 'B', many: 'Bs', options: [] });
    expect(next.choices).toEqual([(HEARTH.choices as unknown[])[0], { id: 'backgrounds', one: 'B', many: 'Bs', options: [] }]);
    expect(HEARTH.choices).toHaveLength(2);
  });

  it('finds a line to select, whatever the line ends', () => {
    const text = 'a\r\nbb\nccc';
    expect(lineRange(text, 1)).toEqual({ from: 0, to: 1 });
    expect(lineRange(text, 2)).toEqual({ from: 3, to: 5 });
    expect(lineRange(text, 3)).toEqual({ from: 6, to: 9 });
    expect(lineRange(text, 9)).toEqual({ from: 9, to: 9 });
  });

  it('says a change and a new feature in the page\'s words', () => {
    expect(partText(HEARTH, { part: 'refill', from: 'short_rest', to: 'dawn_prayer' })).toBe('REFILL SHORT REST → DAWN PRAYER');
    expect(partText(HEARTH, { part: 'description', from: '', to: 'x'.repeat(70) })).toBe(`WHAT IT IS nothing → "${'x'.repeat(59)}…"`);
    expect(partText(HEARTH, { part: 'level', from: 1, to: 5 })).toBe('LEVEL 1 → 5');
    expect(addedFeatureText(HEARTH, { line: 3, option: 'Ranger', feature: 'Favored Foe', level: 2, uses: '1', refill: 'long_rest' })).toBe('RANGER · FAVORED FOE · LEVEL 2 · 1 USE, LONG REST');
    expect(addedFeatureText(HEARTH, { line: 3, option: 'Sailor', feature: 'Knots', uses: '@int' })).toBe('SAILOR · KNOTS · @INT USES');
  });
});

describe('what an option gives, in the files (7c4e)', () => {
  const server = req('../../../../backend/systemBuilder/creation.js');
  const GOLD = { id: 'gold', name: 'Gold', denominations: [{ id: 'gp', name: 'Gold', short: 'gp', value: 100 }, { id: 'cp', name: 'Copper', short: 'cp', value: 1 }] };
  const HONOR = { id: 'honor', name: 'Honor' };
  const DOLLARS = { id: 'dollars', name: 'Dollars', symbol: '$', decimals: 2 };
  const giving = (extra: object, gives: object) => ({
    format: 1, name: 'G', ...extra,
    choices: [{ id: 'bgs', one: 'Background', many: 'Backgrounds', options: [
      { id: 'noble', label: 'Noble', gives },
      { id: 'dock', label: 'Dockhand' },
    ] }],
  }) as unknown as Definition;
  const MONIED = { currencies: [GOLD, HONOR, DOLLARS] };

  it('reads items as the server does', () => {
    for (const text of ['Rope, Lantern, 3x Rations', ' 3X  Rations ,, ', '', 'Box of 3x matches', '3xRations']) {
      expect(parseKitItems(text), text).toEqual(server.parseItems(text));
    }
  });

  it('says money as the server does', () => {
    const cases: [object, Record<string, unknown>][] = [
      [MONIED, { gold: { how: 'number', amount: 502 }, honor: { how: 'roll', each: '3d6' }, dollars: { how: 'number', amount: 434 } }],
      [MONIED, { honor: { how: 'number', amount: 5 }, gone: { how: 'number', amount: 1 } }],
      [{}, { main: { how: 'number', amount: 100 } }],
      [{}, { main: { how: 'roll', each: '3d6 * 10' } }],
      [{}, {}],
    ];
    for (const [extra, money] of cases) {
      const def = giving(extra, {});
      expect(giftMoneyText(def, money), JSON.stringify(money)).toBe(server.giftMoneyText(def, money));
    }
    expect(giftMoneyText(giving(MONIED, {}), { gold: { how: 'number', amount: 502 }, honor: { how: 'roll', each: '3d6' } })).toBe('Gold: 5 gp 2 cp; Honor: 3d6');
  });

  it('come back unchanged, in every shape of money', () => {
    for (const [extra, gives] of [
      [MONIED, { items: [{ name: 'Crowbar', qty: 1 }, { name: 'Rations', qty: 3 }], money: { gold: { how: 'roll', each: '3d6 * 10' }, honor: { how: 'number', amount: 5 } } }],
      [MONIED, { money: { gold: { how: 'number', amount: 502 }, dollars: { how: 'number', amount: 123456 } } }],
      [{}, { items: [{ name: 'Rope', qty: 1 }], money: { main: { how: 'number', amount: 100 } } }],
      [{}, { money: { main: { how: 'roll', each: '4d6 drop lowest * 2' } } }],
      [{}, { items: [{ name: 'Rope', qty: 2 }] }],
    ] as [object, object][]) {
      const def = giving(extra, gives);
      const r = readChoicesFile(def, 'bgs', listFile(def, list(def, 'bgs')));
      expect([r.skipped, r.notes, r.changes], JSON.stringify(gives)).toEqual([[], [], 0]);
      expect(r.list).toEqual(list(def, 'bgs'));
    }
  });

  it('writes them in the list\'s own row, and the example shows the shape in this system\'s money', () => {
    const def = giving(MONIED, { items: [{ name: 'Crowbar', qty: 1 }], money: { honor: { how: 'number', amount: 5 } } });
    expect(listFile(def, list(def, 'bgs'))).toContain('\nNoble, , , Crowbar, Honor: 5 Honor\n');
    const example = exampleFile(def, list(def, 'bgs'));
    expect(example).toContain('Veteran, "Has seen worse, and says so.", , "Crowbar, 3x Rations", Gold: 3d6 * 10\n');
    expect(example).toContain('# gives is what a new character holding it starts with');
    expect(example).toContain('# money is what they start with too, a number or a roll: Gold: 3d6 * 10.');
    const example2 = readChoicesFile(def, 'bgs', example);
    expect(example2.skipped).toEqual([]);
  });

  it('with the bank off, no money column or note', () => {
    const def = giving({ parts: { bank: { on: false } } }, { items: [{ name: 'Rope', qty: 1 }] });
    const text = listFile(def, list(def, 'bgs'));
    expect(text).toContain('\nname, description, requires, gives\n');
    // A row as long as its columns.
    expect(text).toContain('\nNoble, , , Rope\nDockhand, , , \n');
    expect(exampleFile(def, list(def, 'bgs'))).not.toContain('# money is');
    const r = readChoicesFile(def, 'bgs', text);
    expect([r.skipped, r.notes, r.changes]).toEqual([[], [], 0]);
  });

  it('a change says itself in the page\'s words, as do a die and a roll', () => {
    expect(partText(HEARTH, { part: 'gives', from: '', to: 'Rope' })).toBe('GIVES nothing → Rope');
    expect(partText(HEARTH, { part: 'money', from: '100', to: '3d6' })).toBe('STARTING MONEY 100 → 3d6');
    expect(partText(HEARTH, { part: 'die', from: 'd8', to: 'd10' })).toBe('HIT DIE d8 → d10');
    expect(partText(HEARTH, { part: 'roll', from: '1-3', to: '4' })).toBe('ROLL 1-3 → 4');
  });
});
