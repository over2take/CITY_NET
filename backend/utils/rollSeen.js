// A roll as each person is sent it (6c4h; approved mockup docs/mockups/players-see-target.html,
// 2026-10-24). Where a roll's target is kept from players (systemBuilder/tableRolls.js `players`), the
// GM gets all of it and anyone else, a spectator and the streamer overlay included, the players'
// version. The GM here is the main admin only: granted editors see what players see (the user,
// 2026-10-24). A roll everyone sees alike still goes out once, to everyone, as every roll did.

/** `data` as one person is sent it. The players' version never goes out as itself: it only replaces the GM's words. */
const rollFor = (data, isGm) => {
  const { players, ...sent } = data;
  if (isGm || !players) return sent;
  return { ...sent, historyString: players.historyText, board: players.board };
};

/**
 * Send a roll: to everyone at once where all see it alike, otherwise each of `connections` (the
 * sockets connected now) its own, `isGm(socket)` saying whose is the GM's.
 */
const emitRoll = (io, connections, isGm, data) => {
  if (!data.players) return io.emit('diceRollBroadcast', rollFor(data, true));
  for (const socket of connections.values()) socket.emit('diceRollBroadcast', rollFor(data, isGm(socket)));
};

/** A stored roll's line for the history replayed to one person: the players' where it has one. */
const historyFor = (row, isGm) => (isGm || !row.players_history ? row.historyString || '' : row.players_history);

module.exports = { rollFor, emitRoll, historyFor };
