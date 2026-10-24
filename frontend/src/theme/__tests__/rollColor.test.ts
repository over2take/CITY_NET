import { describe, it, expect } from 'vitest';
import { themedRollColor, readableOn, contrast, MIN_CONTRAST } from '../rollColor';
import { THEMES } from '../themes';

describe('a roll\'s color in the theme', () => {
  it('follows the theme for the usual green and the server\'s failure red, and keeps a chosen color', () => {
    for (const theme of Object.values(THEMES)) {
      // A token with no color chosen, or the server's success, either way it writes it.
      for (const green of ['#00ff00', '#00FF00', '#0f0', ' #00ff00 ', '', null, undefined]) expect(themedRollColor(green, theme), `${theme.id} ${green}`).toBe(theme.primary);
      for (const red of ['#ff3333', '#FF3333', '#f33']) expect(themedRollColor(red, theme), theme.id).toBe(theme.danger);
      // Bright picked colors read on every theme, and stay exactly as picked.
      for (const chosen of ['#ff00ff', '#2ed142', '#eeff00', '#00ccff', '#bb66ff']) expect(themedRollColor(chosen, theme), `${theme.id} ${chosen}`).toBe(chosen);
    }
  });

  it('lifts a dark picked color until it reads on the theme, keeping its hue (2026-10-23)', () => {
    for (const theme of Object.values(THEMES)) {
      for (const dark of ['#3749c8', '#0037ff', '#3342cc', '#123456', '#000000']) {
        const shown = themedRollColor(dark, theme);
        expect(contrast(shown, theme.background), `${theme.id} ${dark}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
        expect(shown, `${theme.id} ${dark}`).not.toBe(dark);
      }
      // A blue stays a blue: its blue channel still leads.
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(themedRollColor('#3749c8', theme).slice(i, i + 2), 16));
      expect(b, theme.id).toBeGreaterThan(r);
      expect(b, theme.id).toBeGreaterThan(g);
    }
  });

  it('lifts only as far as it needs, and leaves what it can\'t read alone', () => {
    const lifted = readableOn('#3749c8', '#010502');
    // Just past what reads, not washed out toward white.
    expect(contrast(lifted, '#010502')).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(contrast(lifted, '#010502')).toBeLessThan(MIN_CONTRAST + 1);
    expect(readableOn('rgb(10, 10, 10)', '#010502')).toBe('rgb(10, 10, 10)');
    expect(readableOn('#123456', 'transparent')).toBe('#123456');
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });
});
