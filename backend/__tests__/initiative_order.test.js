import { describe, it, expect } from 'vitest';
const { placeOf, keepDrag, atBottom, lowered, STEP } = require('../sockets/initiativeOrder');

// Where a combatant stands in the order, so a drag stands when later rolls are sorted in (the user, 2026-11-20). The
// tracker's own tests of it are initiative.test.js "drags stand".

const c = (name, score, more = {}) => ({ id: name, name, score, ...more });
const places = (list) => list.map(placeOf);
const names = (list) => list.map((x) => x.name);
/** Strictly highest first: what a sort by place keeps as it is, whatever breaks ties. */
const strict = (list) => places(list).every((p, i, all) => i === 0 || all[i - 1] > p);
/** A drag as the tracker does it: out of `from`, into `to`, then placed. */
const move = (list, from, to) => {
  const next = list.slice();
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return keepDrag(next, to);
};

describe('placeOf', () => {
  it('a place where a drag gave one, else the roll; a place of 0 is still a place', () => {
    expect(placeOf(c('A', 12))).toBe(12);
    expect(placeOf(c('A', 12, { place: 3.5 }))).toBe(3.5);
    expect(placeOf(c('A', 12, { place: 0 }))).toBe(0);
  });
});

describe('keepDrag', () => {
  it('dragged under its roll: a step over the one now below it, the roll kept as shown, the others untouched', () => {
    const out = move([c('A', 20), c('B', 15), c('D', 5)], 2, 1);
    expect(names(out)).toEqual(['A', 'D', 'B']);
    expect(out[1]).toMatchObject({ score: 5 });
    expect(out[1].place).toBeCloseTo(15 + STEP, 6);
    expect(out[0]).not.toHaveProperty('place');
    expect(out[2]).not.toHaveProperty('place');
  });

  it('dragged over its roll: a step under the one now above it', () => {
    const out = move([c('A', 20), c('B', 15), c('D', 5)], 0, 1);
    expect(names(out)).toEqual(['B', 'A', 'D']);
    expect(out[1].place).toBeCloseTo(15 - STEP, 6);
  });

  it('to the top, or the bottom: a step past the one it passed', () => {
    expect(move([c('A', 20), c('B', 15), c('C', 3)], 2, 0)[0].place).toBeCloseTo(20 + STEP, 6);
    expect(move([c('Z', 30), c('A', 20), c('B', 15)], 0, 2)[2].place).toBeCloseTo(15 - STEP, 6);
  });

  it('dropped where its roll already falls: no place at all, its roll stands', () => {
    const out = move([c('A', 20), c('B', 15), c('C', 10), c('D', 5)], 3, 2);
    expect(names(out)).toEqual(['A', 'B', 'D', 'C']);
    // D's 5 doesn't fall between B's 15 and C's 10, so it has one. C dragged back over it: C's 10 falls short of D's place,
    // but once D is under C again D's own 5 stands, which frees C's 10 too. No one is left with one.
    const back = move(out, 3, 2);
    expect(names(back)).toEqual(['A', 'B', 'C', 'D']);
    expect(back.some((x) => 'place' in x)).toBe(false);
  });

  it('dragged away and back where it was: as it was, with no place left behind (the user, 2026-11-20)', () => {
    const start = [c('A', 20), c('B', 15), c('C', 10), c('D', 5)];
    let list = move(start, 3, 0);
    list = move(list, 0, 2);
    list = move(list, 2, 1);
    list = move(list, 1, 3);
    expect(list).toEqual(start);
  });

  it('a hundred trips there and back change nothing more than the first: no place creeps up', () => {
    let list = [c('A', 20), c('B', 15), c('C', 15), c('D', 5)];
    list = move(move(list, 3, 1), 1, 3);
    const after1 = JSON.stringify(list);
    for (let i = 0; i < 100; i++) list = move(move(list, 3, 1), 1, 3);
    expect(JSON.stringify(list)).toBe(after1);
    // And between the two who tie, back and forth: one lift at most, then steady.
    let tie = move([c('B', 15), c('C', 15), c('X', 2)], 2, 1);
    const once = JSON.stringify(tie);
    for (let i = 0; i < 100; i++) tie = move(move(tie, 1, 2), 2, 1);
    expect(JSON.stringify(tie)).toBe(once);
  });

  it('dropped between two who tie: lifted over the one below, the one above lifted over it, the order strict', () => {
    const out = move([c('A', 10), c('B', 10), c('X', 2)], 2, 1);
    expect(names(out)).toEqual(['A', 'X', 'B']);
    expect(out[1].place).toBeCloseTo(10 + STEP, 6);
    expect(out[0].place).toBeCloseTo(10 + 2 * STEP, 6);
    expect(strict(out)).toBe(true);
  });

  it('a tie further up is lifted only as far up as needed, and one already clear above is left alone', () => {
    const out = move([c('Top', 30), c('A', 10), c('B', 10), c('C', 10), c('X', 1)], 4, 3);
    expect(names(out)).toEqual(['Top', 'A', 'B', 'X', 'C']);
    expect(strict(out)).toBe(true);
    expect(out[0]).not.toHaveProperty('place');
  });

  it('a tie below the one dragged, out of its reach, is left as it was', () => {
    const out = move([c('A', 20), c('B', 10), c('C', 10), c('X', 1)], 3, 0);
    expect(out[0].place).toBeCloseTo(20 + STEP, 6);
    expect(out[2]).not.toHaveProperty('place');
    expect(out[3]).not.toHaveProperty('place');
  });

  it('a place no longer needed (its neighbor removed) is let go at the next drag, between two who tie or not', () => {
    // C's place kept it under B; B gone, C's 4 stands by itself under A.
    const stale = () => [c('A', 10), c('X', 2), c('B', 10), c('C', 4, { place: 1.5 }), c('D', 1)];
    const tie = keepDrag(stale(), 1);
    expect(tie[3]).not.toHaveProperty('place');
    expect(tie[1].place).toBeCloseTo(10 + STEP, 6);
    // X's 7 falls between A and C, so X has none; C's 4 then falls between X and D: let go too.
    const fits = keepDrag([c('A', 10), c('X', 7), c('C', 4, { place: 1.5 }), c('D', 1)], 1);
    expect(fits[2]).not.toHaveProperty('place');
    // X's 12 over A's 10: a step under it; C's 4 let go as well.
    const gap = keepDrag([c('A', 10), c('X', 12), c('C', 4, { place: 1.5 }), c('D', 1)], 1);
    expect(gap[1].place).toBeCloseTo(10 - STEP, 6);
    expect(gap[2]).not.toHaveProperty('place');
  });

  it('rolls of 0 and under: at the bottom, their own roll stands', () => {
    const list = move(move([c('A', 5), c('B', 0), c('N', -2)], 2, 0), 0, 2);
    expect(list).toEqual([c('A', 5), c('B', 0), c('N', -2)]);
    // At the bottom with a place no longer needed, a roll under 0 is let go too: nothing under it to fall short of.
    expect(keepDrag([c('A', 5), c('X', 3), c('N', -2, { place: -5 })], 1)[2]).not.toHaveProperty('place');
  });

  it('alone, or out of range: the list as it was, a copy', () => {
    const one = [c('A', 5)];
    expect(keepDrag(one, 0)).toEqual(one);
    expect(keepDrag(one, 0)).not.toBe(one);
    expect(keepDrag(one, 3)).toEqual(one);
  });

  it('the list it was given is left as it was', () => {
    const list = [c('A', 20), c('D', 5), c('B', 15)];
    keepDrag(list, 1);
    expect(list[1]).not.toHaveProperty('place');
  });

  it('thousands of random drags, ties and all: the tracker\'s sort keeps the order dragged, every place near the rolls', () => {
    // A small seeded random, so a failure comes back the same.
    let seed = 7;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    // The tracker's own sort: by place, a tie in the order rolled (sockets/initiative.js).
    const sorted = (list) => [...list].sort((a, b) => placeOf(b) - placeOf(a) || a.insertOrder - b.insertOrder);
    for (let run = 0; run < 200; run++) {
      const size = 2 + rnd(7);
      const rolled = Array.from({ length: size }, (_, i) => c(`C${i}`, 1 + rnd(6), { insertOrder: i }));
      let list = sorted(rolled);
      for (let d = 0; d < 30; d++) {
        const from = rnd(size);
        const to = rnd(size);
        const want = list.slice();
        want.splice(to, 0, ...want.splice(from, 1));
        list = move(list, from, to);
        expect(names(list)).toEqual(names(want));
        expect(names(sorted(list))).toEqual(names(list));
        expect(Math.max(...places(list))).toBeLessThan(6 + 1);
        expect(Math.min(...places(list))).toBeGreaterThan(1 - 1);
      }
    }
  });

  it('distinct rolls dragged about at random, then each dragged back where its roll goes: no place left on anyone', () => {
    let seed = 11;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let run = 0; run < 200; run++) {
      const size = 2 + rnd(7);
      const start = Array.from({ length: size }, (_, i) => c(`C${i}`, 20 - i * 2));
      let list = start;
      for (let d = 0; d < 20; d++) list = move(list, rnd(size), rnd(size));
      // Back, top down, each into the slot its roll goes in, as a GM would.
      for (let i = 0; i < size; i++) list = move(list, list.findIndex((x) => x.name === start[i].name), i);
      expect(list).toEqual(start);
    }
  });
});

describe('atBottom', () => {
  it('a late joiner who rolled at or over the last: a step under it; under it already: as rolled', () => {
    expect(atBottom([c('A', 20), c('B', 8)], c('K', 30)).place).toBeCloseTo(8 - STEP, 6);
    expect(atBottom([c('A', 20), c('B', 8)], c('K', 8)).place).toBeCloseTo(8 - STEP, 6);
    expect(atBottom([c('A', 20), c('B', 8)], c('K', 3))).not.toHaveProperty('place');
  });

  it('under a last one with a place of its own; into an empty order, as rolled', () => {
    expect(atBottom([c('A', 20), c('B', 8, { place: 25 })], c('K', 30)).place).toBeCloseTo(25 - STEP, 6);
    expect(atBottom([c('A', 20), c('B', 8, { place: 25 })], c('K', 9))).not.toHaveProperty('place');
    expect(atBottom([], c('K', 30))).not.toHaveProperty('place');
  });
});

describe('lowered', () => {
  it('a pass down: the roll and a place both down; no place, none made', () => {
    expect(lowered(c('A', 18, { place: 22 }), 10)).toMatchObject({ score: 8, place: 12 });
    expect(lowered(c('A', 18), 10)).not.toHaveProperty('place');
    expect(lowered(c('A', 18), 10).score).toBe(8);
  });
});
