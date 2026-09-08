import { describe, it, expect } from 'vitest';
import { getImporter, IMPORTERS } from '../sheets/importers.js';
import { LAYOUTS } from '../sheets/pdfTemplate.js';

/**
 * The inventory on the way in.
 *
 * It is one field holding a JSON array, and it arrives two ways: as JSON when a sheet is
 * exported and read back, and as a written line when somebody fills in a printed form -
 * a paper form cannot print rows.
 *
 * The field is on every system, so this walks all three importers rather than trusting
 * that wiring one wired the others.
 */

const map = (system, raw) => getImporter(system).mapFields(raw);
const items = (result) => JSON.parse(result.mapped.inventory);

const SYSTEMS = Object.keys(IMPORTERS);

describe('a written-out inventory', () => {
  it('splits a line into rows', () => {
    const out = map('cities_without_number', { Inventory: 'Rope, Medkit; Rations' });
    expect(items(out).map((i) => i.name)).toEqual(['Rope', 'Medkit', 'Rations']);
  });

  it('reads a leading quantity', () => {
    expect(items(map('cities_without_number', { Inventory: '3x Stim' })))
      .toEqual([{ name: 'Stim', qty: 3, enc: '', bundled: false, carry: 'stowed', location: '' }]);
  });

  it('reads a trailing quantity too, since forms are written both ways', () => {
    expect(items(map('cities_without_number', { Inventory: 'Stim x3' }))[0])
      .toMatchObject({ name: 'Stim', qty: 3 });
  });

  it('leaves a number that is part of the name alone', () => {
    // "9mm rounds" is one thing called 9mm, not nine of something called mm.
    const [row] = items(map('cities_without_number', { Inventory: '9mm rounds' }));
    expect(row).toMatchObject({ name: '9mm rounds', qty: 1 });
  });

  it('files what it reads as stowed, not stashed', () => {
    // Stashed costs no Encumbrance and is not on the character. A form listing what
    // somebody carries is not making that claim, so the safer reading is that it is packed.
    expect(items(map('cities_without_number', { Inventory: 'Rope' }))[0].carry).toBe('stowed');
  });

  it('drops an inventory of nothing rather than storing an empty list', () => {
    expect(map('cities_without_number', { Inventory: ' , ; ' }).mapped.inventory).toBeUndefined();
  });
});

describe('a sheet read back', () => {
  it('round-trips the rows it wrote, Encumbrance and carry state included', () => {
    const stored = [
      { name: 'Ammunition', qty: 4, enc: '1', bundled: true, carry: 'stowed', location: '' },
      { name: 'Spare rifle', qty: 1, enc: '2', bundled: false, carry: 'stash', location: 'the boot' },
    ];
    const out = map('cities_without_number', { inventory: JSON.stringify(stored) });
    expect(items(out)).toEqual(stored);
  });

  it('falls back to reading it as a line when the JSON is broken', () => {
    const out = map('cities_without_number', { inventory: '[{"name": "Rope"' });
    // Not silently dropped: something was typed, and the user gets it back as a row to fix.
    expect(items(out)[0].name).toContain('Rope');
  });

  it('refuses a JSON array of things that are not rows', () => {
    expect(map('cities_without_number', { inventory: '["Rope", 3]' }).mapped.inventory)
      .toBeUndefined();
  });
});

describe('every system, not just the one that grew it', () => {
  it.each(SYSTEMS)('%s maps an inventory line', (system) => {
    expect(items(map(system, { Inventory: '2x Stim' }))[0]).toMatchObject({ name: 'Stim', qty: 2 });
  });

  it.each(SYSTEMS)('%s still imports the retired Gear box', (system) => {
    // Retired on the sheet, but a form prints it and older sheets have text in it. The
    // field is kept and shown while it has content, so the way in has to stay open.
    expect(map(system, { Gear: 'A photo of her daughter' }).mapped.gear_notes)
      .toBe('A photo of her daughter');
  });
});

describe('the printed form', () => {
  it.each(['cyberpunk_red', 'cities_without_number'])('%s prints an Inventory box', (system) => {
    const printed = LAYOUTS[system].flatMap((s) => s.fields);
    expect(printed).toContain('Inventory');
  });
});

describe('the two hand-totalled Enc boxes that are gone', () => {
  it('no longer map onto fields the sheet does not draw', () => {
    const out = map('cities_without_number', { GearEncReadied: '3', GearEncStowed: '5' });
    expect(out.mapped.gear_enc_readied).toBeUndefined();
    expect(out.mapped.gear_enc_stowed).toBeUndefined();
    // Reported rather than swallowed, so whoever filled the form is told why.
    expect(Object.keys(out.unmapped)).toEqual(['GearEncReadied', 'GearEncStowed']);
  });
});
