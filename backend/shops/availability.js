// Whether a game system has shops: the one rule the server's shop routes and handlers ask.
//
// A system has shops when the shops know its sheet's shape and it has not turned them off.
// The built-in systems are the ones in sheetSlots (where their weapons and vehicles go);
// a published custom system's shape is known too, since it has no weapon or vehicle rows and
// everything it buys or sells is an inventory line, as on the generic sheet. A custom
// system can turn shops off, and a system with the bank off has none either: a shop has
// nothing to trade in (decided with the user, 2026-10-01).

const sheetSlots = require('./sheetSlots');
const customSystems = require('../systemBuilder/runtime');

/** Whether the shops know where things go on this system's sheet. */
const knowsSheet = (system) => {
  const id = String(system || '');
  return Boolean(sheetSlots.SLOTS[id]) || customSystems.render(id) !== null;
};

/** Whether this system has shops at all. */
const shopsOpen = (system) => knowsSheet(system)
  && customSystems.partIn(system, 'shops') && customSystems.partIn(system, 'bank');

module.exports = { knowsSheet, shopsOpen };
