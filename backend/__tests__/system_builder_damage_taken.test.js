import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

/**
 * What a hit comes to on its target (8b5a; approved mockup docs/mockups/damage-pipeline.html, answers 2 and 3): each part
 * resisted on its own by what its type meets, as the system's WORKS OUT AS says; taken as rolled where nothing meets it,
 * two cancel, the word is WORDS ONLY or WORK IT OUT is off; and the log's words for it.
 */

const require_ = createRequire(import.meta.url);
const { damageTaken, takenWords, seenBy, WORKS_WORDS } = require_('../systemBuilder/damageTaken');
const { worksOutOf } = require_('../systemBuilder/damageTypes');
const { resistancesOf } = require_('../systemBuilder/choices');

const START = { worksOut: worksOutOf(null), workOut: true };
const FLAME_TONGUE = [{ value: 5, type: 'slashing', label: 'SLASHING' }, { value: 9, type: 'fire', label: 'FIRE' }];

describe('each part on its own', () => {
  it('RESIST halves rounded down, IMMUNE takes none, VULNERABLE doubles; the rest as rolled', () => {
    const worked = { fire: { kind: 'resist' }, cold: { kind: 'immune' }, acid: { kind: 'vulnerable' } };
    const hit = [...FLAME_TONGUE, { value: 6, type: 'cold', label: 'COLD' }, { value: 3, type: 'acid', label: 'ACID' }, { value: 2 }];
    expect(damageTaken(hit, worked, START)).toEqual({
      parts: [
        { value: 5, type: 'slashing', label: 'SLASHING', kind: null, taken: 5 },
        { value: 9, type: 'fire', label: 'FIRE', kind: 'resist', works: 'half', taken: 4 },
        { value: 6, type: 'cold', label: 'COLD', kind: 'immune', works: 'none', taken: 0 },
        { value: 3, type: 'acid', label: 'ACID', kind: 'vulnerable', works: 'double', taken: 6 },
        { value: 2, type: null, label: null, kind: null, taken: 2 },
      ],
      rolled: 25, taken: 17,
    });
  });

  it('as the system says each works out; WORDS ONLY as rolled, still met', () => {
    const worked = { fire: { kind: 'resist' }, slashing: { kind: 'immune' } };
    const taken = damageTaken(FLAME_TONGUE, worked, { worksOut: { resist: 'words', immune: 'half', vulnerable: 'none' }, workOut: true });
    expect(taken.parts.map((p) => [p.kind, p.works, p.taken])).toEqual([['immune', 'half', 2], ['resist', 'words', 9]]);
    expect(taken.taken).toBe(11);
  });

  it('WORK IT OUT off: every part as rolled, what met it still known', () => {
    const taken = damageTaken(FLAME_TONGUE, { fire: { kind: 'immune' } }, { worksOut: worksOutOf(null), workOut: false });
    expect(taken.parts[1]).toEqual({ value: 9, type: 'fire', label: 'FIRE', kind: 'immune', taken: 9 });
    expect(taken.taken).toBe(14);
  });

  it('two that cancel, or nothing known of the target: as rolled; nothing, or nothing sensible, rolled: none', () => {
    expect(damageTaken(FLAME_TONGUE, { fire: { kind: null } }, START).taken).toBe(14);
    expect(damageTaken(FLAME_TONGUE, null, START).taken).toBe(14);
    expect(damageTaken(null, {}, START)).toEqual({ parts: [], rolled: 0, taken: 0 });
    expect(damageTaken([{ value: -3, type: 'fire' }, { value: 'x' }, null, { value: 4.7 }], { fire: { kind: 'vulnerable' } }, START).parts.map((p) => p.taken)).toEqual([0, 0, 0, 4]);
  });

  it('read against what the server works out for a sheet: a ring\'s RESIST COLD, a condition\'s VULNERABLE, RESIST ALL by hand', () => {
    const DEF = {
      format: 1, name: 'Taken',
      conditions: { soaked: { name: 'Soaked', resistances: [{ kind: 'vulnerable', type: 'lightning' }] } },
      items: { list: [{ id: 'ring', label: 'Ring of Warmth', needs: 'carried', features: [{ id: 'warm', label: 'Warm', resistances: [{ kind: 'resist', type: 'cold' }] }] }] },
    };
    const sheet = { inventory: JSON.stringify([{ name: 'Ring of Warmth', qty: 1, carry: 'stowed' }]), _resistances: [{ kind: 'resist', type: 'all' }] };
    const worked = resistancesOf(DEF, sheet, ['soaked']);
    const hit = [{ value: 8, type: 'cold', label: 'COLD' }, { value: 8, type: 'lightning', label: 'LIGHTNING' }, { value: 8, type: 'acid', label: 'ACID' }];
    // COLD resisted twice is still resisted once; LIGHTNING's VULNERABLE and ALL's RESIST cancel; ACID only ALL's.
    expect(damageTaken(hit, worked, START).parts.map((p) => [p.kind, p.taken])).toEqual([['resist', 4], [null, 8], ['resist', 4]]);
  });
});

describe('in the log', () => {
  it('what the target takes, then each part a resistance met: how it worked out, or as rolled', () => {
    const worked = { fire: { kind: 'resist' }, slashing: { kind: 'vulnerable' } };
    expect(takenWords('Ganger', damageTaken(FLAME_TONGUE, worked, START))).toBe('GANGER TAKES 14 · VULNERABLE TO SLASHING: 5 → 10 · RESISTS FIRE: 9 → 4');
    expect(takenWords('Ganger', damageTaken(FLAME_TONGUE, { fire: { kind: 'immune' } }, { ...START, workOut: false }))).toBe('GANGER TAKES 14 · IMMUNE TO FIRE (TAKEN AS ROLLED)');
    expect(takenWords('Ganger', damageTaken(FLAME_TONGUE, { fire: { kind: 'resist' } }, { worksOut: { ...START.worksOut, resist: 'words' }, workOut: true }))).toBe('GANGER TAKES 14 · RESISTS FIRE (TAKEN AS ROLLED)');
    expect(takenWords('Ganger', damageTaken([{ value: 3 }], {}, START))).toBe('GANGER TAKES 3');
    // A part with a type but no label: its id.
    expect(takenWords('Ganger', damageTaken([{ value: 3, type: 'fire' }], { fire: { kind: 'immune' } }, START))).toBe('GANGER TAKES 0 · IMMUNE TO FIRE: 3 → 0');
    expect(WORKS_WORDS).toEqual({ half: 'HALF', none: 'NONE', double: 'DOUBLE', words: 'WORDS ONLY' });
  });
});

describe('as players may know it (8b5c)', () => {
  const worked = { fire: { kind: 'resist' }, slashing: { kind: 'vulnerable' } };
  const taken = damageTaken(FLAME_TONGUE, worked, START);

  it("all of it where they see all (a player's character)", () => {
    expect(seenBy(taken, null)).toEqual({ taken, total: true });
  });

  it("a part met by what they don't know said plainly, and the total kept from them where that changed its number", () => {
    const seen = seenBy(taken, { slashing: { kind: 'vulnerable' } });
    expect(seen.total).toBe(false);
    expect(seen.taken.parts[1]).toEqual({ value: 9, type: 'fire', label: 'FIRE', kind: null, taken: 4 });
    expect(seen.taken.parts[0]).toBe(taken.parts[0]);
    expect(takenWords('Ganger', seen.taken, { total: seen.total })).toBe('GANGER · VULNERABLE TO SLASHING: 5 → 10');
    // Known as something else than it is (ALL hidden behind a revealed type): still not theirs.
    expect(seenBy(taken, { fire: { kind: 'vulnerable' }, slashing: { kind: 'vulnerable' } }).total).toBe(false);
    // Nothing they know: no word, no total.
    expect(takenWords('Ganger', seenBy(taken, {}).taken, { total: false })).toBe('GANGER');
  });

  it('one that changes nothing kept from them, the total theirs still; parts nothing met untouched', () => {
    const words = damageTaken(FLAME_TONGUE, { fire: { kind: 'resist' } }, { ...START, workOut: false });
    const seen = seenBy(words, {});
    expect(seen.total).toBe(true);
    expect(takenWords('Ganger', seen.taken, { total: seen.total })).toBe('GANGER TAKES 14');
  });

  it('said as not taken: WOULD TAKE', () => {
    expect(takenWords('Ganger', taken, { verb: 'WOULD TAKE' })).toBe('GANGER WOULD TAKE 14 · VULNERABLE TO SLASHING: 5 → 10 · RESISTS FIRE: 9 → 4');
  });
});
