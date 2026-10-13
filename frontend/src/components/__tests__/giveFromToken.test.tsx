import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { buildTokenActions, tokenActionKeys, type TokenActionContext, type TokenViewer } from '../tokenActions';
import { GiftNotices, NOTICES_KEPT } from '../GiftNotices';
import { GiveItemWindow } from '../GiveItemWindow';
import { registerCustomTemplate, clearCustomTemplates, type CustomRender } from '../../sheets/customTemplates';
import type { AskSocket, ReceivedNotice } from '../../sheets/giveItems';

/**
 * GIVE ITEM from a token, and what the player sees (4g4c; approved mockup docs/mockups/give-item.html):
 * the GM's token window has GIVE_ITEM, opening GIVE.EXE with that character ticked; the player given
 * something is told, privately, in the game's own word for the GM.
 */

afterEach(() => { cleanup(); clearCustomTemplates(); });

const gm: TokenViewer = {
  isAdmin: true, isPrimaryAdmin: true, isOwner: false, isLoggedIn: true, isPlayerToken: true, hasOwner: true,
  sheetHere: false, linked: false, attackPending: false, sheetCombat: false, canManage: true,
  hasRoster: false, systemHasVehicles: false, systemHasBank: true, systemHasCombat: true, hasBattleMaps: false,
  systemHasGive: true,
};

describe('GIVE_ITEM on a token', () => {
  it('is the GM\'s, on a player\'s character or an NPC with a sheet here, while the game has GIVE ITEM', () => {
    expect(tokenActionKeys(gm)).toContain('give');
    expect(tokenActionKeys({ ...gm, isPrimaryAdmin: false })).toContain('give');
    expect(tokenActionKeys({ ...gm, isPlayerToken: false, sheetHere: true, linked: true })).toContain('give');
    for (const [why, v] of [
      ['a player', { ...gm, isAdmin: false, isPrimaryAdmin: false }],
      ['GIVE ITEM off', { ...gm, systemHasGive: false }],
      ['GIVE ITEM unknown', { ...gm, systemHasGive: undefined }],
      ['no owner', { ...gm, hasOwner: false }],
      ['an NPC without a sheet here', { ...gm, isPlayerToken: false, sheetHere: false, linked: true }],
      ['the owner, not the GM', { ...gm, isAdmin: false, isPrimaryAdmin: false, isOwner: true }],
    ] as const) expect(tokenActionKeys(v), why).not.toContain('give');
  });

  it('sits after VIEW_BANK, and changes nothing else', () => {
    const keys = tokenActionKeys(gm);
    expect(keys.indexOf('give')).toBe(keys.indexOf('bank') + 1);
    expect(keys.filter((k) => k !== 'give')).toEqual(tokenActionKeys({ ...gm, systemHasGive: false }));
  });

  const context = (location: object): TokenActionContext => ({
    location, authToken: 'tok', emit: vi.fn(), fetch: vi.fn(async () => ({ ok: true })), refreshLocations: vi.fn(),
    sheetLink: null, tier: undefined, isOwner: false,
    open: {
      ownSheet: vi.fn(), playerSheet: vi.fn(), npcSheet: vi.fn(), controlledSheet: vi.fn(), editLocation: vi.fn(),
      vehicles: vi.fn(), bank: vi.fn(), give: vi.fn(), enemyVehicles: vi.fn(), battleMap: vi.fn(),
    },
    ping: vi.fn(), broadcast: vi.fn(), clearSelection: vi.fn(),
  });

  it('opens GIVE.EXE with that character ticked: a player by name, an NPC by token', async () => {
    const player = context({ id: 42, shape: 'rhombus', owner: 'Ghost' });
    const button = buildTokenActions(gm, player).find((a) => a.key === 'give')!;
    expect(button.label).toBe('GIVE_ITEM');
    expect(button.title).toBe('Give this character an item, free');
    await button.onClick();
    expect(player.open.give).toHaveBeenCalledWith('player:ghost');
    const npc = context({ id: 12, shape: 'enemy_rhombus', owner: 'gm' });
    await buildTokenActions({ ...gm, isPlayerToken: false, sheetHere: true, linked: true }, npc).find((a) => a.key === 'give')!.onClick();
    expect(npc.open.give).toHaveBeenCalledWith('npc:12');
  });
});

describe('GIVE.EXE opened again from another token', () => {
  it('ticks that character too, keeping the ones already ticked', async () => {
    const socket: AskSocket = {
      on: (event, fn) => {
        if (event === 'givableItems') setTimeout(() => fn({ ok: true, system: 'generic', catalogues: [{ catalogue: 'gear', items: [{ id: 'rope', name: 'Rope', price: 1 }] }] }), 0);
        if (event === 'givenList') setTimeout(() => fn({ ok: true, system: 'generic', entries: [] }), 0);
        if (event === 'itemGiven') setTimeout(() => fn({ ok: true, preview: true, item: {}, qty: 1, note: '', recipients: [
          { kind: 'player', username: 'vex', name: 'Vex', given: false, lands: { shape: 'inventory', stacked: false } },
          { kind: 'player', username: 'rook', name: 'Rook', given: false, lands: { shape: 'inventory', stacked: false } },
          { kind: 'npc', location_id: 12, name: 'GANGER', given: false, lands: { shape: 'inventory', stacked: false } },
        ] }), 0);
      },
      off: () => {},
      emit: () => {},
    };
    const props = { pos: { x: 0, y: 0 }, setPos: () => {}, onClose: () => {}, socket, system: 'generic', npcs: [{ id: 12 }], online: [] };
    const { rerender } = render(<GiveItemWindow {...props} preselect={['player:vex']} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Give Rope' }));
    const table = await screen.findByRole('table', { name: 'Who gets it' });
    expect(screen.getByRole('tab', { name: 'TO' }).textContent).toBe('TO · 1');
    rerender(<GiveItemWindow {...props} preselect={['npc:12']} />);
    expect(screen.getByRole('tab', { name: 'TO' }).textContent).toBe('TO · 2');
    expect((within(table).getByRole('checkbox', { name: 'Vex' }) as HTMLInputElement).checked).toBe(true);
    expect((within(table).getByRole('checkbox', { name: 'GANGER' }) as HTMLInputElement).checked).toBe(true);
    rerender(<GiveItemWindow {...props} preselect={[]} />);
    expect(screen.getByRole('tab', { name: 'TO' }).textContent).toBe('TO · 2');
  });
});

describe('the player\'s notice', () => {
  const fakeSocket = () => {
    const listeners: Record<string, ((d: unknown) => void)[]> = {};
    const socket = {
      on: (event: string, fn: (d: unknown) => void) => { (listeners[event] ??= []).push(fn); },
      off: (event: string, fn: (d: unknown) => void) => { listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn); },
    };
    const send = (notice: ReceivedNotice) => act(() => { (listeners.itemReceived ?? []).forEach((f) => f(notice)); });
    return { socket, send, count: () => (listeners.itemReceived ?? []).length };
  };
  const pistol: ReceivedNotice = { item: 'Heavy Pistol', catalogue: 'weapons', qty: 2, note: 'For the job tonight.' };

  it('shows nothing until something is given, then what, how many and the note', () => {
    const s = fakeSocket();
    render(<GiftNotices socket={s.socket} system="cities_without_number" />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByTestId('gift-notices')).toBeNull();
    s.send(pistol);
    expect(screen.getByRole('status').textContent).toBe('THE GM GAVE YOU HEAVY PISTOL ×2“For the job tonight.”It\'s on your sheet.✕');
    s.send({ ...pistol, item: 'Rope', qty: 1, note: '' });
    expect(screen.getAllByRole('status')[0].textContent).toBe('THE GM GAVE YOU ROPE ×1It\'s on your sheet.✕');
  });

  it('keeps the newest few, each until closed', async () => {
    const s = fakeSocket();
    render(<GiftNotices socket={s.socket} system="generic" />);
    for (let i = 1; i <= NOTICES_KEPT + 1; i += 1) s.send({ ...pistol, item: `Thing ${i}`, note: '' });
    expect(NOTICES_KEPT).toBe(3);
    expect(screen.getAllByRole('status').map((n) => n.textContent?.split(' ×')[0])).toEqual(['THE GM GAVE YOU THING 4', 'THE GM GAVE YOU THING 3', 'THE GM GAVE YOU THING 2']);
    await userEvent.click(within(screen.getAllByRole('status')[1]).getByRole('button', { name: 'Dismiss' }));
    expect(screen.getAllByRole('status').map((n) => n.textContent?.split(' ×')[0])).toEqual(['THE GM GAVE YOU THING 4', 'THE GM GAVE YOU THING 2']);
    for (const n of screen.getAllByRole('status')) await userEvent.click(within(n).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('gift-notices')).toBeNull();
  });

  it('says the game\'s own word for the GM', () => {
    registerCustomTemplate({ id: 'sys_aaaaaaaaaaaaaaaa', name: 'Hearth', parts: {}, derived: [], sheet: { sections: [] },
      words: { gm: { singular: 'Keeper', plural: 'Keepers', short: 'Keeper' } } } as unknown as CustomRender);
    const s = fakeSocket();
    render(<GiftNotices socket={s.socket} system="sys_aaaaaaaaaaaaaaaa" />);
    s.send(pistol);
    expect(screen.getByRole('status').textContent).toMatch(/^THE KEEPER GAVE YOU HEAVY PISTOL ×2/);
  });

  it('stops listening when it goes', () => {
    const s = fakeSocket();
    const { unmount } = render(<GiftNotices socket={s.socket} system="generic" />);
    expect(s.count()).toBe(1);
    unmount();
    expect(s.count()).toBe(0);
  });
});
