// What a character's chrome does to their numbers. Cyberpunk RED only, for now.
//
// Modifiers are stored against a *name* — "Business", "Cool" — because that is what an
// import carries: the Companion writes `{ "Business": 6 }`, not a field id. The sheet and
// the roll engine work in field ids. This is the layer that joins the two, and it is the
// only place that knows a name can be spelled more than one way.
//
// Deliberately an overlay, never a write. The stored COOL stays whatever the player typed,
// and the modified value is computed on the way out. Writing the total back into the field
// would mean the next recompute adds the bonus again, taking the chrome out would not give
// it back, and on a system with a derived layer the two would fight. The one existing
// precedent for writing — humanity recomputing EMP — works only because it has exactly one
// source; a stat can have several pieces of chrome on it *and* a number the player typed.
//
// Only Cyberpunk RED: the systems differ enough that one shared implementation would be a
// worse lie than three honest ones. Everything here returns empty for another system.

const { CPR_SKILLS } = require('./rolls');
const rollEngine = require('./rollEngine');
const cyberware = require('./cyberware');

const SYSTEM = 'cyberpunk_red';

/**
 * The CP:R stats a modifier can name, and what each is called.
 *
 * Two vocabularies, because two things write these. Our own picker stores the sheet's
 * label (`COOL`); an import stores the Companion's (`Cool`, `Intelligence`, `Movement`).
 * Both have to land on the same field, so both are listed.
 *
 * The Companion also offers "Combat #", which is a number it derives and this sheet does
 * not have. A modifier naming it stays unmatched rather than being forced onto a field
 * that means something else.
 */
const CPR_STAT_ALIASES = {
  int: ['INT', 'Intelligence'],
  ref: ['REF', 'Reflexes'],
  dex: ['DEX', 'Dexterity'],
  tech: ['TECH', 'Technique'],
  cool: ['COOL', 'Cool'],
  will: ['WILL', 'Willpower'],
  body: ['BODY', 'Body'],
  emp: ['EMP', 'Empathy'],
  luck: ['LUCK', 'Luck'],
  move: ['MOVE', 'Movement'],
};

/**
 * A target name reduced to what it is really saying.
 *
 * The two vocabularies disagree on punctuation as well as wording: the Companion writes
 * "Conceal & Reveal Object" where the sheet says "Conceal/Reveal Object", and it drops the
 * "(x2)" that marks a double-cost skill. Both differences are spelling, not meaning, so
 * they are normalised away rather than aliased one at a time.
 */
const norm = (s) => String(s || '')
  .toLowerCase()
  .replace(/\([^)]*\)/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/**
 * A roll type reduced the same way, plus the word "Roll" itself.
 *
 * The Companion names these "Initiative Roll", "Attack Roll", "Damage Roll"; the app calls
 * the same things Initiative, Attack and Damage. The trailing noun is decoration, so it
 * comes off — but only at the end, which keeps "Autofire Damage Roll" distinct from
 * "Damage Roll" rather than collapsing the two into each other.
 *
 * Kept separate from the field normaliser: a skill is allowed to have "roll" in its name
 * and should not be quietly renamed by a rule that exists for roll types.
 */
const normRoll = (s) => norm(s).replace(/\s*\broll$/, '').trim();

/** Every name that means a stat or a skill, pointing at its field id. */
function buildIndex() {
  const index = new Map();
  for (const [id, names] of Object.entries(CPR_STAT_ALIASES)) {
    for (const name of names) index.set(norm(name), id);
  }
  for (const [id, [label]] of Object.entries(CPR_SKILLS)) index.set(norm(label), id);
  return index;
}

const INDEX = buildIndex();

/** The field a modifier is talking about, or null when the sheet has no such thing. */
const fieldFor = (target) => INDEX.get(norm(target)) || null;

const isStatKind = (kind) => kind === 'stat' || kind === 'statSet';
const isSetKind = (kind) => kind === 'statSet' || kind === 'skillSet';

const numeric = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * What the chrome is doing, field by field.
 *
 * Returns `{ fields, rolls, unmatched }`:
 *
 *   - `fields[id]` — `{ base, set, add, value, sources }` for anything a modifier touches.
 *   - `rolls[name]` — `{ add, sources }` for roll types, which are not fields at all.
 *   - `unmatched` — modifiers naming something this sheet does not have, so the window can
 *     say so instead of silently doing nothing.
 *
 * A set is applied before the adjustments, so a piece that sets COOL to 3 and another that
 * adds 2 leaves COOL at 5. The other order would let a +2 piece do nothing at all, which
 * reads as a bug every time. Two pieces both setting is a genuine conflict with no right
 * answer, so the highest wins and both are named in `sources`.
 *
 * Only equipped chrome counts. A piece switched off that still changed your stats would
 * make the flag meaningless.
 */
function effects(data, system = SYSTEM) {
  const empty = { fields: {}, rolls: {}, unmatched: [] };
  if (system !== SYSTEM) return empty;

  const rows = cyberware.rows(data).filter((r) => r.equipped);
  const fields = {};
  const rolls = {};
  const unmatched = [];

  for (const row of rows) {
    for (const mod of row.mods) {
      if (mod.kind === 'roll') {
        const key = normRoll(mod.target);
        if (!key) continue;
        const entry = rolls[key] || (rolls[key] = { label: mod.target, add: 0, sources: [] });
        entry.add += mod.value;
        entry.sources.push({ name: row.name, value: mod.value });
        continue;
      }

      const id = fieldFor(mod.target);
      if (!id) {
        unmatched.push({ name: row.name, target: mod.target, kind: mod.kind });
        continue;
      }

      const entry = fields[id] || (fields[id] = {
        id, kind: isStatKind(mod.kind) ? 'stat' : 'skill',
        base: numeric(data[id]), set: null, add: 0, sources: [],
      });

      if (isSetKind(mod.kind)) {
        entry.set = entry.set === null ? mod.value : Math.max(entry.set, mod.value);
      } else {
        entry.add += mod.value;
      }
      entry.sources.push({ name: row.name, kind: mod.kind, value: mod.value });
    }
  }

  for (const entry of Object.values(fields)) {
    entry.value = (entry.set === null ? entry.base : entry.set) + entry.add;
  }
  return { fields, rolls, unmatched };
}

/**
 * The sheet as the dice should see it.
 *
 * A copy with the modified values in place, for handing to `resolveFormula` — which reads
 * `data[fieldId]` and should not have to know why a number is what it is. The original is
 * never touched: this is the whole point of the overlay.
 */
function effectiveData(data, system = SYSTEM) {
  const { fields } = effects(data, system);
  const ids = Object.keys(fields);
  if (!ids.length) return data;

  const out = { ...data };
  for (const id of ids) out[id] = fields[id].value;
  return out;
}

/**
 * Cyberware's contribution to one roll, as terms to add to a resolved formula.
 *
 * Terms rather than modified field values, following what LUCK and the armour penalty
 * already do here: a roll that comes back as `(6+3) + 12` with no hint that 3 of the 12 is
 * chrome invites the question every time. A labelled term shows up in the breakdown.
 *
 * The delta carries a set correctly too — a piece setting COOL to 3 over a base of 5 is
 * simply a term of -2 — so both kinds of modifier work through one mechanism.
 *
 * The formula's own sign is respected, so a term that subtracts a field subtracts its
 * bonus as well.
 */
function formulaModifiers(data, formula, system = SYSTEM) {
  const { fields } = effects(data, system);
  if (!Object.keys(fields).length) return [];

  const out = [];
  for (const term of rollEngine.parseFormula(formula)) {
    if (term.kind !== 'field') continue;
    const field = fields[term.field];
    if (!field) continue;
    const delta = field.value - field.base;
    if (delta) out.push({ label: 'cyberware', value: term.sign * delta });
  }
  return out;
}

/** What a roll type is modified by, for the roll sites that are not field-based. */
function rollBonus(data, rollType, system = SYSTEM) {
  const entry = effects(data, system).rolls[normRoll(rollType)];
  return entry ? entry.add : 0;
}

module.exports = {
  SYSTEM, CPR_STAT_ALIASES, norm, normRoll, fieldFor, effects, effectiveData,
  formulaModifiers, rollBonus,
};
