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
    // A row stored before placement was recorded, so `placed` is inferred the way it used
    // to be: an unpaired type with no side was installed. A row that says `placed` gets
    // what it says, and the importers set it explicitly — see the placement tests.
    const data = { cyberware: [{ name: 'Kerenzikov', type: 'neural', hl: 7, cost: 500, conc: '', data: '+2 init' }] };
    expect(cyberware.rows(data)).toEqual([
      { name: 'Kerenzikov', type: 'neural', side: null, hl: 7, cost: 500, conc: '', data: '+2 init', equipped: true, placed: true, mods: [] },
    ]);
  });

  it('fills in every field, so nothing downstream has to check', () => {
    expect(cyberware.rows({ cyberware: [{ name: 'Bare' }] })).toEqual([
      { name: 'Bare', type: '', side: null, hl: 0, cost: null, conc: '', data: '', equipped: true, placed: false, mods: [] },
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

  it('does not turn an unpriced piece into a free one', () => {
    // Number(null) is 0 and Number('') is 0, so checking finiteness after the conversion
    // silently prices everything nobody priced at nothing — and then sorts it as the
    // cheapest thing on the sheet.
    const out = cyberware.rows({
      cyberware: [{ cost: null }, { cost: undefined }, { cost: '' }, { cost: 0 }, { cost: '500' }],
    });
    expect(out.map((r) => r.cost)).toEqual([null, null, null, 0, 500]);
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

describe('fromNotes', () => {
  it('gets the pieces back out of the line this replaced', () => {
    const out = cyberware.fromNotes('Cybereye (Low Light), Neural Link, Subdermal Grip');
    expect(out.map((r) => r.name)).toEqual(['Cybereye (Low Light)', 'Neural Link', 'Subdermal Grip']);
  });

  it('keeps a parenthetical with its piece', () => {
    // "Cybereye (Low Light)" is one thing somebody wrote. Reading it as two loses which
    // eye the low light was in, and invents a piece they never had.
    const out = cyberware.fromNotes('Cybereye (Low Light)');
    expect(out).toHaveLength(1);
  });

  it('leaves everything unfiled and unpriced, because the line said nothing else', () => {
    const out = cyberware.fromNotes('Neural Link');
    expect(out[0]).toEqual({ name: 'Neural Link', type: '', side: null, hl: 0, cost: null, conc: '', data: '', equipped: true, placed: false, mods: [] });
  });

  it('ignores empty gaps rather than making blank rows', () => {
    expect(cyberware.fromNotes('A,, ,B')).toHaveLength(2);
    expect(cyberware.fromNotes('')).toEqual([]);
    expect(cyberware.fromNotes(undefined)).toEqual([]);
  });
});

describe('fromFormFields', () => {
  it('gathers the printed form\'s numbered boxes into rows', () => {
    const out = cyberware.fromFormFields({
      cyber1_name: 'Kerenzikov', cyber1_type: 'neural', cyber1_hl: '7',
      cyber1_cost: '500', cyber1_data: '+2 init',
    });
    expect(out).toEqual([
      { name: 'Kerenzikov', type: 'neural', side: null, hl: 7, cost: 500, conc: '', data: '+2 init', equipped: true, placed: false, mods: [] },
    ]);
  });

  it('skips the lines nobody filled in', () => {
    // A form is printed with every line on it. An empty line is not a piece of chrome.
    const out = cyberware.fromFormFields({ cyber1_name: 'A', cyber4_name: 'B', cyber2_hl: '3' });
    expect(out.map((r) => r.name)).toEqual(['A', 'B']);
  });

  it('leaves a piece unpriced rather than free when the box is blank', () => {
    const out = cyberware.fromFormFields({ cyber1_name: 'A' });
    expect(out[0].cost).toBeNull();
    expect(out[0].hl).toBe(0);
  });

  it('knows its own transport fields from real sheet data', () => {
    // These are dropped after gathering. Matching too widely would delete sheet data.
    expect(cyberware.isFormField('cyber1_name')).toBe(true);
    expect(cyberware.isFormField('cyber12_cost')).toBe(true);
    expect(cyberware.isFormField('cyberware')).toBe(false);
    expect(cyberware.isFormField('cyberware_notes')).toBe(false);
    expect(cyberware.isFormField('cyberdeck_name')).toBe(false);
  });

  describe('modifiers', () => {
    // The one mechanically real thing an export carries. Descriptions arrive blank because
    // the Companion renders flavour text from its own catalogue, but a modifier is
    // something the player typed into their own character, so it is really there.
    const modifier = {
      modifyStatsBy: { Cool: 3 },
      setStatsTo: {},
      setSkillTo: {},
      modifyRollTypesBy: {},
      modifySkillsBy: { Business: 6 },
    };

    it('flattens the five buckets into one list', () => {
      expect(cyberware.modsFromCompanion(modifier)).toEqual([
        { kind: 'stat', target: 'Cool', value: 3 },
        { kind: 'skill', target: 'Business', value: 6 },
      ]);
    });

    it('keeps setting a value apart from adjusting one', () => {
      // +3 Cool and "Cool becomes 3" are different claims about the character, and a piece
      // that did one when the player meant the other is wrong in a way nobody would notice.
      const out = cyberware.modsFromCompanion({ setStatsTo: { Cool: 3 }, modifyStatsBy: { Cool: 3 } });
      expect(out.map((m) => m.kind).sort()).toEqual(['stat', 'statSet']);
    });

    it('reads a piece that has none, which is most of them', () => {
      expect(cyberware.modsFromCompanion(undefined)).toEqual([]);
      expect(cyberware.modsFromCompanion({ modifyStatsBy: {}, setStatsTo: {} })).toEqual([]);
    });

    it('carries them through an import onto the row', () => {
      const out = cyberware.fromCompanion({
        a: { type: 'EMPThreading', name: '', humanityLoss: 0, modifier },
        b: { type: 'SelfICE', name: '', humanityLoss: 3 },
      });
      expect(out[0].mods).toHaveLength(2);
      expect(out[1].mods).toEqual([]);
    });

    it('drops a modifier with nothing to modify', () => {
      // A blank line somebody added and never filled in. It can be neither shown nor
      // applied, so storing it only makes the row look like it does something.
      expect(cyberware.normaliseMods([{ kind: 'stat', target: '  ', value: 2 }])).toEqual([]);
    });

    it('keeps a modifier parked at zero', () => {
      // Unlike an unpriced piece, 0 here is a real answer: a player can leave one at zero
      // while they decide what it should be.
      expect(cyberware.normaliseMods([{ kind: 'skill', target: 'Brawling', value: 0 }]))
        .toEqual([{ kind: 'skill', target: 'Brawling', value: 0 }]);
    });

    it('survives being stored and read back', () => {
      const rows = cyberware.fromCompanion({ a: { type: 'EMPThreading', modifier } });
      const reread = cyberware.rows(JSON.parse(JSON.stringify({ cyberware: rows })));
      expect(reread).toEqual(rows);
    });

    it('refuses a kind it does not know rather than storing it', () => {
      const out = cyberware.normaliseMods([{ kind: 'setEverything', target: 'Cool', value: 9 }]);
      expect(out[0].kind).toBe('stat');
    });
  });
});
