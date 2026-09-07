import { describe, it, expect } from 'vitest';
import {
  readStash, writeStash, normaliseStashed, firstFreeRow,
  carriedToStashed, stashedToCarried, clearCarried, compactCarried, STASH_FIELD,
} from '../cwnWeaponStash';
import { getTemplate, } from '../index';
import { CWN_WEAPON_ROWS } from '../templates/cities_without_number';

/**
 * Weapons owned but not carried.
 *
 * The book limits carrying by Encumbrance, not by a slot count, and Encumbrance is about
 * what is ON you - so a rifle in a safehouse belongs on neither carried row. The stash is
 * unlimited and free; only picking something up costs anything.
 *
 * Named STASH and not "stored" because the carry radio already uses the book's STOWED for
 * packed-away-but-on-your-back, which does cost Encumbrance.
 */

const rifle = {
  name: 'Combat Rifle', dmg: '1d12', skill: 'shoot', attr: 'dex',
  trauma: 'd8/x3', shock: '', atk: 1, enc: '2', mods: '[]', location: 'safehouse',
};

describe('reading and writing the list', () => {
  it('round-trips through the sheet', () => {
    const json = writeStash([normaliseStashed(rifle)]);
    expect(readStash({ [STASH_FIELD]: json })[0]).toMatchObject(rifle);
  });

  it('reads a malformed field as an empty stash rather than throwing', () => {
    for (const v of [undefined, null, '', 'nonsense', 42, {}, [1, 'x']]) {
      expect(readStash({ [STASH_FIELD]: v }), String(v)).toEqual([]);
    }
  });

  it('fills in whatever a hand-edited entry left out', () => {
    expect(normaliseStashed({ name: 'Knife' })).toEqual({
      name: 'Knife', dmg: '', skill: '', attr: '', trauma: '', shock: '',
      atk: 0, enc: '', mods: '', location: '',
    });
  });
});

describe('finding room to carry one', () => {
  it('takes the first row with no name', () => {
    expect(firstFreeRow({ weapon1_name: 'gun' }, 6)).toBe(2);
  });

  it('reads a row with only a name as taken, and a blank name as free', () => {
    // A name is what a player types first; everything else can legitimately be empty.
    expect(firstFreeRow({ weapon1_name: '   ', weapon1_dmg: '1d6' }, 6)).toBe(1);
  });

  it('says so when every row is full', () => {
    const full: Record<string, unknown> = {};
    for (let i = 1; i <= 6; i += 1) full[`weapon${i}_name`] = 'gun';
    expect(firstFreeRow(full, 6)).toBeNull();
  });
});

describe('moving one out of the stash', () => {
  it('carries the whole stat block into the row, not just the name', () => {
    const out = stashedToCarried(normaliseStashed(rifle), 2);
    expect(out).toMatchObject({
      weapon2_name: 'Combat Rifle', weapon2_dmg: '1d12', weapon2_skill: 'shoot',
      weapon2_attr: 'dex', weapon2_trauma: 'd8/x3', weapon2_atk: 1,
      weapon2_enc: '2', weapon2_mods: '[]',
    });
  });

  it('lands it stowed rather than readied', () => {
    // A weapon just out of a locker is in your bag. Claiming it is in your hands would
    // change what you can draw this round and charge it against the tighter limit.
    expect(stashedToCarried(normaliseStashed(rifle), 1).weapon1_carry).toBe('stowed');
  });

  it('does not carry the location, which stops being true the moment you pick it up', () => {
    expect(Object.keys(stashedToCarried(normaliseStashed(rifle), 1)))
      .not.toContain('weapon1_location');
  });
});

describe('putting one away', () => {
  const sheet = {
    weapon3_name: 'Shotgun', weapon3_dmg: '3d4', weapon3_skill: 'shoot',
    weapon3_attr: 'dex', weapon3_trauma: 'd10/x3', weapon3_shock: '',
    weapon3_atk: 0, weapon3_enc: '2', weapon3_mods: '["silenced"]', weapon3_carry: 'readied',
  };

  it('keeps every number, so the same weapon comes back', () => {
    expect(carriedToStashed(sheet, 3, 'in the Kestrel')).toEqual({
      name: 'Shotgun', dmg: '3d4', skill: 'shoot', attr: 'dex', trauma: 'd10/x3',
      shock: '', atk: 0, enc: '2', mods: '["silenced"]', location: 'in the Kestrel',
    });
  });

  it('survives a round trip both ways', () => {
    const away = carriedToStashed(sheet, 3, 'locker');
    const back = stashedToCarried(away, 1);
    expect(back).toMatchObject({
      weapon1_name: 'Shotgun', weapon1_dmg: '3d4', weapon1_enc: '2',
      weapon1_mods: '["silenced"]', weapon1_trauma: 'd10/x3',
    });
  });

  it('empties the row it came from, so it does not exist twice', () => {
    const cleared = clearCarried(3);
    expect(cleared.weapon3_name).toBe('');
    expect(cleared.weapon3_carry).toBe('');
    // Empty, not zero: the sheet draws a row when any field in it holds something, and a
    // zero would leave a stashed weapon's row on screen with nothing in it.
    expect(cleared.weapon3_atk).toBe('');
  });
});

describe('closing the gap when one is taken out', () => {
  const two = {
    weapon1_name: 'gun', weapon1_dmg: '1d6', weapon1_enc: '1', weapon1_carry: 'readied',
    weapon2_name: 'knife', weapon2_dmg: '1d12', weapon2_enc: '1', weapon2_carry: 'stowed',
  };

  it('moves the ones below up, rather than leaving a hole', () => {
    // The bug this exists for: the sheet draws rows up to the LAST one holding anything,
    // so blanking row 1 while row 2 was filled left an empty weapon on screen that could
    // not be removed.
    const out = compactCarried(two, 6, 1);
    expect(out.weapon1_name).toBe('knife');
    expect(out.weapon1_dmg).toBe('1d12');
    expect(out.weapon1_carry).toBe('stowed');
    expect(out.weapon2_name).toBe('');
  });

  it('leaves the rows above where they were', () => {
    const out = compactCarried(two, 6, 2);
    expect(out.weapon1_name).toBe('gun');
    expect(out.weapon2_name).toBe('');
  });

  it('empties every row past the ones kept', () => {
    const out = compactCarried(two, 6, 1);
    for (let i = 2; i <= 6; i += 1) {
      expect(out[`weapon${i}_name`], String(i)).toBe('');
      expect(out[`weapon${i}_atk`], String(i)).toBe('');
    }
  });

  it('closes a hole that was already there', () => {
    // Rewriting every row rather than moving one means a sheet that already had a gap -
    // hand-edited, or from before this existed - comes back tidy.
    const gappy = { weapon2_name: 'knife', weapon2_dmg: '1d12', weapon4_name: 'gun' };
    const out = compactCarried(gappy, 6, 6);
    expect(out.weapon1_name).toBe('knife');
    expect(out.weapon2_name).toBe('gun');
    expect(out.weapon3_name).toBe('');
  });

  it('keeps the last weapon when it is the one removed', () => {
    const out = compactCarried({ weapon1_name: 'gun' }, 6, 1);
    for (let i = 1; i <= 6; i += 1) expect(out[`weapon${i}_name`]).toBe('');
  });
});

describe('where it lives', () => {
  const CWN = getTemplate('cities_without_number');

  it('is a section on the GEAR tab', () => {
    const section = CWN.sections.find((s) => s.layout === 'weapon_stash')!;
    expect(section.tab).toBe('GEAR');
  });

  it('has as many carried rows as the sheet declares', () => {
    const ids = CWN.sections.flatMap((s) => (s.fields ?? []).map((f) => f.id));
    for (let i = 1; i <= CWN_WEAPON_ROWS; i += 1) expect(ids).toContain(`weapon${i}_name`);
    expect(ids).not.toContain(`weapon${CWN_WEAPON_ROWS + 1}_name`);
  });

  it('is on no other system', () => {
    for (const id of ['cyberpunk_red', 'shadowrun_6e', 'generic']) {
      expect(getTemplate(id).sections.some((s) => s.layout === 'weapon_stash'), id).toBe(false);
    }
  });
});
