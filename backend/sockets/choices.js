// Picking on the sheet, over the socket (7a3a): `choicesAction` with { kind, list, option, level, from }
// or { kind: 'use', feature, spent }, for the caller's own character; the GM may name another
// player's with `username`. What may be done, and by whom, is systemBuilder/picking.js's; this stores
// it through the sheet queue (sheets/mutate.js), works the numbers out again, and tells every screen
// the sheet changed, as a field edit does. A refusal goes back to the one who asked, in words. A
// feature changing the token's maximum moves the token too (systemBuilder/tokenMax.js, 7a5a3).

const { pickAction } = require('../systemBuilder/picking');
const { syncTokenMax } = require('../systemBuilder/tokenMax');
const customSystems = require('../systemBuilder/runtime');
const sheetTemplates = require('../sheets/templates');
const { mutateSheetForUser } = require('../sheets/mutate');

const KINDS = new Set(['pick', 'drop', 'level', 'use']);

/** Registered once per connection by sockets/index.js, with what it already knows of the caller. */
const registerChoicesHandlers = (socket, { io, db, userSockets, isAdminSocket, getGameSystem }) => {
  socket.on('choicesAction', (payload) => {
    const info = userSockets.get(socket.id);
    if (!info || !info.userName) return;
    if (!payload || typeof payload !== 'object' || !KINDS.has(payload.kind)) return;
    const refuse = (error) => socket.emit('choicesRefused', { error });
    const gm = isAdminSocket(socket);
    // A player acts on their own character only; the GM on any player's they name.
    const username = gm && typeof payload.username === 'string' && payload.username ? payload.username : info.userName;
    getGameSystem((err, system) => {
      if (err) return;
      const definition = customSystems.definitionOf(system);
      if (!definition) return refuse('This game has no choices to pick from');
      let error = null;
      mutateSheetForUser(db, { username, system }, (data) => {
        const done = pickAction(definition, data, payload, { gm });
        if (!done.ok) { error = done.error; return undefined; }
        sheetTemplates.applyDerived(system, done.data);
        return done.data;
      }, (err2, stored) => {
        if (error) return refuse(error);
        if (err2) return refuse('That character has no sheet yet');
        if (!stored) return undefined;
        return syncTokenMax(db, system, username, (moved) => {
          if (moved) io.emit('dataUpdated', { isRhombusOnly: true });
          io.emit('sheetUpdated', { username, system });
        });
      });
    });
  });
};

module.exports = { registerChoicesHandlers };
