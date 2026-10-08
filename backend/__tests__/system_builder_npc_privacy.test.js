import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { untilValue, drain } from './helpers/until.js';

/**
 * A custom system's privacy and its NPCs, as data.
 *
 * A field can be the GM's to set (XP, awarded items): the owner sees it and cannot change it,
 * by a single edit, a batch edit or an upload, while the GM still can. NPCs get a layout of
 * their own and power tiers that GENERATE_SHEET uses. The built-in systems are untouched.
 */

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';
const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const runtime = require_('../systemBuilder/runtime');
const templates = require_('../sheets/templates');
const npcTiers = require_('../sheets/npcTiers');
const socketsFactory = require_('../sockets/index.js');

const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const gm = { Authorization: `Bearer ${GM}` };

const SHEET = {
  tabs: ['KNIGHT'],
  header: { nameField: 'name', hpField: 'wounds', hpMaxField: 'wounds_max' },
  sections: [
    { id: 'who', label: 'WHO', layout: 'list', tab: 'KNIGHT', fields: [
      { id: 'name', label: 'Name', type: 'text', visibility: 'public' },
      { id: 'renown', label: 'Renown', type: 'number', edit: 'gm' },
      { id: 'boon', label: 'Boon', type: 'text', edit: 'gm' },
      { id: 'order', label: 'Order', type: 'select', edit: 'player', options: [{ value: 'dawn', label: 'Dawn' }, { value: 'dusk', label: 'Dusk' }] },
    ] },
    { id: 'stats', label: 'STATS', layout: 'grid', tab: 'KNIGHT', fields: [
      { id: 'might', label: 'MIGHT', type: 'number' },
      { id: 'might_mod', label: 'MOD', type: 'number' },
      { id: 'wounds', label: 'WOUNDS', type: 'number', source: 'token_hp', maxField: 'wounds_max' },
      { id: 'wounds_max', label: 'MAX', type: 'number', source: 'token_hp_max' },
    ] },
  ],
};

const NPC_SHEET = {
  header: { nameField: 'name', hpField: 'wounds' },
  sections: [
    { id: 'block', label: 'STAT BLOCK', layout: 'grid', fields: [
      { id: 'name', label: 'Name', type: 'text' },
      { id: 'might', label: 'MIGHT', type: 'number' },
      { id: 'might_mod', label: 'MOD', type: 'number' },
      { id: 'threat', label: 'THREAT', type: 'number', sensitivity: 'combat' },
      { id: 'wounds', label: 'WOUNDS', type: 'number', source: 'token_hp' },
      // Only NPCs show their armor, and it still lives on the token.
      { id: 'ward', label: 'WARD', type: 'number', source: 'token_ac' },
      // Public on the NPC layout, which says nothing: NPC sheets are never shown to players.
      { id: 'tactics', label: 'Tactics', type: 'text', visibility: 'public' },
    ] },
  ],
};

const VAULT = {
  format: 1,
  name: 'Vault Knights',
  lookups: { mod: { bands: [{ upTo: 9, value: -1 }, { upTo: 13, value: 0 }, { value: 1 }] } },
  derived: [{ id: 'might_mod', formula: 'mod(@might)' }],
  sheet: SHEET,
  npc: {
    sheet: NPC_SHEET,
    tiers: [
      { id: 'squire', label: 'SQUIRE', hp: 6, defense: 11, values: { might: 9, threat: 1, tactics: 'Runs' } },
      { id: 'champion', label: 'CHAMPION', hp: 30, defense: 17, values: { might: 16, threat: 4 } },
      { id: 'ghost', label: 'GHOST', values: { tactics: 'Haunts' } },
      { id: 'knight', label: 'KNIGHT', hp: '10 + @level * 2', defense: '12 + floor(@level / 2)', values: { might: '8 + @level', threat: '2d6' } },
    ],
  },
};

const problems = (definition) => checkDefinition(definition).problems.map((p) => `${p.where}: ${p.message}`);

describe('the format', () => {
  it('accepts a system with GM-only fields, an NPC layout and tiers', () => {
    expect(problems(VAULT)).toEqual([]);
  });

  it('knows who may edit a field, and that nobody edits a derived value', () => {
    const sheet = JSON.parse(JSON.stringify(SHEET));
    sheet.sections[0].fields[1].edit = 'owner';
    sheet.sections[1].fields[1].edit = 'gm';
    expect(problems({ ...VAULT, sheet })).toEqual([
      'sheet field renown, edit: player or gm',
      'sheet field might_mod, edit: A derived value is worked out, so nobody edits it',
    ]);
  });

  it('checks the NPC layout as a sheet, and holds it to linking fields as the character sheet does', () => {
    const npcSheet = JSON.parse(JSON.stringify(NPC_SHEET));
    npcSheet.sections[0].layout = 'cards';
    npcSheet.sections[0].fields.push({ id: 'might', label: 'Again', type: 'number' });
    npcSheet.sections[0].fields[1].source = 'bank_balance';
    expect(problems({ ...VAULT, npc: { sheet: npcSheet } })).toEqual([
      'npc sheet section block, layout: One of list, grid, notes, inventory',
      'npc sheet field might: Defined twice',
      'npc sheet field might: Linked differently on the character sheet',
    ]);
  });

  it('reports every mistake in the tiers, with where it is', () => {
    expect(problems({ ...VAULT, npc: { sheet: NPC_SHEET, extra: 1, tiers: [
      { id: 'Squire', label: '', hp: -1, defense: 100, colour: 'red' },
      { id: 'b', label: 'B', values: { might_mod: 3, wounds: 5, nope: 1, might: ['lots'], tactics: 7 } },
      { id: 'b', label: 'B' },
      'x',
    ] } })).toEqual([
      'npc extra: Not part of the NPC settings',
      'npc tier Squire, colour: Not part of a tier',
      'npc tier Squire: Ids use lowercase letters, digits and _, starting with a letter',
      'npc tier Squire, label: Required',
      'npc tier Squire, hp: A whole number from 0 to 9999, a formula or dice',
      'npc tier Squire, defense: A whole number from 0 to 99, a formula or dice',
      'npc tier b, might_mod: A derived value is worked out, not set',
      'npc tier b, wounds: Lives on the token or in the bank; use the tier\'s hp and defense',
      'npc tier b, nope: Not a field on the NPC sheet',
      'npc tier b, might: A number, a formula or dice',
      'npc tier b, tactics: Must be text',
      'npc tier b: Defined twice',
      'npc tier 4: Must be a tier',
    ]);
  });

  it('takes formulas and dice for HP, defense and numbers, worked out for the level (4b4a1)', () => {
    expect(problems({ ...VAULT, npc: { sheet: NPC_SHEET, tiers: [
      { id: 'boss', label: 'BOSS', hp: '@level d10 + 10', defense: '14 + floor(@level / 2)', values: { might: '3d6 + @level' } },
    ] } })).toEqual([]);
    expect(problems({ ...VAULT, npc: { sheet: NPC_SHEET, tiers: [
      { id: 'boss', label: 'BOSS', hp: '@might d10', defense: '3d1', values: { might: '3d6 +', tactics: '3d6' } },
      { id: 'long', label: 'LONG', hp: '1+'.repeat(200) + '1' },
    ] } })).toEqual([
      'npc tier boss, hp: Only @level can be used here, not @might',
      'npc tier boss, defense: A die has 2 to 1000 sides',
      expect.stringMatching(/^npc tier boss, might: /),
      'npc tier long, hp: Longer than 300 characters',
    ]);
  });

  it('checks tier values against the character sheet when NPCs have no layout of their own', () => {
    expect(problems({ ...VAULT, npc: { tiers: [{ id: 'a', label: 'A', values: { order: 'noon', tactics: 'x' } }] } })).toEqual([
      'npc tier a, order: Not one of the field\'s options',
      'npc tier a, tactics: Not a field on the NPC sheet',
    ]);
  });

  it('refuses npc settings that are not settings', () => {
    expect(problems({ ...VAULT, npc: [] })).toEqual(['npc: Must be a set of NPC settings']);
    expect(problems({ ...VAULT, npc: { tiers: 'many' } })).toEqual(['npc tiers: Must be a list of tiers']);
  });
});

describe('a published system with them', () => {
  let db;
  let app;
  let id;
  let elevatedUsers;
  const emitted = [];

  beforeEach(async () => {
    db = await makeTestDb();
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cities_without_number')`);
    emitted.length = 0;
    const io = { emit: (event, data) => emitted.push({ event, data }), to: () => ({ emit: () => {} }) };
    app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api/systems', require_('../routes/systems.js')(db));
    app.use('/api/sheets', require_('../routes/sheets.js')(db, io));
    id = (await request(app).post('/api/systems').set(gm).send({ definition: VAULT })).body.id;
    await new Promise((resolve) => runtime.load(db, resolve));
    await request(app).post(`/api/systems/${id}/publish`).set(gm);
    elevatedUsers = new Set();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  /** A connected socket for `userName`, the GM when `admin`. */
  const connectAs = async (userName, { admin = false } = {}) => {
    let connect;
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connect = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) },
      db, { elevatedUsers, emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    const sent = [];
    connect({ id: `np-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: (e, d) => sent.push({ e, d }),
      broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify(admin ? { userName, isAdmin: true, token: GM } : userName);
    await drain(db);
    return { handlers, sent };
  };

  const sheetOf = async (username) => JSON.parse((await get(db,
    'SELECT data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0', [username, id])).data);

  const playing = async (username, data) => {
    await request(app).put('/api/sheets/system').set(gm).send({ system: id });
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)', [username, id, JSON.stringify(data)]);
  };

  describe('GM-only fields', () => {
    it('are listed for the server, and every built-in sheet has none', () => {
      expect(templates.metaFor(id).gmFields).toEqual(['renown', 'boon']);
      expect(templates.playerMayEdit(id, 'renown')).toBe(false);
      expect(templates.playerMayEdit(id, 'might')).toBe(true);
      for (const system of ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic']) {
        expect(templates.metaFor(system).gmFields, system).toBeUndefined();
        expect(templates.playerMayEdit(system, 'xp'), system).toBe(true);
      }
    });

    it("cannot be changed by the character's owner, who can still change everything else", async () => {
      await playing('GHOST', { renown: 2, might: 10 });
      const { handlers } = await connectAs('GHOST');
      handlers.updateSheetField({ fieldId: 'renown', value: 99 });
      handlers.updateSheetField({ fieldId: 'might', value: 14 });
      const saved = await untilValue(() => sheetOf('GHOST'), (d) => d.might === 14, { label: 'the edit' });
      await drain(db);
      expect(await sheetOf('GHOST')).toMatchObject({ renown: 2, might: 14, might_mod: 1 });
      expect(saved.renown).toBe(2);
    });

    it('are left out of an upload or a batch edit, and the rest goes in', async () => {
      await playing('GHOST', { renown: 2, boon: 'Blessed blade' });
      const { handlers } = await connectAs('GHOST');
      handlers.importSheetFields({ fields: { renown: 50, boon: 'Crown', name: 'Sir Ash', might: 16 } });
      const saved = await untilValue(() => sheetOf('GHOST'), (d) => d.name === 'Sir Ash', { label: 'the import' });
      expect(saved).toMatchObject({ renown: 2, boon: 'Blessed blade', name: 'Sir Ash', might: 16, might_mod: 1 });
    });

    it('are the GM\'s to change, on their own sheet or by a grant', async () => {
      await playing('gm', { renown: 1 });
      const { handlers } = await connectAs('gm', { admin: true });
      handlers.updateSheetField({ fieldId: 'renown', value: 5 });
      expect((await untilValue(() => sheetOf('gm'), (d) => d.renown === 5, { label: 'the GM edit' })).renown).toBe(5);

      await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)', ['ROOK', id, '{"renown":1}']);
      elevatedUsers.add('ROOK');
      const granted = await connectAs('ROOK');
      granted.handlers.importSheetFields({ fields: { renown: 3 } });
      expect((await untilValue(() => sheetOf('ROOK'), (d) => d.renown === 3, { label: 'the granted edit' })).renown).toBe(3);
    });

    it("are the GM's to change from the GM's sheet window", async () => {
      await playing('GHOST', { renown: 2 });
      const res = await request(app).put('/api/sheets/user/GHOST').set(gm).send({ fields: { renown: 7 } });
      expect(res.status).toBe(200);
      expect((await sheetOf('GHOST')).renown).toBe(7);
    });
  });

  describe('NPCs', () => {
    it('reach the browser with their layout and tier names', async () => {
      const res = await request(app).get(`/api/systems/render/${id}`);
      expect(res.body.npc).toEqual({
        sheet: NPC_SHEET,
        tiers: [{ id: 'squire', label: 'SQUIRE' }, { id: 'champion', label: 'CHAMPION' }, { id: 'ghost', label: 'GHOST' }, { id: 'knight', label: 'KNIGHT' }],
      });
    });

    it("fold the NPC layout's links into the system's rules", () => {
      expect(templates.getLinkedFields(id)).toEqual({ wounds: 'token_hp', wounds_max: 'token_hp_max', ward: 'token_ac' });
      expect(templates.metaFor(id).combatFields).toEqual(['threat']);
      // Never shown to players: only the character sheet says what is public.
      expect(templates.filterPublicData(id, { name: 'Sir Ash', tactics: 'Runs', threat: 3 })).toEqual({ name: 'Sir Ash' });
    });

    it('offer their tiers to GENERATE_SHEET, built with derived values worked out', () => {
      expect(npcTiers.getTierOptions(id).map((t) => t.id)).toEqual(['squire', 'champion', 'ghost', 'knight']);
      expect(npcTiers.buildTier(id, 'champion')).toEqual({
        tierId: 'champion', data: { might: 16, threat: 4, might_mod: 1 }, hp: 30, dv: { melee: 17, ranged: 17 },
      });
      // An unknown tier is the first, as with the built-in ones.
      expect(npcTiers.buildTier(id, 'dragon').tierId).toBe('squire');
    });

    it('work a tier\'s formulas out for the level asked, and roll its dice (4b4a1)', () => {
      const knight = npcTiers.buildTier(id, 'knight', 4);
      expect(knight).toMatchObject({ tierId: 'knight', hp: 18, dv: { melee: 14, ranged: 14 }, data: { might: 12, might_mod: 0 } });
      expect(knight.data.threat).toBeGreaterThanOrEqual(2);
      expect(knight.data.threat).toBeLessThanOrEqual(12);
      // No level asked for (an older browser): level 1.
      expect(npcTiers.buildTier(id, 'knight')).toMatchObject({ hp: 12, dv: { melee: 12 }, data: { might: 9, might_mod: -1 } });
    });

    it('leave the built-in tiers as they were', () => {
      expect(npcTiers.getTierOptions('cyberpunk_red').map((t) => t.id)).toEqual(['mook', 'skilled', 'pro', 'elite']);
      expect(npcTiers.buildTier('cities_without_number', 'elite')).toMatchObject({ tierId: 'elite', hp: 50, dv: { melee: 18, ranged: 18 } });
      expect(npcTiers.buildTier('generic', 'mook')).toBeNull();
    });

    it("generate a sheet and set the token's HP and defense from a tier", async () => {
      await request(app).put('/api/sheets/system').set(gm).send({ system: id });
      await run(db, `INSERT INTO locations (id, name, x, y, z, shape, hp_current, hp_max, melee_ac, ranged_ac) VALUES (40, 'Bandit', 0, 0, 0, 'enemy_rhombus', 3, 3, 8, 8)`);
      const { handlers, sent } = await connectAs('gm', { admin: true });
      handlers.generateNpcSheet({ location_id: 40, tier: 'champion' });
      const made = await untilValue(() => sent.find((s) => s.e === 'npcSheetGenerated'), Boolean, { label: 'the NPC sheet' });
      expect(made.d).toMatchObject({ tier: 'champion', system: id });
      const sheet = await get(db, 'SELECT data FROM character_sheets WHERE id = ?', [made.d.sheet_id]);
      expect(JSON.parse(sheet.data)).toMatchObject({ name: 'Bandit', might: 16, might_mod: 1, threat: 4 });
      expect(await get(db, 'SELECT hp_current, hp_max, melee_ac, ranged_ac FROM locations WHERE id = 40'))
        .toEqual({ hp_current: 30, hp_max: 30, melee_ac: 17, ranged_ac: 17 });
    });

    it('generate a tier at the level the GM chose (4b4a2)', async () => {
      await request(app).put('/api/sheets/system').set(gm).send({ system: id });
      await run(db, `INSERT INTO locations (id, name, x, y, z, shape, hp_current, hp_max, melee_ac, ranged_ac) VALUES (42, 'Sir Rook', 0, 0, 0, 'enemy_rhombus', 3, 3, 8, 8)`);
      const { handlers, sent } = await connectAs('gm', { admin: true });
      handlers.generateNpcSheet({ location_id: 42, tier: 'knight', level: 4 });
      const made = await untilValue(() => sent.find((s) => s.e === 'npcSheetGenerated'), Boolean, { label: 'the NPC sheet' });
      const sheet = JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE id = ?', [made.d.sheet_id])).data);
      expect(sheet).toMatchObject({ name: 'Sir Rook', might: 12, might_mod: 0 });
      expect(await get(db, 'SELECT hp_current, hp_max, melee_ac, ranged_ac FROM locations WHERE id = 42'))
        .toEqual({ hp_current: 18, hp_max: 18, melee_ac: 14, ranged_ac: 14 });
    });

    it("keep the token's own HP and defense when a tier leaves them out", async () => {
      await request(app).put('/api/sheets/system').set(gm).send({ system: id });
      await run(db, `INSERT INTO locations (id, name, x, y, z, shape, hp_current, hp_max, melee_ac, ranged_ac) VALUES (41, 'Wisp', 0, 0, 0, 'enemy_rhombus', 4, 9, 12, 13)`);
      const { handlers, sent } = await connectAs('gm', { admin: true });
      handlers.generateNpcSheet({ location_id: 41, tier: 'ghost' });
      await untilValue(() => sent.find((s) => s.e === 'npcSheetGenerated'), Boolean, { label: 'the NPC sheet' });
      expect(await get(db, 'SELECT hp_current, hp_max, melee_ac, ranged_ac FROM locations WHERE id = 41'))
        .toEqual({ hp_current: 4, hp_max: 9, melee_ac: 12, ranged_ac: 13 });
    });
  });
});
