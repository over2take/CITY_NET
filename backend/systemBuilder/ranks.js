// A system's ranks (7f1; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): lists of named ranks, lowest first,
// each worth a number or a formula, that a stat may hold in place of a number.
//
//   ranks: [{ id: 'proficiency', label: 'PROFICIENCY', list: [
//     { name: 'UNTRAINED', worth: '0' }, { name: 'TRAINED', worth: '2 + @level' }, { name: 'EXPERT', worth: '4 + @level' } ] }],
//   stats: [{ id: 'skills', label: 'SKILLS', stats: [{ id: 'athletics', label: 'Athletics', rank: 'proficiency', atStart: 1 }] }],
//
// A ranked stat keeps its STEP (0 for the lowest) in a field of its own, `athletics_rank`, which the player picks and a
// level-up INCREASE or a bonus moves; the stat itself, `athletics`, is the step's worth, worked out as a formula is
// (derived.js, kind 'rank'), so every formula, roll and requirement reading @athletics reads its worth. `atStart` is the
// highest step a player may pick making a character. Lists are shared: one PROFICIENCY serves every skill.
//
// Pure: checks and reads.

const { parse } = require('./expression');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const NAME = /^[a-z][a-z0-9_]{0,63}$/;

const LIMITS = { lists: 20, ranks: 20, name: 30, label: 40, worth: 200 };
const LIST_KEYS = new Set(['id', 'label', 'list']);
const RANK_KEYS = new Set(['name', 'worth']);
/** Where a ranked stat keeps its step. */
const STEP_SUFFIX = '_rank';
const stepFieldOf = (statId) => `${statId}${STEP_SUFFIX}`;

/** The system's rank lists, those well formed enough to read, each with its ranks. */
const rankListsOf = (definition) => list(definition && definition.ranks)
  .filter((r) => isPlainObject(r) && typeof r.id === 'string')
  .map((r) => ({ ...r, list: list(r.list).filter((k) => isPlainObject(k) && typeof k.name === 'string') }));

/** Every stat of the system, from groups well formed enough to read. */
const statsOf = (definition) => list(definition && definition.stats)
  .filter((g) => isPlainObject(g) && Array.isArray(g.stats))
  .flatMap((g) => g.stats.filter((s) => isPlainObject(s) && typeof s.id === 'string'));

/** The stats held as ranks, each with its list: [{ stat, ranks }]; a stat naming no list there is is passed over. */
const rankedStatsOf = (definition) => {
  const lists = new Map(rankListsOf(definition).map((r) => [r.id, r]));
  return statsOf(definition).filter((s) => typeof s.rank === 'string' && lists.has(s.rank) && lists.get(s.rank).list.length)
    .map((stat) => ({ stat, ranks: lists.get(stat.rank) }));
};

/** For the formula compiler (derived.js): each ranked stat, the field its step is in, and each rank's worth in order. */
const rankedOf = (definition) => rankedStatsOf(definition).map(({ stat, ranks }) => ({
  id: stat.id, step: stepFieldOf(stat.id), worths: ranks.list.map((k) => (typeof k.worth === 'string' && k.worth.trim() ? k.worth : '0')),
}));

/** Each ranked stat's step field, by the stat: a modifier or INCREASE on the stat moves its step. */
const stepFieldsOf = (definition) => new Map(rankedStatsOf(definition).map(({ stat }) => [stat.id, stepFieldOf(stat.id)]));

/**
 * Problems with a definition's `ranks`, and with the stats naming them, pushed onto `problems`. `isTable` tells a
 * lookup's name from a function's, as formulas are read; `taken` the ids nothing new may have (stats and formulas).
 */
const checkRanks = (definition, problems, { isTable = () => false, taken = new Set() } = {}) => {
  const ranks = definition.ranks;
  const ids = new Set();
  if (ranks !== undefined) {
    if (!Array.isArray(ranks)) problems.push({ where: 'ranks', message: 'Must be a list of rank lists' });
    else {
      if (ranks.length > LIMITS.lists) problems.push({ where: 'ranks', message: `At most ${LIMITS.lists} rank lists` });
      ranks.slice(0, LIMITS.lists).forEach((r, i) => {
        const where = isPlainObject(r) && typeof r.id === 'string' ? `ranks ${r.id}` : `rank list ${i + 1}`;
        if (!isPlainObject(r)) { problems.push({ where, message: 'Must be a rank list' }); return; }
        for (const key of Object.keys(r)) if (!LIST_KEYS.has(key)) problems.push({ where: `${where}, ${key}`, message: 'Not part of a rank list' });
        if (typeof r.id !== 'string' || !NAME.test(r.id)) problems.push({ where, message: 'Ids use lowercase letters, digits and _, starting with a letter' });
        else if (ids.has(r.id)) problems.push({ where, message: 'Another rank list has this id' });
        else ids.add(r.id);
        if (typeof r.label !== 'string' || !r.label.trim()) problems.push({ where: `${where}, label`, message: 'Cannot be blank' });
        else if (r.label.length > LIMITS.label) problems.push({ where: `${where}, label`, message: `Longer than ${LIMITS.label} characters` });
        if (!Array.isArray(r.list) || !r.list.length) { problems.push({ where: `${where}, list`, message: 'At least one rank, lowest first' }); return; }
        if (r.list.length > LIMITS.ranks) problems.push({ where: `${where}, list`, message: `At most ${LIMITS.ranks} ranks` });
        const names = new Set();
        r.list.slice(0, LIMITS.ranks).forEach((k, j) => {
          const at = `${where}, rank ${j + 1}`;
          if (!isPlainObject(k)) { problems.push({ where: at, message: 'Must be a rank: a name and what it is worth' }); return; }
          for (const key of Object.keys(k)) if (!RANK_KEYS.has(key)) problems.push({ where: `${at}, ${key}`, message: 'Not part of a rank' });
          if (typeof k.name !== 'string' || !k.name.trim()) problems.push({ where: `${at}, name`, message: 'Cannot be blank' });
          else if (k.name.length > LIMITS.name) problems.push({ where: `${at}, name`, message: `Longer than ${LIMITS.name} characters` });
          else if (names.has(k.name.trim().toLowerCase())) problems.push({ where: `${at}, name`, message: 'Another rank in this list has this name' });
          else names.add(k.name.trim().toLowerCase());
          if (typeof k.worth !== 'string' || !k.worth.trim()) { problems.push({ where: `${at}, worth`, message: 'What it is worth: a number or a formula' }); return; }
          if (k.worth.length > LIMITS.worth) { problems.push({ where: `${at}, worth`, message: `Longer than ${LIMITS.worth} characters` }); return; }
          try { parse(k.worth, isTable); } catch (e) { problems.push({ where: `${at}, worth`, message: e.message }); }
        });
      });
    }
  }
  // The stats naming a list: one there is, a highest at the start within it, and no range of their own.
  const lists = new Map(rankListsOf(definition).map((r) => [r.id, r]));
  for (const s of statsOf(definition)) {
    const where = `stat ${s.id}`;
    if (s.rank === undefined) {
      if (s.atStart !== undefined) problems.push({ where: `${where}, atStart`, message: 'Only a stat held as a rank has a highest at the start' });
      continue;
    }
    if (typeof s.rank !== 'string' || !lists.has(s.rank)) { problems.push({ where: `${where}, rank`, message: 'One of this system\'s rank lists' }); continue; }
    const count = lists.get(s.rank).list.length;
    if (s.atStart !== undefined && (!Number.isInteger(s.atStart) || s.atStart < 0 || s.atStart >= count)) {
      problems.push({ where: `${where}, atStart`, message: `A rank of its list: 0 to ${Math.max(0, count - 1)}` });
    }
    if (s.min !== undefined || s.max !== undefined) problems.push({ where, message: 'A stat held as a rank has its list for a range, not a lowest or highest' });
    if (taken.has(stepFieldOf(s.id))) problems.push({ where, message: `${stepFieldOf(s.id)}, where its rank is kept, is another stat's or formula's id` });
  }
};

/**
 * A sheet with each ranked stat's field as its rank picker (7f1c1): a select on its step field, the ranks by step (value
 * "0" the lowest) by name, with `worthField`, the stat, whose worth the sheet shows beside it. For the sheet a browser draws
 * and the sheet import; the sheet a GM designs keeps the stat as it is.
 */
const withRankFields = (definition, sheet) => {
  const ranked = new Map(rankedStatsOf(definition).map(({ stat, ranks }) => [stat.id, ranks]));
  if (!ranked.size || !isPlainObject(sheet) || !Array.isArray(sheet.sections)) return sheet;
  const pick = (f, ranks) => {
    const kept = Object.fromEntries(Object.entries(f).filter(([k]) => !['min', 'max', 'unit', 'placeholder', 'maxField'].includes(k)));
    return { ...kept, id: stepFieldOf(f.id), type: 'select', options: ranks.list.map((k, i) => ({ value: String(i), label: k.name })), worthField: f.id };
  };
  return { ...sheet, sections: sheet.sections.map((s) => (!isPlainObject(s) || !Array.isArray(s.fields) ? s
    : { ...s, fields: s.fields.map((f) => (isPlainObject(f) && ranked.has(f.id) ? pick(f, ranked.get(f.id)) : f)) })) };
};

/** A ranked stat's rank name at a step, or null; a step past either end reads as the end. */
const rankNameAt = (ranks, step) => {
  const names = list(ranks && ranks.list).map((k) => k.name);
  if (!names.length) return null;
  const n = Number.isFinite(Number(step)) ? Math.round(Number(step)) : 0;
  return names[Math.min(names.length - 1, Math.max(0, n))];
};

module.exports = { LIMITS, STEP_SUFFIX, stepFieldOf, rankListsOf, rankedStatsOf, rankedOf, stepFieldsOf, checkRanks, rankNameAt, withRankFields };
