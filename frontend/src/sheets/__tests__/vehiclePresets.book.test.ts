import { describe, it, expect } from 'vitest';
import { VEHICLE_PRESETS, getPreset } from '../vehiclePresets';

/**
 * Every preset, against the book.
 *
 * The table was first transcribed from a screenshot and five values came out wrong — four
 * Trauma Targets and one Armour Rating, all off by a column or a digit and none of them
 * visible as wrong once entered. This holds the rows verbatim so the next transcription
 * error fails here rather than at someone's table.
 *
 * Cities Without Number, p.82. CC BY-NC 4.0 by 0frames.
 */

// Cost, Spd, Armor, TT, AC, HP, Crew, Pow, Mass, Size, Hrdpt — the column order printed
// in the book, kept as-is so a row can be checked against the page by eye.
const BOOK = `
Motorcycle   1000     1  4     10 13 10  1  1  3  S 0
Micro Flyer  3000     0  0      6 13 10  1  1  4  S 0
Car          5000     0  6     12 11 30  5  3  7  M 1
Truck        7500     0  6     12 11 35  2  3 14  L 1
Helicopter   50000    3  6     10 14 20  6  4  9  M 1
Tank         500000   0  **    12 18 40  3  8 15  L 3
APC          60000   -1  *     10 16 30 16  5 14  L 1
GEV          100000   1  *     10 16 30  3  6 10  L 2
CASRA        200000   2  10    10 18 35  2  7 10  L 2
Dropcraft    1000000  3  12    12 16 40 13  8 12  L 2
`.trim().split('\n').map((line) => {
  const p = line.trim().split(/\s+/);
  // Names run to one or two words; the numbers start at the cost.
  const at = p.findIndex(x => /^\d{4,}$/.test(x));
  const [cost, spd, armor, tt, ac, hp, crew, , , size, hrdpt] = p.slice(at);
  return {
    label: p.slice(0, at).join(' ').toUpperCase(),
    cost: +cost, spd: +spd,
    // * and ** are immunities the GM rules on, not ratings.
    armor: /^\*+$/.test(armor) ? null : +armor,
    tt: +tt, ac: +ac, hp: +hp, crew: +crew, size, hrdpt: +hrdpt,
  };
});

describe('the CWN vehicle table', () => {
  it('has every row', () => {
    expect(BOOK).toHaveLength(10);
    expect(VEHICLE_PRESETS).toHaveLength(BOOK.length);
    expect(VEHICLE_PRESETS.map(p => p.label)).toEqual(BOOK.map(r => r.label));
  });

  it.each(BOOK)('matches the book for $label', (row) => {
    const preset = VEHICLE_PRESETS.find(p => p.label === row.label)!;
    expect(preset).toBeTruthy();
    for (const key of ['cost', 'spd', 'armor', 'tt', 'ac', 'hp', 'crew', 'hrdpt', 'size'] as const) {
      expect(preset[key], `${row.label} ${key}`).toBe(row[key]);
    }
  });

  it('marks exactly the three vehicles the book gives an immunity', () => {
    const immune = VEHICLE_PRESETS.filter(p => p.armor === null).map(p => p.id);
    expect(immune.sort()).toEqual(['apc', 'gev', 'tank']);
    // Each carries the rule text, since there is no number to put in its place.
    for (const id of immune) expect(getPreset(id)!.note).toBeTruthy();
  });

  it('gives every vehicle at least a driver and no more seats than the book', () => {
    for (const p of VEHICLE_PRESETS) {
      expect(p.crew, `${p.label} crew`).toBeGreaterThanOrEqual(1);
      expect((p.seatNames ?? []).length, `${p.label} names more seats than it has`)
        .toBeLessThanOrEqual(p.crew);
    }
  });
});
