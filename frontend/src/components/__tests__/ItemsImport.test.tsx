import React, { useState } from 'react';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';

import { ItemsPage } from '../ItemsPage';
import type { Definition, systemsApi } from '../../sheets/systemsApi';
import { downloadText } from '../../utils/downloadText';
import { forgetBuilderPlaces } from '../../hooks/useBuilderPlace';

vi.mock('../../utils/downloadText', () => ({ downloadText: vi.fn() }));

/**
 * IMPORT on the ITEMS tab (8aL3b). Approved mockup items-layout (2026-11-14), section 5: under the list, IMPORT, DOWNLOAD
 * EXAMPLE and DOWNLOAD THIS LIST; IMPORT opens beside the list in place of the open item, a file pasted or uploaded,
 * PREVIEW read by the server (here its real reader), mistakes warned of by line, APPLY into the draft only for the text
 * previewed, saying what it skipped.
 */

const req = createRequire(import.meta.url);
const { readItemsFile } = req('../../../../backend/systemBuilder/itemsImport.js');

afterEach(() => { cleanup(); forgetBuilderPlaces(); });
beforeEach(() => vi.mocked(downloadText).mockClear());

const ARMORY = {
  format: 1, name: 'Armory',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  items: {
    types: [
      { id: 'gear', label: 'GEAR', one: 'Gear', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }] },
      { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'grade', label: 'GRADE', kind: 'pick', options: ['LIGHT', 'HEAVY'] }] },
    ],
    list: [{ id: 'pistol', label: 'Pistol', type: 'weapons', values: { damage: '2d6', grade: 'LIGHT' } }],
  },
} as unknown as Definition;

const FILE = [
  '[weapons]', 'name, damage, grade, needs, words',
  'Pistol, 2d6 + @might, LIGHT, worn, A snub revolver.',
  'Shotgun, 3d6, HEAVY, worn,',
  'Crossbow, 1d10, MEDIUM, worn,',
].join('\n');

const server = () => {
  const importItems = vi.fn(async (definition: Definition, text: string) => {
    const { ok, error, ...value } = readItemsFile(definition, text);
    return ok ? { ok: true, value } : { ok: false, error, status: 400 };
  });
  return { importItems } as unknown as ReturnType<typeof systemsApi> & { importItems: typeof importItems };
};

const open = (api: ReturnType<typeof systemsApi> | null = server()) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(ARMORY);
    return <ItemsPage definition={def} edit={(next) => { edits.push(next); setDef(next); }} api={api ?? undefined} />;
  };
  render(<Harness />);
  fireEvent.click(screen.getByRole('tab', { name: 'ITEMS' }));
  return { api, edits };
};
const files = () => within(screen.getByRole('group', { name: 'Items from a file' }));
const panel = () => within(screen.getByRole('region', { name: 'Import items' }));
const box = () => screen.getByRole('textbox', { name: 'Text to import' }) as HTMLTextAreaElement;
const preview = async () => {
  await userEvent.click(panel().getByRole('button', { name: 'PREVIEW' }));
  return within(await screen.findByRole('status', { name: 'Preview' }));
};

describe('under the list', () => {
  it('DOWNLOAD EXAMPLE and DOWNLOAD THIS LIST hand out the files made from the system', async () => {
    open();
    await userEvent.click(files().getByRole('button', { name: 'DOWNLOAD EXAMPLE' }));
    expect(downloadText).toHaveBeenLastCalledWith('armory-items-example.csv', expect.stringContaining('[weapons]\nname, damage, grade, needs, words\nSample Weapon, 1d8 + @might, LIGHT, worn,'));
    await userEvent.click(files().getByRole('button', { name: 'DOWNLOAD THIS LIST' }));
    expect(downloadText).toHaveBeenLastCalledWith('armory-items.csv', expect.stringContaining('Pistol, 2d6, LIGHT, worn, '));
  });

  it('IMPORT opens beside the list in place of the open item; CLOSE, or picking an item, puts it back', async () => {
    open();
    await userEvent.click(files().getByRole('button', { name: 'IMPORT' }));
    expect(files().getByRole('button', { name: 'IMPORT' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('region', { name: 'Pistol item' })).toBeNull();
    expect(panel().getByText(/matched by name: a name already here is updated/)).toBeTruthy();
    await userEvent.click(panel().getByRole('button', { name: 'CLOSE' }));
    expect(screen.getByRole('region', { name: 'Pistol item' })).toBeTruthy();
    await userEvent.click(files().getByRole('button', { name: 'IMPORT' }));
    await userEvent.click(within(screen.getByRole('region', { name: 'Items' })).getByRole('button', { name: /^Pistol/ }));
    expect(screen.queryByRole('region', { name: 'Import items' })).toBeNull();
  });
});

describe('PREVIEW and APPLY', () => {
  it('what would change, each mistake by its line; APPLY puts the rest in and says so, the first new one open', async () => {
    const { api, edits } = open();
    await userEvent.click(files().getByRole('button', { name: 'IMPORT' }));
    fireEvent.change(box(), { target: { value: FILE } });
    const shown = await preview();
    expect((api as ReturnType<typeof server>).importItems).toHaveBeenCalledWith(ARMORY, FILE);
    expect(shown.getByText('2 CHANGES · 0 ALREADY THE SAME · 1 LINE SKIPPED')).toBeTruthy();
    expect(within(shown.getByRole('group', { name: 'NEW ITEMS' })).getByText('SHOTGUN · WEAPON')).toBeTruthy();
    expect(within(shown.getByRole('group', { name: 'CHANGED' })).getByText('PISTOL · DAMAGE 2d6 → 2d6 + @might · WORDS nothing → "A snub revolver."')).toBeTruthy();
    expect(within(shown.getByRole('group', { name: 'SKIPPED, NOTHING FROM THESE LINES GOES IN' })).getByText(/Crossbow: GRADE is LIGHT or HEAVY, not MEDIUM/)).toBeTruthy();
    expect(screen.getByTestId('import-gutter').querySelector('[data-bad="true"]')!.textContent).toBe('!5');
    // A line link selects its line.
    await userEvent.click(shown.getAllByRole('button', { name: 'Go to line 5' })[0]);
    expect(box().value.slice(box().selectionStart, box().selectionEnd)).toBe('Crossbow, 1d10, MEDIUM, worn,');
    await userEvent.click(panel().getByRole('button', { name: 'APPLY 2 CHANGES, SKIP 1 LINE' }));
    const list = (edits.at(-1)!.items as { list: { id: string; label: string }[] }).list;
    expect(list.map((i) => i.label)).toEqual(['Pistol', 'Shotgun']);
    expect(screen.getByRole('status', { name: 'Import' }).textContent).toBe('APPLIED · 2 CHANGES IN THE DRAFT, 1 LINE SKIPPED · SAVED WITH IT, LIVE ON PUBLISH');
    expect(screen.queryByRole('region', { name: 'Import items' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Shotgun item' })).toBeTruthy();
  });

  it('the text changed since PREVIEW: no APPLY until previewed again; nothing that changes, nothing to apply', async () => {
    open();
    await userEvent.click(files().getByRole('button', { name: 'IMPORT' }));
    fireEvent.change(box(), { target: { value: FILE } });
    await preview();
    fireEvent.change(box(), { target: { value: `${FILE}\n` } });
    expect(panel().getByText('CHANGED SINCE PREVIEW · PREVIEW AGAIN')).toBeTruthy();
    expect((panel().getByRole('button', { name: 'APPLY' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box(), { target: { value: '[weapons]\nname, grade\nPistol, LIGHT' } });
    const shown = await preview();
    expect(shown.getByText('Nothing in that changes the items, so there is nothing to apply.')).toBeTruthy();
    expect((panel().getByRole('button', { name: 'APPLY' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('what the server can\'t read is said; no server, no PREVIEW; too much, said', async () => {
    open();
    await userEvent.click(files().getByRole('button', { name: 'IMPORT' }));
    fireEvent.change(box(), { target: { value: '   x' } });
    fireEvent.change(box(), { target: { value: ' ' } });
    expect((panel().getByRole('button', { name: 'PREVIEW' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box(), { target: { value: 'x'.repeat(200_001) } });
    expect(panel().getByText(/That is too much to read at once/)).toBeTruthy();
    cleanup();
    open(null);
    await userEvent.click(files().getByRole('button', { name: 'IMPORT' }));
    fireEvent.change(box(), { target: { value: FILE } });
    expect((panel().getByRole('button', { name: 'PREVIEW' }) as HTMLButtonElement).title).toBe('Needs the server');
  });

  it('the words an item has are 1000 characters at most, as the server checks them', () => {
    open();
    expect((within(screen.getByRole('region', { name: 'Pistol item' })).getByLabelText('WORDS') as HTMLTextAreaElement).maxLength).toBe(1000);
  });
});
