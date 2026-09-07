// Awarding and taking back experience.
//
// Modelled on Pay Players, and deliberately different in one way. Money is a pot: the GM
// names a total and it is split between whoever was on the job. Experience is not. CWN
// p44 awards "3 experience points" to a character for a session survived, not three points
// shared between four of them - divide it and a full party earns less each than a pair
// would, which is the opposite of what the book says. So an award here is PER CHARACTER.
//
// Its own module rather than another branch in the socket file: the arithmetic is worth
// testing without a socket, a database or an admin token in the way.

const { mutateSheetForUser } = require('./mutate');

/**
 * What each system calls experience, or absent where it has no such field.
 *
 * Only Cities Without Number has one today. Cyberpunk RED spends Improvement Points and
 * Shadowrun spends Karma - both real, both a different currency with different rules - so
 * they are left out rather than guessed at. Adding one is a line here plus a field on that
 * system's template.
 */
const XP_FIELD = {
  cities_without_number: 'xp',
};

/** The field this system keeps experience in, or null where the idea does not apply. */
const xpFieldFor = (system) => XP_FIELD[String(system || '')] || null;

/** Whether a GM can award experience at all on this system. */
const supportsXp = (system) => xpFieldFor(system) !== null;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * What an award does to one character's total.
 *
 * Never below zero: taking 5 from a character with 2 leaves them at 0, not owing three.
 * The result reports what actually moved rather than what was asked for, so a GM removing
 * more than someone has is told what really happened.
 */
const applyAward = (current, amount) => {
  const from = Math.max(0, num(current));
  const to = Math.max(0, from + num(amount));
  return { from, to, delta: to - from };
};

/**
 * A whole award, validated.
 *
 * Returns a reason rather than throwing, because every caller here is a socket handler
 * that wants to tell the GM why nothing happened.
 */
const validate = ({ system, usernames, amount }) => {
  if (!supportsXp(system)) return 'This system does not track experience.';
  if (!Array.isArray(usernames) || usernames.length === 0) return 'Nobody selected.';
  const n = Number(amount);
  if (!Number.isFinite(n)) return 'Amount must be a number.';
  // Zero is refused rather than quietly succeeding: it is always a mistake, and a silent
  // no-op looks exactly like a broken button.
  if (n === 0) return 'Amount must not be zero.';
  if (!Number.isInteger(n)) return 'Experience is whole points.';
  return null;
};

/**
 * Award (or take back) experience for several characters at once.
 *
 * Each named character gets the full amount - see the note at the top of this file.
 *
 * Through mutateSheetForUser rather than a bare read-then-write, for the same reason every
 * other sheet write goes that way: a player editing their own sheet while the GM awards XP
 * would otherwise have one of the two changes vanish with nothing reported.
 *
 * A character with no sheet is reported rather than skipped silently - on a night when the
 * GM awards the party and one name does nothing, they should be told which.
 */
const awardXp = (db, { system, usernames, amount, rate }, cb = () => {}) => {
  const reason = validate({ system, usernames, amount });
  if (reason) return cb(reason, null);

  const field = xpFieldFor(system);
  const results = [];
  let remaining = usernames.length;

  usernames.forEach((username) => {
    mutateSheetForUser(
      db,
      { username, system },
      (data) => {
        const { to } = applyAward(data[field], amount);
        data[field] = to;
        // The level follows the total. Three points a session, four sessions running, is
        // level 4 on the fast column - not level 2 with the bar stuck on READY.
        data.level = levelForXp(to, rate, data.level);
        return data;
      },
      (err, data) => {
        if (err || !data) {
          results.push({ username, ok: false, reason: 'No sheet.' });
        } else {
          results.push({ username, ok: true, xp: num(data[field]), level: num(data.level) });
        }
        remaining -= 1;
        if (remaining === 0) cb(null, results);
      },
    );
  });
};

/** The levels the book prints a cost for (CWN p44). */
const MIN_LEVEL = 1;
const MAX_LEVEL = 10;

/**
 * Total XP needed to REACH each level, indexed by level. Mirrors the table in
 * frontend/src/sheets/cwnAdvancement.ts, and a test walks both copies.
 *
 * "Experience points earned are cumulative, and do not reset each level" (p44), so these
 * are running totals rather than the cost of one level.
 */
const THRESHOLDS = {
  //        L1 L2  L3  L4  L5  L6  L7  L8   L9  L10
  fast: [0, 0, 3, 6, 12, 18, 27, 39, 54, 72, 93],
  slow: [0, 0, 6, 15, 24, 36, 51, 69, 87, 105, 139],
};

const rateOf = (v) => (String(v || '').trim().toLowerCase() === 'slow' ? 'slow' : 'fast');

/**
 * The level a given XP total has earned.
 *
 * Climbs as far as the total reaches rather than one step at a time: a GM awarding 3 a
 * session four times running has earned level 4 on the fast column, and stopping at 2
 * would leave them stuck a level behind with the bar reading READY forever - which is
 * exactly what happened before this existed.
 *
 * Never DOWN. A level is not un-earned by spending or losing experience: the skill points
 * and the Focus that came with it do not undo themselves. Correcting one is a deliberate
 * act, which is what LEVEL_DOWN is for.
 */
const levelForXp = (xp, rate, currentLevel = MIN_LEVEL) => {
  const table = THRESHOLDS[rateOf(rate)];
  const now = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, num(currentLevel) || MIN_LEVEL));
  let level = now;
  while (level < MAX_LEVEL && num(xp) >= table[level + 1]) level += 1;
  return level;
};

/**
 * What a level change does to one character.
 *
 * Clamped to the levels the book has: 1 is where operators start and 10 is the top of the
 * table, so neither end runs off into numbers with no thresholds behind them. A blank
 * level reads as 1 for the same reason the sheet does.
 */
const applyLevel = (current, delta) => {
  const from = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, num(current) || MIN_LEVEL));
  const to = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, from + num(delta)));
  return { from, to, delta: to - from };
};

/**
 * Move a character up or down a level.
 *
 * Separate from awarding experience on purpose. XP is a record of what was earned and
 * levelling is a decision made from it - a GM correcting a level should not have to
 * invent an XP figure to do it, and taking XP back does not un-level anybody, because
 * the skill points and Focus picks that came with the level do not undo themselves.
 */
const adjustLevel = (db, { system, usernames, delta }, cb = () => {}) => {
  if (!supportsXp(system)) return cb('This system does not track levels.', null);
  if (!Array.isArray(usernames) || usernames.length === 0) return cb('Nobody selected.', null);
  const step = Number(delta);
  if (!Number.isInteger(step) || step === 0) return cb('Level change must be a whole number.', null);

  const results = [];
  let remaining = usernames.length;
  usernames.forEach((username) => {
    mutateSheetForUser(
      db,
      { username, system },
      (data) => {
        data.level = applyLevel(data.level, step).to;
        return data;
      },
      (err, data) => {
        if (err || !data) results.push({ username, ok: false, reason: 'No sheet.' });
        else results.push({ username, ok: true, level: num(data.level) });
        remaining -= 1;
        if (remaining === 0) cb(null, results);
      },
    );
  });
};

module.exports = {
  XP_FIELD, xpFieldFor, supportsXp, applyAward, validate, awardXp,
  MIN_LEVEL, MAX_LEVEL, applyLevel, adjustLevel, THRESHOLDS, levelForXp,
};
