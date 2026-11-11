// A system's stats: the numbers players fill in, in groups (4b2a).
//
//   stats: [
//     { id: 'abilities', label: 'ABILITIES', stats: [
//         { id: 'str', label: 'Strength', min: 3, max: 18 },
//         { id: 'dex', label: 'Dexterity', min: 3, max: 18 } ] },
//     { id: 'skills', label: 'SKILLS', stats: [{ id: 'shoot', label: 'Shoot', min: 0, max: 4, tie: 'dex' }] },
//   ],
//   samples: { str: 16, dex: 14, shoot: 1 },
//
// A formula reads a stat as @str (derived.js). Until a system designs its own sheet, the starter
// sheet shows each group as a section, so a system works end to end before the sheet designer
// (decided with the user, 2026-10-06). Skills are a group like any other; a stat may be tied to
// another (a skill to its ability), which later pieces read. `samples` are a made-up character
// the builder's STATS & RULES page checks formulas against, saved with the draft (same day).
//
// A derived value may also carry a `label`, the name players see on the sheet ("Physical save");
// its id stays what formulas read (same day).
//
// Pure: the definition checks and the starter sheet both use it.

const NAME = /^[a-z][a-z0-9_]{0,63}$/;
const LIMITS = { groups: 20, stats: 100, label: 40 };
const GROUP_KEYS = new Set(['id', 'label', 'stats']);
const STAT_KEYS = new Set(['id', 'label', 'min', 'max', 'tie']);

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const text = (value, where, problems, { required = false } = {}) => {
  if (value === undefined) { if (required) problems.push({ where, message: 'Required' }); return; }
  if (typeof value !== 'string' || !value.trim()) { problems.push({ where, message: 'Must be some text' }); return; }
  if (value.length > LIMITS.label) problems.push({ where, message: `Longer than ${LIMITS.label} characters` });
};

/** Every stat in a stats list, in order, from groups that are well formed enough to read. */
const allStats = (stats) => (Array.isArray(stats) ? stats : [])
  .filter((g) => isPlainObject(g) && Array.isArray(g.stats))
  .flatMap((g) => g.stats.filter((s) => isPlainObject(s) && typeof s.id === 'string'));

/** The ids of a definition's stats. */
const statIdsOf = (definition) => new Set(allStats(definition && definition.stats).map((s) => s.id));

/**
 * Problems with a definition's `stats`, pushed onto `problems`. `taken` are ids a stat may not
 * have, each with why: the system's derived values, and the starter sheet's own fields.
 */
const checkStats = (stats, taken, problems) => {
  if (stats === undefined) return;
  if (!Array.isArray(stats)) { problems.push({ where: 'stats', message: 'Must be a list of groups' }); return; }
  if (stats.length > LIMITS.groups) problems.push({ where: 'stats', message: `At most ${LIMITS.groups} groups` });
  const groupIds = new Set();
  const statIds = new Set();
  const ties = [];
  stats.slice(0, LIMITS.groups).forEach((g, gi) => {
    const gw = isPlainObject(g) && typeof g.id === 'string' ? `stats ${g.id}` : `stats group ${gi + 1}`;
    if (!isPlainObject(g)) { problems.push({ where: gw, message: 'Must be a group of stats' }); return; }
    for (const key of Object.keys(g)) if (!GROUP_KEYS.has(key)) problems.push({ where: `${gw}, ${key}`, message: 'Not part of a group' });
    if (typeof g.id !== 'string' || !NAME.test(g.id)) problems.push({ where: gw, message: 'Ids use lowercase letters, digits and _, starting with a letter' });
    else if (groupIds.has(g.id)) problems.push({ where: gw, message: 'Defined twice' });
    else groupIds.add(g.id);
    text(g.label, `${gw}, label`, problems, { required: true });
    if (!Array.isArray(g.stats)) { problems.push({ where: `${gw}, stats`, message: 'Must be a list of stats' }); return; }
    if (g.stats.length > LIMITS.stats) problems.push({ where: `${gw}, stats`, message: `At most ${LIMITS.stats} stats` });
    g.stats.slice(0, LIMITS.stats).forEach((s, si) => {
      const sw = isPlainObject(s) && typeof s.id === 'string' ? `stat ${s.id}` : `${gw}, stat ${si + 1}`;
      if (!isPlainObject(s)) { problems.push({ where: sw, message: 'Must be a stat' }); return; }
      for (const key of Object.keys(s)) if (!STAT_KEYS.has(key)) problems.push({ where: `${sw}, ${key}`, message: 'Not part of a stat' });
      if (typeof s.id !== 'string' || !NAME.test(s.id)) problems.push({ where: sw, message: 'Ids use lowercase letters, digits and _, starting with a letter' });
      else if (statIds.has(s.id)) problems.push({ where: sw, message: 'Defined twice' });
      else if (taken.has(s.id)) problems.push({ where: sw, message: taken.get(s.id) });
      else statIds.add(s.id);
      text(s.label, `${sw}, label`, problems, { required: true });
      for (const end of ['min', 'max']) {
        if (s[end] !== undefined && !Number.isSafeInteger(s[end])) problems.push({ where: `${sw}, ${end}`, message: 'Must be a whole number' });
      }
      if (Number.isSafeInteger(s.min) && Number.isSafeInteger(s.max) && s.min > s.max) problems.push({ where: sw, message: 'The lowest is above the highest' });
      if (s.tie !== undefined) ties.push([sw, s.id, s.tie]);
    });
  });
  for (const [sw, id, tie] of ties) {
    if (tie === id) problems.push({ where: `${sw}, tie`, message: 'Cannot be tied to itself' });
    else if (typeof tie !== 'string' || !statIds.has(tie)) problems.push({ where: `${sw}, tie`, message: 'Not one of this system\'s stats' });
  }
};

/** Problems with derived values' names, pushed onto `problems`; the rest of each is derived.js's. */
const checkDerivedLabels = (derived, problems) => {
  if (!Array.isArray(derived)) return;
  derived.forEach((d, i) => {
    if (!isPlainObject(d) || d.label === undefined) return;
    text(d.label, `${typeof d.id === 'string' ? `derived ${d.id}` : `derived value ${i + 1}`}, label`, problems);
  });
};

/** Problems with the sample character, pushed onto `problems`: numbers, for stats the system has. */
const checkSamples = (samples, statIds, problems) => {
  if (samples === undefined) return;
  if (!isPlainObject(samples)) { problems.push({ where: 'samples', message: 'Must be a set of stat values' }); return; }
  for (const [id, value] of Object.entries(samples)) {
    if (!statIds.has(id)) problems.push({ where: `samples ${id}`, message: 'Not one of this system\'s stats' });
    else if (typeof value !== 'number' || !Number.isFinite(value)) problems.push({ where: `samples ${id}`, message: 'Must be a number' });
  }
};

/** What a stat's range reads as on the sheet: "3 to 18", "at least 0", or nothing. */
const rangeHint = (s) => {
  const lo = Number.isSafeInteger(s.min) ? s.min : null;
  const hi = Number.isSafeInteger(s.max) ? s.max : null;
  if (lo !== null && hi !== null) return `${lo} to ${hi}`;
  if (lo !== null) return `At least ${lo}`;
  if (hi !== null) return `At most ${hi}`;
  return null;
};

/** The starter sheet's sections for a definition's stats: one per group, on STATS. */
const statSections = (definition) => (Array.isArray(definition && definition.stats) ? definition.stats : [])
  .filter((g) => isPlainObject(g) && typeof g.id === 'string' && Array.isArray(g.stats))
  .map((g) => ({
    id: `stats_${g.id}`,
    label: typeof g.label === 'string' && g.label.trim() ? g.label : g.id.toUpperCase(),
    layout: 'grid',
    tab: 'STATS',
    columns: 3,
    fields: g.stats.filter((s) => isPlainObject(s) && typeof s.id === 'string').map((s) => ({
      id: s.id,
      label: typeof s.label === 'string' && s.label.trim() ? s.label : s.id.toUpperCase(),
      type: 'number',
      ...(rangeHint(s) ? { hint: rangeHint(s) } : {}),
    })),
  }));

/** A derived value's name on the sheet: its label, or its id in capitals as before. */
const derivedLabel = (d) => (typeof d.label === 'string' && d.label.trim() ? d.label : d.id.replace(/_/g, ' ').toUpperCase());

module.exports = { checkStats, checkDerivedLabels, checkSamples, statIdsOf, statSections, derivedLabel, rangeHint, LIMITS };
