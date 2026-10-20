// Roll styles: a custom system's own rolls (Phase 6, 6a1; approved mockup
// docs/mockups/builder-rolls.html, 2026-10-19, on the builder design's Dice page). Pure, no I/O.
//
// A roll is the five steps the builder shows: the core of them (6a1), the special results (6a1b:
// matches, glitches, cancelling ones, named dice's own effects, the zero-dice rule); the changes a
// player picks before rolling (advantage, a push) and the presets are 6a1c.
//
//   {
//     id: 'skill', label: 'Skill check',
//     dice:    [{ count: '2', sides: 6 }, { count: '@hunger', sides: 10, name: 'Hunger' }],   // 1 DICE
//     read:    'sum' | 'highest' | 'lowest' | 'count',                                         // 2 READ
//     keep:    '1',        how many 'highest' or 'lowest' keep (formula text, default 1)
//     at:      6,          'count': a die showing this or more is one success
//     add:     '@this + @tie_mod',                                                             // 3 ADD
//     against: '13',       a target (formula text); met at or over it, or at or under with `under`
//     under:   false,
//     bands:   [{ upTo: 6, label: 'Miss' }, { upTo: 9, label: 'Success at a cost' }, { label: 'Full success' }],
//     explode: { on: 6, once: false },                                                         // 4 SPECIAL
//     natural: [{ face: 20, label: 'Critical', critical: 'success' }, { face: 1, label: 'Fumble', critical: 'failure' }],
//     matches: [{ face: 10, count: 2, adds: 2, label: 'Critical', critical: 'success' }],     a pair of 10s
//     cancel:  { face: 1 },                        each die showing it takes a success away
//     glitch:  { face: 1, share: 0.5, label: 'Glitch', none: 'Critical glitch' },             SR6
//     effects: [{ name: 'Hunger', face: 10, when: 'critical', label: 'Messy critical' }],     a named die's own
//     zero:    { count: 2, read: 'lowest' },       no dice to roll: roll these and keep one     Blades
//   }
//
// Dice counts, ADD and the target are formula text in the same language as a system's formulas
// (expression.js), worked out by the caller's `value(text)` for the character rolling, so a roll
// reads @this, a stat or a formula the way a formula does. Bands are read top to bottom like a
// lookup table's: the first whose `upTo` the total doesn't go over, the last (no `upTo`) catching
// the rest. A natural is what the dice show before anything is added: the kept die, the sum of the
// dice, or the number of successes. A match is `count` dice showing the same face (that face, or any
// face with none named), each full set adding `adds` to what the dice come to. A glitch is when the
// glitch face shows on at least `share` of the dice, and its `none` label when nothing succeeded too.
// An effect is a named die showing its face while the roll is a critical, a success, a failure or
// any roll. Dice come from the caller's `rng` (the server's secure one,
// utils/random.js, at the table): nothing here picks a number of its own.

const { parse, NAME } = require('./expression');

const LIMITS = {
  /** Kinds of dice in one roll. */
  groups: 6,
  /** Dice in one roll, before any explode. */
  dice: 100,
  /** The biggest die. */
  sides: 100,
  /** Extra dice explosions may add to one roll. */
  explosions: 20,
  /** Bands in one roll. */
  bands: 20,
  /** Naturals in one roll; matches and effects too. */
  naturals: 10,
  label: 40,
};

/** A Fate die: −1, 0 or +1. */
const FATE = 'F';
const READS = ['sum', 'highest', 'lowest', 'count'];
const ROLL_KEYS = new Set(['id', 'label', 'dice', 'read', 'keep', 'at', 'add', 'against', 'under', 'bands', 'explode', 'natural', 'matches', 'cancel', 'glitch', 'effects', 'zero']);
const WHEN = ['critical', 'success', 'failure', 'any'];

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isSides = (s) => s === FATE || (Number.isInteger(s) && s >= 2 && s <= LIMITS.sides);
const whole = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.trunc(Number.isFinite(n) ? n : 0)));

/** One die: 1 to `sides`, or a Fate die's −1, 0 or +1. */
const rollDie = (sides, rng) => (sides === FATE ? Math.floor(rng() * 3) - 1 : Math.floor(rng() * sides) + 1);
const highestFace = (sides) => (sides === FATE ? 1 : sides);

/**
 * What is wrong with a roll, in the builder's words: [{ where, message }], none when it can be
 * rolled. `isFunction(name)` says whether formula text may call a name (the built-ins always can,
 * and a system adds its lookup tables), as for a formula.
 */
const checkRoll = (roll, where = 'roll', isFunction = () => false) => {
  const problems = [];
  const bad = (at, message) => problems.push({ where: at ? `${where}, ${at}` : where, message });
  if (!isPlainObject(roll)) { bad('', 'Must be a roll'); return problems; }
  for (const key of Object.keys(roll)) if (!ROLL_KEYS.has(key)) bad(key, 'Not part of a roll');
  if (typeof roll.id !== 'string' || !NAME.test(roll.id)) bad('', 'Ids use lowercase letters, digits and _, starting with a letter');
  if (roll.label !== undefined && (typeof roll.label !== 'string' || roll.label.length > LIMITS.label)) bad('label', `Words of up to ${LIMITS.label} characters`);
  const formula = (at, text) => {
    if (typeof text !== 'string') { bad(at, 'Must be formula text'); return; }
    try { parse(text, isFunction); } catch (e) { bad(at, e.message); }
  };

  if (!Array.isArray(roll.dice) || !roll.dice.length) bad('dice', 'Needs at least one kind of dice');
  else {
    if (roll.dice.length > LIMITS.groups) bad('dice', `At most ${LIMITS.groups} kinds of dice`);
    roll.dice.slice(0, LIMITS.groups).forEach((g, i) => {
      const at = `dice ${i + 1}`;
      if (!isPlainObject(g)) { bad(at, 'Must say how many dice and what kind'); return; }
      for (const key of Object.keys(g)) if (!['count', 'sides', 'name'].includes(key)) bad(`${at}, ${key}`, 'Not part of dice');
      formula(`${at}, count`, g.count);
      if (!isSides(g.sides)) bad(`${at}, sides`, `A die of 2 to ${LIMITS.sides} sides, or F for a Fate die`);
      if (g.name !== undefined && (typeof g.name !== 'string' || !g.name.trim() || g.name.length > LIMITS.label)) bad(`${at}, name`, `Words of up to ${LIMITS.label} characters`);
    });
  }

  const read = roll.read ?? 'sum';
  if (!READS.includes(read)) bad('read', 'Sum, highest, lowest or count');
  if (roll.keep !== undefined) {
    if (read !== 'highest' && read !== 'lowest') bad('keep', 'Only keeping the highest or lowest dice keeps some');
    else formula('keep', roll.keep);
  }
  if (read === 'count') {
    if (!Number.isInteger(roll.at)) bad('at', 'Counting needs the face a success starts at');
  } else if (roll.at !== undefined) bad('at', 'Only counting successes has a face they start at');
  if (roll.add !== undefined) formula('add', roll.add);
  if (roll.against !== undefined) formula('against', roll.against);
  if (roll.under !== undefined && typeof roll.under !== 'boolean') bad('under', 'Must be yes or no');
  if (roll.under === true && roll.against === undefined) bad('under', 'Rolling under needs a target');

  if (roll.bands !== undefined) {
    if (!Array.isArray(roll.bands) || !roll.bands.length) bad('bands', 'A list of bands, at least one');
    else {
      if (roll.bands.length > LIMITS.bands) bad('bands', `At most ${LIMITS.bands} bands`);
      let last = -Infinity;
      roll.bands.slice(0, LIMITS.bands).forEach((b, i) => {
        const at = `band ${i + 1}`;
        if (!isPlainObject(b)) { bad(at, 'Must be a band'); return; }
        for (const key of Object.keys(b)) if (!['upTo', 'label'].includes(key)) bad(`${at}, ${key}`, 'Not part of a band');
        if (typeof b.label !== 'string' || !b.label.trim() || b.label.length > LIMITS.label) bad(`${at}, label`, `Words of up to ${LIMITS.label} characters`);
        const lastBand = i === Math.min(roll.bands.length, LIMITS.bands) - 1;
        if (b.upTo === undefined) { if (!lastBand) bad(at, 'Only the last band catches everything above'); return; }
        if (!Number.isInteger(b.upTo)) bad(`${at}, upTo`, 'Must be a whole number');
        else if (b.upTo <= last) bad(`${at}, upTo`, 'Bands go up, each over the last');
        else last = b.upTo;
      });
    }
  }

  if (roll.explode !== undefined) {
    const x = roll.explode;
    if (!isPlainObject(x)) bad('explode', 'Must say which face explodes');
    else {
      for (const key of Object.keys(x)) if (!['on', 'once'].includes(key)) bad(`explode, ${key}`, 'Not part of exploding');
      if (x.on !== undefined && !Number.isInteger(x.on)) bad('explode, on', 'Must be a face, a whole number');
      if (x.once !== undefined && typeof x.once !== 'boolean') bad('explode, once', 'Must be yes or no');
    }
  }

  if (roll.natural !== undefined) {
    if (!Array.isArray(roll.natural)) bad('natural', 'A list of naturals');
    else {
      if (roll.natural.length > LIMITS.naturals) bad('natural', `At most ${LIMITS.naturals}`);
      roll.natural.slice(0, LIMITS.naturals).forEach((n, i) => {
        const at = `natural ${i + 1}`;
        if (!isPlainObject(n)) { bad(at, 'Must be a natural'); return; }
        for (const key of Object.keys(n)) if (!['face', 'label', 'critical'].includes(key)) bad(`${at}, ${key}`, 'Not part of a natural');
        if (!Number.isInteger(n.face)) bad(`${at}, face`, 'Must be a whole number');
        if (typeof n.label !== 'string' || !n.label.trim() || n.label.length > LIMITS.label) bad(`${at}, label`, `Words of up to ${LIMITS.label} characters`);
        if (n.critical !== undefined && n.critical !== 'success' && n.critical !== 'failure') bad(`${at}, critical`, 'A critical success or failure');
      });
    }
  }
  const words = (at, text) => { if (typeof text !== 'string' || !text.trim() || text.length > LIMITS.label) bad(at, `Words of up to ${LIMITS.label} characters`); };
  const keysOf = (at, o, keys, what) => { for (const key of Object.keys(o)) if (!keys.includes(key)) bad(`${at}, ${key}`, `Not part of ${what}`); };
  const list = (key, what, each) => {
    if (roll[key] === undefined) return;
    if (!Array.isArray(roll[key])) { bad(key, `A list of ${what}`); return; }
    if (roll[key].length > LIMITS.naturals) bad(key, `At most ${LIMITS.naturals}`);
    roll[key].slice(0, LIMITS.naturals).forEach((o, i) => {
      const at = `${key.replace(/es$|s$/, '')} ${i + 1}`;
      if (!isPlainObject(o)) { bad(at, `Must be one of the ${what}`); return; }
      each(at, o);
    });
  };
  list('matches', 'matches', (at, m) => {
    keysOf(at, m, ['face', 'count', 'adds', 'label', 'critical'], 'a match');
    if (m.face !== undefined && !Number.isInteger(m.face)) bad(`${at}, face`, 'Must be a whole number, or left out for any face');
    if (!Number.isInteger(m.count) || m.count < 2 || m.count > LIMITS.dice) bad(`${at}, count`, 'How many dice match: 2 or more');
    if (m.adds !== undefined && !Number.isInteger(m.adds)) bad(`${at}, adds`, 'Must be a whole number');
    words(`${at}, label`, m.label);
    if (m.critical !== undefined && m.critical !== 'success' && m.critical !== 'failure') bad(`${at}, critical`, 'A critical success or failure');
  });
  if (roll.cancel !== undefined) {
    if (!isPlainObject(roll.cancel)) bad('cancel', 'Must say which face cancels');
    else {
      keysOf('cancel', roll.cancel, ['face'], 'cancelling');
      if (!Number.isInteger(roll.cancel.face)) bad('cancel, face', 'Must be a whole number');
      if (read !== 'count') bad('cancel', 'Only counted successes can be cancelled');
    }
  }
  if (roll.glitch !== undefined) {
    const g = roll.glitch;
    if (!isPlainObject(g)) bad('glitch', 'Must say which face glitches');
    else {
      keysOf('glitch', g, ['face', 'share', 'label', 'none'], 'a glitch');
      if (!Number.isInteger(g.face)) bad('glitch, face', 'Must be a whole number');
      if (typeof g.share !== 'number' || !(g.share > 0 && g.share <= 1)) bad('glitch, share', 'A share of the dice, over 0 and up to 1');
      words('glitch, label', g.label);
      if (g.none !== undefined) words('glitch, none', g.none);
    }
  }
  const names = new Set((Array.isArray(roll.dice) ? roll.dice : []).map((g) => (isPlainObject(g) ? g.name : undefined)).filter(Boolean));
  list('effects', 'effects', (at, e) => {
    keysOf(at, e, ['name', 'face', 'when', 'label'], 'an effect');
    if (typeof e.name !== 'string' || !names.has(e.name)) bad(`${at}, name`, 'Must be one of this roll\'s named dice');
    if (!Number.isInteger(e.face)) bad(`${at}, face`, 'Must be a whole number');
    if (!WHEN.includes(e.when)) bad(`${at}, when`, 'On a critical, a success, a failure or any roll');
    words(`${at}, label`, e.label);
  });
  if (roll.zero !== undefined) {
    const z = roll.zero;
    if (!isPlainObject(z)) bad('zero', 'Must say what is rolled with no dice');
    else {
      keysOf('zero', z, ['count', 'read'], 'the zero-dice rule');
      if (!Number.isInteger(z.count) || z.count < 1 || z.count > 10) bad('zero, count', 'How many dice: 1 to 10');
      if (z.read !== 'highest' && z.read !== 'lowest') bad('zero, read', 'Keep the highest or the lowest');
    }
  }
  return problems;
};

/**
 * A roll made: each kind of dice with its faces (kept or not, and whether an explode added it),
 * what the dice come to as read (`dice`), what is added, the total, the target and whether it was
 * met, the band the total lands in, and a natural the dice showed. The roll is assumed checked
 * (checkRoll); `value(text)` works formula text out for the character rolling, `rng` gives [0, 1).
 */
const makeRoll = (roll, value, rng) => {
  let left = LIMITS.dice;
  let extra = LIMITS.explosions;
  const groups = roll.dice.slice(0, LIMITS.groups).map((g) => {
    const count = whole(value(g.count), 0, left);
    left -= count;
    const faces = [];
    for (let i = 0; i < count; i += 1) {
      let v = rollDie(g.sides, rng);
      faces.push({ value: v, kept: true });
      // A die showing the explode face rolls another of its kind, added in; again on the new
      // one unless only `once`, up to the most explosions a roll may have.
      const on = roll.explode ? (roll.explode.on ?? highestFace(g.sides)) : null;
      while (on !== null && v === on && extra > 0) {
        extra -= 1;
        v = rollDie(g.sides, rng);
        faces.push({ value: v, kept: true, extra: true });
        if (roll.explode.once) break;
      }
    }
    return { ...(g.name ? { name: g.name } : {}), sides: g.sides, faces };
  });

  // No dice to roll: the zero-dice rule rolls its own, of the first kind's size, and keeps one.
  let read = roll.read ?? 'sum';
  let keepText = roll.keep;
  let zeroed = false;
  if (roll.zero && groups.every((g) => !g.faces.length) && groups.length) {
    zeroed = true;
    for (let i = 0; i < roll.zero.count; i += 1) groups[0].faces.push({ value: rollDie(groups[0].sides, rng), kept: true });
    read = roll.zero.read;
    keepText = '1';
  }

  const all = groups.flatMap((g) => g.faces);
  let dice;
  if (read === 'count') {
    for (const f of all) f.kept = f.value >= roll.at;
    dice = all.filter((f) => f.kept).length;
    // Each die showing the cancelling face takes a success away, down to none.
    if (roll.cancel) dice = Math.max(0, dice - all.filter((f) => f.value === roll.cancel.face).length);
  } else if (read === 'highest' || read === 'lowest') {
    const n = whole(value(keepText ?? '1'), 0, all.length);
    const order = [...all].sort((a, b) => (read === 'highest' ? b.value - a.value : a.value - b.value));
    const keep = new Set(order.slice(0, n));
    for (const f of all) f.kept = keep.has(f);
    dice = order.slice(0, n).reduce((s, f) => s + f.value, 0);
  } else {
    dice = all.reduce((s, f) => s + f.value, 0);
  }
  const shown = dice;

  // Matches: full sets of dice showing one face, each set adding to what the dice come to. None
  // from the zero-dice rule's dice, a desperate roll (Blades: no critical with zero dice).
  const matched = [];
  for (const m of zeroed ? [] : roll.matches ?? []) {
    const counts = new Map();
    for (const f of all) counts.set(f.value, (counts.get(f.value) ?? 0) + 1);
    const sets = m.face !== undefined ? Math.floor((counts.get(m.face) ?? 0) / m.count)
      : [...counts.values()].reduce((n, c) => n + Math.floor(c / m.count), 0);
    if (!sets) continue;
    dice += sets * (m.adds ?? 0);
    matched.push({ label: m.label, sets, ...(m.critical ? { critical: m.critical } : {}) });
  }
  const glitchFaces = roll.glitch ? all.filter((f) => f.value === roll.glitch.face).length : 0;
  const glitched = !!roll.glitch && all.length > 0 && glitchFaces >= Math.ceil(all.length * roll.glitch.share);

  const add = roll.add !== undefined ? value(roll.add) : 0;
  const total = dice + add;
  const target = roll.against !== undefined ? value(roll.against) : null;
  const success = target === null ? null : roll.under ? total <= target : total >= target;
  const band = roll.bands ? (roll.bands.find((b) => b.upTo === undefined || total <= b.upTo)?.label ?? null) : null;
  // A natural is read before matches add anything: what the dice themselves show.
  const nat = (roll.natural ?? []).find((n) => n.face === shown);
  const glitch = glitched ? ((roll.glitch.none && shown === 0) ? roll.glitch.none : roll.glitch.label) : null;
  const critical = nat?.critical ?? matched.find((m) => m.critical)?.critical ?? (glitched && roll.glitch.none && shown === 0 ? 'failure' : null);
  const effects = (roll.effects ?? []).filter((e) => {
    const g = groups.find((x) => x.name === e.name);
    if (!g || !g.faces.some((f) => f.value === e.face)) return false;
    if (e.when === 'critical') return critical === 'success';
    if (e.when === 'success') return success === true;
    if (e.when === 'failure') return success === false;
    return true;
  }).map((e) => e.label);
  return {
    groups, dice, add, total, target, success, band,
    natural: nat ? { label: nat.label, ...(nat.critical ? { critical: nat.critical } : {}) } : null,
    matches: matched, glitch, effects, critical, ...(zeroed ? { zero: true } : {}),
  };
};

module.exports = { checkRoll, makeRoll, rollDie, LIMITS, FATE, READS };
