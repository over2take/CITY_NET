/**
 * The two tables that had never been transcribed: armor (CWN p53) and Common Operator
 * Gear (p50).
 *
 * Checked against the book rather than against themselves. A catalogue test that only
 * asserts the file parses is worth nothing - the failure mode here is a price or an AC
 * typed wrong once and then trusted forever, so the assertions below are the book's own
 * figures, read off the page.
 */

import { describe, it, expect } from 'vitest';
import {
  CWN_ARMOR, CWN_ARMOR_BY_ID, OBSOLETE_TECH, acText, type ArmorPreset,
} from '../cwnArmorPresets';
import { CWN_GEAR, CWN_GEAR_BY_ID, encText } from '../cwnGearPresets';

describe('the armor table, p53', () => {
  it('has every row the book prints, and no more', () => {
    // Eight civilian, three suits, three accessories. The fifteenth row on the page is
    // Obsolete Tech, which is a discount rather than an item - see below.
    expect(CWN_ARMOR).toHaveLength(14);
    const byGroup = (g: ArmorPreset['group']) => CWN_ARMOR.filter((a) => a.group === g).length;
    expect(byGroup('civilian')).toBe(8);
    expect(byGroup('suit')).toBe(3);
    expect(byGroup('accessory')).toBe(3);
  });

  it('gives every piece a unique id', () => {
    expect(CWN_ARMOR_BY_ID.size).toBe(CWN_ARMOR.length);
  });

  it('matches the book row by row', () => {
    // Spread across the table deliberately: one cheap, one mid, one heavy, one accessory,
    // and the one whose numbers run against the trend.
    expect(CWN_ARMOR_BY_ID.get('ordinary_clothing')).toMatchObject(
      { rangedAc: 10, meleeAc: 10, soak: 0, enc: 0, cost: 25, subtle: true },
    );
    expect(CWN_ARMOR_BY_ID.get('war_harness')).toMatchObject(
      { rangedAc: 13, meleeAc: 14, soak: 5, enc: 1, cost: 200, subtle: false },
    );
    expect(CWN_ARMOR_BY_ID.get('plated_longcoat')).toMatchObject(
      { rangedAc: 17, meleeAc: 15, soak: 5, enc: 3, traumaTargetMod: 1, cost: 2000, heavy: true },
    );
    expect(CWN_ARMOR_BY_ID.get('heavy_armored_suit')).toMatchObject(
      { rangedAc: 20, meleeAc: 18, soak: 15, enc: 3, traumaTargetMod: 3, cost: 20000, rare: true, heavy: true },
    );
    expect(CWN_ARMOR_BY_ID.get('riot_shield')).toMatchObject(
      { rangedAc: 2, meleeAc: 4, soak: 0, enc: 2, cost: 1000 },
    );
    // The Impact Jacket trades ranged AC away for soak - the one row where a reader
    // skimming for "bigger is later" would mistype it.
    expect(CWN_ARMOR_BY_ID.get('impact_jacket')).toMatchObject(
      { rangedAc: 12, meleeAc: 14, soak: 8, cost: 1000 },
    );
  });

  it('marks all three suits as needing a contact', () => {
    // The book's @ is on every suit row and on nothing else.
    const rare = CWN_ARMOR.filter((a) => a.rare).map((a) => a.id);
    expect(rare.sort()).toEqual(
      ['heavy_armored_suit', 'light_armored_suit', 'medium_armored_suit'],
    );
  });

  it('marks exactly the heavy pieces heavy', () => {
    const heavy = CWN_ARMOR.filter((a) => a.heavy).map((a) => a.id);
    expect(heavy.sort()).toEqual(
      ['absorption_plates', 'heavy_armored_suit', 'joint_reinforcement', 'plated_longcoat'],
    );
  });

  it('keeps NS to accessories, where it means anything', () => {
    // "Cannot be added to suit armor" is only a sentence about an accessory.
    for (const a of CWN_ARMOR) {
      if (a.noSuit) expect(a.group, a.id).toBe('accessory');
    }
  });

  it('prints an accessory as a bonus and armor as a value', () => {
    // The distinction the shelf lives on: +4 melee from a shield is not melee AC 4.
    expect(acText(CWN_ARMOR_BY_ID.get('riot_shield')!, 'melee')).toBe('+4');
    expect(acText(CWN_ARMOR_BY_ID.get('war_harness')!, 'melee')).toBe('14');
  });

  it('keeps Obsolete Tech off the shelf', () => {
    // It is half price with penalties ROLLED AFTER the sale, so nothing can say in advance
    // what it is selling. A BUY button for it would be a button that cannot describe
    // its own product.
    expect(CWN_ARMOR.some((a) => a.label === OBSOLETE_TECH.label)).toBe(false);
    expect(OBSOLETE_TECH.costMultiplier).toBe(0.5);
  });
});

describe('the gear table, p50', () => {
  it('has every row the book prints', () => {
    expect(CWN_GEAR).toHaveLength(27);
    expect(CWN_GEAR_BY_ID.size).toBe(27);
  });

  it('matches the book on price and encumbrance', () => {
    expect(CWN_GEAR_BY_ID.get('hearing_protection')).toMatchObject({ cost: 250, enc: 1 });
    expect(CWN_GEAR_BY_ID.get('ammo_round')).toMatchObject({ cost: 1, encNote: 'trivial' });
    expect(CWN_GEAR_BY_ID.get('climbing_kit')).toMatchObject({ cost: 150, enc: 2 });
    expect(CWN_GEAR_BY_ID.get('clothing_couture')).toMatchObject({ cost: 10000, encNote: 'worn' });
    expect(CWN_GEAR_BY_ID.get('goggles_ir')).toMatchObject({ cost: 1000, enc: 1 });
    expect(CWN_GEAR_BY_ID.get('kit_cyberdoc')).toMatchObject({ cost: 500, enc: 2 });
    expect(CWN_GEAR_BY_ID.get('radio_tab')).toMatchObject({ cost: 500, enc: 0 });
    expect(CWN_GEAR_BY_ID.get('smartphone_fashionable')).toMatchObject({ cost: 2000, encNote: 'trivial' });
  });

  it('reads a K on the page as thousands', () => {
    // $10K and $1K and $2K are the three rows where a transcription can drop three zeros
    // and still look plausible.
    expect(CWN_GEAR_BY_ID.get('clothing_couture')!.cost).toBe(10000);
    expect(CWN_GEAR_BY_ID.get('gas_mask')!.cost).toBe(1000);
    expect(CWN_GEAR_BY_ID.get('smartphone_fashionable')!.cost).toBe(2000);
  });

  it('prints the Enc column the way the book does, symbols and all', () => {
    expect(encText(CWN_GEAR_BY_ID.get('backpack')!)).toBe('1~');
    expect(encText(CWN_GEAR_BY_ID.get('ammo_round')!)).toBe('*');
    expect(encText(CWN_GEAR_BY_ID.get('smartphone_plan')!)).toBe('—');
    expect(encText(CWN_GEAR_BY_ID.get('climbing_kit')!)).toBe('2');
  });

  it('keeps a symbol row from being read as a measurement', () => {
    // The whole reason enc is a number and the symbol lives apart: `enc` is what the
    // encumbrance sum adds up, and "1~" parses to nothing rather than to an error.
    for (const g of CWN_GEAR) {
      expect(Number.isFinite(g.enc), g.id).toBe(true);
      if (g.encNote === 'service') expect(g.enc).toBe(0);
    }
  });

  it('gives everything a price and a note', () => {
    for (const g of CWN_GEAR) {
      expect(g.cost, g.id).toBeGreaterThan(0);
      expect(g.note.length, g.id).toBeGreaterThan(0);
    }
  });
});
