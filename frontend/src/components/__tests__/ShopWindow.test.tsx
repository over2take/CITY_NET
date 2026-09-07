/**
 * The shop, as far as it goes: what a building carries, and the fact that it does not
 * charge for it yet.
 *
 * The inertness is tested deliberately. A shell that quietly looked functional would be
 * worse than no shell at all, so the buttons being disabled and the notice being present
 * are assertions rather than an accident of it being unfinished.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShopWindow } from '../ShopWindow';

// The hook is the sheet's own business; what matters here is what the shop does with it.
const sheetState: { sheet: any; encumbranceEnforced: boolean } = {
  sheet: { system: 'cities_without_number', data: {} },
  encumbranceEnforced: false,
};
const handleFieldChange = vi.fn();
const handleFieldsChange = vi.fn();
vi.mock('../../hooks/usePlayerSheet', () => ({
  usePlayerSheet: () => ({
    sheet: sheetState.sheet,
    handleFieldChange,
    handleFieldsChange,
    encumbranceEnforced: sheetState.encumbranceEnforced,
  }),
}));
import { BUILDING_TYPES, isShop, buildingTypeById, shopsAvailable } from '../../data/buildingTypes';
import { CWN_WEAPON_ROWS } from '../../sheets/templates/cities_without_number';
import { CWN_CYBERWARE } from '../../sheets/cwnCyberwarePresets';

const show = (buildingType: string, name = 'Doc Wu') =>
  render(<ShopWindow name={name} buildingType={buildingType}
    socket={{ on: vi.fn(), off: vi.fn(), emit: vi.fn() }} userName="JADE" onClose={vi.fn()} />);

beforeEach(() => {
  handleFieldChange.mockClear();
  handleFieldsChange.mockClear();
  sheetState.sheet = { system: 'cities_without_number', data: {} };
  sheetState.encumbranceEnforced = false;
});

describe('a ripperdoc', () => {
  it('carries the cyberware catalogue', () => {
    show('ripperdoc');
    expect(screen.getByText('Cranial Jack')).toBeInTheDocument();
    expect(screen.getByText(/60 LINES/)).toBeInTheDocument();
  });

  it('prices in credits, at the book price', () => {
    show('ripperdoc');
    const jack = CWN_CYBERWARE.find((c) => c.id === 'cranial-jack')!;
    expect(screen.getByText(`${jack.price.toLocaleString()}cr`)).toBeInTheDocument();
  });

  it('shows strain, including the fractional ones', () => {
    show('ripperdoc');
    // A shop rounding 0.25 to 0 would be lying about what the piece costs you.
    expect(screen.getAllByText('0.25').length).toBeGreaterThan(0);
  });

  it('says out loud that nothing is charged yet', () => {
    // A button that quietly does half of what it says is worse than one that says which.
    show('ripperdoc');
    expect(screen.getByText(/NOTHING IS CHARGED YET/)).toBeInTheDocument();
  });

  it('filters the stock by name', async () => {
    show('ripperdoc');
    await userEvent.type(screen.getByLabelText('Filter stock'), 'cranial');
    expect(screen.getByText('Cranial Jack')).toBeInTheDocument();
    expect(screen.queryByText('Skinmod')).not.toBeInTheDocument();
  });

  it('says so when a filter matches nothing', async () => {
    show('ripperdoc');
    await userEvent.type(screen.getByLabelText('Filter stock'), 'zzzz');
    expect(screen.getByText(/NOTHING MATCHES THAT/)).toBeInTheDocument();
  });

  it('names the building it belongs to', () => {
    show('ripperdoc', 'Doc Wu');
    expect(screen.getByText(/SHOP · Doc Wu/)).toBeInTheDocument();
  });
});

describe('a shop with no catalogue built yet', () => {
  it('says so rather than showing an empty table', () => {
    // The gun shop used to be the example here. A clinic still is: armour and drugs are
    // the stock lists nobody has written.
    show('clinic');
    expect(screen.getByText(/NO CATALOGUE FOR THIS SHOP YET/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Filter stock')).not.toBeInTheDocument();
  });

  it('sells weapons at the gun shop now, which it did not', () => {
    show('gun_shop');
    expect(screen.queryByText(/NO CATALOGUE FOR THIS SHOP YET/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Buy Heavy Pistol' })).toBeInTheDocument();
  });
});

describe('the vocabulary the map is labelled with', () => {
  it('only lets shops declare stock', () => {
    for (const t of BUILDING_TYPES) if (!t.shop) expect(t.sells).toBeNull();
  });

  it('knows which types trade', () => {
    expect(isShop('ripperdoc')).toBe(true);
    expect(isShop('bar')).toBe(false);
    expect(isShop(null)).toBe(false);
    expect(isShop('speakeasy')).toBe(false);
  });

  it('is unknown for a type nobody has heard of', () => {
    expect(buildingTypeById('speakeasy')).toBeUndefined();
  });

  it('offers shops under CWN only, for now', () => {
    expect(shopsAvailable('cities_without_number')).toBe(true);
    expect(shopsAvailable('cyberpunk_red')).toBe(false);
    expect(shopsAvailable(null)).toBe(false);
  });

  it('matches the list the server owns', async () => {
    // The mirror is only worth having if it agrees, so compare against the real module
    // rather than a copy of the list.
    const backend = await import('../../../../backend/buildingTypes.js');
    expect(BUILDING_TYPES).toEqual(backend.default.BUILDING_TYPES);
  });
});

describe('buying and selling are separate tabs', () => {
  it('opens on buying', () => {
    show('ripperdoc');
    expect(screen.getByRole('button', { name: 'BUY' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'SELL' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps selling off the stock list', async () => {
    // Selling reads what you are carrying, not what the shop stocks - a SELL button beside
    // the catalogue would be offering to sell you something you may not own.
    show('ripperdoc');
    expect(screen.queryByLabelText('Sell Cranial Jack')).not.toBeInTheDocument();
  });

  it('says what selling will be, rather than showing an empty list', async () => {
    show('ripperdoc');
    await userEvent.click(screen.getByRole('button', { name: 'SELL' }));
    expect(screen.getByText(/SELLING IS NOT WIRED UP YET/)).toBeInTheDocument();
    expect(screen.getByText(/more than augments/)).toBeInTheDocument();
  });

  it('puts the stock away while selling', async () => {
    show('ripperdoc');
    await userEvent.click(screen.getByRole('button', { name: 'SELL' }));
    expect(screen.queryByLabelText('Buy Cranial Jack')).not.toBeInTheDocument();
  });
});

describe('buying a piece', () => {
  const buyFirst = async () => {
    show('ripperdoc');
    await userEvent.click(screen.getByLabelText('Buy Cranial Jack'));
    return handleFieldChange.mock.calls[0];
  };

  it('puts it on the sheet under cyberware', async () => {
    const [field, rows] = await buyFirst();
    expect(field).toBe('cyberware');
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Cranial Jack');
  });

  it('carries the book numbers across', async () => {
    const [, rows] = await buyFirst();
    expect(rows[0].hl).toBe(0.25);
    expect(rows[0].cost).toBe(1000);
    expect(rows[0].conc).toBe('touch');
    expect(rows[0].type).toBe('head');
  });

  it('leaves it unplaced, because buying is not surgery', async () => {
    // It lands in the same "not yet placed on the body" list an import lands in.
    const [, rows] = await buyFirst();
    expect(rows[0].placed).toBe(false);
    expect(rows[0].equipped).toBe(true);
  });

  it('brings the modifiers with it', async () => {
    show('ripperdoc');
    await userEvent.click(screen.getByLabelText('Buy Coordination Augment I'));
    const [, rows] = handleFieldChange.mock.calls[0];
    expect(rows[0].mods).toEqual([
      { kind: 'statFloor', target: 'Dexterity', value: 14, bonus: 2 },
    ]);
  });

  it('adds to what is already there rather than replacing it', async () => {
    sheetState.sheet = {
      system: 'cities_without_number',
      data: { cyberware: [{ name: 'Old Chrome', type: 'head', hl: 1, equipped: true, placed: true, mods: [] }] },
    };
    show('ripperdoc');
    await userEvent.click(screen.getByLabelText('Buy Cranial Jack'));
    const [, rows] = handleFieldChange.mock.calls[0];
    expect(rows.map((r: any) => r.name)).toEqual(['Old Chrome', 'Cranial Jack']);
  });

  it('shows that the press did something', async () => {
    show('ripperdoc');
    await userEvent.click(screen.getByLabelText('Buy Cranial Jack'));
    expect(screen.getByLabelText('Buy Cranial Jack')).toHaveTextContent('×1');
  });

  it('cannot buy with no sheet loaded, and says why', () => {
    sheetState.sheet = null;
    show('ripperdoc');
    expect(screen.getByLabelText('Buy Cranial Jack')).toBeDisabled();
    expect(screen.getByText(/NO CHARACTER SHEET LOADED/)).toBeInTheDocument();
  });
});

describe('buying a weapon', () => {
  /**
   * It goes into a carried slot, Stowed - you are walking out of the shop with it.
   *
   * Which means the shop can refuse, and has to: a slot count and, where the table asked
   * for it, the Stowed Encumbrance allowance. A shop that took the money and quietly
   * dropped the gun would be worse than one that says no.
   */
  const lastFields = () => handleFieldsChange.mock.calls.at(-1)?.[0] as Record<string, unknown>;

  it('puts it in the first free weapon slot', async () => {
    show('gun_shop');
    await userEvent.click(screen.getByRole('button', { name: 'Buy Combat Rifle' }));

    expect(lastFields()).toMatchObject({
      weapon1_name: 'Combat Rifle', weapon1_dmg: '1d12', weapon1_skill: 'shoot',
      weapon1_attr: 'dex', weapon1_trauma: 'd8/x3', weapon1_enc: '2',
    });
  });

  it('lands it stowed rather than readied', async () => {
    show('gun_shop');
    await userEvent.click(screen.getByRole('button', { name: 'Buy Knife' }));
    expect(lastFields().weapon1_carry).toBe('stowed');
  });

  it('takes the next free slot when the first is used', async () => {
    sheetState.sheet = {
      system: 'cities_without_number',
      data: { weapon1_name: 'gun', weapon2_name: 'knife' },
    };
    show('gun_shop');
    await userEvent.click(screen.getByRole('button', { name: 'Buy Sword' }));
    expect(lastFields().weapon3_name).toBe('Sword');
  });

  it('refuses when every slot is full, rather than losing the weapon', async () => {
    const data: Record<string, unknown> = {};
    for (let i = 1; i <= CWN_WEAPON_ROWS; i += 1) data[`weapon${i}_name`] = 'gun';
    sheetState.sheet = { system: 'cities_without_number', data };
    show('gun_shop');
    await userEvent.click(screen.getByRole('button', { name: 'Buy Knife' }));

    expect(screen.getByText(/No free weapon slot/)).toBeInTheDocument();
    expect(handleFieldsChange).not.toHaveBeenCalled();
  });

  it('says that nothing is charged, and where the weapon went', () => {
    show('gun_shop');
    expect(screen.getByText(/BUY PUTS THE WEAPON IN A WEAPON SLOT, STOWED/)).toBeInTheDocument();
  });

  it('prints range and magazine, and says they will not be kept', () => {
    // The sheet has no field for either, so they are reference only. Better said than
    // discovered when they fail to appear on the weapon.
    show('gun_shop');
    expect(screen.getByText(/Range and magazine are printed for reference/)).toBeInTheDocument();
    expect(screen.getByText('100/300')).toBeInTheDocument();
  });
});

describe('the shelf says how many you own', () => {
  /**
   * Counted off the sheet, not off what was clicked this visit. Deleting one from the
   * sheet has to show up here, or the shop is reporting button presses.
   */
  it('counts what is in a weapon slot', () => {
    sheetState.sheet = {
      system: 'cities_without_number',
      data: { weapon1_name: 'Knife', weapon2_name: 'Knife' },
    };
    show('gun_shop');
    const row = screen.getByRole('button', { name: 'Buy Knife' }).closest('tr')!;
    expect(within(row).getByText('x2')).toBeInTheDocument();
  });

  it('gives it a column of its own rather than moving the BUY button', () => {
    // Hung off the button, it shifted the button every time somebody bought something.
    show('gun_shop');
    expect(screen.getByRole('columnheader', { name: 'Sort by OWNED' })).toBeInTheDocument();
  });

  it('counts what is in the stash too, since you still own it', () => {
    sheetState.sheet = {
      system: 'cities_without_number',
      data: { weapons_stash: JSON.stringify([{ name: 'Knife' }, { name: 'Knife' }]) },
    };
    show('gun_shop');
    const row = screen.getByRole('button', { name: 'Buy Knife' }).closest('tr')!;
    expect(within(row).getByText('x2')).toBeInTheDocument();
  });

  it('shows nothing against a weapon you do not have', () => {
    sheetState.sheet = { system: 'cities_without_number', data: { weapon1_name: 'Knife' } };
    show('gun_shop');
    const row = screen.getByRole('button', { name: 'Buy Sword' }).closest('tr')!;
    expect(within(row).queryByText(/^x\d/)).toBeNull();
  });
});

describe('encumbrance can refuse a sale', () => {
  /**
   * Only where the table asked for it. The house rule is off by default, and with it off
   * a shop has no business telling anyone what they can lift.
   */
  const heavy = { str: 4 };  // Stowed allowance of 4

  it('refuses a weapon that will not fit the Stowed allowance', async () => {
    sheetState.encumbranceEnforced = true;
    sheetState.sheet = {
      system: 'cities_without_number',
      data: { ...heavy, weapon1_name: 'gun', weapon1_enc: '3', weapon1_carry: 'stowed' },
    };
    show('gun_shop');
    await userEvent.click(screen.getByRole('button', { name: 'Buy Automatic Rifle' }));

    expect(screen.getByText(/Too much to carry/)).toBeInTheDocument();
    expect(handleFieldsChange).not.toHaveBeenCalled();
  });

  it('allows one that does fit', async () => {
    sheetState.encumbranceEnforced = true;
    sheetState.sheet = { system: 'cities_without_number', data: heavy };
    show('gun_shop');
    await userEvent.click(screen.getByRole('button', { name: 'Buy Knife' }));
    expect(handleFieldsChange).toHaveBeenCalled();
  });

  it('says nothing about weight while the house rule is off', async () => {
    sheetState.encumbranceEnforced = false;
    sheetState.sheet = { system: 'cities_without_number', data: heavy };
    show('gun_shop');
    await userEvent.click(screen.getByRole('button', { name: 'Buy Automatic Rifle' }));

    expect(screen.queryByText(/Too much to carry/)).toBeNull();
    expect(handleFieldsChange).toHaveBeenCalled();
  });
});

describe('sorting the shelf', () => {
  /**
   * Three states, not two. A shelf has a natural order - the book's, which groups pistols
   * with pistols - and after sorting by price there would otherwise be no way back to it
   * short of closing the window.
   */
  const names = () =>
    screen.getAllByRole('button', { name: /^Buy / })
      .map((b) => b.getAttribute('aria-label')!.replace('Buy ', ''));

  const clickHeader = (label: string) =>
    userEvent.click(screen.getByRole('columnheader', { name: new RegExp(`^Sort by ${label}$`) }));

  it('starts in the order the book prints', () => {
    show('gun_shop');
    // Light Pistol is the first line of the firearms table.
    expect(names()[0]).toBe('Light Pistol');
  });

  it('sorts names A-Z on the first click, and Z-A on the second', async () => {
    show('gun_shop');
    await clickHeader('NAME');
    const az = names();
    expect(az).toEqual([...az].sort((a, b) => a.localeCompare(b)));

    await clickHeader('NAME');
    expect(names()).toEqual([...az].reverse());
  });

  it('returns to the book order on the third click', async () => {
    show('gun_shop');
    const original = names();
    await clickHeader('NAME');
    await clickHeader('NAME');
    await clickHeader('NAME');
    expect(names()).toEqual(original);
  });

  it('starts price at the most expensive, because that is the useful end', async () => {
    show('gun_shop');
    await clickHeader('PRICE');
    // Automatic Rifle and Heavy Machine Gun are the 10,000cr lines.
    expect(names()[0]).toMatch(/Automatic Rifle|Heavy Machine Gun/);

    await clickHeader('PRICE');
    // Cheapest last time round: the Club is priced N/A, which reads as 0.
    expect(names()[0]).toBe('Club');
  });

  it('sorts a numeric column as numbers, not as text', async () => {
    // "10/80" against "100/300": sorted as strings, 100 comes before 30.
    show('gun_shop');
    await clickHeader('RANGE');
    expect(names()[0]).toMatch(/Sniper Rifle|Rocket Launcher|Anti-Materiel Rifle|Mortar/);
  });

  it('only ever sorts by one column', async () => {
    show('gun_shop');
    await clickHeader('PRICE');
    await clickHeader('NAME');
    const byName = names();
    expect(byName).toEqual([...byName].sort((a, b) => a.localeCompare(b)));
  });

  it('sorts the ripperdoc the same way', async () => {
    show('ripperdoc');
    await clickHeader('NAME');
    const az = names();
    expect(az).toEqual([...az].sort((a, b) => a.localeCompare(b)));
  });

  it('keeps sorting after a filter is typed', async () => {
    show('gun_shop');
    await clickHeader('NAME');
    await userEvent.type(screen.getByLabelText('Filter stock'), 'grenade');
    const shown = names();
    expect(shown.length).toBeGreaterThan(1);
    expect(shown).toEqual([...shown].sort((a, b) => a.localeCompare(b)));
  });
});

describe('showing one kind of weapon', () => {
  /**
   * Split on the SKILL, not on the book's table: the melee table also holds grenades, and
   * a thrown grenade is not a melee weapon.
   */
  const names = () =>
    screen.getAllByRole('button', { name: /^Buy / })
      .map((b) => b.getAttribute('aria-label')!.replace('Buy ', ''));

  const toggle = (label: string) => userEvent.click(screen.getByRole('button', { name: label }));

  it('shows everything with neither pressed', () => {
    show('gun_shop');
    expect(names()).toContain('Heavy Pistol');
    expect(names()).toContain('Sword');
  });

  it('narrows to ranged when only RANGED is pressed', async () => {
    show('gun_shop');
    await toggle('RANGED');
    expect(names()).toContain('Heavy Pistol');
    expect(names()).not.toContain('Sword');
  });

  it('narrows to melee when only MELEE is pressed', async () => {
    show('gun_shop');
    await toggle('MELEE');
    expect(names()).toContain('Sword');
    expect(names()).not.toContain('Heavy Pistol');
  });

  it('counts a thrown grenade as ranged, whatever table it is printed in', async () => {
    // The book prints grenades with the melee weapons. They are thrown, and they roll
    // Shoot, so a player looking for something to throw expects them under RANGED.
    show('gun_shop');
    await toggle('RANGED');
    expect(names()).toContain('Grenade, Frag');

    await toggle('RANGED');
    await toggle('MELEE');
    expect(names()).not.toContain('Grenade, Frag');
  });

  it('shows everything again with both pressed, rather than nothing', async () => {
    // Both on and both off mean the same thing - no opinion - so neither empties the shelf.
    show('gun_shop');
    await toggle('RANGED');
    await toggle('MELEE');
    expect(names()).toContain('Heavy Pistol');
    expect(names()).toContain('Sword');
  });

  it('says which are pressed', async () => {
    show('gun_shop');
    expect(screen.getByRole('button', { name: 'RANGED' })).toHaveAttribute('aria-pressed', 'false');
    await toggle('RANGED');
    expect(screen.getByRole('button', { name: 'RANGED' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('still sorts and filters what it has narrowed to', async () => {
    show('gun_shop');
    await toggle('MELEE');
    await userEvent.click(screen.getByRole('columnheader', { name: 'Sort by NAME' }));
    const shown = names();
    expect(shown).toEqual([...shown].sort((a, b) => a.localeCompare(b)));
    expect(shown).not.toContain('Heavy Pistol');
  });
});
