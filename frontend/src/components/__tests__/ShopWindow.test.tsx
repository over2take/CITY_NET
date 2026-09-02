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
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShopWindow } from '../ShopWindow';

// The hook is the sheet's own business; what matters here is what the shop does with it.
const sheetState: { sheet: any } = { sheet: { system: 'cities_without_number', data: {} } };
const handleFieldChange = vi.fn();
vi.mock('../../hooks/usePlayerSheet', () => ({
  usePlayerSheet: () => ({ sheet: sheetState.sheet, handleFieldChange }),
}));
import { BUILDING_TYPES, isShop, buildingTypeById, shopsAvailable } from '../../data/buildingTypes';
import { CWN_CYBERWARE } from '../../sheets/cwnCyberwarePresets';

const show = (buildingType: string, name = 'Doc Wu') =>
  render(<ShopWindow name={name} buildingType={buildingType}
    socket={{ on: vi.fn(), off: vi.fn(), emit: vi.fn() }} userName="JADE" onClose={vi.fn()} />);

beforeEach(() => {
  handleFieldChange.mockClear();
  sheetState.sheet = { system: 'cities_without_number', data: {} };
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
    show('gun_shop');
    expect(screen.getByText(/NO CATALOGUE FOR THIS SHOP YET/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Filter stock')).not.toBeInTheDocument();
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
