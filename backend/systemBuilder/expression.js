// The expression language a GM's derived values are written in. Pure, no I/O, no `eval`.
//
// A GM's formulas run on the server whenever a sheet changes, so the language is a closed
// set: numbers, sheet fields, a few operators and a fixed list of functions. There is no way
// to name anything outside it - no property access, no strings, no loops - so a formula can
// compute a wrong number but cannot do anything else. Size and nesting are capped, so a
// pasted wall of text is refused at compile time rather than chewed on at run time.
//
// Grammar, loosest binding first:
//   expr    := or
//   or      := and ('or' and)*
//   and     := not ('and' not)*
//   not     := 'not' not | compare
//   compare := sum (('<' | '<=' | '>' | '>=' | '==' | '!=') sum)?
//   sum     := product (('+' | '-') product)*
//   product := unary (('*' | '/' | '%') unary)*
//   unary   := '-' unary | '+' unary | primary
//   primary := NUMBER | '@' NAME | '$' NAME | NAME '(' args? ')' | '(' expr ')'
//
//   @name  a sheet field, or another derived value of the same system
//   $name  a code-backed rule value (see rules.js) - what a formula cannot say, like
//          "the soak of whatever armor mods are fitted"
//   name() a built-in function below, or one of the system's lookup tables
//
// Everything is a number. A comparison is 1 or 0; `and`, `or`, `not` and `if` treat any
// nonzero value as true. Anything that would come out infinite or NaN - dividing by zero,
// say - comes out 0: a GM's slip shows as a blank value, never as a broken sheet.

const LIMITS = {
  /** Characters in one expression. */
  source: 1000,
  /** Operators, values and calls in one expression. */
  nodes: 256,
  /** How deeply parentheses and calls may nest. */
  depth: 32,
};

const NAME = /^[a-z][a-z0-9_]{0,63}$/;

/** Built-in functions, by name: how many arguments each takes, and what it does. */
const BUILTINS = {
  min: { min: 1, max: 32, fn: (...a) => Math.min(...a) },
  max: { min: 1, max: 32, fn: (...a) => Math.max(...a) },
  floor: { min: 1, max: 1, fn: (x) => Math.floor(x) },
  ceil: { min: 1, max: 1, fn: (x) => Math.ceil(x) },
  /** Halves round up, as Math.round does: round(2.5) is 3, round(-2.5) is -2. */
  round: { min: 1, max: 1, fn: (x) => Math.round(x) },
  abs: { min: 1, max: 1, fn: (x) => Math.abs(x) },
  clamp: { min: 3, max: 3, fn: (x, lo, hi) => Math.min(Math.max(x, lo), hi) },
  /** if(condition, then, else). Only the branch taken is evaluated. */
  if: { min: 3, max: 3, lazy: true },
};

const KEYWORDS = new Set(['and', 'or', 'not']);

class ExpressionError extends Error {
  constructor(message, at) {
    super(at === undefined ? message : `${message} (at character ${at + 1})`);
    this.name = 'ExpressionError';
    this.at = at;
  }
}

const tokenize = (src) => {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i += 1; continue; }
    const rest = src.slice(i);
    let m;
    if ((m = rest.match(/^(\d+(\.\d+)?|\.\d+)/))) {
      tokens.push({ t: 'num', v: Number(m[0]), at: i });
      i += m[0].length;
    } else if ((m = rest.match(/^([@$])([a-zA-Z_][a-zA-Z0-9_]*)/))) {
      const name = m[2];
      if (!NAME.test(name)) throw new ExpressionError(`"${m[0]}" is not a valid name: lowercase letters, digits and _ only, starting with a letter`, i);
      tokens.push({ t: m[1] === '@' ? 'field' : 'rule', v: name, at: i });
      i += m[0].length;
    } else if ((m = rest.match(/^[a-zA-Z_][a-zA-Z0-9_]*/))) {
      const word = m[0];
      if (KEYWORDS.has(word)) tokens.push({ t: 'op', v: word, at: i });
      else tokens.push({ t: 'name', v: word, at: i });
      i += word.length;
    } else if ((m = rest.match(/^(<=|>=|==|!=|[-+*/%<>(),])/))) {
      tokens.push({ t: 'op', v: m[0], at: i });
      i += m[0].length;
    } else {
      throw new ExpressionError(`Unexpected "${c}"`, i);
    }
  }
  tokens.push({ t: 'end', at: src.length });
  return tokens;
};

/**
 * Parse an expression into a tree. Throws ExpressionError with the position of the problem.
 * `isFunction(name)` says whether a bare name may be called: the built-ins always can, and a
 * system adds its lookup tables.
 */
const parse = (source, isFunction = () => false) => {
  const src = String(source ?? '');
  if (src.length > LIMITS.source) throw new ExpressionError(`Longer than ${LIMITS.source} characters`);
  if (!src.trim()) throw new ExpressionError('Empty expression');
  const tokens = tokenize(src);
  let pos = 0;
  let nodes = 0;

  const peek = () => tokens[pos];
  const take = () => tokens[pos++];
  const isOp = (v) => peek().t === 'op' && peek().v === v;
  const node = (n) => {
    nodes += 1;
    if (nodes > LIMITS.nodes) throw new ExpressionError(`More than ${LIMITS.nodes} parts in one expression`);
    return n;
  };
  const expect = (v) => {
    const tok = take();
    if (tok.t !== 'op' || tok.v !== v) {
      throw new ExpressionError(`Expected "${v}"${tok.t === 'end' ? ' before the end' : ''}`, tok.at);
    }
    return tok;
  };

  const binaryLevel = (ops, next) => (depth) => {
    let left = next(depth);
    while (peek().t === 'op' && ops.includes(peek().v)) {
      const op = take().v;
      left = node({ k: 'bin', op, left, right: next(depth) });
    }
    return left;
  };

  const primary = (depth) => {
    if (depth > LIMITS.depth) throw new ExpressionError(`Nested more than ${LIMITS.depth} deep`, peek().at);
    const tok = take();
    if (tok.t === 'num') return node({ k: 'num', v: tok.v });
    if (tok.t === 'field') return node({ k: 'field', name: tok.v });
    if (tok.t === 'rule') return node({ k: 'rule', name: tok.v });
    if (tok.t === 'name') {
      const name = tok.v;
      if (!isOp('(')) {
        throw new ExpressionError(`"${name}" on its own means nothing: a sheet field is written @${name}`, tok.at);
      }
      if (!BUILTINS[name] && !isFunction(name)) throw new ExpressionError(`No function or table called "${name}"`, tok.at);
      take();
      const args = [];
      if (!isOp(')')) {
        args.push(expr(depth + 1));
        while (isOp(',')) { take(); args.push(expr(depth + 1)); }
      }
      expect(')');
      const b = BUILTINS[name];
      if (b && (args.length < b.min || args.length > b.max)) {
        const want = b.min === b.max ? `${b.min}` : `${b.min} to ${b.max}`;
        throw new ExpressionError(`${name}() takes ${want} value${b.max === 1 ? '' : 's'}, not ${args.length}`, tok.at);
      }
      if (!b && args.length !== 1) throw new ExpressionError(`The table ${name}() takes 1 value, not ${args.length}`, tok.at);
      return node({ k: 'call', name, args });
    }
    if (tok.t === 'op' && tok.v === '(') {
      const inner = expr(depth + 1);
      expect(')');
      return inner;
    }
    if (tok.t === 'end') throw new ExpressionError('Ends too soon', tok.at);
    throw new ExpressionError(`Unexpected "${tok.v}"`, tok.at);
  };

  const unary = (depth) => {
    if (isOp('-') || isOp('+')) {
      const op = take().v;
      if (depth > LIMITS.depth) throw new ExpressionError(`Nested more than ${LIMITS.depth} deep`, peek().at);
      const arg = unary(depth + 1);
      return op === '-' ? node({ k: 'neg', arg }) : arg;
    }
    return primary(depth);
  };
  const product = binaryLevel(['*', '/', '%'], unary);
  const sum = binaryLevel(['+', '-'], product);
  const compare = (depth) => {
    const left = sum(depth);
    if (peek().t === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(peek().v)) {
      const op = take().v;
      const right = sum(depth);
      if (peek().t === 'op' && ['<', '<=', '>', '>=', '==', '!='].includes(peek().v)) {
        throw new ExpressionError('Comparisons do not chain: write "a < b and b < c"', peek().at);
      }
      return node({ k: 'bin', op, left, right });
    }
    return left;
  };
  const not = (depth) => {
    if (isOp('not')) {
      take();
      if (depth > LIMITS.depth) throw new ExpressionError(`Nested more than ${LIMITS.depth} deep`, peek().at);
      return node({ k: 'not', arg: not(depth + 1) });
    }
    return compare(depth);
  };
  const and = binaryLevel(['and'], not);
  const or = binaryLevel(['or'], and);
  function expr(depth) { return or(depth); }

  const tree = expr(0);
  const tok = peek();
  if (tok.t !== 'end') throw new ExpressionError(`Unexpected "${tok.v}" after a complete expression`, tok.at);
  return tree;
};

/** Every @field, $rule and table a tree refers to. */
const references = (tree) => {
  const out = { fields: new Set(), rules: new Set(), tables: new Set() };
  const walk = (n) => {
    switch (n.k) {
      case 'field': out.fields.add(n.name); break;
      case 'rule': out.rules.add(n.name); break;
      case 'call': if (!BUILTINS[n.name]) out.tables.add(n.name); n.args.forEach(walk); break;
      case 'bin': walk(n.left); walk(n.right); break;
      case 'neg': case 'not': walk(n.arg); break;
      default: break;
    }
  };
  walk(tree);
  return out;
};

/** A finite number, or 0. */
const finite = (x) => (Number.isFinite(x) ? x : 0);

/**
 * Work a tree out. `env` supplies `field(name)`, `rule(name)` and `table(name, x)`, each
 * returning a number.
 */
const evaluate = (tree, env) => {
  const ev = (n) => {
    switch (n.k) {
      case 'num': return n.v;
      case 'field': return finite(env.field(n.name));
      case 'rule': return finite(env.rule(n.name));
      case 'neg': return finite(-ev(n.arg));
      case 'not': return ev(n.arg) === 0 ? 1 : 0;
      case 'call': {
        if (n.name === 'if') return ev(n.args[0]) !== 0 ? ev(n.args[1]) : ev(n.args[2]);
        const b = BUILTINS[n.name];
        if (b) return finite(b.fn(...n.args.map(ev)));
        return finite(env.table(n.name, ev(n.args[0])));
      }
      case 'bin': {
        if (n.op === 'and') return ev(n.left) !== 0 && ev(n.right) !== 0 ? 1 : 0;
        if (n.op === 'or') return ev(n.left) !== 0 || ev(n.right) !== 0 ? 1 : 0;
        const a = ev(n.left);
        const b = ev(n.right);
        switch (n.op) {
          case '+': return finite(a + b);
          case '-': return finite(a - b);
          case '*': return finite(a * b);
          case '/': return finite(a / b);
          case '%': return finite(a % b);
          case '<': return a < b ? 1 : 0;
          case '<=': return a <= b ? 1 : 0;
          case '>': return a > b ? 1 : 0;
          case '>=': return a >= b ? 1 : 0;
          case '==': return a === b ? 1 : 0;
          case '!=': return a !== b ? 1 : 0;
          default: throw new Error(`unknown operator ${n.op}`);
        }
      }
      default: throw new Error(`unknown node ${n.k}`);
    }
  };
  return ev(tree);
};

module.exports = { parse, evaluate, references, ExpressionError, LIMITS, BUILTINS, NAME };
