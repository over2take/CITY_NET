// Initiative Tracker — socket event handlers
// All events namespaced under initiative:* to avoid collisions.
// Register via registerInitiativeHandlers(io, db) from sockets/index.js.

function getSceneState(db, sceneKey, cb) {
  db.get(
    `SELECT s.scene_key, s.combat_id, s.combatants, s.turn_index,
            c.turn_counter, c.pass_counter, c.system
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
    turnIndex: row.turn_index,
    turnCounter: row.turn_counter,
    passCounter: row.pass_counter,
    system: row.system || 'generic',
    ...extra,
  };
}

function broadcastScene(io, db, sceneKey, extra = {}) {
  getSceneState(db, sceneKey, (err, row) => {
    if (err || !row) return;
    io.emit('initiative:state', buildStatePayload(row, sceneKey, extra));
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

          // Collect unique location ids from non-city scene keys
          // Handles both "locId:floorIdx" and "building:locId" formats
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
              // Group floors by location and assign 0-based indices matching frontend
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
    // system: ttrpg system key (e.g. 'generic', 'shadowrun_6e')
    socket.on('initiative:start', ({ sceneKey, combatId, system }) => {
      if (!sceneKey) return;
      const safeSystem = system || 'generic';

      const insertScene = (cid) => {
        db.run(
          `INSERT OR IGNORE INTO initiative_scene (scene_key, combat_id, combatants, turn_index)
           VALUES (?, ?, '[]', 0)`,
          [sceneKey, cid],
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
          `INSERT INTO initiative_combat (turn_counter, pass_counter, system) VALUES (1, 1, ?)`,
          [safeSystem],
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
        `SELECT combatants FROM initiative_scene WHERE scene_key = ?`,
        [sceneKey],
        (err, row) => {
          if (err || !row) return;

          const list = JSON.parse(row.combatants || '[]');
          const filtered = list.filter((c) => c.id !== combatant.id);
          filtered.push({ ...combatant, insertOrder: Date.now() });
          if (!appendToEnd) {
            filtered.sort((a, b) => b.score - a.score || a.insertOrder - b.insertOrder);
          }

          db.run(
            `UPDATE initiative_scene SET combatants = ?, updated_at = CURRENT_TIMESTAMP
             WHERE scene_key = ?`,
            [JSON.stringify(filtered), sceneKey],
            (err) => {
              if (err) return;
              broadcastScene(io, db, sceneKey);

              // Log to roll history so it appears in the dice tray
              const historyString = combatant.breakdown
                ? `${combatant.name} INITIATIVE: ${combatant.breakdown}`
                : `${combatant.name} rolled INITIATIVE [${combatant.score}]`;
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
          );
        }
      );
    });

    // ── Next turn ─────────────────────────────────────────────────────────────
    socket.on('initiative:next', ({ sceneKey }) => {
      if (!sceneKey) return;

      db.get(
        `SELECT s.combatants, s.turn_index, s.combat_id, c.turn_counter, c.pass_counter, c.system
         FROM initiative_scene s
         JOIN initiative_combat c ON c.id = s.combat_id
         WHERE s.scene_key = ?`,
        [sceneKey],
        (err, row) => {
          if (err || !row) return;

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

          // ── End of rotation ───────────────────────────────────────────────
          if (row.system === 'shadowrun_6e') {
            // SR6: subtract 10 from all scores; drop anyone at ≤ 0
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
          } else if (row.system === 'cyberpunk_red') {
            // CP:R: everyone rerolls each round — clear the list and signal newRound
            db.run(
              `UPDATE initiative_scene SET combatants = '[]', turn_index = 0, updated_at = CURRENT_TIMESTAMP WHERE scene_key = ?`,
              [sceneKey],
              (err) => {
                if (err) return;
                db.run(
                  `UPDATE initiative_combat SET turn_counter = turn_counter + 1 WHERE id = ?`,
                  [row.combat_id],
                  () => broadcastScene(io, db, sceneKey, { newRound: true })
                );
              }
            );
          } else {
            // Generic / other systems: just bump the turn counter
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
        `SELECT combatants, turn_index FROM initiative_scene WHERE scene_key = ?`,
        [sceneKey],
        (err, row) => {
          if (err || !row) return;

          const list = JSON.parse(row.combatants || '[]');
          const removedIdx = list.findIndex((c) => c.id === combatantId);
          const filtered = list.filter((c) => c.id !== combatantId);

          // Keep turn_index valid after removal
          let newTurnIndex = row.turn_index;
          if (removedIdx < row.turn_index) newTurnIndex = Math.max(0, row.turn_index - 1);
          if (newTurnIndex >= filtered.length) newTurnIndex = 0;

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
    // fromIndex / toIndex are positions in the sorted list
    socket.on('initiative:reorder', ({ sceneKey, fromIndex, toIndex }) => {
      if (!sceneKey) return;

      db.get(
        `SELECT combatants, turn_index FROM initiative_scene WHERE scene_key = ?`,
        [sceneKey],
        (err, row) => {
          if (err || !row) return;

          const list = JSON.parse(row.combatants || '[]');
          if (fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex >= list.length) return;

          // Capture active combatant id BEFORE mutating the list
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
            (err) => {
              if (err) return;
              broadcastScene(io, db, sceneKey);
            }
          );
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

            // Clean up orphaned combat row if no scenes remain
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

module.exports = { registerInitiativeHandlers };
