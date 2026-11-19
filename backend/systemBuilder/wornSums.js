// What is worn, summed by column (8a5b; approved mockup docs/mockups/item-types.html, 2026-11-14, decision 6): each NUMBER
// column of a system's own item types is read by formulas as @<type>_<column>, what the worn items of that type have in it
// added together: @armor_defense, the worn ARMOR's DEFENSE. So a system writes AC as 10 + @armor_defense + @agi_mod.
//
// Worn is 7e3's: an item of the system, carried (a line of its name READIED or STOWED) and WORN, attuned or not. Its value
// is its line's own, else the item's, as the sheet shows it; one line wears as one, so how many there are doesn't count.
// A line made by hand is no item and is never worn. Every name reads 0 while nothing of it is worn.
// Pure: checks and reads.

const { typesOf, ownTypes, lineColumns, linesOf } = require('./itemTypes');
const { itemsOf, stateOf } = require('./items');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Each name formulas read: { name, type, column, label }, label as the sheet says it ("Armor DEFENSE worn"). */
const wornNamesOf = (definition) => (ownTypes(definition)
  ? typesOf(definition).flatMap((t) => t.columns.filter((c) => c.kind === 'number')
    .map((c) => ({ name: `${t.id}_${c.id}`, type: t.id, column: c.id, label: `${t.one || t.label || t.id} ${c.label || c.id} worn`, said: `${t.label || t.id}'s ${c.label || c.id}` })))
  : []);

const carriedLine = (line) => { const c = typeof line.carry === 'string' ? line.carry.trim().toLowerCase() : ''; return c === 'readied' || c === 'stowed'; };

/** Each name with what the worn items have in it together: 0 where none is worn. */
const wornSumsOf = (definition, data) => {
  const names = wornNamesOf(definition);
  if (!names.length) return {};
  const sums = Object.fromEntries(names.map((n) => [n.name, 0]));
  const items = itemsOf(definition);
  const read = { known: () => true, refused: () => '' };
  const counted = new Set();
  for (const line of linesOf(data)) {
    if (!isPlainObject(line) || !carriedLine(line)) continue;
    const cols = lineColumns(definition, line, items, read);
    // One line wears as one, and an item is worn once however many lines have its name.
    // A line made by hand is no item, and none is worn under no name.
    if (counted.has(cols.item) || !stateOf(data, cols.item).worn) continue;
    counted.add(cols.item);
    // Only a NUMBER column has a name to add into, and its values are numbers (lineColumns keeps only those that fit).
    for (const [column, value] of Object.entries(cols.values)) {
      const name = `${cols.type}_${column}`;
      if (Object.prototype.hasOwnProperty.call(sums, name)) sums[name] += value;
    }
  }
  for (const n of Object.keys(sums)) sums[n] = Math.round(sums[n] * 1000) / 1000;
  return sums;
};

/** Problems with the names, pushed onto `problems`: none may be a stat's, a formula's or a level's (`taken`). */
const checkWornSums = (definition, problems, taken) => {
  for (const n of wornNamesOf(definition)) {
    if (taken.has(n.name)) {
      problems.push({ where: `type ${n.type}, column ${n.column}`, message: `@${n.name} is what the worn ${n.said} add up to: a stat, formula or level has this name` });
    }
  }
};

module.exports = { wornNamesOf, wornSumsOf, checkWornSums };
