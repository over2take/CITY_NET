// A DAMAGE value with its types (8b2a; approved mockup docs/mockups/damage-pipeline.html, section 2, answered 2026-11-23:
// the item carries its type, written "2d6 FIRE DMG"). A DAMAGE column's value is dice as before, now with the type of the
// hurt after them, and more than one part where a hit is of several kinds:
//
//   1d8 + @might_mod              plain damage, as before: one part, no type
//   2d6 FIRE DMG                  one part of FIRE ("DMG" at the end is only a word, said or not)
//   1d8 SLASHING + 2d6 FIRE       a Flame Tongue: two parts, each resisted on its own (8b3)
//   1d8 + 2d6 FIRE                the type closes everything before it: (1d8 + 2d6) FIRE
//   2d6 FIRE + 2                  what follows the last type is a part of its own, with no type
//
// A type is found by its shape, not looked up: a run of bare words outside brackets (no @, not a die like d8, not a
// function's name before "(", not and, or, not). So a value is checked without its system, as every catalogue and file
// reader checks it; only a roll matches the words to the game's damage types (damageTypes.js), and a word the game has no
// type for is said as typed, resisted by nothing. Pure.

const { rollAmount, boxProblem } = require('./tierRolls');

/** Words the formula language has that are never a type. */
const LANGUAGE = new Set(['and', 'or', 'not']);
/** A die written as a word: d8, d20. */
const DIE_WORD = /^d\d+$/i;

const isLetter = (c) => /[A-Za-z]/.test(c);
const isWordChar = (c) => /[A-Za-z0-9_'-]/.test(c);

/**
 * The words outside brackets that name a type, as { start, end, words } runs in order: bare words, each starting with a
 * letter, not after @ or a digit or letter, not a die, not a function (followed by "("), not and/or/not; one run while only
 * spaces or hyphens come between them.
 */
const typeRuns = (text) => {
  const runs = [];
  let depth = 0;
  let run = null;
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (c === '(') { depth += 1; run = null; i += 1; continue; }
    if (c === ')') { depth = Math.max(0, depth - 1); run = null; i += 1; continue; }
    if (depth === 0 && isLetter(c) && (i === 0 || !/[A-Za-z0-9_@.]/.test(text[i - 1]))) {
      let j = i;
      while (j < text.length && isWordChar(text[j])) j += 1;
      // A hyphen or apostrophe at its end is no part of the word, but goes with it.
      const word = text.slice(i, j).replace(/[-']+$/, '');
      const end = j;
      const next = text.slice(end).match(/^\s*(\S)?/)[1];
      const bare = word && !DIE_WORD.test(word) && !LANGUAGE.has(word.toLowerCase()) && next !== '(';
      if (bare) {
        if (run && /^[\s-]*$/.test(text.slice(run.end, i))) { run.end = end; run.words.push(word); }
        else { run = { start: i, end, words: [word] }; runs.push(run); }
      } else run = null;
      i = Math.max(end, i + 1);
      continue;
    }
    i += 1;
  }
  return runs;
};

/**
 * A DAMAGE value as its parts: [{ text, label }], `text` the dice and formula of the part and `label` its type as written
 * ("FIRE", "Hell Fire"), or null for none. A value with no type is one part, as written. DMG is only a word: a run that is
 * DMG alone closes a part with no type; DMG at the end of a type's words is dropped.
 */
const damageParts = (value) => {
  const text = String(value);
  const runs = typeRuns(text);
  if (!runs.length) return [{ text: text.trim(), label: null }];
  const parts = [];
  let from = 0;
  for (const r of runs) {
    const words = r.words.filter((w) => w.toLowerCase() !== 'dmg');
    parts.push({ text: text.slice(from, r.start).trim(), label: words.length ? words.join(' ') : null });
    from = r.end;
  }
  const rest = text.slice(from).trim();
  if (rest) parts.push({ text: rest, label: null });
  // A part after another starts with the sign joining it: "+ 2d6" is 2d6; "- 1" stays a minus one.
  return parts.map((p, i) => ({ ...p, text: i > 0 ? p.text.replace(/^\+\s*/, '') : p.text }));
};

/** Why a DAMAGE value can't be rolled, or null: each part's dice read as a box reads them, and none left without dice. */
const damageProblem = (value, names) => {
  for (const p of damageParts(value)) {
    if (!p.text) return p.label ? `Dice before ${p.label.toUpperCase()}, like 2d6 ${p.label.toUpperCase()}` : 'Dice, like 1d8 + @might_mod';
    const problem = boxProblem(p.text, names);
    if (problem) return problem;
  }
  return null;
};

/** A type's name as a hit says it, compared: capitals, one space. */
const said = (name) => String(name).trim().toUpperCase().replace(/\s+/g, ' ');

/**
 * A DAMAGE value rolled: { value, dice, parts: [{ text, label, type, value, dice }] } or { error }. `types` are the game's
 * damage types (damageTypesOf): a part's words matched by name, any case, become `type` (its id); words the game has no
 * type for are kept as `label`, with no `type`.
 */
const rollDamage = (value, values, names, rng, types = []) => {
  const byName = new Map(types.map((t) => [said(t.name), t]));
  const parts = [];
  for (const p of damageParts(value)) {
    if (!p.text) return { error: p.label ? `Dice before ${p.label.toUpperCase()}` : 'Nothing to roll' };
    const rolled = rollAmount(p.text, values, names, rng);
    if ('error' in rolled) return { error: rolled.error };
    if ('blank' in rolled) return { error: 'Nothing to roll' };
    const type = p.label ? byName.get(said(p.label)) : undefined;
    parts.push({ text: p.text, label: p.label ? (type ? said(type.name) : said(p.label)) : null, type: type ? type.id : null, value: rolled.value, dice: rolled.dice });
  }
  return { value: parts.reduce((n, p) => n + p.value, 0), dice: parts.flatMap((p) => p.dice), parts };
};

/** Whether a value names any type: what it says is more than plain dice. */
const typed = (value) => damageParts(value).some((p) => p.label);

module.exports = { damageParts, damageProblem, rollDamage, typed, typeRuns };
