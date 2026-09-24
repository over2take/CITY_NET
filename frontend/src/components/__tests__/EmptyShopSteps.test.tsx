/**
 * A shop with nothing to sell, and the GM being told how to fix that.
 *
 * Outside CWN a shop starts empty. Setting a building to Gun Shop and walking a player into
 * it shows bare shelves, and the fix lives in another panel - so the steps are shown where
 * the shop is set up, naming the sections this shop needs and the columns this game uses.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EmptyShopSteps, emptyShelves } from '../EmptyShopSteps';
import { loadUploaded, clearUploaded } from '../../sheets/uploadedCatalogues';

afterEach(() => clearUploaded());

const GUN = { id: 'unity', name: 'Militech Unity', price: 100, fields: {} };

describe('which shops count as empty', () => {
  it('is every shelf of a shop nothing has been uploaded for', () => {
    expect(emptyShelves('gun_shop', 'cyberpunk_red')).toEqual(['weapons', 'weapon_mods']);
  });

  it('is not a shop with something on one shelf, even if the other is bare', () => {
    // Guns and no mods is a small gun shop, not an empty one.
    loadUploaded({ weapons: [GUN] });
    expect(emptyShelves('gun_shop', 'cyberpunk_red')).toEqual([]);
  });

  it('is never a CWN shop, which the book stocks', () => {
    expect(emptyShelves('gun_shop', 'cities_without_number')).toEqual([]);
  });

  it('is never a building that does not trade', () => {
    expect(emptyShelves('bar', 'cyberpunk_red')).toEqual([]);
    expect(emptyShelves('', 'cyberpunk_red')).toEqual([]);
  });
});

describe('the steps', () => {
  it('names the shop the way this game does, and the sections it needs', () => {
    render(<EmptyShopSteps buildingType="ripperdoc" system="shadowrun_6e" />);
    expect(screen.getByText('THIS STREET DOC HAS NOTHING TO SELL YET')).toBeInTheDocument();
    expect(screen.getByText(/Fill in the \[cyberware\] section/)).toBeInTheDocument();
  });

  it('walks through the whole upload, in the order the buttons are pressed', () => {
    render(<EmptyShopSteps buildingType="gun_shop" system="cyberpunk_red" />);
    const text = screen.getByRole('note', { name: 'How to stock this shop' }).textContent ?? '';
    const order = ['SHOP_CATALOGUES', 'GAME', 'DOWNLOAD EXAMPLE', 'UPLOAD FILE', 'PREVIEW', 'SAVE'];
    const at = order.map((word) => text.indexOf(word));
    expect(at.every((i) => i >= 0), JSON.stringify(at)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('shows what typing one in by hand looks like, in this game\'s columns', () => {
    render(<EmptyShopSteps buildingType="gun_shop" system="cyberpunk_red" />);
    expect(screen.getByText(/\[weapons\]\s+name, price, dmg, skill, rof\s+Street Special, 100/))
      .toBeInTheDocument();
  });

  it('opens SHOP_CATALOGUES from the button', async () => {
    const open = vi.fn();
    render(<EmptyShopSteps buildingType="gun_shop" system="cyberpunk_red" onOpenCatalogues={open} />);
    await userEvent.click(screen.getByRole('button', { name: 'OPEN IT' }));
    expect(open).toHaveBeenCalledOnce();
  });

  it('has no button where there is nothing to open it with', () => {
    render(<EmptyShopSteps buildingType="gun_shop" system="cyberpunk_red" />);
    expect(screen.queryByRole('button', { name: 'OPEN IT' })).toBeNull();
  });

  it('is not there once the shop has stock', () => {
    loadUploaded({ weapons: [GUN] });
    const { container } = render(<EmptyShopSteps buildingType="gun_shop" system="cyberpunk_red" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('is not there on CWN', () => {
    const { container } = render(<EmptyShopSteps buildingType="gun_shop" system="cities_without_number" />);
    expect(container).toBeEmptyDOMElement();
  });
});
