// Modular sheet import.
//
// Two stages, deliberately separated so every game system can reuse stage 1:
//   1. EXTRACT (shared): turn the upload into flat key/value candidates.
//      - Fillable PDF: AcroForm field names/values (pdf-lib)
//      - Flat PDF / plain paste: raw text, handed to the system's text parser
//      - JSON paste: used as-is
//   2. MAP (per system): normalize candidate keys onto the template's field
//      ids via an alias table. Anything unrecognized is reported back so the
//      user can fix it by hand - imports never guess silently.
//
// Linked fields (token HP, bank cash) are never importable: they live in
// other systems. They come back in `skipped` so the user knows why.

const { PDFDocument } = require('pdf-lib');
const { CPR_SKILLS, CWN_SKILLS } = require('./rolls');
const { getLinkedFields } = require('./templates');

// 'SP (Head)' / 'sp_head' / 'SP HEAD' all normalize to 'sphead'
const norm = (key) => String(key).toLowerCase().replace(/[^a-z0-9]/g, '');

// ─── Stage 1: extraction ─────────────────────────────────────────────────────

// Fillable-PDF form fields → { name: value }. Returns null when the PDF has
// no usable form fields (flat/scanned sheet).
const extractPdfFields = async (buffer) => {
  const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  let fields;
  try {
    fields = doc.getForm().getFields();
  } catch {
    return null;
  }
  if (!fields || fields.length === 0) return null;
  const out = {};
  for (const f of fields) {
    const name = f.getName();
    try {
      if (typeof f.getText === 'function') out[name] = f.getText() ?? '';
      else if (typeof f.isChecked === 'function') out[name] = f.isChecked();
      else if (typeof f.getSelected === 'function') out[name] = [].concat(f.getSelected()).join(', ');
    } catch { /* unsupported field type - skip */ }
  }
  return out;
};

// ─── Stage 2: per-system mappers ─────────────────────────────────────────────

// CP:R alias table: normalized candidate key → sheet field id.
// Includes every field id itself, so a JSON export round-trips unchanged.
const buildCprAliases = () => {
  const a = {};
  const alias = (keys, fieldId) => keys.forEach((k) => { a[norm(k)] = fieldId; });

  // Identity
  alias(['handle', 'name', 'charactername'], 'handle');
  alias(['role', 'class'], 'role');
  alias(['roleability', 'role ability'], 'role_ability');
  alias(['rank', 'roleabilityrank'], 'role_ability_rank');
  alias(['description', 'appearance'], 'description');
  alias(['aliases', 'alias'], 'aliases');

  // Linked fields: mapped so they surface under `skipped` (with the reason),
  // instead of looking like unrecognized keys
  alias(['hp', 'hitpoints', 'currenthp'], 'hp');
  alias(['hpmax', 'maxhp', 'hp max'], 'hp_max');
  alias(['cash', 'eb', 'eurobucks', 'money'], 'cash');

  // Stats (current+max pairs map the single value to both)
  ['int', 'ref', 'dex', 'tech', 'cool', 'will', 'move', 'body'].forEach((s) => alias([s], s));
  alias(['intelligence'], 'int');
  alias(['reflexes', 'reflex'], 'ref');
  alias(['dexterity'], 'dex');
  alias(['technique'], 'tech');
  alias(['willpower'], 'will');
  alias(['movement', 'mov'], 'move');
  alias(['luck'], 'luck_max');
  alias(['luckmax', 'luckcurrent'], 'luck_max');
  alias(['emp', 'empathy'], 'emp_max');
  alias(['empmax'], 'emp_max');
  alias(['humanity', 'hum'], 'humanity');
  alias(['humanitymax'], 'humanity_max');
  alias(['seriouslywounded'], 'seriously_wounded');
  alias(['deathsave'], 'death_save');

  // Armor
  alias(['sphead', 'headsp', 'headarmor', 'armorhead'], 'sp_head_max');
  alias(['spheadmax'], 'sp_head_max');
  alias(['spbody', 'bodysp', 'bodyarmor', 'armorbody'], 'sp_body_max');
  alias(['spbodymax'], 'sp_body_max');
  alias(['spshield', 'shield', 'shieldhp'], 'sp_shield_max');
  alias(['spshieldmax'], 'sp_shield_max');
  alias(['armorpenalty', 'penalty'], 'armor_penalty');

  // Skills: every roll-map skill by id and by label
  Object.entries(CPR_SKILLS).forEach(([id, [label]]) => {
    alias([id, label], id);
    // Labels like 'Pilot Air Vehicle (x2)' also match without the multiplier
    const plain = label.replace(/\s*\(x\d+\)\s*/i, '');
    if (plain !== label) alias([plain], id);
  });

  // Notes / gear
  alias(['weapons', 'weaponsnotes'], 'weapons_notes');
  alias(['ammunition', 'ammo'], 'ammunition');
  alias(['gear', 'gearnotes', 'equipment'], 'gear_notes');
  alias(['cyberware', 'cyberwarenotes'], 'cyberware_notes');
  alias(['lifepath', 'lifepathnotes'], 'lifepath_notes');
  alias(['criticalinjuries', 'injuries'], 'critical_injuries');
  alias(['addictions'], 'addictions');

  // Weapon rows round-trip
  for (let i = 1; i <= 4; i++) {
    ['name', 'dmg', 'skill', 'rof'].forEach((part) => alias([`weapon${i}${part}`], `weapon${i}_${part}`));
  }
  return a;
};

// Fields where the import value should also seed the paired current value.
const CPR_MAX_SEEDS = {
  luck_max: 'luck',
  emp_max: 'emp',
  sp_head_max: 'sp_head',
  sp_body_max: 'sp_body',
  sp_shield_max: 'sp_shield',
};

const NUMERIC_CPR_FIELDS = new Set([
  'int', 'ref', 'dex', 'tech', 'cool', 'will', 'move', 'body',
  'luck', 'luck_max', 'emp', 'emp_max', 'humanity', 'humanity_max',
  'seriously_wounded', 'death_save', 'armor_penalty',
  'sp_head', 'sp_head_max', 'sp_body', 'sp_body_max', 'sp_shield', 'sp_shield_max',
  ...Object.keys(CPR_SKILLS),
  'weapon1_rof', 'weapon2_rof', 'weapon3_rof', 'weapon4_rof',
]);

// Plain-text parser for CP:R stat blocks: matches 'REF 7', 'Handgun: 5',
// 'INT=6' style lines. Used when a PDF has no form fields, or for raw paste.
const parseCprText = (text) => {
  const out = {};
  const labelPatterns = [
    ...['INT', 'REF', 'DEX', 'TECH', 'COOL', 'WILL', 'LUCK', 'MOVE', 'BODY', 'EMP', 'HUMANITY'].map(s => [s, s]),
    ...Object.entries(CPR_SKILLS).map(([id, [label]]) => [label.replace(/\s*\(x\d+\)\s*/i, ''), id]),
  ];
  for (const [label, key] of labelPatterns) {
    const esc = label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const re = new RegExp(`(?:^|[^a-zA-Z])${esc}\\s*[:=]?\\s*(\\d{1,2})(?![0-9])`, 'i');
    const m = text.match(re);
    if (m) out[key] = m[1];
  }
  // Names stop at a double space, line end, or the next known label
  const handle = text.match(/handle\s*[:=]?\s*(\S+(?:\s\S+)*?)(?=\s{2,}|\s*[\r\n]|\s+role\b|$)/i);
  if (handle) out.handle = handle[1].trim();
  const role = text.match(/role\s*[:=]?\s*([A-Za-z]+(?:\s[A-Za-z]+)?)(?=\s{2,}|\s*[\r\n]|$)/i);
  if (role) out.role = role[1].trim();
  return out;
};

// Map raw candidates onto CP:R sheet fields.
const mapCprFields = (raw) => {
  const aliases = buildCprAliases();
  const mapped = {};
  const unmapped = {};
  const skipped = {};
  const linked = getLinkedFields('cyberpunk_red');

  Object.entries(raw || {}).forEach(([key, value]) => {
    if (value === '' || value === null || value === undefined) return;
    const fieldId = aliases[norm(key)];
    if (!fieldId) { unmapped[key] = value; return; }
    if (linked[fieldId]) { skipped[key] = value; return; }
    const v = NUMERIC_CPR_FIELDS.has(fieldId) ? Number(value) : String(value);
    if (NUMERIC_CPR_FIELDS.has(fieldId) && !Number.isFinite(v)) { unmapped[key] = value; return; }
    mapped[fieldId] = v;
  });

  // A single imported value seeds both max and current for paired fields
  Object.entries(CPR_MAX_SEEDS).forEach(([maxField, curField]) => {
    if (mapped[maxField] !== undefined && mapped[curField] === undefined) {
      mapped[curField] = mapped[maxField];
    }
  });
  if (mapped.humanity !== undefined && mapped.humanity_max === undefined) {
    mapped.humanity_max = mapped.humanity;
  }
  return { mapped, unmapped, skipped };
};

// ─── CWN importer ────────────────────────────────────────────────────────────

const buildCwnAliases = () => {
  const a = {};
  const alias = (keys, fieldId) => keys.forEach((k) => { a[norm(k)] = fieldId; });

  // Identity
  alias(['name', 'charactername', 'handle'], 'name');
  alias(['background', 'bg'], 'background');
  alias(['class', 'archetype'], 'class');
  alias(['level', 'lvl', 'charlevel'], 'level');
  alias(['description', 'appearance'], 'description');
  alias(['aliases', 'alias'], 'aliases');
  alias(['faction'], 'faction');

  // Linked fields: surface under `skipped` so the user knows why they weren't imported
  alias(['hp', 'hitpoints', 'currenthp'], 'hp');
  alias(['hpmax', 'maxhp', 'hp max'], 'hp_max');
  alias(['cash', 'money', 'credits'], 'cash');

  // Attributes (raw scores and mods — mods are derived but allow round-tripping)
  ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach((s) => alias([s], s));
  alias(['strength'], 'str');
  alias(['dexterity', 'agility'], 'dex');
  alias(['constitution', 'endurance'], 'con');
  alias(['intelligence'], 'int');
  alias(['wisdom'], 'wis');
  alias(['charisma'], 'cha');

  // Combat
  alias(['ac', 'armorclass', 'defense', 'armour'], 'ac');
  alias(['bhb', 'basehitbonus', 'hitbonus', 'attackbonus'], 'base_hit_bonus');
  alias(['systemstrain', 'strain'], 'system_strain');
  alias(['systemstrainmax', 'strainmax'], 'system_strain_max');

  // Saves
  alias(['savephysical', 'physicalsave', 'physical'], 'save_physical');
  alias(['saveevasion', 'evasionsave', 'evasion'], 'save_evasion');
  alias(['savemental', 'mentalsave', 'mental'], 'save_mental');
  alias(['saveluck', 'lucksave'], 'save_luck');

  // Skills: id + label for all 20 + Deluxe
  Object.entries(CWN_SKILLS).forEach(([id, [label]]) => alias([id, label], id));

  // Conditions
  alias(['frail'], 'frail');
  alias(['autoinitiative', 'auto initiative', 'alertfocus'], 'auto_initiative');

  // Deluxe
  alias(['castskill', 'cast', 'casting'], 'cast_skill');
  alias(['mageeffort', 'effort', 'magiceffort'], 'mage_effort');
  alias(['mageeffortmax', 'effortmax'], 'mage_effort_max');
  alias(['spellspreparedmax', 'spellsprepared', 'preparedspells'], 'spells_prepared_max');
  alias(['spells'], 'spells');
  alias(['summonskill', 'summon', 'summoning'], 'summon_skill');
  alias(['summonereffort', 'summoneffort'], 'summoner_effort');
  alias(['summonereffortmax', 'summoneffortmax'], 'summoner_effort_max');
  alias(['spirits'], 'spirits');

  // Notes
  alias(['weaponsnotes', 'weapons', 'weaponnotes'], 'weapons_notes');
  alias(['gear', 'gearnotes', 'equipment'], 'gear_notes');
  alias(['cyberware', 'cyberwarenotes', 'chrome'], 'cyberware_notes');
  alias(['foci', 'focinotes', 'edges', 'abilities'], 'foci_notes');
  alias(['contacts', 'contactsnotes'], 'contacts_notes');
  alias(['injuries', 'injurynotes', 'majorinjuries'], 'injury_notes');

  // Weapon rows round-trip (6 fields each)
  for (let i = 1; i <= 4; i++) {
    ['name', 'dmg', 'skill', 'trauma', 'shock', 'atk'].forEach((part) =>
      alias([`weapon${i}${part}`], `weapon${i}_${part}`)
    );
  }
  return a;
};

const NUMERIC_CWN_FIELDS = new Set([
  'level', 'base_hit_bonus', 'ac',
  'str', 'str_mod', 'dex', 'dex_mod', 'con', 'con_mod',
  'int', 'int_mod', 'wis', 'wis_mod', 'cha', 'cha_mod',
  'save_physical', 'save_evasion', 'save_mental', 'save_luck',
  'system_strain', 'system_strain_max',
  'frail', 'auto_initiative',
  'cast_skill', 'mage_effort', 'mage_effort_max', 'spells_prepared_max',
  'summon_skill', 'summoner_effort', 'summoner_effort_max',
  ...Object.keys(CWN_SKILLS),
  'weapon1_atk', 'weapon2_atk', 'weapon3_atk', 'weapon4_atk',
]);

// Fields where importing the value also seeds the current (same as CP:R pattern)
const CWN_MAX_SEEDS = {
  system_strain_max: 'system_strain',
  mage_effort_max: 'mage_effort',
  summoner_effort_max: 'summoner_effort',
};

const parseCwnText = (text) => {
  const out = {};
  const labelPatterns = [
    ...['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA', 'AC', 'BHB', 'LEVEL'].map(s => [s, s.toLowerCase()]),
    ...Object.entries(CWN_SKILLS).map(([id, [label]]) => [label, id]),
  ];
  for (const [label, key] of labelPatterns) {
    const esc = label.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const re = new RegExp(`(?:^|[^a-zA-Z])${esc}\\s*[:=]?\\s*(\\d{1,2})(?![0-9])`, 'i');
    const m = text.match(re);
    if (m) out[key] = m[1];
  }
  const name = text.match(/name\s*[:=]?\s*(\S+(?:\s\S+)*?)(?=\s{2,}|\s*[\r\n]|\s+background\b|$)/i);
  if (name) out.name = name[1].trim();
  const bg = text.match(/background\s*[:=]?\s*([A-Za-z]+(?:\s[A-Za-z]+)?)(?=\s{2,}|\s*[\r\n]|$)/i);
  if (bg) out.background = bg[1].trim();
  return out;
};

const mapCwnFields = (raw) => {
  const aliases = buildCwnAliases();
  const mapped = {};
  const unmapped = {};
  const skipped = {};
  const linked = getLinkedFields('cities_without_number');

  Object.entries(raw || {}).forEach(([key, value]) => {
    if (value === '' || value === null || value === undefined) return;
    const fieldId = aliases[norm(key)];
    if (!fieldId) { unmapped[key] = value; return; }
    if (linked[fieldId]) { skipped[key] = value; return; }
    const v = NUMERIC_CWN_FIELDS.has(fieldId) ? Number(value) : String(value);
    if (NUMERIC_CWN_FIELDS.has(fieldId) && !Number.isFinite(v)) { unmapped[key] = value; return; }
    mapped[fieldId] = v;
  });

  Object.entries(CWN_MAX_SEEDS).forEach(([maxField, curField]) => {
    if (mapped[maxField] !== undefined && mapped[curField] === undefined) {
      mapped[curField] = mapped[maxField];
    }
  });
  return { mapped, unmapped, skipped };
};

// ─── Registry ────────────────────────────────────────────────────────────────

const IMPORTERS = {
  cyberpunk_red: { mapFields: mapCprFields, parseText: parseCprText },
  cities_without_number: { mapFields: mapCwnFields, parseText: parseCwnText },
  // generic: no importer - import is only offered for systems that define one
};

const getImporter = (system) => IMPORTERS[system] || null;

module.exports = { extractPdfFields, getImporter, IMPORTERS, norm };
