// Reading a Cyberpunk RED Companion export.
//
// A player finishes a character on the Companion, exports, and gets a six-digit code. This
// turns the document behind that code into the flat candidate object the sheet importer
// already takes — so a code becomes a third source beside the fillable PDF and the paste
// box, sharing their preview and their APPLY rather than being a second way to write a
// sheet.
//
// **No mapping table here on purpose.** The importer's aliases already normalise away case
// and punctuation, so the Companion's `AirVehicleTech` and our label `Air Vehicle Tech`
// reduce to the same key. Emitting the export's own names and letting `mapFields` do the
// matching means one alias table rather than two that drift — and anything unrecognised
// lands in `unmapped`, where the preview shows it rather than dropping it silently.
//
// Fetching is not here either. This module is pure, so the whole of the risk — a wire
// format that nests, two export generations, a document shaped differently than expected —
// is testable without a network.

/** How many structured rows the CP:R sheet has for each kind of thing. */
const WEAPON_ROWS = 4;
const VEHICLE_ROWS = 4;

/**
 * Unwrap Firestore's REST encoding.
 *
 * Every scalar arrives wrapped in a type tag — `{ stringValue: 'V' }`, `{ integerValue: '7' }`
 * — and maps and arrays nest further wrappers inside. Recursive because the nesting has no
 * fixed depth: a character holds arrays of maps of arrays.
 *
 * Numbers arrive as strings, which is Firestore's doing rather than the Companion's, so they
 * are converted here. Anything unrecognised comes back as null instead of throwing: a new
 * value type appearing in one field should cost that field, not the whole import.
 */
function parseFirestore(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(parseFirestore);

  if (typeof value === 'object') {
    if ('nullValue' in value) return null;
    if ('stringValue' in value) return String(value.stringValue);
    if ('booleanValue' in value) return !!value.booleanValue;
    if ('integerValue' in value) return parseInt(value.integerValue, 10);
    if ('doubleValue' in value) return Number(value.doubleValue);
    if ('timestampValue' in value) return String(value.timestampValue);
    if ('arrayValue' in value) return parseFirestore(value.arrayValue.values || []);
    if ('mapValue' in value) return parseFirestore(value.mapValue.fields || {});

    // A bare object: either a document's `fields`, or a map already one level in.
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = parseFirestore(v);
    return out;
  }
  return value;
}

/** The document body, whichever envelope it arrives in. */
const documentFields = (doc) => parseFirestore(doc?.fields ?? doc ?? {});

/**
 * Which generation of export this is.
 *
 * v2 keys stats and skills by name; v1 keys them by numeric id, resolved through a table
 * the Foundry module carries and we do not. So v1's stats and skills cannot be read without
 * inventing that mapping, and inventing it is how you silently import the wrong numbers.
 * Detected rather than assumed so the caller can say which parts did not come across.
 */
const exportVersion = (data) => (data && (data.stats || data.skills) ? 2 : 1);

const isNumber = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * Item names for one category, ignoring anything without a name.
 *
 * A real export keys each collection by a generated uuid — `{ "16abc894-…": { name: … } }` —
 * rather than listing them, which the module this format was reverse-engineered from does
 * not mention. Arrays are accepted too, because an older export or a future change may use
 * one and the difference is not worth failing over.
 */
const namesOf = (data, key) => {
  const collection = data?.[key];
  if (!collection || typeof collection !== 'object') return [];
  const items = Array.isArray(collection) ? collection : Object.values(collection);
  return items
    .map(item => String(item?.name ?? item?.itemName ?? '').trim())
    .filter(Boolean);
};

/**
 * Turn a parsed export into candidates the sheet importer understands.
 *
 * Returns `{ candidates, version, missing }`. `missing` names what this export could not
 * give up, so the preview can say so rather than leaving a player to notice the gaps —
 * which for a v1 export is most of the sheet.
 */
function flattenCompanion(doc) {
  const data = documentFields(doc);
  const version = exportVersion(data);
  const candidates = {};
  const missing = [];

  // Identity. `handle` is the Companion's word for it and one of our aliases already.
  const handle = String(data.handle ?? data.name ?? '').trim();
  if (handle) candidates.handle = handle;

  // The role is not a field: it is the single key of `roleAbilities`, which is also where
  // its rank lives. `classType` carries it too on some exports.
  const roleAbilities = data.roleAbilities || {};
  const roleNames = Object.keys(roleAbilities);
  const role = String(data.role ?? roleNames[0] ?? data.classType ?? '').trim();
  if (role) candidates.role = role;
  const rank = roleAbilities[roleNames[0]]?.rank;
  if (isNumber(rank)) candidates.roleabilityrank = rank;

  // Free-text colour, which our sheet keeps in one description rather than four fields.
  const description = ['personality', 'motivation', 'identifyingFeatures', 'background']
    .map(k => String(data[k] ?? '').trim())
    .filter(Boolean)
    .join(' · ');
  if (description) candidates.description = description;

  // Stats and skills, by their own names. v2 only — see `exportVersion`.
  if (version === 2) {
    for (const [name, value] of Object.entries(data.stats || {})) {
      if (isNumber(value)) candidates[name] = value;
    }
    for (const [name, value] of Object.entries(data.skills || {})) {
      if (isNumber(value)) candidates[name] = value;
    }
  } else {
    missing.push('stats and skills (this export uses the older numbered format)');
  }

  // Derived pools and the numbers that sit beside them. Present in both generations, and
  // unambiguous in each — unlike the id-keyed stats of a v1 export.
  if (isNumber(data.health)) candidates.hp = data.health;
  if (isNumber(data.humanity)) candidates.humanity = data.humanity;
  if (isNumber(data.maxHumanity)) candidates.humanitymax = data.maxHumanity;
  if (isNumber(data.deathSave)) candidates.deathsave = data.deathSave;
  if (isNumber(data.luck)) candidates.luck = data.luck;
  if (isNumber(data.improvementPoints)) candidates.improvementpoints = data.improvementPoints;
  if (isNumber(data.reputation)) candidates.reputation = data.reputation;
  // Money is a linked field on our side — it lives in the bank, not the sheet — so the
  // importer reports it as skipped rather than writing it. Sent anyway so the preview can
  // say where it went.
  if (isNumber(data.eddies)) candidates.cash = data.eddies;

  const injuries = Array.isArray(data.criticalInjuries) ? data.criticalInjuries : [];
  const injuryNames = injuries.map(i => String(i?.name ?? i ?? '').trim()).filter(Boolean);
  if (injuryNames.length) candidates.criticalinjuries = injuryNames.join(', ');

  const lifepath = String(data.lifepath ?? '').trim();
  if (lifepath) candidates.lifepath = lifepath;

  // Named here rather than imported: a specialised skill needs a row that can hold its
  // specialisation, and our skills are fixed fields. Reported so a player knows to write
  // "Language (Streetslang) 4" somewhere themselves rather than wondering where it went.
  if (Object.keys(data.subSkills || {}).length) missing.push('specialised sub-skills');
  if (Object.keys(data.contacts || {}).length) missing.push('contacts');

  // Items. Names only — the export carries no stats for them, so a weapon arrives named
  // with its damage left to type. Said plainly rather than filled with a guess.
  const weapons = namesOf(data, 'weapons');
  weapons.slice(0, WEAPON_ROWS).forEach((name, i) => { candidates[`weapon${i + 1}name`] = name; });
  if (weapons.length) missing.push('weapon damage and skill');
  if (weapons.length > WEAPON_ROWS) {
    missing.push(`${weapons.length - WEAPON_ROWS} more weapons than the sheet has rows for`);
  }

  const vehicles = namesOf(data, 'vehicles');
  vehicles.slice(0, VEHICLE_ROWS).forEach((name, i) => { candidates[`vehicle${i + 1}name`] = name; });
  if (vehicles.length) missing.push('vehicle SDP, SP and seats');

  // The rest of the kit is free text on our sheet, so the names go in as a list.
  const intoNotes = { gear: ['gear', 'clothing', 'programs'], cyberware: ['cyberware'], ammunition: ['ammunition'] };
  for (const [field, keys] of Object.entries(intoNotes)) {
    const names = keys.flatMap(k => namesOf(data, k));
    if (names.length) candidates[field] = names.join(', ');
  }
  const armor = namesOf(data, 'armor');
  if (armor.length) {
    candidates.gear = [candidates.gear, `Armor: ${armor.join(', ')}`].filter(Boolean).join(', ');
    missing.push('armour SP');
  }

  return { candidates, version, missing };
}

module.exports = { parseFirestore, documentFields, exportVersion, flattenCompanion, WEAPON_ROWS, VEHICLE_ROWS };
