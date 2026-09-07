import { describe, it, expect } from 'vitest';
import { CWN_WEAPONS, weaponById, weaponToStashed } from '../cwnWeaponPresets';
import { normaliseStashed } from '../cwnWeaponStash';

/**
 * The book's weapon tables (p54-56).
 *
 * The catalogue exists so a player does not copy eight numbers out of a book, and the
 * important thing about every one of them is that the SERVER can parse it. A weapon whose
 * damage still carries the table's footnote marker is a weapon that silently cannot be
 * fired, so these check the formats rather than the transcription.
 */

// The resolver's own patterns, from backend/sheets/attackCwn.js.
const DMG = /^\d+d\d+([+-]\d+)?$/i;
const TRAUMA = /^d(\d{1,3})\s*\/\s*x?(\d{1,2})\s*(!?)$/i;
const SHOCK = /^(\d{1,2})\s*\/\s*(?:ac\s*)?(\d{1,2})$/i;

describe('every line the shop offers', () => {
  it('has an id, a name and a price', () => {
    for (const w of CWN_WEAPONS) {
      expect(w.id, w.name).toMatch(/^[a-z0-9_]+$/);
      expect(w.name.length, w.id).toBeGreaterThan(0);
      expect(w.price, w.id).toBeGreaterThanOrEqual(0);
    }
  });

  it('names each once', () => {
    const ids = CWN_WEAPONS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries damage the resolver will actually roll', () => {
    // The one that matters. "1d12*" is what the book prints and what the resolver refuses,
    // so a weapon bought with the marker still on it could never be fired.
    for (const w of CWN_WEAPONS) {
      if (!w.dmg) continue;  // a smoke grenade does no damage
      expect(w.dmg, `${w.name} damage`).toMatch(DMG);
    }
  });

  it('carries trauma the resolver will parse, or none at all', () => {
    for (const w of CWN_WEAPONS) {
      if (!w.trauma) continue;
      expect(w.trauma, `${w.name} trauma`).toMatch(TRAUMA);
    }
  });

  it('carries shock the resolver will parse, or none at all', () => {
    for (const w of CWN_WEAPONS) {
      if (!w.shock) continue;
      expect(w.shock, `${w.name} shock`).toMatch(SHOCK);
    }
  });

  it('uses only skills and attributes the sheet has', () => {
    for (const w of CWN_WEAPONS) {
      expect(['shoot', 'stab', 'punch'], `${w.name} skill`).toContain(w.skill);
      expect(['', 'str', 'dex', 'str_dex', 'wis', 'none'], `${w.name} attr`).toContain(w.attr);
    }
  });

  it('carries a whole-number Enc, whatever the guideline sizes say', () => {
    // Writing this found the guideline was being treated as a list of legal values. The
    // weapon table prints its own and they do not all appear in it: the Automatic Rifle
    // is 4, which no guideline row offers.
    for (const w of CWN_WEAPONS) {
      expect(w.enc, `${w.name} enc`).toMatch(/^\d+$/);
    }
    expect(CWN_WEAPONS.find((w) => w.id === 'automatic_rifle')!.enc).toBe('4');
  });
});

describe('what the footnote markers became', () => {
  it('keeps ! as the trauma flag it means, rather than dropping it', () => {
    // "!" on damage means the Trauma Die works on drones and vehicles, which the trauma
    // field already spells with a trailing !.
    expect(weaponById('rocket_launcher')!.trauma).toBe('d10/x3!');
    expect(weaponById('land_mine_av')!.trauma).toBe('d20/x3!');
    // And a weapon the book did not mark does not gain one.
    expect(weaponById('heavy_pistol')!.trauma).toBe('d6/x3');
  });

  it('records what the stripped markers meant instead of losing them', () => {
    expect(weaponById('combat_rifle')!.note).toMatch(/burst fire/i);
    expect(weaponById('big_sword')!.note).toMatch(/two-handed/i);
    expect(weaponById('advanced_club')!.note).toMatch(/non-lethal/i);
    expect(weaponById('automatic_rifle')!.note).toMatch(/suppress/i);
  });

  it('says which weapons need a Contact to buy', () => {
    expect(weaponById('combat_shotgun')!.note).toMatch(/Contact/);
    expect(weaponById('shotgun')!.note).not.toMatch(/Contact/);
  });
});

describe('the book facts worth being right about', () => {
  it('fires a Mortar off Wisdom', () => {
    expect(weaponById('mortar')!.attr).toBe('wis');
  });

  it('gives a mine and a demo charge no attribute at all', () => {
    expect(weaponById('demo_charge')!.attr).toBe('none');
    expect(weaponById('land_mine_ap')!.attr).toBe('none');
  });

  it('takes blades with Stab and blunt weapons with Punch', () => {
    expect(weaponById('sword')!.skill).toBe('stab');
    expect(weaponById('big_club')!.skill).toBe('punch');
  });

  it('prices the Club at nothing, because the book prints N/A', () => {
    expect(weaponById('club')!.price).toBe(0);
  });

  it('leaves the Taser with no Trauma Die', () => {
    expect(weaponById('taser_pistol')!.trauma).toBe('');
  });
});

describe('buying one', () => {
  it('produces a stash entry the sheet can read back unchanged', () => {
    const w = weaponById('combat_rifle')!;
    const entry = weaponToStashed(w, 'The Gun Rack');
    expect(normaliseStashed(entry)).toEqual(entry);
    expect(entry).toMatchObject({
      name: 'Combat Rifle', dmg: '1d12', skill: 'shoot', attr: 'dex',
      trauma: 'd8/x3', enc: '2', atk: 0, location: 'The Gun Rack',
    });
  });

  it('remembers where it was bought, since that is where it is', () => {
    expect(weaponToStashed(weaponById('knife')!, 'Blade Bazaar').location).toBe('Blade Bazaar');
  });
});
