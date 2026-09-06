import { describe, it, expect } from 'vitest';

const { applyDerived, cwnMoveBonus, CWN_BASE_MOVE } = require('../sheets/templates');

/**
 * Move rate (CWN p34).
 *
 * A flat 10 meters for a normal human - the book derives it from no attribute, which is
 * worth saying because every other number on the STATS block comes off one. What changes
 * it is chrome and the table's own ruling.
 *
 * Displayed, never enforced: the group measures with the ruler tool and respects the
 * number, so nothing here gates movement on the map.
 */

const derive = (data) => {
  const d = { ...data };
  applyDerived('cities_without_number', d);
  return d;
};

const implant = (over = {}) => ({
  name: 'Coordination Augment II', type: 'nerve', side: null, hl: 3,
  placed: true, equipped: true,
  mods: [{ kind: 'note', target: 'Move (meters)', value: 10 }], ...over,
});

describe('what a character can cover in one Move', () => {
  it('gives a normal human ten meters', () => {
    expect(CWN_BASE_MOVE).toBe(10);
    expect(derive({}).move).toBe(10);
  });

  it('takes it from no attribute', () => {
    // Not a derived stat the way saves and modifiers are. A Dex 18 sprinter and a Dex 3
    // one both cover 10 meters, and the sheet should not invent otherwise.
    for (const dex of [3, 10, 18]) expect(derive({ dex, str: dex }).move).toBe(10);
  });

  it('adds the ten meters a Coordination Augment II grants', () => {
    expect(derive({ cyberware: [implant()] }).move).toBe(20);
  });

  it('reads the note the catalogue already wrote, so no sheet needs migrating', () => {
    // Stored as a note because there was no Move field when the catalogue was written.
    // A character who installed this months ago gets the ten meters with no conversion.
    expect(cwnMoveBonus({ cyberware: [implant()] })).toBe(10);
  });

  it('still reads a row written with the older British spelling', () => {
    const old = implant({ mods: [{ kind: 'note', target: 'Move (metres)', value: 10 }] });
    expect(cwnMoveBonus({ cyberware: [old] })).toBe(10);
  });

  it('counts only chrome that is installed and switched on', () => {
    expect(derive({ cyberware: [implant({ placed: false })] }).move).toBe(10);
    expect(derive({ cyberware: [implant({ equipped: false })] }).move).toBe(10);
  });

  it('gives it back when the implant comes out', () => {
    // Computed on read, never written into the sheet as a new base.
    const withIt = derive({ cyberware: [implant()] });
    expect(derive({ ...withIt, cyberware: [] }).move).toBe(10);
  });

  it('takes the table modifier, for the rules the app cannot work out', () => {
    // Encumbrance costs 30% (p48) and prone halves it (p35); there is no inventory to
    // weigh and no posture to read, so a GM applies those here.
    expect(derive({ move_mod: -3 }).move).toBe(7);
    expect(derive({ move_mod: 20 }).move).toBe(30);
  });

  it('never goes below zero', () => {
    expect(derive({ move_mod: -50 }).move).toBe(0);
  });

  it('reads a malformed cyberware field as no bonus', () => {
    for (const v of [undefined, null, 'nonsense', 42, {}]) {
      expect(cwnMoveBonus({ cyberware: v }), String(v)).toBe(0);
    }
  });

  it('ignores chrome that moves you in other ways', () => {
    // Enhanced Reflexes grants a bonus Move ACTION - another turn's worth of moving, not a
    // longer stride. The Assisted Glide System is a 30m glide, which is not this number.
    const reflexes = implant({ name: 'Enhanced Reflexes II', mods: [] });
    expect(derive({ cyberware: [reflexes] }).move).toBe(10);
  });
});

describe('it belongs to Cities Without Number', () => {
  it('is not derived for another system', () => {
    for (const sys of ['cyberpunk_red', 'shadowrun_6e', 'generic']) {
      const d = { cyberware: [implant()] };
      applyDerived(sys, d);
      expect(d.move, sys).toBeUndefined();
    }
  });
});

describe('a sheet saved before the field existed', () => {
  it('reads as ten rather than zero, without being written to', () => {
    // The bug this was written for: derived fields are computed on save, so every
    // character created before MOVE existed carried nothing for it - and an empty number
    // field renders as 0, which is a wrong answer rather than an absent one. The read
    // path recomputes, so the sheet states the truth the moment it loads.
    const stored = { name: 'The Wraith', con: 10, strain_mod: 5 };
    const onRead = { ...stored };
    applyDerived('cities_without_number', onRead);

    expect(stored.move).toBeUndefined();   // nothing was written into the stored copy
    expect(onRead.move).toBe(10);
    // And the rest of the derived layer heals the same way.
    expect(onRead.system_strain_max).toBe(15);
  });
});
