// A system's damage types (8b1a; approved mockup docs/mockups/damage-pipeline.html, answered 2026-11-23): what kind of
// hurt a hit is (8 FIRE), so a character can resist it, be immune to it or vulnerable to it.
//
//   damage: {
//     types: {
//       necrotic: { on: false },                                  // a starter one, turned off
//       physical: { on: true },                                   // one that starts off, turned on
//       fire: { name: 'Flame', description: 'Burns.' },           // a starter one, edited
//       sonic: { name: 'Sonic', icon: 'wave' },                   // one of the system's own, a drawn icon
//       laser: { name: 'Laser', drawn: ['0000', ...] },           // one with a picture from the 16 x 16 pad (drawings.js)
//     },
//     resist: { means: 'Takes half, rounded down.' },             // what each word means in this game, as words
//     immune: { means: 'Takes none.' },
//     vulnerable: { means: 'Takes double.' },
//   }
//
// Every system starts with the starter set below, laid out as CONDITIONS is: a definition stores only what it changes, a
// starter type left alone is not written down, and any other id is the system's own and needs a name. Decided with the
// user (the mockup): the usual games' types, PHYSICAL or its three parts, and ENERGY, KINETIC and EMP for a cyberpunk
// table, some starting off; rename, switch off or add your own, up to LIMITS.types in all; an icon from the conditions'
// drawn ones and five drawn for damage (BLADE, POINT, IMPACT, WAVE, RAY), an upload, or a drawing on the pad (DRAW).
//
// A type's name is what a hit says ("2d6 FIRE DMG", 8b2), so two types that are on may not share one, and a name is
// letters, digits, spaces, a hyphen or an apostrophe, never DMG. What RESIST, IMMUNE and VULNERABLE do to a number
// (WORKS OUT AS) and APPLY DAMAGE come with 8b5, where they are first used.
//
// Pure: the definition's checks read it, and the running game will.

const { ICONS: CONDITION_ICONS, UPLOADED_ICON } = require('./conditions');
const { isDrawn, DRAWN_PROBLEM } = require('./drawings');

const ID = /^[a-z][a-z0-9_]{0,39}$/;
/** A type's name, as a hit says it: starting with a letter, then letters, digits, spaces, a hyphen or an apostrophe. */
const NAME = /^[A-Za-z][A-Za-z0-9 '-]*$/;
const LIMITS = { types: 40, name: 30, description: 300, means: 200 };

/** The icons drawn for damage (8b1a), beside the conditions' 27. */
const DAMAGE_ICONS = ['blade', 'point', 'impact', 'wave', 'ray'];
const ICONS = [...CONDITION_ICONS, ...DAMAGE_ICONS];
const isIcon = (icon) => typeof icon === 'string' && (ICONS.includes(icon) || UPLOADED_ICON.test(icon));

/** The starter set every system has, in this order; `on: false` starts off. Names and words are CITY_NET's own. */
const STANDARD = [
  { id: 'fire', name: 'Fire', icon: 'flame', description: 'Burns.' },
  { id: 'cold', name: 'Cold', icon: 'snow', description: 'Freezes.' },
  { id: 'lightning', name: 'Lightning', icon: 'bolt', description: 'Shocks.' },
  { id: 'acid', name: 'Acid', icon: 'drop', description: 'Eats away.' },
  { id: 'poison', name: 'Poison', icon: 'bio', description: 'Sickens.' },
  { id: 'necrotic', name: 'Necrotic', icon: 'skull', description: 'Withers life.' },
  { id: 'radiant', name: 'Radiant', icon: 'star', description: 'Searing light.' },
  { id: 'psychic', name: 'Psychic', icon: 'spiral', description: 'Hurts the mind.' },
  { id: 'force', name: 'Force', icon: 'ray', description: 'Pure magic.' },
  { id: 'thunder', name: 'Thunder', icon: 'wave', description: 'A blast of sound.' },
  { id: 'physical', name: 'Physical', icon: 'impact', description: 'Any blow, cut or shot.', on: false },
  { id: 'bludgeoning', name: 'Bludgeoning', icon: 'impact', description: 'Blunt blows.' },
  { id: 'piercing', name: 'Piercing', icon: 'point', description: 'Stabs and arrows.' },
  { id: 'slashing', name: 'Slashing', icon: 'blade', description: 'Cuts.' },
  { id: 'energy', name: 'Energy', icon: 'bolt', description: 'Lasers and plasma.', on: false },
  { id: 'kinetic', name: 'Kinetic', icon: 'point', description: 'Bullets and blows.', on: false },
  { id: 'emp', name: 'EMP', icon: 'signal', description: 'Fries electronics and chrome.', on: false },
];
const STANDARD_IDS = new Set(STANDARD.map((t) => t.id));

/** RESIST, IMMUNE and VULNERABLE, and what each means in a game that hasn't said. */
const KINDS = ['resist', 'immune', 'vulnerable'];
const MEANS = { resist: 'Takes half, rounded down.', immune: 'Takes none.', vulnerable: 'Takes double.' };

const DAMAGE_KEYS = new Set(['types', ...KINDS]);
const STANDARD_KEYS = new Set(['on', 'name', 'icon', 'drawn', 'description']);
const OWN_KEYS = new Set(['name', 'icon', 'drawn', 'description']);

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const typed = (v) => typeof v === 'string' && v.trim() !== '';

/** A type's name as it is said: the one typed, or the starter's. */
const nameOf = (base, t) => (typed(t.name) ? t.name.trim() : base ? base.name : '');
/** Whether a type is on: one of the system's own always is; a starter one as set, or as it starts. */
const isOn = (base, t) => (base ? (typeof t.on === 'boolean' ? t.on : base.on !== false) : true);

/** Problems with a definition's `damage`, pushed onto `problems`. */
const checkDamage = (damage, problems) => {
  if (damage === undefined) return;
  if (!isPlainObject(damage)) { problems.push({ where: 'damage', message: 'Must be the damage types and what resisting means' }); return; }
  for (const key of Object.keys(damage)) if (!DAMAGE_KEYS.has(key)) problems.push({ where: `damage, ${key}`, message: 'Not part of damage' });

  for (const kind of KINDS) {
    const k = damage[kind];
    if (k === undefined) continue;
    const where = `damage, ${kind}`;
    if (!isPlainObject(k)) { problems.push({ where, message: 'Must say what it means' }); continue; }
    for (const key of Object.keys(k)) if (key !== 'means') problems.push({ where: `${where}, ${key}`, message: 'Only what it means' });
    if (k.means !== undefined) {
      if (typeof k.means !== 'string') problems.push({ where: `${where}, means`, message: 'Must be text' });
      else if (k.means.length > LIMITS.means) problems.push({ where: `${where}, means`, message: `Longer than ${LIMITS.means} characters` });
    }
  }

  const types = damage.types;
  if (types === undefined) return;
  if (!isPlainObject(types)) { problems.push({ where: 'damage, types', message: 'Must be a set of damage types' }); return; }
  const own = Object.keys(types).filter((id) => !STANDARD_IDS.has(id));
  if (STANDARD.length + own.length > LIMITS.types) {
    problems.push({ where: 'damage, types', message: `At most ${LIMITS.types} damage types, the ${STANDARD.length} starter ones included` });
  }
  for (const [id, t] of Object.entries(types)) {
    const where = `damage type ${id}`;
    const base = STANDARD.find((s) => s.id === id);
    if (!ID.test(id)) { problems.push({ where, message: 'Ids use lowercase letters, digits and _, starting with a letter' }); continue; }
    if (!isPlainObject(t)) { problems.push({ where, message: 'Must be a damage type' }); continue; }
    for (const key of Object.keys(t)) {
      if ((base ? STANDARD_KEYS : OWN_KEYS).has(key)) continue;
      problems.push({ where: `${where}, ${key}`, message: key === 'on' ? 'Only a starter type is turned off; delete one of the system\'s own instead' : 'Not part of a damage type' });
    }
    if (has(t, 'on') && typeof t.on !== 'boolean') problems.push({ where: `${where}, on`, message: 'Must say on: true or on: false' });
    if (t.name !== undefined || !base) {
      if (typeof t.name !== 'string' || (!base && !t.name.trim())) problems.push({ where: `${where}, name`, message: base ? 'Must be text' : 'Needs a name' });
      else if (t.name.length > LIMITS.name) problems.push({ where: `${where}, name`, message: `Longer than ${LIMITS.name} characters` });
      else if (t.name.trim() && !NAME.test(t.name.trim())) problems.push({ where: `${where}, name`, message: 'Letters, digits, spaces, a hyphen or an apostrophe, starting with a letter' });
      else if (t.name.trim().toUpperCase() === 'DMG') problems.push({ where: `${where}, name`, message: 'DMG is the word after a hit, so not a type\'s name' });
    }
    if (t.description !== undefined) {
      if (typeof t.description !== 'string') problems.push({ where: `${where}, description`, message: 'Must be text' });
      else if (t.description.length > LIMITS.description) problems.push({ where: `${where}, description`, message: `Longer than ${LIMITS.description} characters` });
    }
    if (t.icon !== undefined && !isIcon(t.icon)) problems.push({ where: `${where}, icon`, message: 'One of the drawn icons, or an uploaded one' });
    if (t.drawn !== undefined && !isDrawn(t.drawn)) problems.push({ where: `${where}, drawn`, message: DRAWN_PROBLEM });
    if (t.icon !== undefined && t.drawn !== undefined) problems.push({ where: `${where}, drawn`, message: 'An icon or a drawing, not both' });
  }

  // A hit names its type (8b2): two that are on may not be called the same.
  const said = new Map();
  for (const base of STANDARD) {
    const t = isPlainObject(types[base.id]) ? types[base.id] : {};
    if (isOn(base, t)) said.set(base.id, nameOf(base, t));
  }
  for (const id of own) if (ID.test(id) && isPlainObject(types[id]) && typed(types[id].name)) said.set(id, nameOf(null, types[id]));
  const seen = new Map();
  for (const [id, name] of said) {
    const key = name.toUpperCase().replace(/\s+/g, ' ');
    if (seen.has(key)) problems.push({ where: `damage type ${id}, name`, message: `${name.toUpperCase()} is already the name of damage type ${seen.get(key)}; a hit names its type, so each needs its own` });
    else seen.set(key, id);
  }
};

/**
 * The damage types a system has on, each whole: the starter set with the system's edits (those off left out), then its
 * own, in the order written. `icon` or `drawn`, one of them; an own type with neither has the drawn target.
 */
const damageTypesOf = (definition) => {
  const damage = definition && isPlainObject(definition.damage) ? definition.damage : {};
  const stored = isPlainObject(damage.types) ? damage.types : {};
  const whole = (base, id, t, standard) => {
    const look = isDrawn(t.drawn) ? { drawn: [...t.drawn] } : { icon: isIcon(t.icon) ? t.icon : (base ? base.icon : 'target') };
    return {
      id,
      name: nameOf(base, t),
      ...look,
      description: typeof t.description === 'string' ? t.description : (base ? base.description : ''),
      standard,
    };
  };
  const out = [];
  for (const base of STANDARD) {
    const t = isPlainObject(stored[base.id]) ? stored[base.id] : {};
    if (isOn(base, t)) out.push(whole(base, base.id, t, true));
  }
  for (const [id, t] of Object.entries(stored)) {
    if (STANDARD_IDS.has(id) || !ID.test(id) || !isPlainObject(t) || !typed(t.name)) continue;
    out.push(whole(null, id, t, false));
  }
  return out.slice(0, LIMITS.types);
};

/** Every type's id, on or off (8b3a): what a RESISTANCE row may name, kept while its type is off. */
const damageTypeIdsOf = (definition) => {
  const damage = definition && isPlainObject(definition.damage) ? definition.damage : {};
  const stored = isPlainObject(damage.types) ? damage.types : {};
  const own = Object.entries(stored).filter(([id, t]) => !STANDARD_IDS.has(id) && ID.test(id) && isPlainObject(t) && typed(t.name)).map(([id]) => id);
  return new Set([...STANDARD_IDS, ...own]);
};

/** What RESIST, IMMUNE and VULNERABLE mean in a system: its words, or the app's where it says none. */
const meaningsOf = (definition) => {
  const damage = definition && isPlainObject(definition.damage) ? definition.damage : {};
  return Object.fromEntries(KINDS.map((k) => [k, isPlainObject(damage[k]) && typed(damage[k].means) ? damage[k].means.trim() : MEANS[k]]));
};

module.exports = { STANDARD, ICONS, DAMAGE_ICONS, KINDS, MEANS, LIMITS, isIcon, checkDamage, damageTypesOf, damageTypeIdsOf, meaningsOf };
