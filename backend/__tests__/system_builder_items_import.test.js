/**
 * The items import's reader (8aL3a). Approved mockup items-layout (2026-11-14), section 5: a file made from the system,
 * a section per type headed by its own columns, then needs, cost and words, and features in their own section; read
 * against a draft's items, matched by name, nothing deleted; an empty cell leaves things as they are and `-` clears; a
 * row with a mistake skipped and named by its line, the rest going in. Nothing saved: the builder puts the items in.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { readItemsFile } = require_('../systemBuilder/itemsImport');
const { MAX_BYTES } = require_('../systemBuilder/choicesImport');
const { checkDefinition } = require_('../systemBuilder/definition');
const { elevatedUsers } = require_('../middleware/auth');
const systemsRoute = require_('../routes/systems.js');

const ARMORY = {
  format: 1, name: 'Armory',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }, { id: 'strain', label: 'Strain' }] }],
  choices: [{ id: 'kits', one: 'Kit', many: 'Kits', options: [{ id: 'shotgun', label: 'Shotgun Kit' }] }],
  items: {
    slots: [{ id: 'attuned', label: 'ATTUNED', count: 3 }],
    installs: [{ id: 'cyberware', label: 'CYBERWARE', against: 'strain', limit: '@might' }],
    types: [
      { id: 'gear', label: 'GEAR', one: 'Gear', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }, { id: 'price', label: 'PRICE', kind: 'number' }] },
      { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [
        { id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'range', label: 'RANGE', kind: 'text' }, { id: 'ammo', label: 'AMMO', kind: 'count', button: 'FIRE' },
        { id: 'weight', label: 'WEIGHT', kind: 'number' }, { id: 'price', label: 'PRICE', kind: 'number' }, { id: 'grade', label: 'GRADE', kind: 'pick', options: ['LIGHT', 'HEAVY'] }] },
    ],
    list: [
      { id: 'pistol', label: 'Pistol', type: 'weapons', values: { damage: '2d6', range: '30 m', ammo: 6, weight: 2, price: 200, grade: 'LIGHT' } },
      { id: 'rounds', label: 'Pistol Rounds', type: 'gear', values: { weight: 0.05, price: 1 } },
      { id: 'boots', label: 'Boots of Quiet', features: [{ id: 'quiet', label: 'Quiet Step', text: 'Hush.', uses: { count: '1', refill: 'long_rest' } }] },
      { id: 'ring', label: 'Ring of Might', needs: 'attuned', features: [{ id: 'mighty', label: 'Mighty', modifiers: [{ target: 'might', amount: '2' }] }] },
    ],
  },
};
const FILE = (...lines) => lines.join('\n');
const read = (text, definition = ARMORY) => readItemsFile(definition, text);
const sound = (r, definition = ARMORY) => expect(checkDefinition({ ...definition, items: r.items }).problems).toEqual([]);
const byId = (r, id) => r.items.list.find((i) => i.id === id);

describe('a section per type', () => {
  it('new items of its type with their columns; one there updated; each row with a mistake skipped by its line', () => {
    const r = read(FILE(
      '[weapons]',
      'name, damage, range, ammo, weight, price, grade, needs, cost, words',
      'Pistol, 2d6 + @might, 30 m, 6, 2, 200, LIGHT, worn, , "A snub revolver."',
      'Shotgun, 3d6, 15 m, 2, 7, 300, heavy, worn, ,',
      'Crossbow, 1d10, 60 m, 1, 5, 75, MEDIUM, worn, ,',
    ));
    expect(r.added.items).toEqual([{ line: 4, item: 'Shotgun', type: 'Weapon' }]);
    expect(byId(r, 'shotgun_2')).toEqual({ id: 'shotgun_2', label: 'Shotgun', type: 'weapons', values: { damage: '3d6', range: '15 m', ammo: 2, weight: 7, price: 300, grade: 'HEAVY' } });
    expect(r.changed.items).toEqual([{ line: 3, item: 'Pistol', parts: [{ part: 'damage', from: '2d6', to: '2d6 + @might' }, { part: 'words', from: '', to: 'A snub revolver.' }] }]);
    expect(r.skipped).toEqual([{ line: 5, message: 'Crossbow: GRADE is LIGHT or HEAVY, not MEDIUM' }]);
    expect(r).toMatchObject({ changes: 2, same: 0, notes: [] });
    sound(r);
  });

  it('a section by its type\'s name or id, a column by its name or id; what isn\'t read said', () => {
    const r = read(FILE('[Weapons]', 'NAME, Damage, grade, colour', 'Club, 1d6, LIGHT, red', '[spells]', 'name', 'Fireball', '[gear]', 'weight', 'Rope'));
    expect(byId(r, 'club')).toMatchObject({ type: 'weapons', values: { damage: '1d6', grade: 'LIGHT' } });
    expect(r.notes).toEqual([{ line: 2, message: 'The colour column isn\'t one of WEAPONS\'s: only name, damage, range, ammo, weight, price, grade, in shops, needs, cost, words' }]);
    expect(r.skipped).toEqual([
      { line: 4, message: '[spells] is no type of this system\'s (GEAR, WEAPONS): make it on TYPES first, or name the section after one' },
      { line: 8, message: '[gear] needs a name column: its first line names the columns (name, weight, price, in shops, needs, cost, words)' },
    ]);
    const byIdColumn = read(FILE('[weapons]', 'name, ammo', 'Sling, 3'));
    expect(byId(byIdColumn, 'sling').values).toEqual({ ammo: 3 });
    expect(read(FILE('Rope, 1')).skipped).toEqual([{ line: 1, message: 'Before any [section], so nothing knows what it is: start with a type, like [gear]' }]);
    expect(read(FILE('[gear]', 'name, words', 'Rope, "unclosed')).skipped).toEqual([{ line: 3, message: 'A quote is opened and never closed' }]);
  });

  it('each kind read as its column has it; an empty cell leaves it, - clears it', () => {
    const r = read(FILE('[weapons]', 'name, damage, range, ammo, weight, grade',
      'Pistol, , -, , 2.5, -',
      'A, 1d4, , lots, ,',
      'B, 1d4, , 1001, ,',
      'C, 1d4 + @nope, , , ,',
      'D, 1d4, , , heavy,',
      'E, 1d4, , 2.5, ,',
      'F, , , , , light'));
    expect(byId(r, 'pistol').values).toEqual({ damage: '2d6', ammo: 6, weight: 2.5, price: 200 });
    expect(r.skipped).toEqual([
      { line: 4, message: 'A: AMMO is a number, not lots' },
      { line: 5, message: 'B: AMMO: How many it holds: 0 to 1000' },
      { line: 6, message: 'C: DAMAGE: @nope isn\'t one of this system\'s names' },
      { line: 7, message: 'D: WEIGHT is a number, not heavy' },
      { line: 8, message: 'E: AMMO: How many it holds: 0 to 1000' },
    ]);
    expect(byId(r, 'f').values).toEqual({ grade: 'LIGHT' });
    sound(r);
  });

  it('what it needs by its words; COST only for an install, 1 to start; a system with none ignores COST', () => {
    const r = read(FILE('[gear]', 'name, needs, cost, words',
      'Jack, cyberware, 0.5, A port.',
      'Plug, Cyberware, , ',
      'Band, attuned, , ',
      'Coin, carried, 2, ',
      'Hat, somewhere, , ',
      'Ring of Might, -, , ',
      'Gem, cyberware, 5000, '));
    expect(byId(r, 'jack')).toMatchObject({ needs: 'cyberware', cost: 0.5, description: 'A port.' });
    expect(byId(r, 'plug')).toMatchObject({ needs: 'cyberware', cost: 1 });
    expect(byId(r, 'band')).toMatchObject({ needs: 'attuned' });
    expect(byId(r, 'band')).not.toHaveProperty('cost');
    expect(byId(r, 'ring')).not.toHaveProperty('needs');
    expect(r.changed.items).toEqual([{ line: 8, item: 'Ring of Might', parts: [{ part: 'needs', from: 'attuned', to: 'worn' }] }]);
    expect(r.skipped).toEqual([
      { line: 6, message: 'Coin: a cost is only for an item installed as CYBERWARE' },
      { line: 7, message: 'Hat: needs is worn, carried, attuned, cyberware, not somewhere' },
      { line: 9, message: 'Gem: cost is a number from 0 to 1000, not 5000' },
    ]);
    sound(r);
    // A cost changed on one installed, and taken away when it no longer is.
    const installed = { ...ARMORY, items: { ...ARMORY.items, list: [...ARMORY.items.list, { id: 'jack', label: 'Jack', needs: 'cyberware', cost: 1 }] } };
    expect(read(FILE('[gear]', 'name, cost', 'Jack, 2'), installed).changed.items).toEqual([{ line: 3, item: 'Jack', parts: [{ part: 'cost', from: '1', to: '2' }] }]);
    expect(read(FILE('[gear]', 'name, needs', 'Jack, worn'), installed).changed.items[0].parts).toEqual([{ part: 'needs', from: 'cyberware', to: 'worn' }, { part: 'cost', from: '1', to: '' }]);
    const plain = { ...ARMORY, items: { ...ARMORY.items, installs: undefined } };
    expect(read(FILE('[gear]', 'name, cost', 'Rope, 3'), plain).notes).toEqual([{ line: 2, message: 'This system has no installs, so the cost column is ignored' }]);
  });

  it('one there under another type is made it, keeping the values both types have of the same kind', () => {
    const r = read(FILE('[weapons]', 'name, damage', 'Pistol Rounds, 1d4'));
    expect(byId(r, 'rounds')).toEqual({ id: 'rounds', label: 'Pistol Rounds', type: 'weapons', values: { weight: 0.05, price: 1, damage: '1d4' } });
    expect(r.changed.items[0].parts).toEqual([{ part: 'type', from: 'GEAR', to: 'WEAPONS' }, { part: 'damage', from: '', to: '1d4' }]);
    sound(r);
  });

  it('a system making no types: [gear] adds items as GEAR, unsaid', () => {
    const plain = { ...ARMORY, items: { list: [] } };
    const r = read(FILE('[gear]', 'name, weight', 'Rope, 10'), plain);
    expect(r.items.list).toEqual([{ id: 'rope', label: 'Rope', values: { weight: 10 } }]);
    sound(r, plain);
  });

  it('names: no name, too long, two there of it; at the most, no more', () => {
    const twice = { ...ARMORY, items: { ...ARMORY.items, list: [{ id: 'a', label: 'Twin' }, { id: 'b', label: 'Twin' }] } };
    expect(read(FILE('[gear]', 'name, words', 'Twin, x'), twice).skipped).toEqual([{ line: 3, message: 'Twin: there are 2 items called that; rename one in the builder first' }]);
    expect(read(FILE('[gear]', 'name, words', ', x', '-, y', `${'x'.repeat(41)}, z`)).skipped.map((s) => s.message)).toEqual(['No name', 'No name', 'xxxxxxxxxxxxxxxxxxxx…: a name is 40 characters at most']);
    expect(read(FILE('[gear]', 'name, words', `Rope, ${'w'.repeat(1001)}`)).skipped).toEqual([{ line: 3, message: 'Rope: the words are longer than 1000 characters' }]);
    const full = { ...ARMORY, items: { ...ARMORY.items, list: Array.from({ length: 200 }, (_, i) => ({ id: `i${i}`, label: `I${i}` })) } };
    expect(read(FILE('[gear]', 'name', 'More'), full).skipped).toEqual([{ line: 3, message: 'More: there are 200 items, the most a system holds' }]);
  });
});

describe('PRICE and IN SHOPS (8a7a3b2)', () => {
  // A type with no PRICE column, so its items' own price is read.
  const KITTED = { ...ARMORY, items: { ...ARMORY.items, types: [...ARMORY.items.types, { id: 'armor', label: 'ARMOR', one: 'Armor', columns: [{ id: 'defense', label: 'DEFENSE', kind: 'number' }] }],
    list: [...ARMORY.items.list, { id: 'jacket', label: 'Leather Jacket', type: 'armor', values: { defense: 2 }, price: 50, in_shops: true }] } };

  it('an own price where the type has no PRICE column; IN SHOPS yes or no; new and changed, each said', () => {
    const r = read(FILE('[armor]', 'name, defense, price, in shops', 'Leather Jacket, 2, 60, no', 'Breastplate, 5, 400, YES', 'Shield, 1, , '), KITTED);
    expect(r.skipped).toEqual([]);
    // Both columns read: no note about either.
    expect(r.notes).toEqual([]);
    expect(byId(r, 'jacket')).toEqual({ id: 'jacket', label: 'Leather Jacket', type: 'armor', values: { defense: 2 }, price: 60, in_shops: false });
    expect(r.changed.items).toEqual([{ line: 3, item: 'Leather Jacket', parts: [{ part: 'price', from: '50', to: '60' }, { part: 'in shops', from: 'yes', to: 'no' }] }]);
    expect(byId(r, 'breastplate')).toEqual({ id: 'breastplate', label: 'Breastplate', type: 'armor', values: { defense: 5 }, price: 400, in_shops: true });
    // Blank leaves both unsaid.
    expect(byId(r, 'shield')).toEqual({ id: 'shield', label: 'Shield', type: 'armor', values: { defense: 1 } });
    sound(r, KITTED);
  });

  it('- clears each; a price or a yes/no that isn\'t one skips the row, said by its line', () => {
    const r = read(FILE('[armor]', 'name, price, in shops', 'Leather Jacket, -, -', 'Cloak, cheap, yes', 'Hat, 5, maybe', 'Boots, 2000000000, '), KITTED);
    expect(byId(r, 'jacket')).toEqual({ id: 'jacket', label: 'Leather Jacket', type: 'armor', values: { defense: 2 } });
    expect(r.skipped).toEqual([
      { line: 4, message: 'Cloak: price is a number from 0 to 1000000000, not cheap' },
      { line: 5, message: 'Hat: in shops is yes or no, not maybe' },
      { line: 6, message: 'Boots: price is a number from 0 to 1000000000, not 2000000000' },
    ]);
  });

  it('a type with a PRICE column has it there: no own price read, as before', () => {
    const r = read(FILE('[weapons]', 'name, price, in shops', 'Pistol, 180, yes'));
    expect(byId(r, 'pistol')).toMatchObject({ values: expect.objectContaining({ price: 180 }), in_shops: true });
    expect(byId(r, 'pistol')).not.toHaveProperty('price');
  });

  it('a game without types of its own reads neither: in shops said not read', () => {
    const PLAIN = { format: 1, name: 'Plain', stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Str' }] }], items: { list: [{ id: 'rope', label: 'Rope' }] } };
    const r = read(FILE('[gear]', 'name, in shops', 'Rope, no'), PLAIN);
    expect(byId(r, 'rope')).toEqual({ id: 'rope', label: 'Rope' });
    expect(r.notes.map((n) => n.message)).toEqual(["The in shops column isn't one of GEAR's: only name, weight, price, needs, words"]);
  });
});

describe('[features]', () => {
  it('a new feature on an item there or in the file; words, uses and a rest changed; each mistake skipped', () => {
    const r = read(FILE(
      '[gear]', 'name', 'Lantern',
      '[features]', 'item, feature, words, uses, refill',
      'Lantern, Glow, "Lights the way.", 2, Short rest',
      'Boots of Quiet, Quiet Step, "Move without a sound.", -, ',
      'Boots of Quiet, Dash, , , Long rest',
      'Nothing, Glow, , , ',
      'Lantern, Flare, , 1, Midnight',
      'Lantern, Burn, , @nope, ',
      'Ring of Might, Mighty, "Strong.", , ',
    ));
    expect(byId(r, 'lantern').features).toEqual([{ id: 'glow', label: 'Glow', text: 'Lights the way.', uses: { count: '2', refill: 'short_rest' } }]);
    expect(r.added.features).toEqual([{ line: 6, item: 'Lantern', feature: 'Glow' }]);
    expect(byId(r, 'boots').features[0]).toEqual({ id: 'quiet', label: 'Quiet Step', text: 'Move without a sound.' });
    expect(r.changed.features).toEqual([
      { line: 7, item: 'Boots of Quiet', feature: 'Quiet Step', parts: [{ part: 'words', from: 'Hush.', to: 'Move without a sound.' }, { part: 'uses', from: '1', to: '' }] },
      { line: 12, item: 'Ring of Might', feature: 'Mighty', parts: [{ part: 'words', from: '', to: 'Strong.' }] },
    ]);
    expect(r.skipped.map((s) => s.line)).toEqual([8, 9, 10, 11]);
    expect(r.skipped[0].message).toBe('Dash: a refill needs uses');
    expect(r.skipped[1].message).toBe('Nothing: no item of that name here or in the file');
    expect(r.skipped[2].message).toMatch(/^Flare: refill: "Midnight" isn't one of this system's rests/);
    expect(r.skipped[3].message).toBe('Burn: uses: @nope isn\'t one of this system\'s names');
    expect(r.notes).toEqual([{ line: 12, message: 'Ring of Might · Mighty keeps its modifiers, set in the builder' }]);
    sound(r);
    expect(read(FILE('[features]', 'feature', 'Glow')).skipped).toEqual([{ line: 2, message: '[features] needs a item column: its first line names the columns (item, feature, words, uses, refill)' }]);
  });
});

describe('the edges', () => {
  // A type, a column and an install whose names are not their ids.
  const NAMED = {
    ...ARMORY,
    items: {
      ...ARMORY.items,
      installs: [{ id: 'cyberware', label: 'Implants', against: 'strain', limit: '@might' }],
      types: [ARMORY.items.types[0], { ...ARMORY.items.types[1], label: 'ARMS', columns: [{ id: 'damage', label: 'HURT', kind: 'damage' }, ...ARMORY.items.types[1].columns.slice(1)] }],
      list: ['junk', ...ARMORY.items.list, { id: 'hush', label: 'Hush', description: 'Hush now.' }],
    },
  };

  it('a section by its type\'s name, a column by its id, an install by its name; junk in the list dropped', () => {
    const r = read(FILE('[arms]', 'name, damage', 'Club, 1d6', '[gear]', 'name, needs', 'Port, implants'), NAMED);
    expect(byId(r, 'club')).toMatchObject({ type: 'weapons', values: { damage: '1d6' } });
    expect(byId(r, 'port')).toMatchObject({ needs: 'cyberware', cost: 1 });
    expect(r.items.list).not.toContain('junk');
  });

  it('rows under a section that is no type are passed over, never added to the one before', () => {
    const r = read(FILE('[weapons]', 'name', 'Club', '[spells]', 'name', 'Fireball'));
    expect(byId(r, 'club')).toBeTruthy();
    expect(r.items.list.some((i) => i.label === 'Fireball' || i.label === 'name')).toBe(false);
  });

  it('a number is written as one: 0x10 or 1e1 is not; a new item named like a stat takes another id', () => {
    const r = read(FILE('[gear]', 'name, weight, needs, cost', 'Hex, 0x10, worn, ', 'Port, 1, cyberware, 0x5', 'Might, 1, worn, '));
    expect(r.skipped).toEqual([{ line: 3, message: 'Hex: WEIGHT is a number, not 0x10' }, { line: 4, message: 'Port: cost is a number from 0 to 1000, not 0x5' }]);
    expect(byId(r, 'might_2')).toMatchObject({ label: 'Might' });
  });

  it('- on a new item\'s words writes none; words that differ only in spacing change nothing', () => {
    const r = read(FILE('[gear]', 'name, words', 'Lamp, -', 'Hush, Hush   now.'), NAMED);
    expect(byId(r, 'lamp')).not.toHaveProperty('description');
    expect(r).toMatchObject({ changes: 1, same: 1 });
  });

  it('made another type, what the new type hasn\'t is gone; every value cleared, none kept; clearing what isn\'t there changes nothing', () => {
    const geared = read(FILE('[gear]', 'name', 'Pistol'));
    expect(byId(geared, 'pistol')).toEqual({ id: 'pistol', label: 'Pistol', type: 'gear', values: { weight: 2, price: 200 } });
    const cleared = read(FILE('[gear]', 'name, weight, price', 'Pistol Rounds, -, -', 'Boots of Quiet, -, '));
    expect(byId(cleared, 'rounds')).not.toHaveProperty('values');
    expect(cleared).toMatchObject({ changes: 1, same: 1 });
  });

  it('a feature on a name two items have is skipped; nothing left to list, no list', () => {
    const twice = { ...ARMORY, items: { ...ARMORY.items, list: [{ id: 'a', label: 'Twin' }, { id: 'b', label: 'Twin' }] } };
    expect(read(FILE('[features]', 'item, feature', 'Twin, Glow'), twice).skipped).toEqual([{ line: 3, message: 'Twin: there are 2 items called that; rename one in the builder first' }]);
    expect(read(FILE('[gear]', 'name', '-'), { format: 1, name: 'Empty' }).items).toEqual({});
  });
});

describe('what it refuses, and what it leaves alone', () => {
  it('refuses nothing and too much, and changes nothing it was given', () => {
    const before = JSON.parse(JSON.stringify(ARMORY));
    expect(read('   ')).toEqual({ ok: false, error: 'Nothing to read' });
    expect(read(undefined)).toEqual({ ok: false, error: 'Nothing to read' });
    expect(read(`[gear]\nname\n${'a'.repeat(MAX_BYTES)}`)).toEqual({ ok: false, error: 'That is more than 200 KB. Split it into smaller files.' });
    read(FILE('[weapons]', 'name, damage, needs', 'Pistol, -, carried', '[features]', 'item, feature, words', 'Boots of Quiet, Quiet Step, -'));
    expect(ARMORY).toEqual(before);
  });

  it('counts nothing for a file that changes nothing; a new id never takes one an option has', () => {
    expect(read(FILE('# notes', '[gear]', 'name, weight', 'Pistol Rounds, 0.05'))).toMatchObject({ changes: 0, same: 1, skipped: [], notes: [] });
    expect(byId(read(FILE('[gear]', 'name', 'Shotgun')), 'shotgun_2')).toBeTruthy();
  });
});

describe('the route', () => {
  const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  const EDITOR = jwt.sign({ username: 'ghost', isTemporary: true }, 'test-secret');
  const PLAYER = jwt.sign({ username: 'vex', role: 'player' }, 'test-secret');
  let app;
  beforeEach(async () => {
    elevatedUsers.add('ghost');
    const db = await makeTestDb();
    app = express();
    app.use(express.json());
    app.use('/api/systems', systemsRoute(db));
  });
  afterEach(() => elevatedUsers.delete('ghost'));
  const post = (body, token = GM) => request(app).post('/api/systems/import-items').set({ Authorization: `Bearer ${token}` }).send(body);

  it('reads the draft as sent', async () => {
    const res = await post({ definition: ARMORY, text: '[gear]\nname\nRope' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ changes: 1, added: { items: [{ line: 3, item: 'Rope', type: 'Gear' }] } });
    expect(res.body.ok).toBeUndefined();
    expect(res.body.items.list.map((i) => i.id)).toEqual(['pistol', 'rounds', 'boots', 'ring', 'rope']);
  });

  it('refuses what can\'t be read, and is the main admin\'s alone', async () => {
    expect(await post({ definition: ARMORY, text: ' ' })).toMatchObject({ status: 400, body: { error: 'Nothing to read' } });
    expect(await post({ definition: 'nope', text: 'x' })).toMatchObject({ status: 400, body: { error: 'A system definition must be an object' } });
    expect((await post({ definition: ARMORY, text: 'x' }, EDITOR)).status).toBe(403);
    expect((await post({ definition: ARMORY, text: 'x' }, PLAYER)).status).toBe(403);
    expect((await request(app).post('/api/systems/import-items').send({ definition: ARMORY })).status).toBe(401);
  });
});
