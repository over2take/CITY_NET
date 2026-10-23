import { describe, it, expect } from 'vitest';
import { labelParts, labelKey } from '../dieLabels';
import type { ThrowSymbol } from '../trayThrow';

/**
 * What the tray prints on a face (6c4b2b; mockup builder-dice, decision 10): the words, or on a
 * system's own die its number and each symbol's look, a drawing or an icon where it has one.
 */

const SKULL = ['8001', ...Array(14).fill('0000'), '8001'];
const SYMBOLS = new Map<string, ThrowSymbol>([
  ['hit', { id: 'hit', mark: '✶' }],
  ['skull', { id: 'skull', mark: 'S', drawn: SKULL }],
  ['ghost', { id: 'ghost', mark: 'G', icon: 'ghost' }],
]);

describe('a face as printed', () => {
  it('is its words whole on a die with no symbols, nothing for none', () => {
    expect(labelParts({ text: '17' }, SYMBOLS)).toEqual([{ text: '17' }]);
    expect(labelParts({ text: 'apple' }, SYMBOLS)).toEqual([{ text: 'apple' }]);
    expect(labelParts({ text: '' }, SYMBOLS)).toEqual([]);
  });

  it('on a system\'s own die, is its number and then each symbol, by its look', () => {
    expect(labelParts({ text: '+2✶✶', n: 2, s: ['hit', 'hit'] }, SYMBOLS)).toEqual([{ text: '+2' }, { text: '✶' }, { text: '✶' }]);
    expect(labelParts({ text: 'S', s: ['skull'] }, SYMBOLS)).toEqual([{ drawn: SKULL }]);
    expect(labelParts({ text: '✶G', s: ['hit', 'ghost'] }, SYMBOLS)).toEqual([{ text: '✶' }, { icon: 'ghost' }]);
    // A symbol the throw didn't bring a look for still shows something.
    expect(labelParts({ text: '?', s: ['gone'] }, SYMBOLS)).toEqual([{ text: '?' }]);
  });

  it('shares one picture between faces printed alike in one color', () => {
    expect(labelKey([{ text: '6' }], '#00ff00')).toBe(labelKey([{ text: '6' }], '#00ff00'));
    expect(labelKey([{ text: '6' }], '#00ff00')).not.toBe(labelKey([{ text: '6' }], '#ff3300'));
    expect(labelKey([{ text: '6' }], '#00ff00')).not.toBe(labelKey([{ text: '9' }], '#00ff00'));
  });
});
