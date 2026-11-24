import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';

import { DamageTypesPage } from '../DamageTypesPage';
import type { Definition, systemsApi } from '../../sheets/systemsApi';
import { HINTS } from '../../sheets/builderHelp';
import { BLANK_DRAWN } from '../../sheets/drawings';

/**
 * The builder's DAMAGE TYPES page (8b1b). Approved mockup damage-pipeline (2026-11-23, section 1): what RESIST, IMMUNE and
 * VULNERABLE mean, the starter set with switches, a system's own added and deleted, each one's name (its trouble said),
 * picture (a drawn icon of 32, an upload, or a drawing on the pad) and words. Every change is held to the server's checks.
 */

const { checkDefinition } = createRequire(import.meta.url)('../../../../backend/systemBuilder/definition.js');
afterEach(cleanup);

const H: Definition = { format: 1, name: 'Hearth' };
type Api = ReturnType<typeof systemsApi>;
const UPLOADED = `/uploads/condition_icons/${'d'.repeat(64)}.png`;

const open = (start: Definition = H, api?: Partial<Api>) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <DamageTypesPage definition={def} edit={(next) => { edits.push(next); setDef(next); }} api={api as Api | undefined} />;
  };
  render(<Harness />);
  return { edits, last: () => edits[edits.length - 1] };
};
const list = () => within(screen.getByRole('list', { name: 'Damage types' }));
const detail = (name: RegExp | string) => within(screen.getByRole('region', { name }));
const types = (def: Definition) => (def.damage as { types?: Record<string, Record<string, unknown>> } | undefined)?.types;
const problems = (def: Definition) => checkDefinition(def).problems;

describe('the list', () => {
  it('the 17 starter types with switches, 13 on, and the count against forty; the first open', () => {
    open();
    expect(list().getAllByRole('switch')).toHaveLength(17);
    expect(list().getAllByRole('switch').filter((s) => s.getAttribute('aria-checked') === 'true')).toHaveLength(13);
    expect(screen.getByText('13 ON · 17 OF 40')).toBeTruthy();
    expect(list().getByRole('switch', { name: 'Physical on' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('region', { name: 'Fire damage type' })).toBeTruthy();
  });

  it('a switch turns a starter one off and on again, storing only what differs', async () => {
    const { last } = open();
    await userEvent.click(list().getByRole('switch', { name: 'Fire on' }));
    expect(types(last())).toEqual({ fire: { on: false } });
    expect(screen.getByText('12 ON · 17 OF 40')).toBeTruthy();
    await userEvent.click(list().getByRole('switch', { name: 'Fire on' }));
    expect(last().damage).toBeUndefined();
    await userEvent.click(list().getByRole('switch', { name: 'EMP on' }));
    expect(types(last())).toEqual({ emp: { on: true } });
  });

  it('+ TYPE adds one of its own, open to be named; DELETE asks first', async () => {
    const { last } = open();
    await userEvent.click(screen.getByRole('button', { name: '+ TYPE' }));
    expect(types(last())).toEqual({ new_type: { name: 'New type' } });
    const own = detail('New type damage type');
    expect(own.getByText('ONE OF THIS SYSTEM\'S OWN')).toBeTruthy();
    expect(list().getByText('OWN')).toBeTruthy();
    expect(problems(last())).toEqual([]);
    await userEvent.click(own.getByRole('button', { name: 'DELETE' }));
    await userEvent.click(own.getByRole('button', { name: 'KEEP' }));
    expect(types(last())).toEqual({ new_type: { name: 'New type' } });
    await userEvent.click(own.getByRole('button', { name: 'DELETE' }));
    await userEvent.click(own.getByRole('button', { name: 'DELETE' }));
    expect(last().damage).toBeUndefined();
    // A starter one has no DELETE.
    expect(detail('Fire damage type').queryByRole('button', { name: 'DELETE' })).toBeNull();
  });

  it('at forty, + TYPE waits', () => {
    const own = Object.fromEntries(Array.from({ length: 23 }, (_, i) => [`own_${i}`, { name: `Own ${i}` }]));
    open({ ...H, damage: { types: own } });
    expect((screen.getByRole('button', { name: '+ TYPE' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('the open type', () => {
  it('renamed, its trouble said beside it and in red in the list, as the server says it', async () => {
    const { last } = open();
    const box = screen.getByRole('textbox', { name: 'NAME' });
    expect(box.getAttribute('placeholder')).toBe('Fire');
    await userEvent.type(box, 'Cold');
    expect(types(last())).toEqual({ fire: { name: 'Cold' } });
    // The server names the second of the two, COLD; the one just renamed says why too, and both are red in the list.
    expect(problems(last()).map((p: { where: string; message: string }) => `${p.where}: ${p.message}`))
      .toEqual(['damage type cold, name: COLD is already the name of damage type fire; a hit names its type, so each needs its own']);
    expect(screen.getByRole('alert').textContent).toBe('COLD is also the name of damage type cold; a hit names its type, so each needs its own');
    expect(box.getAttribute('aria-invalid')).toBe('true');
    expect(list().getAllByText('COLD').map((b) => (b as HTMLElement).style.color)).toEqual(['var(--danger)', 'var(--danger)']);
    await userEvent.click(list().getAllByText('COLD')[1]);
    expect(screen.getByRole('alert').textContent).toBe('COLD is already the name of damage type fire; a hit names its type, so each needs its own');
    await userEvent.click(list().getAllByText('COLD')[0]);
    const again = screen.getByRole('textbox', { name: 'NAME' });
    await userEvent.clear(again);
    await userEvent.type(again, 'Flame');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(problems(last())).toEqual([]);
    expect(screen.getByLabelText('Read as').textContent).toBe('"2d6 FLAME DMG" on a line, any case; FLAME on a resistance.');
  });

  it('a drawn icon of 32, damage\'s five among them; or an upload', async () => {
    const { last } = open(H, { uploadIcon: async () => ({ ok: true as const, value: { icon: UPLOADED } }) } as Partial<Api>);
    const icons = screen.getByRole('radiogroup', { name: 'Icon' });
    expect(within(icons).getAllByRole('radio')).toHaveLength(32);
    expect(within(icons).getByRole('radio', { name: 'flame' }).getAttribute('aria-checked')).toBe('true');
    await userEvent.click(within(icons).getByRole('radio', { name: 'blade' }));
    expect(types(last())).toEqual({ fire: { icon: 'blade' } });
    const file = new File(['x'], 'i.png', { type: 'image/png' });
    await userEvent.upload(screen.getByLabelText('Upload an icon for Fire'), file);
    await screen.findByRole('radio', { name: 'Uploaded icon' });
    expect(types(last())).toEqual({ fire: { icon: UPLOADED } });
    expect(problems(last())).toEqual([]);
  });

  it('DRAW: the pad, with how it looks on the HEALTH page; a square drawn kept; an icon picked takes the drawing off', async () => {
    const { last } = open();
    await userEvent.click(screen.getByRole('button', { name: 'DRAW' }));
    expect(types(last())).toEqual({ fire: { drawn: BLANK_DRAWN } });
    const pad = screen.getByRole('group', { name: 'Drawing of Fire' });
    expect(screen.getByText('ON THE HEALTH PAGE')).toBeTruthy();
    fireEvent.click(within(pad).getByRole('button', { name: 'Square 1, 1' }), { detail: 0 });
    expect((types(last())!.fire.drawn as string[])[0]).toBe('8000');
    expect(problems(last())).toEqual([]);
    expect(screen.getByRole('img', { name: 'FIRE drawn' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'DRAW · EDIT' }).getAttribute('aria-pressed')).toBe('true');
    // No icon checked while it is drawn.
    expect(within(screen.getByRole('radiogroup', { name: 'Icon' })).getAllByRole('radio').some((r) => r.getAttribute('aria-checked') === 'true')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'DONE' }));
    expect(screen.queryByRole('group', { name: 'Drawing of Fire' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'DRAW · EDIT' }));
    expect(screen.getByRole('group', { name: 'Drawing of Fire' })).toBeTruthy();
    await userEvent.click(within(screen.getByRole('radiogroup', { name: 'Icon' })).getByRole('radio', { name: 'ray' }));
    expect(types(last())).toEqual({ fire: { icon: 'ray' } });
    expect(screen.queryByRole('group', { name: 'Drawing of Fire' })).toBeNull();
  });

  it('its words', async () => {
    const { last } = open();
    const words = screen.getByRole('textbox', { name: 'DESCRIPTION' });
    await userEvent.clear(words);
    await userEvent.type(words, 'Hot.');
    expect(types(last())).toEqual({ fire: { description: 'Hot.' } });
  });
});

describe('in this game', () => {
  it('what RESIST, IMMUNE and VULNERABLE mean, the app\'s words until typed over', async () => {
    const { last } = open();
    const resist = screen.getByRole('textbox', { name: 'RESIST' });
    expect([resist, screen.getByRole('textbox', { name: 'IMMUNE' }), screen.getByRole('textbox', { name: 'VULNERABLE' })].map((b) => b.getAttribute('placeholder')))
      .toEqual(['Takes half, rounded down.', 'Takes none.', 'Takes double.']);
    await userEvent.type(resist, 'Half.');
    expect(last().damage).toEqual({ resist: { means: 'Half.' } });
    await userEvent.clear(resist);
    expect(last().damage).toBeUndefined();
  });

  it('every setting has its words beside it, each of the page\'s hints shown', () => {
    open();
    const keys = Object.keys(HINTS).filter((k) => k.startsWith('damage.')) as (keyof typeof HINTS)[];
    expect(keys).toHaveLength(5);
    for (const k of keys) expect(screen.getAllByRole('note', { name: HINTS[k] }).length, k).toBeGreaterThan(0);
    // One for each of the three words.
    expect(screen.getAllByRole('note', { name: HINTS['damage.means'] })).toHaveLength(3);
  });
});
