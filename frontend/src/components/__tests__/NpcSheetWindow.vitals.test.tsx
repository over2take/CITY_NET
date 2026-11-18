import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NpcSheetWindow } from '../NpcSheetWindow';

vi.mock('../DraggableWindow', () => ({
  DraggableWindow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

/**
 * The vitals box in the GM's view of a player's sheet (8s3d2; decision 7 of the vitals mockup): the player's token, as
 * the GM-only route sends it, changed with the GM's sign-in; an NPC's sheet has none.
 */

const TOKEN = { id: 9, name: 'GHOST', shape: 'rhombus', owner: 'GHOST', hp_current: 7, hp_max: 12, hp_temp: 0, conditions: '[]', injuries: '{}' };
let calls: { url: string; init?: RequestInit }[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/api/settings')) return { ok: true, json: async () => [] };
    if (String(url).startsWith('/api/systems/conditions/')) return { ok: true, json: async () => [] };
    if (String(url).endsWith('/health')) return { ok: true, json: async () => ({}) };
    return { ok: true, json: async () => ({ id: 3, username: 'GHOST', system: 'generic', portrait_url: null, is_npc: 0, data: { name: 'Wren', hp: 7, hp_max: 12 }, token: TOKEN }) };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const open = (playerUsername?: string) => render(
  <NpcSheetWindow token="admintoken" npcId={3} npcLabel="Wren" pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()}
    socket={{ emit: vi.fn(), on: vi.fn(), off: vi.fn() }} {...(playerUsername ? { playerUsername } : {})} />,
);

describe('the GM\'s view of a player\'s sheet', () => {
  it('has the vitals box on the player\'s token, DAMAGE sent with the GM\'s sign-in', async () => {
    open('GHOST');
    const box = await screen.findByRole('group', { name: 'Vitals' });
    expect(screen.getByLabelText('Current HP').textContent).toBe('7');
    await userEvent.type(screen.getByRole('spinbutton', { name: 'Amount of HP' }), '3');
    await userEvent.click(screen.getByRole('button', { name: 'DAMAGE' }));
    const sent = calls.find((c) => c.url === '/api/locations/9/health');
    expect(JSON.parse(String(sent?.init?.body))).toEqual({ action: 'damage', amount: 3 });
    expect((sent?.init?.headers as Record<string, string>).Authorization).toBe('Bearer admintoken');
    expect(box).toBeTruthy();
  });

  it('an NPC\'s sheet: no box', async () => {
    open();
    await waitFor(() => expect(screen.getByText('WREN')).toBeTruthy());
    expect(screen.queryByRole('group', { name: 'Vitals' })).toBeNull();
  });
});
