// A system's own dice (6c1a; approved mockup docs/mockups/builder-dice.html, 2026-10-21): dice
// whose faces show numbers, signs or symbols, as Genesys's or Fate's do.
//
//   symbols: [
//     { id: 'hit', name: 'Hit', mark: '✶', cancels: 'miss' },     // a HIT and a MISS cancel, one for one
//     { id: 'miss', name: 'Miss', mark: '✕', cancels: 'hit' },
//     { id: 'crit', name: 'Crit', mark: '★', also: 'hit' },       // a CRIT counts as a HIT too
//   ],
//   dice: [
//     { id: 'good', name: 'Good', faces: [{}, {}, { s: ['hit'] }, { s: ['hit', 'edge'] }, ...] },
//     { id: 'bad', name: 'Bad', color: 'danger', faces: [...] },  // drawn in the danger color
//     { id: 'fate', name: 'dF', faces: [{ n: 1 }, { n: 1 }, { n: 0 }, { n: 0 }, { n: -1 }, { n: -1 }] },
//   ],
//
// A face is a number (`n`, with its sign), any symbols (`s`, each as many times as it shows), both,
// or neither (blank). A symbol has a name, a mark of a character or two, what it cancels and what
// it also counts as, and may look like a picture instead of its mark (6c2b1, decision 10): one of
// the condition icons or an upload (`icon`, as a condition's), or a 16 by 16 drawing made on the
// DICE tab's pad (`drawn`, 16 rows of 4 hex digits, kept in the system so it travels in its file).
// The log is words: it writes the mark, or the name's first letter. Decided with the user the same day: a system
// keeps its own dice, carried in its file (citysys.js, beside the system); the table's dice from
// CUSTOM_DIE.EXE stay as they are, for every game. Rolling them is 6c1b.
//
// Pure: the definition's checks read it, and the rolls will.

const { isIcon } = require('./conditions');

const NAME = /^[a-z][a-z0-9_]{0,39}$/;
const LIMITS = { symbols: 12, dice: 20, name: 20, mark: 2, faces: 100, perFace: 6, number: 999 };
/** A drawing: 16 rows of 16 squares, each row 4 hex digits (the first square the highest bit). */
const DRAWN_ROW = /^[0-9a-f]{4}$/;
const isDrawn = (rows) => Array.isArray(rows) && rows.length === 16 && rows.every((r) => typeof r === 'string' && DRAWN_ROW.test(r));
const COLORS = ['theme', 'danger'];

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** How many characters a person sees in `text`: ★ is one, as is an emoji made of several code points. */
const shown = (text) => [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].length;

/** Problems with a definition's `symbols` and `dice`, pushed onto `problems`, in the builder's words. */
const checkDice = (definition, problems) => {
  const bad = (where, message) => problems.push({ where, message });
  const ids = new Map();

  const { symbols, dice } = definition;
  if (symbols !== undefined) {
    if (!Array.isArray(symbols)) bad('symbols', 'Must be a list of symbols');
    else {
      if (symbols.length > LIMITS.symbols) bad('symbols', `At most ${LIMITS.symbols} symbols`);
      symbols.forEach((s, i) => {
        const where = `symbol ${isPlainObject(s) && typeof s.id === 'string' ? s.id : i + 1}`;
        if (!isPlainObject(s)) { bad(where, 'Must be a symbol'); return; }
        for (const key of Object.keys(s)) if (!['id', 'name', 'mark', 'icon', 'drawn', 'cancels', 'also'].includes(key)) bad(`${where}, ${key}`, 'Not part of a symbol');
        if (typeof s.id !== 'string' || !NAME.test(s.id)) bad(where, 'Ids use lowercase letters, digits and _, starting with a letter');
        else if (ids.has(s.id)) bad(where, 'Defined twice');
        else ids.set(s.id, s);
        if (typeof s.name !== 'string' || !s.name.trim() || s.name.length > LIMITS.name) bad(`${where}, name`, `A name of up to ${LIMITS.name} characters`);
        if (s.icon !== undefined && !isIcon(s.icon)) bad(`${where}, icon`, 'One of the drawn icons, or an uploaded one');
        if (s.drawn !== undefined && !isDrawn(s.drawn)) bad(`${where}, drawn`, 'A drawing of 16 rows, each 4 hex digits');
        if (s.icon !== undefined && s.drawn !== undefined) bad(`${where}, drawn`, 'An icon or a drawing, not both');
        if (s.mark !== undefined && (typeof s.mark !== 'string' || !s.mark.trim() || shown(s.mark) > LIMITS.mark)) bad(`${where}, mark`, `A mark of one or ${LIMITS.mark} characters`);
        if (s.mark === undefined && s.icon === undefined && s.drawn === undefined) bad(`${where}, mark`, 'Needs a mark, an icon or a drawing, to show on the dice');
      });
      // What one cancels or counts as is another symbol, read once all are known.
      for (const s of ids.values()) {
        const where = `symbol ${s.id}`;
        for (const key of ['cancels', 'also']) {
          if (s[key] === undefined) continue;
          if (typeof s[key] !== 'string' || !ids.has(s[key])) bad(`${where}, ${key}`, 'Not one of this system\'s symbols');
          else if (s[key] === s.id) bad(`${where}, ${key}`, key === 'cancels' ? 'A symbol can\'t cancel itself' : 'A symbol already counts as itself');
        }
        // Cancelling is a pair: what this cancels may cancel nothing else.
        const other = ids.get(s.cancels);
        if (other && ids.has(other.cancels) && other.cancels !== s.id) bad(`${where}, cancels`, `${other.name} already cancels another symbol`);
        // Counting as another goes one step: what it counts as counts as nothing more.
        const as = ids.get(s.also);
        if (as && as !== s && as.also !== undefined) bad(`${where}, also`, `${as.name} already counts as another symbol`);
      }
    }
  }

  if (dice !== undefined) {
    if (!Array.isArray(dice)) { bad('dice', 'Must be a list of dice'); return; }
    if (dice.length > LIMITS.dice) bad('dice', `At most ${LIMITS.dice} dice`);
    const seen = new Set();
    dice.forEach((d, i) => {
      const where = `die ${isPlainObject(d) && typeof d.id === 'string' ? d.id : i + 1}`;
      if (!isPlainObject(d)) { bad(where, 'Must be a die'); return; }
      for (const key of Object.keys(d)) if (!['id', 'name', 'color', 'faces'].includes(key)) bad(`${where}, ${key}`, 'Not part of a die');
      if (typeof d.id !== 'string' || !NAME.test(d.id)) bad(where, 'Ids use lowercase letters, digits and _, starting with a letter');
      else if (seen.has(d.id)) bad(where, 'Defined twice');
      else seen.add(d.id);
      if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > LIMITS.name) bad(`${where}, name`, `A name of up to ${LIMITS.name} characters`);
      if (d.color !== undefined && !COLORS.includes(d.color)) bad(`${where}, color`, 'The theme\'s, or danger');
      if (!Array.isArray(d.faces) || d.faces.length < 2 || d.faces.length > LIMITS.faces) { bad(`${where}, faces`, `From 2 to ${LIMITS.faces} faces`); return; }
      d.faces.forEach((f, k) => {
        const at = `${where}, face ${k + 1}`;
        if (!isPlainObject(f)) { bad(at, 'Must be a face'); return; }
        for (const key of Object.keys(f)) if (key !== 'n' && key !== 's') bad(`${at}, ${key}`, 'A face has a number and symbols');
        if (f.n !== undefined && (!Number.isInteger(f.n) || Math.abs(f.n) > LIMITS.number)) bad(`${at}, number`, `A whole number from -${LIMITS.number} to ${LIMITS.number}`);
        if (f.s === undefined) return;
        if (!Array.isArray(f.s) || f.s.length > LIMITS.perFace) { bad(`${at}, symbols`, `A list of up to ${LIMITS.perFace} symbols`); return; }
        f.s.forEach((id, j) => { if (!ids.has(id)) bad(`${at}, symbol ${j + 1}`, 'Not one of this system\'s symbols'); });
      });
    });
  }
};

/** The system's symbols, each whole (unknown or broken ones left out); what the rolls read. */
const symbolsOf = (definition) => (Array.isArray(definition && definition.symbols) ? definition.symbols : [])
  .filter((s) => isPlainObject(s) && typeof s.id === 'string' && NAME.test(s.id) && typeof s.name === 'string')
  .slice(0, LIMITS.symbols)
  .map((s) => ({ id: s.id, name: s.name, ...(typeof s.mark === 'string' ? { mark: s.mark } : {}), ...(isIcon(s.icon) ? { icon: s.icon } : {}), ...(isDrawn(s.drawn) && !isIcon(s.icon) ? { drawn: [...s.drawn] } : {}),
    ...(typeof s.cancels === 'string' ? { cancels: s.cancels } : {}), ...(typeof s.also === 'string' ? { also: s.also } : {}) }));

/** The system's dice, each whole: its faces with a number or null and the symbols each shows. */
const diceOf = (definition) => (Array.isArray(definition && definition.dice) ? definition.dice : [])
  .filter((d) => isPlainObject(d) && typeof d.id === 'string' && NAME.test(d.id) && Array.isArray(d.faces) && d.faces.length >= 2)
  .slice(0, LIMITS.dice)
  .map((d) => ({
    id: d.id, name: typeof d.name === 'string' ? d.name : d.id, color: d.color === 'danger' ? 'danger' : 'theme',
    faces: d.faces.slice(0, LIMITS.faces).map((f) => ({
      n: isPlainObject(f) && Number.isInteger(f.n) ? f.n : null,
      s: isPlainObject(f) && Array.isArray(f.s) ? f.s.filter((x) => typeof x === 'string').slice(0, LIMITS.perFace) : [],
    })),
  }));

module.exports = { LIMITS, COLORS, isDrawn, checkDice, symbolsOf, diceOf };
