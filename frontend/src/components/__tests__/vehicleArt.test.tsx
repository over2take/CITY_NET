import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { VehicleArt, ART_KEYS } from '../vehicleArt';

/**
 * The wireframes.
 *
 * Nothing here judges whether a drawing looks like a helicopter — that is what eyes are
 * for. What is worth pinning is the contract the seating diagram depends on: every shape
 * draws something, inside the viewBox the seat anchors are expressed in, in the colour of
 * whatever theme it lands in.
 *
 * The seat markers are placed as percentages of a 0..100 box. A shape that quietly drew
 * itself at some other scale would put every seat in the wrong place, and it would look
 * fine in isolation.
 */

const draw = (layout: string) =>
  render(<svg viewBox="0 0 100 100"><VehicleArt layout={layout} /></svg>).container.querySelector('svg')!;

describe('vehicle wireframes', () => {
  it('has every shape the picker will offer', () => {
    // Ten from the CWN table, eleven with no book behind them.
    expect(ART_KEYS).toHaveLength(21);
    expect(new Set(ART_KEYS).size).toBe(ART_KEYS.length);
  });

  it.each(ART_KEYS)('%s draws something', (layout) => {
    expect(draw(layout).querySelectorAll('path, circle, rect, ellipse').length).toBeGreaterThan(2);
  });

  it.each(ART_KEYS)('%s stays inside the seat anchors\' 0..100 box', (layout) => {
    const svg = draw(layout);
    const coords: number[] = [];

    svg.querySelectorAll('path').forEach((el) => {
      (el.getAttribute('d') ?? '').match(/-?\d+(\.\d+)?/g)?.forEach(n => coords.push(Number(n)));
    });
    svg.querySelectorAll('rect').forEach((el) => {
      coords.push(Number(el.getAttribute('x')) + Number(el.getAttribute('width')));
      coords.push(Number(el.getAttribute('y')) + Number(el.getAttribute('height')));
    });

    // A little overspill is intended — rotor discs and wings reach past the hull — but a
    // shape drawn at the wrong scale entirely shows up here.
    expect(Math.min(...coords)).toBeGreaterThanOrEqual(-10);
    expect(Math.max(...coords)).toBeLessThanOrEqual(110);
  });

  it.each(ART_KEYS)('%s is stroke-only and takes the theme colour', (layout) => {
    const svg = draw(layout);
    svg.querySelectorAll('path, circle, rect, ellipse').forEach((el) => {
      // `currentColor` is the whole reason a wireframe works in every theme. A literal
      // colour would look right in the green one and wrong in the other four.
      expect(el.getAttribute('stroke')).toBe('currentColor');
      expect(el.getAttribute('fill')).toBe('none');
    });
  });

  it('falls back to a car rather than drawing nothing', () => {
    // A vehicle joins the roster the moment it has an HP maximum, hull shape or not.
    expect(draw('nonsense').innerHTML).toBe(draw('car').innerHTML);
  });
});
