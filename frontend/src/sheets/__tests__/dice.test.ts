import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  LIMITS, DICE_PRESETS, symbolList, dieList, withDicePreset, withNewDie, withDieName, withDieColor, withFaceCount, withFace,
  withoutDie, withNewSymbol, withSymbol, alsoChoices, withoutSymbol, withTableDie, faceText, faceWords,
  BLANK_DRAWN, drawnAt, withSquare, drawnSquares, withSymbolLook,
} from '../dice';
import type { Definition } from '../systemsApi';

/**
 * STATS & RULES' DICE tab as logic (6c2a). Approved mockup builder-dice (2026-10-21): a system's own
 * dice and symbols, three presets, COPY FROM THE TABLE'S DICE. Every edit held to the server's own
 * checks (backend diceFaces.js), and a face written as the server's log writes it.
 */

const req = createRequire(import.meta.url);
const backend = req('../../../../backend/systemBuilder/diceFaces.js');
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const { rollField } = req('../../../../backend/systemBuilder/tableRolls.js');

const BLANK: Definition = { format: 1, name: 'Hearth' };
const problems = (def: Definition) => checkDefinition(def).problems.map((p: { where: string; message: string }) => `${p.where}: ${p.message}`);
const made = (r: { definition: Definition | null } | null): Definition => { if (!r || !r.definition) throw new Error('not made'); return r.definition; };
const die = (def: Definition, id: string) => dieList(def).find((d) => d.id === id)!;
const sym = (def: Definition, id: string) => symbolList(def).find((s) => s.id === id)!;

describe('the limits', () => {
  it('are the server\'s', () => expect(LIMITS).toEqual(backend.LIMITS));
});

describe('the presets', () => {
  it('each make dice the server takes, its symbols with them', () => {
    for (const key of Object.keys(DICE_PRESETS)) {
      const r = withDicePreset(BLANK, key)!;
      expect(problems(r.definition), key).toEqual([]);
      expect(r.id, key).toBe(DICE_PRESETS[key].dice[0].id);
    }
    const narrative = made(withDicePreset(BLANK, 'narrative'));
    expect(dieList(narrative).map((d) => d.name)).toEqual(['Good', 'Great', 'Bad']);
    expect(symbolList(narrative).map((s) => s.id)).toEqual(['hit', 'miss', 'edge', 'snag', 'crit']);
  });

  it('a second time: new ids for its dice, the symbols already there used as they are', () => {
    const twice = made(withDicePreset(made(withDicePreset(BLANK, 'narrative')), 'narrative'));
    expect(dieList(twice).map((d) => d.id)).toEqual(['good', 'great', 'bad', 'good_2', 'great_2', 'bad_2']);
    expect(symbolList(twice)).toHaveLength(5);
    expect(problems(twice)).toEqual([]);
    expect(withDicePreset(BLANK, 'nonsense')).toBeNull();
    // Past the most symbols a system may have: not added.
    const crowded = { ...BLANK, symbols: Array.from({ length: LIMITS.symbols - 1 }, (_, i) => ({ id: `s${i}`, name: 'S', mark: 'S' })) };
    expect(withDicePreset(crowded, 'narrative')).toBeNull();
  });
});

describe('a die', () => {
  const base = made(withDicePreset(BLANK, 'narrative'));

  it('a new one is a plain d6, up to the most dice a system may have', () => {
    const r = withNewDie(BLANK)!;
    expect(die(r.definition, r.id)).toEqual({ id: 'new_die', name: 'New die', faces: [1, 2, 3, 4, 5, 6].map((n) => ({ n })) });
    expect(problems(r.definition)).toEqual([]);
    const full = { ...BLANK, dice: Array.from({ length: LIMITS.dice }, (_, i) => ({ id: `d${i}`, name: 'D', faces: [{}, {}] })) };
    expect(withNewDie(full)).toBeNull();
  });

  it('renamed (its id kept, for the rolls), colored, and its faces counted up or down', () => {
    const named = withDieName(base, 'good', 'Boon');
    expect(die(named, 'good').name).toBe('Boon');
    expect(die(withDieColor(base, 'good', true), 'good').color).toBe('danger');
    expect('color' in die(withDieColor(base, 'bad', false), 'bad')).toBe(false);
    const more = withFaceCount(base, 'good', 8);
    expect(die(more, 'good').faces.slice(6)).toEqual([{}, {}]);
    expect(die(withFaceCount(base, 'good', 3), 'good').faces).toEqual(die(base, 'good').faces.slice(0, 3));
    expect(die(withFaceCount(base, 'good', 1), 'good').faces).toHaveLength(2);
    expect(die(withFaceCount(base, 'good', 500), 'good').faces).toHaveLength(LIMITS.faces);
    for (const def of [named, more, withDieColor(base, 'good', true)]) expect(problems(def)).toEqual([]);
  });

  it('a face: a whole number (none to clear it), and symbols, up to six', () => {
    const f = (def: Definition) => die(def, 'good').faces[0];
    expect(f(withFace(base, 'good', 0, { n: 3 }))).toEqual({ n: 3 });
    expect(f(withFace(base, 'good', 0, { n: -2.7 }))).toEqual({ n: -2 });
    expect(f(withFace(base, 'good', 0, { n: 5000 }))).toEqual({ n: LIMITS.number });
    expect(f(withFace(withFace(base, 'good', 0, { n: 3 }), 'good', 0, { n: null }))).toEqual({});
    expect(f(withFace(base, 'good', 0, { s: ['hit', 'edge'] }))).toEqual({ s: ['hit', 'edge'] });
    expect(f(withFace(base, 'good', 0, { s: Array(9).fill('hit') })).s).toHaveLength(LIMITS.perFace);
    expect(f(withFace(withFace(base, 'good', 0, { s: ['hit'] }), 'good', 0, { s: [] }))).toEqual({});
    expect(problems(withFace(base, 'good', 0, { n: 3, s: ['hit', 'hit'] }))).toEqual([]);
  });

  it('removed: a roll that rolled it says so, as for anything else a roll names', () => {
    const rolling = { ...base, rolls: [{ id: 'clash', dice: [{ count: '1', die: 'good' }] }] };
    expect(dieList(withoutDie(rolling, 'good')).map((d) => d.id)).toEqual(['great', 'bad']);
    expect(problems(withoutDie(rolling, 'good'))).toEqual(['roll clash, dice 1, die: Not one of this system\'s dice']);
  });
});

describe('a symbol', () => {
  const base = made(withDicePreset(BLANK, 'narrative'));

  it('a new one to name, up to twelve', () => {
    const r = withNewSymbol(base)!;
    expect(sym(r.definition, r.id)).toEqual({ id: 'new_symbol', name: 'New symbol', mark: '?' });
    expect(problems(r.definition)).toEqual([]);
    expect(withNewSymbol({ ...BLANK, symbols: Array.from({ length: LIMITS.symbols }, (_, i) => ({ id: `s${i}`, name: 'S', mark: 'S' })) })).toBeNull();
  });

  it('cancels as a pair: paired both ways, and whoever either was paired with lets go', () => {
    // EDGE now cancels MISS: HIT and SNAG lose their partners.
    const repaired = withSymbol(base, 'edge', { cancels: 'miss' });
    expect([sym(repaired, 'edge').cancels, sym(repaired, 'miss').cancels, sym(repaired, 'hit').cancels, sym(repaired, 'snag').cancels]).toEqual(['miss', 'edge', undefined, undefined]);
    expect(problems(repaired)).toEqual([]);
    const free = withSymbol(base, 'hit', { cancels: null });
    expect([sym(free, 'hit').cancels, sym(free, 'miss').cancels]).toEqual([undefined, undefined]);
    expect(sym(withSymbol(base, 'hit', { cancels: 'hit' }), 'hit').cancels).toBeUndefined();
    expect(withSymbol(base, 'nope', { name: 'X' })).toBe(base);
  });

  it('named, marked, and counted as another or not', () => {
    const changed = withSymbol(withSymbol(base, 'edge', { name: 'Boon', mark: '+' }), 'snag', { also: 'miss' });
    expect(sym(changed, 'edge')).toEqual({ id: 'edge', name: 'Boon', mark: '+', cancels: 'snag' });
    expect(sym(changed, 'snag').also).toBe('miss');
    expect('also' in sym(withSymbol(changed, 'snag', { also: null }), 'snag')).toBe(false);
    // Counting goes one step: CRIT counts as HIT, so nothing may count as CRIT, and HIT, counted as, counts as nothing.
    expect(alsoChoices(base, 'snag').map((s) => s.id)).toEqual(['hit', 'miss', 'edge']);
    expect(alsoChoices(base, 'hit')).toEqual([]);
    expect(withSymbol(base, 'snag', { also: 'crit' })).toBe(base);
    expect(withSymbol(base, 'hit', { also: 'miss' })).toBe(base);
    expect(problems(changed)).toEqual([]);
  });

  it('removed: off every face, nothing cancelling it or counting as it', () => {
    const gone = withoutSymbol(base, 'hit');
    expect(symbolList(gone).map((s) => s.id)).toEqual(['miss', 'edge', 'snag', 'crit']);
    expect([sym(gone, 'miss').cancels, sym(gone, 'crit').also]).toEqual([undefined, undefined]);
    expect(die(gone, 'good').faces).toEqual([{}, {}, {}, { s: ['edge'] }, { s: ['edge', 'edge'] }, { s: ['edge'] }]);
    expect(problems(gone)).toEqual([]);
  });
});

describe('a symbol\'s look (6c2b1)', () => {
  const base = made(withDicePreset(BLANK, 'worded'));
  const SKULL = ['07e0', '1ff8', '3ffc', '3ffc', '73ce', '6186', '6186', '73ce', '3e7c', '1ff8', '0ff0', '0db0', '0db0', '07e0', '0000', '0000'];
  const upload = `/uploads/condition_icons/${'b'.repeat(64)}.webp`;

  it('its mark, an icon (drawn or uploaded) or a drawing, one picture at a time, the mark kept for the log', () => {
    const drawn = withSymbolLook(base, 'skull', { drawn: SKULL });
    expect(sym(drawn, 'skull')).toEqual({ id: 'skull', name: 'Skull', mark: '☠', drawn: SKULL });
    const icon = withSymbolLook(drawn, 'skull', { icon: upload });
    expect(sym(icon, 'skull')).toEqual({ id: 'skull', name: 'Skull', mark: '☠', icon: upload });
    expect(sym(withSymbolLook(icon, 'skull', { mark: true }), 'skull')).toEqual({ id: 'skull', name: 'Skull', mark: '☠' });
    for (const def of [drawn, icon, withSymbolLook(base, 'skull', { icon: 'star' })]) expect(problems(def)).toEqual([]);
    // A symbol with no mark gets one from its name, so the log has something to write.
    const unmarked = { ...base, symbols: [{ id: 'skull', name: 'skull', icon: 'star' }] };
    expect(sym(withSymbolLook(unmarked, 'skull', { drawn: SKULL }), 'skull').mark).toBe('S');
  });

  it('drawn on the pad a square at a time, stored as the server takes it', () => {
    let d = BLANK_DRAWN;
    expect(problems(withSymbolLook(base, 'skull', { drawn: d }))).toEqual([]);
    d = withSquare(d, 0, 0, true);
    d = withSquare(d, 15, 15, true);
    d = withSquare(d, 7, 3, true);
    expect([d[0], d[3], d[15]]).toEqual(['8000', '0100', '0001']);
    expect([drawnAt(d, 0, 0), drawnAt(d, 1, 0), drawnAt(d, 15, 15)]).toEqual([true, false, true]);
    expect(drawnSquares(d)).toEqual([[0, 0], [7, 3], [15, 15]]);
    expect(withSquare(d, 0, 0, false)[0]).toBe('0000');
    expect(withSquare(d, 16, 0, true)).toEqual(d);
    expect(drawnSquares(SKULL).length).toBe(SKULL.reduce((n, row) => n + [...parseInt(row, 16).toString(2)].filter((b) => b === '1').length, 0));
    // Any strokes at all make a drawing the server takes.
    let seed = 3;
    for (let i = 0; i < 300; i += 1) { seed = (seed * 69069 + 1) % 4294967296; d = withSquare(d, seed % 16, (seed >> 4) % 16, !!(seed & 256)); }
    expect(backend.isDrawn(d)).toBe(true);
    expect(problems(withSymbolLook(base, 'skull', { drawn: d }))).toEqual([]);
  });
});

describe('COPY FROM THE TABLE\'S DICE', () => {
  it('numbers stay numbers, words become symbols (one by that name reused), and the server takes it', () => {
    const skull = { name: 'Skull die', faces: ['1', '2', '+3', '-1', 'Skull', 'skull'].map((value) => ({ value })) };
    const r = withTableDie(BLANK, skull) as { definition: Definition; id: string };
    expect(die(r.definition, r.id)).toEqual({ id: 'skull_die', name: 'Skull die', faces: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: -1 }, { s: ['skull'] }, { s: ['skull'] }] });
    expect(symbolList(r.definition)).toEqual([{ id: 'skull', name: 'Skull', mark: 'S' }]);
    expect(problems(r.definition)).toEqual([]);
    // A system with a SKULL already uses it.
    const has = { ...BLANK, symbols: [{ id: 'bones', name: 'skull', mark: '☠' }] };
    const again = withTableDie(has, skull) as { definition: Definition };
    expect(symbolList(again.definition)).toEqual([{ id: 'bones', name: 'skull', mark: '☠' }]);
  });

  it('pads a die of one face, and says why when it would pass the limits', () => {
    const one = withTableDie(BLANK, { name: '', faces: [{ value: '' }] }) as { definition: Definition; id: string };
    expect(die(one.definition, one.id)).toEqual({ id: 'die', name: 'Die', faces: [{}, {}] });
    const wordy = { name: 'Wordy', faces: Array.from({ length: LIMITS.symbols + 1 }, (_, i) => ({ value: `Word${i}` })) };
    expect(withTableDie(BLANK, wordy)).toEqual({ definition: null, message: `Its words would make more than ${LIMITS.symbols} symbols.` });
    const full = { ...BLANK, dice: Array.from({ length: LIMITS.dice }, (_, i) => ({ id: `d${i}`, name: 'D', faces: [{}, {}] })) };
    expect(withTableDie(full, { name: 'X', faces: [{ value: '1' }, { value: '2' }] })).toEqual({ definition: null, message: `A system has at most ${LIMITS.dice} dice.` });
  });
});

describe('a face in words', () => {
  it('as the server\'s log writes it, every face of every preset die', () => {
    for (const key of Object.keys(DICE_PRESETS)) {
      const def = made(withDicePreset(BLANK, key));
      for (const d of dieList(def)) {
        d.faces.forEach((f, i) => {
          const rolled = rollField({ definition: def, data: {}, roll: { id: 't', dice: [{ count: '1', die: d.id }], read: 'symbols' }, rng: () => (i + 0.5) / d.faces.length, who: 'T' });
          expect(faceText(d, f, symbolList(def)), `${d.id} face ${i + 1}`).toBe(rolled.results[d.name][0]);
        });
      }
    }
  });

  it('for its box: signed numbers and symbol names, or BLANK', () => {
    const def = made(withDicePreset(BLANK, 'narrative'));
    expect(faceWords({ n: 2, s: ['hit', 'edge'] }, symbolList(def))).toBe('+2 HIT EDGE');
    expect(faceWords({ n: -1 }, symbolList(def))).toBe('-1');
    expect(faceWords({}, symbolList(def))).toBe('BLANK');
  });
});

describe('over random edits', () => {
  it('whatever is done, in any order, the server takes the result', () => {
    let seed = 7;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let round = 0; round < 60; round += 1) {
      let def = made(withDicePreset(BLANK, Object.keys(DICE_PRESETS)[rand(3)]));
      for (let step = 0; step < 15; step += 1) {
        const dice = dieList(def);
        const syms = symbolList(def);
        const d = dice[rand(dice.length)];
        const s = syms.length ? syms[rand(syms.length)] : null;
        const other = syms.length ? syms[rand(syms.length)].id : null;
        switch (rand(10)) {
          case 0: def = withNewDie(def)?.definition ?? def; break;
          case 1: def = withNewSymbol(def)?.definition ?? def; break;
          case 2: if (d) def = withFaceCount(def, d.id, rand(10) + 1); break;
          case 3: if (d) def = withFace(def, d.id, rand(d.faces.length), { n: rand(3) ? rand(20) - 10 : null, s: other ? [other] : [] }); break;
          case 4: if (s) def = withSymbol(def, s.id, { cancels: rand(2) ? other : null }); break;
          case 5: if (s) def = withSymbol(def, s.id, { also: rand(2) ? other : null }); break;
          case 6: if (s && dieList(def).length > 1) def = withoutSymbol(def, s.id); break;
          case 7: if (d && dice.length > 1) def = withoutDie(def, d.id); break;
          case 8: def = withDicePreset(def, Object.keys(DICE_PRESETS)[rand(3)])?.definition ?? def; break;
          default: if (d) def = withDieColor(withDieName(def, d.id, `Die ${step}`), d.id, !!rand(2));
        }
      }
      expect(problems(def), `round ${round}`).toEqual([]);
    }
  });
});
