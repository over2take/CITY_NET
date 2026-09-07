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
const awardXp = (db, { system, usernames, amount }, cb = () => {}) => {
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
        return data;
      },
      (err, data) => {
        if (err || !data) {
          results.push({ username, ok: false, reason: 'No sheet.' });
        } else {
          results.push({ username, ok: true, xp: num(data[field]) });
        }
        remaining -= 1;
        if (remaining === 0) cb(null, results);
      },
    );
  });
};

module.exports = { XP_FIELD, xpFieldFor, supportsXp, applyAward, validate, awardXp };
