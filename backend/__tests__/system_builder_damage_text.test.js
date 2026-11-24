import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

/**
 * A DAMAGE value with its types (8b2a; approved mockup damage-pipeline, answered 2026-11-23: the item carries its type,
 * "2d6 FIRE DMG"). Read by shape, so a value is checked anywhere without its system; rolled part by part against the game's
 * damage types, the log saying each; read on the sheet and in the builder as the least and most it comes to.
 */

const require_ = createRequire(import.meta.url);
const { damageParts, damageProblem, rollDamage, typed } = require_('../systemBuilder/damageText');
const { rollGear, readGearDice } = require_('../systemBuilder/gearRolls');
const { checkDefinition } = require_('../systemBuilder/definition');
const { previewFormulas } = require_('../systemBuilder/formulaPreview');
const { damageTypesOf } = require_('../systemBuilder/damageTypes');

const ANY = { known: () => true, refused: (n) => `@${n}` };
const NONE = { known: () => false, refused: (n) => `@${n} isn't one of this system's names` };
const dice = (...answers) => { let i = 0; return () => answers[i++ % answers.length]; };
const parts = (text) => damageParts(text).map((p) => [p.text, p.label]);

const ARMED = {
  format: 1, name: 'Armed', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  derived: [{ id: 'might_mod', label: 'Might mod', formula: 'floor((@might - 10) / 2)' }],
  damage: { types: { fire: { name: 'Hell Fire' } } },
  items: {
    types: [{ id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'heals', label: 'HEALS', kind: 'dice' }] }],
    list: [
      { id: 'tongue', label: 'Flame Tongue', type: 'weapons', values: { damage: '1d8 + @might_mod slashing + 2d6 hell fire' } },
      { id: 'sword', label: 'Longsword', type: 'weapons', values: { damage: '1d8 SLASHING DMG' } },
    ],
  },
};
const lines = (...rows) => ({ inventory: JSON.stringify(rows.map((r) => ({ qty: 1, enc: '', bundled: false, carry: 'readied', location: '', ...r }))) });

describe('a DAMAGE value\'s parts, by its shape', () => {
  it('plain dice: one part, as written', () => {
    expect(parts('1d8 + @might_mod')).toEqual([['1d8 + @might_mod', null]]);
    expect(parts(' 2d6 - 1 ')).toEqual([['2d6 - 1', null]]);
    expect(typed('1d8 + @might_mod')).toBe(false);
  });

  it('a type after its dice; DMG only a word; any case; one of several words', () => {
    expect(parts('2d6 FIRE DMG')).toEqual([['2d6', 'FIRE']]);
    expect(parts('2d6 fire dmg')).toEqual([['2d6', 'fire']]);
    expect(parts('1d8 DMG')).toEqual([['1d8', null]]);
    expect(parts('3d6 Hell  Fire')).toEqual([['3d6', 'Hell Fire']]);
    expect(parts("2d4 Dragon's-Breath")).toEqual([['2d4', "Dragon's-Breath"]]);
    expect(typed('2d6 FIRE DMG')).toBe(true);
    expect(typed('1d8 DMG')).toBe(false);
  });

  it('several parts, each closed by its type, the sign joining them dropped; what follows the last its own part', () => {
    expect(parts('1d8 SLASHING + 2d6 FIRE DMG')).toEqual([['1d8', 'SLASHING'], ['2d6', 'FIRE']]);
    expect(parts('1d8 + 2d6 FIRE')).toEqual([['1d8 + 2d6', 'FIRE']]);
    expect(parts('2d6 FIRE + 2')).toEqual([['2d6', 'FIRE'], ['2', null]]);
    expect(parts('2d6 FIRE - 1')).toEqual([['2d6', 'FIRE'], ['- 1', null]]);
    expect(parts('1d6 dmg + 1d4 cold')).toEqual([['1d6', null], ['1d4', 'cold']]);
  });

  it('never the formula language\'s words: @names, dice as words, functions, and, or, not, words in brackets', () => {
    expect(parts('@level d8 + @might_mod FIRE')).toEqual([['@level d8 + @might_mod', 'FIRE']]);
    expect(parts('max(1d4, @might_mod) COLD')).toEqual([['max(1d4, @might_mod)', 'COLD']]);
    expect(parts('if(@might > 12 and @might_mod, 2d6, 1d6) ACID')).toEqual([['if(@might > 12 and @might_mod, 2d6, 1d6)', 'ACID']]);
    expect(parts('d20 FORCE')).toEqual([['d20', 'FORCE']]);
    expect(parts('floor (1d6 / 2)')).toEqual([['floor (1d6 / 2)', null]]);
    expect(parts('1d6 and')).toEqual([['1d6 and', null]]);
    // A word in brackets is the formula's, never a type: a mistake there is the dice's to say.
    expect(parts('max(1d4, cold) FIRE')).toEqual([['max(1d4, cold)', 'FIRE']]);
    // A hyphen or apostrophe left at a type's end isn't part of its name.
    expect(parts('2d6 fire-')).toEqual([['2d6', 'fire']]);
  });

  it('a type with no dice before it, refused; each part\'s dice read as a box reads them', () => {
    expect(damageProblem('FIRE', ANY)).toBe('Dice before FIRE, like 2d6 FIRE');
    expect(damageProblem('2d6 FIRE + COLD', ANY)).toBe('Dice before COLD, like 2d6 COLD');
    expect(damageProblem('2d6 FIRE', ANY)).toBeNull();
    expect(damageProblem('1d8 + @gone SLASHING', NONE)).toBe('@gone isn\'t one of this system\'s names');
    expect(damageProblem('1d8 +', ANY)).not.toBeNull();
    expect(damageProblem('', ANY)).toBe('Dice, like 1d8 + @might_mod');
  });
});

describe('rolled against the game\'s types', () => {
  const types = damageTypesOf(ARMED);
  it('each part its value; a type matched by name in any case and spacing; a word with none said as typed', () => {
    const r = rollDamage('1d8 slashing + 2d6 hell  fire + 1d4 sonic + 1', {}, ANY, dice(0.5), types);
    expect(r.parts.map((p) => [p.value, p.label, p.type])).toEqual([[5, 'SLASHING', 'slashing'], [8, 'HELL FIRE', 'fire'], [3, 'SONIC', null], [1, null, null]]);
    expect(r.value).toBe(17);
    // 1d8, 2d6 and 1d4: one entry each, 2d6 with its two rolls.
    expect(r.dice.map((d) => d.rolls.length)).toEqual([1, 2, 1]);
    // A type's name matched with any spacing, its own or the line's.
    const spaced = damageTypesOf({ ...ARMED, damage: { types: { fire: { name: 'Hell  Fire' } } } });
    expect(rollDamage('2d6 hell fire', {}, ANY, dice(0), spaced).parts[0]).toMatchObject({ type: 'fire', label: 'HELL FIRE' });
    // A type switched off is no type: said as typed.
    const off = rollDamage('2d6 FIRE', {}, ANY, dice(0), damageTypesOf({ ...ARMED, damage: { types: { fire: { on: false } } } }));
    expect(off.parts[0]).toMatchObject({ label: 'FIRE', type: null, value: 2 });
    expect(rollDamage('FIRE', {}, ANY, dice(0), types)).toEqual({ error: 'Dice before FIRE' });
    expect(rollDamage('2d6 + @x FIRE', {}, NONE, dice(0), types)).toEqual({ error: '@x isn\'t one of this system\'s names' });
  });
});

describe('a line of gear rolled', () => {
  it('a typed DAMAGE part by part, the log saying each and the whole', () => {
    const data = { might: 14, might_mod: 2, ...lines({ name: 'Flame Tongue' }) };
    const r = rollGear(ARMED, data, 0, 'damage', { rng: dice(0.5), who: 'Kes' });
    expect(r).toMatchObject({ ok: true, line: 'Flame Tongue', label: 'DAMAGE', kind: 'damage', value: 15, add: 2 });
    expect(r.parts).toEqual([{ value: 7, label: 'SLASHING', type: 'slashing' }, { value: 8, label: 'HELL FIRE', type: 'fire' }]);
    expect(r.history).toBe('Kes rolled Flame Tongue DAMAGE 1d8 + @might_mod slashing + 2d6 hell fire [5 + 2] + [(4, 4)] = 7 SLASHING + 8 HELL FIRE DMG (15)');
  });

  it('a part with no type among typed ones: its number alone, the whole after', () => {
    const r = rollGear(ARMED, lines({ name: 'Torch', type: 'weapons', values: { damage: '2d6 FIRE + 2' } }), 0, 'damage', { rng: dice(0), who: 'Wren' });
    expect(r.history).toBe('Wren rolled Torch DAMAGE 2d6 FIRE + 2 [(1, 1)] + [0 + 2] = 2 FIRE + 2 DMG (4)');
    // FIRE is renamed Hell Fire in this game, so the word is said as typed, no type of it.
    expect(r.parts).toEqual([{ value: 2, label: 'FIRE', type: null }, { value: 2, label: null, type: null }]);
  });

  it('one type: no whole after it; for an NPC', () => {
    const r = rollGear(ARMED, lines({ name: 'Longsword' }), 0, 'damage', { rng: dice(0), who: 'The GM', forName: 'Grub' });
    expect(r.history).toBe('The GM rolled Longsword DAMAGE for Grub 1d8 SLASHING DMG [1] = 1 SLASHING DMG');
    expect(r.parts).toEqual([{ value: 1, label: 'SLASHING', type: 'slashing' }]);
  });

  it('plain dice as before, with no parts; a DICE column never read for types', () => {
    const r = rollGear(ARMED, lines({ name: 'Club', type: 'weapons', values: { damage: '1d6' } }), 0, 'damage', { rng: dice(0), who: 'Wren' });
    expect(r.history).toBe('Wren rolled Club DAMAGE 1d6 [1 = 1]');
    expect(r.parts).toBeUndefined();
    expect(rollGear(ARMED, lines({ name: 'Herb', type: 'weapons', values: { heals: '2d4 FIRE' } }), 0, 'heals', { rng: dice(0), who: 'Wren' })).toEqual({ ok: false, error: 'Nothing to roll' });
  });

  it('read on the sheet: the least and most of every part together', () => {
    const data = { might: 14, might_mod: 2 };
    expect(readGearDice(ARMED, data, '1d8 + @might_mod SLASHING + 2d6 FIRE')).toMatchObject({ ok: true, low: 5, high: 22, used: [{ token: '@might_mod', label: 'Might mod', value: 2 }] });
    expect(readGearDice(ARMED, data, '1d8 FIRE DMG')).toMatchObject({ ok: true, low: 1, high: 8 });
    expect(readGearDice(ARMED, data, 'FIRE')).toMatchObject({ ok: false, error: 'Dice before FIRE' });
    expect(readGearDice(ARMED, data, '1d8 + @gone FIRE')).toMatchObject({ ok: false, error: '@gone isn\'t one of this system\'s names' });
    expect(readGearDice(ARMED, data, '1d8')).toMatchObject({ ok: true, low: 1, high: 8 });
  });
});

describe('in a catalogue file', () => {
  const { parseCatalogue } = require_('../shops/catalogueParse');
  const GUNS = { id: 'guns', label: 'GUNS', one: 'Gun', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }] };
  it('a line\'s DAMAGE with its types kept as written; a type with no dice, that line left out and said', () => {
    const out = parseCatalogue('[GUNS]\nname, price, damage\nFlamer, 900, 1d8 KINETIC + 2d6 FIRE DMG\nDud, 1, FIRE\n', { types: [GUNS], names: ANY, shelves: [] });
    expect(out.sections['type:guns']).toEqual([expect.objectContaining({ name: 'Flamer', fields: { damage: '1d8 KINETIC + 2d6 FIRE DMG' } })]);
    expect(out.problems.map((p) => p.message)).toEqual(['DAMAGE "FIRE": Dice before FIRE, like 2d6 FIRE']);
  });
});

describe('a DAMAGE column\'s MOST LINES ARE (8b2b)', () => {
  const { typesShown } = require_('../systemBuilder/itemTypes');
  const withUsual = (usual, damage = ARMED.damage) => ({ ...ARMED, damage, items: { ...ARMED.items, types: [{ ...ARMED.items.types[0], columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage', usual }, ARMED.items.types[0].columns[1]] }] } });
  const problems = (def) => checkDefinition(def).problems.map((p) => `${p.where}: ${p.message}`);
  it('one of the game\'s damage types that is on; said to the sheet by the name a hit says', () => {
    expect(problems(withUsual('slashing'))).toEqual([]);
    expect(typesShown(withUsual('slashing'))[0].columns[0]).toEqual({ id: 'damage', label: 'DAMAGE', kind: 'damage', usual: 'SLASHING' });
    // Renamed, by its new name.
    expect(typesShown(withUsual('fire'))[0].columns[0].usual).toBe('HELL FIRE');
  });
  it('a type there isn\'t, or one off, refused; nothing said to the sheet; none, nothing to say', () => {
    expect(problems(withUsual('sonic'))).toEqual(['type weapons, column damage, usual: No damage type that is on is called sonic']);
    expect(problems(withUsual('fire', { types: { fire: { on: false } } }))).toEqual(['type weapons, column damage, usual: No damage type that is on is called fire']);
    expect(problems(withUsual(3))).toEqual(['type weapons, column damage, usual: A damage type, or nothing']);
    expect(typesShown(withUsual('fire', { types: { fire: { on: false } } }))[0].columns[0].usual).toBeUndefined();
    expect(typesShown(ARMED)[0].columns[0].usual).toBeUndefined();
    // A DICE column has none.
    const dice = { ...ARMED, items: { ...ARMED.items, types: [{ ...ARMED.items.types[0], columns: [{ id: 'heals', label: 'HEALS', kind: 'dice', usual: 'fire' }] }] } };
    expect(problems(dice)).toContain('type weapons, column heals, usual: Not part of a DICE column');
  });
});

describe('checked, and previewed in the builder', () => {
  it('an item\'s DAMAGE with types is a value it may have; its dice still checked; DICE takes none', () => {
    expect(checkDefinition(ARMED).problems).toEqual([]);
    const bad = { ...ARMED, items: { ...ARMED.items, list: [{ id: 'x', label: 'X', type: 'weapons', values: { damage: 'FIRE', heals: '2d4 FIRE' } }] } };
    expect(checkDefinition(bad).problems.map((p) => `${p.where}: ${p.message}`)).toEqual([
      'item x, values, damage: Dice before FIRE, like 2d6 FIRE',
      expect.stringMatching(/^item x, values, heals: /),
    ]);
  });

  it('the DAMAGE box\'s preview: the least and most summed, each part with its type; plain dice as a rest\'s amount reads them', () => {
    const [typedRead, plain, refused, unknown] = previewFormulas(ARMED, [
      { text: '1d8 + @might_mod SLASHING + 2d6 FIRE', kind: 'damage' },
      { text: '1d8 + 2', kind: 'damage' },
      { text: 'COLD', kind: 'damage' },
      { text: '1d8 + @gone FIRE', kind: 'damage' },
    ]);
    expect(typedRead).toMatchObject({ ok: true, parts: [{ label: 'SLASHING' }, { label: 'FIRE', value: 2, most: 12 }] });
    expect(typedRead.most - typedRead.value).toBe(7 + 10);
    expect(typedRead.reads.map((r) => r.id)).toEqual(['might_mod']);
    // A name read by two parts, said once.
    const [twice] = previewFormulas(ARMED, [{ text: '1d8 + @might_mod SLASHING + 1d4 + @might_mod FIRE', kind: 'damage' }]);
    expect(twice.reads.map((r) => r.id)).toEqual(['might_mod']);
    expect(plain).toMatchObject({ ok: true, value: 3, most: 10 });
    expect(plain.parts).toBeUndefined();
    expect(refused).toEqual({ ok: false, problem: 'Dice before COLD, like 2d6 COLD' });
    expect(unknown).toMatchObject({ ok: false, problem: '@gone isn\'t one of this system\'s names' });
  });
});
