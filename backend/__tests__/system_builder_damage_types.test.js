import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';

/**
 * A system's damage types (8b1a; approved mockup docs/mockups/damage-pipeline.html, answered 2026-11-23): the starter set
 * renamed, switched off or added to, each with an icon, an upload or a pad drawing, and what RESIST, IMMUNE and VULNERABLE
 * mean in words; checked as strictly as the rest of an untrusted file, carried beside the system in its file and with
 * its pictures in its zip.
 */

const require_ = createRequire(import.meta.url);
const { STANDARD, ICONS, DAMAGE_ICONS, KINDS, MEANS, LIMITS, checkDamage, damageTypesOf, meaningsOf } = require_('../systemBuilder/damageTypes');
const { checkDefinition } = require_('../systemBuilder/definition');
const { ICONS: CONDITION_ICONS } = require_('../systemBuilder/conditions');
const { BLANK_DRAWN } = require_('../systemBuilder/drawings');
const citysys = require_('../systemBuilder/citysys');
const { versionChanges } = require_('../systemBuilder/versionDiff');
const zip = require_('../systemBuilder/citysysZip');
const { unzipSync, strFromU8 } = require_('fflate');

const problemsOf = (damage) => { const p = []; checkDamage(damage, p); return p.map((x) => `${x.where}: ${x.message}`); };
const upload = (ext = 'png') => `/uploads/condition_icons/${'c'.repeat(64)}.${ext}`;
const DRAWN = BLANK_DRAWN.map((r, i) => (i === 3 ? '0ff0' : r));
const names = (def) => damageTypesOf(def).map((t) => t.name);
const OWN = { format: 1, name: 'Ember Line' };

describe('the starter set', () => {
  it('17, the usual games\' and a cyberpunk table\'s; PHYSICAL, ENERGY, KINETIC and EMP start off', () => {
    expect(STANDARD.map((t) => t.id)).toEqual(['fire', 'cold', 'lightning', 'acid', 'poison', 'necrotic', 'radiant', 'psychic', 'force', 'thunder',
      'physical', 'bludgeoning', 'piercing', 'slashing', 'energy', 'kinetic', 'emp']);
    expect(STANDARD.filter((t) => t.on === false).map((t) => t.id)).toEqual(['physical', 'energy', 'kinetic', 'emp']);
    expect(names(OWN)).toEqual(['Fire', 'Cold', 'Lightning', 'Acid', 'Poison', 'Necrotic', 'Radiant', 'Psychic', 'Force', 'Thunder', 'Bludgeoning', 'Piercing', 'Slashing']);
    // Each a drawn icon the server knows, and words.
    for (const t of STANDARD) { expect(ICONS).toContain(t.icon); expect(t.description).toBeTruthy(); }
  });

  it('the icons: the conditions\' and five drawn for damage', () => {
    expect(DAMAGE_ICONS).toEqual(['blade', 'point', 'impact', 'wave', 'ray']);
    expect(ICONS).toEqual([...CONDITION_ICONS, ...DAMAGE_ICONS]);
  });

  it('as a system has it: renamed, switched off or on, its own after them in the order written, a picture each', () => {
    const def = { ...OWN, damage: { types: {
      fire: { name: 'Flame', description: 'Hot.' }, necrotic: { on: false }, physical: { on: true }, emp: { on: false },
      sonic: { name: ' Sonic ', icon: 'wave' }, laser: { name: 'Laser', drawn: DRAWN }, glitch: { name: 'Glitch' },
      cold: { drawn: DRAWN, icon: 'flame' },
    } } };
    expect(checkDefinition({ ...def, damage: { types: { ...def.damage.types, cold: { drawn: DRAWN } } } }).problems).toEqual([]);
    const list = damageTypesOf(def);
    expect(list.map((t) => t.id)).toEqual(['fire', 'cold', 'lightning', 'acid', 'poison', 'radiant', 'psychic', 'force', 'thunder', 'physical', 'bludgeoning', 'piercing', 'slashing', 'sonic', 'laser', 'glitch']);
    expect(list[0]).toEqual({ id: 'fire', name: 'Flame', icon: 'flame', description: 'Hot.', standard: true });
    // A drawing wins over an icon, as only one is kept.
    expect(list[1]).toEqual({ id: 'cold', name: 'Cold', drawn: DRAWN, description: 'Freezes.', standard: true });
    expect(list.find((t) => t.id === 'sonic')).toEqual({ id: 'sonic', name: 'Sonic', icon: 'wave', description: '', standard: false });
    expect(list.find((t) => t.id === 'laser').drawn).toEqual(DRAWN);
    // One of its own with no picture: the drawn target.
    expect(list.find((t) => t.id === 'glitch').icon).toBe('target');
    // A blank name on a starter one keeps the starter's; an upload is its icon.
    expect(damageTypesOf({ ...OWN, damage: { types: { acid: { name: '  ', icon: upload() } } } })[3]).toMatchObject({ name: 'Acid', icon: upload() });
    // One of its own with no name yet is not offered.
    expect(damageTypesOf({ ...OWN, damage: { types: { unnamed: {}, blank: { name: ' ' } } } })).toHaveLength(13);
    // A drawing or an icon not well formed falls back.
    expect(damageTypesOf({ ...OWN, damage: { types: { fire: { icon: 'nope', drawn: ['zz'] } } } })[0]).toMatchObject({ icon: 'flame' });
  });

  it('nothing said: every starter one that starts on, and the app\'s words', () => {
    for (const def of [OWN, null, { ...OWN, damage: 'x' }, { ...OWN, damage: { types: [] } }]) expect(damageTypesOf(def)).toHaveLength(13);
    expect(meaningsOf(OWN)).toEqual(MEANS);
    expect(MEANS).toEqual({ resist: 'Takes half, rounded down.', immune: 'Takes none.', vulnerable: 'Takes double.' });
    expect(KINDS).toEqual(['resist', 'immune', 'vulnerable']);
  });

  it('what each word means, as the system says it, or the app\'s where blank', () => {
    expect(meaningsOf({ ...OWN, damage: { resist: { means: ' Takes half. ' }, immune: { means: '' }, vulnerable: {} } }))
      .toEqual({ resist: 'Takes half.', immune: 'Takes none.', vulnerable: 'Takes double.' });
  });

  it('at most 40 in all', () => {
    const many = Object.fromEntries(Array.from({ length: LIMITS.types - STANDARD.length + 1 }, (_, i) => [`own_${i}`, { name: `Own ${i}` }]));
    expect(problemsOf({ types: many })).toContain(`damage, types: At most ${LIMITS.types} damage types, the 17 starter ones included`);
    const fits = Object.fromEntries(Object.entries(many).slice(1));
    expect(problemsOf({ types: fits })).toEqual([]);
    expect(damageTypesOf({ ...OWN, damage: { types: { physical: { on: true }, energy: { on: true }, kinetic: { on: true }, emp: { on: true }, ...many } } })).toHaveLength(LIMITS.types);
  });
});

describe('checked as an untrusted file is', () => {
  it('the section, the words and each type\'s parts', () => {
    expect(problemsOf(undefined)).toEqual([]);
    expect(problemsOf('x')).toEqual(['damage: Must be the damage types and what resisting means']);
    expect(problemsOf({ apply: 'auto' })).toEqual(['damage, apply: Not part of damage']);
    expect(problemsOf({ resist: 'half' })).toEqual(['damage, resist: Must say what it means']);
    expect(problemsOf({ immune: { means: 3, works_out: 'none' } })).toEqual(['damage, immune, works_out: Only what it means', 'damage, immune, means: Must be text']);
    expect(problemsOf({ vulnerable: { means: 'x'.repeat(LIMITS.means + 1) } })).toEqual([`damage, vulnerable, means: Longer than ${LIMITS.means} characters`]);
    expect(problemsOf({ vulnerable: { means: 'x'.repeat(LIMITS.means) } })).toEqual([]);
    expect(problemsOf({ types: [] })).toEqual(['damage, types: Must be a set of damage types']);
  });

  it('a type: its id, its parts, on only for a starter one, a name for one of its own', () => {
    expect(problemsOf({ types: {
      Bad: { name: 'Bad' }, fire: 'hot', sonic: { name: 'Sonic', on: true, short: 'SON' }, cold: { on: 'yes', colour: 'blue' }, glitch: {}, blank: { name: '  ' },
    } })).toEqual([
      'damage type Bad: Ids use lowercase letters, digits and _, starting with a letter',
      'damage type fire: Must be a damage type',
      'damage type sonic, on: Only a starter type is turned off; delete one of the system\'s own instead',
      'damage type sonic, short: Not part of a damage type',
      'damage type cold, colour: Not part of a damage type',
      'damage type cold, on: Must say on: true or on: false',
      'damage type glitch, name: Needs a name',
      'damage type blank, name: Needs a name',
    ]);
  });

  it('a name as a hit says it: letters, digits, spaces, a hyphen or an apostrophe, never DMG, and not too long', () => {
    const named = (name) => problemsOf({ types: { own: { name } } });
    for (const ok of ['Sonic', 'Hellfire 2', 'Soul-Burn', "Dragon's Breath", 'emp pulse']) expect(named(ok)).toEqual([]);
    for (const bad of ['2Hot', 'Fire+Ice', 'Fire/Ice', '-Cold', 'Fire, Ice']) expect(named(bad)).toEqual(['damage type own, name: Letters, digits, spaces, a hyphen or an apostrophe, starting with a letter']);
    expect(named('dmg')).toEqual(['damage type own, name: DMG is the word after a hit, so not a type\'s name']);
    expect(named(' DMG ')).toEqual(['damage type own, name: DMG is the word after a hit, so not a type\'s name']);
    expect(named('x'.repeat(LIMITS.name + 1))).toEqual([`damage type own, name: Longer than ${LIMITS.name} characters`]);
    expect(named('x'.repeat(LIMITS.name))).toEqual([]);
    expect(named(7)).toEqual(['damage type own, name: Needs a name']);
    expect(problemsOf({ types: { fire: { name: 7 } } })).toEqual(['damage type fire, name: Must be text']);
    // A starter one's blank name keeps the starter's.
    expect(problemsOf({ types: { fire: { name: '' } } })).toEqual([]);
  });

  it('two on with one name are refused, any case or spacing; off, or renamed away, fine', () => {
    expect(problemsOf({ types: { blaze: { name: 'fire' } } })).toEqual(['damage type blaze, name: FIRE is already the name of damage type fire; a hit names its type, so each needs its own']);
    expect(problemsOf({ types: { cold: { name: 'Hell  Fire' }, blaze: { name: 'hell fire' } } })).toEqual(['damage type blaze, name: HELL FIRE is already the name of damage type cold; a hit names its type, so each needs its own']);
    // KINETIC starts off, so a type of that name is fine until it is switched on.
    expect(problemsOf({ types: { slug: { name: 'Kinetic' } } })).toEqual([]);
    expect(problemsOf({ types: { kinetic: { on: true }, slug: { name: 'Kinetic' } } })).toHaveLength(1);
    expect(problemsOf({ types: { fire: { on: false }, blaze: { name: 'Fire' } } })).toEqual([]);
    expect(problemsOf({ types: { fire: { name: 'Flame' }, blaze: { name: 'Fire' } } })).toEqual([]);
  });

  it('a picture: a drawn icon, an upload or a pad drawing, one of them', () => {
    expect(problemsOf({ types: { fire: { icon: 'wave' }, cold: { icon: upload('svg') }, acid: { drawn: DRAWN } } })).toEqual([]);
    expect(problemsOf({ types: { fire: { icon: 'nope' }, cold: { icon: '/uploads/currency_icons/x.png' } } })).toEqual([
      'damage type fire, icon: One of the drawn icons, or an uploaded one', 'damage type cold, icon: One of the drawn icons, or an uploaded one']);
    expect(problemsOf({ types: { fire: { drawn: ['zz'] } } })).toEqual(['damage type fire, drawn: A drawing of 16 rows, each 4 hex digits']);
    expect(problemsOf({ types: { fire: { icon: 'wave', drawn: DRAWN } } })).toEqual(['damage type fire, drawn: An icon or a drawing, not both']);
    expect(problemsOf({ types: { fire: { description: 3 }, cold: { description: 'x'.repeat(LIMITS.description + 1) } } })).toEqual([
      'damage type fire, description: Must be text', `damage type cold, description: Longer than ${LIMITS.description} characters`]);
  });

  it('a new version that changes them says so, in the one line for what changes no character', () => {
    expect(versionChanges(OWN, { ...OWN, damage: { types: { fire: { name: 'Flame' } } } })).toContainEqual({ kind: 'other', change: 'changed', id: 'damage' });
    expect(versionChanges(OWN, OWN).filter((c) => c.id === 'damage')).toEqual([]);
  });

  it('a system\'s problems name them, so it can\'t be published with any', () => {
    expect(checkDefinition({ ...OWN, damage: { types: { blaze: { name: 'Fire' } } } }).problems.map((p) => p.where)).toEqual(['damage type blaze, name']);
    expect(checkDefinition({ ...OWN, damage: { types: { fire: { name: 'Flame' } }, resist: { means: 'Half.' } } }).problems).toEqual([]);
  });
});

describe('carried with the system', () => {
  const DEF = { ...OWN, damage: { types: { fire: { name: 'Flame' }, physical: { on: true }, sonic: { name: 'Sonic', icon: 'wave' }, laser: { name: 'Laser', drawn: DRAWN } }, resist: { means: 'Half.' } } };

  it('in its file beside the definition, for a builder from before, and read back unchanged', () => {
    const file = citysys.buildFile({ definition: DEF, version: 2, origin: 'org_ember' });
    expect(file.definition.damage).toBeUndefined();
    expect(file.damage).toEqual(DEF.damage);
    const read = citysys.readFile(JSON.stringify(file));
    expect(read.problems).toEqual([]);
    expect(read.file.definition.damage).toEqual(DEF.damage);
    expect(damageTypesOf(read.file.definition)).toEqual(damageTypesOf(DEF));
  });

  describe('in its zip, with a picture uploaded for a type', () => {
    let root;
    const bytes = crypto.randomBytes(300);
    const name = `${crypto.createHash('sha256').update(bytes).digest('hex')}.png`;
    const address = `/uploads/condition_icons/${name}`;
    const withUpload = { ...DEF, damage: { ...DEF.damage, types: { ...DEF.damage.types, sonic: { name: 'Sonic', icon: address }, acid: { icon: address } } } };
    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), 'damage-zip-'));
      fs.mkdirSync(path.join(root, 'condition_icons'), { recursive: true });
      fs.writeFileSync(path.join(root, 'condition_icons', name), bytes);
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it('named for the type, by its name; read back and stored where its address finds it', () => {
      expect(zip.uploadsIn(withUpload)).toEqual([
        { kind: 'damage_types', id: 'sonic', name: 'Sonic', address, used: '' },
        // A starter one by the name it has.
        { kind: 'damage_types', id: 'acid', name: 'Acid', address, used: '' },
      ]);
      const made = zip.buildZip({ definition: withUpload, version: 3, origin: 'org_ember', root });
      const inside = unzipSync(new Uint8Array(made.bytes));
      expect(Object.keys(inside).filter((k) => k.startsWith('images/')).sort()).toEqual(['images/damage_types/acid.png', 'images/damage_types/sonic.png']);
      expect(strFromU8(inside['IMAGES.txt'])).toContain('images/damage_types/sonic.png  SONIC');
      const read = zip.readZip(made.bytes);
      const file = citysys.readFile(read.text).file;
      expect(file.definition.damage).toEqual(withUpload.damage);
      const named = zip.imagesFor(file.definition, read.images);
      expect(named.map((x) => `${x.folder}/${x.name}`)).toEqual([`condition_icons/${name}`]);
    });

    it('left out, a type falls back to its starter icon or the drawn target; its drawing stays', () => {
      const out = zip.withoutUploads(withUpload);
      expect(out.damage.types.sonic).toEqual({ name: 'Sonic' });
      expect(out.damage.types.acid).toEqual({});
      expect(out.damage.types.laser.drawn).toEqual(DRAWN);
      expect(out.damage.resist).toEqual({ means: 'Half.' });
      expect(checkDefinition(out).problems).toEqual([]);
      expect(damageTypesOf(out).find((t) => t.id === 'acid').icon).toBe('drop');
      expect(damageTypesOf(out).find((t) => t.id === 'sonic').icon).toBe('target');
      // The system's own copy untouched.
      expect(withUpload.damage.types.sonic.icon).toBe(address);
      // Without damage types, nothing to strip.
      expect(zip.withoutUploads(OWN)).toEqual(OWN);
    });
  });
});
