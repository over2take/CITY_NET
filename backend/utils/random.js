const { randomInt } = require('crypto');

// Uniform float in [0, 1) backed by 32 bits of OS entropy.
// Drop-in replacement for Math.random() in dice-roll contexts.
// Bias vs die size is < 1/2^32 — negligible for all TTRPG dice.
const cryptoRng = () => randomInt(0, 0x100000000) / 0x100000000;

module.exports = { cryptoRng };
