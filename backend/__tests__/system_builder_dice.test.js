import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

/**
 * A system's own dice (6c1a; approved mockup docs/mockups/builder-dice.html, 2026-10-21): symbols
 * with a mark, what each cancels and counts as; dice whose faces show a number, symbols, both or
 * nothing; checked as strictly as the rest of an untrusted file and carried in a .citysys file
 * beside the system, so a builder from before them still installs it.
 */

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const { LIMITS, symbolsOf, diceOf } = require_('../systemBuilder/diceFaces');
const citysys = require_('../systemBuilder/citysys');
const { randomSystem } = require_('./helpers/randomSystem');

const SYMBOLS = [
  { id: 'hit', name: 'Hit', mark: '✶', cancels: 'miss' },
  { id: 'miss', name: 'Miss', mark: '✕', cancels: 'hit' },
  { id: 'edge', name: 'Edge', mark: '◆' },
  { id: 'crit', name: 'Crit', mark: '★', also: 'hit' },
  { id: 'skull', name: 'Skull', icon: 'skull' },
];
const DICE = [
  { id: 'good', name: 'Good', faces: [{}, {}, { s: ['hit'] }, { s: ['hit', 'edge'] }, { s: ['edge', 'edge'] }, { s: ['edge'] }] },
  { id: 'bad', name: 'Bad', color: 'danger', faces: [{}, { s: ['miss'] }, { s: ['miss', 'miss'] }, { s: ['crit'] }] },
  { id: 'fate', name: 'dF', faces: [{ n: 1 }, { n: 1 }, { n: 0 }, { n: 0 }, { n: -1 }, { n: -1 }] },
  { id: 'skull_d6', name: 'Skull die', faces: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }, { s: ['skull'] }] },
];
const HEARTH = { format: 1, name: 'Hearth', symbols: SYMBOLS, dice: DICE };
const said = (def) => checkDefinition(def).problems.filter((p) => /^(symbol|die|dice)/.test(p.where)).map((p) => `${p.where}: ${p.message}`);
const withSymbol = (patch, i = 0) => ({ ...HEARTH, symbols: SYMBOLS.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
const withDie = (patch, i = 0) => ({ ...HEARTH, dice: DICE.map((d, k) => (k === i ? { ...d, ...patch } : d)) });

describe('a system\'s symbols', () => {
  it('take a mark of a character or two, or a drawn icon, a cancelling pair, and one that also counts as another', () => {
    expect(said(HEARTH)).toEqual([]);
    // An emoji is one mark however many code points make it.
    expect(said(withSymbol({ mark: '👍🏽' }))).toEqual([]);
    expect(said(withSymbol({ mark: 'XX' }))).toEqual([]);
    expect(said({ format: 1, name: 'Plain' })).toEqual([]);
  });

  it('say what is wrong with one, by its id or place', () => {
    expect(said(withSymbol({ mark: 'XYZ' }))).toEqual(['symbol hit, mark: A mark of one or 2 characters']);
    expect(said(withSymbol({ mark: ' ' }))).toEqual(['symbol hit, mark: A mark of one or 2 characters']);
    expect(said(withSymbol({ mark: undefined }))).toEqual(['symbol hit, mark: Needs a mark or an icon, to show on the dice']);
    expect(said(withSymbol({ icon: 'unicorn' }, 4))).toEqual(['symbol skull, icon: One of the drawn icons']);
    expect(said(withSymbol({ name: '' }))).toEqual([`symbol hit, name: A name of up to ${LIMITS.name} characters`]);
    // MISS, CRIT and the GOOD die's faces, which named it, say so too.
    expect(said(withSymbol({ id: 'Hit Points' }))).toEqual([
      'symbol Hit Points: Ids use lowercase letters, digits and _, starting with a letter',
      'symbol miss, cancels: Not one of this system\'s symbols',
      'symbol crit, also: Not one of this system\'s symbols',
      'die good, face 3, symbol 1: Not one of this system\'s symbols',
      'die good, face 4, symbol 1: Not one of this system\'s symbols',
    ]);
    expect(said(withSymbol({ id: 'miss', cancels: undefined }))).toContain('symbol miss: Defined twice');
    expect(said(withSymbol({ colour: 'red' }))).toEqual(['symbol hit, colour: Not part of a symbol']);
    expect(said({ ...HEARTH, symbols: [...SYMBOLS, 'hit'] })).toEqual(['symbol 6: Must be a symbol']);
    expect(said({ ...HEARTH, symbols: 'hit', dice: undefined })).toEqual(['symbols: Must be a list of symbols']);
    expect(said({ ...HEARTH, symbols: Array.from({ length: LIMITS.symbols + 1 }, (_, i) => ({ id: `s${i}`, name: 'S', mark: 'S' })), dice: undefined }))
      .toEqual([`symbols: At most ${LIMITS.symbols} symbols`]);
  });

  it('cancel and count as only this system\'s other symbols, a pair and one step at a time', () => {
    expect(said(withSymbol({ cancels: 'luck' }))).toEqual(['symbol hit, cancels: Not one of this system\'s symbols']);
    expect(said(withSymbol({ cancels: 'hit' }))).toContain('symbol hit, cancels: A symbol can\'t cancel itself');
    expect(said(withSymbol({ also: 'crit' }, 3))).toEqual(['symbol crit, also: A symbol already counts as itself']);
    // EDGE cancelling HIT, which already cancels MISS.
    expect(said(withSymbol({ cancels: 'hit' }, 2))).toEqual(['symbol edge, cancels: Hit already cancels another symbol']);
    // SKULL counting as CRIT, which already counts as HIT.
    expect(said(withSymbol({ also: 'crit' }, 4))).toEqual(['symbol skull, also: Crit already counts as another symbol']);
  });

  it('read whole for the rolls, anything broken left out', () => {
    expect(symbolsOf(HEARTH)).toEqual(SYMBOLS);
    expect(symbolsOf({ symbols: [{ id: 'hit', name: 'Hit', mark: '✶', icon: 'unicorn', cancels: 7 }, { id: 'Bad!' }, null] })).toEqual([{ id: 'hit', name: 'Hit', mark: '✶' }]);
    expect(symbolsOf({})).toEqual([]);
  });
});

describe('a system\'s dice', () => {
  it('say what is wrong with one, by its id or place', () => {
    expect(said(withDie({ faces: [{}] }))).toEqual([`die good, faces: From 2 to ${LIMITS.faces} faces`]);
    expect(said(withDie({ faces: Array.from({ length: LIMITS.faces + 1 }, () => ({})) }))).toEqual([`die good, faces: From 2 to ${LIMITS.faces} faces`]);
    expect(said(withDie({ color: 'red' }))).toEqual(['die good, color: The theme\'s, or danger']);
    expect(said(withDie({ name: 'A'.repeat(LIMITS.name + 1) }))).toEqual([`die good, name: A name of up to ${LIMITS.name} characters`]);
    expect(said(withDie({ id: 'bad' }))).toEqual(['die bad: Defined twice']);
    expect(said(withDie({ sides: 6 }))).toEqual(['die good, sides: Not part of a die']);
    expect(said({ ...HEARTH, dice: { good: DICE[0] } })).toEqual(['dice: Must be a list of dice']);
    expect(said({ ...HEARTH, dice: [...DICE, 6] })).toEqual(['die 5: Must be a die']);
  });

  it('a face: a whole number with its sign, and up to six of this system\'s symbols', () => {
    expect(said(withDie({ faces: [{ n: 1.5 }, { n: 1000 }] }, 2))).toEqual([
      `die fate, face 1, number: A whole number from -${LIMITS.number} to ${LIMITS.number}`,
      `die fate, face 2, number: A whole number from -${LIMITS.number} to ${LIMITS.number}`,
    ]);
    expect(said(withDie({ faces: [{ s: ['hit', 'luck'] }, { s: Array(LIMITS.perFace + 1).fill('hit') }, { text: 'Hit' }, 'hit'] }))).toEqual([
      'die good, face 1, symbol 2: Not one of this system\'s symbols',
      `die good, face 2, symbols: A list of up to ${LIMITS.perFace} symbols`,
      'die good, face 3, text: A face has a number and symbols',
      'die good, face 4: Must be a face',
    ]);
    // A die of symbols needs the system's symbols.
    expect(said({ ...HEARTH, symbols: undefined })).toContain('die good, face 3, symbol 1: Not one of this system\'s symbols');
  });

  it('read whole for the rolls: a number or none on each face, its symbols, and a color', () => {
    const [good, bad, fate] = diceOf(HEARTH);
    expect(good).toEqual({ id: 'good', name: 'Good', color: 'theme', faces: [{ n: null, s: [] }, { n: null, s: [] }, { n: null, s: ['hit'] }, { n: null, s: ['hit', 'edge'] }, { n: null, s: ['edge', 'edge'] }, { n: null, s: ['edge'] }] });
    expect(bad.color).toBe('danger');
    expect(fate.faces.map((f) => f.n)).toEqual([1, 1, 0, 0, -1, -1]);
    expect(diceOf({ dice: [{ id: 'one', faces: [{}] }, { id: 'two', faces: [{ n: 'x' }, { s: [3, 'hit'] }] }] })).toEqual([{ id: 'two', name: 'two', color: 'theme', faces: [{ n: null, s: [] }, { n: null, s: ['hit'] }] }]);
  });
});

describe('dice in a .citysys file', () => {
  const file = (definition) => citysys.buildFile({ definition, version: 2, origin: 'sys_abcdefabcdefabcd' });

  it('travel beside the system, so a builder from before them reads a system it knows', () => {
    const built = file(HEARTH);
    expect([built.symbols, built.dice]).toEqual([SYMBOLS, DICE]);
    expect('symbols' in built.definition || 'dice' in built.definition).toBe(false);
    expect(checkDefinition(built.definition).problems).toEqual([]);
  });

  it('go back into the system when installed here, checked with the rest', () => {
    const read = citysys.readFile(JSON.stringify(file(HEARTH)));
    expect([read.file.definition.symbols, read.file.definition.dice]).toEqual([SYMBOLS, DICE]);
    expect(read.problems).toEqual([]);
    const broken = citysys.readFile(JSON.stringify(file(withDie({ faces: [{ s: ['luck'] }, {}] }))));
    expect(broken.problems.map((p) => p.where)).toEqual(['die good, face 1, symbol 1']);
  });

  it('a system without dice has none in its file', () => {
    const built = file({ format: 1, name: 'Plain' });
    expect('symbols' in built || 'dice' in built).toBe(false);
  });

  it('every random system\'s dice pass, and come back from its file as they went in', () => {
    let withDice = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const def = randomSystem(seed);
      if (def.dice) withDice += 1;
      expect(said(def), `seed ${seed}`).toEqual([]);
      expect(citysys.readFile(JSON.stringify(file(def))).file.definition, `seed ${seed}`).toEqual(def);
    }
    expect(withDice).toBeGreaterThan(10);
  });
});
