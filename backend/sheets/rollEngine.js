// Sheet roll engine - pure functions, no I/O.
//
// Grammar (deliberately tiny):
//   formula := term (('+'|'-') term)*
//   term    := NdS       dice, e.g. 1d10, 2d6
//            | @field    sheet field reference (missing/non-numeric -> 0)
//            | N         integer literal
//
// Shapes:
//   sum       - plain total (default)
//   explode10 - CP:R check die: first d10 natural 10 -> +1 extra d10 added,
//               natural 1 -> +1 extra d10 subtracted. Never chains.
//   pool      - reserved for hit-counting systems (SR6/CY_BORG); not yet
//               implemented.

const TERM_DICE = /^(\d+)d(\d+)$/i;
const TERM_FIELD = /^@([a-z0-9_]+)$/i;
const TERM_INT = /^\d+$/;

// '1d10 + @ref - 2' -> [{ sign: 1, raw: '1d10' }, { sign: 1, raw: '@ref' }, { sign: -1, raw: '2' }]
const tokenize = (formula) => {
  const parts = String(formula).replace(/\s+/g, '').match(/[+-]?[^+-]+/g) || [];
  return parts.map((p) => {
    const sign = p.startsWith('-') ? -1 : 1;
    return { sign, raw: p.replace(/^[+-]/, '') };
  });
};

const parseFormula = (formula) => {
  return tokenize(formula).map(({ sign, raw }) => {
    let m;
    if ((m = raw.match(TERM_DICE))) {
      const count = parseInt(m[1], 10);
      const sides = parseInt(m[2], 10);
      if (count < 1 || count > 100 || sides < 2 || sides > 1000) {
        throw new Error(`Dice term out of range: ${raw}`);
      }
      return { kind: 'dice', sign, count, sides };
    }
    if ((m = raw.match(TERM_FIELD))) return { kind: 'field', sign, field: m[1] };
    if (TERM_INT.test(raw)) return { kind: 'int', sign, value: parseInt(raw, 10) };
    throw new Error(`Bad formula term: ${raw}`);
  });
};

const numeric = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Substitute @field terms with the sheet's stored values.
// Returns { dice: [{count, sides, sign}], modifiers: [{label, value}] }
const resolveFormula = (formula, data) => {
  const dice = [];
  const modifiers = [];
  parseFormula(formula).forEach((t) => {
    if (t.kind === 'dice') dice.push({ count: t.count, sides: t.sides, sign: t.sign });
    else if (t.kind === 'field') modifiers.push({ label: t.field, value: t.sign * numeric(data[t.field]) });
    else modifiers.push({ label: null, value: t.sign * t.value });
  });
  if (dice.length === 0) throw new Error('Formula has no dice term');
  return { dice, modifiers };
};

const rollDie = (sides, rng) => Math.floor(rng() * sides) + 1;

// Roll a resolved formula. Returns:
// { rolls: { [sides]: [values...] }, diceTotal, modTotal, total,
//   critical: 'success' | 'failure' | null, breakdown: '(6+3) + 12' }
// opts.noFumble: a natural 1 is NOT a critical failure (CP:R: spending any
// LUCK on the check negates the fumble; the 1 still counts at face value).
const executeRoll = (resolved, shape = 'sum', rng = Math.random, opts = {}) => {
  if (shape === 'pool') throw new Error('pool rolls are not implemented yet');

  const rolls = {};
  const parts = [];
  let diceTotal = 0;
  let critical = null;
  let firstD10Done = false;

  resolved.dice.forEach(({ count, sides, sign }) => {
    if (!rolls[sides]) rolls[sides] = [];
    for (let i = 0; i < count; i++) {
      const v = rollDie(sides, rng);
      rolls[sides].push(v);
      diceTotal += sign * v;
      parts.push(sign < 0 ? `-${v}` : `${v}`);

      // CP:R critical: only the first d10 of the formula explodes, once.
      if (shape === 'explode10' && sides === 10 && !firstD10Done) {
        firstD10Done = true;
        if (v === 10 || (v === 1 && !opts.noFumble)) {
          const extra = rollDie(10, rng);
          rolls[sides].push(extra);
          if (v === 10) {
            critical = 'success';
            diceTotal += sign * extra;
            parts[parts.length - 1] = `${v}!+${extra}`;
          } else {
            critical = 'failure';
            diceTotal -= sign * extra;
            parts[parts.length - 1] = `${v}!-${extra}`;
          }
        }
      }
    }
  });

  const modTotal = resolved.modifiers.reduce((a, m) => a + m.value, 0);
  const total = diceTotal + modTotal;
  let breakdown = `(${parts.join('+')})`;
  if (modTotal !== 0) breakdown += ` ${modTotal > 0 ? '+' : '-'} ${Math.abs(modTotal)}`;
  return { rolls, diceTotal, modTotal, total, critical, breakdown };
};

module.exports = { parseFormula, resolveFormula, executeRoll };
