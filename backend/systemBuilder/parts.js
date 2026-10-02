// The parts of the app a system can turn off (Layer 2): the bank, shops, vehicles and the rest.
//
// Its own module, with nothing required, so the definition checks (definition.js), the starter
// sheet (sheet.js) and the running game (runtime.js) can all use it without a circle.

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Every part a system can turn off. All on unless a system says. */
const PARTS = [
  'bank', 'shops', 'vehicles', 'cyberware', 'initiative', 'combat', 'token_health',
  'death', 'luck', 'xp', 'npc_tiers', 'sheet_import',
];

/** Is `part` on in this definition? Everything is, unless the system turns it off. */
const partOn = (definition, part) => {
  const setting = definition && isPlainObject(definition.parts) ? definition.parts[part] : undefined;
  return !(isPlainObject(setting) && setting.on === false);
};

module.exports = { PARTS, partOn };
