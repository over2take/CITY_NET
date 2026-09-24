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
import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CatalogueWindow } from '../CatalogueWindow';

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
