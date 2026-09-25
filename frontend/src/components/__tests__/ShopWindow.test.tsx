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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
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
  typeLabel, catalogueLabel, SHOP_SYSTEMS,
} from '../../data/buildingTypes';
import { CWN_WEAPON_ROWS } from '../../sheets/templates/cities_without_number';
import { CWN_CYBERWARE } from '../../sheets/cwnCyberwarePresets';
import { loadUploaded, clearUploaded } from '../../sheets/uploadedCatalogues';

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
/** Set to a reason to make the fake server refuse the next purchase or sale. */
let refuseWith: string | null = null;
/** Every sellToShop that went out. */
let sold: any[] = [];
/** Every checkoutShop, whole. */
let checkouts: any[] = [];
/** What the fake server says a sale came to. */
let salePayout = 0;
let saleFromBody = 0;

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
      if (ev === 'sellToShop') {
        sold.push(payload);
        act(() => (listeners.shopSale || []).forEach((f) => f(
          refuseWith
            ? { ok: false, reason: refuseWith }
            : { ok: true, payout: salePayout, fromBody: saleFromBody },
        )));
      }
      /**
       * The cart settles everything in one message now. Recorded into the same two lists
       * the separate buy and sell messages used to fill - one entry per thing bought, one
       * per sale - so what a test says about what went out still reads the same.
       */
      if (ev === 'checkoutShop') {
        checkouts.push(payload);
        for (const b of payload.buys) {
          for (let i = 0; i < b.qty; i += 1) {
            sent.push({ locationId: payload.locationId, catalogue: b.catalogue, itemId: b.itemId, settle: payload.settle });
          }
        }
        if (payload.sells.length) sold.push({ locationId: payload.locationId, items: payload.sells });
        act(() => (listeners.shopCheckout || []).forEach((f) => f(
          refuseWith
            ? { ok: false, reason: refuseWith }
            : {
              ok: true, payout: salePayout, fromBody: saleFromBody, net: payload.expectedNet,
              settled: payload.settle ?? 'balance', balance: bank.balance - payload.expectedNet, debt: bank.debt,
            },
        )));
      }
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

const show = (buildingType: string, name = 'Doc Wu', system = 'cities_without_number') => {
  const result = render(<ShopWindow name={name} locationId={7} buildingType={buildingType}
    system={system} buybackPct={45} socket={makeSocket()} userName="JADE" onClose={vi.fn()} />);
  // The server broadcasts the balance in answer to the window's request. Delivered here,
  // after mount, because that is when a state update actually lands.
  act(() => (live.bankUpdate || []).forEach((f) => f({ username: 'JADE', ...bank })));
  return result;
};

const openFolder = (name: string) => userEvent.click(screen.getByRole('tab', { name }));

/** What the CART folder's tab says, which counts what is in it. */
const cartTab = () => screen.getByRole('tab', { name: 'CART' }).textContent;

/**
 * Buy one of something the way a player now does: + CART on the shelf, open the CART,
 * CHECK OUT.
 *
 * When + CART refuses - a full weapon rack, too much to carry - the cart does not change,
 * and this stays on the shelf where the reason is shown rather than walking off to an
 * empty cart.
 */
const buyNow = async (label: string) => {
  if (!screen.queryByRole('button', { name: `Add ${label} to the cart` })) await openFolder('BUY');
  const before = cartTab();
  await userEvent.click(screen.getByRole('button', { name: `Add ${label} to the cart` }));
  if (cartTab() === before) return;
  await openFolder('CART');
  await userEvent.click(screen.getByRole('button', { name: 'CHECK OUT' }));
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
  sold = [];
  checkouts = [];
  refuseWith = null;
  salePayout = 0;
  saleFromBody = 0;
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

describe('looking like the windows it opens from', () => {
  it('is a terminal window: BUY, SELL and CART down the left, the list on the right', async () => {
    const { container } = show('ripperdoc');
    expect(container.querySelector('.win95-window')).toHaveClass('terminal-window');
    const folders = within(screen.getByRole('tablist', { name: 'Folders' })).getAllByRole('tab');
    expect(folders.map((f) => f.textContent)).toEqual(['BUY', 'SELL', 'CART']);
    // The filter is part of the BUY list, not the window.
    expect(within(screen.getByRole('tabpanel')).getByLabelText('Filter stock')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'SELL' }));
    expect(screen.queryByLabelText('Filter stock')).toBeNull();
  });

  it('keeps the filter and shelf tabs still while the list scrolls under them', () => {
    show('gun_shop');
    // The panel no longer scrolls as a whole; the table's own box does.
    expect(screen.getByRole('tabpanel').style.overflowY).toBe('hidden');
    expect(screen.getByRole('table').parentElement!.style.overflowY).toBe('auto');
  });

  it('shows the building in the corner when given one', () => {
    render(<ShopWindow name="Vic" locationId={7} buildingType="gun_shop" system="cities_without_number"
      buybackPct={45} socket={makeSocket()} userName="JADE" onClose={vi.fn()} preview={<div>VIC'S BUILDING</div>} />);
    expect(screen.getByText("VIC'S BUILDING")).toBeInTheDocument();
  });

  it('puts an empty shelf\'s message straight under the header, not at the bottom', async () => {
    show('ripperdoc');
    const box = () => screen.getByRole('table').parentElement as HTMLElement;
    // A full shelf's table takes the height and scrolls in it.
    expect(box().style.flex).not.toBe('0 0 auto');
    await userEvent.type(screen.getByLabelText('Filter stock'), 'zzzz');
    // An empty one does not, so the message follows the header instead of the window's foot.
    expect(box().style.flex).toBe('0 0 auto');
    expect(box().nextElementSibling).toBe(screen.getByTestId('shelf-empty'));
    expect(screen.getByTestId('shelf-empty').style.color).toBe('var(--green)');
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
    expect(screen.getByRole('button', { name: 'Add Heavy Pistol to the cart' })).toBeInTheDocument();
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
    expect(screen.queryByRole('tablist', { name: 'Catalogue' })).toBeNull();
  });

  it('draws a tab for each catalogue a shop carries', () => {
    show('gun_shop');
    const tabs = within(screen.getByRole('tablist', { name: 'Catalogue' })).getAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['WEAPONS', 'WEAPON MODS']);
  });

  it('opens on the first catalogue, and switches to the one picked', async () => {
    show('gun_shop');
    expect(screen.getByRole('button', { name: 'Add Heavy Pistol to the cart' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'WEAPON MODS' }));

    // The weapons are gone and the mods are there: a switch, not an append.
    expect(screen.queryByRole('button', { name: 'Add Heavy Pistol to the cart' })).toBeNull();
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

    rerender(<ShopWindow name="Doc Wu" locationId={7} buildingType="general_store"
      system="cities_without_number" buybackPct={45} socket={{ on: vi.fn(), off: vi.fn(), emit: vi.fn() }}
      userName="JADE" onClose={vi.fn()} />);

    expect(screen.queryByText('War Harness')).toBeNull();
    expect(screen.getByText('Climbing kit')).toBeInTheDocument();
    // The header has to agree with the table under it - that mismatch was the tell.
    expect(screen.getByText(/CWN P50/)).toBeInTheDocument();
  });

  it('gives the armorer both of its tables, which it had neither of', () => {
    show('armorer');
    const tabs = within(screen.getByRole('tablist', { name: 'Catalogue' })).getAllByRole('tab');
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

  it('offers shops under every system with a sheet, and nothing else', () => {
    for (const s of ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic']) {
      expect(shopsAvailable(s), s).toBe(true);
    }
    expect(shopsAvailable('dnd_5e')).toBe(false);
    expect(shopsAvailable(null)).toBe(false);
  });

  it('opens under the same systems the server does', async () => {
    // The server's gate is the systems whose sheet shapes it knows how to empty on a sale.
    // A system this side offered and that side refused would be a picker that only errors.
    const slots = await import('../../../../backend/shops/sheetSlots.js');
    expect([...SHOP_SYSTEMS].sort()).toEqual(Object.keys(slots.default.SLOTS).sort());
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
    expect(screen.getByRole('tab', { name: 'BUY' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'SELL' })).toHaveAttribute('aria-selected', 'false');
  });

  it('keeps selling off the stock list', async () => {
    // Selling reads what you are carrying, not what the shop stocks - a SELL button beside
    // the catalogue would be offering to sell you something you may not own.
    show('ripperdoc');
    expect(screen.queryByLabelText('Sell Cranial Jack')).not.toBeInTheDocument();
  });

  it('says so plainly when there is nothing this shop would buy', async () => {
    // Used to assert "SELLING IS NOT WIRED UP YET", which stopped being true.
    show('ripperdoc');
    await userEvent.click(screen.getByRole('tab', { name: 'SELL' }));
    expect(screen.getByText(/NOTHING HERE THIS SHOP WOULD BUY/)).toBeInTheDocument();
  });

  it('puts the stock away while selling', async () => {
    show('ripperdoc');
    await userEvent.click(screen.getByRole('tab', { name: 'SELL' }));
    expect(screen.queryByLabelText('Add Cranial Jack to the cart')).not.toBeInTheDocument();
  });
});

describe('buying a piece', () => {
  const buyFirst = async () => {
    show('ripperdoc');
    await buyNow('Cranial Jack');
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
    await buyNow('Coordination Augment I');
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
    await buyNow('Cranial Jack');
    const [, rows] = handleFieldChange.mock.calls[0];
    expect(rows.map((r: any) => r.name)).toEqual(['Old Chrome', 'Cranial Jack']);
  });

  it('shows that the press did something', async () => {
    show('ripperdoc');
    await userEvent.click(screen.getByLabelText('Add Cranial Jack to the cart'));
    expect(screen.getByLabelText('Add Cranial Jack to the cart')).toHaveTextContent('×1');
  });

  it('cannot buy with no sheet loaded, and says why', () => {
    sheetState.sheet = null;
    show('ripperdoc');
    expect(screen.getByLabelText('Add Cranial Jack to the cart')).toBeDisabled();
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
    await buyNow('Combat Rifle');

    expect(lastFields()).toMatchObject({
      weapon1_name: 'Combat Rifle', weapon1_dmg: '1d12', weapon1_skill: 'shoot',
      weapon1_attr: 'dex', weapon1_trauma: 'd8/x3', weapon1_enc: '2',
    });
  });

  it('lands it stowed rather than readied', async () => {
    show('gun_shop');
    await buyNow('Knife');
    expect(lastFields().weapon1_carry).toBe('stowed');
  });

  it('takes the next free slot when the first is used', async () => {
    sheetState.sheet = {
      system: 'cities_without_number',
      data: { weapon1_name: 'gun', weapon2_name: 'knife' },
    };
    show('gun_shop');
    await buyNow('Sword');
    expect(lastFields().weapon3_name).toBe('Sword');
  });

  it('refuses when every slot is full, rather than losing the weapon', async () => {
    const data: Record<string, unknown> = {};
    for (let i = 1; i <= CWN_WEAPON_ROWS; i += 1) data[`weapon${i}_name`] = 'gun';
    sheetState.sheet = { system: 'cities_without_number', data };
    show('gun_shop');
    await buyNow('Knife');

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
    const row = screen.getByRole('button', { name: 'Add Knife to the cart' }).closest('tr')!;
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
    const row = screen.getByRole('button', { name: 'Add Knife to the cart' }).closest('tr')!;
    expect(within(row).getByText('x2')).toBeInTheDocument();
  });

  it('shows nothing against a weapon you do not have', () => {
    sheetState.sheet = { system: 'cities_without_number', data: { weapon1_name: 'Knife' } };
    show('gun_shop');
    const row = screen.getByRole('button', { name: 'Add Sword to the cart' }).closest('tr')!;
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
    await buyNow('Automatic Rifle');

    expect(screen.getByText(/Too much to carry/)).toBeInTheDocument();
    expect(handleFieldsChange).not.toHaveBeenCalled();
  });

  it('allows one that does fit', async () => {
    sheetState.encumbranceEnforced = true;
    sheetState.sheet = { system: 'cities_without_number', data: heavy };
    show('gun_shop');
    await buyNow('Knife');
    expect(handleFieldsChange).toHaveBeenCalled();
  });

  it('says nothing about weight while the house rule is off', async () => {
    sheetState.encumbranceEnforced = false;
    sheetState.sheet = { system: 'cities_without_number', data: heavy };
    show('gun_shop');
    await buyNow('Automatic Rifle');

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
    screen.getAllByRole('button', { name: / to the cart$/ })
      .map((b) => b.getAttribute('aria-label')!.replace(/^Add /, '').replace(/ to the cart$/, ''));

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
    screen.getAllByRole('button', { name: / to the cart$/ })
      .map((b) => b.getAttribute('aria-label')!.replace(/^Add /, '').replace(/ to the cart$/, ''));

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
  const heavyPistol = () => screen.getByRole('button', { name: 'Add Heavy Pistol to the cart' });

  it('asks the server to charge, naming the catalogue and the item but never a price', async () => {
    // The price is deliberately absent from the message. The server looks it up, so a
    // crafted client cannot name its own.
    show('gun_shop');
    await buyNow('Heavy Pistol');

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ locationId: 7, catalogue: 'weapons', itemId: 'heavy_pistol' });
    expect(sent[0]).not.toHaveProperty('price');
  });

  it('puts nothing on the sheet until the purchase comes back paid', async () => {
    // The property most worth keeping: paid for, then owned. The fake server here is
    // told to refuse, and the weapon must not appear.
    refuseWith = 'funds';
    show('gun_shop');
    await buyNow('Heavy Pistol');

    expect(handleFieldsChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Not enough credits/)).toBeInTheDocument();
  });

  it('places the item once the receipt arrives', async () => {
    show('gun_shop');
    await buyNow('Heavy Pistol');
    expect(handleFieldsChange).toHaveBeenCalled();
  });

  it('says why when the server refuses for a reason of its own', async () => {
    refuseWith = 'not_sold';
    show('gun_shop');
    await buyNow('Heavy Pistol');
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
  const heavyPistol = () => screen.getByRole('button', { name: 'Add Heavy Pistol to the cart' });

  it('refuses outright while the house rule is off, without troubling the server', async () => {
    bank.balance = 5;
    show('gun_shop');
    await buyNow('Heavy Pistol');

    expect(sent).toHaveLength(0);
    expect(screen.getByText(/Not enough credits/)).toBeInTheDocument();
    expect(handleFieldsChange).not.toHaveBeenCalled();
  });

  it('asks how to cover it when the house rule is on, and sends nothing yet', async () => {
    sheetState.overdraftAllowed = true;
    bank.balance = 5;
    show('gun_shop');
    await buyNow('Heavy Pistol');

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
    await buyNow('Heavy Pistol');
    await userEvent.click(screen.getByRole('button', { name: 'TAKE DEBT' }));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ settle: 'debt', itemId: 'heavy_pistol' });
    expect(handleFieldsChange).toHaveBeenCalled();
  });

  it('sends the other choice when that is the one picked', async () => {
    sheetState.overdraftAllowed = true;
    bank.balance = 5;
    show('gun_shop');
    await buyNow('Heavy Pistol');
    await userEvent.click(screen.getByRole('button', { name: 'GO NEGATIVE' }));

    expect(sent[0]).toMatchObject({ settle: 'balance' });
  });

  it('buys nothing at all on cancel', async () => {
    sheetState.overdraftAllowed = true;
    bank.balance = 5;
    show('gun_shop');
    await buyNow('Heavy Pistol');
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
    await buyNow('Heavy Pistol');

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
    await buyNow('MOTORCYCLE');

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
    await buyNow('MOTORCYCLE');
    expect(handleFieldsChange.mock.calls[0][0]).toHaveProperty('vehicle3_name', 'MOTORCYCLE');
  });

  it('carries the immunity rule into the notes, not an invented armor number', async () => {
    // The * and ** vehicles have no Armour Rating at all. A Tank bought without its note
    // would silently lose the line saying small arms cannot touch it.
    show('garage');
    await buyNow('TANK');

    const written = handleFieldsChange.mock.calls[0][0];
    expect(written).not.toHaveProperty('vehicle1_armor');
    expect(String(written.vehicle1_notes)).toMatch(/Traumatic Hits/);
  });

  it('refuses when every slot is full, rather than dropping the car', async () => {
    const full: Record<string, string> = {};
    for (let i = 1; i <= 6; i += 1) full[`vehicle${i}_name`] = `Car ${i}`;
    sheetState.sheet = { system: 'cities_without_number', data: full };
    show('garage');
    await buyNow('MOTORCYCLE');

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
    await buyNow('BONESHAKER');
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
    await buyNow('BONESHAKER');
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
    await buyNow('OLYMPUS');
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
    await buyNow('RESET');
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

describe('the sell tab', () => {
  /** A character with something in three of the places a sheet keeps things. */
  const loaded = () => {
    sheetState.sheet = {
      system: 'cities_without_number',
      data: {
        inventory: JSON.stringify([{ name: 'Climbing kit', qty: 3 }]),
        weapon1_name: 'Heavy Pistol',
        cyberware: [{ name: 'Cranial Jack', placed: true }],
      },
    };
  };

  const openSell = async (type: string) => {
    show(type);
    await userEvent.click(screen.getByRole('tab', { name: 'SELL' }));
  };

  const addKit = () => screen.getByRole('button', { name: 'Add Climbing kit to the cart' });

  it('offers only what this shop deals in', async () => {
    // A gun shop buys guns. Not rope, not chrome.
    loaded();
    await openSell('gun_shop');
    expect(screen.getByText('Heavy Pistol')).toBeInTheDocument();
    expect(screen.queryByText('Climbing kit')).toBeNull();
    expect(screen.queryByText('Cranial Jack')).toBeNull();
  });

  it('has a filter on top of the list, like the buy side', async () => {
    loaded();
    await openSell('gun_shop');
    const filter = screen.getByLabelText('Filter what you can sell');
    await userEvent.type(filter, 'heavy');
    expect(screen.getByText('Heavy Pistol')).toBeInTheDocument();
    await userEvent.clear(filter);
    await userEvent.type(filter, 'zzz');
    expect(screen.queryByText('Heavy Pistol')).toBeNull();
    expect(screen.getByTestId('sell-empty')).toHaveTextContent('NOTHING MATCHES THAT');
  });

  it('shows another shop a different half of the same character', async () => {
    loaded();
    await openSell('ripperdoc');
    expect(screen.getByText('Cranial Jack')).toBeInTheDocument();
    expect(screen.queryByText('Heavy Pistol')).toBeNull();
  });

  it('counts how many you have', async () => {
    loaded();
    await openSell('general_store');
    const row = screen.getByText('Climbing kit').closest('tr')!;
    expect(within(row).getByText('×3')).toBeInTheDocument();
  });

  it('prices at the buy-back rate, not the book price', async () => {
    // Climbing kit is 150. At 45% that is 67, rounded down from 67.5.
    loaded();
    await openSell('general_store');
    const row = screen.getByText('Climbing kit').closest('tr')!;
    expect(within(row).getByText('67cr')).toBeInTheDocument();
  });

  it('sells nothing until the cart is checked out', async () => {
    loaded();
    await openSell('general_store');
    await userEvent.click(addKit());
    expect(sold).toHaveLength(0);
    await openFolder('CART');
    expect(sold).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'CHECK OUT' }));
    expect(sold).toHaveLength(1);
  });

  it('sends what was in the cart, and no price at all', async () => {
    // The payout is the server's to decide, so the message carries no money.
    loaded();
    await openSell('general_store');
    await userEvent.click(addKit());
    await userEvent.click(addKit());
    await openFolder('CART');
    await userEvent.click(screen.getByRole('button', { name: 'CHECK OUT' }));

    expect(sold[0]).toMatchObject({ locationId: 7 });
    expect(sold[0].items).toEqual([
      { catalogue: 'gear', id: 'climbing_kit', label: 'Climbing kit', qty: 2 },
    ]);
    const sells = JSON.stringify(checkouts[0].sells);
    expect(sells).not.toMatch(/price|payout|each/);
  });

  it('will not put more in the cart than you have', async () => {
    loaded();
    await openSell('general_store');
    for (let i = 0; i < 6; i += 1) await userEvent.click(addKit());
    // Three owned, so three in the cart and the button is spent.
    expect(addKit()).toBeDisabled();
    expect(cartTab()).toBe('CART · 3');
  });

  it('counts down what is left as things go in the cart', async () => {
    loaded();
    await openSell('general_store');
    await userEvent.click(addKit());
    const row = screen.getByText('Climbing kit').closest('tr')!;
    // Three owned, one in the cart, so two are still there to sell.
    expect(within(row).getByText('×2')).toBeInTheDocument();
  });

  it('takes one back out with −', async () => {
    loaded();
    await openSell('general_store');
    await userEvent.click(addKit());
    await userEvent.click(addKit());
    await userEvent.click(screen.getByRole('button', { name: 'Take Climbing kit out of the cart' }));
    expect(cartTab()).toBe('CART · 1');
  });

  it('says why when the server refuses', async () => {
    refuseWith = 'not_owned';
    loaded();
    await openSell('general_store');
    await userEvent.click(addKit());
    await openFolder('CART');
    await userEvent.click(screen.getByRole('button', { name: 'CHECK OUT' }));
    expect(screen.getByText(/do not have/i)).toBeInTheDocument();
    // Refused whole, so everything is still in the cart to look at.
    expect(screen.getAllByTestId('cart-sell')).toHaveLength(1);
  });
});

describe('the cart', () => {
  const loaded = () => {
    sheetState.sheet = {
      system: 'cities_without_number',
      data: { str: 10, inventory: JSON.stringify([{ name: 'Climbing kit', qty: 2, enc: '1', carry: 'stowed' }]) },
    };
  };
  const checkOut = () => userEvent.click(screen.getByRole('button', { name: 'CHECK OUT' }));

  it('blinks when something goes in, and stops once it is opened', async () => {
    show('gun_shop');
    const tab = () => screen.getByRole('tab', { name: 'CART' });
    expect(tab()).not.toHaveClass('terminal-folder-attention');
    await userEvent.click(screen.getByRole('button', { name: 'Add Heavy Pistol to the cart' }));
    expect(tab()).toHaveClass('terminal-folder-attention');
    expect(tab()).toHaveTextContent('CART · 1');
    await openFolder('CART');
    expect(tab()).not.toHaveClass('terminal-folder-attention');
  });

  it('puts the same thing bought twice on one line, ×2, and totals it', async () => {
    show('gun_shop');
    const add = () => screen.getByRole('button', { name: 'Add Heavy Pistol to the cart' });
    await userEvent.click(add());
    await userEvent.click(add());
    expect(add()).toHaveTextContent('+ CART ×2');
    await openFolder('CART');
    const lines = screen.getAllByTestId('cart-buy');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent('×2');
    expect(lines[0]).toHaveTextContent('400cr');
    expect(screen.getByTestId('cart-total')).toHaveTextContent('YOU PAY 400cr');
  });

  it('lists each thing sold on a line of its own, as minus money', async () => {
    loaded();
    show('general_store');
    await openFolder('SELL');
    const add = () => screen.getByRole('button', { name: 'Add Climbing kit to the cart' });
    await userEvent.click(add());
    await userEvent.click(add());
    await openFolder('CART');
    const lines = screen.getAllByTestId('cart-sell');
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toHaveTextContent('-67cr');
    expect(screen.getByTestId('cart-total')).toHaveTextContent('THE SHOP PAYS YOU 134cr');
  });

  it('nets buying against selling, and sends it all in one checkout', async () => {
    loaded();
    show('general_store');
    await openFolder('SELL');
    await userEvent.click(screen.getByRole('button', { name: 'Add Climbing kit to the cart' }));
    await openFolder('BUY');
    await userEvent.click(screen.getByRole('button', { name: 'Add Climbing kit to the cart' }));
    await openFolder('CART');
    // 150 bought, 67 back.
    expect(screen.getByTestId('cart-total')).toHaveTextContent('YOU PAY 83cr');
    await checkOut();
    expect(checkouts).toHaveLength(1);
    expect(checkouts[0]).toMatchObject({
      locationId: 7,
      buys: [{ catalogue: 'gear', itemId: 'climbing_kit', qty: 1 }],
      sells: [{ catalogue: 'gear', id: 'climbing_kit', qty: 1 }],
      expectedNet: 83,
    });
  });

  it('places two of a thing in two rows, each seeing the one before it', async () => {
    // The sheet here only changes if the fake hook's writer changes it, the way the real
    // one does - so a placement that read a stale sheet would put both guns in row 1.
    sheetState.sheet = { system: 'cities_without_number', data: {} };
    handleFieldsChange.mockImplementation((fields: Record<string, unknown>) => {
      sheetState.sheet = { ...sheetState.sheet, data: { ...sheetState.sheet.data, ...fields } };
    });
    try {
      show('gun_shop');
      await userEvent.click(screen.getByRole('button', { name: 'Add Heavy Pistol to the cart' }));
      await userEvent.click(screen.getByRole('button', { name: 'Add Heavy Pistol to the cart' }));
      await openFolder('CART');
      await checkOut();
      const rows = handleFieldsChange.mock.calls.map(([f]) => Object.keys(f).find((k) => k.endsWith('_name')));
      expect(rows).toEqual(['weapon1_name', 'weapon2_name']);
    } finally {
      handleFieldsChange.mockReset();
    }
  });

  it('puts nothing on the sheet when the checkout is refused', async () => {
    refuseWith = 'funds';
    show('gun_shop');
    await userEvent.click(screen.getByRole('button', { name: 'Add Heavy Pistol to the cart' }));
    await openFolder('CART');
    await checkOut();
    expect(handleFieldsChange).not.toHaveBeenCalled();
    expect(screen.getByText(/Not enough credits/)).toBeInTheDocument();
  });

  it('changes a line with − and +, and drops it at none', async () => {
    show('gun_shop');
    await userEvent.click(screen.getByRole('button', { name: 'Add Knife to the cart' }));
    await openFolder('CART');
    await userEvent.click(screen.getByRole('button', { name: 'One more Knife' }));
    expect(screen.getByTestId('cart-buy')).toHaveTextContent('×2');
    await userEvent.click(screen.getByRole('button', { name: 'One fewer Knife' }));
    await userEvent.click(screen.getByRole('button', { name: 'One fewer Knife' }));
    expect(screen.queryByTestId('cart-buy')).toBeNull();
    expect(screen.getByTestId('cart-empty')).toBeInTheDocument();
  });

  it('removes one line with ✕, and CLEAR CART empties it without charging', async () => {
    show('gun_shop');
    await userEvent.click(screen.getByRole('button', { name: 'Add Knife to the cart' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Heavy Pistol to the cart' }));
    await openFolder('CART');
    await userEvent.click(screen.getByRole('button', { name: 'Remove Knife from the cart' }));
    expect(screen.getAllByTestId('cart-buy')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'CLEAR CART' }));
    expect(screen.getByTestId('cart-empty')).toBeInTheDocument();
    expect(checkouts).toHaveLength(0);
  });

  it('empties when it checks out, and shows a receipt', async () => {
    show('gun_shop');
    await userEvent.click(screen.getByRole('button', { name: 'Add Knife to the cart' }));
    await openFolder('CART');
    await checkOut();
    const receipt = screen.getByTestId('cart-receipt');
    expect(receipt).toHaveTextContent(/RECEIPT · DOC WU/);
    expect(receipt).toHaveTextContent('BOUGHT');
    expect(receipt).toHaveTextContent('Knife');
    expect(receipt).toHaveTextContent('PAID FROM YOUR ACCOUNT');
    expect(screen.queryByTestId('cart-buy')).toBeNull();
    expect(cartTab()).toBe('CART');
  });

  it('marks installed chrome on its line, and on the receipt', async () => {
    saleFromBody = 1;
    sheetState.sheet = { system: 'cities_without_number', data: { cyberware: [{ name: 'Cranial Jack', placed: true }] } };
    show('ripperdoc');
    await openFolder('SELL');
    await userEvent.click(screen.getByRole('button', { name: 'Add Cranial Jack to the cart' }));
    await openFolder('CART');
    expect(screen.getByTestId('cart-sell')).toHaveTextContent(/no surgery roll/i);
    await checkOut();
    expect(screen.getByTestId('cart-receipt')).toHaveTextContent(/surgery roll/i);
  });

  it('says nothing about surgery for a boxed piece', async () => {
    sheetState.sheet = { system: 'cities_without_number', data: { cyberware: [{ name: 'Cranial Jack', placed: false }] } };
    show('ripperdoc');
    await openFolder('SELL');
    await userEvent.click(screen.getByRole('button', { name: 'Add Cranial Jack to the cart' }));
    await openFolder('CART');
    expect(screen.getByTestId('cart-sell')).not.toHaveTextContent(/surgery/i);
  });

  it('sells the one in the bag before the one in the body', async () => {
    // Places are consumed in the order ownedItems lists them: a spare in a pocket goes
    // before anybody is opened up.
    sheetState.sheet = {
      system: 'cities_without_number',
      data: { cyberware: [{ name: 'Cyberlimb', placed: true }, { name: 'Cyberlimb', placed: false }] },
    };
    show('ripperdoc');
    await openFolder('SELL');
    const add = () => screen.getByRole('button', { name: 'Add Cyberlimb to the cart' });
    await userEvent.click(add());
    await openFolder('CART');
    expect(screen.getByTestId('cart-sell')).not.toHaveTextContent(/surgery/i);
    await openFolder('SELL');
    await userEvent.click(add());
    await openFolder('CART');
    // The second one is the installed one, and says so.
    const [first, second] = screen.getAllByTestId('cart-sell');
    expect(first).not.toHaveTextContent(/surgery/i);
    expect(second).toHaveTextContent(/surgery/i);
  });

  it('shows what will be carried, and turns red past the limit', async () => {
    // STR 10: 5 Readied, 10 Stowed. Two climbing kits already Stowed at 1 each.
    loaded();
    show('gun_shop');
    await userEvent.click(screen.getByRole('button', { name: 'Add Automatic Rifle to the cart' }));
    await openFolder('CART');
    const carry = () => screen.getByTestId('cart-carry');
    expect(carry()).toHaveTextContent('STOWED 6/10');
    expect(within(carry()).getByText('STOWED 6/10').style.color).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'One more Automatic Rifle' }));
    await userEvent.click(screen.getByRole('button', { name: 'One more Automatic Rifle' }));
    expect(carry()).toHaveTextContent('STOWED 14/10');
    expect(within(carry()).getByText('STOWED 14/10').style.color).toBe('var(--danger)');
  });

  it('stops the checkout for too much to carry only where the house rule enforces it', async () => {
    loaded();
    sheetState.encumbranceEnforced = true;
    show('general_store');
    // Twelve Enc of gear is past a STR 10 Stowed allowance.
    for (let i = 0; i < 3; i += 1) {
      await userEvent.click(screen.getByRole('button', { name: 'Add Climbing kit to the cart' }));
    }
    await openFolder('CART');
    expect(screen.getByRole('button', { name: 'CHECK OUT' })).not.toBeDisabled();
    for (let i = 0; i < 8; i += 1) {
      await userEvent.click(screen.getByRole('button', { name: 'One more Climbing kit' }));
    }
    expect(screen.getByTestId('cart-carry')).toHaveTextContent(/too much to carry/);
    expect(screen.getByRole('button', { name: 'CHECK OUT' })).toBeDisabled();
  });

  it('shows the new total when prices changed, and checks out at it the second time', async () => {
    show('gun_shop');
    await userEvent.click(screen.getByRole('button', { name: 'Add Knife to the cart' }));
    await openFolder('CART');
    refuseWith = 'total_changed';
    const socketReply = live.shopCheckout;
    // The server answers with its own figure.
    await userEvent.click(screen.getByRole('button', { name: 'CHECK OUT' }));
    act(() => socketReply.forEach((f) => f({ ok: false, reason: 'total_changed', net: 25 })));
    expect(screen.getByTestId('cart-total')).toHaveTextContent('25cr');
    expect(screen.getByTestId('cart-total')).toHaveTextContent(/PRICES CHANGED/);
    refuseWith = null;
    await userEvent.click(screen.getByRole('button', { name: 'CHECK OUT' }));
    expect(checkouts.at(-1).expectedNet).toBe(25);
  });
});

describe('items a GM uploaded', () => {
  /**
   * The server prices and sells these from its own copy; this is purely about the window
   * SHOWING them. A shop that charges correctly for something it never lists is not much
   * of a shop.
   */
  const ZIP_GUN = { id: 'zip_gun', name: 'Zip Gun', price: 15, fields: { dmg: '1d4', skill: 'shoot' } };

  beforeEach(() => clearUploaded());

  it('appears on the shelf beside the book ones', () => {
    loadUploaded({ weapons: [ZIP_GUN] });
    show('gun_shop');
    expect(screen.getByText('Zip Gun')).toBeInTheDocument();
    // And nothing the app ships with has gone anywhere.
    expect(screen.getByText('Heavy Pistol')).toBeInTheDocument();
  });

  it('shows the price the GM set, in the shelf\'s own columns', () => {
    loadUploaded({ weapons: [ZIP_GUN] });
    show('gun_shop');
    const row = screen.getByText('Zip Gun').closest('tr')!;
    expect(within(row).getByText('15cr')).toBeInTheDocument();
    // Its sheet fields land in the columns of the same name, with no mapping.
    expect(within(row).getByText('1d4')).toBeInTheDocument();
  });

  it('can be bought, and asks the server by id like anything else', async () => {
    loadUploaded({ weapons: [ZIP_GUN] });
    show('gun_shop');
    await buyNow('Zip Gun');

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ catalogue: 'weapons', itemId: 'zip_gun' });
    // Still no price in the message: the server decides what it costs.
    expect(sent[0]).not.toHaveProperty('price');
  });

  it('replaces the book row it overrides, rather than listing it twice', () => {
    // A house-ruled Heavy Pistol at two different prices would be unreadable.
    loadUploaded({ weapons: [{ id: 'heavy_pistol', name: 'Heavy Pistol', price: 250, fields: {} }] });
    show('gun_shop');
    expect(screen.getAllByText('Heavy Pistol')).toHaveLength(1);
    const row = screen.getByText('Heavy Pistol').closest('tr')!;
    expect(within(row).getByText('250cr')).toBeInTheDocument();
  });

  it('only shows up at a shop that deals in its catalogue', () => {
    loadUploaded({ weapons: [ZIP_GUN] });
    show('clinic');
    expect(screen.queryByText('Zip Gun')).toBeNull();
  });

  it('can be sold back, once the player owns one', async () => {
    loadUploaded({ weapons: [ZIP_GUN] });
    sheetState.sheet = {
      system: 'cities_without_number',
      data: { weapon1_name: 'Zip Gun' },
    };
    show('gun_shop');
    await userEvent.click(screen.getByRole('tab', { name: 'SELL' }));

    // Listed, and priced at the shop's buy-back rate on the GM's price: 15 at 45% is 6.
    const row = screen.getByText('Zip Gun').closest('tr')!;
    expect(within(row).getByText('6cr')).toBeInTheDocument();
  });

  it('leaves the shelf alone when nothing has been uploaded', () => {
    show('gun_shop');
    expect(screen.queryByText('Zip Gun')).toBeNull();
    expect(screen.getByText(/32 LINES/)).toBeInTheDocument();
  });

  it('buys correctly on the first click, before anything has re-rendered', async () => {
    /**
     * A regression guard. Memoising the shelf froze the first render's `buy` closure,
     * which had captured the balance as null - so every purchase saw zero credits and was
     * refused. Clicking immediately after mount is exactly the case that broke.
     */
    loadUploaded({ weapons: [ZIP_GUN] });
    show('gun_shop');
    await buyNow('Zip Gun');
    expect(screen.queryByText(/Not enough credits/)).toBeNull();
    expect(handleFieldsChange).toHaveBeenCalled();
  });
});

describe('an uploaded item actually arriving on the sheet', () => {
  /**
   * The gap this closes. The server charges and the WINDOW places, so a server-only test
   * can prove the money moved and prove nothing about the goods - and the frontend tests
   * only checked that a write happened, not what it wrote. Between the two, nothing
   * confirmed that a GM's own item reaches a character sheet intact.
   */
  beforeEach(() => clearUploaded());

  it('lands in a weapon slot with the fields the GM gave it', async () => {
    loadUploaded({
      weapons: [{
        id: 'zip_gun',
        name: 'Zip Gun',
        price: 15,
        fields: { dmg: '1d4', skill: 'shoot', attr: 'dex', enc: '1' },
      }],
    });
    show('gun_shop');
    await buyNow('Zip Gun');

    const written = handleFieldsChange.mock.calls[0][0];
    expect(written.weapon1_name).toBe('Zip Gun');
    expect(written.weapon1_dmg).toBe('1d4');
    expect(written.weapon1_skill).toBe('shoot');
    expect(written.weapon1_attr).toBe('dex');
    expect(written.weapon1_enc).toBe('1');
    // Bought weapons arrive stowed, uploaded or not.
    expect(written.weapon1_carry).toBe('stowed');
  });

  it('leaves a column the GM did not fill blank rather than undefined', async () => {
    // A sparse upload is the normal case: most GMs will not fill every column. Writing
    // undefined into a sheet field would store the string "undefined".
    loadUploaded({
      weapons: [{ id: 'zip_gun', name: 'Zip Gun', price: 15, fields: { dmg: '1d4' } }],
    });
    show('gun_shop');
    await buyNow('Zip Gun');

    const written = handleFieldsChange.mock.calls[0][0];
    for (const [field, value] of Object.entries(written)) {
      expect(String(value), field).not.toBe('undefined');
    }
  });

  it('lands in the inventory for a catalogue with no typed row', async () => {
    // Gear has no row group anywhere, so an uploaded gas mask is an inventory line.
    loadUploaded({
      gear: [{ id: 'flare', name: 'Signal Flare', price: 30, fields: { enc: '1' } }],
    });
    show('general_store');
    await buyNow('Signal Flare');

    const [field, value] = handleFieldChange.mock.calls[0];
    expect(field).toBe('inventory');
    const items = JSON.parse(value as string);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'Signal Flare', qty: 1 });
  });

  it('is then owned, and offered back to the shop at the buy-back rate', async () => {
    /**
     * The round trip a player actually makes: buy it, own it, sell it. Driven through the
     * sheet rather than asserted about, so the name the purchase wrote is the same name
     * ownedItems has to match on afterwards.
     */
    loadUploaded({
      weapons: [{ id: 'zip_gun', name: 'Zip Gun', price: 15, fields: { dmg: '1d4' } }],
    });
    const { unmount } = show('gun_shop');
    await buyNow('Zip Gun');
    const written = handleFieldsChange.mock.calls[0][0];
    unmount();

    // The sheet as it stands after that purchase.
    sheetState.sheet = { system: 'cities_without_number', data: written };
    show('gun_shop');
    await userEvent.click(screen.getByRole('tab', { name: 'SELL' }));

    const row = screen.getByText('Zip Gun').closest('tr')!;
    // 15 at the default 45% is 6, rounded down from 6.75.
    expect(within(row).getByText('6cr')).toBeInTheDocument();
    expect(within(row).getByText('×1')).toBeInTheDocument();
  });

  it('sells back by the id the shop knows it under', async () => {
    loadUploaded({
      weapons: [{ id: 'zip_gun', name: 'Zip Gun', price: 15, fields: {} }],
    });
    sheetState.sheet = { system: 'cities_without_number', data: { weapon1_name: 'Zip Gun' } };
    show('gun_shop');
    await userEvent.click(screen.getByRole('tab', { name: 'SELL' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Zip Gun to the cart' }));
    await openFolder('CART');
    await userEvent.click(screen.getByRole('button', { name: 'CHECK OUT' }));

    expect(sold[0].items).toEqual([
      { catalogue: 'weapons', id: 'zip_gun', label: 'Zip Gun', qty: 1 },
    ]);
  });
});

describe('a shop with its own buy-back rate', () => {
  /**
   * Every other test here hands the window 45%, so none of them would notice if the rate
   * were ignored entirely. What the window is given has already been resolved - this
   * shop's own rate, then the global, then the default - and all this has to prove is that
   * it is actually used rather than a default being assumed somewhere below.
   */
  const withKit = () => {
    sheetState.sheet = {
      system: 'cities_without_number',
      data: { inventory: JSON.stringify([{ name: 'Climbing kit', qty: 2 }]) },
    };
  };

  const showAt = (pct: number) => {
    const result = render(<ShopWindow name="Doc Wu" locationId={7} buildingType="general_store"
      system="cities_without_number" buybackPct={pct} socket={makeSocket()} userName="JADE" onClose={vi.fn()} />);
    act(() => (live.bankUpdate || []).forEach((f) => f({ username: 'JADE', ...bank })));
    return result;
  };

  const openSell = async (pct: number) => {
    withKit();
    showAt(pct);
    await userEvent.click(screen.getByRole('tab', { name: 'SELL' }));
  };

  it('says what it pays, in its own words', async () => {
    await openSell(80);
    expect(screen.getByText(/THIS SHOP PAYS 80% OF THE BOOK PRICE/)).toBeInTheDocument();
  });

  it('prices a line at its rate rather than the default', async () => {
    // Climbing kit is 150. At 80% that is 120, not the 67 a default shop would pay.
    await openSell(80);
    const row = screen.getByText('Climbing kit').closest('tr')!;
    expect(within(row).getByText('120cr')).toBeInTheDocument();
    expect(within(row).queryByText('67cr')).toBeNull();
  });

  it('adds the cart up at its rate', async () => {
    await openSell(80);
    await userEvent.click(screen.getByRole('button', { name: 'Add Climbing kit to the cart' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add Climbing kit to the cart' }));
    await openFolder('CART');
    expect(screen.getByTestId('cart-total')).toHaveTextContent('THE SHOP PAYS YOU 240cr');
  });

  it('pays face value at a hundred percent', async () => {
    // A pawn shop a GM set to buy at cost.
    await openSell(100);
    const row = screen.getByText('Climbing kit').closest('tr')!;
    expect(within(row).getByText('150cr')).toBeInTheDocument();
  });

  it('offers things it will pay nothing for, at a shop set to zero', async () => {
    /**
     * A storefront that buys nothing back is a real decision, not a broken setting. The
     * items still list - a player is entitled to see that the answer is nothing - and
     * selling one still takes it off the sheet.
     */
    await openSell(0);
    expect(screen.getByText(/THIS SHOP PAYS 0%/)).toBeInTheDocument();
    const row = screen.getByText('Climbing kit').closest('tr')!;
    expect(within(row).getByText('N/A')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /Add Climbing kit/ })).toBeEnabled();
  });

  it('still sends no price, whatever its rate', async () => {
    // The rate shown here is a courtesy. The server resolves it again and pays from that.
    await openSell(80);
    await userEvent.click(screen.getByRole('button', { name: 'Add Climbing kit to the cart' }));
    await openFolder('CART');
    await userEvent.click(screen.getByRole('button', { name: 'CHECK OUT' }));

    expect(sold[0].items).toEqual([
      { catalogue: 'gear', id: 'climbing_kit', label: 'Climbing kit', qty: 1 },
    ]);
    expect(JSON.stringify(checkouts[0].sells)).not.toMatch(/price|pct|payout|each/);
  });
});

describe('a shop in another system\'s game', () => {
  /**
   * The CWN book is CWN's. A Cyberpunk RED gun shop carries only what that GM uploaded,
   * shows it in the columns the Cyberpunk RED file has, and puts a bought gun into a
   * Cyberpunk RED weapon row - four of them, with a rate of fire and no carry state.
   */
  const RED = 'cyberpunk_red';
  const UNITY = {
    id: 'militech_unity', name: 'Militech Unity', price: 100,
    fields: { dmg: '3d6', skill: 'Handgun', rof: '2' },
  };

  beforeEach(() => {
    clearUploaded();
    sheetState.sheet = { system: RED, data: {} };
  });

  it('has nothing on the shelves until the GM adds some', () => {
    show('gun_shop', 'Vic', RED);
    expect(screen.queryByText('Heavy Pistol')).toBeNull();
    expect(screen.getByText(/Nothing on the shelves yet — the GM adds stock in SHOP_CATALOGUES/))
      .toBeInTheDocument();
    // No page reference into a book this game does not use.
    expect(screen.queryByText(/CWN P/)).toBeNull();
  });

  it('shows what the GM uploaded, in that system\'s columns', () => {
    loadUploaded({ weapons: [UNITY] });
    show('gun_shop', 'Vic', RED);
    expect(screen.getByText('Militech Unity')).toBeInTheDocument();
    expect(screen.getByText('100cr')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Sort by ROF/ })).toBeInTheDocument();
    // CWN's columns are not this sheet's.
    expect(screen.queryByRole('columnheader', { name: /Sort by MAG/ })).toBeNull();
    expect(screen.getByText('GOES INTO ONE OF YOUR 4 WEAPON SLOTS')).toBeInTheDocument();
  });

  it('puts a bought gun into a Cyberpunk RED weapon row, once paid for', async () => {
    loadUploaded({ weapons: [UNITY] });
    sheetState.sheet = { system: RED, data: { weapon1_name: 'Taken' } };
    show('gun_shop', 'Vic', RED);
    await buyNow('Militech Unity');

    expect(sent).toEqual([{ locationId: 7, catalogue: 'weapons', itemId: 'militech_unity', settle: undefined }]);
    expect(handleFieldsChange).toHaveBeenCalledWith({
      weapon2_dmg: '3d6', weapon2_skill: 'Handgun', weapon2_rof: '2', weapon2_name: 'Militech Unity',
    });
  });

  it('writes nothing when the purchase is refused', async () => {
    loadUploaded({ weapons: [UNITY] });
    refuseWith = 'price';
    show('gun_shop', 'Vic', RED);
    await buyNow('Militech Unity');
    expect(handleFieldsChange).not.toHaveBeenCalled();
    expect(handleFieldChange).not.toHaveBeenCalled();
  });

  it('refuses before charging when all four rows are full', async () => {
    loadUploaded({ weapons: [UNITY] });
    sheetState.sheet = {
      system: RED,
      data: { weapon1_name: 'a', weapon2_name: 'b', weapon3_name: 'c', weapon4_name: 'd' },
    };
    show('gun_shop', 'Vic', RED);
    await buyNow('Militech Unity');
    expect(sent).toEqual([]);
    expect(screen.getByText(/No free weapon slot — all 4 are full/)).toBeInTheDocument();
  });

  it('puts bought chrome in the cyberware table, unplaced', async () => {
    loadUploaded({
      cyberware: [{ id: 'jack', name: 'Neural Link', price: 500, fields: { strain: '7', effect: 'Jacks in' } }],
    });
    show('ripperdoc', 'Doc', RED);
    await buyNow('Neural Link');
    const [field, rows] = handleFieldChange.mock.calls[0];
    expect(field).toBe('cyberware');
    expect(rows).toEqual([expect.objectContaining({ name: 'Neural Link', placed: false, hl: 7, cost: 500 })]);
  });

  it('sells from the rows this sheet has, at the shelf price', async () => {
    loadUploaded({ weapons: [UNITY] });
    // weapon5 is not a Cyberpunk RED row, so only one of these is for sale.
    sheetState.sheet = { system: RED, data: { weapon1_name: 'Militech Unity', weapon5_name: 'Militech Unity' } };
    show('gun_shop', 'Vic', RED);
    await userEvent.click(screen.getByRole('tab', { name: 'SELL' }));
    expect(screen.getByText(/THIS SHOP PAYS 45% OF THE SHELF PRICE/)).toBeInTheDocument();
    expect(screen.getByText('×1')).toBeInTheDocument();
    expect(screen.getByText('45cr')).toBeInTheDocument();
  });
});

describe("a storefront's name in each game", () => {
  /**
   * Same ids everywhere, so a location keeps its type across a system switch; only what it
   * is called changes. "Ripperdoc" is a word from the CWN and Cyberpunk RED street, not
   * Shadowrun's.
   */
  it('keeps the CWN names on CWN', () => {
    for (const t of BUILDING_TYPES) expect(typeLabel(t.id, 'cities_without_number')).toBe(t.label);
    for (const c of CATALOGUES) expect(catalogueLabel(c.id, 'cities_without_number')).toBe(c.label);
  });

  it('calls a ripperdoc what each game calls it', () => {
    expect(typeLabel('ripperdoc', 'cyberpunk_red')).toBe('Ripperdoc');
    expect(typeLabel('ripperdoc', 'shadowrun_6e')).toBe('Street Doc');
    expect(typeLabel('ripperdoc', 'generic')).toBe('Cyber Clinic');
  });

  it("drops the CWN book's own table name outside CWN", () => {
    expect(catalogueLabel('gear', 'cyberpunk_red')).toBe('Gear');
    expect(catalogueLabel('weapons', 'cyberpunk_red')).toBe('Weapons');
  });

  it('is blank for a type that does not exist, in any game', () => {
    expect(typeLabel('speakeasy', 'shadowrun_6e')).toBe('');
    expect(typeLabel(null, 'generic')).toBe('');
  });

  it("heads the shop window with this game's name", () => {
    sheetState.sheet = { system: 'shadowrun_6e', data: {} };
    show('ripperdoc', 'Doc', 'shadowrun_6e');
    expect(screen.getByText(/STREET DOC ·/)).toBeInTheDocument();
    expect(screen.queryByText(/RIPPERDOC/)).toBeNull();
  });
});

describe('a CWN catalogue file, bought through the window and sold back', () => {
  /**
   * The CWN half of sheets/__tests__/csvToSale.test.ts. CWN places uploaded items through
   * its own book shelves - a gun arrives Stowed - rather than the generic writer, so the
   * chain has to run through the window: a CSV is parsed by the server's parser, the
   * window buys from it, and what the window wrote is sold by the server's planner.
   */
  const require_ = createRequire(import.meta.url);
  const { parseCatalogue } = require_('../../../../backend/shops/catalogueParse.js');
  const store = require_('../../../../backend/shops/catalogueStore.js');
  const { planSale } = require_('../../../../backend/shops/sell.js');

  const FILE = [
    '[weapons]',
    'name, price, dmg, skill, attr, trauma, shock, enc',
    // A new gun, and one house-ruling a book price.
    'Zip Gun, 15, 1d4, shoot, dex, 1d6/x2, , 1',
    'Heavy Pistol, "1,000", 1d8, shoot, dex, 1d8/x2, 2/15, 1',
    '',
    '[gear]',
    'name, price, enc, description',
    'Signal Flare, 30, 1, "Burns red, for an hour"',
  ].join('\n');

  afterEach(() => { store.clear(); clearUploaded(); });

  it('lands every column, and leaves nothing behind when sold', async () => {
    const parsed = parseCatalogue(FILE);
    expect(parsed.problems).toEqual([]);
    store.load('cities_without_number', parsed.sections);
    loadUploaded(parsed.sections);

    // Buy both guns, then the flare, the way a player would walk between shops.
    let sheet: Record<string, unknown> = {};
    const collect = () => {
      for (const [patch] of handleFieldsChange.mock.calls) sheet = { ...sheet, ...patch };
      for (const [field, value] of handleFieldChange.mock.calls) sheet = { ...sheet, [field]: value };
      handleFieldsChange.mockClear();
      handleFieldChange.mockClear();
      sheetState.sheet = { system: 'cities_without_number', data: sheet };
    };

    const gunShop = show('gun_shop', 'Vic');
    await buyNow('Zip Gun');
    collect();
    gunShop.unmount();
    const again = show('gun_shop', 'Vic');
    await buyNow('Heavy Pistol');
    collect();
    again.unmount();
    show('general_store', 'Sal');
    await buyNow('Signal Flare');
    collect();

    // The GM's columns, in the GM's words, and the CWN rules on top.
    expect(sheet).toMatchObject({
      weapon1_name: 'Zip Gun', weapon1_dmg: '1d4', weapon1_trauma: '1d6/x2', weapon1_carry: 'stowed',
      weapon2_name: 'Heavy Pistol', weapon2_shock: '2/15',
    });
    expect(JSON.parse(String(sheet.inventory))).toEqual([expect.objectContaining({ name: 'Signal Flare', qty: 1, enc: '1' })]);
    // Each purchase named the parsed id, which is what the server prices from.
    expect(sent.map((s) => s.itemId)).toEqual(['zip_gun', 'heavy_pistol', 'signal_flare']);

    const sale = planSale({
      data: sheet,
      items: [
        { catalogue: 'weapons', id: 'zip_gun', qty: 1 },
        { catalogue: 'weapons', id: 'heavy_pistol', qty: 1 },
        { catalogue: 'gear', id: 'signal_flare', qty: 1 },
      ],
      catalogues: ['weapons', 'gear'],
      locationPct: 50,
      globalPct: null,
      system: 'cities_without_number',
    });
    // 7 + 500 + 15: the uploaded prices, including the house rule, halved and rounded down.
    expect(sale).toMatchObject({ ok: true, payout: 7 + 500 + 15 });

    const after: Record<string, unknown> = { ...sheet, ...sale.patch };
    for (const [key, value] of Object.entries(after)) {
      expect(value === '' || value === '[]', `${key} = ${JSON.stringify(value)}`).toBe(true);
    }
  });
});

describe('an empty shop, opened by the GM', () => {
  beforeEach(() => {
    clearUploaded();
    sheetState.sheet = { system: 'cyberpunk_red', data: {} };
  });

  const render_ = (isAdmin: boolean, onOpenCatalogues = vi.fn()) => render(
    <ShopWindow name="Vic" locationId={7} buildingType="gun_shop" system="cyberpunk_red"
      isAdmin={isAdmin} onOpenCatalogues={onOpenCatalogues}
      buybackPct={45} socket={makeSocket()} userName="JADE" onClose={vi.fn()} />,
  );

  it('shows the GM the steps, with a way straight to SHOP_CATALOGUES', async () => {
    const open = vi.fn();
    render_(true, open);
    expect(screen.getByRole('note', { name: 'How to stock this shop' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'OPEN IT' }));
    expect(open).toHaveBeenCalledOnce();
  });

  it('shows a player only that the GM stocks it', () => {
    render_(false);
    expect(screen.queryByRole('note', { name: 'How to stock this shop' })).toBeNull();
    expect(screen.getByText(/the GM adds stock in SHOP_CATALOGUES/)).toBeInTheDocument();
  });
});
