/**
 * The shop, as far as it goes: what a building carries, and the fact that it does not
 * charge for it yet.
 *
 * The inertness is tested deliberately. A shell that quietly looked functional would be
 * worse than no shell at all, so the buttons being disabled and the notice being present
 * are assertions rather than an accident of it being unfinished.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ShopWindow } from '../ShopWindow';
import { BUILDING_TYPES, isShop, buildingTypeById, shopsAvailable } from '../../data/buildingTypes';
import { CWN_CYBERWARE } from '../../sheets/cwnCyberwarePresets';

const show = (buildingType: string, name = 'Doc Wu') =>
  render(<ShopWindow name={name} buildingType={buildingType} onClose={vi.fn()} />);

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

  it('offers buy and sell for a line, both switched off', () => {
    show('ripperdoc');
    expect(screen.getByLabelText('Buy Cranial Jack')).toBeDisabled();
    expect(screen.getByLabelText('Sell Cranial Jack')).toBeDisabled();
  });

  it('says out loud that nothing is charged yet', () => {
    // Otherwise a disabled button with no explanation reads as a bug.
    show('ripperdoc');
    expect(screen.getByText(/NOTHING IS BOUGHT, SOLD OR CHARGED YET/)).toBeInTheDocument();
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
