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

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// CWN/SWN attribute modifier table (not the D&D formula):
// 3 -> -2, 4-7 -> -1, 8-13 -> 0, 14-17 -> +1, 18+ -> +2.
const cwnMod = (stat) => {
  const s = num(stat);
  // Unset stats (empty field reads as 0) are neutral, not "stat 3" - a
  // half-filled sheet must not roll at -2 everywhere.
  if (s <= 0) return 0;
  if (s <= 3) return -2;
  if (s <= 7) return -1;
  if (s <= 13) return 0;
  if (s <= 17) return 1;
  return 2;
};

// Recompute every CWN derived field from its sources. Mutates data; returns
// the ids of fields whose value changed. Rules (CWN QRD v2.2, CC BY-NC 4.0):
//   *_mod       - attribute modifier table above
//   saves       - 16 - (level + best relevant mod); luck save is 16 - level
//   strain max  - equals the CON score
//   effort maxes (Deluxe) - best relevant mod + skill, minimum 1
const cwnRecompute = (data) => {
  const level = num(data.level);
  const mods = {};
  ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach((s) => { mods[s] = cwnMod(data[s]); });
  const out = {
    str_mod: mods.str, dex_mod: mods.dex, con_mod: mods.con,
    int_mod: mods.int, wis_mod: mods.wis, cha_mod: mods.cha,
    save_physical: 16 - (level + Math.max(mods.str, mods.con)),
    save_evasion: 16 - (level + Math.max(mods.dex, mods.int)),
    save_mental: 16 - (level + Math.max(mods.wis, mods.cha)),
    save_luck: 16 - level,
    system_strain_max: num(data.con),
    mage_effort_max: Math.max(1, Math.max(mods.int, mods.wis) + num(data.cast_skill)),
    spells_prepared_max: Math.ceil(level / 2) + num(data.cast_skill),
    summoner_effort_max: Math.max(1, Math.max(mods.con, mods.cha) + num(data.summon_skill)),
  };
  const changed = [];
  Object.entries(out).forEach(([id, value]) => {
    if (num(data[id]) !== value || data[id] === undefined) {
      data[id] = value;
      changed.push(id);
    }
  });
  return changed;
};

// CWN effective AC from the sheet's armor fields (QRD: armor SETS your AC,
// DEX mod adds on top - heavy armor may cap it - and a shield adds a bonus).
// Returns null while armor_ac is unset: the token AC is then managed by hand
// (token menu / the linked ac field), so we never clobber a manual value.
const cwnEffectiveAc = (data) => {
  const base = Number(data.armor_ac);
  if (!Number.isFinite(base) || base <= 0) return null;
  const capRaw = data.armor_dex_cap;
  const cap = (capRaw === undefined || capRaw === null || capRaw === '') ? Infinity : num(capRaw);
  const shield = num(data.shield_bonus);
  return Math.max(1, Math.min(99, base + Math.min(cwnMod(data.dex), cap) + shield));
};

const TEMPLATES = {
  generic: {
    name: 'Generic',
    publicFields: ['name', 'description'],
    combatFields: [],
    linkedFields: { hp: 'token_hp', hp_max: 'token_hp_max', cash: 'bank_balance' },
  },
  cyberpunk_red: {
    name: 'Cyberpunk RED',
    publicFields: ['name', 'role', 'description'],
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
  cities_without_number: {
    name: 'Cities Without Number',
    publicFields: ['name', 'background', 'class', 'description'],
    combatFields: ['ac'],
    // ac is a WRITABLE linked field: the token's melee_ac/ranged_ac is the
    // single source of truth (the attack engine reads the token). Sheet
    // edits route to the token; the sheet never stores ac in its JSON.
    linkedFields: { hp: 'token_hp', hp_max: 'token_hp_max', cash: 'bank_balance', ac: 'token_ac' },
    maxPairs: {
      system_strain_max: 'system_strain',
      mage_effort_max: 'mage_effort',
      summoner_effort_max: 'summoner_effort',
    },
    // Whole-sheet recompute (see applyDerived): CWN derived fields depend on
    // several sources (mods on stats, saves on level + two mods), so instead
    // of per-field divisor rules the whole derived layer is recomputed after
    // any write.
    recompute: cwnRecompute,
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
// Two mechanisms, per system:
//  - derived:   per-field divisor rules (CP:R Humanity -> EMP)
//  - recompute: whole-sheet function for systems whose derived fields have
//    multiple sources (CWN mods, saves, effort maxes)
const applyDerived = (system, data, changedFieldId) => {
  const meta = TEMPLATES[system] || TEMPLATES[DEFAULT_SYSTEM];
  const changed = [];
  const rule = (meta.derived || {})[changedFieldId];
  if (rule) {
    const src = Number(data[changedFieldId]);
    if (Number.isFinite(src)) {
      data[rule.target] = Math.floor(src / rule.divisor);
      changed.push(rule.target);
    }
  }
  if (typeof meta.recompute === 'function') changed.push(...meta.recompute(data));
  return changed;
};

module.exports = { TEMPLATES, DEFAULT_SYSTEM, isValidSystem, filterPublicData, getLinkedFields, getMaxPairs, applyDerived, cwnEffectiveAc };
