import React, { useState } from 'react';
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';

import { ChoicesPage } from '../ChoicesPage';
import type { Definition, systemsApi } from '../../sheets/systemsApi';
import { choiceLists } from '../../sheets/choices';
import { downloadText } from '../../utils/downloadText';

vi.mock('../../utils/downloadText', () => ({ downloadText: vi.fn() }));

/**
 * IMPORT on a CHOICES list (choices import 2). Approved mockup choices-import (2026-10-28): over the
 * list and option columns, DOWNLOAD THIS LIST and DOWNLOAD EXAMPLE, a file pasted or uploaded, PREVIEW
 * read by the server (here its real reader), mistakes warned of by line (each a link selecting it,
 * marked beside the text), APPLY into the draft only for the text previewed, saying what it skipped.
 */

const req = createRequire(import.meta.url);
const { readChoicesFile } = req('../../../../backend/systemBuilder/choicesImport.js');

afterEach(() => cleanup());
beforeEach(() => vi.mocked(downloadText).mockClear());

const HEARTH = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'dex', label: 'DEX' }] }],
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [
      { id: 'soldier', label: 'Soldier', features: [{ id: 'second_wind', label: 'Second Wind', uses: { count: '1', refill: 'short_rest' } }] },
      { id: 'mage', label: 'Mage', description: 'Reads the weave.' },
    ] },
    { id: 'feats', one: 'Feat', many: 'Feats', picks: 'any', options: [] },
  ],
} as unknown as Definition;

const FILE = [
  '[options]', 'name, description, requires',
  'Ranger, At home past the last road., @dex >= 13',
  'Mage, "Reads the weave, and bends it.",',
  '[features]', 'option, feature, level, words, uses, refill',
  'Ranger, Favored Foe, 1, Mark a quarry., 1, Long rest',
  'Ranger, Hunter\'s Rest, 3, Rest twice., 1, Dawn',
].join('\n');

/** The server, answering PREVIEW with its own reader. */
const server = () => {
  const importChoices = vi.fn(async (definition: Definition, list: string, text: string) => {
    const { ok, error, ...value } = readChoicesFile(definition, list, text);
    return ok ? { ok: true, value } : { ok: false, error, status: 400 };
  });
  return { importChoices } as unknown as ReturnType<typeof systemsApi> & { importChoices: typeof importChoices };
};

const open = (api: ReturnType<typeof systemsApi> | null = server()) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(HEARTH);
    return <ChoicesPage definition={def} edit={(next) => { edits.push(next); setDef(next); }} api={api ?? undefined} />;
  };
  render(<Harness />);
  return { api, edits };
};
const panel = () => within(screen.getByRole('region', { name: 'Import Classes' }));
const box = () => screen.getByRole('textbox', { name: 'Text to import' }) as HTMLTextAreaElement;
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const preview = async () => {
  await userEvent.click(panel().getByRole('button', { name: 'PREVIEW' }));
  return within(await screen.findByRole('status', { name: 'Preview' }));
};

describe('IMPORT on a list', () => {
  it('opens over the list and option columns, and CLOSE puts them back', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'IMPORT' }));
    expect(screen.queryByRole('region', { name: 'Classes list' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Soldier option' })).toBeNull();
    expect(panel().getByText(/matched by name: a name already here is updated/)).toBeTruthy();
    await userEvent.click(panel().getByRole('button', { name: 'CLOSE' }));
    expect(screen.getByRole('region', { name: 'Classes list' })).toBeTruthy();
  });

  it('closes when another list is opened', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'IMPORT' }));
    await userEvent.click(within(screen.getByRole('list', { name: 'Lists' })).getByRole('button', { name: /FEATS/ }));
    expect(screen.queryByRole('region', { name: 'Import Classes' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Feats list' })).toBeTruthy();
    // Back on the first, the list again, not an emptied IMPORT.
    await userEvent.click(within(screen.getByRole('list', { name: 'Lists' })).getByRole('button', { name: /CLASSES/ }));
    expect(screen.getByRole('region', { name: 'Classes list' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Import Classes' })).toBeNull();
  });

  it('hands out this list and an example made for it', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'IMPORT' }));
    await userEvent.click(panel().getByRole('button', { name: 'DOWNLOAD THIS LIST' }));
    await userEvent.click(panel().getByRole('button', { name: 'DOWNLOAD EXAMPLE' }));
    const [[listName, list], [exampleName, example]] = vi.mocked(downloadText).mock.calls;
    expect(listName).toBe('hearth-classes.csv');
    expect(list).toContain('\nSoldier, Second Wind, 1, , 1, Short rest\n');
    expect(exampleName).toBe('hearth-classes-example.csv');
    expect(example).toContain('\nVeteran, "Has seen worse, and says so.", @dex >= 13, d10\n');
  });
});

describe('PREVIEW and APPLY', () => {
  it('previews through the server, warns of each mistake by line, and applies the rest into the draft', async () => {
    const { api, edits } = open();
    await userEvent.click(screen.getByRole('button', { name: 'IMPORT' }));
    expect(panel().getByRole('button', { name: 'PREVIEW' })).toHaveProperty('disabled', true);
    type(FILE);
    const shown = await preview();
    expect((api as ReturnType<typeof server>).importChoices).toHaveBeenCalledWith(HEARTH, 'classes', FILE);

    expect(shown.getByRole('alert').textContent).toBe('⚠ 1 LINE HAS A MISTAKE AND WILL BE SKIPPED'
      + 'On line 8. Fix it and PREVIEW again, or APPLY the rest without it.');
    expect(shown.getByText('3 CHANGES · 0 ALREADY THE SAME · 1 LINE SKIPPED')).toBeTruthy();
    expect(within(shown.getByRole('group', { name: 'NEW CLASSES' })).getByText('RANGER · REQUIRES @dex >= 13')).toBeTruthy();
    expect(within(shown.getByRole('group', { name: 'CHANGED' })).getByText('MAGE · WHAT IT IS "Reads the weave." → "Reads the weave, and bends it."')).toBeTruthy();
    expect(within(shown.getByRole('group', { name: 'NEW FEATURES' })).getByText('RANGER · FAVORED FOE · LEVEL 1 · 1 USE, LONG REST')).toBeTruthy();
    expect(within(shown.getByRole('group', { name: 'SKIPPED, NOTHING FROM THESE LINES GOES IN' })).getByText(/Hunter's Rest: refill: "Dawn" isn't one of this system's rests/)).toBeTruthy();

    // The line marked beside the text, its mistake on hover; the link selects it.
    const marked = screen.getByTestId('import-gutter').querySelectorAll('[data-bad]');
    expect([...marked].map((m) => m.textContent)).toEqual(['!8']);
    expect(marked[0].getAttribute('title')).toMatch(/^Hunter's Rest: refill/);
    await userEvent.click(within(shown.getByRole('alert')).getByRole('button', { name: 'Go to line 8' }));
    expect(box().value.slice(box().selectionStart, box().selectionEnd)).toBe('Ranger, Hunter\'s Rest, 3, Rest twice., 1, Dawn');
    expect(document.activeElement).toBe(box());

    await userEvent.click(panel().getByRole('button', { name: 'APPLY 3 CHANGES, SKIP 1 LINE' }));
    const classes = choiceLists(edits[edits.length - 1]).find((c) => c.id === 'classes')!;
    expect(classes.options.map((o) => o.id)).toEqual(['soldier', 'mage', 'ranger']);
    expect(screen.queryByRole('region', { name: 'Import Classes' })).toBeNull();
    const list = within(screen.getByRole('region', { name: 'Classes list' }));
    expect(list.getByRole('status').textContent).toBe('APPLIED · 3 CHANGES IN THE DRAFT, 1 LINE SKIPPED · SAVED WITH IT, LIVE ON PUBLISH');
    expect(list.getByRole('button', { name: 'RANGER' }).style.border).toContain('var(--cyan)');
    expect(list.getByRole('button', { name: 'MAGE' }).style.border).toContain('var(--dark-green)');
  });

  it('offers APPLY only for the text previewed', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'IMPORT' }));
    type(FILE);
    await preview();
    type(`${FILE}\n`);
    expect(panel().getByRole('button', { name: 'APPLY' })).toHaveProperty('disabled', true);
    expect(panel().getByText('CHANGED SINCE PREVIEW · PREVIEW AGAIN')).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Preview' })).toBeNull();
    expect(screen.getByTestId('import-gutter').querySelectorAll('[data-bad]')).toHaveLength(0);
  });

  it('says there is nothing to apply for a file that changes nothing', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'IMPORT' }));
    type('[options]\nname, description\nMage, Reads the weave.');
    const shown = await preview();
    expect(shown.getByText('Nothing in that changes CLASSES, so there is nothing to apply.')).toBeTruthy();
    expect(shown.queryByRole('alert')).toBeNull();
    expect(panel().getByRole('button', { name: 'APPLY' })).toHaveProperty('disabled', true);
  });

  it('shows the server\'s refusal, and needs the server to preview', async () => {
    const refusing = { importChoices: vi.fn(async () => ({ ok: false, error: 'No such list', status: 400 })) } as unknown as ReturnType<typeof systemsApi>;
    open(refusing);
    await userEvent.click(screen.getByRole('button', { name: 'IMPORT' }));
    type('[options]\nname\nBard');
    await userEvent.click(panel().getByRole('button', { name: 'PREVIEW' }));
    expect((await panel().findByRole('alert')).textContent).toBe('No such list');
    cleanup();
    open(null);
    await userEvent.click(screen.getByRole('button', { name: 'IMPORT' }));
    type('[options]\nname\nBard');
    expect(panel().getByRole('button', { name: 'PREVIEW' })).toHaveProperty('disabled', true);
  });
});

describe('UPLOAD FILE', () => {
  it('puts a file\'s text in the box, and refuses one too big', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: 'IMPORT' }));
    const input = panel().getByLabelText('File to import') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File([FILE], 'classes.csv', { type: 'text/csv' })] } });
    await waitFor(() => expect(box().value).toBe(FILE));
    fireEvent.change(input, { target: { files: [new File(['x'.repeat(200_001)], 'big.csv')] } });
    expect(panel().getByRole('alert').textContent).toBe('That file is 200 KB. Split it into files of under 200 KB.');
    expect(box().value).toBe(FILE);
  });
});
