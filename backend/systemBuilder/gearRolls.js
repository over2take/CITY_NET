// A DAMAGE or DICE column rolled from a line of a sheet's gear (8a3b; approved mockup docs/mockups/item-types.html,
// 2026-11-14, decision 4): the line's own dice, else its item's, read against the sheet as rolls read it, rolled with the
// server's dice into the log ("Wren rolled Longsword DAMAGE 1d8 + @might_mod [5] + 2 = 7"). Putting damage on a target,
// its type and resistances, is 8b's. Pure: the socket hands in the sheet and the dice.

const { lineColumns, typesOf } = require('./itemTypes');
const { rollAmount } = require('./tierRolls');
const { namesOf, effectiveData } = require('./choices');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

/** The sheet's gear lines, read as the sheet stores them (a JSON string or a list). */
const linesOf = (data) => {
  let rows = isPlainObject(data) ? data.inventory : undefined;
  if (typeof rows === 'string') { try { rows = JSON.parse(rows); } catch { rows = []; } }
  return list(rows);
};

/**
 * Line `index`'s column `column` rolled: `{ ok: true, line, label, kind, text, value, dice, add, history }`, or
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
const readGearDice = (definition, data, text) => {
  const labels = namesOf(definition);
  const names = { known: (n) => labels.has(n), refused: (n) => `@${n} isn't one of this system's names` };
  const nameList = [...labels].map(([id, label]) => ({ token: `@${id}`, label: String(label).toUpperCase() }));
  const values = effectiveData(definition, data);
  // The lowest every die can come up, and the highest; a die taken away (10 - 1d4) swaps which is which.
  const low = rollAmount(text, values, names, () => 0);
  if ('blank' in low) return { ok: true, blank: true, names: nameList };
  if ('error' in low) return { ok: false, error: low.error, names: nameList };
  const high = rollAmount(text, values, names, () => 1 - 1e-9);
  const used = [...new Set([...String(text).matchAll(/@([a-z][a-z0-9_]*)/g)].map((m) => m[1]))]
    .map((id) => { const n = Number(values[id]); return { token: `@${id}`, label: String(labels.get(id) || id), value: Number.isFinite(n) ? n : 0 }; });
  return { ok: true, low: Math.min(low.value, high.value), high: Math.max(low.value, high.value), used, names: nameList };
};

module.exports = { linesOf, rollGear, readGearDice };
