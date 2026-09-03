import { describe, it, expect } from 'vitest';
import { CWN_CYBER_WEAPONS, cyberWeaponsOf, bestCyberSkill } from '../cwnCyberWeapons';

/**
 * The client's list of implants that are weapons.
 *
 * The server resolves the attack and rolls the dice; this exists so the picker can offer
 * body weaponry at all, and so the line it prints matches what will be rolled. The first
 * block is what makes mirroring safe.
 */

const blade = (name: string, over = {}) =>
  ({ name, type: 'limb', side: null, placed: true, equipped: true, hl: 1, mods: [], ...over });

describe('the mirror agrees with the server', () => {
  it('lists the same implants', async () => {
    const backend = await import('../../../../backend/sheets/cwnCyberWeapons.js');
    expect(Object.keys(CWN_CYBER_WEAPONS).sort()).toEqual(Object.keys(backend.CYBER_WEAPONS).sort());
  });

  it('agrees on the label, damage and allowed skills', async () => {
    const backend = await import('../../../../backend/sheets/cwnCyberWeapons.js');
    for (const [key, mine] of Object.entries(CWN_CYBER_WEAPONS)) {
      const theirs = backend.CYBER_WEAPONS[key];
      expect(mine.label, key).toBe(theirs.label);
      expect(mine.dmg, key).toBe(theirs.dmg);
      expect(mine.skills, key).toEqual(theirs.skills);
    }
  });

  it('picks the same skill from the same sheet', async () => {
    const backend = await import('../../../../backend/sheets/cwnCyberWeapons.js');
    for (const data of [{ stab: 3, punch: 0 }, { stab: 0, punch: 3 }, { stab: 2, punch: 2 }, {}]) {
      expect(bestCyberSkill(data, ['stab', 'punch']))
        .toBe(backend.bestSkill(data, ['stab', 'punch']));
    }
  });

  it('finds the same weapons on the same sheet, in the same order', async () => {
    const backend = await import('../../../../backend/sheets/cwnCyberWeapons.js');
    const data = {
      stab: 1, punch: 0,
      cyberware: [blade('Cyberlimb'), blade('Body Blades I'), blade('Body Blades II')],
    };
    expect(cyberWeaponsOf(data).map((w) => w.name))
      .toEqual(backend.list(data).map((r: { name: string }) => CWN_CYBER_WEAPONS[r.name.toLowerCase()].label));
  });
});

describe('what the picker is offered', () => {
  it('offers a fitted blade', () => {
    const out = cyberWeaponsOf({ cyberware: [blade('Body Blades I')], stab: 1, punch: 0 });
    expect(out).toEqual([{ index: 1, name: 'Body Blades I', dmg: '1d8', skill: 'stab' }]);
  });

  it('offers nothing for chrome that is not a weapon', () => {
    expect(cyberWeaponsOf({ cyberware: [blade('Cyberlimb'), blade('Dermal Armor I')] })).toEqual([]);
  });

  it('offers nothing for a piece owned but not fitted', () => {
    expect(cyberWeaponsOf({ cyberware: [blade('Body Blades I', { placed: false })] })).toEqual([]);
    expect(cyberWeaponsOf({ cyberware: [blade('Body Blades I', { equipped: false })] })).toEqual([]);
  });

  it('numbers them by weapon, not by position in the cyberware list', () => {
    // So adding unrelated chrome above a blade does not change which index it is, which
    // is what the server expects in cyberIndex.
    const out = cyberWeaponsOf({
      cyberware: [blade('Omnihand'), blade('Body Blades I'), blade('Cyberlimb'), blade('Body Blades II')],
    });
    expect(out.map((w) => [w.index, w.name])).toEqual([[1, 'Body Blades I'], [2, 'Body Blades II']]);
  });

  it('shows the skill the attack will actually use', () => {
    const withSkills = (stab: number, punch: number) =>
      cyberWeaponsOf({ cyberware: [blade('Body Blades I')], stab, punch })[0].skill;
    expect(withSkills(3, 0)).toBe('stab');
    expect(withSkills(0, 3)).toBe('punch');
  });

  it('survives a cyberware field that is not a list of rows', () => {
    // Free-form JSON on a sheet people import into and edit by hand. A picker that throws
    // is worse than one that is short.
    for (const value of [undefined, null, 'nonsense', 42, {}, [null, 'x', 7]]) {
      expect(cyberWeaponsOf({ cyberware: value } as never)).toEqual([]);
    }
    expect(cyberWeaponsOf(null)).toEqual([]);
  });
});
