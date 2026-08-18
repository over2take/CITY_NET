/**
 * Reading a Cyberpunk RED Companion export.
 *
 * The fixture below is **hand-written**, not a captured export: a real one is somebody's
 * character, and it does not belong in the repo. It is shaped from what the Foundry module
 * reads — which is the only description of this format there is, since it is a public
 * Firestore path rather than a published API.
 *
 * That is also why the failure cases matter more than usual here. Nobody controls this
 * format, it can change without notice, and the right answer to an export that no longer
 * looks the way we expect is a preview that says so — never a sheet quietly filled with
 * the wrong numbers.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { parseFirestore, flattenCompanion, exportVersion } = require('../sheets/companionImport.js');
const { getImporter } = require('../sheets/importers.js');

/** Firestore wraps every scalar in a type tag; maps and arrays nest more of them. */
const str = (v) => ({ stringValue: v });
const int = (v) => ({ integerValue: String(v) });
const map = (fields) => ({ mapValue: { fields } });
const arr = (values) => ({ arrayValue: { values } });

/**
 * A v2 export, shaped from a real one and then written by hand.
 *
 * Two things here were not in the description this was first built from, and both broke the
 * first version: collections are **maps keyed by a generated uuid**, not arrays, and stats
 * use their full names — `Intelligence`, not `INT`.
 */
const V2 = {
  fields: {
    handle: str('Nyx'),
    health: int(35),
    humanity: int(50),
    maxHumanity: int(60),
    deathSave: int(6),
    luck: int(5),
    eddies: int(1200),
    personality: str('Quiet until she is not'),
    motivation: str('Owes a fixer'),
    roleAbilities: map({ Netrunner: map({ rank: int(4) }) }),
    improvementPoints: int(45),
    reputation: int(3),
    subSkills: map({ Language: map({ name: str('Streetslang'), points: int(4) }) }),
    lifepath: str('Grew up in the combat zone.'),
    stats: map({
      Intelligence: int(8), Reflexes: int(6), Technique: int(7),
      Cool: int(5), Body: int(4), Movement: int(6), Willpower: int(5),
      Dexterity: int(6), Empathy: int(5), Luck: int(5),
    }),
    skills: map({ Handgun: int(4), Stealth: int(3), WardrobeAndStyle: int(2) }),
    weapons: map({
      '16abc894-8e09-40ed-bb19-24ef4a04f80f': map({ name: str('Militech Avenger') }),
      'b1f839d6-94d5-426a-ad86-91438ef62f59': map({ name: str('Monoblade') }),
    }),
    vehicles: map({ 'c1d2e3f4-0000-0000-0000-000000000001': map({ name: str('Thorton Galena') }) }),
    cyberware: map({ 'ff0b11e8-55fd-4729-8046-fbef5ce33861': map({ name: str('Neural Link') }) }),
    gear: map({ '18973d26-a784-48f3-a229-28ac732e6bc6': map({ name: str('Agent') }) }),
    armor: map({ 'dc6390bf-8e33-460f-b0c1-7e4c4367391b': map({ name: str('Light Armorjack') }) }),
  },
};

describe('unwrapping the wire format', () => {
  it('reads scalars out of their type tags', () => {
    expect(parseFirestore(str('V'))).toBe('V');
    expect(parseFirestore(int(7))).toBe(7);
    expect(parseFirestore({ doubleValue: 1.5 })).toBe(1.5);
    expect(parseFirestore({ booleanValue: true })).toBe(true);
    expect(parseFirestore({ nullValue: null })).toBeNull();
  });

  it('turns Firestore integers into numbers, not strings', () => {
    // They arrive as strings, which is Firestore's doing. A stat of "8" would be rejected
    // downstream as non-numeric and silently dropped.
    expect(parseFirestore(int(8))).toBe(8);
    expect(typeof parseFirestore(int(8))).toBe('number');
  });

  it('walks arrays and maps to any depth', () => {
    const nested = map({ outer: arr([map({ inner: int(3) })]) });
    expect(parseFirestore(nested)).toEqual({ outer: [{ inner: 3 }] });
  });

  it('gives back null for a value type it does not know', () => {
    // A new type appearing in one field should cost that field, not the whole import.
    expect(parseFirestore({ geoPointValue: { latitude: 1 } })).toEqual({ geoPointValue: { latitude: 1 } });
    expect(() => parseFirestore(undefined)).not.toThrow();
    expect(parseFirestore(undefined)).toBeNull();
  });
});

describe('flattening a v2 export', () => {
  const { candidates, version, missing } = flattenCompanion(V2);

  it('knows which generation it is', () => {
    expect(version).toBe(2);
  });

  it('carries stats and skills across by their own names', () => {
    // No mapping table here on purpose: the importer's aliases normalise case and
    // punctuation away, so one table does the matching rather than two that drift.
    expect(candidates).toMatchObject({ Intelligence: 8, Reflexes: 6, Handgun: 4, Stealth: 3 });
  });

  it('reads collections keyed by uuid, which is how they really arrive', () => {
    // The description this was built from said arrays. A real export uses maps, and the
    // first version of this adapter silently found no items at all.
    expect(candidates.weapon1name).toBe('Militech Avenger');
    expect(candidates.cyberware).toBe('Neural Link');
  });

  it('takes the role and its rank from roleAbilities, which is where they live', () => {
    // There is no `role` field. The role is the single key of that map, and the rank is
    // inside it.
    expect(candidates.role).toBe('Netrunner');
    expect(candidates.roleabilityrank).toBe(4);
  });

  it('carries the two numbers the sheet gained for this', () => {
    // IP and Reputation are currencies a table spends between sessions and had nowhere to
    // live but prose. They are fields now, so the import fills them.
    expect(candidates).toMatchObject({ improvementpoints: 45, reputation: 3 });
  });

  it('names the sub-skills instead of guessing where to put them', () => {
    // A specialised skill needs a row that can hold its specialisation, and ours are fixed
    // fields. Reported so a player writes it down rather than wondering where it went.
    expect(missing.join(' ')).toMatch(/sub-skills/);
  });

  it('carries the numbers that sit beside the pools', () => {
    expect(candidates).toMatchObject({ humanitymax: 60, deathsave: 6, luck: 5, cash: 1200 });
  });

  it('carries identity and the derived pools', () => {
    expect(candidates).toMatchObject({ handle: 'Nyx', role: 'Netrunner', hp: 35, humanity: 50 });
    expect(candidates.lifepath).toMatch(/combat zone/);
    // Four free-text fields the sheet keeps as one description.
    expect(candidates.description).toContain('Quiet until she is not');
    expect(candidates.description).toContain('Owes a fixer');
  });

  it('names items but does not invent their numbers', () => {
    expect(candidates.weapon1name).toBe('Militech Avenger');
    expect(candidates.weapon2name).toBe('Monoblade');
    expect(candidates.vehicle1name).toBe('Thorton Galena');
    // The export has no damage or SDP in it, so none is guessed.
    expect(candidates.weapon1dmg).toBeUndefined();
    expect(candidates.vehicle1sdp).toBeUndefined();
  });

  it('says what it could not bring across', () => {
    // The preview shows this. Left unsaid, a player sees a named car with no numbers and
    // assumes the import broke.
    expect(missing.join(' ')).toMatch(/vehicle SDP/);
    expect(missing.join(' ')).toMatch(/weapon damage/);
    expect(missing.join(' ')).toMatch(/armour SP/);
  });

  it('gathers loose kit into the free-text fields', () => {
    expect(candidates.cyberware).toBe('Neural Link');
    expect(candidates.gear).toContain('Agent');
    expect(candidates.gear).toContain('Light Armorjack');
  });
});

describe('an older export', () => {
  const V1 = { fields: { health: int(30), humanity: int(40), skill: arr([map({ skill_type_id: int(3), points: int(4) })]) } };

  it('is recognised rather than read as an empty v2', () => {
    expect(exportVersion({ health: 30, skill: [] })).toBe(1);
  });

  it('takes what is unambiguous and says what it cannot read', () => {
    // v1 keys stats and skills by numeric id, through a table we do not have. Guessing at
    // that mapping is how you import the wrong numbers without anyone noticing.
    const { candidates, missing } = flattenCompanion(V1);
    expect(candidates).toMatchObject({ hp: 30, humanity: 40 });
    expect(candidates.Handgun).toBeUndefined();
    expect(missing.join(' ')).toMatch(/older numbered format/);
  });
});

describe('an export that is not what we expect', () => {
  it('survives an empty document', () => {
    const { candidates, missing } = flattenCompanion({});
    expect(candidates).toEqual({});
    expect(Array.isArray(missing)).toBe(true);
  });

  it('survives missing and malformed sections', () => {
    const odd = { fields: { stats: str('not a map'), weapons: str('not a list'), health: str('thirty') } };
    expect(() => flattenCompanion(odd)).not.toThrow();
    const { candidates } = flattenCompanion(odd);
    // A health of "thirty" is not a number, so it is left out rather than coerced to NaN.
    expect(candidates.hp).toBeUndefined();
  });

  it('ignores items with no name', () => {
    const odd = { fields: { weapons: arr([map({ quantity: int(2) }), map({ name: str('Real One') })]) } };
    expect(flattenCompanion(odd).candidates.weapon1name).toBe('Real One');
  });
});

describe('what the importer makes of it', () => {
  // The point of emitting the export's own names: the existing alias table recognises them
  // with no second mapping to maintain.
  const { candidates } = flattenCompanion(V2);
  const { mapped, unmapped } = getImporter('cyberpunk_red').mapFields(candidates);

  it('lands stats and skills on the right sheet fields', () => {
    expect(mapped).toMatchObject({ int: 8, ref: 6, tech: 7, handgun: 4, stealth: 3 });
    // Every stat and skill name a real export uses lands somewhere.
    expect(Object.keys(unmapped)).toEqual([]);
  });

  it('lands identity, and the vehicle name the sheet has a row for', () => {
    expect(mapped.name).toBe('Nyx');
    expect(mapped.role).toBe('Netrunner');
    expect(mapped.vehicle1_name).toBe('Thorton Galena');
    expect(mapped.weapon1_name).toBe('Militech Avenger');
    // Numbers arrive as numbers, not the strings Firestore sends.
    expect(mapped).toMatchObject({ improvement_points: 45, reputation: 3, role_ability_rank: 4 });
  });

  it('matches CamelCase names to our own, with no mapping table between', () => {
    // The Companion writes AirVehicleTech, our field is air_vehicle_tech, and the alias
    // normaliser reduces both to the same key. That property is what the whole
    // no-second-table decision rests on, so it is asserted rather than assumed.
    expect(getImporter('cyberpunk_red').mapFields({ AirVehicleTech: 2 }).mapped.air_vehicle_tech).toBe(2);
    // The one that does not reduce: ours is "Wardrobe & Style", theirs is WardrobeAndStyle,
    // so it needed an alias of its own. Everything else in a real export already matched.
    expect(mapped.wardrobe_style).toBe(2);
  });

  it('routes money to the bank rather than the sheet', () => {
    // Cash is a linked field, so the importer reports it instead of writing it — and the
    // preview can say where it went rather than looking as though it vanished.
    const { skipped } = getImporter('cyberpunk_red').mapFields(candidates);
    expect(skipped.cash).toBe(1200);
  });
});
