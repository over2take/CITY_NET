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
    // CON, plus whatever the table has agreed. Lifestyle is the usual reason (CWN p51:
    // squatting -2 through luxury +2), but it is a plain modifier rather than a lifestyle
    // picker so a GM can account for anything else the same way. Never below zero: a
    // maximum of -1 is not a rule, it is a sheet nobody can use.
    system_strain_max: Math.max(0, num(data.con) + num(data.strain_mod)),
    // Base 6 for any normal creature, plus the armour's Trauma Target Mod as the book
    // prints it (0 for ordinary clothing, +3 for a heavy suit). Cyberware raises it too,
    // but that arrives through the effects overlay rather than being written here - the
    // same split as an attribute and the modifier hanging off it.
    trauma_target: 6 + num(data.armor_trauma_mod),
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

// CWN effective AC from the sheet's armor fields. Armor SETS your AC, the DEX
// mod adds on top, and a shield adds a bonus.
//
// Two numbers, not one. p52: "Most armor provides two different Armor Classes:
// ranged and melee", and they differ widely - a War Harness is 13 ranged and 14
// melee, an Impact Jacket 12 and 14, a Heavy Armored Suit 20 and 18. The book's
// table prints ranged first, so `armor_ac` (the field that has always existed and
// that players filled from that column) is the RANGED value, and the melee field
// is the addition. Blank melee means the two are the same, which keeps every
// sheet written before the split reading exactly as it did.
//
// The DEX mod applies to both, uncapped - p52 works the example through: a medium
// suit at +1 Dex is ranged 19 and melee 15, straight off 18 and 14. `armor_dex_cap`
// has no rule behind it in this game and is left alone here rather than silently
// dropped; it does nothing while blank, which is how every sheet has it.
//
// Returns null while armor_ac is unset: the token AC is then managed by hand
// (token menu / the linked ac field), so we never clobber a manual value.
const cwnEffectiveAc = (data) => {
  const base = Number(data.armor_ac);
  if (!Number.isFinite(base) || base <= 0) return null;
  const capRaw = data.armor_dex_cap;
  const cap = (capRaw === undefined || capRaw === null || capRaw === '') ? Infinity : num(capRaw);
  const dex = Math.min(cwnMod(data.dex), cap);
  // A Riot Shield is +2 ranged and +4 melee, so the shield splits the same way.
  const blank = (v) => v === undefined || v === null || v === '';
  const meleeBase = blank(data.armor_ac_melee) ? base : num(data.armor_ac_melee);
  const shield = num(data.shield_bonus);
  const meleeShield = blank(data.shield_bonus_melee) ? shield : num(data.shield_bonus_melee);
  const clamp = (n) => Math.max(1, Math.min(99, n));
  return { ranged: clamp(base + dex + shield), melee: clamp(meleeBase + dex + meleeShield) };
};

// Recompute SR6 derived fields (monitors, initiative, composure). Mutates
// data; returns the ids of fields whose value changed.
//   Physical monitor = 8 + ceil(BOD/2)   (mirrors token hp_max)
//   Stun monitor     = 8 + ceil(WIL/2)
//   Initiative score = REA + INT (the roll adds 1d6)
//   Composure        = WIL + CHA (rolled as a pool)
const sr6Recompute = (data) => {
  // Sum PP costs from the adept powers JSON array
  let ppSpent = 0;
  try {
    const powers = JSON.parse(data.adept_powers || '[]');
    if (Array.isArray(powers)) {
      ppSpent = powers.reduce((sum, p) => sum + (parseFloat(p.cost) || 0), 0);
      // Round to 2 decimal places to avoid floating-point drift
      ppSpent = Math.round(ppSpent * 100) / 100;
    }
  } catch { /* ignore corrupt JSON */ }

  const out = {
    physical_monitor: 8 + Math.ceil(num(data.body) / 2),
    stun_monitor: 8 + Math.ceil(num(data.willpower) / 2),
    initiative_score: num(data.reaction) + num(data.intuition),
    composure: num(data.willpower) + num(data.charisma),
    power_points_spent: ppSpent,
    power_points_remaining: Math.round((num(data.magic) - ppSpent) * 100) / 100,
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
    combatFields: ['ac', 'ac_ranged'],
    // ac and ac_ranged are WRITABLE linked fields: the token's melee_ac and
    // ranged_ac are the single source of truth (the attack engine reads the
    // token, and picks the column by the weapon's attack type). Sheet edits
    // route to the token; the sheet never stores either in its JSON.
    //
    // CWN is the only system that declares a ranged link, because it is the only
    // one whose two ACs differ. Everywhere else `token_ac` still writes both
    // columns, which is what a system with one AC means by it.
    linkedFields: {
      hp: 'token_hp', hp_max: 'token_hp_max', cash: 'bank_balance',
      ac: 'token_ac', ac_ranged: 'token_ac_ranged',
    },
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
  shadowrun_6e: {
    name: 'Shadowrun 6E',
    publicFields: ['name', 'metatype', 'role', 'description'],
    combatFields: ['armor_rating'],
    // armor_rating is a WRITABLE linked field: the token's melee_ac slot
    // stores the Armor Rating (AR-vs-armor DV comparison reads the token).
    linkedFields: { hp: 'token_hp', hp_max: 'token_hp_max', cash: 'bank_balance', armor_rating: 'token_ac' },
    luckField: 'edge',
    luckMaxField: 'edge_max',
    maxPairs: {
      edge_max: 'edge',
      stun_monitor: 'stun_current',
    },
    recompute: sr6Recompute,
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

// Linked sources that live on the token row rather than in the sheet's JSON, so a
// read has to join the token to resolve them. Named once here because three call
// sites test for exactly this set, and a source added to a template but not to this
// set is a field that silently reads as undefined.
const TOKEN_SOURCES = new Set(['token_hp', 'token_hp_max', 'token_ac', 'token_ac_ranged']);

/**
 * A token's ranged AC, falling back to its melee AC.
 *
 * Every system but CWN writes one number to both columns, and CWN itself does until
 * someone fills in the melee field. A token seeded before the columns diverged can
 * still have ranged_ac null, and reading that as 0 would make it trivially hittable.
 */
const rangedAcOf = (row) => {
  if (!row) return null;
  if (row.ranged_ac !== null && row.ranged_ac !== undefined) return row.ranged_ac;
  return row.melee_ac ?? 10;
};

/**
 * Which token AC columns a sheet patch should write, and to what.
 *
 * A system with one Armor Class means both columns by it, and has always written
 * both - that is what `token_ac` alone continues to do, so Cyberpunk RED and
 * Shadowrun are byte-identical through this. A system that also declares
 * `token_ac_ranged` is saying its two ACs are separate numbers, and then each
 * field writes only its own column. That is decided by the template rather than by
 * naming CWN here, so the next system with split ACs needs no change to this.
 *
 * Returns null when the patch touches no AC field, or when the value it carries is
 * not a usable one.
 */
const acColumns = (linked, fields) => {
  const hasRanged = Object.values(linked).includes('token_ac_ranged');
  const sets = [];
  const values = [];
  const usable = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && n <= 99 ? n : null;
  };
  Object.entries(fields).forEach(([key, raw]) => {
    const source = linked[key];
    if (source !== 'token_ac' && source !== 'token_ac_ranged') return;
    const n = usable(raw);
    if (n === null) return;
    if (source === 'token_ac_ranged') { sets.push('ranged_ac = ?'); values.push(n); return; }
    sets.push('melee_ac = ?'); values.push(n);
    // One AC, so it means both.
    if (!hasRanged) { sets.push('ranged_ac = ?'); values.push(n); }
  });
  return sets.length ? { sets: sets.join(', '), values } : null;
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

module.exports = {
  TEMPLATES, DEFAULT_SYSTEM, isValidSystem, filterPublicData, getLinkedFields, getMaxPairs,
  applyDerived, cwnEffectiveAc, TOKEN_SOURCES, rangedAcOf, acColumns,
};
