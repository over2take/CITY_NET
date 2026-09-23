/**
 * The shop: what a building carries, and what pressing BUY costs.
 *
 * This file used to test the opposite - that the shop was inert and said so - because for
 * a while it was. Now that money moves, the property worth defending is **paid for, then
 * owned**: nothing reaches a sheet until the server says the account was charged. Several
 * tests below exist only to pin that ordering, and the fake socket replies rather than
 * stubbing so that the ordering is real rather than assumed.
 *
 * What the shop cannot decide is deliberately tested too. The price is not in the message
 * it sends, and a shortfall is a question rather than a decision.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShopWindow } from '../ShopWindow';

// The hook is the sheet's own business; what matters here is what the shop does with it.
const sheetState: { sheet: any; encumbranceEnforced: boolean; overdraftAllowed: boolean } = {
  sheet: { system: 'cities_without_number', data: {} },
  encumbranceEnforced: false,
  overdraftAllowed: false,
};
const handleFieldChange = vi.fn();
const handleFieldsChange = vi.fn();
vi.mock('../../hooks/usePlayerSheet', () => ({
  usePlayerSheet: () => ({
    sheet: sheetState.sheet,
    handleFieldChange,
    handleFieldsChange,
    encumbranceEnforced: sheetState.encumbranceEnforced,
    overdraftAllowed: sheetState.overdraftAllowed,
  }),
}));
import {
  BUILDING_TYPES, CATALOGUES, isShop, buildingTypeById, shopsAvailable, shelvedCatalogues,
} from '../../data/buildingTypes';
import { CWN_WEAPON_ROWS } from '../../sheets/templates/cities_without_number';
import { CWN_CYBERWARE } from '../../sheets/cwnCyberwarePresets';

/**
 * A socket that answers the way the server does.
 *
 * Buying became a round trip when the bank was wired up: the window sends `buyFromShop`,
 * the server charges, and only the receipt puts anything on the sheet. A stub that never
 * replies would make every purchase here look like a no-op, so this replies - and that is
 * worth having rather than working around, because "the item arrives only once it is paid
 * for" is the property most worth keeping.
 *
 * `bank.balance` is deliberately huge by default so the money is not what these tests are
 * about; the ones that care set it themselves.
 */
const bank = { balance: 10_000_000, debt: 0 };
/** Every buyFromShop that went out, so a test can check what was asked for. */
let sent: any[] = [];
/** Set to a reason to make the fake server refuse the next purchase. */
let refuseWith: string | null = null;

/** The listeners of the socket most recently handed to a window, so a test can push to it. */
let live: Record<string, Function[]> = {};

const makeSocket = () => {
  const listeners: Record<string, Function[]> = {};
  live = listeners;
  const socket: any = {
    on: (ev: string, fn: Function) => { (listeners[ev] ||= []).push(fn); },
    off: (ev: string, fn: Function) => {
      listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn);
    },
    emit: (ev: string, payload?: any) => {
      // requestBankBalance is answered by show() after mount rather than here: this emit
      // happens inside the window's own mount effect, and a state update pushed from
      // inside that effect does not land.
      if (ev === 'buyFromShop') {
        sent.push(payload);
        act(() => (listeners.shopPurchase || []).forEach((f) => f(
          refuseWith
            ? { ok: false, reason: refuseWith, catalogue: payload.catalogue, itemId: payload.itemId }
            : { ok: true, catalogue: payload.catalogue, itemId: payload.itemId, settled: payload.settle ?? 'balance' },
        )));
      }
    },
  };
  return socket;
};

const show = (buildingType: string, name = 'Doc Wu') => {
  const result = render(<ShopWindow name={name} locationId={7} buildingType={buildingType}
    socket={makeSocket()} userName="JADE" onClose={vi.fn()} />);
  // The server broadcasts the balance in answer to the window's request. Delivered here,
  // after mount, because that is when a state update actually lands.
  act(() => (live.bankUpdate || []).forEach((f) => f({ username: 'JADE', ...bank })));
  return result;
};

beforeEach(() => {
  handleFieldChange.mockClear();
  handleFieldsChange.mockClear();
  sheetState.sheet = { system: 'cities_without_number', data: {} };
  sheetState.encumbranceEnforced = false;
  sheetState.overdraftAllowed = false;
  bank.balance = 10_000_000;
  bank.debt = 0;
  sent = [];
  refuseWith = null;
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

  it('says where a bought piece lands, which is the part nobody can guess', () => {
    /**
     * This line has been rewritten twice as the feature caught up with it. It read
     * "NOTHING IS CHARGED YET" while BUY was inert, then "BUY CHARGES YOUR ACCOUNT" once
     * the bank was wired up - and that second one was not worth saying either, because a
     * BUY button taking your money is not news.
     *
     * What survives is the half a player cannot work out: owning a piece of chrome and
     * having it installed are different things, and buying only does the first.
     */
    show('ripperdoc');
    expect(screen.getByText(/GOES INTO YOUR AUGMENTS, UNPLACED/)).toBeInTheDocument();
    expect(screen.queryByText(/CHARGES YOUR ACCOUNT/)).toBeNull();
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
  /**
   * This used to be the gun shop, then the clinic, then the garage - each one lost the
   * role as its shelf got written. Every shop type now carries at least one catalogue, so
   * the only thing that reaches the empty branch is a building that does not trade at all.
   * The branch is kept, and kept tested, because `sells` is allowed to name a catalogue
   * with no shelf behind it and one day will again.
   */
  it('says so rather than showing an empty table', () => {
    show('bar');
    expect(screen.getByText(/NO CATALOGUE FOR THIS SHOP YET/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Filter stock')).not.toBeInTheDocument();
  });

  it('sells weapons at the gun shop now, which it did not', () => {
    show('gun_shop');
    expect(screen.queryByText(/NO CATALOGUE FOR THIS SHOP YET/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Buy Heavy Pistol' })).toBeInTheDocument();
  });

  it('leaves no shop with an empty shelf', () => {
    // The assertion the three rewrites above were converging on. If a new storefront is
    // added with nothing it can show, this is what says so.
    for (const t of BUILDING_TYPES.filter((x) => x.shop)) {
      expect(shelvedCatalogues(t.id), `${t.id} has nothing to sell`).not.toEqual([]);
    }
  });
});

describe('one tab per catalogue', () => {
  it('draws no tab row for a shop that carries one catalogue', () => {
    // A lone tab is a label wearing a button's clothes.
    show('clinic');
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('draws a tab for each catalogue a shop carries', () => {
    show('gun_shop');
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['WEAPONS', 'WEAPON MODS']);
  });

  it('opens on the first catalogue, and switches to the one picked', async () => {
    show('gun_shop');
    expect(screen.getByRole('button', { name: 'Buy Heavy Pistol' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'WEAPON MODS' }));

    // The weapons are gone and the mods are there: a switch, not an append.
    expect(screen.queryByRole('button', { name: 'Buy Heavy Pistol' })).toBeNull();
    expect(screen.getByText('EXTENDED MAG')).toBeInTheDocument();
  });

  it('clears a filter that belonged to the shelf being left', async () => {
    // Otherwise the new shelf opens already narrowed by something typed about another list.
    show('gun_shop');
    await userEvent.type(screen.getByLabelText('Filter stock'), 'pistol');
    await userEvent.click(screen.getByRole('tab', { name: 'WEAPON MODS' }));
    expect(screen.getByLabelText('Filter stock')).toHaveValue('');
  });

  /**
   * App.tsx renders this with no `key`, so clicking a second shop without closing the
   * first re-renders in place rather than remounting - the case below.
   *
   * Caught in a browser rather than here: the open shelf used to be state kept in step by
   * an effect, and the switch rendered one frame of the PREVIOUS shop's shelf, a general
   * store headed "CWN P50" over fourteen rows of armor. **This test does not catch that
   * frame** - `rerender` flushes effects inside `act`, so the effect version passes it
   * too, which was confirmed by putting the effect back. What makes the flash impossible
   * is that the shelf is now derived during the render and there is no state left to go
   * stale. What this pins is the end state, which is still worth pinning.
   */
  it('shows the new shelf when the window is pointed at another shop', () => {
    const { rerender } = show('armorer');
    expect(screen.getByText('War Harness')).toBeInTheDocument();

    rerender(<ShopWindow name="Doc Wu" buildingType="general_store"
      socket={{ on: vi.fn(), off: vi.fn(), emit: vi.fn() }} userName="JADE" onClose={vi.fn()} />);

    expect(screen.queryByText('War Harness')).toBeNull();
    expect(screen.getByText('Climbing kit')).toBeInTheDocument();
    // The header has to agree with the table under it - that mismatch was the tell.
    expect(screen.getByText(/CWN P50/)).toBeInTheDocument();
  });

  it('gives the armorer both of its tables, which it had neither of', () => {
    show('armorer');
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['ARMOR', 'ARMOR MODS']);
  });
});

describe('the vocabulary the map is labelled with', () => {
  it('only lets shops declare stock', () => {
    // Empty rather than null since `sells` became a list: a shop can carry several
    // catalogues, and a bar carries none.
    for (const t of BUILDING_TYPES) if (!t.shop) expect(t.sells).toEqual([]);
  });

  it('never names a catalogue the book does not have', () => {
    const known = new Set(CATALOGUES.map((c) => c.id));
    for (const t of BUILDING_TYPES) {
      for (const s of t.sells) expect(known, `${t.id} sells ${s}`).toContain(s);
    }
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
    // The catalogue list is mirrored too, and it carries the book pages a price can be
    // checked against - two copies of a page number is exactly the kind of thing that
    // drifts silently.
    expect(CATALOGUES).toEqual(backend.default.CATALOGUES);
  });

  it('agrees with the server about what is on a shelf', async () => {
    // Not just the data but the derivation: the window hides a catalogue the server would
    // still name in `sells`, and the two have to draw that line in the same place.
    const backend = await import('../../../../backend/buildingTypes.js');
    for (const t of BUILDING_TYPES) {
      expect(shelvedCatalogues(t.id), t.id).toEqual(backend.default.shelvedCatalogues(t.id));
    }
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

  it('raises its voice only when something is actually wrong', () => {
    /**
     * The same line does two jobs, and they are not equally urgent. "No sheet loaded"
     * means nothing on this shelf will work; "goes into your augments, unplaced" is a
     * label. Both used to be amber, which spends a warning colour on a caption and leaves
     * nothing louder for the real problem.
     */
    sheetState.sheet = null;
    const { unmount } = show('ripperdoc');
    expect(screen.getByText(/NO CHARACTER SHEET LOADED/)).toHaveStyle({
      color: 'var(--warning)',
    });
    unmount();

    sheetState.sheet = { system: 'cities_without_number', data: {} };
    show('ripperdoc');
    expect(screen.getByText(/GOES INTO YOUR AUGMENTS/)).toHaveStyle({
      color: 'var(--grid-section)',
    });
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

  it('says where the weapon went, and that it is not in your hands', () => {
    // Stowed rather than Readied is a real distinction on the sheet, and the only place
    // it gets said is here.
    show('gun_shop');
    expect(screen.getByText(/GOES INTO A WEAPON SLOT, STOWED/)).toBeInTheDocument();
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

describe('paying for it', () => {
  const heavyPistol = () => screen.getByRole('button', { name: 'Buy Heavy Pistol' });

  it('asks the server to charge, naming the catalogue and the item but never a price', async () => {
    // The price is deliberately absent from the message. The server looks it up, so a
    // crafted client cannot name its own.
    show('gun_shop');
    await userEvent.click(heavyPistol());

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ locationId: 7, catalogue: 'weapons', itemId: 'heavy_pistol' });
    expect(sent[0]).not.toHaveProperty('price');
  });

  it('puts nothing on the sheet until the purchase comes back paid', async () => {
    // The property most worth keeping: paid for, then owned. The fake server here is
    // told to refuse, and the weapon must not appear.
    refuseWith = 'funds';
    show('gun_shop');
    await userEvent.click(heavyPistol());

    expect(handleFieldsChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Not enough credits/)).toBeInTheDocument();
  });

  it('places the item once the receipt arrives', async () => {
    show('gun_shop');
    await userEvent.click(heavyPistol());
    expect(handleFieldsChange).toHaveBeenCalled();
  });

  it('says why when the server refuses for a reason of its own', async () => {
    refuseWith = 'not_sold';
    show('gun_shop');
    await userEvent.click(heavyPistol());
    expect(screen.getByText(/does not sell that/i)).toBeInTheDocument();
  });

  it('shows what you have to spend', () => {
    bank.balance = 4250;
    show('gun_shop');
    expect(screen.getByText(/4,250cr/)).toBeInTheDocument();
  });

  it('shows a debt alongside the balance', () => {
    bank.balance = 100;
    bank.debt = 900;
    show('gun_shop');
    expect(screen.getByText(/900cr OWED/)).toBeInTheDocument();
  });
});

describe('when you cannot afford it', () => {
  const heavyPistol = () => screen.getByRole('button', { name: 'Buy Heavy Pistol' });

  it('refuses outright while the house rule is off, without troubling the server', async () => {
    bank.balance = 5;
    show('gun_shop');
    await userEvent.click(heavyPistol());

    expect(sent).toHaveLength(0);
    expect(screen.getByText(/Not enough credits/)).toBeInTheDocument();
    expect(handleFieldsChange).not.toHaveBeenCalled();
  });

  it('asks how to cover it when the house rule is on, and sends nothing yet', async () => {
    sheetState.overdraftAllowed = true;
    bank.balance = 5;
    show('gun_shop');
    await userEvent.click(heavyPistol());

    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('button', { name: 'TAKE DEBT' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'GO NEGATIVE' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'CANCEL' })).toBeInTheDocument();
    // Nothing has been charged while the question is on screen.
    expect(sent).toHaveLength(0);
  });

  it('sends the choice the player made', async () => {
    sheetState.overdraftAllowed = true;
    bank.balance = 5;
    show('gun_shop');
    await userEvent.click(heavyPistol());
    await userEvent.click(screen.getByRole('button', { name: 'TAKE DEBT' }));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ settle: 'debt', itemId: 'heavy_pistol' });
    expect(handleFieldsChange).toHaveBeenCalled();
  });

  it('sends the other choice when that is the one picked', async () => {
    sheetState.overdraftAllowed = true;
    bank.balance = 5;
    show('gun_shop');
    await userEvent.click(heavyPistol());
    await userEvent.click(screen.getByRole('button', { name: 'GO NEGATIVE' }));

    expect(sent[0]).toMatchObject({ settle: 'balance' });
  });

  it('buys nothing at all on cancel', async () => {
    sheetState.overdraftAllowed = true;
    bank.balance = 5;
    show('gun_shop');
    await userEvent.click(heavyPistol());
    await userEvent.click(screen.getByRole('button', { name: 'CANCEL' }));

    expect(sent).toHaveLength(0);
    expect(handleFieldsChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('checks the weapon rack before the wallet', async () => {
    // A full rack is a reason not to sell at all. Asking someone to go into debt for
    // something that cannot be delivered would be the wrong question.
    sheetState.overdraftAllowed = true;
    bank.balance = 5;
    const full: Record<string, string> = {};
    for (let i = 1; i <= CWN_WEAPON_ROWS; i += 1) full[`weapon${i}_name`] = `Gun ${i}`;
    sheetState.sheet = { system: 'cities_without_number', data: full };
    show('gun_shop');
    await userEvent.click(heavyPistol());

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText(/No free weapon slot/)).toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });
});

describe('the garage sells vehicles', () => {
  /**
   * A second route to a vehicle, not a replacement for the first.
   *
   * The sheet's TYPE dropdown has always filled a vehicle slot from a preset, and still
   * does. The shop reaches the same place through the same function, so a car bought over
   * a counter cannot end up shaped differently from one picked on the sheet.
   */
  it('carries the whole book table', () => {
    show('garage');
    expect(screen.getByRole('tab', { name: 'VEHICLES' })).toBeInTheDocument();
    expect(screen.getByText('MOTORCYCLE')).toBeInTheDocument();
    expect(screen.getByText('TANK')).toBeInTheDocument();
  });

  it('fills the first free vehicle slot with the whole stat block', async () => {
    show('garage');
    await userEvent.click(screen.getByRole('button', { name: 'Buy MOTORCYCLE' }));

    const written = handleFieldsChange.mock.calls[0][0];
    // The sheet's own preset function, so these are the sheet's own field names.
    expect(written).toMatchObject({
      vehicle1_name: 'MOTORCYCLE',
      vehicle1_type: 'motorcycle',
      vehicle1_hp: 10,
      vehicle1_hp_max: 10,
      vehicle1_crew: 1,
      vehicle1_armor: 4,
    });
  });

  it('takes the next slot when the first is occupied', async () => {
    sheetState.sheet = {
      system: 'cities_without_number',
      data: { vehicle1_name: 'Betty', vehicle2_name: 'Spare' },
    };
    show('garage');
    await userEvent.click(screen.getByRole('button', { name: 'Buy MOTORCYCLE' }));
    expect(handleFieldsChange.mock.calls[0][0]).toHaveProperty('vehicle3_name', 'MOTORCYCLE');
  });

  it('carries the immunity rule into the notes, not an invented armor number', async () => {
    // The * and ** vehicles have no Armour Rating at all. A Tank bought without its note
    // would silently lose the line saying small arms cannot touch it.
    show('garage');
    await userEvent.click(screen.getByRole('button', { name: 'Buy TANK' }));

    const written = handleFieldsChange.mock.calls[0][0];
    expect(written).not.toHaveProperty('vehicle1_armor');
    expect(String(written.vehicle1_notes)).toMatch(/Traumatic Hits/);
  });

  it('refuses when every slot is full, rather than dropping the car', async () => {
    const full: Record<string, string> = {};
    for (let i = 1; i <= 6; i += 1) full[`vehicle${i}_name`] = `Car ${i}`;
    sheetState.sheet = { system: 'cities_without_number', data: full };
    show('garage');
    await userEvent.click(screen.getByRole('button', { name: 'Buy MOTORCYCLE' }));

    expect(handleFieldsChange).not.toHaveBeenCalled();
    expect(screen.getByText(/No free vehicle slot/)).toBeInTheDocument();
  });

  it('shows what you already have parked', async () => {
    sheetState.sheet = {
      system: 'cities_without_number',
      data: { vehicle1_name: 'Betty', vehicle1_type: 'motorcycle' },
    };
    show('garage');
    const row = screen.getByText('MOTORCYCLE').closest('tr')!;
    expect(within(row).getByText('x1')).toBeInTheDocument();
  });
});

describe('the clinic sells pharmaceuticals', () => {
  it('carries the whole book table', () => {
    show('clinic');
    expect(screen.getByText(/16 LINES/)).toBeInTheDocument();
    expect(screen.getByText('BONESHAKER')).toBeInTheDocument();
    expect(screen.getByText('TRAUMA PATCH')).toBeInTheDocument();
  });

  it('says where a dose lands', () => {
    show('clinic');
    expect(screen.getByText(/A DOSE GOES INTO YOUR INVENTORY, STOWED/)).toBeInTheDocument();
  });

  it('says which three actually change a number', () => {
    // The shelf sells sixteen and the sheet rolls with three. A player choosing Psycho
    // should learn that here rather than by watching nothing happen.
    show('clinic');
    expect(screen.getByText(/Boneshaker, Olympus and Avalanche change a number/)).toBeInTheDocument();
  });

  it('flags the one you need a Contact for', () => {
    show('clinic');
    expect(screen.getByTitle('Needs a Contact to obtain')).toBeInTheDocument();
  });

  it('buys a dose into the inventory', async () => {
    show('clinic');
    await userEvent.click(screen.getByRole('button', { name: 'Buy BONESHAKER' }));
    const [field, value] = handleFieldChange.mock.calls[0];
    expect(field).toBe('inventory');
    expect(JSON.parse(value)).toEqual([
      expect.objectContaining({ name: 'BONESHAKER', qty: 1, carry: 'stowed' }),
    ]);
  });

  it('stacks onto the row it already has rather than adding a second', async () => {
    sheetState.sheet = {
      system: 'cities_without_number',
      data: {
        inventory: JSON.stringify([
          { name: 'BONESHAKER', qty: 2, enc: '', bundled: false, carry: 'stowed', location: '' },
        ]),
      },
    };
    show('clinic');
    await userEvent.click(screen.getByRole('button', { name: 'Buy BONESHAKER' }));
    const parsed = JSON.parse(handleFieldChange.mock.calls[0][1]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].qty).toBe(3);
  });

  it('leaves other inventory rows alone', async () => {
    sheetState.sheet = {
      system: 'cities_without_number',
      data: {
        inventory: JSON.stringify([
          { name: 'Rope', qty: 1, enc: '2', bundled: false, carry: 'stowed', location: '' },
        ]),
      },
    };
    show('clinic');
    await userEvent.click(screen.getByRole('button', { name: 'Buy OLYMPUS' }));
    const parsed = JSON.parse(handleFieldChange.mock.calls[0][1]);
    expect(parsed.map((i: { name: string }) => i.name)).toEqual(['Rope', 'OLYMPUS']);
  });

  it('shows what you already own, stash included', () => {
    // The shelf reports what you own; the sheet decides what you can inject. A box in a
    // locker is still yours.
    sheetState.sheet = {
      system: 'cities_without_number',
      data: {
        inventory: JSON.stringify([
          { name: 'Olympus', qty: 2, enc: '', bundled: false, carry: 'stowed', location: '' },
          { name: 'Olympus', qty: 1, enc: '', bundled: false, carry: 'stash', location: 'the safe' },
        ]),
      },
    };
    show('clinic');
    expect(screen.getByText('x3')).toBeInTheDocument();
  });

  it('never refuses, because a dose is pocket-sized', async () => {
    // The gun shop has to say no when the slots are full. Nothing here is finite, so a
    // refusal would be a rule the app invented.
    sheetState.encumbranceEnforced = true;
    sheetState.sheet = { system: 'cities_without_number', data: { str: 3 } };
    show('clinic');
    await userEvent.click(screen.getByRole('button', { name: 'Buy RESET' }));
    expect(handleFieldChange).toHaveBeenCalled();
  });

  it('sorts by price without disturbing the book order first', async () => {
    show('clinic');
    const rows = () => screen.getAllByRole('row').slice(1).map((r) => r.cells[0].textContent);
    expect(rows()[0]).toBe('AVALANCHE');
    await userEvent.click(screen.getByLabelText('Sort by PRICE'));
    expect(rows()[0]).toContain('RESET');
    await userEvent.click(screen.getByLabelText('Sort by PRICE'));
    expect(rows()[0]).toBe('SAND');
  });
});

describe('the shelf marks what is dangerous to swallow', () => {
  it('flags the four hostile drugs', () => {
    // Dead metadata until now: nothing read `hostile`, so Pillow had drifted out of the
    // set without anything noticing. Worth knowing at the counter.
    show('clinic');
    expect(screen.getAllByTitle('Hostile — administered to someone else')).toHaveLength(4);
  });

  it('keeps the Contact marker separate from it', () => {
    show('clinic');
    expect(screen.getAllByTitle('Needs a Contact to obtain')).toHaveLength(1);
  });
});
