import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { createRequire } from 'module';
import { CONDITION_ICONS, CONDITION_ICON_IDS, isUploadedIcon, isDrawnIcon } from '../conditionIcons';
import { ConditionIcon } from '../../components/ConditionIcon';

/**
 * The 24 condition icons drawn for CITY_NET (4e1b). Decided with the user 2026-10-09: the mockup's
 * drawings kept as the defaults, ours to use, with the four first sketched too close to Feather's
 * redrawn. Drawn in the theme's color only, so they work in all seven themes.
 */

const { ICONS } = createRequire(import.meta.url)('../../../../backend/systemBuilder/conditions.js');
afterEach(cleanup);

/** Feather's own path data for the four icons the first sketches followed (MIT, not ours to copy unmarked). */
const FEATHER = [
  'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z', // eye
  'M9 18V5l12-2v13', // music
  '13 2 3 14 12 14 11 22 21 10 12 10 13 2', // zap
  'M5 12H2a10 10 0 0 0 20 0h-3', // anchor
];

describe('the drawn icons', () => {
  it('are the server\'s 24, in its order', () => {
    expect(CONDITION_ICON_IDS).toEqual(ICONS);
  });

  it('are path data alone, each a drawing of its own', () => {
    const seen = new Set<string>();
    for (const id of CONDITION_ICON_IDS) {
      const paths = CONDITION_ICONS[id];
      expect(paths.length, id).toBeGreaterThan(0);
      for (const d of paths) expect(d, id).toMatch(/^M[-\d. ]/);
      const whole = paths.join(' ');
      expect(seen.has(whole), id).toBe(false);
      seen.add(whole);
    }
  });

  it('copy none of Feather\'s paths', () => {
    const all = CONDITION_ICON_IDS.flatMap((id) => [...CONDITION_ICONS[id]]);
    for (const f of FEATHER) expect(all.some((d) => d.replace(/[A-Za-z,]/g, ' ').trim() === f.replace(/[A-Za-z,]/g, ' ').trim()), f).toBe(false);
  });

  it('draw in the theme\'s color only: stroked in currentColor, never filled', () => {
    for (const id of CONDITION_ICON_IDS) {
      const { container } = render(<ConditionIcon icon={id} />);
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('stroke'), id).toBe('currentColor');
      expect(svg.getAttribute('fill'), id).toBe('none');
      expect(svg.querySelectorAll('path').length, id).toBe(CONDITION_ICONS[id].length);
      expect(container.innerHTML, id).not.toMatch(/#[0-9a-f]{3,6}|rgb\(/i);
      cleanup();
    }
  });
});

describe('an icon by its name', () => {
  const UPLOADED = `/uploads/condition_icons/${'b'.repeat(64)}.svg`;

  it('draws an uploaded one as a picture, through <img> only', () => {
    const { container } = render(<ConditionIcon icon={UPLOADED} title="Glitching" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('img')!.getAttribute('src')).toBe(UPLOADED);
    expect(container.querySelector('img')!.getAttribute('alt')).toBe('Glitching');
  });

  it('draws the target for anything it doesn\'t know, so a broken reference still shows a mark', () => {
    for (const icon of ['eye', '/uploads/currency_icons/x.png', 'javascript:alert(1)', '']) {
      const { container } = render(<ConditionIcon icon={icon} />);
      expect(container.querySelector('img'), icon).toBeNull();
      expect(container.querySelectorAll('path').length, icon).toBe(CONDITION_ICONS.target.length);
      cleanup();
    }
  });

  it('tells a drawn one from an uploaded one as the server does', () => {
    expect(isUploadedIcon(UPLOADED)).toBe(true);
    expect(isUploadedIcon(`/uploads/condition_icons/../${'b'.repeat(64)}.svg`)).toBe(false);
    expect(isDrawnIcon('snow')).toBe(true);
    expect(isDrawnIcon('toString')).toBe(false);
  });
});
