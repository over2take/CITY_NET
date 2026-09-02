/**
 * Reordering the turn marker, and ending a combat from the nav list.
 *
 * Two behaviours that the older initiative tests cannot cover, because they mirror the
 * handler logic in the test file rather than calling it. These drive the real
 * registerInitiativeHandlers, so a change in sockets/initiative.js actually fails them.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import sqlite3 from 'sqlite3';

const mod = await import('../sockets/initiative.js');
const registerInitiativeHandlers = mod.registerInitiativeHandlers || mod.default.registerInitiativeHandlers;

// ── harness ───────────────────────────────────────────────────────────────────

function makeDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => { if (err) reject(err); });
    db.serialize(() => {
      db.run(`CREATE TABLE initiative_combat (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        turn_counter INTEGER DEFAULT 1,
        pass_counter INTEGER DEFAULT 1,
        system TEXT DEFAULT 'generic',
        mode TEXT DEFAULT 'individual',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      db.run(`CREATE TABLE initiative_scene (
        scene_key TEXT PRIMARY KEY,
        combat_id INTEGER NOT NULL,
        combatants TEXT NOT NULL DEFAULT '[]',
        sides TEXT NOT NULL DEFAULT '[]',
        turn_index INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      db.run(`CREATE TABLE dice_rolls (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER,
        results TEXT, color TEXT, historyString TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, () => resolve(db));
    });
  });
}

const get = (db, sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => e ? rej(e) : res(r)));
const run = (db, sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
const all = (db, sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => e ? rej(e) : res(r)));
/**
 * Wait for the handler's writes to land.
 *
 * The handlers are callback-driven, so there is nothing to await. Polling the condition
 * rather than sleeping a fixed span keeps these from failing on a loaded machine, which a
 * flat 40ms wait does not.
 */
const waitFor = async (fn, timeout = 2000) => {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) return null;
    await new Promise((r) => setTimeout(r, 5));
  }
};

/** For the cases that assert nothing happened, where there is no condition to wait on. */
const settle = () => new Promise((r) => setTimeout(r, 150));

function boot(db) {
  const emitted = [];
  let connectionCb;
  const io = {
    on: (event, cb) => { if (event === 'connection') connectionCb = cb; },
    emit: (event, data) => emitted.push({ event, data }),
    to: () => ({ emit: (event, data) => emitted.push({ event, data }) }),
  };
  registerInitiativeHandlers(io, db);

  const handlers = {};
  connectionCb({
    id: 'sock-1',
    on: (event, fn) => { handlers[event] = fn; },
    emit: (event, data) => emitted.push({ event, data, direct: true }),
    use: () => {}, join: () => {},
  });
  return { handlers, emitted };
}

/** Four combatants in a fixed order, with the turn on whichever index is asked for. */
async function seedScene(db, sceneKey, combatId, turnIndex = 0) {
  const list = ['A', 'B', 'C', 'D'].map((n, i) => ({ id: `c:${n}`, name: n, score: 20 - i, insertOrder: i }));
  await run(db, `INSERT INTO initiative_scene (scene_key, combat_id, combatants, sides, turn_index)
                 VALUES (?, ?, ?, '[]', ?)`, [sceneKey, combatId, JSON.stringify(list), turnIndex]);
}

const namesOf = (row) => JSON.parse(row.combatants).map((c) => c.name);

let db, handlers, combatId;
beforeEach(async () => {
  db = await makeDb();
  const r = await run(db, `INSERT INTO initiative_combat (turn_counter, pass_counter, system, mode)
                           VALUES (1, 1, 'generic', 'individual')`);
  combatId = r.lastID;
  ({ handlers } = boot(db));
});

// ── the turn belongs to the slot ──────────────────────────────────────────────

describe('reorder keeps the turn on its slot', () => {
  it('hands the turn to whoever moves into the active position', async () => {
    // The reported case: A holds the turn at position 1 and is dragged below C.
    // B moves up into position 1 and should now be up.
    await seedScene(db, 'city:0', combatId, 0);
    handlers['initiative:reorder']({ sceneKey: 'city:0', fromIndex: 0, toIndex: 2 });

    const row = await waitFor(async () => {
      const r = await get(db, `SELECT combatants, turn_index FROM initiative_scene WHERE scene_key = ?`, ['city:0']);
      return namesOf(r).join() === 'B,C,A,D' ? r : null;
    });
    expect(row).toBeTruthy();
    expect(row.turn_index).toBe(0);
    expect(JSON.parse(row.combatants)[row.turn_index].name).toBe('B');
  });

  it('does not drag the turn along when the active combatant moves', async () => {
    // Same move with the turn further down: C holds it at index 2, and moving A below C
    // shifts C up to index 1. The turn stays on 2, which is now A.
    await seedScene(db, 'city:0', combatId, 2);
    handlers['initiative:reorder']({ sceneKey: 'city:0', fromIndex: 0, toIndex: 2 });

    const row = await waitFor(async () => {
      const r = await get(db, `SELECT combatants, turn_index FROM initiative_scene WHERE scene_key = ?`, ['city:0']);
      return namesOf(r).join() === 'B,C,A,D' ? r : null;
    });
    expect(row).toBeTruthy();
    expect(row.turn_index).toBe(2);
    expect(JSON.parse(row.combatants)[row.turn_index].name).toBe('A');
  });

  it('leaves the turn index alone when reordering below it', async () => {
    await seedScene(db, 'city:0', combatId, 0);
    handlers['initiative:reorder']({ sceneKey: 'city:0', fromIndex: 2, toIndex: 3 });

    const row = await waitFor(async () => {
      const r = await get(db, `SELECT combatants, turn_index FROM initiative_scene WHERE scene_key = ?`, ['city:0']);
      return namesOf(r).join() === 'A,B,D,C' ? r : null;
    });
    expect(row).toBeTruthy();
    expect(row.turn_index).toBe(0);
  });

  it('refuses an out-of-range move without touching the order', async () => {
    await seedScene(db, 'city:0', combatId, 1);
    handlers['initiative:reorder']({ sceneKey: 'city:0', fromIndex: 0, toIndex: 9 });
    await settle();

    const row = await get(db, `SELECT combatants, turn_index FROM initiative_scene WHERE scene_key = ?`, ['city:0']);
    expect(namesOf(row)).toEqual(['A', 'B', 'C', 'D']);
    expect(row.turn_index).toBe(1);
  });
});

// ── ending a whole combat ─────────────────────────────────────────────────────

describe('end_combat', () => {
  it('clears every scene the combat spans and the combat itself', async () => {
    await seedScene(db, 'city:0', combatId);
    await seedScene(db, '7:1', combatId);

    handlers['initiative:end_combat']({ combatId });

    const gone = await waitFor(async () => {
      const rows = await all(db, `SELECT scene_key FROM initiative_scene WHERE combat_id = ?`, [combatId]);
      return rows.length === 0 ? true : null;
    });
    expect(gone).toBe(true);

    // The combat row goes in its own statement after the scenes, so it needs its own wait.
    const combatGone = await waitFor(async () =>
      (await get(db, `SELECT id FROM initiative_combat WHERE id = ?`, [combatId])) ? null : true);
    expect(combatGone).toBe(true);
  });

  it('tells every scene it ended, so clients watching any of them keep up', async () => {
    await seedScene(db, 'city:0', combatId);
    await seedScene(db, '7:1', combatId);
    const { handlers: h, emitted } = boot(db);

    h['initiative:end_combat']({ combatId });

    await waitFor(async () => emitted.filter((e) => e.event === 'initiative:ended').length === 2 || null);
    const ended = emitted.filter((e) => e.event === 'initiative:ended').map((e) => e.data.sceneKey);
    expect(ended.sort()).toEqual(['7:1', 'city:0']);
  });

  it('leaves other combats alone', async () => {
    const other = (await run(db, `INSERT INTO initiative_combat (turn_counter, pass_counter, system, mode)
                                  VALUES (1, 1, 'generic', 'individual')`)).lastID;
    await seedScene(db, 'city:0', combatId);
    await seedScene(db, '7:1', other);

    handlers['initiative:end_combat']({ combatId });

    await waitFor(async () => {
      const rows = await all(db, `SELECT scene_key FROM initiative_scene WHERE combat_id = ?`, [combatId]);
      return rows.length === 0 ? true : null;
    });
    const left = await all(db, `SELECT scene_key, combat_id FROM initiative_scene`);
    expect(left).toEqual([{ scene_key: '7:1', combat_id: other }]);
    expect(await get(db, `SELECT id FROM initiative_combat WHERE id = ?`, [other])).toBeTruthy();
  });

  it('ignores a call with no combat id', async () => {
    await seedScene(db, 'city:0', combatId);
    handlers['initiative:end_combat']({});
    await settle();
    expect(await all(db, `SELECT scene_key FROM initiative_scene`)).toHaveLength(1);
  });
});
