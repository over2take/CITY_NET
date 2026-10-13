import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { GiveItemWindow } from '../GiveItemWindow';
import type { AskSocket, Recipient } from '../../sheets/giveItems';

/**
 * GIVE.EXE (4g4b; approved mockup docs/mockups/give-item.html, 2026-10-12), on the shop's layout:
 * the item in the corner, ITEMS / TO / GIVEN down the left, GIVE along the bottom. The server is a
 * fake socket answering as backend/sockets/index.js does.
 */

afterEach(() => cleanup());

const CWN = 'cities_without_number';
const CATALOGUES = [
  { catalogue: 'weapons', items: [{ id: 'heavy_pistol', name: 'Heavy Pistol', price: 200 }, { id: 'knife', name: 'Knife', price: 10 }] },
  { catalogue: 'gear', items: [{ id: 'rope', name: 'Rope, 50 ft', price: 5 }] },
];
const LINE = { id: 7, at: '2026-10-01 19:42:00', by: 'gm', catalogue: 'gear', item: 'Climbing kit', qty: 1, to: ['Rook'], note: 'For the climb.' };

/** Everyone the preview lists, for `qty`: Juno's rows are full. */
const everyone = (qty: number): Recipient[] => [
  { kind: 'player', username: 'juno', name: 'Juno', given: false, reason: 'No free weapon row — all 6 are full.' },
  { kind: 'player', username: 'rook', name: 'Rook', given: false, lands: { shape: 'rows', group: 'weapon', rows: Array.from({ length: qty }, (_, i) => i + 2) } },
  { kind: 'player', username: 'Vex', name: 'Vex', given: false, lands: { shape: 'rows', group: 'weapon', rows: Array.from({ length: qty }, (_, i) => i + 3) } },
  { kind: 'npc', location_id: 12, name: 'GANGER', given: false, lands: { shape: 'rows', group: 'weapon', rows: [1] } },
];

type Answers = { givable?: unknown; given?: unknown; give?: (payload: Record<string, unknown>) => unknown; hold?: boolean };

const fakeServer = (answers: Answers = {}) => {
  const listeners: Record<string, ((d: unknown) => void)[]> = {};
  const sent: { event: string; payload: Record<string, unknown> }[] = [];
  const held: (() => void)[] = [];
  const reply = (event: string, data: unknown) => {
    const send = () => (listeners[event] ?? []).slice().forEach((f) => f(data));
    if (answers.hold && event === 'itemGiven') held.push(send); else setTimeout(send, 0);
  };
  const socket: AskSocket = {
    on: (event, fn) => { (listeners[event] ??= []).push(fn); },
    off: (event, fn) => { listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn); },
    emit: (event, payload) => {
      sent.push({ event, payload: (payload ?? {}) as Record<string, unknown> });
      if (event === 'requestGivable') reply('givableItems', answers.givable ?? { ok: true, system: CWN, catalogues: CATALOGUES });
      if (event === 'requestGiven') reply('givenList', answers.given ?? { ok: true, system: CWN, entries: [LINE] });
      if (event === 'giveItem') {
        const p = payload as Record<string, unknown>;
        const own = answers.give?.(p);
        if (own !== undefined) { reply('itemGiven', own); return; }
        const qty = Number(p.qty);
        const item = { catalogue: p.catalogue, id: p.id, name: 'Heavy Pistol', price: 200 };
        if (p.preview) { reply('itemGiven', { ok: true, preview: true, item, qty, note: '', recipients: everyone(qty) }); return; }
        const named = new Set([...(p.players as string[]), ...(p.npcs as number[]).map(String)]);
        const recipients = everyone(qty).filter((r) => named.has(String(r.username ?? r.location_id))).map((r) => ({ ...r, given: true }));
        reply('itemGiven', { ok: true, preview: false, item, qty, note: p.note, recipients, given: [{ ...LINE, id: 8, item: 'Heavy Pistol', qty, to: recipients.map((r) => r.name), note: String(p.note) }, LINE] });
      }
    },
  };
  /** Let the oldest held answer through. */
  const release = () => held.shift()?.();
  return { socket, sent, release, gives: () => sent.filter((s) => s.event === 'giveItem') };
};

const open = (server = fakeServer(), props: Partial<React.ComponentProps<typeof GiveItemWindow>> = {}) => {
  render(<GiveItemWindow pos={{ x: 0, y: 0 }} setPos={() => {}} onClose={() => {}} socket={server.socket} system={CWN}
    npcs={[{ id: 12 }, { id: 13 }]} online={['vex']} {...props} />);
  return server;
};
const folder = (name: string) => screen.getByRole('tab', { name });
const giveButton = () => screen.getAllByRole('button').find((b) => /^GIV(E|ING)/.test(b.textContent ?? '') && !b.getAttribute('aria-label'))!;
const pickPistol = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Give Heavy Pistol' }));
  await screen.findByRole('table', { name: 'Who gets it' });
};
const row = (name: RegExp) => within(screen.getByRole('table', { name: 'Who gets it' })).getByText(name).closest('tr') as HTMLElement;

describe('GIVE.EXE', () => {
  it('is laid out as the other terminal windows: ITEMS, TO and GIVEN, the item in the corner, GIVE at the bottom', async () => {
    open();
    expect(screen.getByText('GIVE.EXE')).toBeTruthy();
    expect(within(screen.getByRole('tablist', { name: 'Folders' })).getAllByRole('tab').map((t) => t.textContent)).toEqual(['ITEMS', 'TO', 'GIVEN']);
    expect(within(await screen.findByRole('tablist', { name: 'Catalogue' })).getAllByRole('tab').map((t) => t.textContent)).toEqual(['ALL', 'WEAPONS', 'OPERATOR GEAR']);
    expect(folder('ITEMS').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('give-card').textContent).toContain('Pick an item from ITEMS.');
    expect((giveButton() as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('ITEMS', () => {
  it('lists everything the game can give, with its worth, by name', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'Items' });
    expect(within(table).getAllByRole('row').slice(1).map((r) => r.textContent)).toEqual([
      'Heavy PistolWEAPONS200crGIVE', 'KnifeWEAPONS10crGIVE', 'Rope, 50 ftOPERATOR GEAR5crGIVE',
    ]);
    expect(screen.getByText('3 OF 3 ITEMS · NOTHING IS CHARGED')).toBeTruthy();
  });

  it('narrows to a catalogue and to a name', async () => {
    open();
    await userEvent.click(await screen.findByRole('tab', { name: 'OPERATOR GEAR' }));
    expect(screen.getByRole('tab', { name: 'OPERATOR GEAR' }).getAttribute('aria-selected')).toBe('true');
    expect(within(screen.getByRole('table', { name: 'Items' })).getAllByRole('row')).toHaveLength(2);
    await userEvent.click(screen.getByRole('tab', { name: 'ALL' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Search every catalogue' }), 'KNI');
    expect(within(screen.getByRole('table', { name: 'Items' })).getAllByRole('row').slice(1).map((r) => r.cells[0].textContent)).toEqual(['Knife']);
    expect(screen.getByText('1 OF 3 ITEMS · NOTHING IS CHARGED')).toBeTruthy();
    await userEvent.type(screen.getByRole('textbox', { name: 'Search every catalogue' }), 'zzz');
    expect(screen.getByTestId('give-empty').textContent).toBe('NOTHING MATCHES THAT');
  });

  it('says so when the game has nothing to give, and shows no tabs for one catalogue', async () => {
    open(fakeServer({ givable: { ok: true, system: CWN, catalogues: [] } }));
    expect((await screen.findByTestId('give-empty')).textContent).toMatch(/Upload a catalogue first/);
    cleanup();
    open(fakeServer({ givable: { ok: true, system: CWN, catalogues: [CATALOGUES[1]] } }));
    await screen.findByRole('table', { name: 'Items' });
    expect(screen.queryByRole('tablist', { name: 'Catalogue' })).toBeNull();
  });

  it('says why when GIVE ITEM is off, or the server doesn\'t answer what it can give', async () => {
    open(fakeServer({ givable: { ok: false, reason: 'give_off' } }));
    expect((await screen.findByRole('alert')).textContent).toBe('GIVE ITEM is switched off in this game.');
  });
});

describe('TO', () => {
  it('opens on picking an item, the item in the corner, and asks where it would land on everyone', async () => {
    const server = open();
    await pickPistol();
    expect(folder('TO').getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('give-card').textContent).toBe('GIVINGHEAVY PISTOLWEAPONSWORTH 200cr×1 · FREE');
    expect(server.gives()[0].payload).toEqual({ catalogue: 'weapons', id: 'heavy_pistol', qty: 1, players: true, npcs: [12, 13], preview: true });
    expect(row(/^JUNO/).textContent).toBe('JUNO · OFFLINENo free weapon row');
    expect(row(/^VEX/).textContent).toBe('VEX · ONLINEweapon row 3, Stowed');
    expect(row(/^GANGER/).textContent).toBe('GANGER · NPCweapon row 1, Stowed');
    expect(screen.getByText('0 TICKED · 4 IN THIS GAME')).toBeTruthy();
  });

  it('says Stowed only where the game stows a weapon (CWN)', async () => {
    open(undefined, { system: 'cyberpunk_red' });
    await pickPistol();
    expect(row(/^VEX/).textContent).toBe('VEX · ONLINEweapon row 3');
  });

  it('drops a preview answered for a number since changed', async () => {
    const server = open(fakeServer({ hold: true }));
    await userEvent.click(await screen.findByRole('button', { name: 'Give Heavy Pistol' }));
    await userEvent.click(screen.getByRole('button', { name: 'One more' }));
    await act(async () => { server.release(); });
    expect(screen.queryByRole('table', { name: 'Who gets it' })).toBeNull();
    await waitFor(() => expect(server.gives()).toHaveLength(2));
    await act(async () => { server.release(); });
    expect(row(/^VEX/).textContent).toBe('VEX · ONLINEweapon rows 3–4, Stowed');
  });

  it('asks again for HOW MANY, kept to 1 to 99', async () => {
    const server = open();
    await pickPistol();
    const fewer = screen.getByRole('button', { name: 'One fewer' }) as HTMLButtonElement;
    expect(fewer.disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'One more' }));
    await waitFor(() => expect(row(/^VEX/).textContent).toBe('VEX · ONLINEweapon rows 3–4, Stowed'));
    expect(server.gives().map((g) => g.payload.qty)).toEqual([1, 2]);
    expect(screen.getByLabelText('How many').textContent).toBe('2');
  });

  it('ticks and unticks by the row, and says who won\'t get it', async () => {
    open();
    await pickPistol();
    await userEvent.click(row(/^VEX/));
    await userEvent.click(within(row(/^JUNO/)).getByRole('checkbox'));
    expect(folder('TO').textContent).toBe('TO · 2');
    expect(screen.getByText("JUNO WON'T GET IT: NO FREE WEAPON ROW")).toBeTruthy();
    expect(giveButton().textContent).toBe('GIVE 1 × HEAVY PISTOL TO 1');
    await userEvent.click(row(/^VEX/));
    expect((giveButton() as HTMLButtonElement).disabled).toBe(true);
    expect(giveButton().textContent).toBe('GIVE 1 × HEAVY PISTOL');
  });

  it('starts with the characters it was opened for ticked', async () => {
    open(undefined, { preselect: ['player:rook', 'npc:12'] });
    await pickPistol();
    expect(folder('TO').textContent).toBe('TO · 2');
    expect((within(row(/^ROOK/)).getByRole('checkbox') as HTMLInputElement).checked).toBe(true);
  });

  it('says so when nobody is in the game, and before an item is picked', async () => {
    open(fakeServer({ give: (p) => (p.preview ? { ok: true, preview: true, item: {}, qty: 1, note: '', recipients: [] } : undefined) }));
    await userEvent.click(folder('TO'));
    expect(screen.getByText('Pick an item in ITEMS first.')).toBeTruthy();
    expect(screen.getByText('PICK AN ITEM FIRST')).toBeTruthy();
    await userEvent.click(folder('ITEMS'));
    await userEvent.click(await screen.findByRole('button', { name: 'Give Heavy Pistol' }));
    expect(await screen.findByText('No characters in this game yet.')).toBeTruthy();
  });
});

describe('GIVE', () => {
  it('gives to the ticked ones who have room, with the note, and says how it went', async () => {
    const server = open();
    await pickPistol();
    await userEvent.click(row(/^VEX/));
    await userEvent.click(row(/^GANGER/));
    await userEvent.click(row(/^JUNO/));
    await userEvent.type(screen.getByRole('textbox', { name: 'NOTE TO THEM (OPTIONAL)' }), 'For the job.');
    await userEvent.click(giveButton());
    await screen.findByRole('status');
    expect(server.gives()[1].payload).toEqual({ catalogue: 'weapons', id: 'heavy_pistol', qty: 1, players: ['Vex'], npcs: [12], note: 'For the job.' });
    expect(screen.getByRole('status').textContent).toBe('JUNO: NOT GIVEN, NO FREE WEAPON ROWVEX: GIVEN, WEAPON ROW 3, STOWEDGANGER: GIVEN, WEAPON ROW 1, STOWED');
    expect(screen.queryByText(/WON'T GET IT/)).toBeNull();
    // Where the next would land, asked again.
    await waitFor(() => expect(server.gives()).toHaveLength(3));
    expect(server.gives()[2].payload.preview).toBe(true);
  });

  it('adds the line to GIVEN, which blinks until opened', async () => {
    open();
    await pickPistol();
    await userEvent.click(row(/^VEX/));
    await userEvent.click(giveButton());
    await screen.findByRole('status');
    expect(folder('GIVEN').className).toContain('terminal-folder-attention');
    await userEvent.click(folder('GIVEN'));
    await userEvent.click(folder('TO'));
    expect(folder('GIVEN').className).not.toContain('terminal-folder-attention');
    await userEvent.click(folder('GIVEN'));
    const lines = within(screen.getByRole('table', { name: 'Given' })).getAllByRole('row').slice(1);
    expect(lines.map((r) => [...r.cells].slice(1).map((c) => c.textContent))).toEqual([
      ['gm', 'Vex', 'Heavy Pistol', '×1'],
      ['gm', 'Rook', 'Climbing kit · “For the climb.”', '×1'],
    ]);
    expect(screen.getByText('LAST 2 GIVEN')).toBeTruthy();
  });

  it('clears how the last GIVE went on picking another item', async () => {
    open();
    await pickPistol();
    await userEvent.click(row(/^VEX/));
    await userEvent.click(giveButton());
    await screen.findByRole('status');
    await userEvent.click(folder('ITEMS'));
    await userEvent.click(screen.getByRole('button', { name: 'Give Knife' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says why a whole GIVE was refused', async () => {
    open(fakeServer({ give: (p) => (p.preview ? undefined : { ok: false, reason: 'give_off' }) }));
    await pickPistol();
    await userEvent.click(row(/^VEX/));
    await userEvent.click(giveButton());
    expect((await screen.findByRole('alert')).textContent).toBe('GIVE ITEM is switched off in this game.');
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('GIVEN', () => {
  it('lists the game\'s last gifts on opening', async () => {
    open();
    await userEvent.click(folder('GIVEN'));
    const table = await screen.findByRole('table', { name: 'Given' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    expect(within(table).getAllByRole('row')[1].getAttribute('title')).toBe('For the climb.');
  });

  it('says so when nothing has been given', async () => {
    open(fakeServer({ given: { ok: true, system: CWN, entries: [] } }));
    await userEvent.click(folder('GIVEN'));
    expect(await screen.findByText('Nothing given yet.')).toBeTruthy();
  });
});
