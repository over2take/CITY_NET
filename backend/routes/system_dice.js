const express = require('express');
const { SYSTEM_DICE, forSystem } = require('../dice/systemDice');

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

  // Dice for one system; an empty array when that system ships none.
  router.get('/:system', (req, res) => {
    res.json(forSystem(req.params.system));
  });

  return router;
};
