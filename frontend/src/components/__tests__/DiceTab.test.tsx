import React, { useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRequire } from 'module';
import { StatsRulesPage } from '../StatsRulesPage';
import type { Definition } from '../../sheets/systemsApi';
import { dieList, symbolList, withDicePreset } from '../../sheets/dice';

/**
 * STATS & RULES' DICE tab (6c2b2). Approved mockup builder-dice (2026-10-21): the system's own
 * dice from a preset or + DIE, a die named and colored, a face's number and symbols, the symbols
 * with their look (a mark, a drawn icon, a drawing on the pad, an upload), COPY FROM THE TABLE'S
 * DICE, and TEST thrown by the server's engine. Every system it makes the server takes.
 */

afterEach(() => cleanup());

const req = createRequire(import.meta.url);
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const { rollField } = req('../../../../backend/systemBuilder/tableRolls.js');

const HEARTH: Definition = { format: 1, name: 'Hearth' };
const problems = (def: Definition) => checkDefinition(def).problems.map((p: { where: string; message: string }) => `${p.where}: ${p.message}`);

/** The server's engine, the dice landing on their first faces, as the route throws them. */
const testDice = vi.fn(async (definition: Definition, dieId: string, count: number) => {
  const made = rollField({ definition, data: {}, roll: { id: 'test', label: 'Test', dice: [{ count: String(count), die: dieId }], read: 'symbols' }, rng: () => 0.01, who: 'The test' });
  const die = dieList(definition).find((d) => d.id === dieId)!;
  return { ok: true as const, value: { faces: made.results[die.name] ?? [], symbols: made.result.symbols, total: made.total, historyText: made.historyText } };
});
const tableDice = vi.fn(async () => ({ ok: true as const, value: [
  { id: 'builtin:fate_df', name: 'dF', sides: 6, faces: [{ value: '+1' }], locked: true },
  { id: 7, name: 'Bone', sides: 3, faces: [{ value: '1' }, { value: '2' }, { value: 'Skull' }] },
] }));
const uploadIcon = vi.fn(async () => ({ ok: true as const, value: { icon: `/uploads/condition_icons/${'c'.repeat(64)}.png` } }));
const api = { previewValues: vi.fn(async () => ({ ok: true as const, value: { values: {}, problems: [] } })), testDice, tableDice, uploadIcon } as never;

const open = (start: Definition = HEARTH) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <StatsRulesPage definition={def} api={api} edit={(next) => { edits.push(next); setDef(next); }} />;
  };
  render(<Harness />);
  return { last: () => edits[edits.length - 1] };
};
const toDice = () => userEvent.click(screen.getByRole('tab', { name: 'DICE' }));
const NARRATIVE = withDicePreset(HEARTH, 'narrative')!.definition;

describe('the DICE tab', () => {
  it('sits between TABLES and ROLLS, and starts from a preset or a plain d6', async () => {
    const { last } = open();
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['STATS', 'FORMULAS', 'TABLES', 'DICE', 'ROLLS']);
    await toDice();
    expect(screen.getByText(/No dice of its own yet/)).toBeTruthy();
    await userEvent.click(within(screen.getByRole('group', { name: 'New dice from a preset' })).getByRole('button', { name: 'GOOD / GREAT / BAD' }));
    expect(dieList(last()).map((d) => d.id)).toEqual(['good', 'great', 'bad']);
    expect((screen.getByLabelText('Die name') as HTMLInputElement).value).toBe('Good');
    await userEvent.click(screen.getByRole('button', { name: '+ DIE' }));
    expect((screen.getByLabelText('Die name') as HTMLInputElement).value).toBe('New die');
    expect(problems(last())).toEqual([]);
  });

  it('a die named, colored and its faces counted; picked from the list; removed', async () => {
    const { last } = open(NARRATIVE);
    await toDice();
    const list = screen.getByRole('navigation', { name: 'Dice' });
    await userEvent.click(within(list).getByRole('button', { name: /^BAD/ }));
    await userEvent.clear(screen.getByLabelText('Die name'));
    await userEvent.type(screen.getByLabelText('Die name'), 'Woe');
    expect(dieList(last()).find((d) => d.id === 'bad')!.name).toBe('Woe');
    await userEvent.click(within(screen.getByRole('group', { name: 'Die color' })).getByRole('button', { name: 'THE THEME\'S' }));
    expect('color' in dieList(last()).find((d) => d.id === 'bad')!).toBe(false);
    const count = screen.getByLabelText('How many faces');
    await userEvent.clear(count);
    await userEvent.type(count, '10{Enter}');
    expect(dieList(last()).find((d) => d.id === 'bad')!.faces).toHaveLength(10);
    await userEvent.click(screen.getByRole('button', { name: 'REMOVE DIE' }));
    expect(dieList(last()).map((d) => d.id)).toEqual(['good', 'great']);
    expect(problems(last())).toEqual([]);
  });

  it('a face picked and changed: its number (blank for none) and its symbols added and taken off', async () => {
    const { last } = open(NARRATIVE);
    await toDice();
    const faces = screen.getByRole('region', { name: 'Faces' });
    await userEvent.click(within(faces).getByRole('button', { name: 'Face 4: HIT EDGE' }));
    const n = screen.getByLabelText('Face 4 number');
    await userEvent.type(n, '-1{Enter}');
    expect(dieList(last())[0].faces[3]).toEqual({ n: -1, s: ['hit', 'edge'] });
    await userEvent.selectOptions(screen.getByLabelText('Add a symbol to face 4'), 'CRIT');
    expect(dieList(last())[0].faces[3].s).toEqual(['hit', 'edge', 'crit']);
    await userEvent.click(screen.getByRole('button', { name: 'Take Hit off face 4' }));
    expect(dieList(last())[0].faces[3].s).toEqual(['edge', 'crit']);
    await userEvent.clear(n);
    await userEvent.type(n, '{Enter}');
    expect(dieList(last())[0].faces[3]).toEqual({ s: ['edge', 'crit'] });
    expect(within(faces).getByRole('button', { name: 'Face 4: EDGE CRIT' })).toBeTruthy();
    expect(problems(last())).toEqual([]);
  });

  it('the symbols: named, marked, cancelling as a pair, counting as another, added and removed', async () => {
    const { last } = open(NARRATIVE);
    await toDice();
    const edge = screen.getByRole('group', { name: 'Symbol Edge' });
    await userEvent.selectOptions(within(edge).getByLabelText('Edge: cancels'), 'MISS');
    expect(symbolList(last()).map((s) => [s.id, s.cancels])).toEqual([['hit', undefined], ['miss', 'edge'], ['edge', 'miss'], ['snag', undefined], ['crit', undefined]]);
    // Only what counts as nothing more is offered: never CRIT, which counts as HIT.
    const snag = screen.getByRole('group', { name: 'Symbol Snag' });
    expect([...(within(snag).getByLabelText('Snag: also counts as') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['NOTHING', 'HIT', 'MISS', 'EDGE']);
    // CRIT's own, HIT, offered once though it is both a choice and what CRIT counts as now.
    const crit = screen.getByRole('group', { name: 'Symbol Crit' });
    expect([...(within(crit).getByLabelText('Crit: also counts as') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['NOTHING', 'HIT', 'MISS', 'EDGE', 'SNAG']);
    await userEvent.selectOptions(within(snag).getByLabelText('Snag: also counts as'), 'MISS');
    expect(symbolList(last()).find((s) => s.id === 'snag')!.also).toBe('miss');
    await userEvent.clear(within(snag).getByLabelText('Snag: mark'));
    await userEvent.type(within(snag).getByLabelText('Snag: mark'), '~');
    expect(symbolList(last()).find((s) => s.id === 'snag')!.mark).toBe('~');
    await userEvent.click(screen.getByRole('button', { name: '+ SYMBOL' }));
    expect(symbolList(last())).toHaveLength(6);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Crit' }));
    expect(symbolList(last()).map((s) => s.id)).not.toContain('crit');
    expect(problems(last())).toEqual([]);
  });

  it('a symbol\'s look: a drawn icon, a drawing on the pad, an upload, or its mark again', async () => {
    const { last } = open(NARRATIVE);
    await toDice();
    const hit = () => screen.getByRole('group', { name: 'Symbol Hit' });
    const look = () => within(hit()).getByRole('group', { name: 'Hit: look' });
    await userEvent.click(within(look()).getByRole('button', { name: 'ICON' }));
    await userEvent.click(within(hit()).getByRole('radio', { name: 'skull' }));
    expect(symbolList(last())[0]).toEqual({ id: 'hit', name: 'Hit', mark: '✶', cancels: 'miss', icon: 'skull' });
    // DRAW: an empty pad, squares drawn a key press at a time (a pointer drags in the browser journey).
    await userEvent.click(within(look()).getByRole('button', { name: 'DRAW' }));
    const pad = within(hit()).getByRole('group', { name: 'Drawing of Hit' });
    // Lines through its middle, down and across, that a press goes through to the squares.
    const middles = within(pad).getAllByTestId('pad-middle');
    expect(middles.map((m) => [m.style.left, m.style.top, m.style.width, m.style.height, m.style.pointerEvents])).toEqual([['111.5px', '0px', '1px', '', 'none'], ['0px', '111.5px', '', '1px', 'none']]);
    fireEvent.click(within(pad).getByRole('button', { name: 'Square 1, 1' }));
    fireEvent.click(within(pad).getByRole('button', { name: 'Square 16, 2' }));
    expect(symbolList(last())[0].drawn!.slice(0, 3)).toEqual(['8000', '0001', '0000']);
    expect('icon' in symbolList(last())[0]).toBe(false);
    expect(within(hit()).getByLabelText('Hit on the dice').querySelectorAll('rect')).toHaveLength(2);
    expect(within(hit()).getByText('THE LOG WRITES ✶')).toBeTruthy();
    await userEvent.click(within(hit()).getByRole('button', { name: 'CLEAR' }));
    expect(symbolList(last())[0].drawn).toEqual(Array(16).fill('0000'));
    await userEvent.click(within(hit()).getByRole('button', { name: 'DONE' }));
    expect(within(hit()).queryByRole('group', { name: 'Drawing of Hit' })).toBeNull();
    // UPLOAD: the file goes up as a condition icon's does.
    await userEvent.upload(within(hit()).getByLabelText('Upload a picture for Hit'), new File(['x'], 'hit.png', { type: 'image/png' }));
    await waitFor(() => expect(symbolList(last())[0].icon).toBe(`/uploads/condition_icons/${'c'.repeat(64)}.png`));
    expect(uploadIcon).toHaveBeenLastCalledWith(expect.any(File), 'condition');
    expect(within(look()).getByRole('button', { name: 'UPLOAD' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(within(look()).getByRole('button', { name: 'MARK' }));
    expect(symbolList(last())[0]).toEqual({ id: 'hit', name: 'Hit', mark: '✶', cancels: 'miss' });
    expect(problems(last())).toEqual([]);
  });

  it('COPY FROM THE TABLE\'S DICE: the table\'s own (not a game\'s built-in), its words becoming symbols', async () => {
    const { last } = open();
    await toDice();
    await userEvent.click(screen.getByRole('button', { name: 'COPY FROM THE TABLE\'S DICE' }));
    const table = await screen.findByRole('group', { name: 'The table\'s dice' });
    expect(within(table).getAllByRole('button').map((b) => b.textContent)).toEqual(['BONE · 3 FACES', 'CANCEL']);
    await userEvent.click(within(table).getByRole('button', { name: 'BONE · 3 FACES' }));
    expect(dieList(last())).toEqual([{ id: 'bone', name: 'Bone', faces: [{ n: 1 }, { n: 2 }, { s: ['skull'] }] }]);
    expect(symbolList(last())).toEqual([{ id: 'skull', name: 'Skull', mark: 'S' }]);
    expect(screen.queryByRole('group', { name: 'The table\'s dice' })).toBeNull();
    expect(problems(last())).toEqual([]);
  });

  it('TEST throws the die on the server, its faces as the log writes them and what its symbols come to', async () => {
    open(NARRATIVE);
    await toDice();
    const test = screen.getByTestId('test-dice');
    const n = within(test).getByLabelText('How many to throw');
    await userEvent.clear(n);
    await userEvent.type(n, '3{Enter}');
    await userEvent.click(within(test).getByRole('button', { name: 'THROW ▸' }));
    await waitFor(() => expect(within(test).getByTestId('test-dice-faces').textContent).toBe('···'));
    expect(testDice).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'Hearth' }), 'good', 3);
    expect(within(test).getByTestId('test-dice-left').textContent).toBe('NOTHING LEFT');
    testDice.mockResolvedValueOnce({ ok: false, error: 'die good, face 1, symbol 1: Not one of this system\'s symbols' } as never);
    await userEvent.click(within(test).getByRole('button', { name: 'THROW ▸' }));
    expect((await within(test).findByRole('alert')).textContent).toBe('die good, face 1, symbol 1: Not one of this system\'s symbols');
  });

  it('says why when there is no room for a preset\'s dice and symbols', async () => {
    open({ ...HEARTH, symbols: Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, name: 'S', mark: 'S' })) });
    await toDice();
    await userEvent.click(within(screen.getByRole('group', { name: 'New dice from a preset' })).getByRole('button', { name: 'GOOD / GREAT / BAD' }));
    expect(screen.getByRole('alert').textContent).toBe('There isn\'t room for those dice and their symbols.');
  });
});
