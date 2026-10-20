import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

/**
 * Roll styles, the engine's core (6a1; approved mockup docs/mockups/builder-rolls.html,
 * 2026-10-19, on the builder design's Dice page): dice of any size, Fate dice and named dice;
 * read as a sum, the highest or lowest kept, or successes counted; formula text added and a target
 * met over or under; bands read like a lookup table; exploding dice and naturals. Every check says
 * what is wrong in the builder's words, and the dice come only from the source handed in.
 */

const require_ = createRequire(import.meta.url);
const { checkRoll, makeRoll, rollDie, LIMITS, FATE } = require_('../systemBuilder/rollStyles');
const { parse, evaluate } = require_('../systemBuilder/expression');
const { cryptoRng } = require_('../utils/random');

/** Formula text worked out for a character with these fields. */
const valueFor = (fields = {}) => (text) => evaluate(parse(text), { field: (n) => fields[n] ?? 0, rule: () => 0, table: () => 0 });
/** A dice source that shows these faces in turn, each for a die of the size asked. */
const showing = (...plan) => {
  // Each entry: [face, sides]. rollDie works floor(r * sides) + 1, a Fate die floor(r * 3) - 1.
  let i = 0;
  return () => {
    const [face, sides] = plan[i++ % plan.length];
    return sides === FATE ? (face + 1 + 0.5) / 3 : (face - 1 + 0.5) / sides;
  };
};
const d = (sides, ...faces) => showing(...faces.map((f) => [f, sides]));
const faces = (r) => r.groups.flatMap((g) => g.faces.map((f) => `${f.value}${f.kept ? '' : 'x'}${f.extra ? '!' : ''}`));

describe('a roll made', () => {
  it('sums the dice, adds formula text, and meets a target at or over it', () => {
    const check = { id: 'check', dice: [{ count: '1', sides: 20 }], add: '@this_mod', against: '13' };
    const hit = makeRoll(check, valueFor({ this_mod: 2 }), d(20, 11));
    expect(hit).toMatchObject({ dice: 11, add: 2, total: 13, target: 13, success: true, band: null, natural: null });
    expect(makeRoll(check, valueFor({ this_mod: 1 }), d(20, 11)).success).toBe(false);
  });

  it('works dice counts out from the character, never past the most dice there may be', () => {
    const pool = { id: 'pool', dice: [{ count: '@this + @tie', sides: 6 }] };
    expect(faces(makeRoll(pool, valueFor({ this: 2, tie: 1 }), d(6, 1, 2, 3)))).toEqual(['1', '2', '3']);
    expect(makeRoll(pool, valueFor({ this: -4 }), d(6, 1)).groups[0].faces).toEqual([]);
    expect(makeRoll(pool, valueFor({ this: 2.9 }), d(6, 4, 4, 4)).groups[0].faces).toHaveLength(2);
    const huge = makeRoll({ id: 'h', dice: [{ count: '80', sides: 6 }, { count: '80', sides: 10 }] }, valueFor(), cryptoRng);
    expect(huge.groups.map((g) => g.faces.length)).toEqual([80, LIMITS.dice - 80]);
  });

  it('keeps the highest or lowest, as many as asked, marking the rest', () => {
    const adv = { id: 'adv', dice: [{ count: '2', sides: 20 }], read: 'highest' };
    expect(makeRoll(adv, valueFor(), d(20, 7, 14))).toMatchObject({ dice: 14 });
    expect(faces(makeRoll(adv, valueFor(), d(20, 7, 14)))).toEqual(['7x', '14']);
    expect(makeRoll({ ...adv, read: 'lowest' }, valueFor(), d(20, 7, 14)).dice).toBe(7);
    const stats = { id: 'stats', dice: [{ count: '4', sides: 6 }], read: 'highest', keep: '3' };
    const r = makeRoll(stats, valueFor(), d(6, 2, 5, 1, 6));
    expect(r.dice).toBe(13);
    expect(faces(r)).toEqual(['2', '5', '1x', '6']);
    // Ties: only as many as asked are kept.
    expect(faces(makeRoll(adv, valueFor(), d(20, 9, 9)))).toEqual(['9', '9x']);
  });

  it('counts successes at a face or over, across named dice too', () => {
    const vampire = { id: 'v', dice: [{ count: '3', sides: 10 }, { count: '2', sides: 10, name: 'Hunger' }], read: 'count', at: 6, against: '2' };
    const r = makeRoll(vampire, valueFor(), d(10, 6, 2, 10, 1, 7));
    expect(r.dice).toBe(3);
    expect(r.success).toBe(true);
    expect(r.groups.map((g) => [g.name ?? '', g.faces.map((f) => f.kept)])).toEqual([['', [true, false, true]], ['Hunger', [false, true]]]);
  });

  it('rolls under a target when asked: at or under it succeeds', () => {
    const coc = { id: 'coc', dice: [{ count: '1', sides: 100 }], against: '@this', under: true };
    expect(makeRoll(coc, valueFor({ this: 45 }), d(100, 45)).success).toBe(true);
    expect(makeRoll(coc, valueFor({ this: 45 }), d(100, 46)).success).toBe(false);
  });

  it('reads the total off bands, top to bottom, the last catching the rest', () => {
    const pbta = { id: 'move', dice: [{ count: '2', sides: 6 }], add: '@this', bands: [{ upTo: 6, label: 'Miss' }, { upTo: 9, label: 'Cost' }, { label: 'Full' }] };
    const band = (a, b, stat) => makeRoll(pbta, valueFor({ this: stat }), d(6, a, b)).band;
    expect([band(1, 2, 0), band(3, 3, 0), band(4, 2, 1), band(4, 5, 0), band(5, 4, 1), band(6, 6, 3)]).toEqual(['Miss', 'Miss', 'Cost', 'Cost', 'Full', 'Full']);
    // Without a band for the top, nothing above the last is named.
    expect(makeRoll({ ...pbta, bands: [{ upTo: 6, label: 'Miss' }] }, valueFor(), d(6, 6, 6)).band).toBeNull();
  });

  it('rolls Fate dice as −1, 0 or +1', () => {
    const fate = { id: 'f', dice: [{ count: '4', sides: FATE }], add: '@this' };
    const r = makeRoll(fate, valueFor({ this: 2 }), showing([1, FATE], [0, FATE], [-1, FATE], [1, FATE]));
    expect(faces(r)).toEqual(['1', '0', '-1', '1']);
    expect(r.total).toBe(3);
  });

  it('explodes on the highest face or the one named, again and again or only once', () => {
    const savage = { id: 's', dice: [{ count: '1', sides: 6 }], explode: {} };
    expect(faces(makeRoll(savage, valueFor(), d(6, 6, 6, 2)))).toEqual(['6', '6!', '2!']);
    expect(makeRoll(savage, valueFor(), d(6, 6, 6, 2)).dice).toBe(14);
    expect(faces(makeRoll({ ...savage, explode: { once: true } }, valueFor(), d(6, 6, 6, 2)))).toEqual(['6', '6!']);
    // 10-again on a pool: the extra die counts too.
    const pool = { id: 'p', dice: [{ count: '2', sides: 10 }], read: 'count', at: 8, explode: { on: 10 } };
    // The extra die is rolled straight after the one that exploded.
    const r = makeRoll(pool, valueFor(), d(10, 10, 9, 3));
    expect(faces(r)).toEqual(['10', '9!', '3x']);
    expect(r.dice).toBe(2);
    // A die that always explodes stops at the most a roll may add.
    const always = makeRoll(savage, valueFor(), d(6, 6));
    expect(always.groups[0].faces).toHaveLength(1 + LIMITS.explosions);
  });

  it('names a natural: what the dice show before anything is added', () => {
    const dnd = { id: 'd', dice: [{ count: '2', sides: 20 }], read: 'highest', add: '5', natural: [{ face: 20, label: 'Critical', critical: 'success' }, { face: 1, label: 'Fumble', critical: 'failure' }] };
    expect(makeRoll(dnd, valueFor(), d(20, 20, 3)).natural).toEqual({ label: 'Critical', critical: 'success' });
    expect(makeRoll({ ...dnd, read: 'lowest' }, valueFor(), d(20, 20, 1)).natural).toEqual({ label: 'Fumble', critical: 'failure' });
    expect(makeRoll(dnd, valueFor(), d(20, 19, 3)).natural).toBeNull();
    const boxcars = { id: 'b', dice: [{ count: '2', sides: 6 }], natural: [{ face: 12, label: 'Boxcars' }] };
    expect(makeRoll(boxcars, valueFor(), d(6, 6, 6)).natural).toEqual({ label: 'Boxcars' });
  });

  it('takes every number from the dice source handed in, and none of its own', () => {
    expect(rollDie(6, () => 0)).toBe(1);
    expect(rollDie(6, () => 0.9999999)).toBe(6);
    expect(rollDie(FATE, () => 0)).toBe(-1);
    expect(rollDie(FATE, () => 0.9999999)).toBe(1);
    let calls = 0;
    makeRoll({ id: 'x', dice: [{ count: '3', sides: 8 }] }, valueFor(), () => { calls += 1; return 0.5; });
    expect(calls).toBe(3);
  });

  it('on the secure source, lands every face of every die, and only those', () => {
    for (const sides of [2, 3, 6, 10, 20, 100, FATE]) {
      const seen = new Set();
      for (let i = 0; i < (sides === 100 ? 4000 : 600); i += 1) seen.add(rollDie(sides, cryptoRng));
      const want = sides === FATE ? [-1, 0, 1] : Array.from({ length: sides }, (_, k) => k + 1);
      expect([...seen].sort((a, b) => a - b), String(sides)).toEqual(want);
    }
  });
});

describe('a roll checked', () => {
  const ok = { id: 'skill', label: 'Skill check', dice: [{ count: '2', sides: 6 }], add: '@this', bands: [{ upTo: 6, label: 'Miss' }, { label: 'Hit' }] };
  const said = (roll, ...rest) => checkRoll(roll, 'roll skill', ...rest).map((p) => `${p.where}: ${p.message}`);

  it('passes a roll that can be rolled, of every read', () => {
    expect(said(ok)).toEqual([]);
    expect(said({ id: 'a', dice: [{ count: '2', sides: 20 }], read: 'highest', keep: '1', natural: [{ face: 20, label: 'Crit', critical: 'success' }] })).toEqual([]);
    expect(said({ id: 'a', dice: [{ count: '@pool', sides: 10, name: 'Hunger' }], read: 'count', at: 6, against: '3', explode: { on: 10, once: true } })).toEqual([]);
    expect(said({ id: 'a', dice: [{ count: '1', sides: 100 }], against: '@skill', under: true })).toEqual([]);
    expect(said({ id: 'a', dice: [{ count: '4', sides: 'F' }] })).toEqual([]);
  });

  it('says what is wrong with the dice', () => {
    expect(said({ id: 'skill', dice: [] })).toEqual(['roll skill, dice: Needs at least one kind of dice']);
    expect(said({ ...ok, dice: [{ count: '2', sides: 1 }] })).toEqual(['roll skill, dice 1, sides: A die of 2 to 100 sides, or F for a Fate die']);
    expect(said({ ...ok, dice: [{ count: '2 +', sides: 6 }] })[0]).toMatch(/^roll skill, dice 1, count: /);
    expect(said({ ...ok, dice: [{ count: 2, sides: 6 }] })).toEqual(['roll skill, dice 1, count: Must be formula text']);
    expect(said({ ...ok, dice: [{ count: '1', sides: 6, colour: 'red' }] })).toEqual(['roll skill, dice 1, colour: Not part of dice']);
    expect(said({ ...ok, dice: Array.from({ length: LIMITS.groups + 1 }, () => ({ count: '1', sides: 6 })) })).toEqual([`roll skill, dice: At most ${LIMITS.groups} kinds of dice`]);
    expect(said({ ...ok, dice: [{ count: '1', sides: 6, name: ' ' }] })).toEqual(['roll skill, dice 1, name: Words of up to 40 characters']);
  });

  it('says what is wrong with reading, adding and comparing', () => {
    expect(said({ ...ok, read: 'average' })).toEqual(['roll skill, read: Sum, highest, lowest or count']);
    expect(said({ ...ok, keep: '1' })).toEqual(['roll skill, keep: Only keeping the highest or lowest dice keeps some']);
    expect(said({ ...ok, read: 'count' })).toEqual(['roll skill, at: Counting needs the face a success starts at']);
    expect(said({ ...ok, at: 6 })).toEqual(['roll skill, at: Only counting successes has a face they start at']);
    expect(said({ ...ok, add: '@this +' })[0]).toMatch(/^roll skill, add: /);
    expect(said({ ...ok, under: true })).toEqual(['roll skill, under: Rolling under needs a target']);
    expect(said({ ...ok, add: 'mod(@this)' })[0]).toMatch(/^roll skill, add: /);
    expect(said({ ...ok, add: 'mod(@this)' }, (n) => n === 'mod')).toEqual([]);
  });

  it('says what is wrong with bands, exploding and naturals', () => {
    expect(said({ ...ok, bands: [{ label: 'All' }, { upTo: 6, label: 'Miss' }] })).toEqual(['roll skill, band 1: Only the last band catches everything above']);
    expect(said({ ...ok, bands: [{ upTo: 9, label: 'A' }, { upTo: 6, label: 'B' }] })).toEqual(['roll skill, band 2, upTo: Bands go up, each over the last']);
    expect(said({ ...ok, bands: [{ upTo: 6, label: '' }] })).toEqual(['roll skill, band 1, label: Words of up to 40 characters']);
    expect(said({ ...ok, bands: [] })).toEqual(['roll skill, bands: A list of bands, at least one']);
    expect(said({ ...ok, explode: { on: 'max' } })).toEqual(['roll skill, explode, on: Must be a face, a whole number']);
    expect(said({ ...ok, natural: [{ face: 20, label: 'Crit', critical: 'great' }] })).toEqual(['roll skill, natural 1, critical: A critical success or failure']);
    expect(said({ ...ok, natural: [{ face: 'x', label: 'Crit' }] })).toEqual(['roll skill, natural 1, face: Must be a whole number']);
  });

  it('refuses what isn\'t a roll, keys it doesn\'t know, and a bad id', () => {
    expect(said(null)).toEqual(['roll skill: Must be a roll']);
    expect(said({ ...ok, script: 'x' })).toEqual(['roll skill, script: Not part of a roll']);
    expect(said({ ...ok, id: 'Skill Check' })).toEqual(['roll skill: Ids use lowercase letters, digits and _, starting with a letter']);
    expect(said({ ...ok, __proto__: { polluted: true } })).toEqual([]);
  });
});

describe('special results (6a1b)', () => {
  it('a match: dice showing one face, each full set adding to the dice, named, maybe a critical', () => {
    const vampire = { id: 'v', dice: [{ count: '5', sides: 10 }], read: 'count', at: 6, matches: [{ face: 10, count: 2, adds: 2, label: 'Critical', critical: 'success' }] };
    // 10, 10, 10, 7, 2: four successes from the dice, one full pair adds two more.
    const r = makeRoll(vampire, valueFor(), d(10, 10, 10, 10, 7, 2));
    expect(r.dice).toBe(6);
    expect(r.matches).toEqual([{ label: 'Critical', sets: 1, critical: 'success' }]);
    expect(r.critical).toBe('success');
    expect(makeRoll(vampire, valueFor(), d(10, 10, 9, 8, 7, 2)).matches).toEqual([]);
    // Any face, with none named: doubles.
    const doubles = { id: 'dbl', dice: [{ count: '2', sides: 12 }], matches: [{ count: 2, label: 'Doubles' }] };
    expect(makeRoll(doubles, valueFor(), d(12, 5, 5)).matches).toEqual([{ label: 'Doubles', sets: 1 }]);
    expect(makeRoll(doubles, valueFor(), d(12, 5, 6)).matches).toEqual([]);
    expect(makeRoll(doubles, valueFor(), d(12, 5, 6)).critical).toBeNull();
  });

  it('a natural is read before a match adds anything', () => {
    const roll = { id: 'n', dice: [{ count: '2', sides: 6 }], read: 'count', at: 6, matches: [{ face: 6, count: 2, adds: 3, label: 'Big' }], natural: [{ face: 2, label: 'Two sixes' }] };
    const r = makeRoll(roll, valueFor(), d(6, 6, 6));
    expect(r.dice).toBe(5);
    expect(r.natural).toEqual({ label: 'Two sixes' });
  });

  it('cancelling: each die showing the face takes a success away, down to none', () => {
    const old = { id: 'o', dice: [{ count: '4', sides: 10 }], read: 'count', at: 7, cancel: { face: 1 } };
    expect(makeRoll(old, valueFor(), d(10, 8, 9, 1, 4)).dice).toBe(1);
    expect(makeRoll(old, valueFor(), d(10, 8, 1, 1, 1)).dice).toBe(0);
  });

  it('a glitch: the face on its share of the dice or more; with nothing succeeding, the worse one', () => {
    const sr6 = { id: 's', dice: [{ count: '@pool', sides: 6 }], read: 'count', at: 5, glitch: { face: 1, share: 0.5, label: 'Glitch', none: 'Critical glitch' } };
    // Four dice: two 1s is half, a glitch; with a 5 it still succeeded once.
    const one = makeRoll(sr6, valueFor({ pool: 4 }), d(6, 1, 1, 5, 3));
    expect([one.dice, one.glitch, one.critical]).toEqual([1, 'Glitch', null]);
    const none = makeRoll(sr6, valueFor({ pool: 4 }), d(6, 1, 1, 2, 3));
    expect([none.dice, none.glitch, none.critical]).toEqual([0, 'Critical glitch', 'failure']);
    // Five dice: three 1s are needed, the half rounded up.
    expect(makeRoll(sr6, valueFor({ pool: 5 }), d(6, 1, 1, 5, 5, 3)).glitch).toBeNull();
    expect(makeRoll(sr6, valueFor({ pool: 5 }), d(6, 1, 1, 1, 5, 3)).glitch).toBe('Glitch');
    expect(makeRoll(sr6, valueFor({ pool: 0 }), d(6, 1)).glitch).toBeNull();
  });

  it("a named die's own effect: its face on a critical, a success, a failure or any roll", () => {
    const vampire = {
      id: 'v', dice: [{ count: '2', sides: 10 }, { count: '2', sides: 10, name: 'Hunger' }], read: 'count', at: 6, against: '3',
      matches: [{ face: 10, count: 2, adds: 2, label: 'Critical', critical: 'success' }],
      effects: [{ name: 'Hunger', face: 10, when: 'critical', label: 'Messy critical' }, { name: 'Hunger', face: 1, when: 'failure', label: 'Bestial failure' }, { name: 'Hunger', face: 9, when: 'any', label: 'Nine' }],
    };
    // A regular 10 and a Hunger 10 make a pair: a critical with a Hunger 10, messy.
    expect(makeRoll(vampire, valueFor(), d(10, 10, 3, 10, 2)).effects).toEqual(['Messy critical']);
    // A lone Hunger 10 is no critical, so not messy.
    expect(makeRoll(vampire, valueFor(), d(10, 3, 4, 10, 2)).effects).toEqual([]);
    // A pair of regular 10s: a critical, but no Hunger 10, so clean.
    expect(makeRoll(vampire, valueFor(), d(10, 10, 10, 4, 2)).effects).toEqual([]);
    // One success against three, with a Hunger 1: bestial.
    const fail = makeRoll(vampire, valueFor(), d(10, 7, 3, 1, 2));
    expect([fail.success, fail.effects]).toEqual([false, ['Bestial failure']]);
    // A regular 1 isn't a Hunger die.
    expect(makeRoll(vampire, valueFor(), d(10, 1, 3, 4, 2)).effects).toEqual([]);
    expect(makeRoll(vampire, valueFor(), d(10, 1, 3, 9, 2)).effects).toEqual(['Nine']);
  });

  it('the zero-dice rule: no dice to roll, so roll its own and keep the one asked, never a critical', () => {
    const blades = {
      id: 'b', dice: [{ count: '@this', sides: 6 }], read: 'highest', zero: { count: 2, read: 'lowest' },
      matches: [{ face: 6, count: 2, label: 'Critical', critical: 'success' }],
      bands: [{ upTo: 3, label: 'Bad' }, { upTo: 5, label: 'Partial' }, { label: 'Success' }],
    };
    const zero = makeRoll(blades, valueFor({ this: 0 }), d(6, 5, 2));
    expect([zero.zero, zero.dice, zero.band, faces(zero)]).toEqual([true, 2, 'Bad', ['5x', '2']]);
    expect(makeRoll(blades, valueFor({ this: 0 }), d(6, 6, 6)).critical).toBeNull();
    const two = makeRoll(blades, valueFor({ this: 2 }), d(6, 6, 6));
    expect(two.zero).toBeUndefined();
    expect([two.critical, two.band]).toEqual(['success', 'Success']);
  });

  it("says what is wrong with each, in the builder's words", () => {
    const base = { id: 'v', dice: [{ count: '4', sides: 10, name: 'Hunger' }], read: 'count', at: 6 };
    const said = (extra) => checkRoll({ ...base, ...extra }, 'roll v').map((p) => `${p.where}: ${p.message}`);
    expect(said({ matches: [{ face: 10, count: 2, adds: 2, label: 'Crit', critical: 'success' }], cancel: { face: 1 }, glitch: { face: 1, share: 0.5, label: 'Glitch', none: 'Crit glitch' }, effects: [{ name: 'Hunger', face: 1, when: 'failure', label: 'Bestial' }], zero: { count: 2, read: 'lowest' } })).toEqual([]);
    expect(said({ matches: [{ face: 10, count: 1, label: 'X' }] })).toEqual(['roll v, match 1, count: How many dice match: 2 or more']);
    expect(said({ matches: [{ face: 'ten', count: 2, label: 'X' }] })).toEqual(['roll v, match 1, face: Must be a whole number, or left out for any face']);
    expect(said({ matches: [{ count: 2, label: 'X', extra: 1 }] })).toEqual(['roll v, match 1, extra: Not part of a match']);
    expect(said({ matches: 'pairs' })).toEqual(['roll v, matches: A list of matches']);
    expect(said({ read: 'sum', at: undefined, cancel: { face: 1 } })).toEqual(['roll v, cancel: Only counted successes can be cancelled']);
    expect(said({ glitch: { face: 1, share: 2, label: 'G' } })).toEqual(['roll v, glitch, share: A share of the dice, over 0 and up to 1']);
    expect(said({ glitch: { face: 1, share: 0.5 } })).toEqual(['roll v, glitch, label: Words of up to 40 characters']);
    expect(said({ effects: [{ name: 'Rage', face: 1, when: 'failure', label: 'X' }] })).toEqual(["roll v, effect 1, name: Must be one of this roll's named dice"]);
    expect(said({ effects: [{ name: 'Hunger', face: 1, when: 'sometimes', label: 'X' }] })).toEqual(['roll v, effect 1, when: On a critical, a success, a failure or any roll']);
    expect(said({ zero: { count: 0, read: 'lowest' } })).toEqual(['roll v, zero, count: How many dice: 1 to 10']);
    expect(said({ zero: { count: 2, read: 'sum' } })).toEqual(['roll v, zero, read: Keep the highest or the lowest']);
  });
});

describe('changes picked before rolling (6a1c)', () => {
  const d20 = { id: 'check', dice: [{ count: '1', sides: 20 }], add: '2',
    changes: [{ id: 'advantage', label: 'Advantage', extra: { dice: 1, keep: 'highest' } }, { id: 'disadvantage', label: 'Disadvantage', extra: { dice: 1, keep: 'lowest' } }] };

  it('advantage turns one d20 into two, keeping the higher; disadvantage the lower; both cancel', () => {
    const adv = makeRoll(d20, valueFor(), d(20, 4, 17), ['advantage']);
    expect([faces(adv), adv.dice, adv.total, adv.changes]).toEqual([['4x', '17'], 17, 19, ['Advantage']]);
    const dis = makeRoll(d20, valueFor(), d(20, 4, 17), ['disadvantage']);
    expect([faces(dis), dis.dice]).toEqual([['4', '17x'], 4]);
    const both = makeRoll(d20, valueFor(), d(20, 9), ['advantage', 'disadvantage']);
    expect([faces(both), both.dice, both.changes]).toEqual([['9'], 9, ['Advantage', 'Disadvantage']]);
    expect(faces(makeRoll(d20, valueFor(), d(20, 9), []))).toEqual(['9']);
    // A change the roll doesn't have is left out.
    expect(makeRoll(d20, valueFor(), d(20, 9), ['luck']).changes).toEqual([]);
  });

  it('keeps as many dice as there were: 2d6 pushed to 3d6 keeps the best two', () => {
    const pbta = { id: 'm', dice: [{ count: '2', sides: 6 }], changes: [{ id: 'push', label: 'Push', extra: { dice: 1, keep: 'highest' }, cost: { from: 'stress', amount: 2 } }] };
    const r = makeRoll(pbta, valueFor(), d(6, 2, 5, 4), ['push']);
    expect([faces(r), r.dice, r.costs]).toEqual([['2x', '5', '4'], 9, [{ from: 'stress', amount: 2 }]]);
  });

  it('extra dice with nothing kept differently just join the pool; a bonus adds to the total', () => {
    const blades = { id: 'b', dice: [{ count: '1', sides: 6 }], read: 'highest', changes: [{ id: 'push', label: 'Push', extra: { dice: 1 } }, { id: 'bonus', label: 'Bonus', add: '@this' }] };
    const r = makeRoll(blades, valueFor({ this: 3 }), d(6, 2, 5), ['push', 'bonus']);
    expect([faces(r), r.dice, r.add, r.total, r.costs]).toEqual([['2x', '5'], 5, 3, 8, []]);
  });

  it('says what is wrong with a change', () => {
    const base = { id: 'c', dice: [{ count: '1', sides: 20 }] };
    const said = (changes) => checkRoll({ ...base, changes }, 'roll c').map((p) => `${p.where}: ${p.message}`);
    expect(said([{ id: 'a', label: 'A', extra: { dice: 1, keep: 'highest' }, cost: { from: 'luck', amount: 1 } }, { id: 'b', label: 'B', add: '2' }])).toEqual([]);
    expect(said([{ id: 'a', label: 'A' }])).toEqual(['roll c, change 1: Adds dice, or adds to the total']);
    expect(said([{ id: 'a', label: 'A', add: '1' }, { id: 'a', label: 'B', add: '1' }])).toEqual(['roll c, change 2: Defined twice']);
    expect(said([{ id: 'a', label: 'A', extra: { dice: 11 } }])).toEqual(['roll c, change 1, extra, dice: 1 to 10 dice']);
    expect(said([{ id: 'a', label: 'A', extra: { dice: 1, keep: 'middle' } }])).toEqual(['roll c, change 1, extra, keep: Keep the highest or the lowest']);
    expect(said([{ id: 'a', label: 'A', add: '1', cost: { from: 'Luck Points', amount: 1 } }])).toEqual(['roll c, change 1, cost, from: The id of the stat it is taken from']);
    expect(said([{ id: 'a', label: 'A', add: '1', cost: { from: 'luck', amount: 0 } }])).toEqual(['roll c, change 1, cost, amount: 1 to 100']);
    // A cost takes, or with adds adds (6b3a).
    expect(said([{ id: 'a', label: 'A', add: '1', cost: { from: 'stress', amount: 2, adds: true } }])).toEqual([]);
    expect(said([{ id: 'a', label: 'A', add: '1', cost: { from: 'stress', amount: 2, adds: 'yes' } }])).toEqual(['roll c, change 1, cost, adds: Must be yes or no']);
    expect(said([{ id: 'a', label: 'A', add: '1 +' }])[0]).toMatch(/^roll c, change 1, add: /);
  });
});

describe('exploding that takes away, and only the first die (6a1c)', () => {
  const cpr = { id: 'cpr', dice: [{ count: '1', sides: 10 }], explode: { on: 10, low: 1, once: true, first: true },
    natural: [{ face: 10, label: 'Crit', critical: 'success' }, { face: 1, label: 'Fumble', critical: 'failure' }] };

  it('a natural 10 adds a d10 once; a natural 1 takes one away; the natural is the first die', () => {
    const up = makeRoll(cpr, valueFor(), d(10, 10, 10));
    expect([faces(up), up.dice, up.natural.label]).toEqual([['10', '10!'], 20, 'Crit']);
    const down = makeRoll(cpr, valueFor(), d(10, 1, 7));
    expect([down.dice, down.natural.label, down.groups[0].faces[1].minus]).toEqual([-6, 'Fumble', true]);
  });

  it('only the roll\'s first die explodes, with first', () => {
    const two = { ...cpr, dice: [{ count: '2', sides: 10 }] };
    expect(faces(makeRoll(two, valueFor(), d(10, 4, 10)))).toEqual(['4', '10']);
    expect(faces(makeRoll({ ...two, explode: { on: 10 } }, valueFor(), d(10, 4, 10, 3)))).toEqual(['4', '10', '3!']);
  });

  it('only a sum can take a die away', () => {
    expect(checkRoll({ id: 'x', dice: [{ count: '2', sides: 6 }], read: 'count', at: 5, explode: { low: 1 } }, 'roll x').map((p) => p.message)).toEqual(['Only a sum can take a die away']);
  });
});

describe('the presets (6a1c)', () => {
  const { PRESETS } = require_('../systemBuilder/rollStyles');
  const rollEngine = require_('../sheets/rollEngine');

  it('every preset is a roll the builder can check without a problem', () => {
    expect(Object.keys(PRESETS)).toEqual(['dnd', 'pbta', 'blades', 'vampire', 'fate', 'cwn_skill', 'cwn_save', 'cpr', 'sr6']);
    for (const [key, p] of Object.entries(PRESETS)) expect(checkRoll({ id: key, ...p.roll }, key, () => false), key).toEqual([]);
  });

  /** The same dice for both: a seeded list of numbers, handed out in turn. */
  const seeded = (seed) => { let x = seed; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; };

  it('CP:R checks come out as the app\'s own CP:R code rolls them, on the same dice', () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const data = { ref: 6, athletics: 4 };
      const old = rollEngine.executeRoll(rollEngine.resolveFormula('1d10 + @ref + @athletics', data), 'explode10', seeded(seed));
      const now = makeRoll({ id: 'cpr', ...PRESETS.cpr.roll }, valueFor({ this: 4, tie: 6 }), seeded(seed));
      expect([now.total, now.critical], `seed ${seed}`).toEqual([old.total, old.critical]);
    }
  });

  it('SR6 pools come out as the app\'s own SR6 code rolls them: hits, glitches, critical glitches', () => {
    let glitches = 0;
    for (let seed = 1; seed <= 400; seed += 1) {
      const data = { agility: (seed % 5), firearms: (seed % 3) };
      const old = rollEngine.executeRoll(rollEngine.resolveFormula('pool:@agility+@firearms', data, { allowNoDice: true }), 'pool', seeded(seed));
      const now = makeRoll({ id: 'sr6', ...PRESETS.sr6.roll }, valueFor({ this: data.firearms, tie: data.agility }), seeded(seed));
      expect([now.dice, now.glitch !== null, now.critical], `seed ${seed}`).toEqual([old.hits, old.glitch, old.critical]);
      if (old.glitch) glitches += 1;
    }
    expect(glitches).toBeGreaterThan(10);
  });

  it('CWN skill checks and saves come out as the app\'s own CWN code rolls them', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const skill = rollEngine.executeRoll(rollEngine.resolveFormula('2d6 + @shoot + @dex_mod', { shoot: 2, dex_mod: 1 }), 'sum', seeded(seed));
      expect(makeRoll({ id: 's', ...PRESETS.cwn_skill.roll }, valueFor({ this: 2, tie_mod: 1 }), seeded(seed)).total, `seed ${seed}`).toBe(skill.total);
      const save = rollEngine.executeRoll(rollEngine.resolveFormula('1d20', {}), 'sum', seeded(seed));
      const now = makeRoll({ id: 'v', ...PRESETS.cwn_save.roll }, valueFor({ this: 14 }), seeded(seed));
      expect([now.total, now.success], `seed ${seed}`).toEqual([save.total, save.total >= 14]);
    }
  });

  it('the others roll as their games do', () => {
    const dnd = makeRoll({ id: 'd', ...PRESETS.dnd.roll }, valueFor({ this_mod: 3 }), d(20, 20, 5), ['advantage']);
    expect([dnd.dice, dnd.total, dnd.critical]).toEqual([20, 23, 'success']);
    expect(makeRoll({ id: 'p', ...PRESETS.pbta.roll }, valueFor({ this: 1 }), d(6, 4, 4)).band).toBe('Success at a cost');
    const blades = makeRoll({ id: 'b', ...PRESETS.blades.roll }, valueFor({ this: 2 }), d(6, 6, 2, 6), ['push']);
    // Blades' push adds 2 Stress (the user's pick, 2026-10-20: a cost takes or adds).
    expect([blades.band, blades.critical, blades.costs]).toEqual(['Full success', 'success', [{ from: 'stress', amount: 2, adds: true }]]);
    const vamp = makeRoll({ id: 'v', ...PRESETS.vampire.roll }, valueFor({ this: 3, tie: 2, hunger: 2 }), d(10, 10, 4, 7, 10, 1));
    expect([vamp.groups.map((g) => g.faces.length), vamp.dice, vamp.effects]).toEqual([[3, 2], 5, ['Messy critical']]);
    const fate = makeRoll({ id: 'f', ...PRESETS.fate.roll }, valueFor({ this: 2 }), showing([1, FATE], [1, FATE], [0, FATE], [-1, FATE]), ['invoke']);
    expect([fate.total, fate.band]).toEqual([5, 'Superb']);
  });
});
