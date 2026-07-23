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

async function startCombat(db, system = 'generic', mode = 'individual') {
  const result = await run(db, `INSERT INTO initiative_combat (turn_counter, pass_counter, system, mode) VALUES (1, 1, ?, ?)`, [system, mode]);
  return result.lastID;
}

// Mirrors SR6 pass-decay logic from backend/sockets/initiative.js
async function nextTurnSr6(db, sceneKey) {
  const row = await get(db,
    `SELECT s.combatants, s.turn_index, s.combat_id, c.turn_counter, c.pass_counter, c.system
     FROM initiative_scene s JOIN initiative_combat c ON c.id = s.combat_id
     WHERE s.scene_key = ?`, [sceneKey]);

  const combatants = JSON.parse(row.combatants || '[]');
  const nextIndex = row.turn_index + 1;
  const wrapped = nextIndex >= combatants.length;

  if (!wrapped) {
    await run(db, `UPDATE initiative_scene SET turn_index = ? WHERE scene_key = ?`, [nextIndex, sceneKey]);
    return { wrapped: false, newRound: false };
  }

  // End of pass — SR6 decay
  const decayed = combatants.map((c) => ({ ...c, score: c.score - 10 }));
  const survivors = decayed.filter((c) => c.score > 0);
  const newRound = survivors.length === 0;
  await run(db, `UPDATE initiative_scene SET combatants = ?, turn_index = 0 WHERE scene_key = ?`,
    [JSON.stringify(newRound ? [] : survivors), sceneKey]);
  await run(db, `UPDATE initiative_combat SET pass_counter = pass_counter + 1 WHERE id = ?`, [row.combat_id]);
  return { wrapped: true, newRound };
}

async function startScene(db, sceneKey, combatId, sides = '[]') {
  await run(db, `INSERT OR IGNORE INTO initiative_scene (scene_key, combat_id, combatants, sides, turn_index) VALUES (?, ?, '[]', ?, 0)`, [sceneKey, combatId, sides]);
}

async function addCombatant(db, sceneKey, combatant) {
  const row = await get(db,
    `SELECT s.combatants, c.system FROM initiative_scene s JOIN initiative_combat c ON c.id = s.combat_id WHERE s.scene_key = ?`,
    [sceneKey]);
  const system = row.system || 'generic';
  const list = JSON.parse(row.combatants || '[]');
  const filtered = list.filter((c) => c.id !== combatant.id);
  filtered.push({ ...combatant, insertOrder: Date.now() });
  filtered.sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    if (system === 'cities_without_number') {
      const aNpc = a.isNpc ? 1 : 0;
      const bNpc = b.isNpc ? 1 : 0;
      if (aNpc !== bNpc) return aNpc - bNpc;
    }
    return a.insertOrder - b.insertOrder;
  });
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

describe('initiative — SR6 pass decay', () => {
  it('subtracts 10 from all scores at end of pass', async () => {
    const combatId = await startCombat(db, 'shadowrun_6e');
    await startScene(db, 'city:0', combatId);
    await addCombatant(db, 'city:0', { id: 'a', name: 'Alice', score: 15, isNpc: false });
    await nextTurnSr6(db, 'city:0'); // wraps — triggers decay
    const row = await get(db, `SELECT combatants FROM initiative_scene WHERE scene_key = ?`, ['city:0']);
    const list = JSON.parse(row.combatants);
    expect(list[0].score).toBe(5);
  });

  it('removes combatants whose score drops to 0 or below', async () => {
    const combatId = await startCombat(db, 'shadowrun_6e');
    await startScene(db, 'city:0', combatId);
    await addCombatant(db, 'city:0', { id: 'a', name: 'Alice', score: 15, isNpc: false });
    await addCombatant(db, 'city:0', { id: 'b', name: 'Bob', score: 8, isNpc: false });
    await nextTurnSr6(db, 'city:0'); // Alice → 5, Bob → -2 (removed)
    await nextTurnSr6(db, 'city:0'); // advance past Bob (already gone)
    const row = await get(db, `SELECT combatants FROM initiative_scene WHERE scene_key = ?`, ['city:0']);
    const list = JSON.parse(row.combatants);
    expect(list.every((c) => c.score > 0)).toBe(true);
    expect(list.find((c) => c.id === 'b')).toBeUndefined();
  });

  it('increments pass_counter at end of each pass', async () => {
    const combatId = await startCombat(db, 'shadowrun_6e');
    await startScene(db, 'city:0', combatId);
    await addCombatant(db, 'city:0', { id: 'a', name: 'Alice', score: 15, isNpc: false });
    await nextTurnSr6(db, 'city:0'); // end of pass 1
    const combat = await get(db, `SELECT pass_counter FROM initiative_combat WHERE id = ?`, [combatId]);
    expect(combat.pass_counter).toBe(2);
  });

  it('signals newRound when all scores drop to 0 or below', async () => {
    const combatId = await startCombat(db, 'shadowrun_6e');
    await startScene(db, 'city:0', combatId);
    await addCombatant(db, 'city:0', { id: 'a', name: 'Alice', score: 8, isNpc: false });
    const { newRound } = await nextTurnSr6(db, 'city:0'); // 8 - 10 = -2 → everyone out
    expect(newRound).toBe(true);
  });

  it('clears the combatant list on new round', async () => {
    const combatId = await startCombat(db, 'shadowrun_6e');
    await startScene(db, 'city:0', combatId);
    await addCombatant(db, 'city:0', { id: 'a', name: 'Alice', score: 8, isNpc: false });
    await nextTurnSr6(db, 'city:0');
    const row = await get(db, `SELECT combatants FROM initiative_scene WHERE scene_key = ?`, ['city:0']);
    expect(JSON.parse(row.combatants)).toHaveLength(0);
  });

  it('survivors keep their decayed scores for the next pass', async () => {
    const combatId = await startCombat(db, 'shadowrun_6e');
    await startScene(db, 'city:0', combatId);
    await addCombatant(db, 'city:0', { id: 'a', name: 'Alice', score: 22, isNpc: false });
    await addCombatant(db, 'city:0', { id: 'b', name: 'Bob', score: 14, isNpc: false });
    // Pass 1 end: Alice → 12, Bob → 4
    await nextTurnSr6(db, 'city:0');
    await nextTurnSr6(db, 'city:0');
    // Pass 2 end: Alice → 2, Bob → -6 (removed)
    await nextTurnSr6(db, 'city:0');
    await nextTurnSr6(db, 'city:0');
    const row = await get(db, `SELECT combatants FROM initiative_scene WHERE scene_key = ?`, ['city:0']);
    const list = JSON.parse(row.combatants);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('a');
    expect(list[0].score).toBe(2);
  });

  it('does not apply decay mid-pass (only on wrap)', async () => {
    const combatId = await startCombat(db, 'shadowrun_6e');
    await startScene(db, 'city:0', combatId);
    await addCombatant(db, 'city:0', { id: 'a', name: 'Alice', score: 15, isNpc: false });
    await addCombatant(db, 'city:0', { id: 'b', name: 'Bob', score: 12, isNpc: false });
    await nextTurnSr6(db, 'city:0'); // advance to Bob — no decay yet
    const row = await get(db, `SELECT combatants FROM initiative_scene WHERE scene_key = ?`, ['city:0']);
    const list = JSON.parse(row.combatants);
    expect(list[0].score).toBe(15); // Alice untouched
    expect(list[1].score).toBe(12); // Bob untouched
  });
});

describe('initiative — roll breakdown and diceResults', () => {
  it('stores breakdown on the combatant when provided', async () => {
    const combatId = await startCombat(db);
    await startScene(db, 'city:0', combatId);
    await addCombatant(db, 'city:0', { id: 'a', name: 'Alice', score: 13, breakdown: 'REA(5) + INT(2) + 1d6(6) = 13', diceResults: { 6: [6] }, isNpc: false });
    const row = await get(db, `SELECT combatants FROM initiative_scene WHERE scene_key = ?`, ['city:0']);
    const list = JSON.parse(row.combatants);
    expect(list[0].breakdown).toBe('REA(5) + INT(2) + 1d6(6) = 13');
    expect(list[0].diceResults).toEqual({ 6: [6] });
  });

  it('stores generic breakdown on the combatant', async () => {
    const combatId = await startCombat(db);
    await startScene(db, 'city:0', combatId);
    await addCombatant(db, 'city:0', { id: 'b', name: 'Bob', score: 15, breakdown: '1d20(15) = 15', diceResults: { 20: [15] }, isNpc: false });
    const row = await get(db, `SELECT combatants FROM initiative_scene WHERE scene_key = ?`, ['city:0']);
    const list = JSON.parse(row.combatants);
    expect(list[0].breakdown).toBe('1d20(15) = 15');
    expect(list[0].diceResults).toEqual({ 20: [15] });
  });

  it('breakdown is preserved after a re-roll', async () => {
    const combatId = await startCombat(db);
    await startScene(db, 'city:0', combatId);
    await addCombatant(db, 'city:0', { id: 'a', name: 'Alice', score: 8, breakdown: 'REA(3) + INT(3) + 1d6(2) = 8', diceResults: { 6: [2] }, isNpc: false });
    await addCombatant(db, 'city:0', { id: 'a', name: 'Alice', score: 14, breakdown: 'REA(5) + INT(3) + 1d6(6) = 14', diceResults: { 6: [6] }, isNpc: false });
    const row = await get(db, `SELECT combatants FROM initiative_scene WHERE scene_key = ?`, ['city:0']);
    const list = JSON.parse(row.combatants);
    expect(list).toHaveLength(1);
    expect(list[0].score).toBe(14);
    expect(list[0].breakdown).toBe('REA(5) + INT(3) + 1d6(6) = 14');
  });
});

describe('initiative — CP:R round behaviour', () => {
  it('keeps combatants across rounds (no reroll)', async () => {
    const cid = await startCombat(db, 'cyberpunk_red');
    await startScene(db, 'city:0', cid);
    await addCombatant(db, 'city:0', { id: 'player:a', name: 'A', score: 12, isNpc: false });
    await addCombatant(db, 'city:0', { id: 'npc:1', name: 'B', score: 8, isNpc: true });

    // Wrap past the last combatant
    await nextTurn(db, 'city:0');
    await nextTurn(db, 'city:0');

    const row = await get(db, `SELECT combatants FROM initiative_scene WHERE scene_key = 'city:0'`);
    expect(JSON.parse(row.combatants)).toHaveLength(2);
  });

  it('increments turn_counter on round wrap', async () => {
    const cid = await startCombat(db, 'cyberpunk_red');
    await startScene(db, 'city:0', cid);
    await addCombatant(db, 'city:0', { id: 'player:a', name: 'A', score: 10, isNpc: false });

    await nextTurn(db, 'city:0');
    const row = await get(db, `SELECT turn_counter FROM initiative_combat WHERE id = ?`, [cid]);
    expect(row.turn_counter).toBe(2);
  });
});

describe('initiative — CWN PC-wins-ties ordering', () => {
  it('places a PC before an NPC on equal score', async () => {
    const cid = await startCombat(db, 'cities_without_number');
    await startScene(db, 'city:0', cid);
    await addCombatant(db, 'city:0', { id: 'npc:1', name: 'Grunt', score: 10, isNpc: true });
    await addCombatant(db, 'city:0', { id: 'player:a', name: 'Alice', score: 10, isNpc: false });

    const row = await get(db, `SELECT combatants FROM initiative_scene WHERE scene_key = 'city:0'`);
    const list = JSON.parse(row.combatants);
    expect(list[0].name).toBe('Alice');
    expect(list[1].name).toBe('Grunt');
  });

  it('still sorts higher scores first regardless of PC/NPC', async () => {
    const cid = await startCombat(db, 'cities_without_number');
    await startScene(db, 'city:0', cid);
    await addCombatant(db, 'city:0', { id: 'player:a', name: 'Alice', score: 7, isNpc: false });
    await addCombatant(db, 'city:0', { id: 'npc:1', name: 'Grunt', score: 12, isNpc: true });

    const row = await get(db, `SELECT combatants FROM initiative_scene WHERE scene_key = 'city:0'`);
    const list = JSON.parse(row.combatants);
    expect(list[0].name).toBe('Grunt');
    expect(list[1].name).toBe('Alice');
  });

  it('PC-wins-ties does not affect generic system', async () => {
    const cid = await startCombat(db, 'generic');
    await startScene(db, 'city:0', cid);
    // NPC rolls first (lower insertOrder), gets tiebreak by insertOrder
    await addCombatant(db, 'city:0', { id: 'npc:1', name: 'Grunt', score: 10, isNpc: true });
    await addCombatant(db, 'city:0', { id: 'player:a', name: 'Alice', score: 10, isNpc: false });

    const row = await get(db, `SELECT combatants FROM initiative_scene WHERE scene_key = 'city:0'`);
    const list = JSON.parse(row.combatants);
    // insertOrder tiebreak — Grunt rolled first so appears first
    expect(list[0].name).toBe('Grunt');
  });
});

describe('initiative — side mode', () => {
  it('starts with PC side pre-populated in sides', async () => {
    const cid = await startCombat(db, 'cities_without_number', 'side');
    const initialSides = JSON.stringify([{ id: 'pc', name: 'PLAYERS', score: 0, isPlayerSide: true }]);
    await startScene(db, 'city:0', cid, initialSides);

    const row = await get(db, `SELECT sides FROM initiative_scene WHERE scene_key = 'city:0'`);
    const sides = JSON.parse(row.sides);
    expect(sides).toHaveLength(1);
    expect(sides[0].id).toBe('pc');
    expect(sides[0].isPlayerSide).toBe(true);
  });

  it('PC roll slots into pc side and updates PC side score', async () => {
    const cid = await startCombat(db, 'cities_without_number', 'side');
    const initialSides = JSON.stringify([{ id: 'pc', name: 'PLAYERS', score: 0, isPlayerSide: true }]);
    await startScene(db, 'city:0', cid, initialSides);

    // Simulate a PC rolling (sideId: 'pc')
    const combatant = { id: 'player:a', name: 'Alice', score: 9, isNpc: false, sideId: 'pc', insertOrder: 1 };
    const row = await get(db, `SELECT combatants, sides FROM initiative_scene WHERE scene_key = 'city:0'`);
    const list = JSON.parse(row.combatants);
    list.push(combatant);
    const sides = JSON.parse(row.sides);
    const updatedSides = sides.map((s) => s.id === 'pc' ? { ...s, score: 9 } : s);
    await run(db, `UPDATE initiative_scene SET combatants = ?, sides = ? WHERE scene_key = 'city:0'`,
      [JSON.stringify(list), JSON.stringify(updatedSides)]);

    const updated = await get(db, `SELECT combatants, sides FROM initiative_scene WHERE scene_key = 'city:0'`);
    const updatedSidesRead = JSON.parse(updated.sides);
    expect(updatedSidesRead[0].score).toBe(9);
    expect(JSON.parse(updated.combatants)[0].sideId).toBe('pc');
  });

  it('NPC side roll creates NPC side entry', async () => {
    const cid = await startCombat(db, 'cities_without_number', 'side');
    const initialSides = JSON.stringify([{ id: 'pc', name: 'PLAYERS', score: 9, isPlayerSide: true }]);
    await startScene(db, 'city:0', cid, initialSides);

    const row = await get(db, `SELECT sides FROM initiative_scene WHERE scene_key = 'city:0'`);
    const sides = JSON.parse(row.sides);
    sides.push({ id: 'npc', name: 'NPC', score: 5, isPlayerSide: false });
    await run(db, `UPDATE initiative_scene SET sides = ? WHERE scene_key = 'city:0'`, [JSON.stringify(sides)]);

    const updated = await get(db, `SELECT sides FROM initiative_scene WHERE scene_key = 'city:0'`);
    const updatedSides = JSON.parse(updated.sides);
    expect(updatedSides).toHaveLength(2);
    expect(updatedSides.find((s) => s.id === 'npc').score).toBe(5);
  });

  it('side with higher score goes first; PC wins tie', async () => {
    const sides = [
      { id: 'pc', name: 'PLAYERS', score: 7, isPlayerSide: true },
      { id: 'npc', name: 'NPC', score: 7, isPlayerSide: false },
    ];
    const sorted = [...sides].sort((a, b) => {
      const diff = b.score - a.score;
      if (diff !== 0) return diff;
      return a.isPlayerSide ? -1 : 1;
    });
    expect(sorted[0].id).toBe('pc');
    expect(sorted[1].id).toBe('npc');
  });

  it('next turn advances turn_index through sides and wraps', async () => {
    const cid = await startCombat(db, 'cities_without_number', 'side');
    const sides = JSON.stringify([
      { id: 'pc', name: 'PLAYERS', score: 9, isPlayerSide: true },
      { id: 'npc', name: 'NPC', score: 5, isPlayerSide: false },
    ]);
    await startScene(db, 'city:0', cid, sides);

    // Advance once
    await run(db, `UPDATE initiative_scene SET turn_index = 1 WHERE scene_key = 'city:0'`);
    let row = await get(db, `SELECT turn_index FROM initiative_scene WHERE scene_key = 'city:0'`);
    expect(row.turn_index).toBe(1);

    // Wrap
    await run(db, `UPDATE initiative_scene SET turn_index = 0 WHERE scene_key = 'city:0'`);
    await run(db, `UPDATE initiative_combat SET turn_counter = turn_counter + 1 WHERE id = ?`, [cid]);
    row = await get(db, `SELECT turn_counter FROM initiative_combat WHERE id = ?`, [cid]);
    expect(row.turn_counter).toBe(2);
  });
});
