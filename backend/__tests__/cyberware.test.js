/**
 * Cyberware rows, and the import that never worked.
 *
 * The fixture here is shaped from a real Companion export (code DSBJEF, 8 pieces), which
 * matters more than usual: the previous fixture invented a populated `name` field, the
 * test passed on it, and the feature imported nothing at all from a real character —
 * because real exports leave `name` empty and put the identity in `type`. A fixture that
 * flatters the code is worse than no fixture.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const cyberware = require('../sheets/cyberware.js');

/** Eight entries, copied in shape from the real export. */
const COMPANION = {
  'id-1': { name: '', type: 'LightTattoo', humanityLoss: 0, humanityLossApplied: true, equipped: true, description: '' },
  'id-2': { name: '', type: 'EMPThreading', humanityLoss: 0, humanityLossApplied: true, equipped: true, description: '' },
  'id-3': { name: '', type: 'SelfICE', humanityLoss: 3, humanityLossApplied: true, equipped: true, description: '' },
  'id-4': { name: '', type: 'NeuroportCyberdeckPort', humanityLoss: 3, humanityLossApplied: true, equipped: true, description: '' },
  'id-5': { name: '', type: 'Neuroport', humanityLoss: 0, humanityLossApplied: true, equipped: true, description: '' },
  'id-6': { name: '', type: 'Custom', humanityLoss: 0, humanityLossApplied: true, equipped: true, description: '' },
};

describe('humanise', () => {
  it('turns a catalogue key into words', () => {
    expect(cyberware.humanise('LightTattoo')).toBe('Light Tattoo');
    expect(cyberware.humanise('NeuroportCyberdeckPort')).toBe('Neuroport Cyberdeck Port');
  });

  it('keeps an acronym together', () => {
    // The reason this is not one split on every capital. EMPThreading is EMP, not E M P.
    expect(cyberware.humanise('EMPThreading')).toBe('EMP Threading');
    expect(cyberware.humanise('SelfICE')).toBe('Self ICE');
  });

  it('leaves a single word alone', () => {
    expect(cyberware.humanise('Custom')).toBe('Custom');
    expect(cyberware.humanise('Neuroport')).toBe('Neuroport');
  });

  it('copes with nothing', () => {
    expect(cyberware.humanise('')).toBe('');
    expect(cyberware.humanise(undefined)).toBe('');
  });
});

describe('fromCompanion', () => {
  it('imports every piece, from `type` rather than the empty `name`', () => {
    // The bug this exists for: reading `name` returns nothing for a character with eight
    // pieces of chrome, and the old test never noticed because its fixture had names.
    const out = cyberware.fromCompanion(COMPANION);
    expect(out).toHaveLength(6);
    expect(out.map((r) => r.name)).toEqual([
      'Light Tattoo', 'EMP Threading', 'Self ICE',
      'Neuroport Cyberdeck Port', 'Neuroport', 'Custom',
    ]);
  });

  it('brings the humanity cost across rather than leaving it to be typed', () => {
    const out = cyberware.fromCompanion(COMPANION);
    expect(out.find((r) => r.name === 'Self ICE').hl).toBe(3);
    expect(out.find((r) => r.name === 'Neuroport Cyberdeck Port').hl).toBe(3);
    expect(cyberware.humanityLoss(out)).toBe(6);
  });

  it('prefers a label the player actually set', () => {
    const out = cyberware.fromCompanion({
      x: { name: 'Lucy special', type: 'Custom', humanityLoss: 4 },
    });
    expect(out[0].name).toBe('Lucy special');
  });

  it('files nothing, because the export says nothing about where it went', () => {
    // Every imported row is unfiled on purpose. Guessing a location puts chrome in the
    // wrong arm, and the window has somewhere to show them until a person decides.
    const out = cyberware.fromCompanion(COMPANION);
    expect(out.every((r) => r.type === '' && r.side === null)).toBe(true);
  });

  it('reads collections keyed by uuid, which is how they arrive', () => {
    expect(cyberware.fromCompanion(COMPANION)).toHaveLength(6);
  });

  it('is empty rather than broken when there is no cyberware', () => {
    expect(cyberware.fromCompanion(undefined)).toEqual([]);
    expect(cyberware.fromCompanion({})).toEqual([]);
    expect(cyberware.fromCompanion('nonsense')).toEqual([]);
  });
});

describe('rows', () => {
  it('reads what a sheet holds', () => {
    const data = { cyberware: [{ name: 'Kerenzikov', type: 'neural', hl: 7, cost: 500, data: '+2 init' }] };
    expect(cyberware.rows(data)).toEqual([
      { name: 'Kerenzikov', type: 'neural', side: null, hl: 7, cost: 500, data: '+2 init' },
    ]);
  });

  it('fills in every field, so nothing downstream has to check', () => {
    expect(cyberware.rows({ cyberware: [{ name: 'Bare' }] })).toEqual([
      { name: 'Bare', type: '', side: null, hl: 0, cost: null, data: '' },
    ]);
  });

  it('survives a sheet that holds something else entirely', () => {
    // The field is free-form JSON on a sheet people import into and edit by hand. A window
    // that throws on a malformed sheet is worse than one showing an empty list.
    for (const bad of [undefined, {}, { cyberware: null }, { cyberware: 'text' }, { cyberware: 42 }]) {
      expect(cyberware.rows(bad), JSON.stringify(bad)).toEqual([]);
    }
    expect(cyberware.rows({ cyberware: [null, 'x', { name: 'Real' }] })).toHaveLength(1);
  });

  it('leaves an unpriced piece blank rather than calling it free', () => {
    // Humanity loss defaults to 0 because an import always states it. Eddies are never in
    // an export and are often not known, and a column of zeroes hides which is which.
    const out = cyberware.rows({ cyberware: [{ name: 'A' }, { name: 'B', cost: 0 }, { name: 'C', cost: 500 }] });
    expect(out.map((r) => r.cost)).toEqual([null, 0, 500]);
  });

  it('only accepts a side it knows', () => {
    const out = cyberware.rows({ cyberware: [{ side: 'l' }, { side: 'r' }, { side: 'up' }] });
    expect(out.map((r) => r.side)).toEqual(['l', 'r', null]);
  });

  it('does not let a nonsense cost poison the total', () => {
    const out = cyberware.rows({ cyberware: [{ hl: 5 }, { hl: 'lots' }, { hl: null }] });
    expect(cyberware.humanityLoss(out)).toBe(5);
  });
});
