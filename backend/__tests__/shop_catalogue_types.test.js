/**
 * A catalogue section per item type (8a7a1; decided 2026-11-20, mockup docs/mockups/item-types-in-shops.html): a section named
 * as one of the system's own types ([GUNS], [gun], [MELEE WEAPONS]) is lines of that type, each of its columns read and
 * checked as the builder checks an item's, a blank kept and noted; a section that is neither a type nor a shelf is said, its
 * rows not saved; a shelf section reads as always. Then through the real sockets: the preview by the type's name, saved under
 * the type, sent to players.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { untilValue, drain } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { parseCatalogue } = require_('../shops/catalogueParse');
const store = require_('../shops/catalogueStore');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = (await import('../sockets/index.js')).default;

const GUNS = {
  id: 'guns', label: 'GUNS', one: 'Gun', columns: [
    { id: 'damage', label: 'DAMAGE', kind: 'damage' },
    { id: 'range', label: 'RANGE', kind: 'text' },
    { id: 'ammo', label: 'AMMO', kind: 'count' },
    { id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' },
    { id: 'grade', label: 'GRADE', kind: 'pick', options: ['LIGHT', 'HEAVY'] },
  ],
};
const MELEE = { id: 'melee', label: 'MELEE WEAPONS', one: 'Blade', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }] };
const WEAPONS = { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }] };
const NAMES = { known: (n) => n === 'might', refused: (n) => `@${n} isn't one of this system's names` };
const SHELVES = ['weapons', 'gear', 'armor'];
const read = (text, more = {}) => parseCatalogue(text, { types: [GUNS, MELEE], names: NAMES, shelves: SHELVES, ...more });

describe('a section per item type', () => {
  it('by its name, what one is called, or its id, any case: lines of that type, each column read as it holds', () => {
    for (const head of ['[GUNS]', '[gun]', '[guns]', '[ Gun ]']) {
      const out = read(`${head}\nname, price, damage, range, ammo, weight, grade, description\nPistol, 250, 2d6, 30 m, 6, 2, light, A snub revolver.\n`);
      expect(out.problems, head).toEqual([]);
      expect(out.sections['type:guns'], head).toEqual([{
        id: 'pistol', name: 'Pistol', price: 250, type: 'guns', line: 3,
        // Numbers as numbers, PICK ONE as the column's own word, the rest riding along as words.
        fields: { damage: '2d6', range: '30 m', ammo: 6, weight: 2, grade: 'LIGHT', description: 'A snub revolver.' },
      }]);
    }
  });

  it('a type with spaces in its name; columns by their names too, in any order', () => {
    const out = read('[MELEE WEAPONS]\nDamage, Price, Name\n1d8 + @might, 15, Cutlass\n');
    expect(out.problems).toEqual([]);
    expect(out.sections['type:melee']).toEqual([expect.objectContaining({ name: 'Cutlass', price: 15, fields: { damage: '1d8 + @might' } })]);
  });

  it('a value that does not fit its column: that row left out, said with the builder\'s words, the others kept', () => {
    const out = read([
      '[GUNS]', 'name, price, damage, ammo, grade, weight',
      'Hand Cannon, 1200, 3d6, six, HEAVY, 4', 'Ray Gun, 90, 1d6 + @luck, 3, LIGHT, 1', 'Pea Shooter, 5, 1d2, 1, PINK, 1',
      'Lead Pipe Gun, 9, 1d4, 2, LIGHT, heavy', 'Pistol, 250, 2d6, 6, LIGHT, 2',
    ].join('\n'));
    expect(out.sections['type:guns'].map((r) => r.name)).toEqual(['Pistol']);
    expect(out.problems.map((p) => [p.line, p.name, p.message])).toEqual([
      [3, 'Hand Cannon', 'AMMO "six": How many it holds: 0 to 1000'],
      [4, 'Ray Gun', 'DAMAGE "1d6 + @luck": @luck isn\'t one of this system\'s names'],
      [5, 'Pea Shooter', 'GRADE "PINK": One of LIGHT, HEAVY'],
      [6, 'Lead Pipe Gun', 'WEIGHT "heavy": A number'],
    ]);
  });

  it('a blank kept blank: the line saved, one note naming every column left blank, nothing wrong', () => {
    const out = read('[GUNS]\nname, price, damage, range, ammo, weight, grade\nBlank Gun, 10, 1d4, , , , \nFull Gun, 20, 1d6, 10 m, 6, 2, LIGHT\n');
    expect(out.problems).toEqual([]);
    expect(out.sections['type:guns'].map((r) => [r.name, r.fields])).toEqual([['Blank Gun', { damage: '1d4' }], ['Full Gun', { damage: '1d6', range: '10 m', ammo: 6, weight: 2, grade: 'LIGHT' }]]);
    expect(out.notes).toEqual([{ line: 3, catalogue: 'type:guns', name: 'Blank Gun', message: 'RANGE, AMMO, WEIGHT, GRADE left blank' }]);
  });

  it('a type named like a shelf is the type: the GM\'s own WEAPONS are always reachable', () => {
    const out = parseCatalogue('[weapons]\nname, price, damage\nSabre, 30, 1d8\n', { types: [WEAPONS], names: NAMES, shelves: SHELVES });
    expect(Object.keys(out.sections)).toEqual(['type:weapons']);
    // Without types of its own, [weapons] is the shelf, as ever.
    expect(Object.keys(parseCatalogue('[weapons]\nname, price, dmg\nSabre, 30, 1d8\n', { shelves: SHELVES }).sections)).toEqual(['weapons']);
  });

  it('a column by its name where its id is another: DAMAGE for dmg', () => {
    const SWORDS = { id: 'swords', label: 'SWORDS', one: 'Sword', columns: [{ id: 'dmg', label: 'DAMAGE', kind: 'damage' }] };
    const out = parseCatalogue('[SWORDS]\nname, price, Damage\nSabre, 30, 1d8\n', { types: [SWORDS], names: NAMES });
    expect(out.sections['type:swords'][0].fields).toEqual({ dmg: '1d8' });
  });

  it('JSON as one list, each row naming its section: its catalogue never a column of the line', () => {
    const out = read(JSON.stringify([{ catalogue: 'GUNS', name: 'Pistol', price: 250, damage: '2d6' }, { catalogue: 'gear', name: 'Rope', price: 5 }]));
    expect(out.sections['type:guns'][0].fields).toEqual({ damage: '2d6' });
    expect(out.sections.gear[0].fields).toEqual({});
  });

  it('JSON keyed by a type\'s name reads the same', () => {
    const out = read(JSON.stringify({ GUNS: [{ name: 'Pistol', price: 250, damage: '2d6', ammo: 6 }] }));
    expect(out.sections['type:guns']).toEqual([expect.objectContaining({ name: 'Pistol', type: 'guns', fields: { damage: '2d6', ammo: 6 } })]);
  });
});

describe('a section that is neither', () => {
  it('said, with the types there are; its rows not read; the rest of the file kept', () => {
    const out = read('[ROCKS]\nname, price\nPebble, 1\n\n[gear]\nname, price, description\nRope, 5, Long\n');
    expect(Object.keys(out.sections)).toEqual(['gear']);
    expect(out.problems).toEqual([{ line: 1, catalogue: 'rocks', message: 'no item type or shelf is called ROCKS (types: GUNS, MELEE WEAPONS)' }]);
  });

  it('a game without types: "no shelf"; read without knowing the shelves, kept as it always was', () => {
    expect(parseCatalogue('[rocks]\nname, price\nPebble, 1\n', { shelves: SHELVES }).problems[0].message).toBe('no shelf is called ROCKS');
    expect(Object.keys(parseCatalogue('[rocks]\nname, price\nPebble, 1\n').sections)).toEqual(['rocks']);
  });

  it('in JSON too', () => {
    const out = read(JSON.stringify({ rocks: [{ name: 'Pebble', price: 1 }] }));
    expect(out.sections).toEqual({});
    expect(out.problems[0].message).toBe('no item type or shelf is called ROCKS (types: GUNS, MELEE WEAPONS)');
  });
});

describe('through the sockets', () => {
  const ID = 'sys_typestypestypest';
  const SYSTEM = {
    format: 1, name: 'Typed', core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
    items: { types: [GUNS], list: [] },
  };
  let db;
  const boot = async (who, admin) => {
    const emitted = [];
    let connect;
    const io = { on: (e, cb) => { if (e === 'connection') connect = cb; }, emit: (event, data) => emitted.push({ event, data }), to: () => ({ emit: () => {} }) };
    socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    connect({ id: `s-${who}-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, data) => emitted.push({ event, data }), broadcast: { emit: () => {} }, use: () => {}, join: () => {} });
    handlers.identify(admin ? { userName: who, isAdmin: true, token: jwt.sign({ id: 1, username: who, role: 'admin', isTemporary: false }, 'test-secret') } : who);
    await drain(db);
    return { handlers, emitted };
  };
  const last = (emitted, event) => untilValue(() => [...emitted].reverse().find((e) => e.event === event), Boolean, { label: event });

  beforeEach(async () => {
    store.clear();
    db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS shop_catalogues (system TEXT NOT NULL, catalogue TEXT NOT NULL, id TEXT NOT NULL,
      name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, fields TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (system, catalogue, id))`);
    const def = JSON.stringify(SYSTEM);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Typed', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, "INSERT INTO global_settings (key, value) VALUES ('game_system', ?)", [ID]);
  });

  const FILE = '[GUNS]\nname, price, damage, range, ammo, weight, grade\nPistol, 250, 2d6 + @might, 30 m, 6, 2, LIGHT\nBlank Gun, 10, 1d4, , , ,\nBad Gun, 1, 1d4 + @luck, , , ,\n[ROCKS]\nname, price\nPebble, 1\n';

  it('the preview: the type by its name, the bad row and the unknown section said, the blanks noted', async () => {
    const gm = await boot('gm', true);
    gm.handlers.previewCatalogue({ text: FILE });
    const out = (await last(gm.emitted, 'cataloguePreview')).data;
    expect(out.summary).toEqual([{ catalogue: 'type:guns', count: 2, overrides: [], label: 'GUNS' }]);
    expect(out.problems.map((p) => p.message)).toEqual([
      'DAMAGE "1d4 + @luck": @luck isn\'t one of this system\'s names', 'no item type or shelf is called ROCKS (types: GUNS)',
    ]);
    expect(out.notes).toEqual([{ line: 4, catalogue: 'type:guns', name: 'Blank Gun', message: 'RANGE, AMMO, WEIGHT, GRADE left blank' }]);
  });

  it('saved under the type, said by its name; sent to a player with its columns; nothing saved of the unknown section', async () => {
    const gm = await boot('gm', true);
    gm.handlers.saveCatalogue({ text: FILE });
    const saved = (await last(gm.emitted, 'catalogueSaved')).data;
    expect(saved).toMatchObject({ ok: true, saved: [{ catalogue: 'type:guns', count: 2, label: 'GUNS' }] });
    const rows = await new Promise((ok) => db.all('SELECT catalogue, name, fields FROM shop_catalogues ORDER BY name', (e, r) => ok(r)));
    expect(rows.map((r) => [r.catalogue, r.name, JSON.parse(r.fields)])).toEqual([
      ['type:guns', 'Blank Gun', { damage: '1d4' }],
      ['type:guns', 'Pistol', { damage: '2d6 + @might', range: '30 m', ammo: 6, weight: 2, grade: 'LIGHT' }],
    ]);
    const kes = await boot('kes', false);
    const sent = (await last(kes.emitted, 'catalogues')).data.entries;
    expect(sent['type:guns'].map((e) => [e.name, e.price, e.fields.ammo]).sort()).toEqual([['Blank Gun', 10, undefined], ['Pistol', 250, 6]]);
    expect(await get(db, "SELECT COUNT(*) n FROM shop_catalogues WHERE catalogue = 'rocks'")).toEqual({ n: 0 });
  });
});
