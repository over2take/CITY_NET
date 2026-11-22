// Item types (8a1; approved mockup docs/mockups/item-types.html, 2026-11-14): what kind of thing an item is, and the
// columns that kind has, made on the builder's ITEMS page.
//
//   items: {
//     types: [{ id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [
//       { id: 'damage', label: 'DAMAGE', kind: 'damage' },              // dice that are damage (8b types and applies them)
//       { id: 'heal', label: 'HEALS', kind: 'dice' },                   // any other roll: healing, an effect
//       { id: 'range', label: 'RANGE', kind: 'text' },
//       { id: 'ammo', label: 'AMMO', kind: 'count', button: 'FIRE',     // so many of so many, spent by its button,
//         refill: 'long_rest', reload: ['pistol_rounds'] },            //   refilled by a rest or from items carried
//       { id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' },
//       { id: 'grade', label: 'GRADE', kind: 'pick', options: ['LIGHT', 'HEAVY'] },
//     ] }],
//     list: [{ id: 'pistol', label: 'Pistol', type: 'weapons', values: { damage: '2d6', range: '30 m', ammo: 6, weight: 2 } }],
//   }
//
// A system that makes no types of its own has GEAR (WEIGHT, PRICE). An item says its type (the first, unsaid) and fills
// its columns: a NUMBER a number, TEXT words, DAMAGE and DICE dice reading the sheet (1d8 + @might_mod), a COUNT the most
// it holds, PICK ONE one of the column's words.
//
// A line of a sheet's gear may say its type and fill its own columns, for a thing made by hand ("a stick, 1d4"); one named
// like an item of the system's takes that item's. A COUNT's current number is kept on the line, `counts: { ammo: 4 }`, as
// many as it holds where nothing has been spent.
//
// Pure: checks and reads. Nothing here loads the CHOICES module: the sheet's names and the rests come in as tools.

const { boxProblem } = require('./tierRolls');
const { BUILDING_TYPES } = require('../buildingTypes');
const { shopKindsOf, buysOf } = require('./buildings');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const NAME = /^[a-z][a-z0-9_]{0,63}$/;

/** The sheet's gear lines, read as the sheet stores them (a JSON string or a list). */
const linesOf = (data) => {
  let rows = isPlainObject(data) ? data.inventory : undefined;
  if (typeof rows === 'string') { try { rows = JSON.parse(rows); } catch { rows = []; } }
  return list(rows);
};

/** What a column holds: a number, words, damage dice, any other dice, a count spent and refilled, one word of a few. */
const KINDS = ['number', 'text', 'damage', 'dice', 'count', 'pick'];
const LIMITS = { types: 10, columns: 20, options: 20, word: 30, text: 200, count: 1000, reload: 10, number: 1000000000, unit: 12 };
const TYPE_KEYS = new Set(['id', 'label', 'one', 'columns', 'sold_at', 'on_sheet']);
/**
 * Where a type's lines sit on the sheet's GEAR tab (G1; approved mockup docs/mockups/sheet-gear-layout.html, 2026-11-20):
 * EQUIPPED (worn or wielded), USABLE (used up or used often: potions, ammo, kits) or PACK. Unsaid, PACK, as GEAR starts.
 */
const BANDS = ['equipped', 'usable', 'pack'];
const DEFAULT_BAND = 'pack';
/** A type's band: what it says, else PACK. */
const bandOf = (type) => (type && BANDS.includes(type.on_sheet) ? type.on_sheet : DEFAULT_BAND);
const BASE = ['id', 'label', 'kind'];
const COLUMN_KEYS = {
  number: new Set([...BASE, 'unit']), text: new Set(BASE), damage: new Set(BASE), dice: new Set(BASE),
  count: new Set([...BASE, 'button', 'refill', 'reload']), pick: new Set([...BASE, 'options']),
};
/** What a system with no types of its own has. */
const GEAR = { id: 'gear', label: 'GEAR', one: 'Gear', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }, { id: 'price', label: 'PRICE', kind: 'number' }] };

/** The system's types, those well formed enough to read, each with its columns; GEAR where it makes none. */
const typesOf = (definition) => {
  const own = list(isPlainObject(definition && definition.items) ? definition.items.types : undefined)
    .filter((t) => isPlainObject(t) && typeof t.id === 'string')
    .map((t) => ({ ...t, columns: list(t.columns).filter((c) => isPlainObject(c) && typeof c.id === 'string' && KINDS.includes(c.kind)) }));
  return own.length ? own : [GEAR];
};
/** Whether the system makes types of its own. */
const ownTypes = (definition) => list(isPlainObject(definition && definition.items) ? definition.items.types : undefined).some((t) => isPlainObject(t) && typeof t.id === 'string');

/** The kinds of building that are shops: what a type can be SOLD AT (8a7a2). */
const SHOP_TYPES = BUILDING_TYPES.filter((t) => t.shop).map((t) => t.id);
/** Where a type is sold where the GM hasn't said (8a7a2): the General Store, so its lines are on sale somewhere from the start. */
const DEFAULT_SOLD_AT = ['general_store'];

/** The kinds of shop a type's lines are sold at (8a7a2; decided 2026-11-20): what it says, else the General Store. */
// The game's own shops (8a7b) count where the definition is given: they are its alone; told no game, the app's six.
const soldAt = (type, definition) => {
  const kinds = shopKindsOf(definition);
  return Array.isArray(type && type.sold_at) ? type.sold_at.filter((id) => kinds.includes(id)) : DEFAULT_SOLD_AT;
};

/** The shelves of the system's own types a kind of building sells (8a7a2): `type:<id>` for each sold at it. None without types of its own. */
const typeShelvesAt = (definition, buildingType) => (ownTypes(definition)
  ? typesOf(definition).filter((t) => soldAt(t, definition).includes(buildingType)).map((t) => `type:${t.id}`) : []);

/**
 * The shelves a kind of shop buys back from (8a7b1b): those it sells (`sold`), or, where it BUYS ANYTHING, every shelf this
 * game prices: the app's catalogues it has on (`onCatalogues`) and each of its own types'.
 */
const boughtAt = (definition, buildingType, sold, onCatalogues) => (buysOf(definition, buildingType) === 'anything'
  ? [...new Set([...sold, ...onCatalogues, ...(ownTypes(definition) ? typesOf(definition).map((t) => `type:${t.id}`) : [])])] : sold);

/** The type an item or a line is: the one it names, or the first. */
const typeNamed = (definition, id) => { const types = typesOf(definition); return types.find((t) => t.id === id) || types[0]; };

/** Why a value doesn't fit its column, or null. `names` tells the sheet's names, for dice reading them. */
const valueProblem = (column, value, names) => {
  switch (column.kind) {
    case 'number': return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= LIMITS.number ? null : 'A number';
    case 'text': return typeof value === 'string' && value.length <= LIMITS.text ? null : `Words, at most ${LIMITS.text} characters`;
    case 'damage': case 'dice': {
      if (typeof value !== 'string' || !value.trim()) return 'Dice, like 1d8 + @might_mod';
      if (value.length > LIMITS.text) return `At most ${LIMITS.text} characters`;
      return boxProblem(value, names);
    }
    case 'count': return Number.isInteger(value) && value >= 0 && value <= LIMITS.count ? null : `How many it holds: 0 to ${LIMITS.count}`;
    case 'pick': return list(column.options).includes(value) ? null : `One of ${list(column.options).join(', ') || 'its words'}`;
    default: return 'Not a kind of column';
  }
};

/**
 * Problems with a definition's item types, pushed onto `problems`. `tools`: CHOICES' own `text` and `keys`, the most a
 * label is, `itemIds` the system's items (a COUNT reloads from them) and `restIds` its rests (one refills it).
 */
const checkTypes = (definition, problems, { text, keys, labelMost, itemIds = new Set(), restIds = new Set() }) => {
  const types = isPlainObject(definition.items) ? definition.items.types : undefined;
  if (types === undefined) return;
  if (!Array.isArray(types)) { problems.push({ where: 'items, types', message: 'Must be a list of item types' }); return; }
  if (types.length > LIMITS.types) problems.push({ where: 'items, types', message: `At most ${LIMITS.types} item types` });
  const ids = new Set();
  types.slice(0, LIMITS.types).forEach((t, i) => {
    const where = isPlainObject(t) && typeof t.id === 'string' ? `type ${t.id}` : `type ${i + 1}`;
    if (!isPlainObject(t)) { problems.push({ where, message: 'Must be an item type' }); return; }
    keys(t, TYPE_KEYS, where, 'an item type');
    if (typeof t.id !== 'string' || !NAME.test(t.id)) problems.push({ where, message: 'Ids use lowercase letters, digits and _, starting with a letter' });
    else if (ids.has(t.id)) problems.push({ where, message: 'Another item type has this id already' });
    else ids.add(t.id);
    text(t.label, `${where}, label`, labelMost, { required: true });
    text(t.one, `${where}, one`, labelMost);
    // Where its lines are sold (8a7a2): a list of the kinds of shop, each once.
    // Its band on the sheet (G1): one of the three.
    if (t.on_sheet !== undefined && !BANDS.includes(t.on_sheet)) problems.push({ where: `${where}, on_sheet`, message: 'EQUIPPED, USABLE or PACK' });
    if (t.sold_at !== undefined) {
      if (!Array.isArray(t.sold_at)) problems.push({ where: `${where}, sold_at`, message: 'A list of the kinds of shop that sell it' });
      else t.sold_at.forEach((id, n) => {
        if (!shopKindsOf(definition).includes(id)) problems.push({ where: `${where}, sold_at ${n + 1}`, message: `No kind of shop is called ${String(id)}` });
        else if (t.sold_at.indexOf(id) !== n) problems.push({ where: `${where}, sold_at ${n + 1}`, message: 'Said twice' });
      });
    }
    if (t.columns === undefined) return;
    if (!Array.isArray(t.columns)) { problems.push({ where: `${where}, columns`, message: 'Must be a list of columns' }); return; }
    if (t.columns.length > LIMITS.columns) problems.push({ where: `${where}, columns`, message: `At most ${LIMITS.columns} columns` });
    const cols = new Set();
    t.columns.slice(0, LIMITS.columns).forEach((c, k) => {
      const cw = isPlainObject(c) && typeof c.id === 'string' ? `${where}, column ${c.id}` : `${where}, column ${k + 1}`;
      if (!isPlainObject(c)) { problems.push({ where: cw, message: 'Must be a column' }); return; }
      if (typeof c.id !== 'string' || !NAME.test(c.id)) problems.push({ where: cw, message: 'Ids use lowercase letters, digits and _, starting with a letter' });
      else if (cols.has(c.id)) problems.push({ where: cw, message: 'Another column of this type has this id already' });
      else cols.add(c.id);
      text(c.label, `${cw}, label`, labelMost, { required: true });
      if (!KINDS.includes(c.kind)) { problems.push({ where: `${cw}, kind`, message: 'NUMBER, TEXT, DAMAGE, DICE, COUNT or PICK ONE' }); return; }
      keys(c, COLUMN_KEYS[c.kind], cw, `a ${c.kind === 'pick' ? 'PICK ONE' : c.kind.toUpperCase()} column`);
      if (c.kind === 'number' && c.unit !== undefined) text(c.unit, `${cw}, unit`, LIMITS.unit);
      if (c.kind === 'pick') {
        const words = list(c.options);
        if (!Array.isArray(c.options) || !words.length) problems.push({ where: `${cw}, options`, message: 'The words to pick one of' });
        else if (words.length > LIMITS.options) problems.push({ where: `${cw}, options`, message: `At most ${LIMITS.options} words` });
        else if (words.some((w) => typeof w !== 'string' || !w.trim() || w.length > LIMITS.word)) problems.push({ where: `${cw}, options`, message: `Each a word or two, at most ${LIMITS.word} characters` });
        else if (new Set(words).size !== words.length) problems.push({ where: `${cw}, options`, message: 'A word is there twice' });
      }
      if (c.kind === 'count') {
        if (c.button !== undefined) text(c.button, `${cw}, button`, LIMITS.word, { required: true });
        if (c.refill !== undefined && !restIds.has(c.refill)) problems.push({ where: `${cw}, refill`, message: typeof c.refill === 'string' ? `No rest is called ${c.refill}` : 'A rest, or nothing' });
        if (c.reload !== undefined) {
          if (!Array.isArray(c.reload)) problems.push({ where: `${cw}, reload`, message: 'The items it reloads from' });
          else if (c.reload.length > LIMITS.reload) problems.push({ where: `${cw}, reload`, message: `At most ${LIMITS.reload} items` });
          else for (const r of c.reload) if (!itemIds.has(r)) problems.push({ where: `${cw}, reload`, message: typeof r === 'string' ? `No item is called ${r}` : 'An item of this system' });
        }
      }
    });
  });
};

/** Problems with an item's type and its values, pushed onto `problems`. `names` tells the sheet's names, for dice. */
const checkItemType = (definition, item, where, problems, names) => {
  const types = typesOf(definition);
  if (item.type !== undefined && !types.some((t) => t.id === item.type)) problems.push({ where: `${where}, type`, message: typeof item.type === 'string' ? `No item type is called ${item.type}` : 'One of this system\'s item types' });
  if (item.values === undefined) return;
  if (!isPlainObject(item.values)) { problems.push({ where: `${where}, values`, message: 'Must say each column\'s value' }); return; }
  const type = typeNamed(definition, item.type);
  const columns = new Map(type.columns.map((c) => [c.id, c]));
  for (const [id, value] of Object.entries(item.values)) {
    const column = columns.get(id);
    if (!column) { problems.push({ where: `${where}, values, ${id}`, message: `${type.one || type.label} has no column called ${id}` }); continue; }
    const problem = valueProblem(column, value, names);
    if (problem) problems.push({ where: `${where}, values, ${id}`, message: problem });
  }
};

/** The types as the sheet is told them: each column by name and kind, with what its kind needs (a reload by item name). */
const typesShown = (definition, items = []) => {
  const labels = new Map(items.map((i) => [i.id, i.label || i.id]));
  return typesOf(definition).map((t) => ({
    id: t.id, label: t.label || t.id, one: t.one || t.label || t.id,
    // The kinds of shop that sell it, the General Store where unsaid (8a7a2): the shop window's shelves follow it.
    sold_at: soldAt(t, definition),
    // Its band on the GEAR tab (G1), PACK where unsaid.
    on_sheet: bandOf(t),
    columns: t.columns.map((c) => ({
      id: c.id, label: c.label || c.id, kind: c.kind,
      ...(c.kind === 'number' && typeof c.unit === 'string' && c.unit.trim() ? { unit: c.unit } : {}),
      ...(c.kind === 'pick' ? { options: list(c.options).filter((w) => typeof w === 'string') } : {}),
      ...(c.kind === 'count' ? {
        button: typeof c.button === 'string' && c.button.trim() ? c.button : 'USE',
        ...(typeof c.refill === 'string' ? { refill: c.refill } : {}),
        ...(Array.isArray(c.reload) && c.reload.length ? { reload: c.reload.filter((r) => labels.has(r)).map((r) => labels.get(r)) } : {}),
      } : {}),
    })),
  }));
};

/** An item's values that fit its columns, as the sheet is told them. */
const itemValues = (definition, item, names) => {
  const type = typeNamed(definition, item.type);
  const values = isPlainObject(item.values) ? item.values : {};
  return Object.fromEntries(type.columns.filter((c) => Object.prototype.hasOwnProperty.call(values, c.id) && !valueProblem(c, values[c.id], names)).map((c) => [c.id, values[c.id]]));
};

/** A type's own column read as an item's price (8a7a3a): a NUMBER column called `price`. */
const PRICE_COLUMN = 'price';
/** The most an item can cost, as a catalogue line can. */
const MOST_PRICE = 1000000000;
/** Whether a value is a price: a number, 0 up to the most. */
const isPrice = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= MOST_PRICE;

/**
 * An item's price (8a7a3a; decided 2026-11-21, mockup docs/mockups/types-in-shops.html): its own PRICE, else its type's own
 * `price` NUMBER column's value, read as it, so a GM who made a PRICE column keeps every price they typed. Undefined with neither.
 */
const itemPrice = (definition, item) => {
  if (!isPlainObject(item)) return undefined;
  if (item.price !== undefined) return item.price;
  const value = isPlainObject(item.values) ? item.values[PRICE_COLUMN] : undefined;
  return typeNamed(definition, item.type).columns.some((c) => c.id === PRICE_COLUMN && c.kind === 'number') && isPrice(value) ? value : undefined;
};

/**
 * Whether an item is IN SHOPS (8a7a3a): as its switch says; an item saved before the switch was, by whether it has a price,
 * so a system made before this neither sells its unpriced items nor fills up with problems.
 */
const inShops = (definition, item) => (isPlainObject(item) && typeof item.in_shops === 'boolean' ? item.in_shops : itemPrice(definition, item) !== undefined);

/**
 * A line of gear's columns (8a1): its type (its own, an item's of its name, or the first), each column's value (the
 * line's own where it fills one, else the item's), and each COUNT as { now, most }, `now` the line's own, held to 0 to
 * most, as many as it holds where unsaid. `items` are the system's, matched to the line by name. `names` tells the sheet's
 * names, for dice.
 */
const lineColumns = (definition, line, items, names) => {
  const l = isPlainObject(line) ? line : {};
  const name = typeof l.name === 'string' ? l.name.trim().toLowerCase() : '';
  const item = name ? items.find((i) => typeof i.label === 'string' && i.label.trim().toLowerCase() === name) : undefined;
  const types = typesOf(definition);
  const type = types.find((t) => t.id === l.type) || (item ? typeNamed(definition, item.type) : types[0]);
  const own = isPlainObject(l.values) ? l.values : {};
  const given = item && type.id === typeNamed(definition, item.type).id && isPlainObject(item.values) ? item.values : {};
  const values = {};
  const counts = {};
  for (const c of type.columns) {
    const pick = [own[c.id], given[c.id]].find((v) => v !== undefined && !valueProblem(c, v, names));
    if (c.kind === 'count') {
      const most = pick === undefined ? 0 : pick;
      const left = isPlainObject(l.counts) ? l.counts[c.id] : undefined;
      counts[c.id] = { now: Number.isInteger(left) ? Math.max(0, Math.min(most, left)) : most, most };
    } else if (pick !== undefined) values[c.id] = pick;
  }
  return { type: type.id, ...(item ? { item: item.id } : {}), values, counts };
};

module.exports = { BANDS, DEFAULT_BAND, bandOf, PRICE_COLUMN, MOST_PRICE, isPrice, itemPrice, inShops, KINDS, LIMITS, GEAR, NAME, SHOP_TYPES, DEFAULT_SOLD_AT, soldAt, typeShelvesAt, boughtAt, linesOf, typesOf, ownTypes, typeNamed, valueProblem, checkTypes, checkItemType, typesShown, itemValues, lineColumns };
