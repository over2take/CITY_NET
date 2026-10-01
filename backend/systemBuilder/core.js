// A custom system's core rules: the setup questions, answered as data.
//
// Creating a system starts by asking how its core works (docs/system-builder-plan.md, "Core
// rules setup"). The answers are kept here:
//
//   core: {
//     health: { model: 'tracks', tracks: [{ id: 'physical', label: 'PHYSICAL' }, { id: 'stun', label: 'STUN' }] },
//     advancement: ['levels'],          // one or several; none at all is allowed
//     dice: ['d20', '2d6'],             // the system's common dice, a shortcut when adding a roll
//     distance: 'meters',
//   }
//
// Initiative on or off is not here: it is a part (definition.js PARTS). Currencies come with
// their own piece.
//
// What the answers do today: the health model shapes the starter sheet a system gets before
// its GM designs one (healthLayout, used by sheet.js effectiveSheet). How each model takes
// damage and shows on the token's monitor, how characters advance, and the dice and distance
// in play arrive in their own pieces; until then the answers are recorded and checked.

// Shorter than a sheet field's 64: the starter sheet builds ids from these (stun_max, serious_2).
const NAME = /^[a-z][a-z0-9_]{0,39}$/;
const LIMITS = { label: 20, penalty: 40, dice: 8 };

/** The health models, with what the setup screen says about each. */
const HEALTH_MODELS = [
  { id: 'pool', label: 'One pool', worksLike: 'A number that goes down', examples: 'D&D, CWN, Cyberpunk RED' },
  { id: 'tracks', label: 'Two tracks', worksLike: 'Two pools, filled by different damage', examples: 'Shadowrun physical and stun; Genesys wounds and strain' },
  { id: 'typed', label: 'Damage types on one track', worksLike: 'Boxes marked lightly or heavily', examples: 'Vampire superficial and aggravated' },
  { id: 'harm', label: 'Harm levels', worksLike: 'Named severities, each with its penalty', examples: 'Blades lesser, moderate, severe' },
  { id: 'wounds', label: 'Wound count', worksLike: 'A few wounds, then out', examples: 'Savage Worlds' },
  { id: 'locations', label: 'Hit locations', worksLike: 'Damage per location, with critical injuries', examples: 'WFRP' },
  { id: 'none', label: 'None', worksLike: 'Consequences are conditions', examples: 'Some narrative games' },
];

/** How characters advance: one or several. */
const ADVANCEMENT = [
  { id: 'levels', label: 'XP levels', examples: 'D&D, CWN' },
  { id: 'milestone', label: 'Milestone', examples: 'The GM levels the group up' },
  { id: 'spend', label: 'Spend XP', examples: 'Shadowrun karma, World of Darkness, Genesys' },
  { id: 'use', label: 'Improve by use', examples: 'Call of Cthulhu' },
];

const DISTANCE = ['meters', 'feet', 'yards', 'squares', 'hexes', 'zones'];

/** d2 to d100 (odd sizes too) or Fate dice, with an optional count: d20, 2d6, 4dF, d7. */
const DIE = /^([1-9][0-9]?)?d([2-9]|[1-9][0-9]|100|F)$/;

/** Fields the starter sheet always has, which a health setting must not name. */
const STARTER_IDS = ['name', 'concept', 'description', 'cash', 'notes'];

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const label = (value, where, problems, max = LIMITS.label) => {
  if (typeof value !== 'string' || !value.trim()) problems.push({ where, message: 'Required' });
  else if (value.length > max) problems.push({ where, message: `Longer than ${max} characters` });
};

const whole = (value, min, max, where, problems) => {
  if (!Number.isInteger(value) || value < min || value > max) problems.push({ where, message: `A whole number from ${min} to ${max}` });
};

/** A list of { id, label } entries: count limits, ids, labels, no repeats. */
const namedList = (list, where, min, max, problems, extra = () => {}) => {
  if (!Array.isArray(list)) { problems.push({ where, message: 'Must be a list' }); return; }
  if (list.length < min || list.length > max) {
    problems.push({ where, message: min === max ? `Exactly ${min}` : `From ${min} to ${max}` });
  }
  const ids = new Set();
  list.slice(0, max).forEach((entry, i) => {
    const ew = isPlainObject(entry) && typeof entry.id === 'string' ? `${where} ${entry.id}` : `${where} ${i + 1}`;
    if (!isPlainObject(entry)) { problems.push({ where: ew, message: 'Needs an id and a label' }); return; }
    if (typeof entry.id !== 'string' || !NAME.test(entry.id)) problems.push({ where: ew, message: 'Ids use lowercase letters, digits and _, starting with a letter' });
    else if (ids.has(entry.id)) problems.push({ where: ew, message: 'Defined twice' });
    else ids.add(entry.id);
    label(entry.label, `${ew}, label`, problems);
    extra(entry, ew);
  });
};

/** What each model may say besides `model`. */
const HEALTH_KEYS = {
  pool: ['label'],
  tracks: ['tracks', 'overflow'],
  typed: ['label', 'types'],
  harm: ['levels'],
  wounds: ['count', 'penalty'],
  locations: ['label', 'locations'],
  none: [],
};

const checkHealth = (health, problems) => {
  if (!isPlainObject(health)) { problems.push({ where: 'core health', message: 'Must say which health model' }); return; }
  if (!Object.prototype.hasOwnProperty.call(HEALTH_KEYS, health.model)) {
    problems.push({ where: 'core health, model', message: `One of ${HEALTH_MODELS.map((m) => m.id).join(', ')}` });
    return;
  }
  for (const key of Object.keys(health)) {
    if (key !== 'model' && !HEALTH_KEYS[health.model].includes(key)) {
      problems.push({ where: `core health, ${key}`, message: `Not part of the ${health.model} model` });
    }
  }
  const w = (key) => `core health, ${key}`;
  if (health.label !== undefined) label(health.label, w('label'), problems);
  switch (health.model) {
    case 'tracks':
      namedList(health.tracks, 'core health track', 2, 2, problems);
      if (health.overflow !== undefined && typeof health.overflow !== 'boolean') problems.push({ where: w('overflow'), message: 'true or false' });
      break;
    case 'typed':
      namedList(health.types, 'core health type', 2, 4, problems);
      break;
    case 'harm':
      namedList(health.levels, 'core health level', 1, 6, problems, (level, lw) => {
        whole(level.slots, 1, 4, `${lw}, slots`, problems);
        if (level.penalty !== undefined) label(level.penalty, `${lw}, penalty`, problems, LIMITS.penalty);
      });
      break;
    case 'wounds':
      whole(health.count, 1, 10, w('count'), problems);
      if (health.penalty !== undefined) whole(health.penalty, -5, 0, w('penalty'), problems);
      break;
    case 'locations':
      namedList(health.locations, 'core health location', 1, 12, problems);
      break;
    default:
  }
};

/**
 * The health part of a starter sheet for a health model: its sections, and the header's HP
 * pair when the model has a pool on the token. A pool with no label is exactly the starter
 * sheet every system has had, so a system that answers nothing looks as it did.
 */
const healthLayout = (health, hpWord = 'HP') => {
  const h = isPlainObject(health) ? health : { model: 'pool' };
  const grid = (fields) => ({ id: 'health', label: 'HEALTH', layout: 'grid', tab: 'STATS', columns: 2, fields });
  const pool = (id, name) => [
    { id, label: name, type: 'number', source: 'token_hp', maxField: `${id}_max` },
    { id: `${id}_max`, label: `${name} MAX`, type: 'number', source: 'token_hp_max' },
  ];
  const text = (v, fallback) => (typeof v === 'string' && v.trim() ? v : fallback);
  const list = (v) => (Array.isArray(v) ? v.filter(isPlainObject) : []);
  switch (h.model) {
    case 'tracks': {
      const [first, second] = list(h.tracks);
      if (!first || !second) return healthLayout({ model: 'pool' }, hpWord);
      // The first track is the token's; the second lives on the sheet.
      return {
        sections: [grid([
          ...pool(first.id, first.label),
          { id: second.id, label: second.label, type: 'number', maxField: `${second.id}_max` },
          { id: `${second.id}_max`, label: `${second.label} MAX`, type: 'number' },
        ])],
        header: { hpField: first.id, hpMaxField: `${first.id}_max` },
      };
    }
    case 'typed':
      return {
        sections: [grid([
          ...pool('health', text(h.label, 'HEALTH')),
          ...list(h.types).map((t) => ({ id: t.id, label: t.label, type: 'number', hint: 'Boxes marked with this kind of damage' })),
        ])],
        header: { hpField: 'health', hpMaxField: 'health_max' },
      };
    case 'harm':
      return {
        sections: [{ id: 'harm', label: 'HARM', layout: 'list', tab: 'STATS', fields: list(h.levels).flatMap((level) =>
          Array.from({ length: Number.isInteger(level.slots) ? level.slots : 1 }, (_, i) => ({
            id: `${level.id}_${i + 1}`,
            label: i === 0 ? level.label : `${level.label} ${i + 1}`,
            type: 'text',
            ...(level.penalty ? { hint: level.penalty } : {}),
          }))) }],
        header: {},
      };
    case 'wounds':
      return {
        sections: [grid([
          { id: 'wounds', label: 'WOUNDS LEFT', type: 'number', source: 'token_hp', maxField: 'wounds_max' },
          { id: 'wounds_max', label: 'WOUNDS', type: 'number', source: 'token_hp_max',
            ...(Number.isInteger(h.count) ? { hint: `Out after ${h.count}` } : {}) },
        ])],
        header: { hpField: 'wounds', hpMaxField: 'wounds_max' },
      };
    case 'locations':
      return {
        sections: [
          grid(pool('hp', text(h.label, hpWord))),
          { id: 'injuries', label: 'INJURIES', layout: 'list', tab: 'STATS',
            fields: list(h.locations).map((l) => ({ id: l.id, label: l.label, type: 'text' })) },
        ],
        header: { hpField: 'hp', hpMaxField: 'hp_max' },
      };
    case 'none':
      return { sections: [], header: {} };
    default:
      return { sections: [grid(pool('hp', text(h.label, hpWord)))], header: { hpField: 'hp', hpMaxField: 'hp_max' } };
  }
};

/**
 * Check the core section. `derivedIds` are the system's derived values: a health setting
 * cannot name one, nor a field the starter sheet already has, nor collide with itself (a
 * track called `stun` and another called `stun_max`).
 */
const checkCore = (core, derivedIds, problems) => {
  if (core === undefined) return;
  if (!isPlainObject(core)) { problems.push({ where: 'core', message: 'Must be a set of answers' }); return; }
  for (const key of Object.keys(core)) {
    if (!['health', 'advancement', 'dice', 'distance'].includes(key)) problems.push({ where: `core ${key}`, message: 'Not a setup question' });
  }

  if (core.health !== undefined) {
    const before = problems.length;
    checkHealth(core.health, problems);
    if (problems.length === before) {
      const seen = new Set(STARTER_IDS);
      for (const section of healthLayout(core.health).sections) {
        for (const f of section.fields) {
          if (derivedIds.has(f.id)) problems.push({ where: `core health ${f.id}`, message: 'A derived value has this id' });
          else if (seen.has(f.id)) problems.push({ where: `core health ${f.id}`, message: 'Clashes with another field on the starter sheet' });
          seen.add(f.id);
        }
      }
    }
  }

  if (core.advancement !== undefined) {
    const ids = ADVANCEMENT.map((a) => a.id);
    if (!Array.isArray(core.advancement)) problems.push({ where: 'core advancement', message: 'Must be a list' });
    else {
      core.advancement.forEach((a) => { if (!ids.includes(a)) problems.push({ where: 'core advancement', message: `${a} is not one of ${ids.join(', ')}` }); });
      if (new Set(core.advancement).size !== core.advancement.length) problems.push({ where: 'core advancement', message: 'Named twice' });
    }
  }

  if (core.dice !== undefined) {
    if (!Array.isArray(core.dice)) problems.push({ where: 'core dice', message: 'Must be a list' });
    else {
      if (core.dice.length > LIMITS.dice) problems.push({ where: 'core dice', message: `More than ${LIMITS.dice}` });
      core.dice.forEach((d) => { if (typeof d !== 'string' || !DIE.test(d)) problems.push({ where: 'core dice', message: `${d} is not a die (d2 to d100, or dF, with a count: 2d6)` }); });
      if (new Set(core.dice).size !== core.dice.length) problems.push({ where: 'core dice', message: 'Named twice' });
    }
  }

  if (core.distance !== undefined && !DISTANCE.includes(core.distance)) {
    problems.push({ where: 'core distance', message: `One of ${DISTANCE.join(', ')}` });
  }
};

module.exports = { checkCore, healthLayout, HEALTH_MODELS, ADVANCEMENT, DISTANCE, LIMITS };
