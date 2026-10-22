const express = require('express');
const { SYSTEM_DICE, forSystem } = require('../dice/systemDice');
const runtime = require('../systemBuilder/runtime');
const { menuDiceOf } = require('../systemBuilder/tableRolls');

/**
 * Read-only dice that ship with a game system. There are no write routes here
 * by design — built-ins are defined in code (see dice/systemDice.js), so there
 * is nothing for an admin to edit or delete.
 */
module.exports = () => {
  const router = express.Router();

  // Every system's dice, keyed by system. Useful for tooling and debugging.
  router.get('/', (req, res) => {
    res.json(SYSTEM_DICE);
  });

  // Dice for one system; an empty array when that system ships none. A published custom system's
  // own dice (6c4a) come with them, made on the builder's DICE tab, read-only here.
  router.get('/:system', (req, res) => {
    const definition = runtime.definitionOf(req.params.system);
    res.json([...forSystem(req.params.system), ...(definition ? menuDiceOf(definition) : [])]);
  });

  return router;
};
