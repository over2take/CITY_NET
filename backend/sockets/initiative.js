const { sceneQueue } = require('./sceneQueue');
const { placeOf, keepDrag, atBottom, lowered } = require('./initiativeOrder');
const { cryptoRng } = require('../utils/random');
const { withThrow, boardOf } = require('../utils/diceThrow');
const customSystems = require('../systemBuilder/runtime');
const { tickCombat, combatTokens } = require('../tokens/conditions');
const { syncConditionsOnSheet } = require('../sheets/conditionsOnSheet');
const { momentsOfNext, momentsOfBegin, fireTurnMoments, dropAsks } = require('../tokens/turnEffects');

/** A custom system's own word for initiative in the dice log; today's text for the rest. */
const initiativeWord = (system) => customSystems.wordIn(system, 'initiative', 'singular', 'INITIATIVE').toUpperCase();
/** Whether a system has initiative at all: a custom system can turn it off (systemBuilder/parts.js). */
const initiativeOn = (system) => customSystems.partIn(system || 'generic', 'initiative');

// Initiative Tracker — socket event handlers
// All events namespaced under initiative:* to avoid collisions.
// Register via registerInitiativeHandlers(io, db) from sockets/index.js.

function getSceneState(db, sceneKey, cb) {
  db.get(
    `SELECT s.scene_key, s.combat_id, s.combatants, s.sides, s.turn_index,
            s.turn_counter, s.pass_counter, s.begun, c.system, c.mode
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
    // Round 1 begun with BEGIN (8a9a), or by a NEXT; until then the tracker offers BEGIN.
    begun: !!row.begun,
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

function registerInitiativeHandlers(io, db, { emitUpdate = () => {} } = {}) {
  /**
   * A new round: conditions with rounds left on the combat's tokens lose one, and those at none
   * come off (tokens/conditions.js, 4e2a2). Every screen redraws the map when any token changed.
   */
  const newRound = (combatants, then = () => {}) => tickCombat(db, combatants, (err, { tokens }) => {
    if (err) console.error('[initiative] Could not count conditions down:', err.message);
    if (tokens) {
      emitUpdate();
      // A condition APPLIED that ran out takes its change off the player's numbers (8a5e1).
      for (const username of combatTokens(combatants).players) syncConditionsOnSheet(db, { username, io, runtime: require('../systemBuilder/runtime') });
    }
    then();
  });

  // One scene's changes one after another, so rolls landing together aren't lost (sceneQueue.js).
  const { inTurn } = sceneQueue();

  /**
   * A condition's EACH TURN (8a9a, tokens/turnEffects.js): `moments` fired on the running game's tokens. Those up to END OF
   * ROUND first; the rounds count down (`round`, a new round's combatants) between; then START OF ROUND and the next turn.
   */
  const fire = (sceneKey, moments, round = null) => {
    const before = moments.filter((m) => m.when === 'turn_end' || m.when === 'round_end');
    const after = moments.filter((m) => m.when === 'round_start' || m.when === 'turn_start');
    db.get(`SELECT value FROM global_settings WHERE key = 'game_system'`, (gErr, gRow) => {
      const system = !gErr && gRow ? gRow.value : null;
      const go = (list) => fireTurnMoments(db, { io, emitUpdate, runtime: customSystems, system, sceneKey, moments: list })
        .catch((e) => console.error('[initiative] Condition turn effects:', e.message));
      go(before).then(() => (round ? new Promise((done) => newRound(round, done)) : null)).then(() => go(after));
    });
  };

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
      db.all(`SELECT c.id, c.system FROM initiative_combat c`, [], (err, combats) => {
        if (err) return;

        db.all(`SELECT combat_id, scene_key, turn_counter, pass_counter FROM initiative_scene`, [], (err2, scenes) => {
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
            // Each scene's own count (8a8): its ROUND, or Shadowrun's PASS as its tracker shows it.
            const counted = Object.fromEntries((scenes || []).map((s) => [s.scene_key, s]));
            return combats.map(({ system, ...c }) => ({
              ...c,
              scene_keys: scenesByCombat[c.id] || [],
              scene_counters: Object.fromEntries((scenesByCombat[c.id] || []).map((sk) => [sk, system === 'shadowrun_6e' ? counted[sk].pass_counter : counted[sk].turn_counter])),
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
      // Asked of the game the server is running, not the system the message names: a game with
      // initiative turned off starts no tracker. One already running can still be ended.
      db.get(`SELECT value FROM global_settings WHERE key = 'game_system'`, (gErr, gRow) => {
        if (gErr || !initiativeOn(gRow && gRow.value)) return;
        start({ sceneKey, combatId, system, mode });
      });
    });

    const start = ({ sceneKey, combatId, system, mode }) => {
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

      // A scene already running stays as it is, and is told again: START pressed twice (two GM screens, a double click)
      // had made a second combat that no scene was ever in, listed under JOIN for good (found by 8i1's tests).
      db.get(`SELECT combat_id FROM initiative_scene WHERE scene_key = ?`, [sceneKey], (gErr, running) => {
        if (gErr) return;
        if (running) { broadcastScene(io, db, sceneKey); return; }
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
    };

    // ── Submit roll ───────────────────────────────────────────────────────────
    // { sceneKey, combatant: { id, name, portraitUrl, score, isNpc }, appendToEnd? }
    // appendToEnd=true: insert at bottom without re-sorting (late-join flow)
    socket.on('initiative:roll', ({ sceneKey, combatant, appendToEnd }) => {
      if (!sceneKey || !combatant) return;

      inTurn(sceneKey, (done) => db.get(
        `SELECT s.combatants, s.sides, c.system, c.mode
         FROM initiative_scene s
         JOIN initiative_combat c ON c.id = s.combat_id
         WHERE s.scene_key = ?`,
        [sceneKey],
        (err, row) => {
          // No rolls into a combat whose system has initiative turned off.
          if (err || !row || !initiativeOn(row.system)) return done();

          const system = row.system || 'generic';
          const mode = row.mode || 'individual';
          const list = JSON.parse(row.combatants || '[]');
          const filtered = list.filter((c) => c.id !== combatant.id);
          // A roll, or a re-roll, is a new place: a place a drag gave the old one goes with it (initiativeOrder.js).
          const { place: _oldPlace, ...rolled } = combatant;

          if (mode === 'side') {
            // Slot into the correct side; PCs go to 'pc', NPCs go to 'npc'
            const sideId = (combatant.isNpc && !combatant.isFriendly) ? 'npc' : 'pc';
            filtered.push({ ...rolled, sideId, insertOrder: Date.now() });

            // Sort within each side by score desc, then insertOrder
            filtered.sort((a, b) => {
              if (a.sideId !== b.sideId) return 0;
              return placeOf(b) - placeOf(a) || a.insertOrder - b.insertOrder;
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
              const pcSideScore = calcPcSideScore(filtered);
              sides = sides.map((s) => s.id === 'pc' ? { ...s, score: pcSideScore } : s);
            }

            const updatedSides = sides;

            db.run(
              `UPDATE initiative_scene SET combatants = ?, sides = ?, updated_at = CURRENT_TIMESTAMP
               WHERE scene_key = ?`,
              [JSON.stringify(filtered), JSON.stringify(updatedSides), sceneKey],
              (err) => {
                done();
                if (err) return;
                broadcastScene(io, db, sceneKey);
                logRoll(io, db, combatant, system);
              }
            );
          } else {
            // ── Individual mode (existing behaviour) ──────────────────────────
            // Joining late: the bottom, and kept there when later rolls are sorted in.
            const joined = { ...rolled, insertOrder: Date.now() };
            filtered.push(appendToEnd ? atBottom(filtered, joined) : joined);
            if (!appendToEnd) {
              filtered.sort((a, b) => {
                const scoreDiff = placeOf(b) - placeOf(a);
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
                done();
                if (err) return;
                broadcastScene(io, db, sceneKey);
                logRoll(io, db, combatant, system);
              }
            );
          }
        }
      ));
    });

    // ── Roll NPC side (side mode only) ────────────────────────────────────────
    // { sceneKey, score, breakdown, diceResults }
    socket.on('initiative:roll_side', ({ sceneKey, score, breakdown, diceResults }) => {
      if (!sceneKey || score === undefined) return;

      inTurn(sceneKey, (done) => db.get(
        `SELECT s.sides, s.combatants, c.system FROM initiative_scene s
         LEFT JOIN initiative_combat c ON c.id = s.combat_id WHERE s.scene_key = ?`,
        [sceneKey],
        (err, row) => {
          if (err || !row || !initiativeOn(row.system)) return done();

          const sides = JSON.parse(row.sides || '[]');
          const npcExists = sides.some((s) => s.id === 'npc');
          const updatedSides = npcExists
            ? sides.map((s) => s.id === 'npc' ? { ...s, score } : s)
            : [...sides, { id: 'npc', name: 'NPC', score, isPlayerSide: false }];

          db.run(
            `UPDATE initiative_scene SET sides = ?, updated_at = CURRENT_TIMESTAMP WHERE scene_key = ?`,
            [JSON.stringify(updatedSides), sceneKey],
            (err) => {
              done();
              if (err) return;
              broadcastScene(io, db, sceneKey);
              // Log to dice tray
              const historyString = breakdown
                ? `NPC SIDE ${initiativeWord(row.system)}: ${breakdown}`
                : `NPC SIDE rolled ${initiativeWord(row.system)} [${score}]`;
              const results = diceResults || { 8: [score] };
              db.run(
                `INSERT INTO dice_rolls (username, total, results, color, historyString) VALUES (?, ?, ?, ?, ?)`,
                ['NPC SIDE', score, JSON.stringify(results), '#00ff00', historyString],
                () => io.emit('diceRollBroadcast', withThrow({
                  userName: 'NPC SIDE', account: 'NPC SIDE',
                  results, modifiers: [], color: '#00ff00',
                  total: score, historyString,
                  board: boardOf(initiativeWord(row.system)),
                }))
              );
            }
          );
        }
      ));
    });

    // ── Next turn ─────────────────────────────────────────────────────────────
    socket.on('initiative:next', ({ sceneKey }) => {
      if (!sceneKey) return;

      inTurn(sceneKey, (done) => db.get(
        `SELECT s.combatants, s.sides, s.turn_index, s.combat_id, s.turn_counter, s.pass_counter, c.system, c.mode
         FROM initiative_scene s
         JOIN initiative_combat c ON c.id = s.combat_id
         WHERE s.scene_key = ?`,
        [sceneKey],
        (err, row) => {
          if (err || !row) return done();

          const mode = row.mode || 'individual';

          if (mode === 'side') {
            const sides = sortSides(JSON.parse(row.sides || '[]'));
            if (sides.length === 0) return done();

            const nextIndex = row.turn_index + 1;
            const wrapped = nextIndex >= sides.length;
            const newTurnIndex = wrapped ? 0 : nextIndex;

            const sideCombatants = JSON.parse(row.combatants || '[]');
            db.run(
              `UPDATE initiative_scene SET turn_index = ?, begun = 1, updated_at = CURRENT_TIMESTAMP WHERE scene_key = ?`,
              [newTurnIndex, sceneKey],
              (err) => {
                if (err) return done();
                // Its side's turn ending, the next's beginning, and the round's where it came round (8a9a).
                fire(sceneKey, momentsOfNext({ mode: 'side', before: sideCombatants, sides, from: row.turn_index, to: newTurnIndex, wrapped }), wrapped ? sideCombatants : null);
                if (wrapped) {
                  db.run(
                    `UPDATE initiative_scene SET turn_counter = turn_counter + 1 WHERE scene_key = ?`,
                    [sceneKey],
                    () => { done(); broadcastScene(io, db, sceneKey); }
                  );
                } else {
                  done();
                  broadcastScene(io, db, sceneKey);
                }
              }
            );
            return;
          }

          // ── Individual mode (existing behaviour) ──────────────────────────
          const combatants = JSON.parse(row.combatants || '[]');
          if (combatants.length === 0) return done();

          const nextIndex = row.turn_index + 1;
          const wrapped = nextIndex >= combatants.length;
          const newTurnIndex = wrapped ? 0 : nextIndex;

          if (!wrapped) {
            db.run(
              `UPDATE initiative_scene SET turn_index = ?, begun = 1, updated_at = CURRENT_TIMESTAMP WHERE scene_key = ?`,
              [newTurnIndex, sceneKey],
              (err) => {
                done();
                if (err) return;
                fire(sceneKey, momentsOfNext({ before: combatants, from: row.turn_index, to: newTurnIndex, wrapped: false }));
                broadcastScene(io, db, sceneKey);
              }
            );
            return;
          }

          // End of rotation
          if (row.system === 'shadowrun_6e') {
            const decayed = combatants.map((c) => lowered(c, 10));
            const survivors = decayed.filter((c) => c.score > 0);
            const startsRound = survivors.length === 0;
            // Every pass spent, no one survives: the order empties for everyone to roll again.
            const nextCombatants = survivors;
            // Shadowrun's round ends when every pass is spent, not when a pass ends (8a9a: a pass's turns are turns). Then
            // everyone rolls again, so the new round's start waits on BEGIN.
            fire(sceneKey, momentsOfNext({ before: combatants, after: nextCombatants, from: row.turn_index, to: 0, wrapped: true, roundEnds: startsRound }), startsRound ? combatants : null);

            db.run(
              `UPDATE initiative_scene SET combatants = ?, turn_index = 0, begun = ?, updated_at = CURRENT_TIMESTAMP WHERE scene_key = ?`,
              [JSON.stringify(nextCombatants), startsRound ? 0 : 1, sceneKey],
              (err) => {
                if (err) return done();
                db.run(
                  `UPDATE initiative_scene SET pass_counter = pass_counter + 1 WHERE scene_key = ?`,
                  [sceneKey],
                  () => { done(); broadcastScene(io, db, sceneKey, { newRound: startsRound }); }
                );
              }
            );
          } else {
            fire(sceneKey, momentsOfNext({ before: combatants, from: row.turn_index, to: 0, wrapped: true }), combatants);
            db.run(
              `UPDATE initiative_scene SET turn_index = 0, begun = 1, updated_at = CURRENT_TIMESTAMP WHERE scene_key = ?`,
              [sceneKey],
              (err) => {
                if (err) return done();
                db.run(
                  `UPDATE initiative_scene SET turn_counter = turn_counter + 1 WHERE scene_key = ?`,
                  [sceneKey],
                  () => { done(); broadcastScene(io, db, sceneKey); }
                );
              }
            );
          }
        }
      ));
    });

    // ── Begin round 1 (8a9a) ──────────────────────────────────────────────────
    // Once everyone has rolled: START OF ROUND, then the first one's START OF TURN; the tracker's NEXT from then on. Once a
    // round: a scene already begun (by BEGIN or a NEXT) starts nothing.
    socket.on('initiative:begin', ({ sceneKey } = {}) => {
      if (!sceneKey) return;
      getSceneState(db, sceneKey, (err, row) => {
        if (err || !row) return;
        db.run(`UPDATE initiative_scene SET begun = 1 WHERE scene_key = ? AND begun = 0`, [sceneKey], function (e) {
          if (e || !this.changes) return;
          const mode = row.mode || 'individual';
          fire(sceneKey, momentsOfBegin({ mode, combatants: JSON.parse(row.combatants || '[]'), sides: sortSides(JSON.parse(row.sides || '[]')), index: row.turn_index }));
          broadcastScene(io, db, sceneKey);
        });
      });
    });

    // ── Remove a combatant ────────────────────────────────────────────────────
    socket.on('initiative:remove', ({ sceneKey, combatantId }) => {
      if (!sceneKey) return;

      inTurn(sceneKey, (done) => db.get(
        `SELECT s.combatants, s.turn_index, c.mode FROM initiative_scene s
         JOIN initiative_combat c ON c.id = s.combat_id WHERE s.scene_key = ?`,
        [sceneKey],
        (err, row) => {
          if (err || !row) return done();

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
              done();
              if (err) return;
              broadcastScene(io, db, sceneKey);
            }
          );
        }
      ));
    });

    // ── Reorder (drag) ────────────────────────────────────────────────────────
    // Individual mode: fromIndex/toIndex are global positions in the combatants list
    // Side mode: fromIndex/toIndex are positions within a side (sideId provided)
    socket.on('initiative:reorder', ({ sceneKey, fromIndex, toIndex, sideId }) => {
      if (!sceneKey) return;

      inTurn(sceneKey, (done) => db.get(
        `SELECT s.combatants, s.turn_index, c.mode FROM initiative_scene s
         JOIN initiative_combat c ON c.id = s.combat_id WHERE s.scene_key = ?`,
        [sceneKey],
        (err, row) => {
          if (err || !row) return done();

          const list = JSON.parse(row.combatants || '[]');

          if (row.mode === 'side' && sideId) {
            // Reorder within the side only
            const sideMembers = list.filter((c) => c.sideId === sideId);
            const others = list.filter((c) => c.sideId !== sideId);

            if (fromIndex < 0 || toIndex < 0 || fromIndex >= sideMembers.length || toIndex >= sideMembers.length) return done();
            const [moved] = sideMembers.splice(fromIndex, 1);
            sideMembers.splice(toIndex, 0, moved);

            // The drag stands when later rolls are sorted in (initiativeOrder.js).
            const newList = [...others, ...keepDrag(sideMembers, toIndex)];
            db.run(
              `UPDATE initiative_scene SET combatants = ?, updated_at = CURRENT_TIMESTAMP WHERE scene_key = ?`,
              [JSON.stringify(newList), sceneKey],
              (err) => { done(); if (!err) broadcastScene(io, db, sceneKey); }
            );
          } else {
            // Individual mode: global reorder
            if (fromIndex < 0 || toIndex < 0 || fromIndex >= list.length || toIndex >= list.length) return done();

            const [moved] = list.splice(fromIndex, 1);
            list.splice(toIndex, 0, moved);

            // The turn belongs to the slot, not to whoever is standing in it.
            //
            // This used to find the active combatant's new index and follow them down the
            // list, so dragging the character whose turn it was took the turn along for the
            // ride and nobody else advanced. Holding turn_index still means the character
            // who moves up into the active slot inherits the turn, which is what giving up
            // your place in the order is supposed to cost you. A reorder never changes the
            // list's length, so the index cannot fall out of range.
            db.run(
              `UPDATE initiative_scene SET combatants = ?, updated_at = CURRENT_TIMESTAMP
               WHERE scene_key = ?`,
              // The drag stands when later rolls are sorted in (initiativeOrder.js).
              [JSON.stringify(keepDrag(list, toIndex)), sceneKey],
              (err) => { done(); if (!err) broadcastScene(io, db, sceneKey); }
            );
          }
        }
      ));
    });

    // ── End a whole combat, every scene it spans ──────────────────────────────
    //
    // `initiative:end` closes the one scene the caller is looking at. A combat can run
    // across several scenes at once, so ending it from the nav list means clearing all of
    // them: emitting `initiative:ended` per scene keeps every client watching any of them
    // in step, and the combat row goes once its last scene has.
    socket.on('initiative:end_combat', ({ combatId }) => {
      if (!combatId) return;

      db.all(
        `SELECT scene_key FROM initiative_scene WHERE combat_id = ?`,
        [combatId],
        (err, rows) => {
          if (err || !rows) return;

          db.run(`DELETE FROM initiative_scene WHERE combat_id = ?`, [combatId], (delErr) => {
            if (delErr) return;
            rows.forEach((r) => io.emit('initiative:ended', { sceneKey: r.scene_key }));
            // Its rolls asked and not yet rolled go with it (8a9a2).
            dropAsks(db, rows.map((r) => r.scene_key)).then(() => io.emit('turnAsksChanged'), () => {});
            db.run(`DELETE FROM initiative_combat WHERE id = ?`, [combatId]);
          });
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
            dropAsks(db, [sceneKey]).then(() => io.emit('turnAsksChanged'), () => {});

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
function logRoll(io, db, combatant, system) {
  const explodSuffix = combatant.exploded ? ' 💥EXPLOD' : '';
  const historyString = combatant.breakdown
    ? `${combatant.name} ${initiativeWord(system)}: ${combatant.breakdown}${explodSuffix}`
    : `${combatant.name} rolled ${initiativeWord(system)} [${combatant.score}]${explodSuffix}`;
  const results = combatant.diceResults || { 20: [combatant.score] };
  const resultsJson = JSON.stringify(results);
  db.run(
    `INSERT INTO dice_rolls (username, total, results, color, historyString) VALUES (?, ?, ?, ?, ?)`,
    [combatant.name, combatant.score, resultsJson, '#00ff00', historyString],
    () => io.emit('diceRollBroadcast', withThrow({
      userName: combatant.name,
      account: combatant.name,
      results,
      modifiers: [],
      color: '#00ff00',
      total: combatant.score,
      historyString,
      // The tray's board says what it was for (6c4d3), in the game's own word for it.
      board: boardOf(initiativeWord(system)),
    }))
  );
}

module.exports = { registerInitiativeHandlers, sortSides, calcPcSideScore };
