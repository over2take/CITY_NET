// A condition's EACH TURN rolled by the player, or the GM for an NPC (8a9a2; approved mockup
// docs/mockups/condition-turn-effects.html, 2026-11-19, the user: "would be nice to ask the user to roll, for enemies the GM
// rolls clearly"): what is waiting, and rolling it. The rolls, what they do and the log are tokens/turnEffects.js's.
//
//   requestTurnAsks              -> 'turnAsks' [{ id, sceneKey, locationId, player, who, condition, effect, moment, says }]: every
//                                    one for the GM (an editor too), a player's own for them.
//   turnRoll { id }, ack         -> { ok: true, line } or { ok: false, error }: a player rolls their own, the GM any.
//   'turnAsksChanged' (from the server, to everyone) -> ask again.

const customSystems = require('../systemBuilder/runtime');
const { asksFor, rollAsk } = require('../tokens/turnEffects');

const registerTurnAskHandlers = (socket, { io, db, userSockets, isAdminSocket, getGameSystem, emitUpdate = () => {} }) => {
  const caller = () => userSockets.get(socket.id);
  socket.on('requestTurnAsks', () => {
    const info = caller();
    if (!info) return;
    getGameSystem((err, system) => {
      if (err) return;
      asksFor(db, { runtime: customSystems, system, username: info.userName, gm: isAdminSocket(socket) })
        .then((asks) => socket.emit('turnAsks', asks), (e) => console.error('[turn asks]', e.message));
    });
  });
  socket.on('turnRoll', (payload, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const info = caller();
    if (!info) return reply({ ok: false, error: 'Sign in first' });
    const id = payload && Number.isInteger(payload.id) ? payload.id : null;
    if (id === null) return reply({ ok: false, error: 'Which roll?' });
    getGameSystem((err, system) => {
      if (err) return reply({ ok: false, error: 'Could not read the game' });
      rollAsk(db, { io, emitUpdate, runtime: customSystems, system, id, username: info.userName, gm: isAdminSocket(socket) })
        .then(reply, (e) => { console.error('[turn asks]', e.message); reply({ ok: false, error: 'That roll could not be made' }); });
    });
  });
};

module.exports = { registerTurnAskHandlers };
