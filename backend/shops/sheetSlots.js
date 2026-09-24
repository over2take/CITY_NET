// Where each game system's sheet keeps weapons and vehicles, on the server's side.
//
// **Generated from the sheet templates, which only the frontend has, and checked against
// them.** The server needs this to empty a row when something is sold and to find what a
// character owns, but its own templates carry no field ids, so the table is copied across
// and sheetSlots.test.ts in the frontend compares the two entry for entry. If a template
// grows a field, that test fails and names it, rather than a sale quietly leaving it behind.
//
// That is not hypothetical. Before this, selling a CWN vehicle cleared a hand-written list
// of fields that included mount columns the sheet does not have (range, mag, notes) and
// missed the ones it does (type, skill, atk) and the vehicle's fittings - so half the car
// stayed on the sheet. Its test compared the result against the same hand-written list.
//
// A group missing from a system means that system's sheet has no such row. Shadowrun has no
// vehicles; generic has neither weapons nor vehicles, and everything it buys is an
// inventory line.

const SLOTS = {
  cities_without_number: {
    weapon: {
      rows: 6,
      fields: [
        "name", "dmg", "skill", "attr", "trauma", "shock", "atk", "carry", "enc",
        "mods",
      ],
    },
    vehicle: {
      rows: 6,
      fields: [
        "name", "type", "hp", "hp_max", "armor", "ac", "spd", "tt", "crew", "hrdpt",
        "pow", "mass", "cost", "size", "weapon1_name", "weapon1_type", "weapon1_dmg",
        "weapon1_skill", "weapon1_atk", "weapon1_trauma", "weapon2_name",
        "weapon2_type", "weapon2_dmg", "weapon2_skill", "weapon2_atk",
        "weapon2_trauma", "weapon3_name", "weapon3_type", "weapon3_dmg",
        "weapon3_skill", "weapon3_atk", "weapon3_trauma", "fittings", "notes",
      ],
    },
  },
  cyberpunk_red: {
    weapon: {
      rows: 4,
      fields: [
        "name", "dmg", "skill", "rof",
      ],
    },
    vehicle: {
      rows: 4,
      fields: [
        "name", "type", "hp", "hp_max", "armor", "crew", "speed", "cost", "notes",
      ],
    },
  },
  shadowrun_6e: {
    weapon: {
      rows: 4,
      fields: [
        "name", "dv", "ar", "skill", "mode", "atk",
      ],
    },
  },
  generic: {},
};

/**
 * Fields a row carries at runtime that no template declares.
 *
 * Kept apart from the generated table so regenerating it cannot drop them. A vehicle's
 * `moving` flag is set during play and has to go with the vehicle when it is sold.
 */
const RUNTIME_FIELDS = {
  vehicle: ['moving'],
};

/** The weapon and vehicle rows a system has. Unknown systems have none. */
const slotsOf = (system) => SLOTS[String(system || '')] || {};

/** How many rows of a group a system's sheet has; 0 when it has none. */
const rowCount = (system, group) => (slotsOf(system)[group] || {}).rows || 0;

/**
 * Every sheet field row `n` of a group owns, for emptying it.
 *
 * Template fields and runtime ones together, so a sold vehicle takes its guns, its fittings
 * and whether it was moving with it.
 */
const rowFields = (system, group, n) => {
  const spec = slotsOf(system)[group];
  if (!spec) return [];
  const suffixes = [...spec.fields, ...(RUNTIME_FIELDS[group] || [])];
  return [...new Set(suffixes)].map((f) => `${group}${n}_${f}`);
};

module.exports = { SLOTS, RUNTIME_FIELDS, slotsOf, rowCount, rowFields };
