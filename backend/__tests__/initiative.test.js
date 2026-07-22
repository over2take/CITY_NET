import { describe, it, expect, beforeEach } from 'vitest';
import sqlite3 from 'sqlite3';

// ── In-memory DB with initiative tables ──────────────────────────────────────

function makeDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => {
      if (err) return reject(err);
    });
    db.serialize(() => {
      db.run(`CREATE TABLE initiative_combat (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        turn_counter INTEGER DEFAULT 1,
        pass_counter INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);
      db.run(`CREATE TABLE initiative_scene (
        scene_key TEXT PRIMARY KEY,
        combat_id INTEGER NOT NULL,
        combatants TEXT NOT NULL DEFAULT '[]',
        turn_index INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(combat_id) REFERENCES initiative_combat(id) ON DELETE CASCADE
      )`, () => resolve(db));
    });
  });
}

const get = (db, sql, params = []) =>
  new Promise((res, rej) => db.get(sql, params, (err, row) => err ? rej(err) : res(row)));
const run = (db, sql, params = []) =>
  new Promise((res, rej) => db.run(sql, params, function (err) { err ? rej(err) : res(this); }));
const all = (db, sql, params = []) =>
  new Promise((res, rej) => db.all(sql, params, (err, rows) => err ? rej(err) : res(rows)));

// ── Helpers that mirror the socket handler logic ──────────────────────────────

async function startCombat(db) {
  const result = await run(db, `INSERT INTO initiative_combat (turn_counter, pass_counter) VALUES (1, 1)`);
  return result.lastID;
}

async function startScene(db, sceneKey, combatId) {
  await run(db, `INSERT OR IGNORE INTO initiative_scene (scene_key, combat_id, combatants, turn_index) VALUES (?, ?, '[]', 0)`, [sceneKey, combatId]);
}

async function addCombatant(db, sceneKey, combatant) {
  const row = await get(db, `SELECT combatants FROM initiative_scene WHERE scene_key = ?`, [sceneKey]);
  const list = JSON.parse(row.combatants || '[]');
  const filtered = list.filter((c) => c.id !== combatant.id);
  filtered.push({ ...combatant, insertOrder: Date.now() });
  filtered.sort((a, b) => b.score - a.score || a.insertOrder - b.insertOrder);
  await run(db, `UPDATE initiative_scene SET combatants = ? WHERE scene_key = ?`, [JSON.stringify(filtered), sceneKey]);
}

async function nextTurn(db, sceneKey) {
  const row = await get(db,
    `SELECT s.combatants, s.turn_index, s.combat_id, c.turn_counter
     FROM initiative_scene s JOIN initiative_combat c ON c.id = s.combat_id
     WHERE s.scene_key = ?`, [sceneKey]);

  const combatants = JSON.parse(row.combatants || '[]');
  const nextIndex = row.turn_index + 1;
  const wrapped = nextIndex >= combatants.length;
  const newTurnIndex = wrapped ? 0 : nextIndex;

  await run(db, `UPDATE initiative_scene SET turn_index = ? WHERE scene_key = ?`, [newTurnIndex, sceneKey]);
  if (wrapped) {
    await run(db, `UPDATE initiative_combat SET turn_counter = turn_counter + 1 WHERE id = ?`, [row.combat_id]);
  }
  return { wrapped };
}

async function removeCombatant(db, sceneKey, combatantId) {
  const row = await get(db, `SELECT combatants, turn_index FROM initiative_scene WHERE scene_key = ?`, [sceneKey]);
  const list = JSON.parse(row.combatants || '[]');
  const removedIdx = list.findIndex((c) => c.id === combatantId);
  const filtered = list.filter((c) => c.id !== combatantId);
  let newTurnIndex = row.turn_index;
  if (removedIdx < row.turn_index) newTurnIndex = Math.max(0, row.turn_index - 1);
  if (newTurnIndex >= filtered.length) newTurnIndex = 0;
  await run(db, `UPDATE initiative_scene SET combatants = ?, turn_index = ? WHERE scene_key = ?`, [JSON.stringify(filtered), newTurnIndex, sceneKey]);
}

async function reorder(db, sceneKey, fromIndex, toIndex) {
  const row = await get(db, `SELECT combatants, turn_index FROM initiative_scene WHERE scene_key = ?`, [sceneKey]);
  const list = JSON.parse(row.combatants || '[]');
  const activeId = list[row.turn_index]?.id;
  const [moved] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, moved);
  let newTurnIndex = list.findIndex((c) => c.id === activeId);
  if (newTurnIndex < 0) newTurnIndex = 0;
  await run(db, `UPDATE initiative_scene SET combatants = ?, turn_index = ? WHERE scene_key = ?`, [JSON.stringify(list), newTurnIndex, sceneKey]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

let db;
beforeEach(async () => { db = await makeDb(); });

describe('initiative — start', () => {
  it('creates a combat row with turn_counter=1', async () => {
    const id = await startCombat(db);
    const row = await get(db, `SELECT * FROM initiative_combat WHERE id = ?`, [id]);
    expect(row.turn_counter).toBe(1);
    expect(row.pass_counter).toBe(1);
  });

  it('creates a scene row linked to the combat', async () => {
    const combatId = await startCombat(db);
    await startScene(db, 'city:0', combatId);
    const row = await get(db, `SELECT * FROM initiative_scene WHERE scene_key = ?`, ['city:0']);
    expect(row.combat_id).toBe(combatId);
    expect(JSON.parse(row.combatants)).toEqual([]);
    expect(row.turn_index).toBe(0);
  });

  it('two scenes can share the same combat', async () => {
    const combatId = await startCombat(db);
    await startScene(db, 'map:1:0', combatId);
    await startScene(db, 'map:1:1', combatId);
    const rows = await all(db, `SELECT * FROM initiative_scene WHERE combat_id = ?`, [combatId]);
    expect(rows).toHaveLength(2);
  });
});

describe('initiative — rolls and ordering', () => {
  it('sorts combatants highest score first', async () => {
    const combatId = await startCombat(db);
    await startScene(db, 'city:0', combatId);
    await addCombatant(db, 'city:0', { id: 'a', name: 'Alice', score: 12, isNpc: false });
    await addCombatant(db, 'city:0', { id: 'b', name: 'Bob', score: 18, isNpc: false });
    await addCombatant(db, 'city:0', { id: 'c', name: 'Carl', score: 7, isNpc: true });
    const row = await get(db, `SELECT combatants FROM initiative_scene WHERE scene_key = ?`, ['city:0']);
    const list = JSON.parse(row.combatants);
    expect(list.map((c) => c.name)).toEqual(['Bob', 'Alice', 'Carl']);
  });

  it('re-rolling replaces the existing entry for that combatant', async () => {
    const combatId = await startCombat(db);
    await startScene(db, 'city:0', combatId);
    await addCombatant(db, 'city:0', { id: 'a', name: 'Alice', score: 5, isNpc: false });
    await addCombatant(db, 'city:0', { id: 'a', name: 'Alice', score: 15, isNpc: false });
    const row = await get(db, `SELECT combatants FROM initiative_scene WHERE scene_key = ?`, ['city:0']);
    const list = JSON.parse(row.combatants);
    expect(list).toHaveLength(1);
    expect(list[0].score).toBe(15);
  });
});

describe('initiative — next turn', () => {
  it('advances turn_index', async () => {
    const combatId = await startCombat(db);
    await startScene(db, 'city:0', combatId);
    await addCombatant(db, 'city:0', { id: 'a', name: 'Alice', score: 18, isNpc: false });
    await addCombatant(db, 'city:0', { id: 'b', name: 'Bob', score: 12, isNpc: false });
    await nextTurn(db, 'city:0');
    const row = await get(db, `SELECT turn_index FROM initiative_scene WHERE scene_key = ?`, ['city:0']);
    expect(row.turn_index).toBe(1);
  });

  it('wraps turn_index to 0 at end of list', async () => {
    const combatId = await startCombat(db);
    await startScene(db, 'city:0', combatId);
    await addCombatant(db, 'city:0', { id: 'a', name: 'Alice', score: 18, isNpc: false });
    await addCombatant(db, 'city:0', { id: 'b', name: 'Bob', score: 12, isNpc: false });
    await nextTurn(db, 'city:0'); // → 1
    const { wrapped } = await nextTurn(db, 'city:0'); // → wraps to 0
    expect(wrapped).toBe(true);
    const row = await get(db, `SELECT turn_index FROM initiative_scene WHERE scene_key = ?`, ['city:0']);
    expect(row.turn_index).toBe(0);
  });

  it('increments turn_counter on wrap', async () => {
    const combatId = await startCombat(db);
    await startScene(db, 'city:0', combatId);
    await addCombatant(db, 'city:0', { id: 'a', name: 'Alice', score: 18, isNpc: false });
    await nextTurn(db, 'city:0'); // single combatant → wraps immediately
    const combat = await get(db, `SELECT turn_counter FROM initiative_combat WHERE id = ?`, [combatId]);
    expect(combat.turn_counter).toBe(2);
  });

  it('two scenes in same combat share the turn_counter', async () => {
    const combatId = await startCombat(db);
    await startScene(db, 'map:0', combatId);
    await startScene(db, 'map:1', combatId);
    await addCombatant(db, 'map:0', { id: 'a', name: 'Alice', score: 18, isNpc: false });
    // Wrap scene map:0 → turn_counter increments
    await nextTurn(db, 'map:0');
    const combat = await get(db, `SELECT turn_counter FROM initiative_combat WHERE id = ?`, [combatId]);
    expect(combat.turn_counter).toBe(2);
  });
});

describe('initiative — remove combatant', () => {
  it('removes the entry from the list', async () => {
    const combatId = await startCombat(db);
    await startScene(db, 'city:0', combatId);
    await addCombatant(db, 'city:0', { id: 'a', name: 'Alice', score: 18, isNpc: false });
    await addCombatant(db, 'city:0', { id: 'b', name: 'Bob', score: 12, isNpc: false });
    await removeCombatant(db, 'city:0', 'a');
    const row = await get(db, `SELECT combatants FROM initiative_scene WHERE scene_key = ?`, ['city:0']);
    const list = JSON.parse(row.combatants);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('b');
  });

  it('adjusts turn_index when removing a combatant before active turn', async () => {
    const combatId = await startCombat(db);
    await startScene(db, 'city:0', combatId);
    await addCombatant(db, 'city:0', { id: 'a', name: 'Alice', score: 18, isNpc: false });
    await addCombatant(db, 'city:0', { id: 'b', name: 'Bob', score: 12, isNpc: false });
    await nextTurn(db, 'city:0'); // turn_index = 1 (Bob's turn)
    await removeCombatant(db, 'city:0', 'a'); // remove Alice (index 0), Bob should stay active
    const row = await get(db, `SELECT combatants, turn_index FROM initiative_scene WHERE scene_key = ?`, ['city:0']);
    expect(row.turn_index).toBe(0); // Bob is now at index 0
    expect(JSON.parse(row.combatants)[0].id).toBe('b');
  });

  it('clamps turn_index to 0 when list becomes empty after removal', async () => {
    const combatId = await startCombat(db);
    await startScene(db, 'city:0', combatId);
    await addCombatant(db, 'city:0', { id: 'a', name: 'Alice', score: 18, isNpc: false });
    await removeCombatant(db, 'city:0', 'a');
    const row = await get(db, `SELECT turn_index FROM initiative_scene WHERE scene_key = ?`, ['city:0']);
    expect(row.turn_index).toBe(0);
  });
});

describe('initiative — reorder', () => {
  it('moves an entry from one position to another', async () => {
    const combatId = await startCombat(db);
    await startScene(db, 'city:0', combatId);
    await addCombatant(db, 'city:0', { id: 'a', name: 'Alice', score: 18, isNpc: false });
    await addCombatant(db, 'city:0', { id: 'b', name: 'Bob', score: 12, isNpc: false });
    await addCombatant(db, 'city:0', { id: 'c', name: 'Carl', score: 8, isNpc: true });
    // Move Carl (index 2) above Bob (index 1)
    await reorder(db, 'city:0', 2, 1);
    const row = await get(db, `SELECT combatants FROM initiative_scene WHERE scene_key = ?`, ['city:0']);
    const names = JSON.parse(row.combatants).map((c) => c.name);
    expect(names).toEqual(['Alice', 'Carl', 'Bob']);
  });

  it('keeps the active combatant active after reorder', async () => {
    const combatId = await startCombat(db);
    await startScene(db, 'city:0', combatId);
    await addCombatant(db, 'city:0', { id: 'a', name: 'Alice', score: 18, isNpc: false });
    await addCombatant(db, 'city:0', { id: 'b', name: 'Bob', score: 12, isNpc: false });
    await nextTurn(db, 'city:0'); // Bob is active (index 1)
    await reorder(db, 'city:0', 1, 0); // move Bob to top
    const row = await get(db, `SELECT combatants, turn_index FROM initiative_scene WHERE scene_key = ?`, ['city:0']);
    const list = JSON.parse(row.combatants);
    expect(list[row.turn_index].id).toBe('b'); // Bob still active
  });
});
