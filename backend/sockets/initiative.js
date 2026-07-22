// Initiative Tracker — socket event handlers
// All events namespaced under initiative:* to avoid collisions.
// Register via registerInitiativeHandlers(io, db) from sockets/index.js.

function getSceneState(db, sceneKey, cb) {
  db.get(
    `SELECT s.scene_key, s.combat_id, s.combatants, s.turn_index,
            c.turn_counter, c.pass_counter
     FROM initiative_scene s
     JOIN initiative_combat c ON c.id = s.combat_id
     WHERE s.scene_key = ?`,
    [sceneKey],
    cb
  );
}

function broadcastScene(io, db, sceneKey) {
  getSceneState(db, sceneKey, (err, row) => {
    if (err || !row) return;
    io.emit('initiative:state', {
      sceneKey,
      combatId: row.combat_id,
      combatants: JSON.parse(row.combatants || '[]'),
      turnIndex: row.turn_index,
      turnCounter: row.turn_counter,
      passCounter: row.pass_counter,
    });
  });
}

function registerInitiativeHandlers(io, db) {
  io.on('connection', (socket) => {

    // ── Join scene: send current state if initiative is active ─────────────────
    socket.on('initiative:join', ({ sceneKey }) => {
      if (!sceneKey) return;
      getSceneState(db, sceneKey, (err, row) => {
        if (err || !row) return;
        socket.emit('initiative:state', {
          sceneKey,
          combatId: row.combat_id,
          combatants: JSON.parse(row.combatants || '[]'),
          turnIndex: row.turn_index,
          turnCounter: row.turn_counter,
          passCounter: row.pass_counter,
        });
      });
    });

    // ── List active combats (for the "join existing" prompt) ──────────────────
    socket.on('initiative:list_combats', () => {
      db.all(
        `SELECT c.id, c.turn_counter, c.pass_counter,
                GROUP_CONCAT(s.scene_key) as scenes
         FROM initiative_combat c
         LEFT JOIN initiative_scene s ON s.combat_id = c.id
         GROUP BY c.id`,
        [],
        (err, rows) => {
          if (err) return;
          socket.emit('initiative:combats', rows || []);
        }
      );
    });

    // ── Start initiative ───────────────────────────────────────────────────────
    // combatId: null = new combat, number = join existing
    socket.on('initiative:start', ({ sceneKey, combatId }) => {
      if (!sceneKey) return;

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
          `INSERT INTO initiative_combat (turn_counter, pass_counter) VALUES (1, 1)`,
          [],
          function (err) {
            if (err) return;
            insertScene(this.lastID);
          }
        );
      }
    });

    // ── Submit roll ───────────────────────────────────────────────────────────
    // { sceneKey, combatant: { id, name, portraitUrl, score, isNpc } }
    socket.on('initiative:roll', ({ sceneKey, combatant }) => {
      if (!sceneKey || !combatant) return;

      db.get(
        `SELECT combatants FROM initiative_scene WHERE scene_key = ?`,
        [sceneKey],
        (err, row) => {
          if (err || !row) return;

          const list = JSON.parse(row.combatants || '[]');
          // Remove any existing entry for this combatant then re-insert sorted
          const filtered = list.filter((c) => c.id !== combatant.id);
          filtered.push({ ...combatant, insertOrder: Date.now() });
          filtered.sort((a, b) => b.score - a.score || a.insertOrder - b.insertOrder);

          db.run(
            `UPDATE initiative_scene SET combatants = ?, updated_at = CURRENT_TIMESTAMP
             WHERE scene_key = ?`,
            [JSON.stringify(filtered), sceneKey],
            (err) => {
              if (err) return;
              broadcastScene(io, db, sceneKey);
            }
          );
        }
      );
    });

    // ── Next turn ─────────────────────────────────────────────────────────────
    socket.on('initiative:next', ({ sceneKey }) => {
      if (!sceneKey) return;

      db.get(
        `SELECT s.combatants, s.turn_index, s.combat_id, c.turn_counter
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
          const newTurnCounter = wrapped ? row.turn_counter + 1 : row.turn_counter;

          db.run(
            `UPDATE initiative_scene SET turn_index = ?, updated_at = CURRENT_TIMESTAMP
             WHERE scene_key = ?`,
            [newTurnIndex, sceneKey],
            (err) => {
              if (err) return;
              if (wrapped) {
                db.run(
                  `UPDATE initiative_combat SET turn_counter = ? WHERE id = ?`,
                  [newTurnCounter, row.combat_id],
                  () => broadcastScene(io, db, sceneKey)
                );
              } else {
                broadcastScene(io, db, sceneKey);
              }
            }
          );
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
