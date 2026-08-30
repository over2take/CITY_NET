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
// One engine, one profile per system. The naming and the field lists differ; the matching,
// the resolution order and the overlay do not, so a system contributes a profile rather
// than a copy of the file. An earlier note here said three honest implementations would
// beat one shared lie, which was right while there was one system and wrong as soon as
// there were two: the shared part is every line except the two lookup tables, and four
// copies of it is four places to fix the next bug in.
//
// A system with no profile gets no effects at all, which is what Shadowrun does today.

const { CPR_SKILLS, CWN_SKILLS } = require('./rolls');
const { applyDerived } = require('./templates');
const rollEngine = require('./rollEngine');
const cyberware = require('./cyberware');

const SYSTEM = 'cyberpunk_red';
const CWN = 'cities_without_number';

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
 * The CWN attributes, in both the sheet's spelling and the book's.
 *
 * The sheet prints the three-letter form and the book writes them out, and a catalogue
 * entry copied from the table says "Dexterity". Both land on the same field.
 *
 * The `*_mod` fields are deliberately absent. They carry `derived: true`, are recomputed
 * from the attribute on every save, and are therefore not something a modifier may target
 * — see the derive step in `effectiveData`, which is how a raised attribute reaches them.
 */
const CWN_STAT_ALIASES = {
  str: ['STR', 'Strength'],
  dex: ['DEX', 'Dexterity'],
  con: ['CON', 'Constitution'],
  int: ['INT', 'Intelligence'],
  wis: ['WIS', 'Wisdom'],
  cha: ['CHA', 'Charisma'],
};

/**
 * What each system names, and what it recomputes afterwards.
 *
 * `derive` exists because Cities Without Number puts a derived layer between its
 * attributes and its rolls: a skill check is `2d6 + skill + the attribute's modifier`, so
 * an implant that raises DEX and stops there would change no Dex roll at all and read as
 * broken. Cyberpunk RED rolls the attribute itself and needs no such step.
 */
const PROFILES = {
  [SYSTEM]: {
    statAliases: CPR_STAT_ALIASES,
    skills: CPR_SKILLS,
    derive: null,
  },
  [CWN]: {
    statAliases: CWN_STAT_ALIASES,
    skills: CWN_SKILLS,
    derive: (data) => { applyDerived(CWN, data); },
    // Fields that are neither an attribute nor a skill but that chrome can still move.
    // Trauma Target is one: the recompute owns its base (6 plus the armour's mod) and a
    // piece of dermal armour adds on top of that.
    extraFields: { trauma_target: ['Trauma Target', 'TRAUMA TGT'] },
    // ...and which of those the recompute rewrites, so a modifier aimed at one has to be
    // applied after it rather than before, or the recompute simply erases it.
    derivedTargets: ['trauma_target'],
  },
};

const profileFor = (system) => PROFILES[system] || null;

/**
 * A target name reduced to what it is really saying.
 *
 * The two vocabularies disagree on punctuation as well as wording: the Companion writes
 * "Conceal & Reveal Object" where the sheet says "Conceal/Reveal Object", and it drops the
 * "(x2)" that marks a double-cost skill. Both differences are spelling, not meaning, so
 * they are normalised away rather than aliased one at a time.
 *
 * A bracket is not always noise, though. "Language (Streetslang)" and "Language (Other)"
 * are two skills that differ only inside the brackets, so only the cost marker comes off.
 */
const norm = (s) => String(s || '')
  .toLowerCase()
  // Only the cost marker, not every bracket. Stripping all of them collapsed
  // "Language (Streetslang)" and "Language (Other)" onto the same skill, so a modifier on
  // one silently landed on the other — there the bracket is the whole distinction.
  .replace(/\(\s*x\s*\d+\s*\)/gi, ' ')
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

/** Every name that means a stat or a skill on one system, pointing at its field id. */
function buildIndex(profile) {
  const index = new Map();
  for (const [id, names] of Object.entries(profile.statAliases)) {
    for (const name of names) index.set(norm(name), id);
  }
  for (const [id, [label]] of Object.entries(profile.skills)) index.set(norm(label), id);
  for (const [id, names] of Object.entries(profile.extraFields || {})) {
    for (const name of names) index.set(norm(name), id);
  }
  return index;
}

// Built once per system rather than per call: the tables are constant, and `effects` runs
// on every sheet read and every roll.
const INDEXES = new Map(Object.entries(PROFILES).map(([sys, p]) => [sys, buildIndex(p)]));

/** The field a modifier is talking about, or null when the sheet has no such thing. */
const fieldFor = (target, system = SYSTEM) => {
  const index = INDEXES.get(system);
  return (index && index.get(norm(target))) || null;
};

const isStatKind = (kind) => kind === 'stat' || kind === 'statSet' || kind === 'statFloor';
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
 * Only chrome that is both equipped and actually placed counts. Switched off is obvious;
 * unplaced matters because every import arrives that way, and eight pieces silently
 * rewriting a character's stats before anyone said where they went is a surprise, not an
 * import.
 */
function effects(data, system = SYSTEM) {
  const empty = { fields: {}, rolls: {}, unmatched: [] };
  if (!profileFor(system)) return empty;

  // Installed, not merely owned. A piece waiting to be placed is in a list on a sheet,
  // not in anybody's body, and a stat it claims to set is not set yet — the sheet reading
  // "0 INSTALLED" beside a modified stat is the same fact contradicting itself.
  const rows = cyberware.rows(data).filter((r) => r.equipped && cyberware.isPlaced(r));
  const fields = {};
  const rolls = {};
  const unmatched = [];

  for (const row of rows) {
    for (const mod of row.mods) {
      // A note is a number to be read, not applied. It names nothing the sheet has, so
      // reporting it as unmatched would file a deliberate choice as a mistake.
      if (mod.kind === 'note') continue;

      if (mod.kind === 'roll') {
        const key = normRoll(mod.target);
        if (!key) continue;
        const entry = rolls[key] || (rolls[key] = { label: mod.target, add: 0, sources: [] });
        entry.add += mod.value;
        entry.sources.push({ name: row.name, value: mod.value });
        continue;
      }

      const id = fieldFor(mod.target, system);
      if (!id) {
        unmatched.push({ name: row.name, target: mod.target, kind: mod.kind });
        continue;
      }

      const entry = fields[id] || (fields[id] = {
        id, kind: isStatKind(mod.kind) ? 'stat' : 'skill',
        base: numeric(data[id]), set: null, add: 0, sources: [],
      });

      if (mod.kind === 'statFloor') {
        // "Dex 14, or +2 if higher". The comparison is against the stored stat rather than
        // against what other chrome has already done to it, so two floor pieces cannot
        // bootstrap each other into paying out both the floor and the bonus.
        if (entry.base >= mod.value) entry.add += (mod.bonus || 0);
        else entry.set = entry.set === null ? mod.value : Math.max(entry.set, mod.value);
      } else if (isSetKind(mod.kind)) {
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

  // Then let the system recompute whatever hangs off what just moved. On CWN a raised
  // attribute has to reach its modifier or no skill roll built on that attribute changes,
  // and the saves and strain maximum follow from the same numbers. On the copy, never the
  // stored sheet — the overlay is still an overlay.
  const profile = profileFor(system);
  if (profile && profile.derive) {
    profile.derive(out);
    // The recompute owns the base of a derived field - Trauma Target is 6 plus the
    // armour's mod, whatever the sheet last stored - so a modifier aimed at one is
    // applied on top of what the recompute just decided, not on top of the stored value
    // it replaced. Same ordering the attributes already use, one level further down.
    for (const id of profile.derivedTargets || []) {
      const entry = fields[id];
      if (!entry) continue;
      out[id] = (entry.set === null ? numeric(out[id]) : entry.set) + entry.add;
    }
  }
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
  // Diffed against the effective sheet rather than read off the modifier list, so a field
  // the chrome moved *indirectly* counts too. Under CWN the modifier names DEX while the
  // roll reads DEX MOD, and only the derived sheet knows the second one moved.
  const eff = effectiveData(data, system);
  if (eff === data) return [];

  const out = [];
  for (const term of rollEngine.parseFormula(formula)) {
    if (term.kind !== 'field') continue;
    const delta = numeric(eff[term.field]) - numeric(data[term.field]);
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
  SYSTEM, CWN, PROFILES, CPR_STAT_ALIASES, CWN_STAT_ALIASES,
  norm, normRoll, fieldFor, effects, effectiveData, formulaModifiers, rollBonus,
};
