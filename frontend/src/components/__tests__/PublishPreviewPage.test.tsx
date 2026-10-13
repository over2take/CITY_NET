import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';

import { PublishPreviewPage } from '../PublishPreviewPage';
import type { PublishPreview } from '../../sheets/versionPreview';

/**
 * The builder's PUBLISH page (4h4; approved mockup docs/mockups/version-preview.html, 2026-10-13):
 * what the new version changes, BY CHANGE and, when someone plays it, BY CHARACTER, KEPT on what
 * stops showing, BACK TO EDITING and PUBLISH vN. The answers are the server's own comparison.
 */

afterEach(() => cleanup());

const req = createRequire(import.meta.url);
const { versionChanges, characterChanges, sampleChanges } = req('../../../../backend/systemBuilder/versionDiff.js');

type Preview = Extract<PublishPreview, { first: false }>;
const sheet = (fields: object[]) => ({ tabs: ['MAIN'], sections: [{ id: 'main', label: 'MAIN', layout: 'list', fields }] });
const V2 = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'attrs', label: 'A', stats: [{ id: 'agility', label: 'Agility', min: 3, max: 18 }] }],
  samples: { agility: 14 },
  derived: [{ id: 'defense', label: 'Defense', formula: '10 + @agility' }],
  sheet: sheet([{ id: 'reputation', label: 'Reputation', type: 'number' }]),
};
const V3 = { ...V2, words: { gm: { singular: 'Keeper' } }, derived: [{ id: 'defense', label: 'Defense', formula: '10 + @agility + 2' }], sheet: sheet([]) };

const preview = (people: { name: string; kind?: 'player' | 'npc'; data: object }[], after: object = V3, problems = 0): Preview => ({
  first: false, from: 2, to: 3, problems,
  changes: versionChanges(V2, after),
  characters: people.map((p) => ({ kind: p.kind ?? 'player', name: p.name, changes: characterChanges(V2, after, p.data) })),
  sample: people.length ? null : sampleChanges(V2, after),
});

const open = (p: Preview, busy = false) => {
  const onBack = vi.fn();
  const onPublish = vi.fn();
  render(<PublishPreviewPage preview={p} system="Hearth" onBack={onBack} onPublish={onPublish} busy={busy} />);
  return { onBack, onPublish };
};
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;

describe('with characters', () => {
  const PEOPLE = [{ name: 'Vex', data: { agility: 14, reputation: 3 } }, { name: 'Ganger', kind: 'npc' as const, data: { agility: 10 } }, { name: 'Ash', data: {} }];

  it('says what changes for them, BY CHANGE, with each one\'s own value and KEPT on what stops showing', () => {
    open(preview(PEOPLE));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('PUBLISH v3 · WHAT CHANGES FROM v2 FOR THE 3 CHARACTERS PLAYING HEARTH');
    expect(screen.getByText(/^Vex, Ganger and Ash play Hearth v2 now\./)).toBeTruthy();
    const onSheet = screen.getByRole('region', { name: 'ON THE SHEET' });
    expect(within(onSheet).getByText('1 CHANGE')).toBeTruthy();
    expect(within(onSheet).getByText('REPUTATION').textContent).toBe('REPUTATION · KEPT');
    expect(within(onSheet).getByTestId('who').textContent).toBe('VEX has 3, kept');
    const numbers = screen.getByRole('region', { name: 'NUMBERS THAT WILL WORK OUT DIFFERENTLY' });
    expect(within(numbers).getByText('DEFENSE').textContent).toBe('DEFENSE');
    expect(within(numbers).getByTestId('who').textContent).toBe('VEX 24 → 26GANGER 20 → 22ASH 10 → 12');
    expect(screen.getByText('Also in v3, changing nothing on a character: words.')).toBeTruthy();
    expect(screen.queryByText('NOTHING CHANGES FOR ANY CHARACTER.')).toBeNull();
  });

  it('goes back to BY CHANGE when a newer answer has nobody playing it', async () => {
    const { rerender } = render(<PublishPreviewPage preview={preview(PEOPLE)} system="Hearth" onBack={() => {}} onPublish={() => {}} busy={false} />);
    await userEvent.click(screen.getByRole('tab', { name: 'BY CHARACTER' }));
    rerender(<PublishPreviewPage preview={preview([])} system="Hearth" onBack={() => {}} onPublish={() => {}} busy={false} />);
    expect(screen.getByRole('region', { name: 'ON THE SHEET' })).toBeTruthy();
  });

  it('turns to BY CHARACTER, each with their own list, an NPC marked', async () => {
    open(preview(PEOPLE));
    expect(screen.getByRole('tab', { name: 'BY CHANGE' }).getAttribute('aria-selected')).toBe('true');
    await userEvent.click(screen.getByRole('tab', { name: 'BY CHARACTER' }));
    expect(screen.queryByRole('region', { name: 'ON THE SHEET' })).toBeNull();
    const vex = screen.getByRole('region', { name: 'Vex' });
    expect(within(vex).getByText('2 CHANGES')).toBeTruthy();
    expect(vex.textContent).toContain('REPUTATIONhas 3, kept');
    expect(vex.textContent).toContain('DEFENSE24 → 26');
    expect(screen.getByRole('region', { name: 'Ganger' }).textContent).toMatch(/^GANGER · NPC1 CHANGE/);
    await userEvent.click(screen.getByRole('tab', { name: 'BY CHANGE' }));
    expect(screen.getByRole('region', { name: 'ON THE SHEET' })).toBeTruthy();
  });

  it('says NOTHING CHANGES for a character the new version leaves alone', async () => {
    const quietDefense = { ...V3, derived: V2.derived };
    open(preview([{ name: 'Vex', data: { agility: 14, reputation: 3 } }, { name: 'Ash', data: {} }], quietDefense));
    await userEvent.click(screen.getByRole('tab', { name: 'BY CHARACTER' }));
    expect(within(screen.getByRole('region', { name: 'Ash' })).getByText('NOTHING CHANGES')).toBeTruthy();
  });
});

describe('with nobody playing it', () => {
  it('shows the numbers on the SAMPLE, with no BY CHARACTER', () => {
    open(preview([]));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('PUBLISH v3 · WHAT CHANGES FROM v2');
    expect(screen.getByText(/^Nobody plays Hearth yet\. This is what v3 changes, with numbers worked out on the SAMPLE values/)).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'NUMBERS THAT WILL WORK OUT DIFFERENTLY' })).getByTestId('who').textContent).toBe('SAMPLE 24 → 26');
    expect(within(screen.getByRole('region', { name: 'ON THE SHEET' })).queryByTestId('who')).toBeNull();
  });
});

describe('a version that changes nothing a character would see', () => {
  it('says so in one line, and PUBLISH is still one more click', async () => {
    const { onPublish } = open(preview([{ name: 'Vex', data: { agility: 14 } }], { ...V2, words: { gm: { singular: 'Keeper' } } }));
    expect(screen.getByText('NOTHING CHANGES FOR ANY CHARACTER.')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.getByText('Also in v3, changing nothing on a character: words.')).toBeTruthy();
    await userEvent.click(button('PUBLISH v3'));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });
});

describe('the buttons', () => {
  it('BACK TO EDITING and PUBLISH vN', async () => {
    const { onBack, onPublish } = open(preview([]));
    await userEvent.click(button('BACK TO EDITING'));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onPublish).not.toHaveBeenCalled();
    await userEvent.click(button('PUBLISH v3'));
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it('wait while publishing', () => {
    open(preview([]), true);
    expect(button('PUBLISHING…').disabled).toBe(true);
  });

  it('won\'t publish a draft with problems, and says where to fix them', () => {
    open(preview([], V3, 2));
    expect(screen.getByRole('alert').textContent).toBe('The draft has 2 problems: fix them in PROBLEMS before publishing.');
    expect(button('PUBLISH v3').disabled).toBe(true);
    cleanup();
    open(preview([], V3, 1));
    expect(screen.getByRole('alert').textContent).toBe('The draft has 1 problem: fix it in PROBLEMS before publishing.');
  });
});
