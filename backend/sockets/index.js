const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;

const userSockets = new Map();
let activeNPCs = [];

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
  const broadcastActiveUsers = () => {
    const userMap = new Map();
    userSockets.forEach((info) => {
      userMap.set(info.userName, { ...info, isTemporaryAdmin: elevatedUsers.has(info.userName) });
    });
    activeNPCs.forEach(npc => {
      userMap.set(npc.userName, { userName: npc.userName, isAdmin: false, isTemporaryAdmin: false, isNPC: true, isActive: npc.isActive });
    });
    io.emit('activeUsersUpdated', Array.from(userMap.values()));
  };

  const sendBankUpdate = (username) => {
    db.get('SELECT balance, debt, first_pay_done FROM player_banks WHERE username = ?', [username], (err, row) => {
      if (!err && row) {
        io.emit('bankUpdate', { username, balance: row.balance, debt: row.debt, firstPayDone: !!row.first_pay_done });
      } else if (!err && !row) {
        db.run('INSERT INTO player_banks (username, balance, debt) VALUES (?, 0, 0)', [username], () => {
          io.emit('bankUpdate', { username, balance: 0, debt: 0, firstPayDone: false });
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

  io.on('connection', (socket) => {
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

    socket.on('requestEditing', (data) => { io.emit('editingRequested', data); });

    socket.on('approveEditing', (data) => {
      elevatedUsers.add(data.userId);
      const tempToken = jwt.sign({ username: data.userId, isTemporary: true }, SECRET, { expiresIn: '12h' });
      io.emit('accessGranted', { targetUser: data.userId, token: tempToken, forEditing: true });
      io.emit('editingStarted', data);
      io.emit('editingApproved', data);
    });

    socket.on('denyEditing', (data) => { io.emit('editingDenied', data); });
    socket.on('revokeEditing', (data) => { io.emit('editingStopped'); io.emit('editingRevoked', data); });
    socket.on('editingFinished', () => { io.emit('editingStopped'); });

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

    socket.on('markFirstPayDone', (data) => {
      if (!data || !data.username) return;
      db.run('UPDATE player_banks SET first_pay_done = 1 WHERE username = ?', [data.username]);
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

    socket.on('disconnect', () => {
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
