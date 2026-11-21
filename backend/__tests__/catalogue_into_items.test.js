/**
 * A shop catalogue's new lines made items of the system (8a7a4a; decided 2026-11-21, mockup docs/mockups/types-in-shops.html,
 * questions 10 to 13): ADD NEW LINES TO ITEMS, off to start, adds each line that isn't an item already to the builder's draft
 * (of its section's type, a shelf's of the DEFAULT type), its columns, price, IN SHOPS and words; past 200 items, said. The
 * preview says what it would add; the save adds it to the draft only, the running game untouched until a publish.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { untilValue, drain } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { itemsFromLines } = require_('../systemBuilder/itemsFromCatalogue');
const { parseCatalogue } = require_('../shops/catalogueParse');
const { typesOf } = require_('../systemBuilder/itemTypes');
const { checkDefinition } = require_('../systemBuilder/definition');
const store = require_('../shops/catalogueStore');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = (await import('../sockets/index.js')).default;

const WEAPONS = { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'ammo', label: 'AMMO', kind: 'count' }, { id: 'price', label: 'PRICE', kind: 'number' }] };
const GEAR = { id: 'gear', label: 'GEAR', one: 'Gear', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number' }] };
const DEF = {
  format: 1, name: 'Intofall', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  items: { types: [GEAR, WEAPONS], list: [{ id: 'pistol', label: 'Pistol', type: 'weapons', values: { damage: '2d6', price: 200 } }] },
};
const parse = (text, def = DEF) => parseCatalogue(text, { types: typesOf(def), names: { known: () => true, refused: (n) => n } }).sections;
const FILE = '[WEAPONS]\nname, price, damage, ammo, description\nPistol, 260, 2d6, 6\nHand Cannon, 900, 3d6, 5, "Loud, very."\n[weapon_mods]\nname, price\nScope, 2\n';

describe('the lines made items', () => {
  it('each new line an item of its type, a shelf\'s of the DEFAULT type; one already an item not added', () => {
    const out = itemsFromLines(DEF, parse(FILE));
    expect(out.items).toEqual([
      { id: 'hand_cannon', label: 'Hand Cannon', type: 'weapons', values: { damage: '3d6', ammo: 5, price: 900 }, in_shops: true, description: 'Loud, very.' },
      { id: 'scope', label: 'Scope', type: 'gear', price: 2, in_shops: true },
    ]);
    expect(out.added).toEqual([
      { line: 4, catalogue: 'type:weapons', name: 'Hand Cannon', type: 'WEAPONS' },
      { line: 7, catalogue: 'weapon_mods', name: 'Scope', type: 'GEAR' },
    ]);
    expect(out.skipped).toEqual([]);
    // Sound as items, as the builder checks them.
    expect(checkDefinition({ ...DEF, items: { ...DEF.items, list: [...DEF.items.list, ...out.items] } }).problems).toEqual([]);
  });

  it('an id apart from what the system already names; a name too long, and past 200 items, said and not added', () => {
    const named = { ...DEF, items: { ...DEF.items, list: [...DEF.items.list, { id: 'hand_cannon', label: 'Old Cannon', type: 'weapons' }] } };
    expect(itemsFromLines(named, parse(FILE)).items[0].id).toBe('hand_cannon_2');
    const long = itemsFromLines(DEF, parse(`[gear]\nname, price\n${'X'.repeat(41)}, 1\n`));
    expect(long.skipped).toEqual([{ line: 3, catalogue: 'type:gear', name: 'X'.repeat(41), message: 'an item\'s name is 40 characters at most: not added' }]);
    const full = { ...DEF, items: { ...DEF.items, list: Array.from({ length: 199 }, (_, i) => ({ id: `i${i}`, label: `I${i}` })) } };
    const one = itemsFromLines(full, parse(FILE));
    expect(one.items.map((i) => i.label)).toEqual(['Pistol']);
    expect(one.skipped.map((s) => s.name)).toEqual(['Hand Cannon', 'Scope']);
    expect(one.skipped[0].message).toBe('ITEMS holds 200, the most a system can: not added');
  });

  it('a name in the file twice made one item, from its first line', () => {
    const twice = itemsFromLines(DEF, parse('[WEAPONS]\nname, price, damage\nScope, 30, 1d4\n[weapon_mods]\nname, price\nScope, 2\n'));
    expect(twice.items).toEqual([{ id: 'scope', label: 'Scope', type: 'weapons', values: { damage: '1d4', price: 30 }, in_shops: true }]);
  });

  it('a value that doesn\'t fit its column left out; a game without types of its own: nothing', () => {
    const odd = itemsFromLines(DEF, { 'type:weapons': [{ name: 'Odd', price: 5, fields: { damage: 'lots', ammo: 3 }, line: 2 }] });
    expect(odd.items[0].values).toEqual({ ammo: 3, price: 5 });
    expect(itemsFromLines({ ...DEF, items: { list: [] } }, parse('[gear]\nname, price\nRope, 2\n', { ...DEF, items: { list: [] } }))).toEqual({ items: [], added: [], skipped: [] });
  });
});

describe('at the table', () => {
  const ID = 'sys_a74a0000a74a0000';
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
  const copies = async () => { const row = await get(db, 'SELECT draft, published FROM custom_systems WHERE id = ?', [ID]); return { draft: JSON.parse(row.draft), published: JSON.parse(row.published) }; };

  beforeEach(async () => {
    store.clear();
    db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS shop_catalogues (system TEXT NOT NULL, catalogue TEXT NOT NULL, id TEXT NOT NULL,
      name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, fields TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (system, catalogue, id))`);
    const def = JSON.stringify(DEF);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Intofall', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, "INSERT INTO global_settings (key, value) VALUES ('game_system', ?)", [ID]);
  });

  it('the preview says what ADD NEW LINES TO ITEMS would add, with each price, and how many the draft holds', async () => {
    const gm = await boot('gm', true);
    gm.handlers.previewCatalogue({ text: FILE });
    expect((await last(gm.emitted, 'cataloguePreview')).data.toItems).toEqual({
      added: [{ line: 4, catalogue: 'type:weapons', name: 'Hand Cannon', type: 'WEAPONS', price: 900 }, { line: 7, catalogue: 'weapon_mods', name: 'Scope', type: 'GEAR', price: 2 }],
      skipped: [], have: 1, most: 200,
    });
  });

  it('saved with it off: the draft as it was; on: the new lines items in the draft only, said back with them', async () => {
    const gm = await boot('gm', true);
    gm.handlers.saveCatalogue({ text: FILE });
    expect((await last(gm.emitted, 'catalogueSaved')).data).not.toHaveProperty('toItems');
    expect((await copies()).draft.items.list.map((i) => i.label)).toEqual(['Pistol']);
    gm.emitted.length = 0;
    gm.handlers.saveCatalogue({ text: FILE, toItems: true });
    const saved = (await last(gm.emitted, 'catalogueSaved')).data;
    expect(saved.toItems).toMatchObject({ ok: true, added: [{ name: 'Hand Cannon' }, { name: 'Scope' }], skipped: [] });
    expect(saved.toItems.items.map((i) => i.id)).toEqual(['hand_cannon', 'scope']);
    const { draft, published } = await copies();
    expect(draft.items.list.map((i) => i.label)).toEqual(['Pistol', 'Hand Cannon', 'Scope']);
    // The running game untouched until a publish.
    expect(published.items.list.map((i) => i.label)).toEqual(['Pistol']);
    // Saved again: already items, nothing added twice.
    gm.emitted.length = 0;
    gm.handlers.saveCatalogue({ text: FILE, toItems: true });
    expect((await last(gm.emitted, 'catalogueSaved')).data.toItems).toMatchObject({ ok: true, added: [], items: [] });
    expect((await copies()).draft.items.list).toHaveLength(3);
  });
});
