import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SystemPicker } from '../SystemPicker';
import type { PickerSystem } from '../systemPickerRules';

/**
 * The game-system picker as a player of it sees it: a button, a searchable grouped list, and a
 * confirmation before the game changes for everyone.
 */

const SYSTEMS: PickerSystem[] = [
  { id: 'cities_without_number', name: 'Cities Without Number' },
  { id: 'cyberpunk_red', name: 'Cyberpunk RED' },
  { id: 'generic', name: 'Generic' },
  { id: 'sys_bbbbbbbbbbbbbbbb', name: 'Vault Knights', custom: true, version: 3 },
];

afterEach(() => { cleanup(); document.body.innerHTML = ''; });

const show = (onSwitch = vi.fn(() => Promise.resolve(true)), current = 'cities_without_number') => {
  render(<SystemPicker systems={SYSTEMS} current={current} onSwitch={onSwitch} />);
  return onSwitch;
};
const openList = () => fireEvent.click(screen.getByRole('button', { name: /CITIES WITHOUT NUMBER|VAULT KNIGHTS/ }));
const search = () => screen.getByRole('combobox', { name: 'Search game systems' });

describe('the button', () => {
  it('shows the running system, and a custom one\'s version', () => {
    show(undefined, 'sys_bbbbbbbbbbbbbbbb');
    expect(screen.getByText('VAULT KNIGHTS')).toBeTruthy();
    expect(screen.getByText('CUSTOM · v3')).toBeTruthy();
  });
});

describe('the list', () => {
  it('opens with a search box and the two groups, marking the running system', () => {
    show();
    openList();
    expect(search()).toBeTruthy();
    expect(screen.getByRole('group', { name: 'BUILT-IN' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'YOUR SYSTEMS' })).toBeTruthy();
    const running = screen.getByRole('option', { selected: true });
    expect(running.textContent).toContain('CITIES WITHOUT NUMBER');
  });

  it('narrows as you type', () => {
    show();
    openList();
    fireEvent.change(search(), { target: { value: 'vault' } });
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['VAULT KNIGHTSv3']);
    fireEvent.change(search(), { target: { value: 'zzz' } });
    expect(screen.getByText('No system matches.')).toBeTruthy();
  });

  it('closes on Escape without switching anything', () => {
    const onSwitch = show();
    openList();
    fireEvent.keyDown(search(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('closes when clicking elsewhere', () => {
    show();
    openList();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('lives in the themed container, so it wears the theme', () => {
    const root = document.createElement('div');
    root.className = 'crt-container theme-vaporwave';
    document.body.appendChild(root);
    show();
    openList();
    expect(root.contains(screen.getByRole('listbox'))).toBe(true);
  });
});

describe('switching', () => {
  it('asks first, and switches only on SWITCH', async () => {
    const onSwitch = show();
    openList();
    fireEvent.click(screen.getByRole('option', { name: /VAULT KNIGHTS/ }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByText(/changes the game for everyone online/)).toBeTruthy();
    expect(onSwitch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'SWITCH' }));
    await waitFor(() => expect(onSwitch).toHaveBeenCalledWith('sys_bbbbbbbbbbbbbbbb'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('does nothing when cancelled', () => {
    const onSwitch = show();
    openList();
    fireEvent.click(screen.getByRole('option', { name: /CYBERPUNK RED/ }));
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('does not ask about the system already running', () => {
    const onSwitch = show();
    openList();
    fireEvent.click(screen.getByRole('option', { name: /CITIES WITHOUT NUMBER/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it('picks with the arrow keys and Enter', () => {
    show();
    openList();
    fireEvent.keyDown(search(), { key: 'ArrowDown' });
    fireEvent.keyDown(search(), { key: 'ArrowDown' });
    fireEvent.keyDown(search(), { key: 'Enter' });
    expect(screen.getByRole('dialog').textContent).toContain('CYBERPUNK RED');
  });

  it('picks the only match with Enter straight after typing', () => {
    show();
    openList();
    fireEvent.change(search(), { target: { value: 'generic' } });
    fireEvent.keyDown(search(), { key: 'Enter' });
    expect(screen.getByRole('dialog').textContent).toContain('GENERIC');
  });

  it('says so when the server refuses, and changes nothing', async () => {
    const onSwitch = vi.fn(() => Promise.resolve(false));
    show(onSwitch);
    openList();
    fireEvent.click(screen.getByRole('option', { name: /VAULT KNIGHTS/ }));
    fireEvent.click(screen.getByRole('button', { name: 'SWITCH' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Nothing was changed');
  });
});
