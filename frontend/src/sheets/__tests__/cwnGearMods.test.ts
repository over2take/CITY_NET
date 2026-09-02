import { describe, it, expect } from 'vitest';
import {
  CWN_ARMOR_MODS, CWN_WEAPON_MODS, CWN_WEAPON_BONUS_CAP, parseModIds,
  armorModTotals, summariseArmorMods, summariseWeaponMods, remainingOptions,
  ARMOR_MOD_OPTIONS, WEAPON_MOD_OPTIONS, describeWeaponMod,
} from '../cwnGearMods';

/**
 * The mirror, and the line under the list.
 *
 * The server owns the table; this side owns the pickers and the chips. The first block is
 * the whole reason mirroring is safe - it walks both copies field by field, so a mod
 * edited on one side and not the other fails here rather than in somebody's game.
 */

describe('the mirror agrees with the server', () => {
  it('carries the same mods, with the same numbers', async () => {
    const backend = await import('../../../../backend/sheets/cwnGearMods.js');
    const pairs = [
      ['armor', CWN_ARMOR_MODS, backend.ARMOR_MODS],
      ['weapon', CWN_WEAPON_MODS, backend.WEAPON_MODS],
    ] as const;

    for (const [which, mine, theirs] of pairs) {
      expect(mine.map((m) => m.id), `${which} mods`).toEqual(theirs.map((m: { id: string }) => m.id));
      for (const [i, mod] of mine.entries()) {
        // Key order is not part of the contract, but the set of keys is: a field present
        // on one side and absent on the other is exactly the drift worth catching, and
        // comparing only the fields this side knows about would miss it.
        const sorted = (o: object) => Object.fromEntries(Object.entries(o).sort());
        expect(sorted(mod), `${which} mod ${mod.id}`).toEqual(sorted(theirs[i]));
      }
    }
  });

  it('uses the same cap', async () => {
    const backend = await import('../../../../backend/sheets/cwnGearMods.js');
    expect(CWN_WEAPON_BONUS_CAP).toBe(backend.WEAPON_BONUS_CAP);
  });

  it('reads a tag list the same way', async () => {
    const backend = await import('../../../../backend/sheets/cwnGearMods.js');
    for (const v of ['["autotargeting"]', '', 'not json', '{"a":1}', undefined]) {
      expect(parseModIds(v)).toEqual(backend.parseIds(v));
    }
  });

  it('totals an armor the same way', async () => {
    const backend = await import('../../../../backend/sheets/cwnGearMods.js');
    const fitted = JSON.stringify(['absorption_pads', 'trauma_dampers', 'customized_armor', 'active_response']);
    const theirs = backend.armorModEffects(fitted);
    const mine = armorModTotals(fitted);
    expect(mine).toEqual({
      soak: theirs.soak, traumaTarget: theirs.traumaTarget,
      rangedAc: theirs.rangedAc, meleeAc: theirs.meleeAc,
    });
  });
});

describe('the line under a weapon mod list', () => {
  it('says nothing is fitted when nothing is', () => {
    expect(summariseWeaponMods([])).toEqual({ text: 'No mods fitted.' });
  });

  it('adds the bonuses up', () => {
    const { text, warn } = summariseWeaponMods(['savage_impact', 'integral_toxins']);
    expect(text).toContain('dmg +3');
    expect(text).toContain('shock +3');
    expect(warn).toBeFalsy();
  });

  it('warns past the cap, and says what will actually be rolled', () => {
    // The point of the line. Three damage mods stack to +5 and the server rolls +3, so a
    // player who is not told would be counting on two points that never arrive.
    const { text, warn } = summariseWeaponMods(['integral_toxins', 'thermal_charge', 'savage_impact']);
    expect(warn).toBe(true);
    expect(text).toContain('over the +3 cap');
    expect(text).toContain('rolled at +3');
  });

  it('is quiet at exactly the cap', () => {
    const { warn } = summariseWeaponMods(['autotargeting', 'customized_weapon', 'predictive_guidance']);
    expect(warn).toBeFalsy();
  });

  it('names a mod that changes no number at all', () => {
    const { text } = summariseWeaponMods(['concealed']);
    expect(text).toBe('No change to the rolls.');
  });

  it('calls out the two that are not bonuses', () => {
    expect(summariseWeaponMods(['heavy_sabot']).text).toContain('bites vehicles');
    expect(summariseWeaponMods(['stun_rounds']).text).toContain('no trauma die');
  });
});

describe('the line under an armor mod list', () => {
  it('adds the soak up', () => {
    const { text } = summariseArmorMods(['absorption_pads', 'trauma_dampers']);
    expect(text).toContain('soak +10');
  });

  it('shows both ACs, including the one that costs you', () => {
    expect(summariseArmorMods(['customized_armor']).text).toContain('AC +1 rng / +1 mel');
    expect(summariseArmorMods(['discreet_design']).text).toContain('AC -2 rng / -2 mel');
  });

  it('warns when a prerequisite is missing', () => {
    // Trauma Dampers is the only mod in either table that needs another one first.
    const { text, warn } = summariseArmorMods(['trauma_dampers']);
    expect(warn).toBe(true);
    expect(text).toContain('TRAUMA DAMPERS needs ABSORPTION PADS');
  });

  it('is quiet once the prerequisite is fitted', () => {
    expect(summariseArmorMods(['absorption_pads', 'trauma_dampers']).warn).toBeFalsy();
  });
});

describe('the picker', () => {
  it('stops offering what is already fitted', () => {
    // A mod goes on a given piece of gear once.
    const left = remainingOptions(WEAPON_MOD_OPTIONS, ['autotargeting']);
    expect(left.some((o) => o.value === 'autotargeting')).toBe(false);
    expect(left).toHaveLength(WEAPON_MOD_OPTIONS.length - 1);
  });

  it('keeps armor and weapon mods in their own lists', () => {
    // The two Customizeds are different mods that happen to share a name.
    const armorIds = ARMOR_MOD_OPTIONS.map((o) => o.value);
    const weaponIds = WEAPON_MOD_OPTIONS.map((o) => o.value);
    expect(armorIds).toContain('customized_armor');
    expect(weaponIds).toContain('customized_weapon');
    expect(armorIds.filter((id) => weaponIds.includes(id))).toEqual([]);
  });

  it('prints what a chip does and what it costs', () => {
    const text = describeWeaponMod('predictive_guidance');
    expect(text).toContain('+1 bonus to hit, damage, and Shock');
    expect(text).toContain('Fix-3');
    expect(text).toContain('$15,000');
    expect(text).toContain('2 tech');
  });

  it('falls back to the raw id for a mod it does not know', () => {
    expect(describeWeaponMod('not_a_real_mod')).toBe('not_a_real_mod');
  });
});
