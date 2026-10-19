import React, { useState } from 'react';
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, cleanup, within, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { GraphView } from '../GraphView';
import type { Definition } from '../../sheets/systemsApi';
import { graphOf, layoutOf, positionsOf } from '../../sheets/graphModel';
import { lockControls } from '../../sheets/examples';
import { standInsForReactFlow } from '../../test/reactFlow';

/**
 * STATS & RULES with GRAPH on (5a3a). Approved mockup builder-graph (2026-10-17), nodes as the
 * builder design's node kit draws them (2026-09-29): a stats group as a list with SCORE and MOD and
 * the table it is worked out by; a formula's inputs by name with where each comes from, BEST of
 * several, its text in names and = its value, or its problem inside it; a folded group's one line;
 * every node as tall as the model plans; AUTO-LAYOUT asking first; an example's map that only moves
 * and zooms. Where dots and wires land needs a real browser: e2e/tests/builder-graph.spec.ts.
 */

beforeAll(() => standInsForReactFlow());
afterEach(() => cleanup());

const HEARTH: Definition = {
  format: 1,
  name: 'Hearth',
  stats: [
    { id: 'character', label: 'Character', stats: [{ id: 'lvl', label: 'Level', min: 1, max: 10 }] },
    { id: 'abilities', label: 'Abilities', stats: [{ id: 'str', label: 'Strength', min: 3, max: 18 }, { id: 'wit', label: 'Wits', min: 3, max: 18 }] },
  ],
  samples: { lvl: 3, str: 16, wit: 9 },
  lookups: { attribute_mod: { label: 'Attribute mod', bands: [{ upTo: 13, value: 0 }, { value: 1 }] } },
  derived: [
    { id: 'str_mod', label: 'Str mod', formula: 'attribute_mod(@str)' },
    { id: 'wit_mod', label: 'Wit mod', formula: 'attribute_mod(@wit)' },
    { id: 'save', label: 'Physical save', formula: '16 - (@lvl + max(@str_mod, @wit_mod))' },
    { id: 'odd', label: 'Odd', formula: '@cash + @nowhere + nothing(@lvl) + $cwn_move_bonus' },
    { id: 'spell', label: 'Spell power', formula: '0', alternative: { rule: 'magic', formula: '@wit_mod + @lvl' } },
  ],
  house_rules: [{ id: 'magic', name: 'Magic', description: 'Characters can learn spells.' }],
  graph: { groups: [{ id: 'saves', label: 'SAVES', members: ['save', 'odd'] }], notes: [{ id: 'n1', on: 'save', text: 'Best of the two.' }] },
};

/** The server's values: odd has a mistake (it calls a table that isn't there). */
const api = {
  previewValues: vi.fn(async () => ({ ok: true as const, value: {
    values: { str_mod: 1, wit_mod: 0, save: 12, spell: 0 },
    problems: [{ where: 'derived odd, formula', message: 'No function or table called "nothing"' }],
  } })),
} as never;

const open = (start: Definition = HEARTH, readOnly = false) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <div style={{ width: 1200, height: 800 }}><GraphView definition={def} edit={(next) => { edits.push(next); setDef(next); }} api={api} readOnly={readOnly} /></div>;
  };
  render(<Harness />);
  return { edits, last: () => edits[edits.length - 1] };
};
const node = (id: string) => screen.getByTestId(`graph-node-${id}`);
const settled = () => waitFor(() => expect(node('save').querySelector('[data-value]')?.textContent).toBe('12'), { timeout: 2000 });

describe('the nodes, as the node kit draws them', () => {
  it('draws every node as tall as the model plans', () => {
    open();
    for (const n of graphOf(HEARTH).nodes) expect(node(n.id).style.height, n.id).toBe(`${n.height}px`);
  });

  it('a stats group is one list: a row a stat, its score, and its modifier from the table named on it', async () => {
    open();
    const list = node('abilities');
    expect(list.textContent).toContain('MOD VIA');
    expect(list.textContent).toContain('ATTRIBUTE MOD');
    expect(within(list).getByText('STRENGTH')).toBeTruthy();
    expect(within(list).getByText('16')).toBeTruthy();
    await waitFor(() => expect(within(list).getByText('+1')).toBeTruthy(), { timeout: 2000 });
    expect(screen.queryByTestId('graph-node-str_mod')).toBeNull();
    expect(node('character').textContent).not.toContain('MOD VIA');
  });

  it('a formula reads its inputs by name, where each comes from, BEST of several, its text in names, and = its value', async () => {
    open();
    await settled();
    const save = node('save');
    expect(within(save).getByText('LEVEL').nextElementSibling!.textContent).toBe('↗ CHARACTER');
    expect(within(save).getByText('BEST').nextElementSibling!.textContent).toBe('STR MOD, WIT MOD · HIGHEST');
    expect(within(save).getByText('16 − (LEVEL + BEST)')).toBeTruthy();
  });

  it('says what a name with no wire is: a sheet field, a name no sheet has, a table that isn\'t there, the engine\'s own', async () => {
    open();
    await settled();
    const odd = node('odd');
    expect(within(odd).getByText('@cash').nextElementSibling!.textContent).toBe('SHEET FIELD');
    expect(within(odd).getByText('@nowhere').nextElementSibling!.textContent).toBe('ON NO SHEET');
    expect(within(odd).getByText('nothing').nextElementSibling!.textContent).toBe('NO SUCH TABLE');
    expect(within(odd).getByText('CWN MOVE BONUS').nextElementSibling!.textContent).toBe('BUILT-IN');
  });

  it('shows a formula\'s problem inside it, in place of its value', async () => {
    open();
    await settled();
    expect(within(node('odd')).getByRole('alert').textContent).toBe('✕ No function or table called "nothing"');
    expect(node('odd').querySelector('[data-value]')).toBeNull();
  });

  it('shows a formula\'s alternative under its house rule, and the rule, a table and a note as nodes of their own', () => {
    open();
    expect(node('spell').textContent).toContain('WITH MAGIC, USE');
    expect(within(node('spell')).getByText('WIT MOD + LEVEL')).toBeTruthy();
    expect(node('rule:magic').textContent).toContain('Characters can learn spells.');
    expect(node('note:n1').textContent).toContain('Best of the two.');
    expect(node('table:attribute_mod').textContent).toContain('UP TO 13');
  });
});

describe('groups', () => {
  it('folds a group into one line of how many nodes and wires out, through edit, and opens it again', async () => {
    const { last } = open();
    await userEvent.click(screen.getByRole('button', { name: 'Fold SAVES' }));
    expect((last().graph as { collapsed: string[] }).collapsed).toEqual(['saves']);
    expect(screen.getByTestId('graph-group-saves').textContent).toContain('2 NODES · 0 WIRES OUT');
    await userEvent.click(screen.getByRole('button', { name: 'Open SAVES' }));
    expect((last().graph as Record<string, unknown>).collapsed).toBeUndefined();
  });
});

describe('the toolbar and the status line', () => {
  it('has zoom, zoom out and FIT', () => {
    open();
    const bar = screen.getByRole('toolbar', { name: 'Map' });
    for (const name of ['Zoom in', 'Zoom out', 'FIT']) expect(within(bar).getByRole('button', { name })).toBeTruthy();
    expect(within(bar).getByTestId('graph-zoom').textContent).toMatch(/^\d+%$/);
  });

  it('AUTO-LAYOUT puts every node back in its column, in one click it can undo', async () => {
    const moved = { ...HEARTH, graph: { ...(HEARTH.graph as object), positions: { save: [2400, 2400] } } };
    const { last } = open(moved);
    await userEvent.click(screen.getByRole('button', { name: 'AUTO-LAYOUT' }));
    const laid = layoutOf(graphOf(moved));
    expect((last().graph as { positions: Record<string, number[]> }).positions.save).toEqual([laid.save.x, laid.save.y]);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(last()).toEqual(moved);
  });

  it('says how much is on the map and the sample character it is worked out on', () => {
    open();
    const status = screen.getByTestId('graph-status').textContent!;
    expect(status).toContain(`${graphOf(HEARTH).nodes.length} NODES`);
    expect(status).toContain('SAMPLE: LVL 3 · STR 16 · WIT 9');
  });
});

describe('undo and redo', () => {
  it('start with nothing to undo or redo', () => {
    open();
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('take back a fold and a change made in a node\'s panel, in turn, and put them back', async () => {
    const { last } = open();
    await userEvent.click(screen.getByRole('button', { name: 'Fold SAVES' }));
    const folded = last();
    fireEvent.click(node('spell'));
    const text = within(await screen.findByTestId('graph-panel')).getByLabelText('Spell power formula');
    await userEvent.type(text, ' + 1');
    const typed = last();
    expect((typed.derived as { id: string; formula: string }[]).find((d) => d.id === 'spell')!.formula).toBe('0 + 1');
    // The typing is one step, the fold another.
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(last()).toEqual(folded);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(last()).toEqual(HEARTH);
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Redo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(last()).toEqual(typed);
  });

  it('answer Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z on the map, but leave a box being typed in its own', async () => {
    const { last } = open();
    await userEvent.click(screen.getByRole('button', { name: 'Fold SAVES' }));
    const map = screen.getByTestId('graph-map');
    fireEvent.keyDown(map, { key: 'z', ctrlKey: true });
    expect(last()).toEqual(HEARTH);
    fireEvent.keyDown(map, { key: 'y', ctrlKey: true });
    expect((last().graph as { collapsed: string[] }).collapsed).toEqual(['saves']);
    fireEvent.keyDown(map, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(map, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect((last().graph as { collapsed: string[] }).collapsed).toEqual(['saves']);
    fireEvent.click(node('spell'));
    const before = last();
    fireEvent.keyDown(within(await screen.findByTestId('graph-panel')).getByLabelText('Spell power formula'), { key: 'z', ctrlKey: true });
    expect(last()).toBe(before);
  });
});

describe('+ ADD and Delete (5b4)', () => {
  it('+ ADD searches what can be added, and adds a formula where the GM is looking, its panel open', async () => {
    const { last } = open();
    await userEvent.click(screen.getByRole('button', { name: '+ ADD' }));
    const search = screen.getByRole('dialog', { name: 'Add a node' });
    expect(within(search).getByRole('option', { name: /ROLL/ }).hasAttribute('disabled')).toBe(true);
    await userEvent.type(within(search).getByLabelText('Add a node: type to search'), 'formula{Enter}');
    expect(screen.queryByRole('dialog', { name: 'Add a node' })).toBeNull();
    expect((last().derived as { id: string }[]).map((d) => d.id)).toContain('new_formula');
    expect((last().graph as { positions: Record<string, unknown> }).positions.new_formula).toBeTruthy();
    expect(node('new_formula')).toBeTruthy();
    expect(screen.getByTestId('graph-panel').getAttribute('aria-label')).toBe('FORMULA NEW FORMULA');
  });

  it('A opens it from the map, not from a box being typed in; Escape closes it', async () => {
    open();
    fireEvent.keyDown(screen.getByTestId('graph-map'), { key: 'a' });
    expect(screen.getByRole('dialog', { name: 'Add a node' })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Add a node' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Add a node' })).toBeNull();
    fireEvent.click(node('save'));
    fireEvent.keyDown(within(await screen.findByTestId('graph-panel')).getByLabelText('Physical save formula'), { key: 'a' });
    expect(screen.queryByRole('dialog', { name: 'Add a node' })).toBeNull();
  });

  it('a stat goes in the group picked, its list opened', async () => {
    const { last } = open();
    await userEvent.click(screen.getByRole('button', { name: '+ ADD' }));
    await userEvent.click(screen.getByRole('option', { name: /STAT IN ABILITIES/ }));
    expect((last().stats as { id: string; stats: { id: string }[] }[]).find((g) => g.id === 'abilities')!.stats.map((s) => s.id)).toEqual(['str', 'wit', 'new_stat']);
    expect(screen.getByTestId('graph-panel').getAttribute('aria-label')).toBe('STATS ABILITIES');
  });

  it('Delete removes the picked node, as FORMS\' × does, and undoes; a house rule says where it goes', async () => {
    const { last } = open();
    fireEvent.click(node('odd'));
    await screen.findByTestId('graph-panel');
    fireEvent.keyDown(screen.getByTestId('graph-map'), { key: 'Delete' });
    expect((last().derived as { id: string }[]).map((d) => d.id)).not.toContain('odd');
    expect(screen.queryByTestId('graph-node-odd')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(last()).toEqual(HEARTH);
    fireEvent.click(node('rule:magic'));
    await screen.findByTestId('graph-panel');
    fireEvent.keyDown(screen.getByTestId('graph-map'), { key: 'Delete' });
    expect(screen.getByRole('status').textContent).toBe('House rules are removed on HOUSE RULES, where removing one says what stays.');
    expect(last()).toEqual(HEARTH);
  });
});

describe('notes (5b5)', () => {
  it('+ ADD → NOTE pins a new one to the node picked, beside it, its panel open', async () => {
    const { last } = open();
    fireEvent.click(node('spell'));
    await screen.findByTestId('graph-panel');
    fireEvent.keyDown(screen.getByTestId('graph-map'), { key: 'a' });
    await userEvent.type(screen.getByLabelText('Add a node: type to search'), 'note{Enter}');
    const layout = last().graph as { notes: unknown[]; positions: Record<string, number[]> };
    expect(layout.notes[1]).toEqual({ id: 'n2', on: 'spell', text: 'A note.' });
    const spell = positionsOf(HEARTH, graphOf(HEARTH)).spell;
    expect(layout.positions['note:n2']).toEqual([spell.x + 264 + 48, spell.y]);
    expect(node('note:n2').textContent).toContain('A note.');
    expect(screen.getByTestId('graph-panel').getAttribute('aria-label')).toBe('NOTE ON SPELL POWER');
  });

  it('with nothing picked, a note pinned to nothing', async () => {
    const { last } = open();
    await userEvent.click(screen.getByRole('button', { name: '+ ADD' }));
    await userEvent.click(screen.getByRole('option', { name: /NOTE/ }));
    expect((last().graph as { notes: unknown[] }).notes[1]).toEqual({ id: 'n2', text: 'A note.' });
    expect(screen.getByTestId('graph-panel').getAttribute('aria-label')).toBe('NOTE NOT PINNED');
  });

  it('Delete removes the picked note and its place, and undoes', async () => {
    const { last } = open();
    fireEvent.click(node('note:n1'));
    await screen.findByTestId('graph-panel');
    fireEvent.keyDown(screen.getByTestId('graph-map'), { key: 'Delete' });
    expect((last().graph as { notes?: unknown[] }).notes).toBeUndefined();
    expect(screen.queryByTestId('graph-node-note:n1')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Removed the note. Undo brings it back.');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(last()).toEqual(HEARTH);
  });

  it('a note\'s square dot can be dragged onto a node; an example\'s can\'t', () => {
    open();
    const dot = () => node('note:n1').querySelector('.react-flow__handle-left')!;
    expect(dot().classList.contains('connectable')).toBe(true);
    cleanup();
    open(HEARTH, true);
    expect(dot().classList.contains('connectable')).toBe(false);
  });
});

describe('an example, looked at', () => {
  it('folds and lays out nothing, and keeps zoom usable when the page is locked', () => {
    const { edits } = open(HEARTH, true);
    lockControls(screen.getByTestId('graph-view'));
    expect((screen.getByRole('button', { name: 'Fold SAVES' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'AUTO-LAYOUT' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(screen.queryByRole('button', { name: '+ ADD' })).toBeNull();
    const bar = screen.getByRole('toolbar', { name: 'Map' });
    for (const name of ['Zoom in', 'Zoom out', 'FIT']) expect((within(bar).getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false);
    expect(edits).toEqual([]);
  });
});
