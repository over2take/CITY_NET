import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const layouts = require('../sheets/vehicleLayouts.js');

/**
 * The seat ids exist twice: here, where seating is validated, and in the frontend, where
 * the diagram is drawn. A seat the window offers but the server rejects is a control that
 * fails when used — the same shape of bug as a roll button with no roll behind it.
 */

const frontendSrc = fs.readFileSync(
  path.join(import.meta.dirname, '..', '..', 'frontend', 'src', 'sheets', 'vehicleLayouts.ts'),
  'utf8'
);

/** Seat ids per layout, read out of the frontend source one line at a time. */
const frontendSeats = () => {
  const out = {};
  let current = null;
  for (const line of frontendSrc.split(/\r?\n/)) {
    const layout = /^\s{2}(\w+):\s*\{/.exec(line);
    if (layout && layouts.LAYOUTS[layout[1]]) { current = layout[1]; out[current] = []; continue; }
    const seat = /\{\s*id:\s*'([a-z_]+)',\s*label:/.exec(line);
    if (seat && current) out[current].push(seat[1]);
  }
  return out;
};

describe('vehicle seat layouts', () => {
  it('offers the same seats on both sides', () => {
    const front = frontendSeats();
    expect(Object.keys(front).sort()).toEqual(Object.keys(layouts.LAYOUTS).sort());
    for (const [id, layout] of Object.entries(layouts.LAYOUTS)) {
      expect(front[id], `${id} seats disagree`).toEqual(layout.seats);
    }
  });

  it('seats a bike for two and a car for five', () => {
    // The whole point of layouts: a motorcycle must not show four empty doors.
    expect(layouts.LAYOUTS.bike.seats).toHaveLength(2);
    expect(layouts.LAYOUTS.car.seats).toHaveLength(5);
  });

  it('treats a vehicle with no layout as a car', () => {
    // Every vehicle that existed before layouts did, which is all of them.
    expect(layouts.seatsFor({}, 1)).toEqual(layouts.LAYOUTS.car.seats);
    expect(layouts.getLayout('nonsense').seats).toEqual(layouts.LAYOUTS.car.seats);
  });

  it('reads the layout off the vehicle it belongs to', () => {
    const data = { vehicle1_layout: 'bike', vehicle2_layout: 'van' };
    expect(layouts.seatsFor(data, 1)).toEqual(layouts.LAYOUTS.bike.seats);
    expect(layouts.seatsFor(data, 2)).toEqual(layouts.LAYOUTS.van.seats);
  });

  it('knows which seats a vehicle actually has', () => {
    const data = { vehicle1_layout: 'bike' };
    expect(layouts.hasSeat(data, 1, 'pillion')).toBe(true);
    // A bike has no back seats, which is what stops five people boarding one.
    expect(layouts.hasSeat(data, 1, 'back_left')).toBe(false);
    expect(layouts.hasSeat(data, 1, '')).toBe(false);
  });

  it('ignores case and padding, since the seat arrives over a socket', () => {
    expect(layouts.hasSeat({}, 1, '  DRIVER ')).toBe(true);
  });
});
