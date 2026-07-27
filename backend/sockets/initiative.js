const { cryptoRng } = require('../utils/random');

// Initiative Tracker — socket event handlers
// All events namespaced under initiative:* to avoid collisions.
// Register via registerInitiativeHandlers(io, db) from sockets/index.js.

function getSceneState(db, sceneKey, cb) {
  db.get(
    `SELECT s.scene_key, s.combat_id, s.combatants, s.sides, s.turn_index,
            c.turn_counter, c.pass_counter, c.system, c.mode
     FROM initiative_scene s
     JOIN initiative_combat c ON c.id = s.combat_id
     WHERE s.scene_key = ?`,
    [sceneKey],
    cb
  );
}

function buildStatePayload(row, sceneKey, extra = {}) {
  return {
    sceneKey,
    combatId: row.combat_id,
    combatants: JSON.parse(row.combatants || '[]'),
    sides: JSON.parse(row.sides || '[]'),
    turnIndex: row.turn_index,
    turnCounter: row.turn_counter,
    passCounter: row.pass_counter,
    system: row.system || 'generic',
    mode: row.mode || 'individual',
    ...extra,
  };
}

function broadcastScene(io, db, sceneKey, extra = {}) {
  getSceneState(db, sceneKey, (err, row) => {
    if (err || !row) return;
    io.emit('initiative:state', buildStatePayload(row, sceneKey, extra));
  });
}

// ── Side-mode helpers ─────────────────────────────────────────────────────────

/** Derive the PC side score from the highest non-admin PC roll in combatants. */
function calcPcSideScore(combatants) {
  const pcRolls = combatants.filter((c) => !c.isNpc);
  if (pcRolls.length === 0) return 0;
  return Math.max(...pcRolls.map((c) => c.score));
}

/** Sort sides highest score first; PC side wins ties. */
function sortSides(sides) {
  return [...sides].sort((a, b) => {
    const diff = b.score - a.score;
    if (diff !== 0) return diff;
    return a.isPlayerSide ? -1 : 1;
  });
}

function registerInitiativeHandlers(io, db) {
  io.on('connection', (socket) => {

    // ── Join scene: send current state if initiative is active ─────────────────
    socket.on('initiative:join', ({ sceneKey }) => {
      if (!sceneKey) return;
      getSceneState(db, sceneKey, (err, row) => {
        if (err || !row) return;
        socket.emit('initiative:state', buildStatePayload(row, sceneKey));
      });
    });

    // ── List active combats (for the "join existing" prompt) ──────────────────
    socket.on('initiative:list_combats', () => {
      db.all(`SELECT c.id, c.turn_counter FROM initiative_combat c`, [], (err, combats) => {
        if (err) return;
        if (!combats || combats.length === 0) { socket.emit('initiative:combats', []); return; }

        db.all(`SELECT combat_id, scene_key FROM initiative_scene`, [], (err2, scenes) => {
          if (err2) return;

          const allKeys = (scenes || []).map((s) => s.scene_key);
          const buildingKeys = allKeys.filter((sk) => sk.startsWith('building:'));
          const floorKeys = allKeys.filter((sk) => sk !== 'city:0' && !sk.startsWith('building:'));
          const locationIds = [...new Set([
            ...floorKeys.map((sk) => parseInt(sk.split(':')[0], 10)),
            ...buildingKeys.map((sk) => parseInt(sk.split(':')[1], 10)),
          ].filter(Boolean))];

          const buildResult = (labelMap) => {
            const scenesByCombat = {};
            (scenes || []).forEach((s) => {
              if (!scenesByCombat[s.combat_id]) scenesByCombat[s.combat_id] = [];
              scenesByCombat[s.combat_id].push(s.scene_key);
            });
            return combats.map((c) => ({
              ...c,
              scene_keys: scenesByCombat[c.id] || [],
              scene_labels: Object.fromEntries(
                (scenesByCombat[c.id] || []).map((sk) => [sk, labelMap[sk] || sk])
              ),
            }));
          };

          if (locationIds.length === 0) {
            socket.emit('initiative:combats', buildResult({ 'city:0': 'CITY MAP' }));
            return;
          }

          const placeholders = locationIds.map(() => '?').join(',');
          db.all(
            `SELECT bm.location_id, bm.designation, bm.order_index, l.name AS loc_name
             FROM battle_maps bm
             JOIN locations l ON l.id = bm.location_id
             WHERE bm.location_id IN (${placeholders})
             ORDER BY bm.location_id, bm.order_index`,
            locationIds,
            (err3, floors) => {
              const labelMap = { 'city:0': 'CITY MAP' };
              const byLoc = {};
              (floors || []).forEach((f) => {
                if (!byLoc[f.location_id]) byLoc[f.location_id] = [];
                byLoc[f.location_id].push(f);
              });
              Object.entries(byLoc).forEach(([locId, locFloors]) => {
                const locName = (locFloors[0].loc_name || 'UNKNOWN').toUpperCase();
                labelMap[`building:${locId}`] = locName;
                locFloors.forEach((f, idx) => {
                  labelMap[`${locId}:${idx}`] = `${locName} — ${f.designation.toUpperCase()}`;
                });
              });
              socket.emit('initiative:combats', buildResult(labelMap));
            }
          );
        });
      });
    });

    // ── Start initiative ───────────────────────────────────────────────────────
    // combatId: null = new combat, number = join existing
    // system: ttrpg system key; mode: 'individual' | 'side'
    socket.on('initiative:start', ({ sceneKey, combatId, system, mode }) => {
      if (!sceneKey) return;
      const safeSystem = system || 'generic';
      const safeMode = mode || 'individual';

      // Initial sides for side mode: PC side only; NPC side added when GM rolls
      const initialSides = safeMode === 'side'
        ? JSON.stringify([{ id: 'pc', name: 'PLAYERS', score: 0, isPlayerSide: true }])
        : '[]';

      const insertScene = (cid) => {
        db.run(
          `INSERT OR IGNORE INTO initiative_scene (scene_key, combat_id, combatants, sides, turn_index)
           VALUES (?, ?, '[]', ?, 0)`,
          [sceneKey, cid, initialSides],
          (err) => {
            if (err) return;
            io.emit('initiative:started', { sceneKey, combatId: cid });
            broadcastScene(io, db, sceneKey);
          }
        );
      };

      if (combatId) {
        insertScene(combatId);
      } else {
        db.run(
          `INSERT INTO initiative_combat (turn_counter, pass_counter, system, mode) VALUES (1, 1, ?, ?)`,
          [safeSystem, safeMode],
          function (err) {
            if (err) return;
            insertScene(this.lastID);
          }
        );
      }
    });

    // ── Submit roll ───────────────────────────────────────────────────────────
    // { sceneKey, combatant: { id, name, portraitUrl, score, isNpc }, appendToEnd? }
    // appendToEnd=true: insert at bottom without re-sorting (late-join flow)
    socket.on('initiative:roll', ({ sceneKey, combatant, appendToEnd }) => {
      if (!sceneKey || !combatant) return;

      db.get(
        `SELECT s.combatants, s.sides, c.system, c.mode
         FROM initiative_scene s
         JOIN initiative_combat c ON c.id = s.combat_id
         WHERE s.scene_key = ?`,
        [sceneKey],
        (err, row) => {
          if (err || !row) return;

          const system = row.system || 'generic';
          const mode = row.mode || 'individual';
          const list = JSON.parse(row.combatants || '[]');
          const filtered = list.filter((c) => c.id !== combatant.id);

          if (mode === 'side') {
            // Slot into the correct side; PCs go to 'pc', NPCs go to 'npc'
            const sideId = (combatant.isNpc && !combatant.isFriendly) ? 'npc' : 'pc';
            filtered.push({ ...combatant, sideId, insertOrder: Date.now() });

            // Sort within each side by score desc, then insertOrder
            filtered.sort((a, b) => {
              if (a.sideId !== b.sideId) return 0;
              return b.score - a.score || a.insertOrder - b.insertOrder;
            });

            let sides = JSON.parse(row.sides || '[]');

            if (combatant.isNpc && !combatant.isFriendly) {
              // Auto-create NPC side on first enemy NPC roll, with its own 1d8
              if (!sides.some((s) => s.id === 'npc')) {
                const roll = Math.floor(cryptoRng() * 8) + 1;
                sides = [...sides, { id: 'npc', name: 'NPC', score: roll, isPlayerSide: false }];
              }
            } else {
              // Update PC side score from best PC roll
              const pcSideScore = calcPcSideScore(filtered.filter((c) => !c.isNpc));
              sides = sides.map((s) => s.id === 'pc' ? { ...s, score: pcSideScore } : s);
            }

            const updatedSides = sides;

            db.run(
              `UPDATE initiative_scene SET combatants = ?, sides = ?, updated_at = CURRENT_TIMESTAMP
               WHERE scene_key = ?`,
              [JSON.stringify(filtered), JSON.stringify(updatedSides), sceneKey],
              (err) => {
                if (err) return;
                broadcastScene(io, db, sceneKey);
                logRoll(io, db, combatant);
              }
            );
          } else {
            // ── Individual mode (existing behaviour) ──────────────────────────
            filtered.push({ ...combatant, insertOrder: Date.now() });
            if (!appendToEnd) {
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
            }

            db.run(
              `UPDATE initiative_scene SET combatants = ?, updated_at = CURRENT_TIMESTAMP
               WHERE scene_key = ?`,
              [JSON.stringify(filtered), sceneKey],
              (err) => {
                if (err) return;
                broadcastScene(io, db, sceneKey);
                logRoll(io, db, combatant);
              }
            );
          }
        }
      );
    });

    // ── Roll NPC side (side mode only) ────────────────────────────────────────
    // { sceneKey, score, breakdown, diceResults }
    socket.on('initiative:roll_side', ({ sceneKey, score, breakdown, diceResults }) => {
      if (!sceneKey || score === undefined) return;

      db.get(
        `SELECT s.sides, s.combatants FROM initiative_scene s WHERE s.scene_key = ?`,
        [sceneKey],
        (err, row) => {
          if (err || !row) return;

          const sides = JSON.parse(row.sides || '[]');
          const npcExists = sides.some((s) => s.id === 'npc');
          const updatedSides = npcExists
            ? sides.map((s) => s.id === 'npc' ? { ...s, score } : s)
            : [...sides, { id: 'npc', name: 'NPC', score, isPlayerSide: false }];

          db.run(
            `UPDATE initiative_scene SET sides = ?, updated_at = CURRENT_TIMESTAMP WHERE scene_key = ?`,
            [JSON.stringify(updatedSides), sceneKey],
            (err) => {
              if (err) return;
              broadcastScene(io, db, sceneKey);
              // Log to dice tray
              const historyString = breakdown
                ? `NPC SIDE INITIATIVE: ${breakdown}`
                : `NPC SIDE rolled INITIATIVE [${score}]`;
              const results = diceResults || { 8: [score] };
              db.run(
                `INSERT INTO dice_rolls (username, total, results, color, historyString) VALUES (?, ?, ?, ?, ?)`,
                ['NPC SIDE', score, JSON.stringify(results), '#00ff00', historyString],
                () => io.emit('diceRollBroadcast', {
                  userName: 'NPC SIDE', account: 'NPC SIDE',
                  results, modifiers: [], color: '#00ff00',
                  total: score, historyString,
                })
              );
            }
          );
        }
      );
    });

    // ── Next turn ─────────────────────────────────────────────────────────────
    socket.on('initiative:next', ({ sceneKey }) => {
      if (!sceneKey) return;

      db.get(
        `SELECT s.combatants, s.sides, s.turn_index, s.combat_id, c.turn_counter, c.pass_counter, c.system, c.mode
         FROM initiative_scene s
         JOIN initiative_combat c ON c.id = s.combat_id
         WHERE s.scene_key = ?`,
        [sceneKey],
        (err, row) => {
          if (err || !row) return;

          const mode = row.mode || 'individual';

          if (mode === 'side') {
            const sides = sortSides(JSON.parse(row.sides || '[]'));
            if (sides.length === 0) return;

            const nextIndex = row.turn_index + 1;
            const wrapped = nextIndex >= sides.length;
            const newTurnIndex = wrapped ? 0 : nextIndex;

            db.run(
              `UPDATE initiative_scene SET turn_index = ?, updated_at = CURRENT_TIMESTAMP WHERE scene_key = ?`,
              [newTurnIndex, sceneKey],
              (err) => {
                if (err) return;
                if (wrapped) {
                  db.run(
                    `UPDATE initiative_combat SET turn_counter = turn_counter + 1 WHERE id = ?`,
                    [row.combat_id],
                    () => broadcastScene(io, db, sceneKey)
                  );
                } else {
                  broadcastScene(io, db, sceneKey);
                }
              }
            );
            return;
          }

          // ── Individual mode (existing behaviour) ──────────────────────────
          const combatants = JSON.parse(row.combatants || '[]');
          if (combatants.length === 0) return;

          const nextIndex = row.turn_index + 1;
          const wrapped = nextIndex >= combatants.length;
          const newTurnIndex = wrapped ? 0 : nextIndex;

          if (!wrapped) {
            db.run(
              `UPDATE initiative_scene SET turn_index = ?, updated_at = CURRENT_TIMESTAMP WHERE scene_key = ?`,
              [newTurnIndex, sceneKey],
              (err) => { if (!err) broadcastScene(io, db, sceneKey); }
            );
            return;
          }

          // End of rotation
          if (row.system === 'shadowrun_6e') {
            const decayed = combatants.map((c) => ({ ...c, score: c.score - 10 }));
            const survivors = decayed.filter((c) => c.score > 0);
            const newRound = survivors.length === 0;
            const nextCombatants = newRound ? [] : survivors;

            db.run(
              `UPDATE initiative_scene SET combatants = ?, turn_index = 0, updated_at = CURRENT_TIMESTAMP WHERE scene_key = ?`,
              [JSON.stringify(nextCombatants), sceneKey],
              (err) => {
                if (err) return;
                db.run(
                  `UPDATE initiative_combat SET pass_counter = pass_counter + 1 WHERE id = ?`,
                  [row.combat_id],
                  () => broadcastScene(io, db, sceneKey, { newRound })
                );
              }
            );
          } else {
            db.run(
              `UPDATE initiative_scene SET turn_index = 0, updated_at = CURRENT_TIMESTAMP WHERE scene_key = ?`,
              [sceneKey],
              (err) => {
                if (err) return;
                db.run(
                  `UPDATE initiative_combat SET turn_counter = turn_counter + 1 WHERE id = ?`,
                  [row.combat_id],
                  () => broadcastScene(io, db, sceneKey)
                );
              }
            );
          }
        }
      );
    });

    // ── Remove a combatant ────────────────────────────────────────────────────
    socket.on('initiative:remove', ({ sceneKey, combatantId }) => {
      if (!sceneKey) return;

      db.get(
        `SELECT s.combatants, s.turn_index, c.mode FROM initiative_scene s
         JOIN initiative_combat c ON c.id = s.combat_id WHERE s.scene_key = ?`,
        [sceneKey],
        (err, row) => {
          if (err || !row) return;

          const list = JSON.parse(row.combatants || '[]');
          const removedIdx = list.findIndex((c) => c.id === combatantId);
          const filtered = list.filter((c) => c.id !== combatantId);

          let newTurnIndex = row.turn_index;
          if (row.mode !== 'side') {
            if (removedIdx < row.turn_index) newTurnIndex = Math.max(0, row.turn_index - 1);
            if (newTurnIndex >= filtered.length) newTurnIndex = 0;
          }

          db.run(
            `UPDATE initiative_scene SET combatants = ?, turn_index = ?, updated_at = CURRENT_TIMESTAMP
             WHERE scene_key = ?`,
            [JSON.stringify(filtered), newTurnIndex, sceneKey],
            (err) => {
              if (err) return;
              broadcastScene(io, db, sceneKey);
            }
          );
        }
      );
    });

    // ── Reorder (drag) ────────────────────────────────────────────────────────
    // Individual mode: fromIndex/toIndex are global positions in the combatants list
    // Side mode: fromIndex/toIndex are positions within a side (sideId provided)
    socket.on('initiative:reorder', ({ sceneKey, fromIndex, toIndex, sideId }) => {
      if (!sceneKey) return;

      db.get(
        `SELECT s.combatants, s.turn_index, c.mode FROM initiative_scene s
         JOIN initiative_combat c ON c.id = s.combat_id WHERE s.scene_key = ?`,
        [sceneKey],
        (err, row) => {
          if (err || !row) return;

          const list = JSON.parse(row.combatants || '[]');

          if (row.mode === 'side' && sideId) {
            // Reorder within the side only
            const sideMembers = list.filter((c) => c.sideId === sideId);
            const others = list.filter((c) => c.sideId !== sideId);

            if (fromIndex < 0 || toIndex < 0 || fromIndex >= sideMembers.length || toIndex >= sideMembers.length) return;
            const [moved] = sideMembers.splice(fromIndex, 1);
            sideMembers.splice(toIndex, 0, moved);

            const newList = [...others, ...sideMembers];
            db.run(
              `UPDATE initiative_scene SET combatants = ?, updated_at = CURRENT_TIMESTAMP WHERE scene_key = ?`,
              [JSON.stringify(newList), sceneKey],
              (err) => { if (!err) broadcastScene(io, db, sceneKey); }
            );
          } else {
            // Individual mode: global reorder
            if (fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex >= list.length) return;

            const activeId = list[row.turn_index]?.id;
            const [moved] = list.splice(fromIndex, 1);
            list.splice(toIndex, 0, moved);

            let newTurnIndex = row.turn_index;
            const recalc = list.findIndex((c) => c.id === activeId);
            if (recalc >= 0) newTurnIndex = recalc;

            db.run(
              `UPDATE initiative_scene SET combatants = ?, turn_index = ?, updated_at = CURRENT_TIMESTAMP
               WHERE scene_key = ?`,
              [JSON.stringify(list), newTurnIndex, sceneKey],
              (err) => { if (!err) broadcastScene(io, db, sceneKey); }
            );
          }
        }
      );
    });

    // ── End initiative for a scene ────────────────────────────────────────────
    socket.on('initiative:end', ({ sceneKey }) => {
      if (!sceneKey) return;

      db.get(
        `SELECT combat_id FROM initiative_scene WHERE scene_key = ?`,
        [sceneKey],
        (err, row) => {
          if (err || !row) return;
          const combatId = row.combat_id;

          db.run(`DELETE FROM initiative_scene WHERE scene_key = ?`, [sceneKey], () => {
            io.emit('initiative:ended', { sceneKey });

            db.get(
              `SELECT COUNT(*) as cnt FROM initiative_scene WHERE combat_id = ?`,
              [combatId],
              (err, r) => {
                if (!err && r && r.cnt === 0) {
                  db.run(`DELETE FROM initiative_combat WHERE id = ?`, [combatId]);
                }
              }
            );
          });
        }
      );
    });

  });
}

// ── Shared helper: log a roll to dice tray ────────────────────────────────────
function logRoll(io, db, combatant) {
  const explodSuffix = combatant.exploded ? ' 💥EXPLOD' : '';
  const historyString = combatant.breakdown
    ? `${combatant.name} INITIATIVE: ${combatant.breakdown}${explodSuffix}`
    : `${combatant.name} rolled INITIATIVE [${combatant.score}]${explodSuffix}`;
  const results = combatant.diceResults || { 20: [combatant.score] };
  const resultsJson = JSON.stringify(results);
  db.run(
    `INSERT INTO dice_rolls (username, total, results, color, historyString) VALUES (?, ?, ?, ?, ?)`,
    [combatant.name, combatant.score, resultsJson, '#00ff00', historyString],
    () => io.emit('diceRollBroadcast', {
      userName: combatant.name,
      account: combatant.name,
      results,
      modifiers: [],
      color: '#00ff00',
      total: combatant.score,
      historyString,
    })
  );
}

module.exports = { registerInitiativeHandlers };
