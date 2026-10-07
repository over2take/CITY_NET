// A custom system's NPCs: their own sheet layout and their power tiers, as data.
//
//   npc: {
//     sheet: { tabs, header, sections },   // optional; NPCs use the character sheet without it
//     tiers: [                              // optional; what GENERATE_SHEET offers
//       { id: 'mook', label: 'MOOK', hp: 5, defense: 10, values: { level: 1, attack: 1 } },
//     ],
//   }
//
// The built-in systems' NPCs are code (sheets/npcTiers.js) and stay that way. A stat block is
// usually far shorter than a player's sheet, so a system may give NPCs a layout of their own.
// Both layouts belong to one system and share its derived values, and the server keeps one
// set of rules per system (which fields live on the token or in the bank), so a field on
// both layouts must be linked the same way on each.
//
// A tier is a package, as the built-in ones are: a label, the token's HP and defense, and
// the sheet values a generated NPC starts with. The first tier is the default. HP, defense and
// number values may be formulas or dice, worked out for the level the GM asks for
// (tierRolls.js, 4b4a1): "@level d8 + 4", "12 + floor(@level / 3)".

const { checkSheet, fieldsOf, effectiveSheet, withoutOffParts } = require('./sheet');
const { boxProblem } = require('./tierRolls');

const NAME = /^[a-z][a-z0-9_]{0,63}$/;
const LIMITS = { tiers: 20, label: 30, values: 200, text: 300, hp: 9999, defense: 99 };

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The layout NPCs are drawn with: their own, or the character sheet. Either way without the
 * fields of a part the system turned off (sheet.js withoutOffParts), as the character sheet is.
 */
const npcSheetOf = (definition) => (definition && isPlainObject(definition.npc) && isPlainObject(definition.npc.sheet)
  ? withoutOffParts(definition.npc.sheet, definition) : effectiveSheet(definition));

/** The tiers as defined, or none. Only called on a checked definition. */
const tiersOf = (definition) => (definition && isPlainObject(definition.npc) && Array.isArray(definition.npc.tiers)
  ? definition.npc.tiers.filter(isPlainObject) : []);

const wholeNumber = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;

const checkTiers = (tiers, npcFields, derivedIds, problems) => {
  if (tiers === undefined) return;
  if (!Array.isArray(tiers)) { problems.push({ where: 'npc tiers', message: 'Must be a list of tiers' }); return; }
  if (tiers.length > LIMITS.tiers) problems.push({ where: 'npc tiers', message: `More than ${LIMITS.tiers} tiers` });
  const byId = new Map(npcFields.map((f) => [f.id, f]));
  const ids = new Set();
  tiers.slice(0, LIMITS.tiers).forEach((tier, ti) => {
    const tw = isPlainObject(tier) && typeof tier.id === 'string' ? `npc tier ${tier.id}` : `npc tier ${ti + 1}`;
    if (!isPlainObject(tier)) { problems.push({ where: tw, message: 'Must be a tier' }); return; }
    for (const key of Object.keys(tier)) {
      if (!['id', 'label', 'hp', 'defense', 'values'].includes(key)) problems.push({ where: `${tw}, ${key}`, message: 'Not part of a tier' });
    }
    if (typeof tier.id !== 'string' || !NAME.test(tier.id)) problems.push({ where: tw, message: 'Ids use lowercase letters, digits and _, starting with a letter' });
    else if (ids.has(tier.id)) problems.push({ where: tw, message: 'Defined twice' });
    else ids.add(tier.id);
    if (typeof tier.label !== 'string' || !tier.label.trim()) problems.push({ where: `${tw}, label`, message: 'Required' });
    else if (tier.label.length > LIMITS.label) problems.push({ where: `${tw}, label`, message: `Longer than ${LIMITS.label} characters` });
    // HP and defense: a whole number in the token's range, or a formula or dice worked out for
    // the level when the NPC is made (tierRolls.js, 4b4a1), the result held to that range.
    for (const [key, max] of [['hp', LIMITS.hp], ['defense', LIMITS.defense]]) {
      const v = tier[key];
      if (v === undefined || typeof v === 'string') {
        const why = typeof v === 'string' && v.length > LIMITS.text ? `Longer than ${LIMITS.text} characters` : boxProblem(v);
        if (why) problems.push({ where: `${tw}, ${key}`, message: why });
      } else if (!wholeNumber(v, max)) problems.push({ where: `${tw}, ${key}`, message: `A whole number from 0 to ${max}, a formula or dice` });
    }
    if (tier.values === undefined) return;
    if (!isPlainObject(tier.values)) { problems.push({ where: `${tw}, values`, message: 'Must be a set of field values' }); return; }
    const entries = Object.entries(tier.values);
    if (entries.length > LIMITS.values) problems.push({ where: `${tw}, values`, message: `More than ${LIMITS.values} values` });
    for (const [fieldId, value] of entries.slice(0, LIMITS.values)) {
      const vw = `${tw}, ${fieldId}`;
      const field = byId.get(fieldId);
      if (derivedIds.has(fieldId)) { problems.push({ where: vw, message: 'A derived value is worked out, not set' }); continue; }
      if (!field) { problems.push({ where: vw, message: 'Not a field on the NPC sheet' }); continue; }
      // HP and defense come from the tier's own hp and defense, onto the token.
      if (field.source) { problems.push({ where: vw, message: 'Lives on the token or in the bank; use the tier\'s hp and defense' }); continue; }
      if (field.type === 'number') {
        // A number, or a formula or dice worked out for the level (tierRolls.js).
        if (typeof value === 'string') {
          const why = value.length > LIMITS.text ? `Longer than ${LIMITS.text} characters` : boxProblem(value);
          if (why) problems.push({ where: vw, message: why });
        } else if (typeof value !== 'number' || !Number.isFinite(value)) problems.push({ where: vw, message: 'A number, a formula or dice' });
      } else if (typeof value !== 'string') {
        problems.push({ where: vw, message: 'Must be text' });
      } else if (value.length > LIMITS.text) {
        problems.push({ where: vw, message: `Longer than ${LIMITS.text} characters` });
      } else if (field.type === 'select' && Array.isArray(field.options) && !field.options.some((o) => o && o.value === value)) {
        problems.push({ where: vw, message: 'Not one of the field\'s options' });
      }
    }
  });
};

/** Check the npc section. `definition` supplies the character sheet it is compared with. */
const checkNpc = (definition, derivedIds, problems) => {
  const npc = definition.npc;
  if (npc === undefined) return;
  if (!isPlainObject(npc)) { problems.push({ where: 'npc', message: 'Must be a set of NPC settings' }); return; }
  for (const key of Object.keys(npc)) {
    if (!['sheet', 'tiers'].includes(key)) problems.push({ where: `npc ${key}`, message: 'Not part of the NPC settings' });
  }
  if (npc.sheet !== undefined) {
    // The same checks as the character sheet, reported as the NPC sheet's.
    const own = [];
    checkSheet(npc.sheet, derivedIds, own);
    problems.push(...own.map((p) => ({ ...p, where: `npc ${p.where}` })));
    const character = new Map(fieldsOf(effectiveSheet(definition)).filter(isPlainObject).map((f) => [f.id, f]));
    for (const f of fieldsOf(npc.sheet).filter(isPlainObject)) {
      const other = character.get(f.id);
      if (other && (other.source || null) !== (f.source || null)) {
        problems.push({ where: `npc sheet field ${f.id}`, message: 'Linked differently on the character sheet' });
      }
    }
  }
  checkTiers(npc.tiers, fieldsOf(npcSheetOf(definition)).filter(isPlainObject), derivedIds, problems);
};

module.exports = { checkNpc, npcSheetOf, tiersOf, LIMITS };
