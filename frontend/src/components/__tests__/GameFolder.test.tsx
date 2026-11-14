import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { GameFolder } from '../GameFolder';

/**
 * A folder of the admin GAME tab (R2b; the user, 2026-10-30: "making bank and rest collapsible might
 * save on space"): open at first, shut or opened by its button, and kept that way in this browser.
 */

afterEach(() => { cleanup(); window.localStorage.clear(); vi.restoreAllMocks(); });

const show = (id = 'bank') => render(<GameFolder id={id} name="BANK"><span>PAY_PLAYERS</span></GameFolder>);

describe('a GAME tab folder', () => {
  it('is open at first, and shuts and opens by its button', async () => {
    show();
    expect(screen.getByRole('button', { name: '▾ BANK' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('PAY_PLAYERS')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '▾ BANK' }));
    expect(screen.queryByText('PAY_PLAYERS')).toBeNull();
    expect(screen.getByRole('button', { name: '▸ BANK' }).getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(screen.getByRole('button', { name: '▸ BANK' }));
    expect(screen.getByText('PAY_PLAYERS')).toBeTruthy();
  });

  it('stays as it was left in this browser, each folder its own', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: '▾ BANK' }));
    expect(window.localStorage.getItem('citynet:gameFolder:bank')).toBe('shut');
    cleanup();
    show();
    expect(screen.queryByText('PAY_PLAYERS')).toBeNull();
    cleanup();
    show('rests');
    expect(screen.getByText('PAY_PLAYERS')).toBeTruthy();
  });

  it('opens and shuts for now where the browser keeps nothing', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    show();
    expect(screen.getByText('PAY_PLAYERS')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '▾ BANK' }));
    expect(screen.queryByText('PAY_PLAYERS')).toBeNull();
  });
});
