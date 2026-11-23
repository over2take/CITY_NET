// A drawing made on the builder's 16 by 16 pad (6c2b1 for the dice's symbols; shared since 8b0, the damage types' icons
// next): 16 rows of 16 squares, each row 4 hex digits, the first square the highest bit. Kept in the system, so it
// travels in its file, and drawn in the color of what it sits on. Anything that takes a drawing checks it here.
//
// Pure: the definition's checks read it.

const SIZE = 16;
const ROW = /^[0-9a-f]{4}$/;

/** Whether `rows` is a drawing: 16 rows, each 4 lowercase hex digits. */
const isDrawn = (rows) => Array.isArray(rows) && rows.length === SIZE && rows.every((r) => typeof r === 'string' && ROW.test(r));

/** What a check says of a drawing that isn't one. */
const DRAWN_PROBLEM = 'A drawing of 16 rows, each 4 hex digits';

/** A drawing nothing has been drawn on. */
const BLANK_DRAWN = Object.freeze(Array.from({ length: SIZE }, () => '0000'));

module.exports = { SIZE, isDrawn, DRAWN_PROBLEM, BLANK_DRAWN };
