/**
 * A hit reaching its target (8b5c; approved mockup docs/mockups/damage-pipeline.html, section 5, answer 4): the map's attack
 * says HIT, and the attacker's next DAMAGE from a line of gear goes to that token, each part against its resistances.
 * AUTO takes it off its health, as the HEALTH folder's DAMAGE would, whatever the health model; OFF and CONFIRM only say
 * it. The GM's line says it all; players are told an NPC's resistances only as revealed (the user, 2026-11-25), and not
 * what was taken where one they don't know changed it; with HIT TOTALS ON NPCS: GM ONLY, on unless the table switched it off,
 * only that it was hit. A MISS, a new attack, CANCEL, leaving or a minute lets it go.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, run, get } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';
const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const { HIT_WAITS_MS } = require_('../tokens/hitOnTarget');
const socketsFactory = (await import('../sockets/index.js')).default;

const ID = 'sys_hitshitshitshits1';
const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const SYSTEM = (more = {}) => ({
  format: 1, name: 'Hits', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  items: {
    types: [{ id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'heals', label: 'HEALS', kind: 'dice' }] }],
    list: [
      { id: 'tongue', label: 'Flame Tongue', type: 'weapons', values: { damage: '4 SLASHING + 6 FIRE DMG', heals: '2' } },
      { id: 'club', label: 'Club', type: 'weapons', values: { damage: '5' } },
    ],
  },
  damage: { apply: 'auto' },
  ...more,
});
const LINES = { inventory: JSON.stringify(['Flame Tongue', 'Club'].map((name) => ({ name, qty: 1, enc: '', bundled: false, carry: 'readied', location: '' }))) };
const FIRE_RESISTED = { _resistances: [{ kind: 'resist', type: 'fire' }] };
/** HIT TOTALS ON NPCS: GM ONLY switched off, for what players are told of an NPC's resistances. */
const TOTALS_SHOWN = { hit_totals_gm_only: '0' };

let db;
const setUp = async ({ system = SYSTEM(), ghoulSheet = { name: 'Ghoul', ...FIRE_RESISTED }, ac = 0, settings = {} } = {}) => {
  db = await makeTestDb();
  await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT,
    players_history TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  const def = JSON.stringify(system);
  await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Hits', def, def]);
  await new Promise((resolve) => runtime.load(db, resolve));
  await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'game_system\', ?)', [ID]);
  for (const [key, value] of Object.entries(settings)) await run(db, 'INSERT INTO global_settings (key, value) VALUES (?, ?)', [key, value]);
  await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'kes\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Kes', ...LINES })]);
  await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'ash\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Ash', ...FIRE_RESISTED })]);
  const ghoul = await run(db, 'INSERT INTO locations (name, shape, x, z, melee_ac, ranged_ac, hp_current, hp_max, hp_temp) VALUES (\'Ghoul\', \'friendly_rhombus\', 0, 0, ?, ?, 20, 20, 0)', [ac, ac]);
  const ash = await run(db, 'INSERT INTO locations (name, shape, owner, x, z, melee_ac, hp_current, hp_max, hp_temp) VALUES (\'Ash\', \'rhombus\', \'ash\', 0, 0, 0, 20, 20, 2)');
  await run(db, 'INSERT INTO locations (name, shape, owner, x, z, battle_map_id, floor_index, hp_current, hp_max, hp_temp) VALUES (\'Ash\', \'rhombus\', \'ash\', 0, 0, 7, 0, 20, 20, 2)');
  if (ghoulSheet) {
    const sheet = await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES (\'gm\', ?, ?, 1, \'Ghoul\')', [ID, JSON.stringify(ghoulSheet)]);
    await run(db, 'INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)', [ghoul.lastID, sheet.lastID]);
  }

  // What everyone is sent goes into each one's own list too, in the order it came, beside what only they are sent.
  const shared = [];
  const everyone = [];
  let connection;
  const emitUpdate = vi.fn();
  const io = { on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: (event, data) => { shared.push({ event, data }); for (const h of everyone) h.push({ event, data }); }, to: () => ({ emit: () => {} }) };
  socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate, recordAction: vi.fn() });
  const join = async (who, identity) => {
    const heard = [];
    everyone.push(heard);
    const handlers = {};
    connection({ id: `hit-${who}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, d) => heard.push({ event, data: d }), broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify(identity);
    await drain(db);
    const lines = () => heard.filter((e) => e.event === 'diceRollBroadcast').map((e) => e.data.historyString);
    return { handlers, heard, lines };
  };
  const gm = await join('gm', { userName: 'gm', isAdmin: true, token: GM });
  const kes = await join('kes', 'kes');
  const hp = async (id = ghoul.lastID) => (await get(db, 'SELECT hp_current, hp_temp FROM locations WHERE id = ?', [id]));
  /** Kes attacks the token and rolls a d20 to hit: HIT where its AC is 0, a MISS where it is past 20. */
  const attack = async (targetId = ghoul.lastID) => {
    const before = kes.heard.filter((e) => e.event === 'attackPending').length;
    kes.handlers.initiateAttack({ targetId, attackType: 'melee' });
    await until(() => kes.heard.filter((e) => e.event === 'attackPending').length > before, { label: 'the attack waiting for its roll' });
    const rolled = shared.filter((e) => e.event === 'attackResult').length;
    kes.handlers.requestDiceRoll({ userName: 'kes', diceCounts: { 20: 1 }, modifiers: [], color: '#0f0' });
    await until(() => shared.filter((e) => e.event === 'attackResult').length > rolled, { label: 'the attack resolved' });
  };
  /** Kes rolls the Flame Tongue's DAMAGE (or HEALS) and both hear it: the GM's line and Kes's, the newest. */
  const damage = async (column = 'damage', line = 0) => {
    const n = gm.lines().length;
    const m = kes.lines().length;
    kes.handlers.requestSheetRoll({ gear: { line, column } });
    await until(() => gm.lines().length > n && kes.lines().length > m && /Flame Tongue|Club/.test(gm.lines().at(-1)), { label: 'the damage roll heard' });
    await until(async () => (await get(db, 'SELECT COUNT(*) AS n FROM dice_rolls WHERE historyString = ?', [gm.lines().at(-1)])).n > 0, { label: 'kept' });
    return { gm: gm.lines().at(-1), kes: kes.lines().at(-1) };
  };
  return { gm, kes, hp, attack, damage, join, ghoul: ghoul.lastID, ash: ash.lastID, emitUpdate, shared };
};
afterEach(() => vi.restoreAllMocks());

const ROLLED = 'Kes rolled Flame Tongue DAMAGE 4 SLASHING + 6 FIRE DMG [0 + 4] + [0 + 6] = 4 SLASHING + 6 FIRE DMG (10)';

describe('AUTO', () => {
  it('the hit\'s DAMAGE taken off the NPC, FIRE halved; the GM told all, players not what an unrevealed resistance did', async () => {
    const t = await setUp({ settings: TOTALS_SHOWN });
    await t.attack();
    const said = await t.damage();
    expect(said.gm).toBe(`${ROLLED} → GHOUL · RESISTS FIRE: 6 → 3 · HIDDEN FROM PLAYERS · TAKES 7 OF 10`);
    expect(said.kes).toBe(`${ROLLED} → GHOUL`);
    expect(await t.hp()).toEqual({ hp_current: 13, hp_temp: 0 });
    expect(t.emitUpdate).toHaveBeenCalledWith({ isRhombusOnly: true });
    const kept = await get(db, 'SELECT historyString, players_history FROM dice_rolls WHERE historyString LIKE \'%Flame Tongue%GHOUL%\'');
    expect(kept).toEqual({ historyString: said.gm, players_history: said.kes });
    // Taken: the next roll goes nowhere.
    expect((await t.damage()).gm).toBe(ROLLED);
    expect(await t.hp()).toEqual({ hp_current: 13, hp_temp: 0 });
  });

  it('revealed: players told it too, the line one for all; nothing met: as rolled, said plainly', async () => {
    const t = await setUp({ ghoulSheet: { name: 'Ghoul', ...FIRE_RESISTED, _revealed: ['fire'] }, settings: TOTALS_SHOWN });
    await t.attack();
    const said = await t.damage();
    expect(said.gm).toBe(`${ROLLED} → GHOUL · RESISTS FIRE: 6 → 3 · TAKES 7 OF 10`);
    expect(said.kes).toBe(said.gm);
    const plain = await setUp({ ghoulSheet: null, settings: TOTALS_SHOWN });
    await plain.attack();
    expect((await plain.damage()).kes).toBe(`${ROLLED} → GHOUL · TAKES 10`);
    expect(await plain.hp()).toEqual({ hp_current: 10, hp_temp: 0 });
  });

  it('a DAMAGE with no type: one part, taken whole', async () => {
    const t = await setUp({ settings: TOTALS_SHOWN });
    await t.attack();
    expect((await t.damage('damage', 1)).kes).toBe('Kes rolled Club DAMAGE 5 [0 + 5 = 5] → GHOUL · TAKES 5');
    expect(await t.hp()).toEqual({ hp_current: 15, hp_temp: 0 });
  });

  it('WORDS ONLY, or an unrevealed resistance that changes nothing: players keep the number, never the word', async () => {
    const t = await setUp({ system: SYSTEM({ damage: { apply: 'auto', resist: { works_out: 'words' } } }), settings: TOTALS_SHOWN });
    await t.attack();
    const said = await t.damage();
    expect(said.gm).toBe(`${ROLLED} → GHOUL · RESISTS FIRE (TAKEN AS ROLLED) · HIDDEN FROM PLAYERS · TAKES 10`);
    expect(said.kes).toBe(`${ROLLED} → GHOUL · TAKES 10`);
  });

  it('HIT TOTALS ON NPCS: GM ONLY, as it starts: players told only that the NPC was hit, all revealed or none met', async () => {
    const t = await setUp({ ghoulSheet: { name: 'Ghoul', ...FIRE_RESISTED, _revealed: ['fire'] } });
    await t.attack();
    const said = await t.damage();
    expect(said.gm).toBe(`${ROLLED} → GHOUL · RESISTS FIRE: 6 → 3 · HIDDEN FROM PLAYERS · TAKES 7 OF 10`);
    expect(said.kes).toBe(`${ROLLED} → GHOUL`);
    expect(await t.hp()).toEqual({ hp_current: 13, hp_temp: 0 });
    const on = await setUp({ ghoulSheet: null, settings: { hit_totals_gm_only: '1' } });
    await on.attack();
    expect(await on.damage()).toEqual({ gm: `${ROLLED} → GHOUL · HIDDEN FROM PLAYERS · TAKES 10`, kes: `${ROLLED} → GHOUL` });
  });

  it('a player\'s character: every copy of their token, TEMP first; their sheet told; their resistances everyone\'s to know', async () => {
    const t = await setUp();
    await t.attack(t.ash);
    const said = await t.damage();
    expect(said.gm).toBe(`${ROLLED} → ASH · RESISTS FIRE: 6 → 3 · TAKES 7 OF 10`);
    expect(said.kes).toBe(said.gm);
    expect((await get(db, 'SELECT COUNT(*) AS n FROM locations WHERE owner = \'ash\' AND hp_current = 15 AND hp_temp = 0')).n).toBe(2);
    expect(t.shared.some((e) => e.event === 'sheetUpdated' && e.data.username === 'ash')).toBe(true);
  });

  it('another health model: its own rule on the sheet as written; one that can\'t take it says why and takes nothing', async () => {
    const typed = { model: 'typed', types: [{ id: 'bashing', label: 'Bashing' }, { id: 'lethal', label: 'Lethal' }] };
    const t = await setUp({ system: SYSTEM({ core: { health: typed }, derived: [{ id: 'hurt', label: 'Hurt', formula: '@bashing + @lethal' }] }) });
    await run(db, 'UPDATE locations SET hp_max = 9, hp_current = 9 WHERE id = ?', [t.ghoul]);
    await t.attack();
    expect((await t.damage()).gm).toContain('→ GHOUL · RESISTS FIRE: 6 → 3 · HIDDEN FROM PLAYERS · TAKES 7 OF 10');
    expect(await t.hp()).toEqual({ hp_current: 2, hp_temp: 0 });
    const sheet = await get(db, 'SELECT data FROM character_sheets WHERE npc_label = \'Ghoul\'');
    expect(JSON.parse(sheet.data)).toMatchObject({ bashing: 7, lethal: 0, hurt: 7 });
    // No sheet to keep the marks on: said, nothing taken.
    const bare = await setUp({ system: SYSTEM({ core: { health: typed } }), ghoulSheet: null });
    await bare.attack();
    expect((await bare.damage()).gm).toBe(`${ROLLED} → GHOUL · NOT APPLIED: THIS TOKEN HAS NO SHEET TO KEEP THAT ON · HIDDEN FROM PLAYERS · WOULD TAKE 10`);
    expect(await bare.hp()).toEqual({ hp_current: 20, hp_temp: 0 });
    // Health as conditions only.
    const none = await setUp({ system: SYSTEM({ core: { health: { model: 'none' } } }) });
    await none.attack();
    expect((await none.damage()).gm).toBe(`${ROLLED} → GHOUL · RESISTS FIRE: 6 → 3 · NOT APPLIED: THIS SYSTEM TRACKS HARM AS CONDITIONS, NOT HEALTH · HIDDEN FROM PLAYERS · WOULD TAKE 7 OF 10`);
    expect(await none.hp()).toEqual({ hp_current: 20, hp_temp: 0 });
  });
});

describe('OFF and CONFIRM: said, not taken', () => {
  it('the table\'s OFF over the system\'s AUTO; a system on CONFIRM, as it starts; WORK IT OUT off the table\'s too', async () => {
    const off = await setUp({ settings: { apply_damage: 'off', work_out_resistances: '0' } });
    await off.attack();
    const said = await off.damage();
    expect(said.gm).toBe(`${ROLLED} → GHOUL · RESISTS FIRE (TAKEN AS ROLLED) · NOT APPLIED: APPLY DAMAGE IS OFF · HIDDEN FROM PLAYERS · WOULD TAKE 10`);
    expect(said.kes).toBe(`${ROLLED} → GHOUL · NOT APPLIED: APPLY DAMAGE IS OFF`);
    expect(await off.hp()).toEqual({ hp_current: 20, hp_temp: 0 });
    expect(off.emitUpdate).not.toHaveBeenCalledWith({ isRhombusOnly: true });
    const { damage: _d, ...noApply } = SYSTEM();
    const confirm = await setUp({ system: noApply, ghoulSheet: { name: 'Ghoul' }, settings: TOTALS_SHOWN });
    await confirm.attack();
    expect((await confirm.damage()).gm).toBe(`${ROLLED} → GHOUL · NOT APPLIED: APPLY DAMAGE IS CONFIRM · WOULD TAKE 10`);
    expect(await confirm.hp()).toEqual({ hp_current: 20, hp_temp: 0 });
  });
});

describe('the to-hit, said (8b5c; the user, 2026-11-25: players see HIT or MISS, never the AC)', () => {
  /** Kes's d20 against the Ghoul, the GM's line and Kes's. */
  const toHit = async (t) => {
    await t.attack();
    const said = { gm: t.gm.lines().find((l) => l.includes('rolled 1d20')), kes: t.kes.lines().find((l) => l.includes('rolled 1d20')) };
    return said;
  };

  it('a HIT: the target and HIT for all, what it was against the GM\'s alone; kept so for the history', async () => {
    const t = await setUp();
    const said = await toHit(t);
    expect(said.gm).toMatch(/^Kes rolled 1d20 \[\(\d+\) = \d+\] → GHOUL · VS AC 0 · HIT$/);
    expect(said.kes).toBe(said.gm.replace(' · VS AC 0', ''));
    await until(async () => !!(await get(db, 'SELECT 1 AS y FROM dice_rolls WHERE historyString = ?', [said.gm])), { label: 'kept' });
    expect(await get(db, 'SELECT players_history FROM dice_rolls WHERE historyString = ?', [said.gm])).toEqual({ players_history: said.kes });
    expect(t.shared.find((e) => e.event === 'attackResult').data).toMatchObject({ hit: true, ac: 0 });
  });

  it('a MISS: said so, past an AC no d20 reaches', async () => {
    const t = await setUp({ ac: 99 });
    const said = await toHit(t);
    expect(said.gm).toMatch(/ → GHOUL · VS AC 99 · MISS$/);
    expect(said.kes).toMatch(/ → GHOUL · MISS$/);
    expect(said.kes).not.toContain('99');
  });

  it('in the game\'s word: Cyberpunk RED\'s DV, Shadowrun\'s ARMOR; a vehicle\'s AC whatever the game', async () => {
    const t = await setUp();
    await run(db, 'UPDATE global_settings SET value = ? WHERE key = ?', ['shadowrun_6e', 'game_system']);
    expect((await toHit(t)).gm).toMatch(/ → GHOUL · VS ARMOR 0 · HIT$/);
    const red = await setUp();
    await run(db, 'UPDATE global_settings SET value = ? WHERE key = ?', ['cyberpunk_red', 'game_system']);
    expect((await toHit(red)).gm).toMatch(/ → GHOUL · VS DV 0 · HIT$/);
    const car = await setUp();
    await run(db, 'UPDATE global_settings SET value = ? WHERE key = ?', ['shadowrun_6e', 'game_system']);
    await run(db, 'UPDATE locations SET vehicle_state = ? WHERE id = ?', [JSON.stringify({ name: 'Van', ac: 0, hp: 20, hpMax: 20 }), car.ghoul]);
    expect((await toHit(car)).gm).toMatch(/ → GHOUL · VS AC 0 · HIT$/);
  });

  it('one roll answers an attack: on its AC exactly a HIT, and the roll after it nobody\'s to-hit', async () => {
    const t = await setUp({ ac: 5 });
    t.kes.handlers.initiateAttack({ targetId: t.ghoul, attackType: 'melee' });
    await until(() => t.kes.heard.some((e) => e.event === 'attackPending'), { label: 'the attack waiting' });
    // A d1 and 4 added: 5, the AC itself.
    t.kes.handlers.requestDiceRoll({ userName: 'kes', diceCounts: { 1: 1 }, modifiers: [4], color: '#0f0' });
    await until(() => t.gm.lines().some((l) => l.includes('rolled 1d1')), { label: 'the to-hit' });
    expect(t.gm.lines().find((l) => l.includes('rolled 1d1'))).toMatch(/ → GHOUL · VS AC 5 · HIT$/);
    t.kes.handlers.requestDiceRoll({ userName: 'kes', diceCounts: { 1: 2 }, modifiers: [], color: '#0f0' });
    await until(() => t.gm.lines().some((l) => l.includes('rolled 2d1')), { label: 'the roll after' });
    expect(t.gm.lines().find((l) => l.includes('rolled 2d1'))).not.toContain('→');
  });

  it('a roll with no attack waiting: as it always was, one line for all', async () => {
    const t = await setUp();
    t.kes.handlers.requestDiceRoll({ userName: 'kes', diceCounts: { 6: 1 }, modifiers: [], color: '#0f0' });
    await until(() => t.kes.lines().some((l) => l.includes('rolled 1d6')), { label: 'the plain roll' });
    const line = t.kes.lines().find((l) => l.includes('rolled 1d6'));
    expect(line).toMatch(/^Kes rolled 1d6 \[\(\d\) = \d\]$/);
    expect(t.gm.lines().find((l) => l.includes('rolled 1d6'))).toBe(line);
  });
});

describe('what lets a hit go', () => {
  it('a MISS: nothing waits, a HIT before it let go', async () => {
    const t = await setUp();
    await t.attack();
    await run(db, 'UPDATE locations SET melee_ac = 99 WHERE id = ?', [t.ghoul]);
    await t.attack();
    expect((await t.damage()).gm).toBe(ROLLED);
    expect(await t.hp()).toEqual({ hp_current: 20, hp_temp: 0 });
  });

  it('a DICE column\'s roll leaves it waiting for the DAMAGE', async () => {
    const t = await setUp();
    await t.attack();
    expect((await t.damage('heals')).gm).toBe('Kes rolled Flame Tongue HEALS 2 [0 + 2 = 2]');
    expect((await t.damage()).gm).toContain('→ GHOUL · RESISTS FIRE: 6 → 3 · HIDDEN FROM PLAYERS · TAKES 7 OF 10');
  });

  it('CANCEL, a new attack, leaving, or a minute gone by', async () => {
    const t = await setUp();
    await t.attack();
    t.kes.handlers.cancelAttack();
    expect((await t.damage()).gm).toBe(ROLLED);
    await t.attack();
    const before = t.kes.heard.filter((e) => e.event === 'attackPending').length;
    t.kes.handlers.initiateAttack({ targetId: t.ghoul, attackType: 'melee' });
    await until(() => t.kes.heard.filter((e) => e.event === 'attackPending').length > before, { label: 'the new attack' });
    expect((await t.damage()).gm).toBe(ROLLED);
    t.kes.handlers.cancelAttack();
    await t.attack();
    t.kes.handlers.disconnect();
    // The same connection's id come back: nothing waits for it.
    const back = await t.join('kes', 'kes');
    const n = back.lines().length;
    back.handlers.requestSheetRoll({ gear: { line: 0, column: 'damage' } });
    await until(() => back.lines().length > n, { label: 'the roll after coming back' });
    expect(back.lines().at(-1)).toBe(ROLLED);
    expect(await t.hp()).toEqual({ hp_current: 20, hp_temp: 0 });

    const late = await setUp();
    await late.attack();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + HIT_WAITS_MS + 1);
    expect((await late.damage()).gm).toBe(ROLLED);
    expect(await late.hp()).toEqual({ hp_current: 20, hp_temp: 0 });
    expect(HIT_WAITS_MS).toBe(60_000);
  });
});
