const crypto = require('crypto');

// Uniform float in [0, 1) backed by 32 bits of OS entropy.
// Drop-in replacement for Math.random() in dice-roll contexts.
// Bias vs die size is < 1/2^32 — negligible for all TTRPG dice.
// crypto.randomInt is read at each call rather than once, so a test can stand in for the
// operating system's dice (vi.spyOn(crypto, 'randomInt')) and see a roll it chose.
const cryptoRng = () => crypto.randomInt(0, 0x100000000) / 0x100000000;

module.exports = { cryptoRng };
