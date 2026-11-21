/**
 * The window a GM adds to the shops through.
 *
 * Everything behind it is tested elsewhere - the parser, the store, buying and selling an
 * uploaded item. What is tested here is the way in, and one rule above the rest: **SAVE
 * only ever stores text that was previewed.** Change the box after a preview and the save
 * goes away until it is previewed again, or the thing stored could be something nobody
 * looked at.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CatalogueWindow } from '../CatalogueWindow';
import { registerCustomTemplate, clearCustomTemplates } from '../../sheets/customTemplates';

/** A socket that records what was sent and lets a test answer as the server would. */
let listeners: Record<string, Function[]> = {};
let sent: { event: string; data: any }[] = [];

const makeSocket = () => ({
  on: (ev: string, fn: Function) => { (listeners[ev] ||= []).push(fn); },
  off: (ev: string, fn: Function) => {
    listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn);
  },
  emit: (event: string, data?: any) => { sent.push({ event, data }); },
});

/** The server replying. */
const reply = (event: string, data: any) =>
  act(() => (listeners[event] || []).forEach((f) => f(data)));

/** Files handed to the browser to save, caught rather than downloaded. */
let downloads: { name: string; text: string }[] = [];

beforeEach(() => {
  listeners = {};
  sent = [];
  downloads = [];
  // jsdom has no object URLs. Capture the blob instead, and read it back as text.
  let lastBlob: Blob | null = null;
  (URL as any).createObjectURL = vi.fn((b: Blob) => { lastBlob = b; return 'blob:x'; });
  (URL as any).revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    const name = this.download;
    const blob = lastBlob;
    if (blob) {
      // Read synchronously enough for the assertion that follows: blob.text() is a promise,
      // so the download is recorded once it resolves and tests await that.
      blob.text().then((text) => downloads.push({ name, text }));
    }
  });
});

afterEach(() => vi.restoreAllMocks());

const show = (system = 'cities_without_number') =>
  render(<CatalogueWindow pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()}
    socket={makeSocket()} system={system} />);

const box = () => screen.getByLabelText('Catalogue text') as HTMLTextAreaElement;
const button = (name: string | RegExp) => screen.getByRole('button', { name });

const type = (text: string) => fireEvent.change(box(), { target: { value: text } });

const ZIP = '[weapons]\nname, price, dmg\nZip Gun, 15, 1d4';

const cleanPreview = {
  format: 'delimited',
  problems: [],
  summary: [{ catalogue: 'weapons', count: 1, overrides: [] }],
};

describe('getting a file to start from', () => {
  it('downloads an example shaped for the system that is running', async () => {
    show('cyberpunk_red');
    await userEvent.click(button('DOWNLOAD EXAMPLE'));
    await vi.waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].name).toBe('cyberpunk_red-storefronts-example.csv');
    expect(downloads[0].text).toContain('# system: cyberpunk_red');
    expect(downloads[0].text).toContain('[weapons]');
  });

  it('downloads what is on sale now, with the built-in rows behind a #', async () => {
    show();
    await userEvent.click(button('DOWNLOAD CURRENT'));
    expect(sent.map((s) => s.event)).toContain('requestCatalogues');

    reply('catalogues', {
      entries: {
        weapons: [
          { id: 'heavy_pistol', name: 'Heavy Pistol', price: 200, source: 'book' },
          { id: 'zip_gun', name: 'Zip Gun', price: 15, fields: {}, source: 'uploaded' },
        ],
      },
    });
    await vi.waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].name).toBe('cities_without_number-storefronts-current.csv');
    expect(downloads[0].text).toMatch(/#\s+Heavy Pistol/);
    expect(downloads[0].text).toMatch(/^Zip Gun/m);
  });

  it('does not download when the catalogues arrive without being asked for', async () => {
    // App asks for them on every change so the shelves stay current. That must not hand
    // the GM a file every time somebody else saves a catalogue.
    show();
    reply('catalogues', { entries: { weapons: [] } });
    await new Promise((r) => setTimeout(r, 20));
    expect(downloads).toEqual([]);
  });
});

describe('previewing', () => {
  it('sends the text to be read, and shows what came back', async () => {
    show();
    type(ZIP);
    await userEvent.click(button('PREVIEW'));

    expect(sent).toContainEqual({ event: 'previewCatalogue', data: { text: ZIP } });
    reply('cataloguePreview', cleanPreview);
    expect(screen.getByText(/1 ROW READ/)).toBeInTheDocument();
    expect(screen.getByText(/WEAPONS ×1/)).toBeInTheDocument();
  });

  it('names each problem by its line', async () => {
    show();
    type(ZIP);
    await userEvent.click(button('PREVIEW'));
    reply('cataloguePreview', {
      ...cleanPreview,
      problems: [{ line: 4, catalogue: 'weapons', name: 'Broken', message: 'price "x" is not a number' }],
    });
    expect(screen.getByText(/1 PROBLEM/)).toBeInTheDocument();
    expect(screen.getByText(/LINE 4 \[weapons\] Broken: price "x" is not a number/)).toBeInTheDocument();
  });

  it('warns that a row replaces something the app ships with', async () => {
    // Allowed - a GM house-ruling a price means it - but it should be chosen, not happen.
    show();
    type('[weapons]\nname, price\nHeavy Pistol, 250');
    await userEvent.click(button('PREVIEW'));
    reply('cataloguePreview', {
      ...cleanPreview,
      summary: [{ catalogue: 'weapons', count: 1, overrides: ['Heavy Pistol'] }],
    });
    expect(screen.getByText(/REPLACES THE BUILT-IN Heavy Pistol/)).toBeInTheDocument();
  });

  it('will not preview an empty box', () => {
    show();
    expect(button('PREVIEW')).toBeDisabled();
  });

  it('refuses text too big to send, rather than letting it vanish', () => {
    // Socket.io drops anything over a megabyte without saying so.
    show();
    type(`[gear]\nname, price\n${'x'.repeat(950_000)}, 1`);
    expect(screen.getByText(/too much to send at once/)).toBeInTheDocument();
    expect(button('PREVIEW')).toBeDisabled();
  });
});

describe('saving only what was previewed', () => {
  it('is not offered before a preview', () => {
    show();
    type(ZIP);
    expect(button('SAVE')).toBeDisabled();
  });

  it('is offered once the preview comes back with rows in it', async () => {
    show();
    type(ZIP);
    await userEvent.click(button('PREVIEW'));
    reply('cataloguePreview', cleanPreview);
    expect(button('SAVE')).toBeEnabled();
  });

  it('is taken away the moment the text changes after a preview', async () => {
    show();
    type(ZIP);
    await userEvent.click(button('PREVIEW'));
    reply('cataloguePreview', cleanPreview);

    type(`${ZIP}\nSlug Thrower, 80`);
    expect(button('SAVE')).toBeDisabled();
    expect(screen.getByText(/CHANGED SINCE PREVIEW/)).toBeInTheDocument();
  });

  it('comes back when the text is put back exactly as previewed', async () => {
    show();
    type(ZIP);
    await userEvent.click(button('PREVIEW'));
    reply('cataloguePreview', cleanPreview);
    type(`${ZIP}!`);
    type(ZIP);
    expect(button('SAVE')).toBeEnabled();
  });

  it('is not offered when nothing could be read', async () => {
    show();
    type('nonsense');
    await userEvent.click(button('PREVIEW'));
    reply('cataloguePreview', { format: 'delimited', problems: [{ line: 1, message: 'no section' }], summary: [] });
    expect(button('SAVE')).toBeDisabled();
    expect(screen.getByText(/nothing to save/)).toBeInTheDocument();
  });

  it('sends the previewed text, and says what the shops now have', async () => {
    show();
    type(ZIP);
    await userEvent.click(button('PREVIEW'));
    reply('cataloguePreview', cleanPreview);
    await userEvent.click(button('SAVE'));

    expect(sent).toContainEqual({ event: 'saveCatalogue', data: { text: ZIP } });
    reply('catalogueSaved', { ok: true, saved: [{ catalogue: 'weapons', count: 1 }] });
    expect(screen.getByText(/Saved: Weapons ×1\. The shops have it now\./)).toBeInTheDocument();
  });

  it('names the catalogues as a custom system does (3b3b2)', async () => {
    const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
    registerCustomTemplate({ id: HEARTH, name: 'Hearth', parts: {}, derived: [], sheet: { sections: [] }, words: {},
      buildings: { catalogues: { weapons: { name: 'Arms' } } } });
    try {
      show(HEARTH);
      type(ZIP);
      await userEvent.click(button('PREVIEW'));
      reply('cataloguePreview', cleanPreview);
      expect(screen.getByText(/ARMS ×1/)).toBeInTheDocument();
      await userEvent.click(button('SAVE'));
      reply('catalogueSaved', { ok: true, saved: [{ catalogue: 'weapons', count: 1 }] });
      expect(screen.getByText(/Saved: Arms ×1\./)).toBeInTheDocument();
    } finally {
      clearCustomTemplates();
    }
  });

  it('a custom system\'s items (7e3c): DOWNLOAD ITEMS, and the preview naming item lines and near misses', async () => {
    const HEARTH = 'sys_cccccccccccccccc';
    registerCustomTemplate({ id: HEARTH, name: 'Hearth', parts: {}, derived: [], sheet: { sections: [] }, words: {},
      items: { slots: [{ id: 'attuned', label: 'ATTUNED', count: 3 }], list: [{ id: 'ring', label: 'Ring of Might', description: 'Heavy.', needs: 'attuned', features: [] }] } });
    try {
      show(HEARTH);
      await userEvent.click(button('DOWNLOAD ITEMS'));
      await vi.waitFor(() => expect(downloads).toHaveLength(1));
      expect(downloads[0].name).toBe(`${HEARTH}-storefronts-items.csv`);
      expect(downloads[0].text).toContain('[gear]');
      expect(downloads[0].text).toMatch(/^Ring of Might\s*,\s*,\s*,\s*Heavy\.$/m);

      type('[gear]\nname, price\nRing of Might, 500\nRing of Migt, 5');
      await userEvent.click(button('PREVIEW'));
      reply('cataloguePreview', { problems: [], format: 'csv', summary: [{ catalogue: 'gear', count: 2, overrides: [] }],
        sections: { gear: [{ name: 'Ring of Might', price: 500, line: 3 }, { name: 'Ring of Migt', price: 5, line: 4 }] } });
      expect(screen.getByTestId('catalogue-items').textContent).toBe('ITEMS: RING OF MIGHT · bought, each is that item, to WEAR and ATTUNE');
      expect(screen.getByText('LINE 4 [gear] Ring of Migt: nearly the item Ring of Might. Name it exactly to sell that item')).toBeInTheDocument();
    } finally {
      clearCustomTemplates();
    }
  });

  it('no DOWNLOAD ITEMS, nor item lines, on a game without items', async () => {
    show();
    expect(screen.queryByRole('button', { name: 'DOWNLOAD ITEMS' })).toBeNull();
    type(ZIP);
    await userEvent.click(button('PREVIEW'));
    reply('cataloguePreview', { ...cleanPreview, sections: { weapons: [{ name: 'Zip Gun', price: 15, line: 3 }] } });
    expect(screen.queryByTestId('catalogue-items')).toBeNull();
  });

  it('says so when the save fails, and that nothing changed', async () => {
    show();
    type(ZIP);
    await userEvent.click(button('PREVIEW'));
    reply('cataloguePreview', cleanPreview);
    await userEvent.click(button('SAVE'));
    reply('catalogueSaved', { ok: false, reason: 'write' });
    expect(screen.getByText(/did not go through\. Nothing was changed/)).toBeInTheDocument();
  });
});

describe('uploading a file', () => {
  it('puts the file in the box to be previewed, rather than saving it outright', async () => {
    show();
    const input = screen.getByLabelText('Catalogue file') as HTMLInputElement;
    const file = new File([ZIP], 'guns.csv', { type: 'text/csv' });
    await userEvent.upload(input, file);

    await vi.waitFor(() => expect(box().value).toBe(ZIP));
    // Loaded, not saved: the same preview-then-save rule applies to a file.
    expect(sent.map((s) => s.event)).not.toContain('saveCatalogue');
    expect(button('SAVE')).toBeDisabled();
  });

  it('refuses a file too big to send', async () => {
    show();
    const input = screen.getByLabelText('Catalogue file') as HTMLInputElement;
    const big = new File(['x'.repeat(950_000)], 'huge.csv', { type: 'text/csv' });
    await userEvent.upload(input, big);
    expect(screen.getByText(/Split it into smaller files/)).toBeInTheDocument();
    expect(box().value).toBe('');
  });
});

describe("a type's section (8a7a1)", () => {
  it('by its name: counted, its problems and blanks said by it; a blank noted, not a problem; the save said by it too', async () => {
    show();
    type('[GUNS]\nname, price, damage\nPistol, 250, 2d6');
    await userEvent.click(button('PREVIEW'));
    reply('cataloguePreview', {
      format: 'delimited',
      summary: [{ catalogue: 'type:guns', count: 2, overrides: [], label: 'GUNS' }],
      problems: [{ line: 5, catalogue: 'type:guns', name: 'Bad Gun', message: 'AMMO "six": How many it holds: 0 to 1000' }],
      notes: [{ line: 4, catalogue: 'type:guns', name: 'Blank Gun', message: 'RANGE, AMMO left blank' }],
    });
    expect(screen.getByText(/^GUNS ×2/)).toBeInTheDocument();
    expect(screen.getByText(/1 PROBLEM/)).toBeInTheDocument();
    expect(screen.getByText(/LINE 5 \[GUNS\] Bad Gun: AMMO "six"/)).toBeInTheDocument();
    expect(screen.getByTestId('catalogue-note')).toHaveTextContent('LINE 4 [GUNS] Blank Gun: RANGE, AMMO left blank, kept; the player can fill it in');
    await userEvent.click(button('SAVE'));
    reply('catalogueSaved', { ok: true, saved: [{ catalogue: 'type:guns', count: 2, label: 'GUNS' }] });
    expect(screen.getByText('Saved: GUNS ×2. The shops have it now.')).toBeInTheDocument();
  });
});

describe('the file held against the game\'s own items (8a7a3c1)', () => {
  const ITEMS = {
    onSale: 9,
    overrules: [{ line: 4, catalogue: 'type:guns', name: 'Pistol', from: 200, to: 260 }, { line: 5, catalogue: 'type:guns', name: 'Derringer', from: 90, to: 90 }],
    leftOut: [{ line: 6, catalogue: 'type:guns', name: 'Cutlass', message: 'already on ITEMS at 120, the same in every column: left out, as it sells itself' }],
  };
  const preview = (items?: object) => reply('cataloguePreview', {
    format: 'delimited', summary: [{ catalogue: 'type:guns', count: 2, overrides: [], label: 'GUNS' }], problems: [], ...(items ? { items } : {}),
  });

  it('how many sell themselves besides, each line overruling one and how, each left out and why', async () => {
    show();
    type('[GUNS]\nname, price\nPistol, 260');
    await userEvent.click(button('PREVIEW'));
    preview(ITEMS);
    expect(screen.getByTestId('catalogue-on-sale')).toHaveTextContent('ALSO ON SALE FROM ITEMS: 9 (2 overruled by this file)');
    expect(screen.getAllByTestId('catalogue-overrules').map((n) => n.textContent)).toEqual([
      'LINE 4 [GUNS] Pistol: overrules the item, 200 → 260 in the shops',
      'LINE 5 [GUNS] Derringer: overrules the item, its columns in the shops',
    ]);
    expect(screen.getByTestId('catalogue-left-out')).toHaveTextContent('LINE 6 [GUNS] Cutlass: already on ITEMS at 120, the same in every column: left out, as it sells itself');
  });

  it('none overruled: the count alone; a game with no items of its own: nothing said', async () => {
    show();
    type('[GUNS]\nname, price\nPistol, 260');
    await userEvent.click(button('PREVIEW'));
    preview({ onSale: 3, overrules: [], leftOut: [] });
    expect(screen.getByTestId('catalogue-on-sale')).toHaveTextContent(/^ALSO ON SALE FROM ITEMS: 3$/);
    preview();
    expect(screen.queryByTestId('catalogue-on-sale')).toBeNull();
    expect(screen.queryByTestId('catalogue-overrules')).toBeNull();
  });
});

describe('ADD NEW LINES TO ITEMS (8a7a4a)', () => {
  const TO_ITEMS = {
    added: [{ line: 4, catalogue: 'type:guns', name: 'Hand Cannon', type: 'GUNS', price: 900 }, { line: 5, catalogue: 'type:guns', name: 'Derringer', type: 'GUNS', price: 90 }],
    skipped: [{ line: 6, catalogue: 'type:guns', name: 'Overflow', message: 'ITEMS holds 200, the most a system can: not added' }],
    have: 12, most: 200,
  };
  const previewWith = (toItems?: object) => reply('cataloguePreview', {
    format: 'delimited', summary: [{ catalogue: 'type:guns', count: 3, overrides: [], label: 'GUNS' }], problems: [], ...(toItems ? { toItems } : {}),
  });

  it('off to start; on, what it adds and how many ITEMS will hold; saved with it said, and handed to an open builder', async () => {
    show();
    type('[GUNS]\nname, price\nHand Cannon, 900');
    await userEvent.click(button('PREVIEW'));
    previewWith(TO_ITEMS);
    const panel = within(screen.getByTestId('catalogue-to-items'));
    const toggle = panel.getByRole('switch', { name: /ADD NEW LINES TO ITEMS/ });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(panel.queryByText(/becomes an item/)).toBeNull();
    await userEvent.click(toggle);
    expect(panel.getByText('Hand Cannon becomes an item of GUNS, 900')).toBeInTheDocument();
    expect(panel.getByText('Derringer becomes an item of GUNS, 90')).toBeInTheDocument();
    expect(panel.getByText(/^ITEMS · 12 OF 200 → 14 OF 200/)).toBeInTheDocument();
    expect(panel.getByText('LINE 6 Overflow: ITEMS holds 200, the most a system can: not added')).toBeInTheDocument();
    const heard = vi.fn();
    window.addEventListener('city:catalogue-items-added', heard);
    await userEvent.click(button('SAVE'));
    expect(sent.at(-1)).toEqual({ event: 'saveCatalogue', data: { text: '[GUNS]\nname, price\nHand Cannon, 900', toItems: true } });
    reply('catalogueSaved', { ok: true, saved: [{ catalogue: 'type:guns', count: 3, label: 'GUNS' }], toItems: { ok: true, added: [{ name: 'Hand Cannon' }, { name: 'Derringer' }], items: [{ id: 'hand_cannon' }, { id: 'derringer' }] } });
    expect(screen.getByText("Saved: GUNS ×3. The shops have it now. 2 lines added to ITEMS in the builder's draft: PUBLISH the system to keep them.")).toBeInTheDocument();
    expect(heard).toHaveBeenCalledOnce();
    expect((heard.mock.calls[0][0] as CustomEvent).detail).toEqual({ systemId: 'cities_without_number', items: [{ id: 'hand_cannon' }, { id: 'derringer' }] });
    window.removeEventListener('city:catalogue-items-added', heard);
  });

  it('left off, saved without it; nothing new to add, no switch; one added, said by name', async () => {
    show();
    type('[GUNS]\nname, price\nHand Cannon, 900');
    await userEvent.click(button('PREVIEW'));
    previewWith(TO_ITEMS);
    await userEvent.click(button('SAVE'));
    expect(sent.at(-1)).toEqual({ event: 'saveCatalogue', data: { text: '[GUNS]\nname, price\nHand Cannon, 900' } });
    reply('catalogueSaved', { ok: true, saved: [{ catalogue: 'type:guns', count: 1, label: 'GUNS' }], toItems: { ok: true, added: [{ name: 'Hand Cannon' }], items: [{ id: 'hand_cannon' }] } });
    expect(screen.getByText("Saved: GUNS ×1. The shops have it now. Hand Cannon added to ITEMS in the builder's draft: PUBLISH the system to keep it.")).toBeInTheDocument();
    await userEvent.click(button('PREVIEW'));
    previewWith();
    expect(screen.queryByTestId('catalogue-to-items')).toBeNull();
  });

  it('off again with each fresh preview, whatever it was before', async () => {
    show();
    type('[GUNS]\nname, price\nHand Cannon, 900');
    await userEvent.click(button('PREVIEW'));
    previewWith(TO_ITEMS);
    await userEvent.click(within(screen.getByTestId('catalogue-to-items')).getByRole('switch', { name: /ADD NEW LINES TO ITEMS/ }));
    await userEvent.click(button('PREVIEW'));
    previewWith(TO_ITEMS);
    expect(within(screen.getByTestId('catalogue-to-items')).getByRole('switch', { name: /ADD NEW LINES TO ITEMS/ }).getAttribute('aria-checked')).toBe('false');
  });
});
