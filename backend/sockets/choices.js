// Picking on the sheet, over the socket (7a3a): `choicesAction` with { kind, list, option, level, from }
// or { kind: 'use', feature, spent } or { kind: 'recovery', pool, spent } (R2a), for the caller's own character; the GM may name another
// player's with `username`. What may be done, and by whom, is systemBuilder/picking.js's; this stores
// it through the sheet queue (sheets/mutate.js), works the numbers out again, and tells every screen
// the sheet changed, as a field edit does. A refusal goes back to the one who asked, in words. A
// feature changing the token's maximum moves the token too (systemBuilder/tokenMax.js, 7a5a3).
//
// { kind: 'roll', list, from } (7a5b2) is ROLL FOR IT: rolled on the secure dice inside the sheet's
// write queue, kept on the sheet, and a dice-log line for everyone, the tray throwing it as any roll.
//
// `restTake` with { rest } (R3a) takes one of the game's rests on the caller's own character, from
// their sheet: in a system whose rests are finished on each sheet; the GM may on anyone's, always.
//
// `creationAction` with { kind: 'open' | 'at' | 'finish', step } (7c2) moves a character through the
// guided new character, with { kind: 'place', step, stat, value } (7c3b) puts a number on a stat, and
// with { kind: 'roll', step } (7c3c) rolls a step's stats on the secure dice, inside the sheet's write
// queue, written to the log and thrown in the tray as ROLL FOR IT is (systemBuilder/creation.js). A stat
// can move the token's maximum, so it follows, as a pick's does. FINISH gives out their kits (7c4b) in the
// same write, so they land once, with the game's catalogues loaded first (sheets/kitGiving.js), and pays in
// their starting money (7c4d) once that write has stood, as it comes only from there. What the options they
// hold give (7c4e) comes the same way, and { kind: 'giftRoll', option, id } rolls an option's money.
//
// `recoverySpend` with { pool, count } (R2a) spends recovery dice with a roll (sheets/recover.js).
// In a system leaving spending to the GM, a player spends or ticks them off only while the GM has
// spending open (recovery.js maySpend); the GM always may.

const crypto = require('crypto');
const { pickAction, rollLine } = require('../systemBuilder/picking');
const { withThrow, boardOf } = require('../utils/diceThrow');
const { syncTokenMax } = require('../systemBuilder/tokenMax');
const { maySpend, restingOf, OPEN_SETTING } = require('../systemBuilder/recovery');
const { creationAction, statRollLine } = require('../systemBuilder/creation');
const { kitPatch } = require('../sheets/kitGiving');
const { takeRest } = require('../sheets/rests');
const customSystems = require('../systemBuilder/runtime');
const sheetTemplates = require('../sheets/templates');
const { mutateSheetForUser } = require('../sheets/mutate');
const { spendRecovery } = require('../sheets/recover');

const KINDS = new Set(['pick', 'drop', 'level', 'use', 'recovery', 'roll']);
const LOG_COLOR = '#00ff00';
const cryptoRng = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
/** The most recovery dice one spend rolls from a pool. */
const MOST_SPENT = 100;
const CLOSED = 'The GM hasn\'t opened spending recovery dice';
const REST_AT_CALL = 'In this game, rests are taken when the GM calls them';

/** Whether the GM has spending recovery dice open. */
const spendingOpen = (db, cb) => db.get('SELECT value FROM global_settings WHERE key = ?', [OPEN_SETTING], (err, row) => cb(!err && !!row && row.value === '1'));

/** Registered once per connection by sockets/index.js, with what it already knows of the caller. */
const registerChoicesHandlers = (socket, { io, db, userSockets, isAdminSocket, getGameSystem, getShopSystem, withMoney, sendBankUpdate, rng = cryptoRng }) => {
  /** A roll on the sheet said to everyone (7a5b2): a dice-log line, and the roll thrown in the tray. */
  const announceRoll = (username, stored, rolled, lineOf, board) => {
    const who = (stored && typeof stored.name === 'string' && stored.name.trim()) || username;
    const line = lineOf(who, rolled);
    const results = { [rolled.sides]: rolled.rolls };
    db.get(`SELECT color FROM locations WHERE shape = 'rhombus' AND owner = ? ORDER BY id LIMIT 1`, [username], (e, token) => {
      const color = (token && typeof token.color === 'string' && token.color) || LOG_COLOR;
      db.run('INSERT INTO dice_rolls (username, total, results, color, historyString) VALUES (?, ?, ?, ?, ?)', [username, rolled.total, JSON.stringify(results), color, line], (err) => {
        if (err) console.error('[choices] roll not logged:', err.message);
      });
      io.emit('diceRollBroadcast', withThrow({
        userName: who, account: username, results, modifiers: [], color, total: rolled.total, historyString: line,
        board: boardOf(board),
      }));
    });
  };
  /**
   * The caller, the character they act on, and the running system's definition, or a refusal sent:
   * `none` in words when the game is a built-in one.
   */
  const withCaller = (payload, refused, go, none = 'This game has no choices to pick from') => {
    const info = userSockets.get(socket.id);
    if (!info || !info.userName) return;
    const refuse = (error) => socket.emit(refused, { error });
    const gm = isAdminSocket(socket);
    // A player acts on their own character only; the GM on any player's they name.
    const username = gm && typeof payload.username === 'string' && payload.username ? payload.username : info.userName;
    getGameSystem((err, system) => {
      if (err) return;
      const definition = customSystems.definitionOf(system);
      if (!definition) return refuse(none);
      return go({ gm, username, system, definition, refuse });
    });
  };
  /** Goes on only while the caller may spend recovery dice. */
  const whileSpending = (definition, gm, refuse, go) => spendingOpen(db, (open) => (maySpend(definition, { gm, open }) ? go() : refuse(CLOSED)));

  socket.on('choicesAction', (payload) => {
    if (!payload || typeof payload !== 'object' || !KINDS.has(payload.kind)) return;
    withCaller(payload, 'choicesRefused', ({ gm, username, system, definition, refuse }) => {
      const act = () => {
        let error = null;
        let rolled = null;
        mutateSheetForUser(db, { username, system }, (data) => {
          const done = pickAction(definition, data, payload, { gm, rng });
          if (!done.ok) { error = done.error; return undefined; }
          rolled = done.rolled || null;
          sheetTemplates.applyDerived(system, done.data);
          return done.data;
        }, (err2, stored) => {
          if (error) return refuse(error);
          if (err2) return refuse('That character has no sheet yet');
          if (!stored) return undefined;
          if (rolled) announceRoll(username, stored, rolled, rollLine, String(rolled.list.one || rolled.list.id).toUpperCase());
          return syncTokenMax(db, system, username, (moved) => {
            if (moved) io.emit('dataUpdated', { isRhombusOnly: true });
            io.emit('sheetUpdated', { username, system });
          });
        });
      };
      return payload.kind === 'recovery' ? whileSpending(definition, gm, refuse, act) : act();
    });
  });

  socket.on('creationAction', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    withCaller(payload, 'choicesRefused', ({ username, system, definition, refuse }) => getShopSystem(() => {
      let error = null;
      let rolls = [];
      let pay = [];
      mutateSheetForUser(db, { username, system }, (data) => {
        const done = creationAction(definition, data, payload, { rng });
        if (!done.ok) { error = done.error; return undefined; }
        rolls = done.rolls || (done.rolled ? [done.rolled] : []);
        pay = done.pay || [];
        if (done.items && done.items.length) Object.assign(done.data, kitPatch(system, done.items, done.data));
        // Worked out as any save is, so a list asked first already knows what isn't met.
        if (done.data) sheetTemplates.applyDerived(system, done.data);
        return done.data;
      }, (err2, stored) => {
        if (error) return refuse(error);
        if (err2) return refuse('That character has no sheet yet');
        if (!stored) return undefined;
        for (const rolled of rolls) announceRoll(username, stored, rolled, statRollLine, rolled.label);
        for (const { id, amount } of pay) {
          withMoney(id ? { currency: id } : {}, (money) => money.add(username, amount, (e) => {
            if (e) console.error('[creation] starting money not paid:', e.message);
            sendBankUpdate(username);
          }));
        }
        return syncTokenMax(db, system, username, (moved) => {
          if (moved) io.emit('dataUpdated', { isRhombusOnly: true });
          io.emit('sheetUpdated', { username, system });
        });
      });
    }), 'This game has no guided new character');
  });

  socket.on('restTake', (payload) => {
    if (!payload || typeof payload !== 'object' || typeof payload.rest !== 'string') return;
    withCaller(payload, 'restRefused', async ({ gm, username, system, definition, refuse }) => {
      if (!gm && restingOf(definition).finish !== 'sheet') return refuse(REST_AT_CALL);
      try {
        const done = await takeRest(db, io, { system, definition, restId: payload.rest, username, by: gm ? 'gm' : 'player' });
        if (done.error) refuse(done.error);
      } catch (e) {
        console.error('[rests] rest not taken:', e.message);
        refuse('The rest could not be taken');
      }
      return undefined;
    }, 'This game\'s rests are its own buttons');
  });

  socket.on('recoverySpend', (payload) => {
    if (!payload || typeof payload !== 'object' || typeof payload.pool !== 'string') return;
    const count = Number(payload.count);
    if (!Number.isInteger(count) || count < 1 || count > MOST_SPENT) return;
    withCaller(payload, 'recoveryRefused', ({ gm, username, system, definition, refuse }) => whileSpending(definition, gm, refuse, async () => {
      try {
        const done = await spendRecovery(db, io, { system, definition, username, pool: payload.pool, count });
        if (!done.ok) refuse(done.error);
      } catch (e) {
        console.error('[recovery] spend failed:', e.message);
        refuse('The dice could not be spent');
      }
    }), 'This game has no recovery dice');
  });
};

module.exports = { registerChoicesHandlers, CLOSED, REST_AT_CALL };
