// When a character's health runs out (8c1a; approved mockup docs/mockups/rule-library.html, 2026-11-26, every
// recommended answer): the RULE LIBRARY's first rule, death saves and the turns a character has left, in one of four ways.
//
//   dying: {
//     word: 'DYING',                                           // what the sheet and the token say (MORTALLY WOUNDED, TAKEN OUT)
//     way: 'count',                                            // SAVES COUNTED (D&D 5e), 'once': ONE FAIL IS DEATH (Cyberpunk
//                                                              // RED), 'turns': TURNS LEFT (Cities Without Number), 'none': NO ROLL
//     save: { dice: '1d20', way: 'at_least', target: '10' },   // the save: dice, AT LEAST or 'under' a number or formula (@body)
//     to_live: 3, to_die: 3,                                   // SAVES COUNTED: successes to be stable, failures to be dead
//     harder: 1,                                               // ONE FAIL IS DEATH: added to the roll for each save made
//     naturals: [{ face: 20, then: 'back_up' }, { face: 1, then: 'two_failures' }], // what the dice showing a number does
//     turns: 6,                                                // TURNS LEFT: then dead, unless stabilized
//     hurt: 'failure',                                         // HURT WHILE DOWN: 'nothing' more, 'failure', or 'dead'
//   }
//
// The rule is on when the PARTS row DEATH SAVES (parts.death) is and the section is written; a system without it has its
// health run out as before. Every key belongs to one way or another, and a way's keys are kept when the GM picks another,
// so switching back finds them as they were: only the way's own are read.
//
// A character down is { state: 'dying' | 'stable' | 'dead', saves, fails, made, turns, due }: the successes and failures
// counted, the saves made (each making the next harder), the turns gone by (in a fight the tracker counts them; out of
// one each save is a turn), and whether their turn has come and the save is due. Healed above 0, all of it is cleared;
// DEAD is never undone by a roll or a turn, only by healing them back.
//
// Pure: the definition checks read it, and the running game hands in a character's state and the dice, and writes what
// comes back.

const { rollAmount } = require('./tierRolls');
const { partOn } = require('./parts');
const { namesOf } = require('./choices');

const WAYS = ['count', 'once', 'turns', 'none'];
const SAVE_WAYS = ['at_least', 'under'];
const HURT = ['nothing', 'failure', 'dead'];
/** What a natural may do: back with 1 HP, stable, two failures (death, where one fail is), or dead. */
const NATURALS = ['back_up', 'stable', 'two_failures', 'dead'];
const NATURAL_WORDS = { back_up: 'BACK WITH 1 HP', stable: 'STABLE', two_failures: 'TWO FAILURES', dead: 'DEAD' };
const LIMITS = { word: 30, text: 200, count: 10, turns: 100, harder: 20, naturals: 6, face: 1000 };
const START = { word: 'DYING', way: 'count', save: { dice: '1d20', way: 'at_least', target: '10' }, to_live: 3, to_die: 3, harder: 0, naturals: [], turns: 6, hurt: 'nothing' };

const DYING_KEYS = new Set(['word', 'way', 'save', 'to_live', 'to_die', 'harder', 'naturals', 'turns', 'hurt']);
const SAVE_KEYS = new Set(['dice', 'way', 'target']);
const NATURAL_KEYS = new Set(['face', 'then']);
/** A word as the sheet and the token say it: letters, digits, spaces, a hyphen or an apostrophe. */
const WORD = /^[A-Za-z][A-Za-z0-9 '-]*$/;

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const whole = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const namesFor = (definition) => {
  const names = namesOf(definition);
  return { known: (n) => names.has(n), refused: (n) => `@${n} isn't one of this system's names` };
};

/** Problems with a definition's `dying`, pushed onto `problems`. */
const checkDying = (definition, problems) => {
  const dying = definition.dying;
  if (dying === undefined) return;
  if (!isPlainObject(dying)) { problems.push({ where: 'dying', message: 'Must say what happens when health runs out' }); return; }
  for (const key of Object.keys(dying)) if (!DYING_KEYS.has(key)) problems.push({ where: `dying, ${key}`, message: 'Not part of dying' });
  if (dying.word !== undefined) {
    if (typeof dying.word !== 'string' || !dying.word.trim()) problems.push({ where: 'dying, word', message: 'Needs a word, as DYING' });
    else if (dying.word.trim().length > LIMITS.word) problems.push({ where: 'dying, word', message: `Longer than ${LIMITS.word} characters` });
    else if (!WORD.test(dying.word.trim())) problems.push({ where: 'dying, word', message: 'Letters, digits, spaces, a hyphen or an apostrophe, starting with a letter' });
  }
  if (dying.way !== undefined && !WAYS.includes(dying.way)) problems.push({ where: 'dying, way', message: `One of ${WAYS.join(', ')}` });
  if (dying.hurt !== undefined && !HURT.includes(dying.hurt)) problems.push({ where: 'dying, hurt', message: `One of ${HURT.join(', ')}` });
  for (const key of ['to_live', 'to_die']) {
    if (dying[key] !== undefined && !whole(dying[key], 1, LIMITS.count)) problems.push({ where: `dying, ${key}`, message: `A whole number from 1 to ${LIMITS.count}` });
  }
  if (dying.turns !== undefined && !whole(dying.turns, 1, LIMITS.turns)) problems.push({ where: 'dying, turns', message: `A whole number from 1 to ${LIMITS.turns}` });
  if (dying.harder !== undefined && !whole(dying.harder, -LIMITS.harder, LIMITS.harder)) problems.push({ where: 'dying, harder', message: `A whole number from -${LIMITS.harder} to ${LIMITS.harder}` });

  const names = namesFor(definition);
  // The most the dice can show, where every count is a number (one from a name is 0 here): the game's dice, or 1d20.
  let most = null;
  const mostOf = (read) => (read.dice.every((d) => d.count > 0) ? read.dice.reduce((n, d) => n + d.count * d.sides, 0) : null);
  if (!isPlainObject(dying.save) || dying.save.dice === undefined) most = mostOf(rollAmount(START.save.dice, {}, names, () => 0));
  if (dying.save !== undefined) {
    const save = dying.save;
    if (!isPlainObject(save)) problems.push({ where: 'dying, save', message: 'Must be the dice, the way and the target' });
    else {
      for (const key of Object.keys(save)) if (!SAVE_KEYS.has(key)) problems.push({ where: `dying, save, ${key}`, message: 'Only the dice, the way and the target' });
      if (save.way !== undefined && !SAVE_WAYS.includes(save.way)) problems.push({ where: 'dying, save, way', message: 'at_least or under' });
      if (save.dice !== undefined) {
        const read = typeof save.dice === 'string' && save.dice.length <= LIMITS.text ? rollAmount(save.dice, {}, names, () => 1 - 1e-9) : { error: 'Dice, as 1d20' };
        if ('error' in read) problems.push({ where: 'dying, save, dice', message: read.error });
        else if ('blank' in read || !read.dice.length) problems.push({ where: 'dying, save, dice', message: 'Needs dice to roll, as 1d20' });
        else most = mostOf(read);
      }
      if (save.target !== undefined) {
        const read = typeof save.target === 'number' || (typeof save.target === 'string' && save.target.length <= LIMITS.text)
          ? rollAmount(save.target, {}, names, () => 0) : { error: 'A number or a formula' };
        if ('error' in read) problems.push({ where: 'dying, save, target', message: read.error });
        else if ('blank' in read) problems.push({ where: 'dying, save, target', message: 'Needs a number or a formula to beat' });
        else if (read.dice.length) problems.push({ where: 'dying, save, target', message: 'A number or a formula, not dice' });
      }
    }
  }
  if (dying.naturals !== undefined) {
    if (!Array.isArray(dying.naturals)) problems.push({ where: 'dying, naturals', message: 'Must be a list' });
    else {
      if (dying.naturals.length > LIMITS.naturals) problems.push({ where: 'dying, naturals', message: `At most ${LIMITS.naturals}` });
      const seen = new Set();
      dying.naturals.forEach((n, i) => {
        const where = `dying, natural ${i + 1}`;
        if (!isPlainObject(n)) { problems.push({ where, message: 'Must be a number and what it does' }); return; }
        for (const key of Object.keys(n)) if (!NATURAL_KEYS.has(key)) problems.push({ where: `${where}, ${key}`, message: 'Only the number and what it does' });
        if (!whole(n.face, 1, LIMITS.face)) problems.push({ where: `${where}, face`, message: `A whole number from 1 to ${LIMITS.face}` });
        else if (most !== null && n.face > most) problems.push({ where: `${where}, face`, message: `${isPlainObject(dying.save) && typeof dying.save.dice === 'string' ? dying.save.dice.trim() : START.save.dice} never shows ${n.face}` });
        else if (seen.has(n.face)) problems.push({ where: `${where}, face`, message: `${n.face} is already one` });
        else seen.add(n.face);
        if (!NATURALS.includes(n.then)) problems.push({ where: `${where}, then`, message: `One of ${NATURALS.join(', ')}` });
      });
    }
  }
  // Nothing would start it: a game with no health never runs out of it.
  const model = isPlainObject(definition.core) && isPlainObject(definition.core.health) ? definition.core.health.model : 'pool';
  if (model === 'none' && partOn(definition, 'death')) problems.push({ where: 'dying', message: 'This game has no health to run out (SETUP: NO HEALTH), so nothing would start it' });
};

/** The game's rule, every key filled in, or null where it is off or not written. */
const dyingRuleOf = (definition) => {
  if (!isPlainObject(definition) || !isPlainObject(definition.dying) || !partOn(definition, 'death')) return null;
  const d = definition.dying;
  const save = isPlainObject(d.save) ? d.save : {};
  return {
    word: typeof d.word === 'string' && d.word.trim() ? d.word.trim().toUpperCase() : START.word,
    way: WAYS.includes(d.way) ? d.way : START.way,
    save: {
      dice: typeof save.dice === 'string' && save.dice.trim() ? save.dice.trim() : START.save.dice,
      way: SAVE_WAYS.includes(save.way) ? save.way : START.save.way,
      target: typeof save.target === 'number' || (typeof save.target === 'string' && save.target.trim()) ? String(save.target).trim() : START.save.target,
    },
    to_live: whole(d.to_live, 1, LIMITS.count) ? d.to_live : START.to_live,
    to_die: whole(d.to_die, 1, LIMITS.count) ? d.to_die : START.to_die,
    harder: whole(d.harder, -LIMITS.harder, LIMITS.harder) ? d.harder : START.harder,
    naturals: Array.isArray(d.naturals) ? d.naturals.filter((n) => isPlainObject(n) && whole(n.face, 1, LIMITS.face) && NATURALS.includes(n.then)) : [],
    turns: whole(d.turns, 1, LIMITS.turns) ? d.turns : START.turns,
    hurt: HURT.includes(d.hurt) ? d.hurt : START.hurt,
  };
};

/** A character just gone down. */
const startState = () => ({ state: 'dying', saves: 0, fails: 0, made: 0, turns: 0, due: false });

/** The words for where a SAVES COUNTED count stands. */
const countWords = (rule, st) => `${st.saves} OF ${rule.to_live} SAVES · ${st.fails} OF ${rule.to_die} FAILS`;
const turnsLeft = (rule, st) => Math.max(0, rule.turns - st.turns);
const turnsWords = (n) => `${n} ${n === 1 ? 'TURN' : 'TURNS'} LEFT`;

/** One more failure (or two): dead at enough of them, or where one fail is death. */
const failed = (rule, st, by) => {
  if (rule.way !== 'count') return { st: { ...st, state: 'dead' }, said: 'DEAD' };
  const fails = st.fails + by;
  if (fails >= rule.to_die) return { st: { ...st, fails, state: 'dead' }, said: 'DEAD' };
  return { st: { ...st, fails, state: 'dying' }, said: countWords(rule, { ...st, fails }) };
};

/**
 * What a change to a character's health does: `{ st, said }`, the state after (null when they are not down) and the
 * words to say, or null when nothing is to be said. `wasOut` and `isOut` are the health model's answer before and after;
 * `hurt` is whether the change was damage.
 */
const afterHealth = (rule, st, { wasOut, isOut, hurt }) => {
  if (!isOut) return st ? { st: null, said: 'BACK UP' } : { st: null, said: null };
  if (!st) return wasOut && !hurt ? { st: null, said: null } : { st: startState(), said: rule.word };
  if (!hurt || st.state === 'dead' || rule.hurt === 'nothing') return { st, said: null };
  if (rule.hurt === 'dead') return { st: { ...st, state: 'dead' }, said: 'HURT WHILE DOWN · DEAD' };
  if (rule.way === 'none') return { st, said: null };
  if (rule.way === 'turns') {
    const next = { ...st, turns: st.turns + 1, state: 'dying' };
    if (turnsLeft(rule, next) <= 0) return { st: { ...next, state: 'dead' }, said: 'HURT WHILE DOWN · A TURN GONE · DEAD' };
    return { st: next, said: `HURT WHILE DOWN · A TURN GONE · ${turnsWords(turnsLeft(rule, next))}` };
  }
  const out = failed(rule, st, 1);
  return { st: out.st, said: `HURT WHILE DOWN · A FAILURE · ${out.said}` };
};

/**
 * A turn of theirs begins (in a fight, the tracker's; out of one, the GM's A TURN GOES BY where turns are counted):
 * `{ st, said }`. Turns left run down; a save comes due.
 */
const aTurn = (rule, st) => {
  if (!st || st.state !== 'dying') return { st, said: null };
  const next = { ...st, turns: st.turns + 1 };
  if (rule.way === 'turns') {
    if (turnsLeft(rule, next) <= 0) return { st: { ...next, state: 'dead' }, said: 'OUT OF TURNS · DEAD' };
    return { st: next, said: turnsWords(turnsLeft(rule, next)) };
  }
  if (rule.way === 'none') return { st: next, said: null };
  return { st: { ...next, due: true }, said: 'DEATH SAVE' };
};

const signed = (n) => (n < 0 ? ` - ${-n}` : ` + ${n}`);

/**
 * A death save rolled for a character down: `{ ok: true, st, heal, total, natural, words }`, `heal` 1 where a natural
 * brings them back with 1 HP; or `{ ok: false, error }`. `values` are the character's, for the target's formula;
 * `inFight` says the tracker counts the turns, so a save waits for theirs unless `byGm`.
 */
const deathSave = (rule, st, { definition, values, rng, inFight = false, byGm = false }) => {
  if (!rule || (rule.way !== 'count' && rule.way !== 'once')) return { ok: false, error: 'This game has no death saves' };
  if (!st || st.state !== 'dying') return { ok: false, error: st && st.state === 'dead' ? 'Already dead' : st ? 'Already stable' : 'Not dying' };
  if (inFight && !st.due && !byGm) return { ok: false, error: 'A death save waits for their turn' };
  const names = namesFor(definition);
  const rolled = rollAmount(rule.save.dice, values, names, rng);
  if ('error' in rolled || 'blank' in rolled) return { ok: false, error: rolled.error || 'Nothing to roll' };
  const target = rollAmount(rule.save.target, values, names, () => 0);
  if ('error' in target || 'blank' in target) return { ok: false, error: target.error || 'No target' };
  const natural = rolled.dice.reduce((n, d) => n + d.rolls.reduce((a, b) => a + b, 0), 0);
  const harder = rule.way === 'once' ? st.made * rule.harder : 0;
  const total = rolled.value + harder;
  const add = rolled.value - natural;
  const shown = rolled.dice.map((d) => (d.rolls.length > 1 ? `(${d.rolls.join(', ')})` : String(d.rolls[0] ?? 0))).join(' + ');
  const head = `DEATH SAVE ${rule.save.dice}${harder ? signed(harder) : ''} [${shown}${add ? signed(add) : ''}${harder ? signed(harder) : ''} = ${total}]`
    + ` · ${rule.save.way === 'under' ? `UNDER ${target.value}` : `${target.value} OR MORE`}`;
  // Out of a fight each save is a turn; in one, the tracker has counted it.
  const base = { ...st, due: false, turns: inFight ? st.turns : st.turns + 1 };
  const said = (s, words, heal = 0) => ({ ok: true, st: s, heal, total, natural, words: `${head} · ${words}` });

  const nat = rule.naturals.find((n) => n.face === natural);
  if (nat) {
    const lead = `NATURAL ${natural} · ${NATURAL_WORDS[nat.then]}`;
    if (nat.then === 'back_up') return said(base, lead, 1);
    if (nat.then === 'stable') return said({ ...base, state: 'stable' }, lead);
    if (nat.then === 'dead') return said({ ...base, state: 'dead' }, lead);
    const out = failed(rule, base, 2);
    return said(out.st, rule.way === 'count' && out.st.state !== 'dead' ? `${lead} · ${out.said}` : `${lead} · DEAD`);
  }
  const made = rule.save.way === 'under' ? total < target.value : total >= target.value;
  if (rule.way === 'once') return made ? said({ ...base, made: base.made + 1 }, 'HOLDS ON') : said({ ...base, state: 'dead' }, 'DEAD');
  if (!made) {
    const out = failed(rule, base, 1);
    return said(out.st, `FAILURE · ${out.said}`);
  }
  const saves = base.saves + 1;
  if (saves >= rule.to_live) return said({ ...base, saves, state: 'stable' }, 'SUCCESS · STABLE');
  return said({ ...base, saves }, `SUCCESS · ${countWords(rule, { ...base, saves })}`);
};

/** A stored state read back: the known shape, or null for anything else. */
const stateOf = (v) => {
  let s = v;
  if (typeof s === 'string') { try { s = JSON.parse(s); } catch { return null; } }
  if (!isPlainObject(s) || !['dying', 'stable', 'dead'].includes(s.state)) return null;
  const n = (x) => (Number.isInteger(x) && x >= 0 ? Math.min(x, 1000) : 0);
  return { state: s.state, saves: n(s.saves), fails: n(s.fails), made: n(s.made), turns: n(s.turns), due: s.due === true };
};

module.exports = {
  WAYS, SAVE_WAYS, HURT, NATURALS, NATURAL_WORDS, LIMITS, START,
  checkDying, dyingRuleOf, startState, afterHealth, aTurn, deathSave, stateOf,
};
