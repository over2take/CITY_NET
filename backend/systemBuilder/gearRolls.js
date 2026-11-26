// A DAMAGE or DICE column rolled from a line of a sheet's gear (8a3b; approved mockup docs/mockups/item-types.html,
// 2026-11-14, decision 4): the line's own dice, else its item's, read against the sheet as rolls read it, rolled with the
// server's dice into the log ("Wren rolled Longsword DAMAGE 1d8 + @might_mod [5] + 2 = 7"). Putting damage on a target,
// its type and resistances, is 8b's. Pure: the socket hands in the sheet and the dice.
//
// A DAMAGE that names its types (8b2a, damageText.js) rolls part by part, the log saying each: "Kes rolled Flame Tongue
// DAMAGE 1d8 SLASHING + 2d6 FIRE [5] + [(4, 5)] = 5 SLASHING + 9 FIRE DMG (14)". Plain dice are rolled and said as before.

const { lineColumns, typesOf, linesOf } = require('./itemTypes');
const { rollAmount } = require('./tierRolls');
const { namesOf, effectiveData } = require('./choices');
const { damageParts, rollDamage, typed } = require('./damageText');
const { damageTypesOf } = require('./damageTypes');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

/** The dice of one roll as the log shows them: "(4, 5)" for several, "5" for one, "0" for none. */
const diceShown = (dice) => dice.map((d) => (d.rolls.length > 1 ? `(${d.rolls.join(', ')})` : String(d.rolls[0] ?? 0))).join(' + ') || '0';

/** A DAMAGE that names its types, rolled part by part (8b2a): as rollGear answers, with `parts`. */
const rollTyped = (definition, data, text, names, rng, { who, forName, line, type, col }) => {
  const rolled = rollDamage(text, effectiveData(definition, data), names, rng, damageTypesOf(definition));
  if ('error' in rolled) return { ok: false, error: rolled.error };
  const name = typeof line.name === 'string' && line.name.trim() ? line.name.trim() : (type.one || type.label || type.id);
  const label = (col.label || col.id).toUpperCase();
  const shown = rolled.parts.map((p) => {
    const sum = p.dice.reduce((n, d) => n + d.rolls.reduce((a, b) => a + b, 0), 0);
    const add = p.value - sum;
    return `[${diceShown(p.dice)}${add ? ` ${add > 0 ? '+' : '-'} ${Math.abs(add)}` : ''}]`;
  }).join(' + ');
  const each = rolled.parts.map((p) => (p.label ? `${p.value} ${p.label}` : String(p.value))).join(' + ');
  const said = `${each} DMG${rolled.parts.length > 1 ? ` (${rolled.value})` : ''}`;
  const history = `${who} rolled ${name} ${label}${forName ? ` for ${forName}` : ''} ${String(text).trim()} ${shown} = ${said}`;
  const sum = rolled.dice.reduce((n, d) => n + d.rolls.reduce((a, b) => a + b, 0), 0);
  return {
    ok: true, line: name, label, kind: col.kind, text: String(text).trim(), value: rolled.value, dice: rolled.dice, add: rolled.value - sum, history,
    parts: rolled.parts.map((p) => ({ value: p.value, label: p.label, type: p.type })),
  };
};

/**
 * Line `index`'s column `column` rolled: `{ ok: true, line, label, kind, text, value, dice, add, history, parts? }`, or
 * `{ ok: false, error }` where there is nothing of a DAMAGE or DICE column with dice to roll. `who` and `forName` say
 * whose roll it is in the log, as a sheet's other rolls do.
 */
const rollGear = (definition, data, index, column, { rng, who, forName = null }) => {
  const line = linesOf(data)[index];
  if (!Number.isInteger(index) || !isPlainObject(line)) return { ok: false, error: 'No such line' };
  const items = list(isPlainObject(definition.items) ? definition.items.list : undefined).filter(isPlainObject);
  const names = { known: (n) => namesOf(definition).has(n), refused: (n) => `@${n} isn't one of this system's names` };
  const cols = lineColumns(definition, line, items, names);
  const type = typesOf(definition).find((t) => t.id === cols.type);
  const col = type && type.columns.find((c) => c.id === column);
  if (!col || (col.kind !== 'damage' && col.kind !== 'dice')) return { ok: false, error: 'Not a DAMAGE or DICE column' };
  // Its own dice or its item's, where they fit; none is a blank box, nothing to roll.
  const text = cols.values[column];
  // A DICE column's value never names a type: its words are refused before it gets here (itemTypes.js valueProblem).
  if (typeof text === 'string' && typed(text)) return rollTyped(definition, data, text, names, rng, { who, forName, line, type, col });
  const rolled = rollAmount(text, effectiveData(definition, data), names, rng);
  if ('error' in rolled || 'blank' in rolled) return { ok: false, error: rolled.error || 'Nothing to roll' };
  const sum = rolled.dice.reduce((n, d) => n + d.rolls.reduce((a, b) => a + b, 0), 0);
  const add = rolled.value - sum;
  const name = typeof line.name === 'string' && line.name.trim() ? line.name.trim() : (type.one || type.label || type.id);
  const label = (col.label || col.id).toUpperCase();
  const shown = rolled.dice.map((d) => (d.rolls.length > 1 ? `(${d.rolls.join(', ')})` : String(d.rolls[0] ?? 0))).join(' + ');
  const history = `${who} rolled ${name} ${label}${forName ? ` for ${forName}` : ''} ${String(text).trim()} [${shown || '0'}${add ? ` ${add > 0 ? '+' : '-'} ${Math.abs(add)}` : ''} = ${rolled.value}]`;
  return { ok: true, line: name, label, kind: col.kind, text: String(text).trim(), value: rolled.value, dice: rolled.dice, add, history };
};

/**
 * A DAMAGE or DICE as typed on a line, read as ROLL would read it on this character, without rolling (8a3c2; approved
 * mockup docs/mockups/gear-compact.html, decision 4: "worked out on the sheet itself, as the builder's preview is the
 * GM's"): `{ ok: true, low, high, used, names }` (the least and most it comes to, each name in it with its label and this
 * character's value), `{ ok: true, blank: true, names }` for an empty box, or `{ ok: false, error, names }` (a name the
 * system hasn't got, said as typed rather than skipped at the roll). `names` is the system's, for the box's INSERT.
 */
/**
 * A part's dice kept and all else summed, on this character (8e1; approved mockup docs/mockups/gear-table.html): "1d8 +
 * @str_mod + 3" as { dice: [{ count: 1, sides: 8 }], add: 7 }, dice of a size together. Only where the roll is its dice
 * plus a number: a die taken away, doubled or inside a function has no such sum, and is null.
 */
const workedOf = (text, values, names) => {
  const low = rollAmount(text, values, names, () => 0);
  const high = rollAmount(text, values, names, () => 1 - 1e-9);
  if ('blank' in low || 'error' in low) return null;
  const rolled = (r) => r.dice.reduce((n, d) => n + d.rolls.reduce((a, b) => a + b, 0), 0);
  const add = low.value - rolled(low);
  if (high.value - rolled(high) !== add) return null;
  const dice = [];
  for (const d of low.dice) {
    if (!d.count) continue;
    const same = dice.find((x) => x.sides === d.sides);
    if (same) same.count += d.count; else dice.push({ count: d.count, sides: d.sides });
  }
  return { dice, add };
};

/** What one reading needs of the sheet, worked out once for every box read (readGearLines). */
const readingOf = (definition, data) => {
  const labels = namesOf(definition);
  return {
    labels,
    names: { known: (n) => labels.has(n), refused: (n) => `@${n} isn't one of this system's names` },
    nameList: [...labels].map(([id, label]) => ({ token: `@${id}`, label: String(label).toUpperCase() })),
    values: effectiveData(definition, data),
  };
};

const readGearDice = (definition, data, text, reading = readingOf(definition, data)) => {
  const { labels, names, nameList, values } = reading;
  // The lowest every die can come up, and the highest; a die taken away (10 - 1d4) swaps which is which.
  // A DAMAGE that names its types (8b2a): each part read, the least and most summed; the words are no names.
  if (typeof text === 'string' && typed(text)) {
    const parts = damageParts(text);
    let lowSum = 0; let highSum = 0;
    for (const p of parts) {
      const lo = rollAmount(p.text, values, names, () => 0);
      if ('blank' in lo) return { ok: false, error: p.label ? `Dice before ${p.label.toUpperCase()}` : 'Nothing to roll', names: nameList };
      if ('error' in lo) return { ok: false, error: lo.error, names: nameList };
      const hi = rollAmount(p.text, values, names, () => 1 - 1e-9);
      lowSum += Math.min(lo.value, hi.value); highSum += Math.max(lo.value, hi.value);
    }
    const usedTyped = [...new Set([...String(text).matchAll(/@([a-z][a-z0-9_]*)/g)].map((m) => m[1]))]
      .map((id) => { const n = Number(values[id]); return { token: `@${id}`, label: String(labels.get(id) || id), value: Number.isFinite(n) ? n : 0 }; });
    // Each part's dice and sum, with its type as written (8e1); none where one part has no plain sum.
    const each = parts.map((p) => ({ ...workedOf(p.text, values, names), type: p.label ? String(p.label).toUpperCase() : null }));
    const worked = each.every((w) => Array.isArray(w.dice)) ? each : null;
    return { ok: true, low: lowSum, high: highSum, used: usedTyped, names: nameList, worked };
  }
  const low = rollAmount(text, values, names, () => 0);
  if ('blank' in low) return { ok: true, blank: true, names: nameList };
  if ('error' in low) return { ok: false, error: low.error, names: nameList };
  const high = rollAmount(text, values, names, () => 1 - 1e-9);
  const used = [...new Set([...String(text).matchAll(/@([a-z][a-z0-9_]*)/g)].map((m) => m[1]))]
    .map((id) => { const n = Number(values[id]); return { token: `@${id}`, label: String(labels.get(id) || id), value: Number.isFinite(n) ? n : 0 }; });
  const one = workedOf(text, values, names);
  return { ok: true, low: Math.min(low.value, high.value), high: Math.max(low.value, high.value), used, names: nameList, worked: one ? [{ ...one, type: null }] : null };
};

/** Most boxes one asking reads (8e1): a sheet's every line of gear, each DAMAGE and DICE, at once. */
const READ_LINES_LIMIT = 200;

/**
 * Every DAMAGE and DICE on a sheet's lines of gear read at once (8e1): one answer per text, in order, as readGearDice
 * answers each, the sheet worked out once. Not a list, or past READ_LINES_LIMIT, is nothing read.
 */
const readGearLines = (definition, data, texts) => {
  if (!Array.isArray(texts) || texts.length > READ_LINES_LIMIT) return { ok: false, error: 'Nothing to read' };
  const reading = readingOf(definition, data);
  return { ok: true, reads: texts.map((t) => (typeof t === 'string' ? readGearDice(definition, data, t.slice(0, 200), reading) : { ok: false, error: 'Not dice' })) };
};

module.exports = { rollGear, readGearDice, readGearLines, workedOf, READ_LINES_LIMIT };
