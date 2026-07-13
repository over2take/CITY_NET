// Server-side template metadata for character sheets.
//
// The full templates (sections, layouts, labels, roll formulas) live in the
// frontend at src/sheets/templates/. The backend only needs to know, per
// system, which fields are safe to expose:
//
//  - publicFields: shown on the quick-sheet card to other players and
//    spectators. Everything not listed here is owner+admin only.
//  - combatFields: values that determine whether an attack hits (SP, AC,
//    evasion bases...). NEVER exposed to non-owners regardless of any other
//    flag - listed separately so a template edit can't accidentally leak them.
//
// The server filter is the only privacy gate; the client never receives
// fields it shouldn't show.

//  - linkedFields: fields whose value lives in another system (token HP,
//    bank balance). The server overlays them at read time and refuses to
//    store them in the sheet's JSON - one source of truth, no drift.
const TEMPLATES = {
  generic: {
    name: 'Generic',
    publicFields: ['name', 'description'],
    combatFields: [],
    linkedFields: { hp: 'token_hp', hp_max: 'token_hp_max', cash: 'bank_balance' },
  },
  cyberpunk_red: {
    name: 'Cyberpunk RED',
    publicFields: ['handle', 'role', 'description'],
    combatFields: ['sp_head', 'sp_head_max', 'sp_body', 'sp_body_max', 'sp_shield', 'sp_shield_max'],
    linkedFields: { hp: 'token_hp', hp_max: 'token_hp_max', cash: 'bank_balance' },
    luckField: 'luck',
    luckMaxField: 'luck_max',
    // maxField → currentField: when a max is written, clamp current ≤ max
    maxPairs: {
      luck_max: 'luck',
      emp_max: 'emp',
      humanity_max: 'humanity',
      sp_head_max: 'sp_head',
      sp_body_max: 'sp_body',
      sp_shield_max: 'sp_shield',
    },
    // sourceField → { target, divisor }: writing the source recomputes the
    // target (CP:R: current EMP = Humanity / 10, rounded down)
    derived: {
      humanity: { target: 'emp', divisor: 10 },
    },
  },
};

const DEFAULT_SYSTEM = 'generic';

const isValidSystem = (system) => Object.prototype.hasOwnProperty.call(TEMPLATES, system);

// Strip a sheet's data down to what non-owners may see.
const filterPublicData = (system, data) => {
  const meta = TEMPLATES[system] || TEMPLATES[DEFAULT_SYSTEM];
  const parsed = typeof data === 'string' ? JSON.parse(data || '{}') : (data || {});
  const out = {};
  meta.publicFields.forEach((f) => {
    if (!meta.combatFields.includes(f) && parsed[f] !== undefined) out[f] = parsed[f];
  });
  return out;
};

const getLinkedFields = (system) =>
  (TEMPLATES[system] || TEMPLATES[DEFAULT_SYSTEM]).linkedFields || {};

// Returns a map of maxFieldId → currentFieldId for the system.
const getMaxPairs = (system) =>
  (TEMPLATES[system] || TEMPLATES[DEFAULT_SYSTEM]).maxPairs || {};

// Recompute derived fields after a write. Mutates data; returns the ids of
// fields it changed (empty when the changed field derives nothing).
const applyDerived = (system, data, changedFieldId) => {
  const derived = (TEMPLATES[system] || TEMPLATES[DEFAULT_SYSTEM]).derived || {};
  const rule = derived[changedFieldId];
  if (!rule) return [];
  const src = Number(data[changedFieldId]);
  if (!Number.isFinite(src)) return [];
  data[rule.target] = Math.floor(src / rule.divisor);
  return [rule.target];
};

module.exports = { TEMPLATES, DEFAULT_SYSTEM, isValidSystem, filterPublicData, getLinkedFields, getMaxPairs, applyDerived };
