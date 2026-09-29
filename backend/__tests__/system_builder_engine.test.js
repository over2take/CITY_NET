import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

/**
 * The system builder's expression language and derived-value engine, on their own.
 *
 * Two things matter most. A GM's formula runs on the server, so the language must not be able
 * to do anything but arithmetic, however it is written. And a GM's mistakes must come back as
 * readable problems - all of them, with where they are - rather than a crash or a hang.
 */

const require_ = createRequire(import.meta.url);
const { parse, evaluate, ExpressionError, LIMITS } = require_('../systemBuilder/expression');
const { compileSystem, LIMITS: SYSTEM_LIMITS } = require_('../systemBuilder/derived');
const { RULES, ruleValue } = require_('../systemBuilder/rules');

/** Work out one expression with plain field values and no tables. */
const calc = (src, fields = {}) => evaluate(parse(src), {
  field: (n) => (n in fields ? fields[n] : 0),
  rule: () => 0,
  table: () => 0,
});

describe('the expression language', () => {
  it('does arithmetic with the usual precedence', () => {
    expect(calc('1 + 2 * 3')).toBe(7);
    expect(calc('(1 + 2) * 3')).toBe(9);
    expect(calc('10 - 4 - 3')).toBe(3);
    expect(calc('20 / 4 / 5')).toBe(1);
    expect(calc('-2 * -3')).toBe(6);
    expect(calc('7 % 3')).toBe(1);
    expect(calc('.5 + 1.25')).toBe(1.75);
  });

  it('reads sheet fields', () => {
    expect(calc('@str + @level', { str: 14, level: 3 })).toBe(17);
  });

  it('has the built-in functions', () => {
    expect(calc('min(4, 2, 9)')).toBe(2);
    expect(calc('max(4, 2, 9)')).toBe(9);
    expect(calc('floor(2.7) + ceil(2.1) + abs(-3)')).toBe(8);
    expect(calc('round(2.5)')).toBe(3);
    expect(calc('clamp(15, 1, 10)')).toBe(10);
    expect(calc('if(@x > 3, 100, 200)', { x: 5 })).toBe(100);
    expect(calc('if(@x > 3, 100, 200)', { x: 1 })).toBe(200);
  });

  it('compares and combines to 1 or 0', () => {
    expect(calc('3 < 4')).toBe(1);
    expect(calc('3 >= 4')).toBe(0);
    expect(calc('2 == 2 and 3 != 4')).toBe(1);
    expect(calc('0 or 5')).toBe(1);
    expect(calc('not 0')).toBe(1);
    expect(calc('not 1 or 1')).toBe(1);
  });

  it('turns a result that is not a number into 0, rather than breaking a sheet', () => {
    expect(calc('1 / 0')).toBe(0);
    expect(calc('0 / 0')).toBe(0);
    expect(calc('5 % 0')).toBe(0);
    expect(calc('@x * 2', { x: NaN })).toBe(0);
  });

  it('only evaluates the branch of if() it takes', () => {
    let reads = 0;
    const tree = parse('if(1, 5, @expensive)');
    evaluate(tree, { field: () => { reads += 1; return 0; }, rule: () => 0, table: () => 0 });
    expect(reads).toBe(0);
  });

  describe('refuses, with where the problem is', () => {
    const refuses = (src, message) => {
      let error;
      try { parse(src); } catch (err) { error = err; }
      expect(error, src).toBeInstanceOf(ExpressionError);
      expect(error.message, src).toMatch(message);
    };

    it('bad syntax', () => {
      refuses('', /Empty/);
      refuses('1 +', /Ends too soon/);
      refuses('(1 + 2', /Expected "\)"/);
      refuses('1 2', /after a complete expression/);
      refuses('2 # 3', /Unexpected "#"/);
      refuses('1 < 2 < 3', /do not chain/);
    });

    it('a bare word, and says how to write a field', () => {
      refuses('str + 1', /written @str/);
    });

    it('functions that do not exist, and the wrong number of values', () => {
      refuses('sqrt(4)', /No function or table called "sqrt"/);
      refuses('floor(1, 2)', /takes 1 value, not 2/);
      refuses('clamp(1, 2)', /takes 3 values, not 2/);
      refuses('max()', /takes 1 to 32 values, not 0/);
    });

    it('names with capitals or symbols', () => {
      refuses('@Str', /not a valid name/);
    });

    it('the position of the problem', () => {
      let error;
      try { parse('1 + 2 # 3'); } catch (err) { error = err; }
      expect(error.at).toBe(6);
      expect(error.message).toMatch(/character 7/);
    });
  });

  describe('cannot be used to do anything but arithmetic', () => {
    // Everything here is something a script would try. None of it is in the language.
    for (const src of [
      'constructor', '@constructor.name', 'process.exit(1)', 'require("fs")', 'this',
      '@x["y"]', '"text"', "'text'", '@x = 1', 'x => 1', '`${1}`', '@__proto__', 'eval(1)',
      'Function("return 1")()', '1; 2', '[1,2]', '{a: 1}', 'globalThis',
    ]) {
      it(`refuses ${src}`, () => {
        expect(() => parse(src)).toThrow(ExpressionError);
      });
    }
  });

  describe('limits', () => {
    it('refuses an expression longer than the limit', () => {
      expect(() => parse('1+'.repeat(LIMITS.source) + '1')).toThrow(/Longer than/);
    });

    it('refuses more parts than the limit', () => {
      const src = Array.from({ length: LIMITS.nodes }, () => '1').join('+');
      expect(src.length).toBeLessThanOrEqual(LIMITS.source);
      expect(() => parse(src)).toThrow(/More than \d+ parts/);
    });

    it('refuses nesting deeper than the limit', () => {
      const deep = `${'('.repeat(LIMITS.depth + 2)}1${')'.repeat(LIMITS.depth + 2)}`;
      expect(() => parse(deep)).toThrow(/Nested more than/);
      const deepNeg = `${'-'.repeat(LIMITS.depth + 2)}1`;
      expect(() => parse(deepNeg)).toThrow(/Nested more than/);
      const deepNot = `${'not '.repeat(LIMITS.depth + 2)}1`;
      expect(() => parse(deepNot)).toThrow(/Nested more than/);
    });

    it('accepts nesting up to the limit', () => {
      const ok = `${'('.repeat(LIMITS.depth - 1)}1${')'.repeat(LIMITS.depth - 1)}`;
      expect(() => parse(ok)).not.toThrow();
    });
  });
});

describe('a system definition', () => {
  const MODS = { bands: [{ upTo: 3, value: -1 }, { upTo: 10, value: 0 }, { value: 1 }] };

  it('works values out in dependency order, whatever order they are listed in', () => {
    const { ok, system } = compileSystem({
      lookups: { mod: MODS },
      derived: [
        { id: 'total', formula: '@half + @str_mod' },
        { id: 'half', formula: 'floor(@level / 2)' },
        { id: 'str_mod', formula: 'mod(@str)' },
      ],
    });
    expect(ok).toBe(true);
    expect(system.evaluate({ level: 5, str: 12 })).toEqual({ half: 2, str_mod: 1, total: 3 });
    expect(system.order.indexOf('total')).toBeGreaterThan(system.order.indexOf('half'));
  });

  it('reads a lookup table band by band, the last band catching the rest', () => {
    const { system } = compileSystem({ lookups: { mod: MODS }, derived: [{ id: 'm', formula: 'mod(@x)' }] });
    const m = (x) => system.evaluate({ x }).m;
    expect([m(-5), m(3), m(3.5), m(10), m(11), m(1e9)]).toEqual([-1, -1, 0, 0, 1, 1]);
  });

  it('decides a condition', () => {
    const { system } = compileSystem({
      derived: [{ id: 'penalty', kind: 'condition', when: '@load > @str', then: '-2', else: '0' }],
    });
    expect(system.evaluate({ load: 12, str: 10 }).penalty).toBe(-2);
    expect(system.evaluate({ load: 8, str: 10 }).penalty).toBe(0);
  });

  it('uses a code-backed rule', () => {
    const { system } = compileSystem({ derived: [{ id: 'soak', formula: '4 + $cwn_armor_soak' }] });
    expect(system.evaluate({ armor_mods: JSON.stringify(['absorption_pads']) }).soak).toBe(9);
  });

  it('writes values and reports what changed, as the hand-written recompute functions do', () => {
    const { system } = compileSystem({ derived: [{ id: 'a', formula: '@x + 1' }, { id: 'b', formula: '2' }] });
    const data = { x: 1, a: 2, b: '5' };
    expect(system.apply(data)).toEqual(['b']);
    expect(data).toEqual({ x: 1, a: 2, b: 2 });
  });

  it('treats text, blanks and missing fields as 0, the way sheets always have', () => {
    const { system } = compileSystem({ derived: [{ id: 'sum', formula: '@a + @b + @c + @d' }] });
    expect(system.evaluate({ a: '3', b: '', c: 'abc' }).sum).toBe(3);
  });

  describe('reports every problem at once, with where it is', () => {
    const problemsOf = (def) => {
      const out = compileSystem(def);
      expect(out.ok).toBe(false);
      return out.problems;
    };

    it('a loop, with its path', () => {
      const problems = problemsOf({
        derived: [
          { id: 'a', formula: '@b + 1' },
          { id: 'b', formula: '@c + 1' },
          { id: 'c', formula: '@a + 1' },
        ],
      });
      expect(problems).toEqual([{ where: 'derived a', message: 'Depends on itself: a → b → c → a' }]);
    });

    it('a value that reads itself', () => {
      expect(problemsOf({ derived: [{ id: 'hp', formula: '@hp + 1' }] }))
        .toEqual([{ where: 'derived hp', message: 'Depends on itself: hp → hp' }]);
    });

    it('several mistakes together', () => {
      const problems = problemsOf({
        lookups: { max: MODS, bad: { bands: [{ upTo: 5, value: 1 }, { upTo: 2, value: 0 }] } },
        derived: [
          { id: 'ok', formula: '1' },
          { id: 'ok', formula: '2' },
          { id: 'Bad Id', formula: '1' },
          { id: 'broken', formula: '1 +' },
          { id: 'ruled', formula: '$no_such_rule' },
          { id: 'odd', kind: 'script', formula: '1' },
          { id: 'cond', kind: 'condition', when: '@x >', then: '1', else: 'nope(1)' },
        ],
      });
      const text = problems.map((p) => `${p.where}: ${p.message}`);
      expect(text).toEqual([
        'lookup max: "max" is a built-in function; pick another name',
        'lookup bad, band 2: "Up to" must rise from band to band',
        'derived ok: Defined twice',
        'derived Bad Id: Ids use lowercase letters, digits and _, starting with a letter',
        'derived broken, formula: Ends too soon (at character 4)',
        'derived ruled: No rule called $no_such_rule',
        'derived odd: Unknown kind "script"',
        'derived cond, when: Ends too soon (at character 5)',
        'derived cond, else: No function or table called "nope" (at character 1)',
      ]);
    });

    it('a lookup table that is empty or open in the middle', () => {
      const problems = problemsOf({
        lookups: { empty: { bands: [] }, gap: { bands: [{ value: 1 }, { upTo: 5, value: 2 }] } },
        derived: [],
      });
      expect(problems.map((p) => p.message)).toEqual([
        'A table needs at least one band',
        'Only the last band may leave "up to" open',
      ]);
    });

    it('something that is not a definition at all', () => {
      expect(problemsOf(null)).toEqual([{ where: 'derived', message: 'Derived values must be a list' }]);
      expect(problemsOf({ derived: 'x' })[0].message).toMatch(/must be a list/);
    });

    it('more derived values than the limit', () => {
      const derived = Array.from({ length: SYSTEM_LIMITS.derived + 1 }, (_, i) => ({ id: `v${i}`, formula: '1' }));
      expect(problemsOf({ derived }).map((p) => p.message)).toContain(`More than ${SYSTEM_LIMITS.derived} derived values`);
    });
  });

  it('handles a long chain of values quickly', () => {
    const derived = Array.from({ length: SYSTEM_LIMITS.derived }, (_, i) => ({
      id: `v${i}`, formula: i === 0 ? '1' : `@v${i - 1} + 1`,
    })).reverse();
    const started = Date.now();
    const { ok, system } = compileSystem({ derived });
    expect(ok).toBe(true);
    expect(system.evaluate({})[`v${SYSTEM_LIMITS.derived - 1}`]).toBe(SYSTEM_LIMITS.derived);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('code-backed rules', () => {
  it('each has a description the builder can show', () => {
    for (const [name, rule] of Object.entries(RULES)) {
      expect(typeof rule.describe, name).toBe('string');
      expect(typeof rule.value, name).toBe('function');
    }
  });

  it('an unknown name, or one inherited from Object, is 0 rather than a crash', () => {
    expect(ruleValue('no_such_rule', {})).toBe(0);
    expect(ruleValue('constructor', {})).toBe(0);
    expect(ruleValue('__proto__', {})).toBe(0);
  });
});
