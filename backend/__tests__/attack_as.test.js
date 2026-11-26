/**
 * ATTACK AS (8b6a; approved mockup docs/mockups/waiting-hits.html, sections 1 and 2, answered 2026-11-25). An attack picked
 * on the map is made as YOU or as an NPC in the target's scene: the GM any with a sheet there, a player those they control,
 * never the target, the server asking it too. Each character's HIT waits for that character's DAMAGE alone, so a GM running
 * an Ogre and a Goblin sends each one's damage to its own target (before, the Goblin's attack let the Ogre's hit go and the
 * Ogre's damage reached the Goblin's target). A built-in game's sheet attack as an NPC is asked the scene the same way.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, run, get } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';
const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const { sameScene, attackAsProblem, characterKey, createHitsWaiting } = require_('../tokens/attackAs');
const socketsFactory = (await import('../sockets/index.js')).default;

describe('the rules (tokens/attackAs.js)', () => {
  const at = (id, shape, map = null, floor = null) => ({ id, shape, battle_map_id: map, floor_index: floor });
  it('one scene: the same battle map and floor, or both on the city map', () => {
    expect(sameScene(at(1, 'x'), at(2, 'x'))).toBe(true);
    expect(sameScene(at(1, 'x', 7, 0), at(2, 'x', 7, 0))).toBe(true);
    expect(sameScene(at(1, 'x', 7, 0), at(2, 'x', 7, 1))).toBe(false);
    expect(sameScene(at(1, 'x', 7, 0), at(2, 'x', 8, 0))).toBe(false);
    expect(sameScene(at(1, 'x', 7, 0), at(2, 'x'))).toBe(false);
    // The city map has no floors: a stray floor index doesn't part two tokens there.
    expect(sameScene(at(1, 'x', null, 2), at(2, 'x', null, 0))).toBe(true);
  });
  it('who may be attacked as: an NPC in the target\'s scene, by the GM or its controller, never the target', () => {
    const target = at(1, 'rhombus', 7, 0);
    const ogre = at(2, 'enemy_rhombus', 7, 0);
    expect(attackAsProblem({ token: ogre, target, isGm: true, controls: false })).toBeNull();
    expect(attackAsProblem({ token: at(3, 'friendly_rhombus', 7, 0), target, isGm: false, controls: true })).toBeNull();
    expect(attackAsProblem({ token: ogre, target, isGm: false, controls: false })).toBe('Not one you may attack with');
    expect(attackAsProblem({ token: at(4, 'enemy_rhombus', 8, 0), target, isGm: true, controls: false })).toBe("Not in the target's scene");
    expect(attackAsProblem({ token: at(5, 'rhombus', 7, 0), target, isGm: true, controls: true })).toBe('Not an NPC');
    expect(attackAsProblem({ token: undefined, target, isGm: true, controls: true })).toBe('Not an NPC');
    expect(attackAsProblem({ token: ogre, target: undefined, isGm: true, controls: true })).toBe('No target');
    expect(attackAsProblem({ token: at(1, 'enemy_rhombus', 7, 0), target: at(1, 'enemy_rhombus', 7, 0), isGm: true, controls: true })).toBe('Not the target itself');
  });
  it('whose a hit is: the roller\'s own, or an NPC\'s by its token', () => {
    expect(characterKey(null)).toBe('self');
    expect(characterKey(undefined)).toBe('self');
    expect(characterKey(12)).toBe('npc:12');
  });
  it('the hits waiting: one per character, taken once, a late one given back as none, a socket dropped whole', () => {
    const w = createHitsWaiting();
    w.set('s', 'npc:1', { targetId: 10, until: 100 });
    w.set('s', 'npc:2', { targetId: 20, until: 100 });
    w.set('s', 'npc:1', { targetId: 11, until: 100 });
    expect(w.take('s', 'npc:1', 50)).toEqual({ targetId: 11, until: 100 });
    expect(w.take('s', 'npc:1', 50)).toBeNull();
    expect(w.has('s', 'npc:2')).toBe(true);
    expect(w.take('s', 'npc:2', 101)).toBeNull();
    expect(w.has('s', 'npc:2')).toBe(false);
    w.set('s', 'self', { targetId: 30, until: 100 });
    w.set('t', 'self', { targetId: 40, until: 100 });
    w.letGo('s', 'nobody');
    w.letGo('u', 'self');
    expect(w.has('s', 'self')).toBe(true);
    w.drop('s');
    expect(w.has('s', 'self')).toBe(false);
    expect(w.take('t', 'self', 0)).toEqual({ targetId: 40, until: 100 });
  });
});

const ID = 'sys_attackasattackas1';
const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const SYSTEM = {
  format: 1, name: 'Attack As', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  items: {
    types: [{ id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }] }],
    list: [{ id: 'axe', label: 'Greataxe', type: 'weapons', values: { damage: '5' } }, { id: 'bow', label: 'Shortbow', type: 'weapons', values: { damage: '3' } }],
  },
  damage: { apply: 'auto' },
};
const carrying = (name) => JSON.stringify([{ name, qty: 1, enc: '', bundled: false, carry: 'readied', location: '' }]);

let db;
const setUp = async () => {
  db = await makeTestDb();
  await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT,
    players_history TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  const def = JSON.stringify(SYSTEM);
  await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Attack As', def, def]);
  await new Promise((resolve) => runtime.load(db, resolve));
  await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'game_system\', ?)', [ID]);
  await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'kes\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Kes', inventory: carrying('Shortbow') })]);
  await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'mira\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Mira' })]);
  const token = async (name, shape, { owner = null, map = 7, floor = 0, controllers = null } = {}) => (await run(db,
    'INSERT INTO locations (name, shape, owner, controllers, x, z, battle_map_id, floor_index, melee_ac, ranged_ac, hp_current, hp_max, hp_temp) VALUES (?, ?, ?, ?, 3, 4, ?, ?, 0, 0, 20, 20, 0)',
    [name, shape, owner, controllers, map, floor])).lastID;
  const npc = async (name, shape, weapon, opts) => {
    const id = await token(name, shape, opts);
    const sheet = await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES (\'gm\', ?, ?, 1, ?)', [ID, JSON.stringify({ name, inventory: carrying(weapon) }), name]);
    await run(db, 'INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)', [id, sheet.lastID]);
    return id;
  };
  const t = {
    kes: await token('Kes', 'rhombus', { owner: 'kes' }),
    mira: await token('Mira', 'rhombus', { owner: 'mira' }),
    ogre: await npc('Ogre', 'enemy_rhombus', 'Greataxe'),
    goblin: await npc('Goblin', 'enemy_rhombus', 'Shortbow'),
    // Another floor of the same battle map; a friendly NPC given to Kes, here and on another map; one with no sheet.
    upstairs: await npc('Upstairs Ogre', 'enemy_rhombus', 'Greataxe', { floor: 1 }),
    pet: await npc('Pet', 'friendly_rhombus', 'Greataxe', { controllers: JSON.stringify({ all: false, users: ['kes'] }) }),
    farPet: await npc('Far Pet', 'friendly_rhombus', 'Greataxe', { map: 9, controllers: JSON.stringify({ all: false, users: ['kes'] }) }),
    bare: await token('Bare', 'enemy_rhombus'),
  };

  // What everyone is sent reaches each joined socket too, beside what only it is sent.
  const shared = [];
  const everyone = [];
  let connection;
  const io = { on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: (event, data) => { shared.push({ event, data }); for (const h of everyone) h.push({ event, data }); }, to: () => ({ emit: () => {} }) };
  socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
  const join = async (who, identity) => {
    const heard = [];
    everyone.push(heard);
    const handlers = {};
    connection({ id: `as-${who}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, d) => heard.push({ event, data: d }), broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify(identity);
    await drain(db);
    return { who, handlers, heard };
  };
  // Rolls are sent to each socket on its own (rollSeen.js): a GM watching reads every line whole.
  const watcher = await join('watcher', { userName: 'gm', isAdmin: true, token: GM });
  const lines = () => watcher.heard.filter((e) => e.event === 'diceRollBroadcast').map((e) => e.data.historyString);
  const hp = async (id) => (await get(db, 'SELECT hp_current FROM locations WHERE id = ?', [id])).hp_current;
  /** `by` attacks `targetId`, as the NPC `as` (after the server has had the pick), and rolls its d20: a HIT, AC 0. */
  const attack = async (by, targetId, as) => {
    const before = by.heard.filter((e) => e.event === 'attackPending').length;
    by.handlers.initiateAttack({ targetId, attackType: 'melee' });
    await until(() => by.heard.filter((e) => e.event === 'attackPending').length > before, { label: 'the attack waiting for its roll' });
    if (as !== undefined) {
      by.handlers.attackAs({ locationId: as });
      await drain(db);
    }
    const rolled = shared.filter((e) => e.event === 'attackResult').length;
    by.handlers.requestDiceRoll({ userName: by.who, diceCounts: { 20: 1 }, modifiers: [], color: '#0f0' });
    await until(() => shared.filter((e) => e.event === 'attackResult').length > rolled, { label: 'the attack resolved' });
    return shared.filter((e) => e.event === 'attackResult').at(-1).data;
  };
  /** `by` rolls the first line of gear's DAMAGE from a sheet: their own, or the NPC's `as`; the line that says it. */
  const damage = async (by, as) => {
    const n = lines().length;
    by.handlers.requestSheetRoll({ gear: { line: 0, column: 'damage' }, ...(as !== undefined ? { location_id: as } : {}) });
    await until(() => lines().length > n && /DAMAGE/.test(lines().at(-1)), { label: 'the damage heard' });
    const said = lines().at(-1);
    await until(async () => (await get(db, 'SELECT COUNT(*) AS n FROM dice_rolls WHERE historyString = ?', [said])).n > 0, { label: 'kept' });
    return said;
  };
  return { ...t, join, lines, hp, attack, damage, shared };
};
afterEach(() => vi.restoreAllMocks());

describe('a hit per character (the GM running two NPCs, mockup section 2)', () => {
  it('the Ogre\'s hit on Kes and the Goblin\'s on Mira both wait; each one\'s damage reaches its own target', async () => {
    const t = await setUp();
    const gm = await t.join('gm', { userName: 'gm', isAdmin: true, token: GM });
    const ogre = await t.attack(gm, t.kes, t.ogre);
    expect(t.lines().find((l) => / → KES · /.test(l))).toMatch(/^Ogre \(.+\) rolled 1d20 \[\(\d+\)( [+-] \d+)? = \d+\] → KES · VS AC 0 · HIT$/);
    // The swing drawn from the Ogre's token, not the GM's.
    expect(ogre.attackerPos).toEqual({ x: 3, z: 4 });
    await t.attack(gm, t.mira, t.goblin);
    expect(await t.damage(gm, t.ogre)).toMatch(/Greataxe DAMAGE .* → KES · TAKES 5$/);
    expect(await t.hp(t.kes)).toBe(15);
    expect(await t.hp(t.mira)).toBe(20);
    expect(await t.damage(gm, t.goblin)).toMatch(/Shortbow DAMAGE .* → MIRA · TAKES 3$/);
    expect(await t.hp(t.mira)).toBe(17);
    // Each taken once; an NPC with no hit of its own only rolls.
    expect(await t.damage(gm, t.ogre)).not.toMatch(/→/);
    expect(await t.damage(gm, t.pet)).not.toMatch(/→/);
    expect(await t.hp(t.kes)).toBe(15);
  });

  it('a character attacking again lets only its own last hit go; YOU is its own character', async () => {
    const t = await setUp();
    const gm = await t.join('gm', { userName: 'gm', isAdmin: true, token: GM });
    await t.attack(gm, t.kes, t.ogre);
    await t.attack(gm, t.mira, t.goblin);
    // The Ogre again, at Mira: its hit on Kes goes, the Goblin's stays.
    await t.attack(gm, t.mira, t.ogre);
    expect(await t.damage(gm, t.goblin)).toMatch(/→ MIRA · TAKES 3$/);
    expect(await t.damage(gm, t.ogre)).toMatch(/→ MIRA · TAKES 5$/);
    expect(await t.hp(t.kes)).toBe(20);
    expect(await t.hp(t.mira)).toBe(12);
    // A player attacking as themselves: their own sheet's damage reaches it, an NPC's they control doesn't.
    const kes = await t.join('kes', 'kes');
    await t.attack(kes, t.ogre);
    expect(t.lines().find((l) => / → OGRE · /.test(l))).toMatch(/^Kes rolled 1d20/);
    expect(await t.damage(kes, t.pet)).not.toMatch(/→/);
    expect(await t.damage(kes)).toMatch(/Shortbow DAMAGE .* → OGRE · (.+ · )?TAKES 3$/);
    expect(await t.hp(t.ogre)).toBe(17);
  });

  it('CANCEL lets the picked character\'s go, the others\' still waiting; leaving lets them all go', async () => {
    const t = await setUp();
    const gm = await t.join('gm', { userName: 'gm', isAdmin: true, token: GM });
    await t.attack(gm, t.kes, t.ogre);
    await t.attack(gm, t.mira, t.goblin);
    // A new attack picked as the Ogre, then cancelled: the Ogre's goes, the Goblin's stays.
    gm.handlers.initiateAttack({ targetId: t.mira, attackType: 'melee' });
    await until(() => gm.heard.filter((e) => e.event === 'attackPending').length === 3, { label: 'the third attack' });
    gm.handlers.attackAs({ locationId: t.ogre });
    await drain(db);
    gm.handlers.cancelAttack();
    expect(await t.damage(gm, t.ogre)).not.toMatch(/→/);
    expect(await t.damage(gm, t.goblin)).toMatch(/→ MIRA · TAKES 3$/);
    await t.attack(gm, t.kes, t.ogre);
    gm.handlers.disconnect();
    const back = await t.join('gm2', { userName: 'gm', isAdmin: true, token: GM });
    expect(await t.damage(back, t.ogre)).not.toMatch(/→/);
    expect(await t.hp(t.kes)).toBe(20);
  });
});

describe('who may be picked, asked by the server', () => {
  it('another floor, another map, the target, no sheet, someone else\'s NPC, nothing that is a number: refused, the attack stays YOU\'s', async () => {
    const t = await setUp();
    const gm = await t.join('gm', { userName: 'gm', isAdmin: true, token: GM });
    const kes = await t.join('kes', 'kes');
    const stays = async (by, targetId, as) => {
      await t.attack(by, targetId, as);
      const line = t.lines().filter((l) => / · HIT$/.test(l)).at(-1);
      // As the one who rolled it, not "Ogre (gm)".
      expect(line).toMatch(/^\S+ rolled 1d20 /);
    };
    await stays(gm, t.kes, t.upstairs);
    await stays(gm, t.kes, t.farPet);
    await stays(gm, t.ogre, t.ogre);
    await stays(gm, t.kes, t.bare);
    await stays(gm, t.kes, '12');
    await stays(kes, t.ogre, t.goblin);
    await stays(kes, t.ogre, t.farPet);
    // Kes's own Pet, here: theirs to attack as; its damage reaches the Ogre.
    await t.attack(kes, t.ogre, t.pet);
    expect(t.lines().filter((l) => / → OGRE · /.test(l)).at(-1)).toMatch(/^Pet \(Kes\) rolled 1d20/);
    expect(await t.damage(kes, t.pet)).toMatch(/Greataxe DAMAGE .* → OGRE · (.+ · )?TAKES 5$/);
    // Back to YOU on the next attack, unasked.
    await t.attack(kes, t.ogre);
    expect(t.lines().filter((l) => / → OGRE · /.test(l)).at(-1)).toMatch(/^Kes rolled 1d20/);
  });

  it('YOU picked after an NPC, in one attack: the hit is one\'s own again, and the NPC\'s last hit still waits', async () => {
    const t = await setUp();
    const gm = await t.join('gm', { userName: 'gm', isAdmin: true, token: GM });
    await t.attack(gm, t.mira, t.ogre);
    gm.handlers.initiateAttack({ targetId: t.kes, attackType: 'melee' });
    await until(() => gm.heard.filter((e) => e.event === 'attackPending').length === 2, { label: 'the second attack' });
    gm.handlers.attackAs({ locationId: t.ogre });
    await drain(db);
    gm.handlers.attackAs({ locationId: null });
    await drain(db);
    const rolled = t.shared.filter((e) => e.event === 'attackResult').length;
    gm.handlers.requestDiceRoll({ userName: 'gm', diceCounts: { 20: 1 }, modifiers: [], color: '#0f0' });
    await until(() => t.shared.filter((e) => e.event === 'attackResult').length > rolled, { label: 'the attack resolved' });
    expect(t.lines().filter((l) => / → KES · /.test(l)).at(-1)).toMatch(/^gm rolled 1d20 /);
    // Picked by mistake and back: the Ogre's hit on Mira is still its own to take.
    expect(await t.damage(gm, t.ogre)).toMatch(/→ MIRA · TAKES 5$/);
    expect(await t.hp(t.kes)).toBe(20);
  });
});

describe('a MISS', () => {
  it('lets that character\'s last hit go, and only that one\'s', async () => {
    const t = await setUp();
    await run(db, 'UPDATE locations SET melee_ac = 99 WHERE id = ?', [t.goblin]);
    const gm = await t.join('gm', { userName: 'gm', isAdmin: true, token: GM });
    await t.attack(gm, t.kes, t.ogre);
    await t.attack(gm, t.mira, t.pet);
    // The Ogre swings at the Goblin, past any d20.
    await t.attack(gm, t.goblin, t.ogre);
    expect(t.lines().filter((l) => / → GOBLIN · /.test(l)).at(-1)).toMatch(/^Ogre \(gm\) rolled .* · MISS$/);
    expect(await t.damage(gm, t.ogre)).not.toMatch(/→/);
    expect(await t.hp(t.kes)).toBe(20);
    expect(await t.damage(gm, t.pet)).toMatch(/→ MIRA · TAKES 5$/);
  });
});

describe('a built-in game\'s sheet attack as an NPC: the target\'s scene asked the same way', () => {
  it('an NPC on another floor refused with its reason; nothing rolled', async () => {
    const t = await setUp();
    await run(db, 'UPDATE global_settings SET value = \'cyberpunk_red\' WHERE key = \'game_system\'');
    const gm = await t.join('gm', { userName: 'gm', isAdmin: true, token: GM });
    const n = t.lines().length;
    gm.handlers.sheetAttack({ targetId: t.kes, weaponIndex: 1, location_id: t.upstairs });
    await until(() => gm.heard.some((e) => e.event === 'sheetAttackError'), { label: 'refused' });
    expect(gm.heard.find((e) => e.event === 'sheetAttackError').data.message).toBe("CAN'T ATTACK AS THAT NPC // NOT IN THE TARGET'S SCENE");
    await drain(db);
    expect(t.lines().length).toBe(n);
  });
});
