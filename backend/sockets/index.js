const jwt = require('jsonwebtoken');
const sheetTemplates = require('../sheets/templates');
const sheetRolls = require('../sheets/rolls');
const rollEngine = require('../sheets/rollEngine');
const sheetAttack = require('../sheets/attack');
const attackCwn = require('../sheets/attackCwn');
const npcTiers = require('../sheets/npcTiers');

const SECRET = process.env.JWT_SECRET;

const userSockets = new Map();
let activeNPCs = [];

// Rolls whose outcome mutates visible sheet state (death saves, stabilize)
// broadcast first and apply the consequences after the client's dice
// animation, so banners don't spoil the result mid-roll. Tests set
// DICE_ANIM_MS=0 to skip the wait.
const DICE_ANIM_MS = Number(process.env.DICE_ANIM_MS ?? 5000);

// CWN stabilize checks resolve after the animation delay - block re-rolls on
// the same target while one is in flight.
const stabilizeInFlight = new Set();

// Streamer mode: spectator sockets are read-only observers, invisible to the game.
// requestQuickSheet is spectator-allowed by design: it only ever returns
// server-filtered public fields, so stream viewers can see who's who.
const SPECTATOR_ALLOWED_EVENTS = new Set(['identify', 'requestDiceHistory', 'requestQuickSheet']);

const formatMeasurementPayload = (data, userName, socketId) => ({
  owner: userName ? userName : socketId,
  start: data.start,
  end: data.end,
  color: data.color || '#00ff00',
  battle_map_id: data.battle_map_id || null,
  floor_index: data.floor_index !== undefined ? data.floor_index : null,
  map_scale_multiplier: data.map_scale_multiplier || 5,
  view: data.view,
  locationId: data.locationId,
  isFinal: data.isFinal
});

module.exports = (io, db, { elevatedUsers, emitUpdate, recordAction }) => {
  // Streamer mode: last director state, replayed to spectators when they join.
  let directorState = null;

  // Attack system: one pending attack per socket. Cleared on roll, cancel, or disconnect.
  // { targetId, attackType: 'melee' | 'ranged', ac }
  const pendingAttacks = new Map();

  // ── Radio Feed ────────────────────────────────────────────────────────────────
  let musicState = {
    playing: false,
    trackId: null,
    src: null,
    name: null,
    position: 0,
    shuffle: false,
    loop: false,
  };
  // Per play-cycle set of socket IDs that have reported musicReady.
  let musicReadySet = new Set();
  let musicReadyTimeout = null;

  const startPlayback = (position) => {
    musicState.playing = true;
    musicState.position = position;
    const payload = { position, timestamp: Date.now() };
    io.emit('musicPlay', payload);
  };

  const resolveReady = () => {
    if (musicReadyTimeout) { clearTimeout(musicReadyTimeout); musicReadyTimeout = null; }
    musicReadySet.clear();
    startPlayback(musicState.position);
  };

  const isAdminSocket = (socket) => {
    const info = userSockets.get(socket.id);
    return !!info && (info.isAdmin || elevatedUsers.has(info.userName));
  };

  const buildActiveUsers = () => {
    const userMap = new Map();
    userSockets.forEach((info) => {
      userMap.set(info.userName, { ...info, isTemporaryAdmin: elevatedUsers.has(info.userName) });
    });
    activeNPCs.forEach(npc => {
      userMap.set(npc.userName, { userName: npc.userName, isAdmin: false, isTemporaryAdmin: false, isNPC: true, isActive: npc.isActive });
    });
    return Array.from(userMap.values());
  };

  const broadcastActiveUsers = () => {
    io.emit('activeUsersUpdated', buildActiveUsers());
  };

  const sendBankUpdate = (username) => {
    db.get('SELECT balance, debt, first_pay_done, high_roller_done FROM player_banks WHERE username = ?', [username], (err, row) => {
      if (!err && row) {
        io.emit('bankUpdate', { username, balance: row.balance, debt: row.debt, firstPayDone: !!row.first_pay_done, highRollerDone: !!row.high_roller_done });
      } else if (!err && !row) {
        db.run('INSERT INTO player_banks (username, balance, debt) VALUES (?, 0, 0)', [username], () => {
          io.emit('bankUpdate', { username, balance: 0, debt: 0, firstPayDone: false, highRollerDone: false });
        });
      }
    });
  };

  // Load NPCs from DB on startup
  db.all('SELECT username, isActive FROM fake_users', (err, rows) => {
    if (err) { console.error('Error loading fake_users:', err.message); return; }
    if (rows) {
      activeNPCs = rows.map(r => ({ userName: r.username, isActive: r.isActive === 1 }));
      console.log('Loaded NPCs from DB:', activeNPCs);
      broadcastActiveUsers();
    }
  });

  const broadcastSpectatorCount = () => {
    const count = io.sockets.adapter.rooms.get('spectators')?.size || 0;
    io.emit('spectatorCount', { count });
  };

  io.on('connection', (socket) => {
    // Spectators are read-only: drop every incoming event except the allowlist.
    socket.use(([event], next) => {
      if (socket.isSpectator && !SPECTATOR_ALLOWED_EVENTS.has(event)) return;
      next();
    });

    socket.on('requestDiceHistory', () => {
      db.all('SELECT * FROM dice_rolls ORDER BY timestamp DESC LIMIT 5', (err, rows) => {
        if (!err && rows) {
          socket.emit('diceRollHistory', rows.reverse().map(r => ({
            userName: r.username, total: r.total, results: JSON.parse(r.results), color: r.color, historyString: r.historyString || ''
          })));
        }
      });
    });

    socket.on('identify', (data) => {
      let info = typeof data === 'string' ? { userName: data, isAdmin: false } : data;

      // Streamer mode spectator: read-only, invisible to presence/chat, no rhombus.
      // Safe to bypass Secure Mode because the socket.use guard drops all mutations.
      if (info.spectator) {
        socket.isSpectator = true;
        socket.join('spectators');
        console.log(`Spectator connected: ${socket.id}`);
        if (directorState) socket.emit('directorUpdate', directorState);
        // Send the current roster directly — spectators join silently (no
        // broadcastActiveUsers), but player rhombuses only render for owners
        // present in the active users list.
        socket.emit('activeUsersUpdated', buildActiveUsers());
        broadcastSpectatorCount();
        return;
      }

      // Secure Mode: verify player token before allowing connection
      if (process.env.SECURE_MODE === 'true' && !info.isAdmin) {
        if (!info.playerToken) {
          socket.emit('authError', { message: 'Player token required' });
          socket.disconnect(true);
          return;
        }
        try {
          const verified = jwt.verify(info.playerToken, SECRET);
          if (verified.role !== 'player' || verified.username !== info.userName) throw new Error('Invalid token');
        } catch {
          socket.emit('authError', { message: 'Invalid or expired player token' });
          socket.disconnect(true);
          return;
        }
      }
      delete info.playerToken;

      if (info.isAdmin && info.token) {
        try {
          const verified = jwt.verify(info.token, SECRET);
          if (verified.isTemporary) info.isAdmin = false;
        } catch (err) {
          console.warn(`User ${info.userName} claimed admin but provided invalid token.`);
          info.isAdmin = false;
        }
      } else {
        info.isAdmin = false;
      }
      delete info.token;

      console.log(`User identified: ${info.userName} (Admin: ${info.isAdmin})`);
      userSockets.set(socket.id, info);
      broadcastActiveUsers();

      db.all('SELECT * FROM chat_logs ORDER BY timestamp DESC LIMIT 50', (err, rows) => {
        if (!err) {
          socket.emit('chatHistory', rows.reverse().map(r => ({
            ...r,
            timestamp: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          })));
        }
      });

      socket.emit('musicState', musicState);

      db.get('SELECT id, battle_map_id FROM locations WHERE shape = "rhombus" AND owner = ?', [info.userName], (err, row) => {
        if (row) {
          if (row.battle_map_id === -1) {
            db.run('UPDATE locations SET battle_map_id = NULL, floor_index = NULL WHERE id = ?', [row.id], function(updateErr) {
              if (!updateErr) emitUpdate({ isRhombusOnly: true });
            });
          }
          io.emit('rhombusAppearing', { id: row.id, owner: info.userName });
        }
      });
    });

    socket.on('sendMessage', (data) => {
      const actualInfo = userSockets.get(socket.id);
      const actualUserName = actualInfo?.userName;
      const isPrimaryAdmin = actualInfo?.isAdmin;
      if (data.sender !== actualUserName && !elevatedUsers.has(actualUserName) && !isPrimaryAdmin) {
        data.sender = actualUserName || 'Unknown';
      }
      const timestamp = new Date().toISOString();
      db.run('INSERT INTO chat_logs (sender, text, timestamp) VALUES (?, ?, ?)', [data.sender, data.text, timestamp], function(err) {
        if (!err) {
          io.emit('receiveMessage', {
            id: this.lastID, ...data,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          });
        }
      });
    });

    socket.on('grantElevatedAccess', (data) => {
      try {
        const verified = jwt.verify(data.adminToken, SECRET);
        if (verified && !verified.isTemporary) {
          elevatedUsers.add(data.targetUser);
          const tempToken = jwt.sign({ username: data.targetUser, isTemporary: true }, SECRET, { expiresIn: '12h' });
          console.log(`Admin ${verified.username} granted temporary access to ${data.targetUser}`);
          io.emit('accessGranted', { targetUser: data.targetUser, token: tempToken });
          broadcastActiveUsers();
        }
      } catch (err) { console.warn('Unauthorized attempt to grant access:', err.message); }
    });

    socket.on('revokeElevatedAccess', (data) => {
      try {
        const verified = jwt.verify(data.adminToken, SECRET);
        if (verified && !verified.isTemporary) {
          elevatedUsers.delete(data.targetUser);
          console.log(`Admin ${verified.username} revoked temporary access from ${data.targetUser}`);
          io.emit('accessRevoked', { targetUser: data.targetUser });
          broadcastActiveUsers();
        }
      } catch (err) { console.warn('Unauthorized attempt to revoke access:', err.message); }
    });

    socket.on('surrenderAccess', (data) => {
      try {
        const verified = jwt.verify(data.token, SECRET);
        if (verified && verified.isTemporary) {
          elevatedUsers.delete(verified.username);
          console.log(`User ${verified.username} surrendered temporary access`);
          io.emit('accessRevoked', { targetUser: verified.username });
          broadcastActiveUsers();
        }
      } catch (err) {}
    });

    socket.on('createNPC', (data) => {
      try {
        const verified = jwt.verify(data.adminToken, SECRET);
        if (verified && !verified.isTemporary) {
          db.run('INSERT INTO fake_users (username, isActive) VALUES (?, 1)', [data.npcName], function(err) {
            if (!err) {
              activeNPCs.push({ userName: data.npcName, isActive: true });
              broadcastActiveUsers();
            }
          });
        }
      } catch (err) { console.warn('Unauthorized attempt to create NPC:', err.message); }
    });

    socket.on('toggleNPCStatus', (data) => {
      try {
        const verified = jwt.verify(data.adminToken, SECRET);
        if (verified && !verified.isTemporary) {
          db.run('UPDATE fake_users SET isActive = ? WHERE username = ?', [data.isActive ? 1 : 0, data.npcName], function(err) {
            if (!err) {
              const npc = activeNPCs.find(n => n.userName === data.npcName);
              if (npc) { npc.isActive = data.isActive; broadcastActiveUsers(); }
            }
          });
        }
      } catch (err) { console.warn('Unauthorized attempt to toggle NPC:', err.message); }
    });

    socket.on('deleteNPC', (data) => {
      try {
        const verified = jwt.verify(data.adminToken, SECRET);
        if (verified && !verified.isTemporary) {
          db.run('DELETE FROM fake_users WHERE username = ?', [data.npcName], function(err) {
            if (!err) {
              activeNPCs = activeNPCs.filter(n => n.userName !== data.npcName);
              broadcastActiveUsers();
            }
          });
        }
      } catch (err) { console.warn('Unauthorized attempt to delete NPC:', err.message); }
    });

    socket.on('sendPrivateMessage', (data) => {
      db.run('INSERT INTO private_messages (sender, recipient, text) VALUES (?, ?, ?)', [data.sender, data.recipient, data.text], function(err) {
        if (!err) {
          db.get('SELECT * FROM private_messages WHERE id = ?', [this.lastID], (err, row) => {
            if (row) {
              const formattedMsg = { ...row, timestamp: new Date(row.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
              const targetSockets = new Set();
              const involvesNPC = activeNPCs.some(n => n.userName === data.sender || n.userName === data.recipient);
              userSockets.forEach((info, socketId) => {
                if (info.userName === data.sender || info.userName === data.recipient) targetSockets.add(socketId);
                if (involvesNPC && info.isAdmin) targetSockets.add(socketId);
              });
              targetSockets.forEach(id => io.to(id).emit('receivePrivateMessage', formattedMsg));
            }
          });
        }
      });
    });

    socket.on('getPrivateHistory', (data) => {
      db.all(`SELECT * FROM private_messages WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?) ORDER BY timestamp DESC LIMIT 50`,
        [data.user1, data.user2, data.user2, data.user1], (err, rows) => {
          if (!err) {
            socket.emit('privateHistory', {
              targetUser: data.originalTab || data.user2,
              history: rows.reverse().map(r => ({ ...r, timestamp: new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }))
            });
          }
        });
    });

    socket.on('updateNotifications', (data) => {
      db.run('UPDATE locations SET notifications_enabled = ? WHERE owner = ? AND shape = "rhombus"', [data.enabled ? 1 : 0, data.userName]);
    });

    socket.on('updateViewSettings', (data) => {
      if (!isAdminSocket(socket)) return;
      const renderSignage = !!data.renderSignage;
      const signageDensity = Math.min(5, Math.max(0.5, Number(data.signageDensity) || 1));
      const renderSidewalks = !!data.renderSidewalks;
      io.emit('viewSettingsUpdated', { renderSignage, signageDensity, renderSidewalks });
    });

    socket.on('requestEditing', (data) => { io.emit('editingRequested', data); });

    socket.on('approveEditing', (data) => {
      elevatedUsers.add(data.userId);
      const tempToken = jwt.sign({ username: data.userId, isTemporary: true }, SECRET, { expiresIn: '12h' });
      io.emit('accessGranted', { targetUser: data.userId, token: tempToken, forEditing: true });
      io.emit('editingStarted', data);
      io.emit('editingApproved', data);
    });

    socket.on('denyEditing', (data) => { io.emit('editingDenied', data); });
    socket.on('revokeEditing', (data) => { elevatedUsers.delete(data.userId); io.emit('editingStopped'); io.emit('editingRevoked', data); broadcastActiveUsers(); });
    socket.on('editingFinished', (data) => { if (data?.userId) elevatedUsers.delete(data.userId); io.emit('editingStopped'); });

    socket.on('requestRhombusPurge', (data) => {
      console.log(`Cinematic Purge Requested for owner: ${data.owner}, id: ${data.id}`);
      // Look up the real rhombus id so the fade event matches on all clients.
      const lookupCol = data.id ? 'id' : 'owner';
      const lookupVal = data.id || data.owner;
      db.get(`SELECT id, owner FROM locations WHERE shape = "rhombus" AND ${lookupCol} = ?`, [lookupVal], (err, row) => {
        if (!err && row) {
          io.emit('rhombusFading', { id: row.id, owner: row.owner });
        }
        // Give the 3s animation time to finish before unmounting via dataUpdated.
        setTimeout(() => {
          if (data.id) {
            db.run('UPDATE locations SET battle_map_id = -1, floor_index = -1 WHERE id = ? AND shape = "rhombus"', [data.id], function(err2) {
              if (!err2 && this.changes > 0) {
                recordAction('location_update', { data: [{ id: data.id, battle_map_id: -1, floor_index: -1 }] });
                emitUpdate({ isRhombusOnly: true });
              }
            });
          } else if (data.owner) {
            db.run('UPDATE locations SET battle_map_id = -1, floor_index = -1 WHERE owner = ? AND shape = "rhombus"', [data.owner], function(err2) {
              if (!err2 && this.changes > 0) emitUpdate({ isRhombusOnly: true });
            });
          }
        }, 3500);
      });
    });

    socket.on('requestInstantRhombusPurge', (data) => {
      console.log(`Instant Purge Requested for ID: ${data.id}`);
      db.run('UPDATE locations SET battle_map_id = -1, floor_index = -1 WHERE id = ? AND shape = "rhombus"', [data.id], function(err) {
        if (!err && this.changes > 0) {
          recordAction('location_update', { data: [{ id: data.id, battle_map_id: -1, floor_index: -1 }] });
          emitUpdate({ isRhombusOnly: true });
        }
      });
    });

    socket.on('moveRhombus', (data) => {
      const info = userSockets.get(socket.id);
      if (!info) return;
      db.get('SELECT owner FROM locations WHERE id = ?', [data.id], (err, row) => {
        if (err || !row) return;
        if (info.isAdmin || info.userName === row.owner) {
          db.run('UPDATE locations SET x = ?, z = ? WHERE id = ?', [data.x, data.z, data.id], function(updateErr) {
            if (!updateErr) emitUpdate({ isRhombusOnly: true });
          });
        }
      });
    });

    // moveRhombusPath: saves the final position and broadcasts waypoints to
    // all OTHER clients so they animate along the same path.
    socket.on('moveRhombusPath', (data) => {
      const info = userSockets.get(socket.id);
      if (!info) return;
      const { id, waypoints } = data; // waypoints: [{x,z}, ...], last entry is the final position
      if (!Array.isArray(waypoints) || waypoints.length === 0) return;
      const final = waypoints[waypoints.length - 1];
      db.get('SELECT owner FROM locations WHERE id = ?', [id], (err, row) => {
        if (err || !row) return;
        if (info.isAdmin || info.userName === row.owner) {
          db.run('UPDATE locations SET x = ?, z = ? WHERE id = ?', [final.x, final.z, id], function(updateErr) {
            if (!updateErr) {
              // Broadcast path to everyone else; mover already animated locally.
              // emitUpdate is intentionally omitted here — it would snap localPos to the
              // final position on observer clients, killing the path animation mid-flight.
              // The DB is already correct; late-joiners get the right position on initial load.
              socket.broadcast.emit('rhombusPath', { id, waypoints });
            }
          });
        }
      });
    });

    socket.on('battle_map_enter', (data) => {
      const info = userSockets.get(socket.id);
      if (info) { info.currentBattleMapId = data.locationId; info.currentFloorIndex = data.floorIndex; broadcastActiveUsers(); }
    });

    socket.on('battle_map_leave', () => {
      const info = userSockets.get(socket.id);
      if (info) { info.currentBattleMapId = null; info.currentFloorIndex = null; broadcastActiveUsers(); }
    });

    socket.on('admin_force_floor_change', (data) => {
      const info = userSockets.get(socket.id);
      if (info && info.isAdmin) {
        userSockets.forEach(user => {
          if (Number(user.currentBattleMapId) === Number(data.locationId)) user.currentFloorIndex = data.floorIndex;
        });
        io.emit('force_floor_change', data);
        broadcastActiveUsers();
      }
    });

    socket.on('save_battle_map_default', (data) => {
      const info = userSockets.get(socket.id);
      if (info && info.isAdmin) {
        db.serialize(() => {
          db.run('DELETE FROM battle_map_defaults WHERE location_id = ? AND floor_index = ?', [data.locationId, data.floorIndex]);
          const stmt = db.prepare('INSERT INTO battle_map_defaults (location_id, floor_index, rhombus_id, rhombus_owner, is_enemy, x, z) VALUES (?, ?, ?, ?, ?, ?, ?)');
          data.positions.forEach(pos => {
            let enemyVal = 0;
            if (pos.isEnemy) enemyVal = 1;
            else if (pos.isFriendly) enemyVal = 2;
            stmt.run([data.locationId, data.floorIndex, pos.id || null, pos.userName || null, enemyVal, pos.x, pos.z]);
          });
          stmt.finalize();
        });
      }
    });

    socket.on('load_battle_map_default', (data) => {
      const info = userSockets.get(socket.id);
      if (info && info.isAdmin) {
        db.all('SELECT * FROM battle_map_defaults WHERE location_id = ? AND floor_index = ?', [data.locationId, data.floorIndex], (err, rows) => {
          if (err || !rows) return;
          const updates = [];
          db.serialize(() => {
            rows.forEach(row => {
              if (row.is_enemy === 1) {
                db.run('UPDATE locations SET x = ?, z = ? WHERE id = ?', [row.x, row.z, row.rhombus_id]);
                updates.push({ id: row.rhombus_id, x: row.x, z: row.z, isEnemy: true, isFriendly: false });
              } else if (row.is_enemy === 2) {
                db.run('UPDATE locations SET x = ?, z = ? WHERE id = ?', [row.x, row.z, row.rhombus_id]);
                updates.push({ id: row.rhombus_id, x: row.x, z: row.z, isEnemy: false, isFriendly: true });
              } else {
                db.get('SELECT id FROM locations WHERE shape = "rhombus" AND owner = ?', [row.rhombus_owner], (err, pRow) => {
                  if (pRow) {
                    db.run('UPDATE locations SET x = ?, z = ? WHERE id = ?', [row.x, row.z, pRow.id]);
                  } else {
                    db.run('INSERT INTO locations (name, x, y, z, shape, owner, color, width, height, depth) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                      [row.rhombus_owner, row.x, 0.1, row.z, 'rhombus', row.rhombus_owner, '#00ff00', 3.75, 3.75, 3.75]);
                  }
                });
                updates.push({ userName: row.rhombus_owner, x: row.x, z: row.z, isEnemy: false, isFriendly: false });
              }
            });
            db.run('SELECT 1', () => {
              io.emit('default_loaded', { locationId: data.locationId, floorIndex: data.floorIndex, updates });
              emitUpdate({ isRhombusOnly: true });
            });
          });
        });
      }
    });

    socket.on('battle_map_move', (data) => {
      const info = userSockets.get(socket.id);
      if (info && info.currentBattleMapId) {
        io.emit('battle_map_moved', { userName: info.userName, x: data.x, z: data.z, locationId: info.currentBattleMapId, floorIndex: info.currentFloorIndex });
      }
    });

    socket.on('ping_location', (data) => {
      const info = userSockets.get(socket.id);
      io.emit('location_pinged', {
        owner: info ? info.userName : socket.id,
        x: data.x, y: data.y, z: data.z,
        color: data.color || '#ff0000',
        size: data.size || 1,
        battle_map_id: data.battle_map_id || null,
        floor_index: data.floor_index !== undefined ? data.floor_index : null
      });
    });

    socket.on('drawMeasurement', (data) => {
      const info = userSockets.get(socket.id);
      io.emit('measurementUpdated', formatMeasurementPayload(data, info ? info.userName : null, socket.id));
    });

    socket.on('requestDiceRoll', (data) => {
      const { userName, diceCounts, modifiers, color } = data;
      const results = {};
      let diceTotal = 0;
      const rollParts = [];
      const allRolls = [];

      for (const [sides, count] of Object.entries(diceCounts)) {
        const s = parseInt(sides);
        const c = parseInt(count);
        if (c > 0) {
          rollParts.push(`${c}d${s}`);
          results[s] = [];
          for (let i = 0; i < c; i++) {
            const roll = Math.floor(Math.random() * s) + 1;
            results[s].push(roll);
            allRolls.push(roll);
            diceTotal += roll;
          }
        }
      }

      const modTotal = modifiers.reduce((a, b) => a + b, 0);
      const grandTotal = diceTotal + modTotal;
      let mathExpression = rollParts.join('+');
      if (modifiers.length > 0) mathExpression += ' ' + modifiers.map(m => m > 0 ? `+ ${m}` : `- ${Math.abs(m)}`).join(' ');

      const diceBreakdown = allRolls.join('+');
      let finalString = `${userName} rolled ${mathExpression} [(${diceBreakdown})`;
      if (modTotal !== 0) finalString += ` ${modTotal > 0 ? '+' : '-'} ${Math.abs(modTotal)}`;
      finalString += ` = ${grandTotal}]`;

      const broadcastData = { userName, results, modifiers, color, total: grandTotal, historyString: finalString };
      db.run('INSERT INTO dice_rolls (username, total, results, color, historyString) VALUES (?, ?, ?, ?, ?)',
        [userName, grandTotal, JSON.stringify(results), color, finalString], (err) => {
          if (err) console.error('Error saving dice roll:', err);
          io.emit('diceRollBroadcast', broadcastData);

          // If this player had a pending attack, resolve it.
          const attack = pendingAttacks.get(socket.id);
          if (attack) {
            pendingAttacks.delete(socket.id);
            const hit = grandTotal >= attack.ac;
            const info = userSockets.get(socket.id);
            // Look up attacker position for animation — the attacker's rhombus on the
            // same map as the target (players get one rhombus per battle map + world).
            const onBattleMap = attack.targetBattleMapId !== null && attack.targetBattleMapId !== undefined;
            const attackerSql = onBattleMap
              ? 'SELECT x, z FROM locations WHERE shape = "rhombus" AND owner = ? AND battle_map_id = ? AND floor_index = ?'
              : 'SELECT x, z FROM locations WHERE shape = "rhombus" AND owner = ? AND battle_map_id IS NULL';
            const attackerParams = onBattleMap
              ? [info ? info.userName : null, attack.targetBattleMapId, attack.targetFloorIndex]
              : [info ? info.userName : null];
            db.get(attackerSql, attackerParams, (posErr, attackerRow) => {
              io.emit('attackResult', {
                hit,
                attackerId: socket.id,
                attackerName: info ? info.userName : 'Unknown',
                targetId: attack.targetId,
                targetName: attack.targetName,
                attackType: attack.attackType,
                roll: grandTotal,
                ac: attack.ac,
                attackerPos: attackerRow ? { x: attackerRow.x, z: attackerRow.z } : null,
                targetPos: { x: attack.targetX, z: attack.targetZ },
                isBattleMap: onBattleMap,
              });
            });
          }
        });
    });

    socket.on('purgeDiceHistory', (data) => {
      if (!data.token) return;
      jwt.verify(data.token, SECRET, (err, decoded) => {
        if (err || decoded.isTemporary) return;
        db.run('DELETE FROM dice_rolls', (err) => {
          if (err) console.error('Error purging dice rolls:', err);
          io.emit('diceRollHistory', []);
        });
      });
    });

    // --- Banking ---
    socket.on('requestBankBalance', (data) => {
      if (data && data.username) sendBankUpdate(data.username);
    });

    // ── Character Sheets ─────────────────────────────────────────────────────
    // Player self-service goes through the socket (identity = the socket's
    // registered userName, never a payload field) so a client can only ever
    // fetch or edit its own full sheet. Admin access is via REST.

    const getGameSystem = (cb) => {
      db.get(`SELECT value FROM global_settings WHERE key = 'game_system'`, (err, row) => {
        cb(err, row ? row.value : sheetTemplates.DEFAULT_SYSTEM);
      });
    };

    // Linked fields (declared per-template) live in other systems: token HP
    // in locations, cash in player_banks. Overlay their live values onto the
    // sheet data at read time - they are never stored in the sheet's JSON.
    const overlayLinkedData = (username, system, data, cb) => {
      const linked = sheetTemplates.getLinkedFields(system);
      const out = { ...data };
      const wantsToken = Object.values(linked).some(s => s === 'token_hp' || s === 'token_hp_max' || s === 'token_ac');
      const wantsCash = Object.values(linked).includes('bank_balance');
      const afterToken = (tokenRow) => {
        Object.entries(linked).forEach(([fieldId, source]) => {
          if (source === 'token_hp') out[fieldId] = tokenRow ? tokenRow.hp_current : null;
          if (source === 'token_hp_max') out[fieldId] = tokenRow ? tokenRow.hp_max : null;
          // Unset token AC falls back to 10, matching the attack engine's
          // default - the sheet shows the AC attacks actually resolve against.
          if (source === 'token_ac') out[fieldId] = tokenRow ? (tokenRow.melee_ac ?? 10) : null;
        });
        if (!wantsCash) return cb(out);
        db.get(`SELECT balance FROM player_banks WHERE username = ?`, [username], (err, bank) => {
          Object.entries(linked).forEach(([fieldId, source]) => {
            if (source === 'bank_balance') out[fieldId] = bank ? bank.balance : 0;
          });
          cb(out);
        });
      };
      if (!wantsToken) return afterToken(null);
      db.get(
        `SELECT hp_current, hp_max, melee_ac FROM locations WHERE shape = 'rhombus' AND owner = ?
         ORDER BY (battle_map_id IS NULL) DESC LIMIT 1`,
        [username],
        (err, tokenRow) => afterToken(err ? null : tokenRow)
      );
    };

    socket.on('requestMySheet', () => {
      const info = userSockets.get(socket.id);
      if (!info || !info.userName) return;
      getGameSystem((err, system) => {
        if (err) return;
        db.get(
          `SELECT * FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
          [info.userName, system],
          (err2, row) => {
            if (err2) return;
            if (row) {
              overlayLinkedData(info.userName, system, JSON.parse(row.data || '{}'), (data) => {
                socket.emit('sheetData', { ...row, data });
              });
            } else {
              // Auto-create a blank sheet on first open, carrying the portrait
              // over from the player's most recent sheet on another system
              db.get(
                `SELECT portrait_url FROM character_sheets WHERE username = ? AND is_npc = 0 ORDER BY updated_at DESC`,
                [info.userName],
                (err3, prev) => {
                  const portrait = prev ? prev.portrait_url : null;
                  db.run(
                    `INSERT INTO character_sheets (username, system, data, portrait_url) VALUES (?, ?, '{}', ?)`,
                    [info.userName, system, portrait],
                    function (err4) {
                      if (err4) return;
                      const newId = this.lastID;
                      overlayLinkedData(info.userName, system, {}, (data) => {
                        socket.emit('sheetData', {
                          id: newId, username: info.userName, system,
                          data, portrait_url: portrait, is_npc: 0,
                        });
                      });
                    }
                  );
                }
              );
            }
          }
        );
      });
    });

    socket.on('updateSheetField', (payload) => {
      const info = userSockets.get(socket.id);
      if (!info || !info.userName) return;
      if (!payload || typeof payload.fieldId !== 'string') return;
      getGameSystem((err, system) => {
        if (err) return;
        // Linked fields are owned by other systems (token HP, bank) - never
        // stored in sheet JSON. token_ac is the one WRITABLE link: a sheet
        // edit routes to the player's token (both melee and ranged - CWN
        // has a single flat AC), keeping the token the source of truth.
        const linkSource = sheetTemplates.getLinkedFields(system)[payload.fieldId];
        if (linkSource === 'token_ac') {
          const ac = Number(payload.value);
          if (!Number.isFinite(ac) || ac < 0 || ac > 99) return;
          db.run(
            `UPDATE locations SET melee_ac = ?, ranged_ac = ? WHERE shape = 'rhombus' AND owner = ?`,
            [ac, ac, info.userName],
            (e2) => {
              if (e2) return;
              emitUpdate({ isRhombusOnly: true });
              io.emit('sheetUpdated', { username: info.userName, system });
            }
          );
          return;
        }
        if (linkSource) return;
        db.get(
          `SELECT id, data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
          [info.userName, system],
          (err2, row) => {
            if (err2 || !row) return;
            const data = JSON.parse(row.data || '{}');
            data[payload.fieldId] = payload.value;
            // If the changed field is a max, clamp the paired current field.
            const curField = sheetTemplates.getMaxPairs(system)[payload.fieldId];
            if (curField && data[curField] !== undefined) {
              const newMax = Number(payload.value);
              if (Number(data[curField]) > newMax) data[curField] = newMax;
            }
            // Recompute derived fields (CP:R: EMP = Humanity / 10)
            sheetTemplates.applyDerived(system, data, payload.fieldId);
            db.run(
              `UPDATE character_sheets SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
              [JSON.stringify(data), row.id],
              (err3) => {
                if (err3) return;
                // CWN: armor fields drive the token AC (base + capped DEX
                // mod + shield). Only while armor_ac is set - otherwise the
                // token AC stays hand-managed.
                const effAc = system === 'cities_without_number' ? sheetTemplates.cwnEffectiveAc(data) : null;
                if (effAc !== null) {
                  db.run(
                    `UPDATE locations SET melee_ac = ?, ranged_ac = ? WHERE shape = 'rhombus' AND owner = ?`,
                    [effAc, effAc, info.userName],
                    () => {
                      emitUpdate({ isRhombusOnly: true });
                      io.emit('sheetUpdated', { username: info.userName, system });
                    }
                  );
                } else {
                  io.emit('sheetUpdated', { username: info.userName, system });
                }
              }
            );
          }
        );
      });
    });

    // Bulk-apply imported fields to the caller's own sheet (import flow).
    // Same rules as updateSheetField, one write: linked fields refused,
    // derived fields recomputed.
    socket.on('importSheetFields', (payload) => {
      const info = userSockets.get(socket.id);
      if (!info || !info.userName) return;
      if (!payload || typeof payload.fields !== 'object' || payload.fields === null) return;
      getGameSystem((err, system) => {
        if (err) return;
        const linked = sheetTemplates.getLinkedFields(system);
        const entries = Object.entries(payload.fields)
          .filter(([k, v]) => !linked[k] && (typeof v === 'string' || typeof v === 'number'));
        if (entries.length === 0) return;
        db.get(
          `SELECT id, data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
          [info.userName, system],
          (err2, row) => {
            if (err2 || !row) return;
            const data = JSON.parse(row.data || '{}');
            entries.forEach(([k, v]) => { data[k] = v; });
            entries.forEach(([k]) => sheetTemplates.applyDerived(system, data, k));
            db.run(
              `UPDATE character_sheets SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
              [JSON.stringify(data), row.id],
              (err3) => {
                if (err3) return;
                const effAc = system === 'cities_without_number' ? sheetTemplates.cwnEffectiveAc(data) : null;
                const finish = () => {
                  io.emit('sheetUpdated', { username: info.userName, system });
                  socket.emit('sheetImportApplied', { count: entries.length });
                };
                if (effAc !== null) {
                  db.run(
                    `UPDATE locations SET melee_ac = ?, ranged_ac = ? WHERE shape = 'rhombus' AND owner = ?`,
                    [effAc, effAc, info.userName],
                    () => { emitUpdate({ isRhombusOnly: true }); finish(); }
                  );
                } else {
                  finish();
                }
              }
            );
          }
        );
      });
    });

    // Roll a sheet field. Server-authoritative: the client sends only the
    // fieldId - the formula and the stat values come from the server-side
    // roll map and the STORED sheet, so a client can't inflate a roll. The
    // result flows through the same insert + broadcast as manual dice.
    socket.on('requestSheetRoll', (payload) => {
      const info = userSockets.get(socket.id);
      if (!info || !info.userName) return;
      if (!payload || typeof payload.fieldId !== 'string') return;
      getGameSystem((err, system) => {
        if (err) return;
        const rollDef = sheetRolls.getRoll(system, payload.fieldId);
        if (!rollDef) return;
        db.get(`SELECT value FROM global_settings WHERE key = 'luck_negates_fumble'`, (lnErr, lnRow) => {
        const luckNegatesFumble = !lnErr && lnRow && lnRow.value === '1';
        db.get(
          `SELECT id, data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
          [info.userName, system],
          (err2, row) => {
            if (err2 || !row) return;
            db.get(
              `SELECT hp_current FROM locations WHERE shape = 'rhombus' AND owner = ?
               ORDER BY (battle_map_id IS NULL) DESC LIMIT 1`,
              [info.userName],
              (hpErr, hpRow) =>

            {
            const data = JSON.parse(row.data || '{}');
            const hp = !hpErr && hpRow ? hpRow.hp_current : null;
            // Declared LUCK: flat bonus and/or a 1-pip fumble shield. The
            // house rule (bonus spend also negates fumbles) is settings-gated.
            // Fumble negation (shield or bonus) only exists while the
            // house rule is on - off means a nat-1 always fumbles.
            const spend = sheetAttack.resolveLuckSpend(
              data.luck,
              Number.isInteger(payload.luck) ? payload.luck : 0,
              payload.luckNegate === true && luckNegatesFumble
            );
            const noFumble = spend.negate || (luckNegatesFumble && spend.bonus > 0);
            let outcome;
            let statField = null;
            try {
              const resolved = rollEngine.resolveFormula(rollDef.formula, data);
              // First @field in the formula is the governing stat (armor
              // penalty applies to REF/DEX checks)
              const firstField = rollEngine.parseFormula(rollDef.formula).find(t => t.kind === 'field');
              statField = firstField ? firstField.field : null;
              if (spend.bonus > 0) resolved.modifiers.push({ label: 'luck', value: spend.bonus });
              resolved.modifiers.push(...sheetAttack.checkPenalties(data, statField, hp));
              outcome = rollEngine.executeRoll(resolved, rollDef.shape, Math.random, { noFumble });
            } catch (e) {
              return;
            }
            const luck = spend.total;
            const critTag = outcome.critical === 'success' ? ' — CRITICAL!'
              : outcome.critical === 'failure' ? ' — FUMBLE!' : '';
            const luckTag = (spend.bonus > 0 ? ` (LUCK +${spend.bonus})` : '')
              + (spend.negate ? ' (LUCK: FUMBLE SHIELD)' : '');
            const woundTag = hp !== null && hp <= 0 ? ' (MORTALLY WOUNDED -4)'
              : hp !== null && Number(data.seriously_wounded) > 0 && hp <= Number(data.seriously_wounded) ? ' (WOUNDED -2)' : '';
            const historyString =
              `${info.userName} rolled ${rollDef.label} [${outcome.breakdown} = ${outcome.total}]${luckTag}${woundTag}${critTag}`;
            // Spend the declared LUCK
            if (luck > 0) {
              data.luck = Math.max(0, (Number(data.luck) || 0) - luck);
              db.run(
                `UPDATE character_sheets SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [JSON.stringify(data), row.id],
                () => io.emit('sheetUpdated', { username: info.userName, system })
              );
            }
            const color = typeof payload.color === 'string' ? payload.color : '#00ff00';
            const broadcastData = {
              userName: info.userName,
              results: outcome.rolls,
              modifiers: outcome.modTotal !== 0 ? [outcome.modTotal] : [],
              color,
              total: outcome.total,
              historyString,
            };
            db.run(
              'INSERT INTO dice_rolls (username, total, results, color, historyString) VALUES (?, ?, ?, ?, ?)',
              [info.userName, outcome.total, JSON.stringify(outcome.rolls), color, historyString],
              (err3) => {
                if (err3) console.error('Error saving sheet roll:', err3);
                io.emit('diceRollBroadcast', broadcastData);
              }
            );
            }
            );
          }
        );
        });
      });
    });

    // Public card for another player's token. Server-filtered to the template's
    // public fields - combat-sensitive values never leave the server. Safe for
    // spectators (allowlisted above).
    socket.on('requestQuickSheet', (data) => {
      if (!data || !data.username) return;
      getGameSystem((err, system) => {
        if (err) return;
        db.get(
          `SELECT username, system, data, portrait_url FROM character_sheets
           WHERE username = ? AND system = ? AND is_npc = 0`,
          [data.username, system],
          (err2, row) => {
            if (err2) return;
            if (!row) return socket.emit('quickSheetData', { username: data.username, exists: false });
            socket.emit('quickSheetData', {
              username: row.username,
              system: row.system,
              portrait_url: row.portrait_url,
              exists: true,
              fields: sheetTemplates.filterPublicData(row.system, row.data),
            });
          }
        );
      });
    });

    // Admin: seed an NPC sheet from a token (enemy_rhombus / friendly_rhombus).
    // Creates a character_sheets row pre-filled with the token's name, description
    // and current HP, then links it to the location via npc_sheet_links.
    const NPC_HEADSHOTS = [
      '1.png','2.png','14.png','16.png','17.png','21.png','22.png','29.png',
      '30.png','35.png','36.png','46.png','61.png','85.png','86.png','101.png',
    ].map(f => `/npc-headshots/${f}`);

    socket.on('generateNpcSheet', (data) => {
      const callerInfo = userSockets.get(socket.id);
      if (!callerInfo || (!callerInfo.isAdmin && !elevatedUsers.has(callerInfo.userName))) return;
      if (!data || !data.location_id) return;
      const { location_id } = data;
      db.get(`SELECT * FROM locations WHERE id = ?`, [location_id], (err, loc) => {
        if (err || !loc) return;
        getGameSystem((err2, system) => {
          if (err2) return;
          const label = loc.name || `Token #${location_id}`;
          // Tier package (per-system power level) seeds stats/skills/armor/
          // weapons plus token HP and DV. Systems without tiers keep the
          // bare token-mirroring sheet.
          const tier = npcTiers.buildTier(system, data.tier);
          const randomHeadshot = NPC_HEADSHOTS[Math.floor(Math.random() * NPC_HEADSHOTS.length)];
          const sheetData = {
            name: loc.name || '',
            description: loc.description || '',
            handle: loc.name || '',
            ...(tier ? tier.data : {
              hp: loc.hp_current ?? loc.hp_max ?? 0,
              hp_max: loc.hp_max ?? 0,
            }),
          };
          const insertSheet = () => db.run(
            `INSERT INTO character_sheets (username, system, data, is_npc, npc_label, portrait_url)
             VALUES (?, ?, ?, 1, ?, ?)`,
            [callerInfo.userName, system, JSON.stringify(sheetData), label, randomHeadshot],
            function (err3) {
              if (err3) return;
              const sheetId = this.lastID;
              db.run(
                `INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)
                 ON CONFLICT(location_id) DO UPDATE SET sheet_id = excluded.sheet_id`,
                [location_id, sheetId],
                (err4) => {
                  if (err4) return;
                  socket.emit('npcSheetGenerated', { location_id, sheet_id: sheetId, npc_label: label, tier: tier ? tier.tierId : null });
                }
              );
            }
          );
          if (tier && system === 'cyberpunk_red') {
            // Tiered CP:R NPCs get their token tuned: HP pool + DVs.
            // Melee DV comes from the sheet (base + DEX + Evasion; base per
            // the take-10 house-rule toggle) - the GM can still override it
            // any time via EDIT_DV.
            db.get(`SELECT value FROM global_settings WHERE key = 'melee_dv_take10'`, (sErr, sRow) => {
              const meleeDv = sheetAttack.staticMeleeDv(tier.data, !sErr && sRow?.value === '1');
              db.run(
                `UPDATE locations SET hp_current = ?, hp_max = ?, melee_ac = ?, ranged_ac = ? WHERE id = ?`,
                [tier.hp, tier.hp, meleeDv, tier.dv.ranged, location_id],
                () => { emitUpdate({ isRhombusOnly: true }); insertSheet(); }
              );
            });
          } else if (tier) {
            // Other systems (CWN): the tier's own defense values stand - no
            // CP:R melee-DV formula, no take-10 house rule.
            db.run(
              `UPDATE locations SET hp_current = ?, hp_max = ?, melee_ac = ?, ranged_ac = ? WHERE id = ?`,
              [tier.hp, tier.hp, tier.dv.melee, tier.dv.ranged, location_id],
              () => { emitUpdate({ isRhombusOnly: true }); insertSheet(); }
            );
          } else {
            insertSheet();
          }
        });
      });
    });

    socket.on('markFirstPayDone', (data) => {
      if (!data || !data.username) return;
      db.run('UPDATE player_banks SET first_pay_done = 1 WHERE username = ?', [data.username]);
    });

    socket.on('markHighRollerDone', (data) => {
      if (!data || !data.username) return;
      db.run('UPDATE player_banks SET high_roller_done = 1 WHERE username = ?', [data.username]);
    });

    socket.on('withdrawFunds', (data) => {
      if (!data || !data.username || !data.amount) return;
      const amount = parseFloat(data.amount);
      if (isNaN(amount) || amount <= 0) return;
      db.run('UPDATE player_banks SET balance = balance - ? WHERE username = ?', [amount, data.username], (err) => {
        if (!err) sendBankUpdate(data.username);
      });
    });

    socket.on('borrowFunds', (data) => {
      if (!data || !data.username || !data.amount) return;
      const amount = parseFloat(data.amount);
      if (isNaN(amount) || amount <= 0) return;
      db.run('UPDATE player_banks SET debt = debt + ? WHERE username = ?', [amount, data.username], (err) => {
        if (!err) sendBankUpdate(data.username);
      });
    });

    socket.on('payDebt', (data) => {
      if (!data || !data.username || !data.amount) return;
      let amount = parseFloat(data.amount);
      if (isNaN(amount) || amount <= 0) return;
      db.get('SELECT balance, debt FROM player_banks WHERE username = ?', [data.username], (err, row) => {
        if (err || !row) return;
        if (amount > row.balance) amount = row.balance;
        if (amount > row.debt) amount = row.debt;
        if (amount <= 0) return;
        db.run('UPDATE player_banks SET balance = balance - ?, debt = debt - ? WHERE username = ?', [amount, amount, data.username], (err2) => {
          if (!err2) sendBankUpdate(data.username);
        });
      });
    });

    socket.on('adminPayPlayers', (data) => {
      if (!data || !data.token || !Array.isArray(data.usernames) || data.totalAmount === undefined) return;
      jwt.verify(data.token, SECRET, (err, decoded) => {
        if (err) return;
        if (decoded.isTemporary || (decoded.role && decoded.role !== 'admin')) return;
        const count = data.usernames.length;
        if (count === 0) return;
        const amountPerPlayer = Math.ceil((parseFloat(data.totalAmount) / count) * 100) / 100;
        if (isNaN(amountPerPlayer) || amountPerPlayer <= 0) return;
        data.usernames.forEach(uname => {
          db.get('SELECT username FROM player_banks WHERE username = ?', [uname], (err, row) => {
            if (row) {
              db.run('UPDATE player_banks SET balance = COALESCE(balance, 0) + ? WHERE username = ?', [amountPerPlayer, uname], () => sendBankUpdate(uname));
            } else {
              db.run('INSERT INTO player_banks (username, balance, debt) VALUES (?, ?, 0)', [uname, amountPerPlayer], () => sendBankUpdate(uname));
            }
          });
        });
      });
    });

    socket.on('adminUpdateBank', (data) => {
      if (!data || !data.token || !data.username) return;
      jwt.verify(data.token, SECRET, (err, decoded) => {
        if (err || decoded.isTemporary) return;
        const balance = parseFloat(data.balance);
        const debt = parseFloat(data.debt);
        if (isNaN(balance) || isNaN(debt)) return;
        db.get('SELECT username FROM player_banks WHERE username = ?', [data.username], (err2, row) => {
          if (row) {
            db.run('UPDATE player_banks SET balance = ?, debt = ? WHERE username = ?', [balance, debt, data.username], () => sendBankUpdate(data.username));
          } else {
            db.run('INSERT INTO player_banks (username, balance, debt) VALUES (?, ?, ?)', [data.username, balance, debt], () => sendBankUpdate(data.username));
          }
        });
      });
    });

    // --- Attack system ---
    socket.on('initiateAttack', (data) => {
      const info = userSockets.get(socket.id);
      if (!info || !data || !data.targetId || !data.attackType) return;
      db.get('SELECT id, name, x, z, melee_ac, ranged_ac, shape, battle_map_id, floor_index FROM locations WHERE id = ?', [data.targetId], (err, target) => {
        if (err || !target) return;
        const isRhombus = ['rhombus', 'enemy_rhombus', 'friendly_rhombus'].includes(target.shape);
        if (!isRhombus) return;
        const meleeAc = target.melee_ac !== null && target.melee_ac !== undefined ? target.melee_ac : 10;
        const rangedAc = target.ranged_ac !== null && target.ranged_ac !== undefined ? target.ranged_ac : meleeAc;
        const ac = data.attackType === 'ranged' ? rangedAc : meleeAc;
        pendingAttacks.set(socket.id, { targetId: data.targetId, targetName: target.name, attackType: data.attackType, ac, targetX: target.x, targetZ: target.z, targetBattleMapId: target.battle_map_id, targetFloorIndex: target.floor_index });
        socket.emit('attackPending', { targetId: data.targetId, targetName: target.name, attackType: data.attackType, ac });
      });
    });

    socket.on('cancelAttack', () => {
      pendingAttacks.delete(socket.id);
    });

    // ── CP:R attack flow ─────────────────────────────────────────────────────
    // Fully server-authoritative: the client names a target, one of its own
    // structured weapon rows, and whether the shot is aimed. Everything else
    // (to-hit formula, DV, damage dice, SP soak, ablation, HP write) resolves
    // against stored data.
    const RHOMBUS_SHAPES = ['rhombus', 'enemy_rhombus', 'friendly_rhombus'];

    const broadcastRoll = (userName, outcome, historyString, color, cb) => {
      const broadcastData = {
        userName,
        results: outcome.rolls,
        modifiers: outcome.modTotal !== 0 ? [outcome.modTotal] : [],
        color,
        total: outcome.total,
        historyString,
      };
      db.run(
        'INSERT INTO dice_rolls (username, total, results, color, historyString) VALUES (?, ?, ?, ?, ?)',
        [userName, outcome.total, JSON.stringify(outcome.rolls), color, historyString],
        () => { io.emit('diceRollBroadcast', broadcastData); if (cb) cb(); }
      );
    };

    // Defender armor lives on a sheet: the owner's player sheet for player
    // rhombi, or the linked NPC sheet for enemy/friendly tokens (their owner
    // field is set too, so branch on shape, not owner). Null when neither
    // exists (SP treated as 0).
    const getDefenderSheet = (target, system, cb) => {
      if (target.shape === 'rhombus' && target.owner) {
        db.get(
          `SELECT id, username, data, is_npc FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
          [target.owner, system], (err, row) => cb(err ? null : row || null)
        );
      } else {
        db.get(
          `SELECT cs.id, cs.username, cs.data, cs.is_npc FROM npc_sheet_links l
           JOIN character_sheets cs ON cs.id = l.sheet_id WHERE l.location_id = ?`,
          [target.id], (err, row) => cb(err ? null : row || null)
        );
      }
    };

    // Apply damage to a token's HP: temp HP absorbs first (same rules as the
    // /health route). Player rhombi update every copy by owner.
    const applyTokenDamage = (target, amount, cb) => {
      let temp = target.hp_temp || 0;
      let current = target.hp_current === null || target.hp_current === undefined
        ? (target.hp_max || 0) : target.hp_current;
      let remaining = amount;
      if (temp > 0) {
        if (temp >= remaining) { temp -= remaining; remaining = 0; }
        else { remaining -= temp; temp = 0; }
      }
      current = Math.max(0, current - remaining);
      const done = () => {
        emitUpdate({ isRhombusOnly: true });
        if (target.owner) io.emit('sheetUpdated', { username: target.owner });
        cb(current);
      };
      if (target.shape === 'rhombus' && target.owner) {
        db.run('UPDATE locations SET hp_current = ?, hp_temp = ? WHERE shape = "rhombus" AND owner = ?',
          [current, temp, target.owner], done);
      } else {
        db.run('UPDATE locations SET hp_current = ?, hp_temp = ? WHERE id = ?',
          [current, temp, target.id], done);
      }
    };

    // ── CWN attacks ──────────────────────────────────────────────────────────
    // 1d20 + BHB + skill + attribute mod (+weapon atk) vs the token's AC.
    // Hit: damage + mod straight to HP (no soak - AC prices the armor in),
    // multiplied on a traumatic hit when the cwn_trauma house rule is on.
    // Miss: a shock weapon still deals its shock damage if its shock AC
    // covers the target. Frail defenders die outright at 0 HP.
    const handleCwnAttack = (info, payload, color) => {
      const system = 'cities_without_number';
      db.get(
        `SELECT data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
        [info.userName, system],
        (err2, sheetRow) => {
          if (err2 || !sheetRow) return;
          const attackerData = JSON.parse(sheetRow.data || '{}');
          const weapon = attackCwn.getWeapon(attackerData, payload.weaponIndex);
          if (!weapon) {
            return socket.emit('sheetAttackError', { message: 'INVALID_WEAPON // SET NAME, DMG (e.g. 1d8+1) AND SKILL ON YOUR SHEET' });
          }
          db.get(
            `SELECT id, name, owner, x, z, melee_ac, ranged_ac, shape, battle_map_id, floor_index,
                    hp_current, hp_max, hp_temp
             FROM locations WHERE id = ?`,
            [payload.targetId],
            (err3, target) => {
              if (err3 || !target || !RHOMBUS_SHAPES.includes(target.shape)) return;
              // CWN has one flat AC; melee_ac is the canonical token slot and
              // ranged falls back to it.
              const meleeAc = target.melee_ac !== null && target.melee_ac !== undefined ? target.melee_ac : 10;
              const ac = weapon.attackType === 'ranged'
                ? (target.ranged_ac !== null && target.ranged_ac !== undefined ? target.ranged_ac : meleeAc)
                : meleeAc;

              db.get(`SELECT value FROM global_settings WHERE key = 'cwn_trauma'`, (tErr, tRow) => {
                const traumaOn = tErr || !tRow || tRow.value !== '0'; // default ON
                let toHit;
                try { toHit = attackCwn.rollToHit(attackerData, weapon); } catch (e) { return; }
                const hit = toHit.total >= ac;
                const hitHistory =
                  `${info.userName} attacks ${target.name} with ${weapon.name} ` +
                  `[${toHit.breakdown} = ${toHit.total} vs AC ${ac}] — ${hit ? 'HIT' : 'MISS'}`;

                const emitResult = (extra) => {
                  const onBattleMap = target.battle_map_id !== null && target.battle_map_id !== undefined;
                  const attackerSql = onBattleMap
                    ? 'SELECT x, z FROM locations WHERE shape = "rhombus" AND owner = ? AND battle_map_id = ? AND floor_index = ?'
                    : 'SELECT x, z FROM locations WHERE shape = "rhombus" AND owner = ? AND battle_map_id IS NULL';
                  const attackerParams = onBattleMap
                    ? [info.userName, target.battle_map_id, target.floor_index]
                    : [info.userName];
                  db.get(attackerSql, attackerParams, (posErr, attackerRow) => {
                    io.emit('attackResult', {
                      hit,
                      attackerId: socket.id,
                      attackerName: info.userName,
                      targetId: target.id,
                      targetName: target.name,
                      attackType: weapon.attackType,
                      roll: toHit.total,
                      ac,
                      attackerPos: attackerRow ? { x: attackerRow.x, z: attackerRow.z } : null,
                      targetPos: { x: target.x, z: target.z },
                      isBattleMap: onBattleMap,
                      weaponName: weapon.name,
                      aimed: false,
                      ...extra,
                    });
                  });
                };

                // Applies damage and tags Frail deaths / GM prompts in the
                // result. `outcome` carries the actual dice of the damage
                // roll so the dice tray can render them (shock passes none -
                // no dice are rolled on shock).
                const dealDamage = (amount, outcome, tagHistory, resultExtras, traumatic) => {
                  getDefenderSheet(target, system, (defender) => {
                    const defenderData = defender ? JSON.parse(defender.data || '{}') : {};
                    const frail = Number(defenderData.frail) === 1;
                    applyTokenDamage(target, amount, (newHp) => {
                      const down = newHp <= 0;
                      let history = tagHistory;
                      if (down && frail) history += ' — FRAIL: INSTANT DEATH';
                      else if (down && traumatic) history += ' — DOWNED BY A TRAUMATIC HIT · GM: PHYSICAL SAVE OR MAJOR INJURY';
                      else if (down) history += ' — MORTALLY WOUNDED';
                      broadcastRoll(info.userName, outcome ?? { rolls: {}, modTotal: 0, total: amount }, history, color, () => {
                        emitResult({ ...resultExtras, targetHp: newHp, targetDown: down, frailDeath: down && frail });
                      });
                    });
                  });
                };

                if (!hit) {
                  const shock = attackCwn.shockDamage(attackerData, weapon, ac);
                  return broadcastRoll(info.userName, toHit, hitHistory, color, () => {
                    if (shock <= 0) return emitResult({});
                    dealDamage(shock, null, `${weapon.name} SHOCK vs ${target.name} — ${shock} damage on the miss`, { shock, damage: shock, through: shock }, false);
                  });
                }

                broadcastRoll(info.userName, toHit, hitHistory, color, () => {
                  let dmg;
                  try { dmg = attackCwn.rollDamage(attackerData, weapon); } catch (e) { return emitResult({}); }
                  // Trauma resolves vs the DEFENDER's Trauma Target (sheet
                  // field trauma_target, default 6); the weapon rating is
                  // the damage multiplier.
                  getDefenderSheet(target, system, (defender) => {
                    const defenderData = defender ? JSON.parse(defender.data || '{}') : {};
                    const trauma = attackCwn.rollTrauma(weapon, traumaOn, defenderData.trauma_target);
                    const traumatic = !!(trauma && trauma.traumatic);
                    const total = Math.max(0, traumatic ? dmg.total * trauma.rating : dmg.total);
                    let dmgHistory = `${weapon.name} damage vs ${target.name} [${dmg.breakdown} = ${dmg.total}]`;
                    if (trauma) {
                      dmgHistory += traumatic
                        ? ` — TRAUMA d${trauma.die}: ${trauma.roll} vs TT ${trauma.tt} — TRAUMATIC HIT x${trauma.rating} = ${total}`
                        : ` — trauma d${trauma.die}: ${trauma.roll} < TT ${trauma.tt}, no trauma`;
                    }
                    dealDamage(total, dmg, dmgHistory, {
                      damage: total, through: total,
                      traumatic, traumaRoll: trauma ? trauma.roll : null,
                    }, traumatic);
                  });
                });
              });
            }
          );
        }
      );
    };

    socket.on('sheetAttack', (payload) => {
      const info = userSockets.get(socket.id);
      if (!info || !info.userName) return;
      if (!payload || !payload.targetId) return;
      pendingAttacks.delete(socket.id); // sheet attacks resolve in one step - no manual roll pending
      const color = typeof payload.color === 'string' ? payload.color : '#00ff00';
      getGameSystem((err, system) => {
        if (err) return;
        if (system === 'cities_without_number') return handleCwnAttack(info, payload, color);
        if (system !== 'cyberpunk_red') return;
        db.get(
          `SELECT data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
          [info.userName, system],
          (err2, sheetRow) => {
            if (err2 || !sheetRow) return;
            const attackerData = JSON.parse(sheetRow.data || '{}');
            const weapon = sheetAttack.getWeapon(attackerData, payload.weaponIndex);
            if (!weapon) {
              return socket.emit('sheetAttackError', { message: 'INVALID_WEAPON // SET NAME, DMG (e.g. 3d6) AND SKILL ON YOUR SHEET' });
            }
            const aimed = !!payload.aimed;
            db.get(
              `SELECT id, name, owner, x, z, melee_ac, ranged_ac, shape, battle_map_id, floor_index,
                      hp_current, hp_max, hp_temp
               FROM locations WHERE id = ?`,
              [payload.targetId],
              (err3, target) => {
                if (err3 || !target || !RHOMBUS_SHAPES.includes(target.shape)) return;
                const meleeDv = target.melee_ac !== null && target.melee_ac !== undefined ? target.melee_ac : 10;
                const rangedDv = target.ranged_ac !== null && target.ranged_ac !== undefined ? target.ranged_ac : meleeDv;
                const dv = weapon.attackType === 'ranged' ? rangedDv : meleeDv;

                db.get(
                  `SELECT hp_current FROM locations WHERE shape = 'rhombus' AND owner = ?
                   ORDER BY (battle_map_id IS NULL) DESC LIMIT 1`,
                  [info.userName],
                  (hpErr, hpRow) => {
                db.get(`SELECT value FROM global_settings WHERE key = 'luck_negates_fumble'`, (lnErr, lnRow) => {
                const luckNegatesFumble = !lnErr && lnRow && lnRow.value === '1';
                // Declared LUCK on the to-hit: flat bonus and/or 1-pip fumble
                // shield - the shield only exists while the house rule is on
                const spend = sheetAttack.resolveLuckSpend(
                  attackerData.luck,
                  Number.isInteger(payload.luck) ? payload.luck : 0,
                  payload.luckNegate === true && luckNegatesFumble
                );
                const noFumble = spend.negate || (luckNegatesFumble && spend.bonus > 0);
                const luck = spend.total;
                const attackerHp = !hpErr && hpRow ? hpRow.hp_current : null;
                let toHit;
                try { toHit = sheetAttack.rollToHit(attackerData, weapon, aimed, Math.random, { luck: spend.bonus, noFumble, hp: attackerHp }); } catch (e) { return; }
                const hit = toHit.total >= dv;
                const critTag = toHit.critical === 'success' ? ' — CRITICAL!'
                  : toHit.critical === 'failure' ? ' — FUMBLE!' : '';
                const aimedTag = aimed ? ' (AIMED)' : '';
                const luckTag = (spend.bonus > 0 ? ` (LUCK +${spend.bonus})` : '')
                  + (spend.negate ? ' (LUCK: FUMBLE SHIELD)' : '');
                const woundTag = attackerHp !== null && attackerHp <= 0 ? ' (MORTALLY WOUNDED -4)'
                  : attackerHp !== null && Number(attackerData.seriously_wounded) > 0 && attackerHp <= Number(attackerData.seriously_wounded) ? ' (WOUNDED -2)' : '';
                const hitHistory =
                  `${info.userName} attacks ${target.name} with ${weapon.name}${aimedTag}${luckTag}${woundTag} ` +
                  `[${toHit.breakdown} = ${toHit.total} vs DV ${dv}] — ${hit ? 'HIT' : 'MISS'}${critTag}`;
                // Spend the declared LUCK
                if (luck > 0) {
                  attackerData.luck = Math.max(0, (Number(attackerData.luck) || 0) - luck);
                  db.run(
                    `UPDATE character_sheets SET data = ?, updated_at = CURRENT_TIMESTAMP
                     WHERE username = ? AND system = ? AND is_npc = 0`,
                    [JSON.stringify(attackerData), info.userName, system],
                    () => io.emit('sheetUpdated', { username: info.userName, system })
                  );
                }

                const emitResult = (extra) => {
                  const onBattleMap = target.battle_map_id !== null && target.battle_map_id !== undefined;
                  const attackerSql = onBattleMap
                    ? 'SELECT x, z FROM locations WHERE shape = "rhombus" AND owner = ? AND battle_map_id = ? AND floor_index = ?'
                    : 'SELECT x, z FROM locations WHERE shape = "rhombus" AND owner = ? AND battle_map_id IS NULL';
                  const attackerParams = onBattleMap
                    ? [info.userName, target.battle_map_id, target.floor_index]
                    : [info.userName];
                  db.get(attackerSql, attackerParams, (posErr, attackerRow) => {
                    io.emit('attackResult', {
                      hit,
                      attackerId: socket.id,
                      attackerName: info.userName,
                      targetId: target.id,
                      targetName: target.name,
                      attackType: weapon.attackType,
                      roll: toHit.total,
                      ac: dv,
                      attackerPos: attackerRow ? { x: attackerRow.x, z: attackerRow.z } : null,
                      targetPos: { x: target.x, z: target.z },
                      isBattleMap: onBattleMap,
                      weaponName: weapon.name,
                      aimed,
                      ...extra,
                    });
                  });
                };

                if (!hit) return broadcastRoll(info.userName, toHit, hitHistory, color, () => emitResult({}));

                // Hit: damage, SP soak, ablation, HP write-through.
                broadcastRoll(info.userName, toHit, hitHistory, color, () => {
                  let dmg;
                  try { dmg = sheetAttack.rollDamage(weapon); } catch (e) { return emitResult({}); }
                  getDefenderSheet(target, system, (defender) => {
                    const defenderData = defender ? JSON.parse(defender.data || '{}') : {};
                    const spField = aimed ? 'sp_head' : 'sp_body';
                    const sp = Number(defenderData[spField]) || 0;

                    // Shield intercepts first (only when the defender has a sheet)
                    const shieldBefore = defender ? (Number(defenderData.sp_shield) || 0) : 0;
                    const shield = sheetAttack.applyShield(dmg.total, shieldBefore);
                    // Overflow past the shield soaks against location SP
                    const { through: armorThrough, ablated } = sheetAttack.applyArmor(shield.remaining, sp, aimed);
                    // Critical injury (2+ max-face damage dice): bonus damage ignores armor
                    const crit = sheetAttack.isCriticalInjury(dmg.rolls);
                    const through = armorThrough + (crit ? sheetAttack.CRIT_BONUS_DAMAGE : 0);
                    const location = aimed ? 'HEAD' : 'BODY';

                    let dmgHistory = `${weapon.name} damage vs ${target.name} [${dmg.breakdown} = ${dmg.total}]`;
                    if (shield.absorbed > 0) {
                      dmgHistory += ` — SHIELD absorbs ${shield.absorbed}${shield.destroyed ? ' (SHIELD DOWN)' : ` (${shield.newShield} left)`}`;
                    }
                    if (shield.remaining > 0) {
                      dmgHistory += ` — SP ${location} ${sp} soaks ${Math.min(sp, shield.remaining)}` +
                        (armorThrough > 0
                          ? `, ${armorThrough} DAMAGE THROUGH${aimed ? ' (HEADSHOT x2)' : ''}${ablated && defender ? ', SP ABLATES -1' : ''}`
                          : ' — NO PENETRATION');
                    }
                    if (crit) {
                      dmgHistory += ` — CRITICAL INJURY! +${sheetAttack.CRIT_BONUS_DAMAGE} DIRECT · GM: ROLL THE INJURY TABLE`;
                    }

                    const resultExtras = {
                      damage: dmg.total, sp, through, ablated, location,
                      shieldAbsorbed: shield.absorbed, shieldLeft: shield.newShield,
                      criticalInjury: crit,
                    };

                    const finish = () => {
                      broadcastRoll(info.userName, dmg, dmgHistory, color, () => {
                        if (through <= 0) return emitResult({ ...resultExtras, through: 0 });
                        applyTokenDamage(target, through, (newHp) => {
                          emitResult({ ...resultExtras, targetHp: newHp, targetDown: newHp <= 0 });
                        });
                      });
                    };

                    const sheetChanged = defender && ((ablated && shield.remaining > 0) || shield.absorbed > 0);
                    if (sheetChanged) {
                      if (ablated && shield.remaining > 0) defenderData[spField] = Math.max(0, sp - 1);
                      if (shield.absorbed > 0) defenderData.sp_shield = shield.newShield;
                      db.run(
                        `UPDATE character_sheets SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                        [JSON.stringify(defenderData), defender.id],
                        () => {
                          if (!defender.is_npc) io.emit('sheetUpdated', { username: defender.username, system });
                          finish();
                        }
                      );
                    } else {
                      finish();
                    }
                  });
                });
                });
                  }
                );
              }
            );
          }
        );
      });
    });

    // ── CP:R death saves ─────────────────────────────────────────────────────
    // Only meaningful at 0 HP or less. The escalating penalty lives in the
    // sheet's own data (death_save_penalty) and resets when healed above 0.
    socket.on('requestDeathSave', () => {
      const info = userSockets.get(socket.id);
      if (!info || !info.userName) return;
      getGameSystem((err, system) => {
        if (err || system !== 'cyberpunk_red') return;
        db.get(
          `SELECT id, data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
          [info.userName, system],
          (err2, row) => {
            if (err2 || !row) return;
            db.get(
              `SELECT hp_current FROM locations WHERE shape = 'rhombus' AND owner = ?
               ORDER BY (battle_map_id IS NULL) DESC LIMIT 1`,
              [info.userName],
              (err3, hpRow) => {
                if (err3 || !hpRow) return;
                if (hpRow.hp_current === null || hpRow.hp_current > 0) return;
                const data = JSON.parse(row.data || '{}');
                const body = Number(data.body) || 0;
                const save = sheetAttack.rollDeathSave(body, data.death_save_penalty);
                data.death_save_penalty = save.penalty + 1;
                const penTag = save.penalty > 0 ? `+${save.penalty} ` : '';
                const historyString =
                  `${info.userName} DEATH SAVE [${save.die} ${penTag}= ${save.total} vs BODY ${body}] — ` +
                  (save.success ? 'STABILIZED THIS ROUND' : save.die === 10 ? 'NATURAL 10 — DEAD' : 'DEAD');
                // Roll broadcasts first; the penalty write + banner refresh land
                // after the client's 5s dice animation so the sheet doesn't
                // change mid-roll.
                const outcome = { rolls: { 10: [save.die] }, modTotal: save.penalty, total: save.total };
                broadcastRoll(info.userName, outcome, historyString, '#ff3333', () => {
                  setTimeout(() => {
                    db.run(
                      `UPDATE character_sheets SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                      [JSON.stringify(data), row.id],
                      () => {
                        io.emit('sheetUpdated', { username: info.userName, system });
                        io.emit('deathSaveResult', {
                          userName: info.userName,
                          die: save.die,
                          penalty: save.penalty,
                          total: save.total,
                          body,
                          success: save.success,
                        });
                      }
                    );
                  }, DICE_ANIM_MS);
                });
              }
            );
          }
        );
      });
    });

    // ── CWN stabilization ────────────────────────────────────────────────────
    // At 0 HP a CWN character is Mortally Wounded (dead after 6 rounds). The
    // clicking user's own sheet provides the Heal skill: 2d6 + Heal + INT mod
    // vs 8 + rounds down. Success: target back to 1 HP with the Frail
    // condition. Failure burns a round; the tracked count lives on the
    // TARGET's sheet (rounds_since_downed) and resets when healed above 0.
    socket.on('requestStabilize', (payload) => {
      const info = userSockets.get(socket.id);
      if (!info || !info.userName) return;
      const targetUsername = String(payload?.targetUsername || '').trim();
      if (!targetUsername) return;
      getGameSystem((err, system) => {
        if (err || system !== 'cities_without_number') return;
        db.get(
          `SELECT data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
          [info.userName, system],
          (err2, rollerRow) => {
            if (err2 || !rollerRow) return;
            const rollerData = JSON.parse(rollerRow.data || '{}');
            db.get(
              `SELECT id, data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
              [targetUsername, system],
              (err3, targetRow) => {
                if (err3 || !targetRow) return;
                db.get(
                  `SELECT hp_current, hp_max FROM locations WHERE shape = 'rhombus' AND owner = ?
                   ORDER BY (battle_map_id IS NULL) DESC LIMIT 1`,
                  [targetUsername],
                  (err4, hpRow) => {
                    if (err4 || !hpRow) return;
                    if (hpRow.hp_current === null || hpRow.hp_current > 0) return;
                    const targetData = JSON.parse(targetRow.data || '{}');
                    if (Number(targetData.frail) === 1) return; // Frail at 0 HP = dead, nothing to stabilize
                    if (stabilizeInFlight.has(targetUsername)) return; // roll already resolving
                    const rounds = Math.max(0, Number(targetData.rounds_since_downed) || 0);
                    const noTools = payload?.noTools === true;
                    let check;
                    try { check = attackCwn.rollStabilize(rollerData, rounds, noTools); } catch (e) { return; }
                    stabilizeInFlight.add(targetUsername);

                    // The roll broadcasts first; the sheet/HP consequences land
                    // after the client's 5s dice animation so the banner doesn't
                    // spoil the result mid-roll.
                    const applyOutcome = () => {
                      stabilizeInFlight.delete(targetUsername);
                      io.emit('stabilizeResult', {
                        roller: info.userName,
                        target: targetUsername,
                        total: check.total,
                        dc: check.dc,
                        success: check.success,
                      });
                      if (check.success) {
                        targetData.frail = 1;
                        targetData.rounds_since_downed = 0;
                        db.run(
                          `UPDATE character_sheets SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                          [JSON.stringify(targetData), targetRow.id],
                          () => {
                            db.run(
                              `UPDATE locations SET hp_current = 1 WHERE shape = 'rhombus' AND owner = ?`,
                              [targetUsername],
                              () => {
                                emitUpdate({ isRhombusOnly: true });
                                io.emit('sheetUpdated', { username: targetUsername, system });
                              }
                            );
                          }
                        );
                      } else {
                        db.run(
                          `UPDATE character_sheets SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                          [JSON.stringify(targetData), targetRow.id],
                          () => io.emit('sheetUpdated', { username: targetUsername, system })
                        );
                      }
                    };

                    const fmt = (n) => (n >= 0 ? `+${n}` : `${n}`);
                    const partsTag = ` (HEAL ${fmt(check.healSkill)}, INT ${fmt(check.intMod)})`;
                    let historyString;
                    if (check.success) {
                      historyString =
                        `${info.userName} stabilizes ${targetUsername}${partsTag} [${check.breakdown} = ${check.total} vs DC ${check.dc}] — ` +
                        `STABILIZED AT 1 HP — NOW FRAIL`;
                    } else {
                      const newRounds = rounds + 1;
                      targetData.rounds_since_downed = newRounds;
                      const dead = newRounds >= attackCwn.MORTAL_WOUND_ROUNDS;
                      historyString =
                        `${info.userName} tries to stabilize ${targetUsername}${partsTag} [${check.breakdown} = ${check.total} vs DC ${check.dc}] — FAILED` +
                        (dead ? ` — ${attackCwn.MORTAL_WOUND_ROUNDS} ROUNDS DOWN — DEAD` : ` (round ${newRounds} of ${attackCwn.MORTAL_WOUND_ROUNDS})`);
                    }
                    broadcastRoll(info.userName, check, historyString, check.success ? '#00ff00' : '#ff3333', () => {
                      setTimeout(applyOutcome, DICE_ANIM_MS);
                    });
                  }
                );
              }
            );
          }
        );
      });
    });

    // ── CWN Deluxe: cast a spell row ─────────────────────────────────────────
    // Spells are player-entered (name / effect / dmg dice / effort cost) -
    // the app knows no spell rules. One click: rolls the damage dice (if
    // any), spends the Effort cost, and broadcasts the effect. Casting with
    // insufficient Effort is an OVERCAST - the GM rolls the consequence
    // table and applies System Strain by hand.
    socket.on('castSpell', (payload) => {
      const info = userSockets.get(socket.id);
      if (!info || !info.userName) return;
      const index = Number(payload?.index);
      if (!Number.isInteger(index) || index < 1 || index > 4) return;
      getGameSystem((err, system) => {
        if (err || system !== 'cities_without_number') return;
        db.get(`SELECT value FROM global_settings WHERE key = 'cwn_deluxe'`, (dErr, dRow) => {
          if (dErr || !dRow || dRow.value !== '1') return; // Deluxe off
          db.get(
            `SELECT id, data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
            [info.userName, system],
            (err2, row) => {
              if (err2 || !row) return;
              const data = JSON.parse(row.data || '{}');
              const name = String(data[`spell${index}_name`] || '').trim();
              if (!name) return;
              const effect = String(data[`spell${index}_effect`] || '').trim();
              const dmgStr = String(data[`spell${index}_dmg`] || '').trim();
              const cost = Math.max(0, Number(data[`spell${index}_cost`]) || 0);
              const effort = Math.max(0, Number(data.mage_effort) || 0);
              const overcast = cost > effort;

              // Optional damage dice (pure dice + flat, same rule as weapons)
              let dmg = null;
              if (/^\d+d\d+([+-]\d+)?$/i.test(dmgStr)) {
                try {
                  dmg = rollEngine.executeRoll(rollEngine.resolveFormula(dmgStr, {}), 'sum');
                } catch (e) { dmg = null; }
              }

              const costTag = cost > 0 ? ` (${cost} EFFORT)` : '';
              const overcastTag = overcast ? ' — OVERCAST! GM: d20 + Cast + CON mod on the consequence table' : '';
              const effectTag = effect ? ` — ${effect}` : '';
              const dmgTag = dmg ? ` [${dmg.breakdown} = ${dmg.total} damage]` : '';
              const historyString = `${info.userName} casts ${name}${costTag}${dmgTag}${effectTag}${overcastTag}`;

              const finish = () => {
                const outcome = dmg ?? { rolls: {}, modTotal: 0, total: 0 };
                broadcastRoll(info.userName, outcome, historyString, overcast ? '#ff3333' : '#bb66ff', () => {
                  io.emit('spellCast', { userName: info.userName, name, overcast, damage: dmg ? dmg.total : null });
                });
              };

              if (cost > 0) {
                data.mage_effort = Math.max(0, effort - cost);
                db.run(
                  `UPDATE character_sheets SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                  [JSON.stringify(data), row.id],
                  () => {
                    io.emit('sheetUpdated', { username: info.userName, system });
                    finish();
                  }
                );
              } else {
                finish();
              }
            }
          );
        });
      });
    });

    // ── Radio Feed ──────────────────────────────────────────────────────────────

    socket.on('musicLoad', (data) => {
      if (!isAdminSocket(socket)) return;
      const { trackId, src, name } = data;
      musicState = { ...musicState, playing: false, trackId, src, name, position: 0 };
      musicReadySet.clear();
      if (musicReadyTimeout) { clearTimeout(musicReadyTimeout); musicReadyTimeout = null; }
      io.emit('musicLoad', { trackId, src, name });

      // Gate: wait for all non-spectator sockets to report ready, or 5s timeout.
      const expectedCount = [...userSockets.values()].length;
      if (expectedCount === 0) { startPlayback(0); return; }
      musicReadyTimeout = setTimeout(resolveReady, 5000);
    });

    socket.on('musicReady', () => {
      musicReadySet.add(socket.id);
      const expectedCount = [...userSockets.keys()].length;
      if (musicReadySet.size >= expectedCount) resolveReady();
    });

    socket.on('musicPause', (data) => {
      if (!isAdminSocket(socket)) return;
      musicState.playing = false;
      musicState.position = data.position ?? musicState.position;
      io.emit('musicPause', { position: musicState.position });
    });

    // Resume from the paused position — no buffering gate (track is already loaded).
    socket.on('musicResume', () => {
      if (!isAdminSocket(socket)) return;
      if (!musicState.src) return;
      startPlayback(musicState.position);
    });

    socket.on('musicSeek', (data) => {
      if (!isAdminSocket(socket)) return;
      musicState.position = data.position ?? 0;
      const payload = { position: musicState.position, timestamp: Date.now() };
      io.emit('musicSeek', payload);
    });

    socket.on('musicNext', (data) => {
      if (!isAdminSocket(socket)) return;
      const { trackId, src, name } = data;
      musicState = { ...musicState, playing: true, trackId, src, name, position: 0 };
      io.emit('musicNext', { trackId, src, name });
    });

    socket.on('musicPrev', (data) => {
      if (!isAdminSocket(socket)) return;
      const { trackId, src, name } = data;
      musicState = { ...musicState, playing: true, trackId, src, name, position: 0 };
      io.emit('musicPrev', { trackId, src, name });
    });

    socket.on('musicShuffle', (data) => {
      if (!isAdminSocket(socket)) return;
      musicState.shuffle = !!data.enabled;
      io.emit('musicShuffle', { enabled: musicState.shuffle });
    });

    socket.on('musicLoop', (data) => {
      if (!isAdminSocket(socket)) return;
      musicState.loop = !!data.enabled;
      io.emit('musicLoop', { enabled: musicState.loop });
    });

    // Streamer mode: admin pushes director state (camera mode, target, visibility, HUD).
    socket.on('directorUpdate', (state) => {
      if (!isAdminSocket(socket) || !state) return;
      directorState = state;
      io.to('spectators').emit('directorUpdate', directorState);
    });

    // Streamer mode: transient admin camera pose for mirror mode (~10Hz, not stored).
    socket.on('streamerCamera', (pose) => {
      if (!isAdminSocket(socket)) return;
      socket.to('spectators').emit('streamerCamera', pose);
    });

    // Streamer mode: admin hover over a rhombus — spectators show its name tag.
    socket.on('streamerHover', (data) => {
      if (!isAdminSocket(socket)) return;
      socket.to('spectators').emit('streamerHover', data);
    });

    // Streamer mode: transient battle map camera pose (pan x/z + ortho zoom, ~10Hz).
    socket.on('streamerBattleCamera', (pose) => {
      if (!isAdminSocket(socket)) return;
      socket.to('spectators').emit('streamerBattleCamera', pose);
    });

    socket.on('disconnect', () => {
      pendingAttacks.delete(socket.id);
      if (socket.isSpectator) {
        console.log('Spectator disconnected:', socket.id);
        broadcastSpectatorCount();
        return;
      }
      const info = userSockets.get(socket.id);
      if (info) {
        console.log('User disconnected:', socket.id, 'Username:', info.userName);
        userSockets.delete(socket.id);
        // Emit rhombusFading first, then broadcastActiveUsers so clients start
        // the fade animation before isOnline flips to false in their useFrame loop.
        db.get('SELECT id FROM locations WHERE shape = "rhombus" AND owner = ?', [info.userName], (err, row) => {
          if (!err && row) io.emit('rhombusFading', { id: row.id, owner: info.userName });
          broadcastActiveUsers();
        });
      }
    });
  });
};
