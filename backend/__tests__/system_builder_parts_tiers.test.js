/**
 * A custom system with NPC tiers turned off (3b6c). GENERATE_SHEET makes an untiered sheet and
 * leaves the token's HP and defense alone, and the browser is sent no tiers, so it offers no
 * picker. The tiers stay in the definition: turning the part back on brings them back. The
 * built-in systems keep theirs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, untilValue } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');

const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const npcTiers = require_('../sheets/npcTiers');
const socketsFactory = require_('../sockets/index.js');

const NOTIERS = 'sys_aaaaaaaaaaaaaaaa';
const TIERED = 'sys_bbbbbbbbbbbbbbbb';

const vault = (tiersOn) => JSON.stringify({
  format: 1, name: 'Vault',
  ...(tiersOn ? {} : { parts: { npc_tiers: { on: false } } }),
  npc: { tiers: [
    { id: 'squire', label: 'SQUIRE', hp: 6, defense: 11, values: { might: 9 } },
    { id: 'champion', label: 'CHAMPION', hp: 30, defense: 17, values: { might: 16 } },
  ] },
});

let db;
beforeEach(async () => {
  db = await makeTestDb();
  await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1), (?, ?, ?, ?, 1)',
    [NOTIERS, 'Vault', vault(false), vault(false), TIERED, 'Vault', vault(true), vault(true)]);
  await new Promise((resolve) => runtime.load(db, resolve));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('the tiers a system offers', () => {
  it('are none while it has NPC tiers off, and the browser is sent none', () => {
    expect(npcTiers.getTierOptions(NOTIERS)).toEqual([]);
    expect(npcTiers.buildTier(NOTIERS, 'champion')).toBeNull();
    expect(runtime.render(NOTIERS).npc.tiers).toEqual([]);
  });

  it('are its own where it kept them, and the built-ins keep theirs', () => {
    expect(npcTiers.getTierOptions(TIERED).map((t) => t.id)).toEqual(['squire', 'champion']);
    expect(runtime.render(TIERED).npc.tiers.map((t) => t.id)).toEqual(['squire', 'champion']);
    expect(npcTiers.getTierOptions('cyberpunk_red').map((t) => t.id)).toEqual(['mook', 'skilled', 'pro', 'elite']);
    expect(npcTiers.buildTier('cities_without_number', 'elite')).toMatchObject({ tierId: 'elite', hp: 50 });
  });

  it('come back when the part is turned back on', async () => {
    await run(db, 'UPDATE custom_systems SET published = ?, version = 2 WHERE id = ?', [vault(true), NOTIERS]);
    await new Promise((resolve) => runtime.refresh(db, NOTIERS, resolve));
    expect(npcTiers.getTierOptions(NOTIERS).map((t) => t.id)).toEqual(['squire', 'champion']);
  });
});

describe('GENERATE_SHEET', () => {
  const generate = async (system, locationId) => {
    await run(db, `INSERT OR REPLACE INTO global_settings (key, value) VALUES ('game_system', ?)`, [system]);
    await run(db, `INSERT INTO locations (id, name, x, y, z, shape, hp_current, hp_max, melee_ac, ranged_ac) VALUES (?, 'Bandit', 0, 0, 0, 'enemy_rhombus', 3, 3, 8, 8)`, [locationId]);
    let connect;
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connect = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    const sent = [];
    connect({ id: `tier-${locationId}`, on: (e, fn) => { handlers[e] = fn; }, emit: (e, d) => sent.push({ e, d }),
      broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify({ userName: 'gm', isAdmin: true, token: GM });
    await drain(db);
    handlers.generateNpcSheet({ location_id: locationId, tier: 'champion' });
    const made = await untilValue(() => sent.find((s) => s.e === 'npcSheetGenerated'), Boolean, { label: 'the NPC sheet' });
    await drain(db);
    const token = await get(db, 'SELECT hp_current, hp_max, melee_ac, ranged_ac FROM locations WHERE id = ?', [locationId]);
    const data = JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE id = ?', [made.d.sheet_id])).data);
    return { tier: made.d.tier ?? null, token, might: data.might ?? null };
  };

  it('makes an untiered sheet while NPC tiers are off, whatever tier was asked for', async () => {
    expect(await generate(NOTIERS, 50)).toEqual({
      tier: null, token: { hp_current: 3, hp_max: 3, melee_ac: 8, ranged_ac: 8 }, might: null,
    });
  });

  it('uses the tier where the system kept them', async () => {
    expect(await generate(TIERED, 51)).toEqual({
      tier: 'champion', token: { hp_current: 30, hp_max: 30, melee_ac: 17, ranged_ac: 17 }, might: 16,
    });
  });
});
