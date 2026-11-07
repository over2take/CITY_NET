import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportSheetDialog, keptFields } from '../ImportSheetDialog';
import { leftLines, lossesFrom, type ImportPreview } from '../ImportPreviewWindow';
import { pickLinesSaid } from '../../sheets/importPicks';
import { registerCustomTemplate, clearCustomTemplates, type CustomRender } from '../../sheets/customTemplates';

vi.mock('../DraggableWindow', () => ({
  DraggableWindow: ({ children, title }: any) => (
    <div>
      <div data-testid="window-title">{title}</div>
      {children}
    </div>
  ),
}));

/**
 * IMPORT.EXE under a custom system (4h2c; approved mockup docs/mockups/sheet-import.html,
 * 2026-10-13): the blank PDF and the JSON template side by side, a JSON file uploaded, the preview
 * saying what was left and why, and never listing as lost what a replace keeps (worked-out values,
 * GM-only fields). Its boxes in the theme's colors.
 */

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const RENDER = {
  id: HEARTH, name: 'Hearth', parts: {}, words: {}, derived: ['defense'],
  sheet: { sections: [{ id: 's', label: 'S', layout: 'list', fields: [
    { id: 'name', label: 'Name', type: 'text' },
    { id: 'defense', label: 'Defense', type: 'number' },
    { id: 'wound_notes', label: 'Wound notes', type: 'textarea', edit: 'gm' },
    { id: 'notes', label: 'Notes', type: 'textarea' },
  ] }] },
} as unknown as CustomRender;

beforeEach(() => { clearCustomTemplates(); registerCustomTemplate(RENDER); });
afterEach(() => { cleanup(); clearCustomTemplates(); vi.unstubAllGlobals(); });

const open = (gameSystem: string, currentData?: Record<string, unknown>) =>
  render(<ImportSheetDialog pos={{ x: 0, y: 0 }} setPos={vi.fn()} onClose={vi.fn()} onApply={vi.fn()} gameSystem={gameSystem} currentData={currentData} />);
const link = (name: RegExp) => screen.getByRole('link', { name }) as HTMLAnchorElement;

describe('the downloads', () => {
  it('a custom system hands out its blank PDF and its JSON template, side by side', () => {
    open(HEARTH);
    expect(link(/BLANK FORM \(PDF\)/).getAttribute('href')).toBe('/api/sheets/import/template.pdf');
    expect(link(/JSON TEMPLATE/).getAttribute('href')).toBe('/api/sheets/import/template.json');
    expect(link(/JSON TEMPLATE/).hasAttribute('download')).toBe(true);
    expect(screen.queryByRole('link', { name: /DOWNLOAD BLANK FORM/ })).toBeNull();
  });

  it('a built-in game its blank form alone, as before', () => {
    open('cities_without_number');
    expect(link(/DOWNLOAD BLANK FORM/).getAttribute('href')).toBe('/api/sheets/import/template.pdf');
    expect(screen.queryByRole('link', { name: /JSON TEMPLATE/ })).toBeNull();
    expect(screen.queryByLabelText('Upload a JSON file')).toBeNull();
  });
});

describe('a JSON file', () => {
  it('is read and previewed, and the preview says what was left and why', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({
      system: HEARTH, source: 'json', mapped: { name: 'Vex' }, unmapped: {}, skipped: { HP: 12 },
      workedOut: { Defense: 18 }, gmOnly: { 'Wound notes': 'Arm' }, notAChoice: { Calling: 'Paladin' },
    }) }));
    vi.stubGlobal('fetch', fetchMock);
    open(HEARTH);
    const file = new File(['{"fields":{"name":"Vex"},"system":"Hearth"}'], 'vex.json', { type: 'application/json' });
    await userEvent.upload(screen.getByLabelText('Upload a JSON file'), file);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/sheets/import/preview');
    expect(JSON.parse(String(init.body))).toEqual({ json: '{"fields":{"name":"Vex"},"system":"Hearth"}' });
    expect(await screen.findByText('WORKED OUT BY THE GAME, NOT TAKEN: Defense')).toBeTruthy();
    expect(screen.getByText('ONLY THE GM SETS, NOT TAKEN: Wound notes')).toBeTruthy();
    expect(screen.getByText('NOT ONE OF THE CHOICES, LEFT AS IT WAS: Calling (Paladin)')).toBeTruthy();
    expect(screen.getByText('SKIPPED (LINKED TO TOKEN/BANK): HP')).toBeTruthy();
  });

  it('that isn\'t JSON is refused before anything is sent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    open(HEARTH);
    await userEvent.upload(screen.getByLabelText('Upload a JSON file'), new File(['nope'], 'x.json', { type: 'application/json' }));
    expect(await screen.findByText('That file is not valid JSON')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('what a replace would lose', () => {
  it('leaves out worked-out values and GM-only fields, which a replace keeps', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ system: HEARTH, source: 'json', mapped: { name: 'Vex' }, unmapped: {}, skipped: {} }) })));
    open(HEARTH, { name: 'Old', defense: 14, wound_notes: 'Arm', notes: 'Mine' });
    fireEvent.change(screen.getByLabelText('Paste JSON or a stat block'), { target: { value: '{"name":"Vex"}' } });
    fireEvent.click(screen.getByText('PREVIEW'));
    expect((await screen.findByText(/YOU WILL LOSE/)).textContent).toBe('YOU WILL LOSE: notes');
  });

  it('knows which fields those are from the system\'s sheet', () => {
    expect(keptFields(HEARTH)).toEqual(['defense', 'wound_notes']);
    expect(keptFields(undefined)).toEqual([]);
    const preview: ImportPreview = { system: HEARTH, source: 'json', mapped: {}, unmapped: {}, skipped: {} };
    expect(lossesFrom(preview, { defense: 1, notes: 'x' }, ['defense'])).toEqual(['notes']);
    expect(lossesFrom(preview, { defense: 1, notes: 'x' })).toEqual(['defense', 'notes']);
  });
});

describe('the words for what was left', () => {
  it('one line for each reason there was, in order, choices with what was given', () => {
    const base: ImportPreview = { system: HEARTH, source: 'json', mapped: {}, unmapped: {}, skipped: {} };
    expect(leftLines(base)).toEqual([]);
    expect(leftLines({ ...base, workedOut: {}, gmOnly: { a: 1, b: 2 }, notAChoice: { Calling: 'Paladin', Order: 'Noon' } })).toEqual([
      { key: 'gmOnly', text: 'ONLY THE GM SETS, NOT TAKEN: a, b' },
      { key: 'notAChoice', text: 'NOT ONE OF THE CHOICES, LEFT AS IT WAS: Calling (Paladin), Order (Noon)' },
    ]);
    expect(leftLines({ ...base, workedOut: { Defense: 18 } })).toEqual([{ key: 'workedOut', text: 'WORKED OUT BY THE GAME, NOT TAKEN: Defense' }]);
  });
});

describe('the theme', () => {
  it('draws the boxes in the theme\'s colors, never a fixed green', () => {
    open('cyberpunk_red');
    for (const box of [screen.getByLabelText('Paste JSON or a stat block'), screen.getByLabelText('Companion code')]) {
      expect(box.getAttribute('style') ?? '', box.getAttribute('aria-label') ?? '').not.toMatch(/#[0-9a-f]{3,6}/i);
      expect(box.getAttribute('style')).toContain('var(--dark-green)');
    }
  });
});

describe('picks in the preview (7c6)', () => {
  const base: ImportPreview = { system: HEARTH, source: 'json', mapped: {}, unmapped: {}, skipped: {} };
  const SOLDIER = { list: 'classes', one: 'Class', option: 'Soldier', level: 3 };

  it('says nothing of a file naming none', () => {
    expect(pickLinesSaid(base)).toEqual([]);
  });

  it('says what each comes to, with its level if it has one', () => {
    expect(pickLinesSaid({ ...base, picksSaid: [SOLDIER, { list: 'feats', one: 'Feat', option: 'Tough' }] })).toEqual([
      { tone: 'good', text: 'CLASS: SOLDIER 3' }, { tone: 'good', text: 'FEAT: TOUGH' },
    ]);
  });

  it('one not met comes in as it is, saying what it needs', () => {
    expect(pickLinesSaid({ ...base, picksSaid: [{ ...SOLDIER, unmet: 'WITS >= 13' }] })).toEqual([{ tone: 'warn', text: 'CLASS: SOLDIER 3, COMING IN AS IT IS: IT NEEDS WITS >= 13' }]);
  });

  it('one it can\'t find, and one with no room, by the line that named them', () => {
    expect(pickLinesSaid({ ...base, picksNotFound: { Class: ['Wizard', 'Bard'] }, picksTooMany: { Feats: ['Keen'] } })).toEqual([
      { tone: 'warn', text: 'Class: CAN\'T FIND Wizard, Bard, LEFT OUT' }, { tone: 'warn', text: 'Feats: NO ROOM FOR Keen, LEFT OUT' },
    ]);
  });

  it('a list holding a locked pick stays for a player, and is replaced by the GM', () => {
    const sheet = { _choices: { classes: [{ option: 'mage', locked: true, roll: 4 }], feats: [{ option: 'tough' }] } };
    const preview = { ...base, picksSaid: [SOLDIER, { list: 'feats', one: 'Feat', option: 'Keen' }] };
    expect(pickLinesSaid(preview, sheet)).toEqual([
      { tone: 'warn', text: 'CLASS: SOLDIER 3, NOT TAKEN: THIS CHARACTER\'S CLASS IS LOCKED. YOUR GM CAN CLEAR IT.' }, { tone: 'good', text: 'FEAT: KEEN' },
    ]);
    expect(pickLinesSaid(preview, sheet, true)[0]).toEqual({ tone: 'good', text: 'CLASS: SOLDIER 3' });
  });

  it('a sheet\'s own bookkeeping isn\'t listed as lost: the server keeps it', () => {
    expect(lossesFrom(base, { _choices: { classes: [] }, _worked: {}, notes: 'x' })).toEqual(['notes']);
  });
});
