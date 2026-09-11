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

describe('the CWN form covers the sheet it feeds', () => {
  const boxes = () => LAYOUTS.cities_without_number.flatMap((s) => s.fields);
  const fill = (extra = {}) => map('cities_without_number', {
    ...Object.fromEntries(boxes().map((b) => [b, '1'])), ...extra,
  });

  it('prints every skill, which it never did', () => {
    // A character form with no skill boxes produced a character who could not roll
    // anything. The importer had aliased all of them since it was written.
    const { mapped } = fill();
    for (const id of ['shoot', 'stab', 'punch', 'notice', 'heal', 'fix', 'program', 'talk']) {
      expect(mapped[id], id).toBe(1);
    }
  });

  it('prints as many weapon rows as the sheet holds', () => {
    // It printed four for a sheet with six, so a full rack lost two on the way in.
    const { mapped } = fill();
    expect(mapped.weapon6_name).toBeDefined();
    expect(mapped.weapon6_enc).toBeDefined();
    expect(mapped.weapon6_carry).toBeUndefined(); // '1' is not a carry state; see below
  });

  it('takes a weapon carry state off the form', () => {
    const { mapped } = fill({ Weapon1Carry: 'Readied', Weapon2Carry: 'S' });
    expect(mapped.weapon1_carry).toBe('readied');
    expect(mapped.weapon2_carry).toBe('stowed');
  });

  it('gathers the stash boxes into the array the sheet keeps', () => {
    const { mapped } = map('cities_without_number', {
      Stash1Name: 'Combat Rifle', Stash1Dmg: '1d12', Stash1Skill: 'Shoot',
      Stash1Enc: '2', Stash1Location: 'the Kestrel',
      Stash2Name: 'Monoblade', Stash2Dmg: '1d8',
    });
    const stash = JSON.parse(mapped.weapons_stash);
    expect(stash).toHaveLength(2);
    expect(stash[0]).toMatchObject({ name: 'Combat Rifle', enc: '2', location: 'the Kestrel' });
    // The transport boxes are dropped once gathered - they are not sheet fields.
    expect(Object.keys(mapped).some((k) => k.startsWith('stash1_'))).toBe(false);
  });

  it('skips an empty stash line rather than storing a nameless weapon', () => {
    const { mapped } = map('cities_without_number', {
      Stash1Name: 'Shotgun', Stash2Name: '', Stash2Dmg: '1d6',
    });
    expect(JSON.parse(mapped.weapons_stash)).toHaveLength(1);
  });

  it('leaves a stash that arrived as JSON alone', () => {
    // A sheet round-trip carries the real array, with the atk and mods a form cannot hold.
    const real = JSON.stringify([{ name: 'Laser', dmg: '1d10', atk: 2, mods: '["scope"]' }]);
    const { mapped } = map('cities_without_number', { weapons_stash: real, Stash1Name: 'Shotgun' });
    expect(JSON.parse(mapped.weapons_stash)[0]).toMatchObject({ name: 'Laser', atk: 2 });
  });

  it('takes the fields added since the form was last regenerated', () => {
    const { mapped } = fill();
    for (const id of ['xp', 'aliases', 'move_mod', 'armor_enc', 'frail', 'auto_initiative',
      'cast_skill', 'summon_skill', 'spell1_name', 'vehicle6_name', 'vehicle1_pow']) {
      expect(mapped[id], id).toBeDefined();
    }
  });

  it('does not print what is running in a character\'s bloodstream', () => {
    // Doses are inventory rows and import as such. Which drug somebody is high on at the
    // moment they fill in a form is not a fact a form should carry.
    expect(boxes()).not.toContain('Pharmaceuticals');
    expect(fill().mapped.pharma_active).toBeUndefined();
  });
});

describe('the CWN cyberware table', () => {
  // Ported from Cyberpunk's rather than invented: both games store a piece as the same
  // kind of row, so the same gatherer reads both forms. Only two columns differ - STRAIN
  // is what Cyberpunk calls Humanity Loss, and CONC is CWN's alone.
  const cyberware = require('../sheets/cyberware.js');

  const form = {
    Cyber1Name: 'Cranial Jack', Cyber1Type: 'head', Cyber1Strain: '0.25',
    Cyber1Cost: '1000', Cyber1Conc: 'touch', Cyber1Effect: 'A socket behind the ear',
    Cyber2Name: 'Dermal Armor', Cyber2Type: 'body', Cyber2Strain: '2', Cyber2Conc: 'obvious',
  };

  it('prints twelve lines on the form', () => {
    const boxes = LAYOUTS.cities_without_number.flatMap((s) => s.fields);
    expect(boxes).toContain('Cyber1Name');
    expect(boxes).toContain('Cyber12Effect');
    expect(boxes.filter((b) => /^Cyber\d+Name$/.test(b))).toHaveLength(12);
  });

  it('maps every column the form prints', () => {
    const { mapped, unmapped } = map('cities_without_number', form);
    expect(unmapped).toEqual({});
    expect(mapped).toMatchObject({
      cyber1_name: 'Cranial Jack', cyber1_type: 'head', cyber1_hl: '0.25',
      cyber1_cost: '1000', cyber1_conc: 'touch',
    });
  });

  it('gathers the boxes into rows the sheet can actually read', () => {
    // `cyberware.rows` wants a real array, not a JSON string - which is why this is
    // gathered in the socket like Cyberpunk's rather than in the mapper like the stash.
    const { mapped } = map('cities_without_number', form);
    const rows = cyberware.fromFormFields(mapped);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      name: 'Cranial Jack', type: 'head', hl: 0.25, cost: 1000, conc: 'touch',
    });
    expect(cyberware.rows({ cyberware: rows })).toHaveLength(2);
  });

  it('carries the concealment rating Cyberpunk has no column for', () => {
    const rows = cyberware.fromFormFields(map('cities_without_number', form).mapped);
    expect(rows[1].conc).toBe('obvious');
  });

  it('leaves a piece unplaced, because the form has no column for which arm', () => {
    const rows = cyberware.fromFormFields(map('cities_without_number', form).mapped);
    expect(rows.every((r) => r.placed === false)).toBe(true);
  });

  it('skips an empty line rather than storing a nameless implant', () => {
    const rows = cyberware.fromFormFields({ cyber1_name: 'Skinmod', cyber2_hl: '1' });
    expect(rows).toHaveLength(1);
  });

  it('still recognises Cyberpunk\'s own labels for the shared columns', () => {
    // The CP:R form says HL and Eddies where CWN says Strain and Cost. Both have to keep
    // landing in the same two fields, or one game's form breaks to fix the other's.
    const { mapped } = map('cyberpunk_red', { Cyber1Name: 'Kerenzikov', Cyber1HL: '7', Cyber1Eddies: '500' });
    expect(mapped).toMatchObject({ cyber1_name: 'Kerenzikov', cyber1_hl: '7', cyber1_cost: '500' });
  });

  it('keeps the free-text Cyberware box, which CWN still draws', () => {
    // Cyberpunk dropped that field from its template and turns the line into rows. CWN
    // has a CYBERWARE NOTES section, so a line about your chrome stays a line.
    expect(map('cities_without_number', { Cyberware: 'twitchy since the surgery' })
      .mapped.cyberware_notes).toBe('twitchy since the surgery');
  });
});
