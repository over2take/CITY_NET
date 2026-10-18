import React, { useState } from 'react';
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, cleanup, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { GraphView } from '../GraphView';
import type { Definition } from '../../sheets/systemsApi';
import { graphOf, layoutOf } from '../../sheets/graphModel';
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

  it('AUTO-LAYOUT asks first, then puts every node back in its column', async () => {
    const moved = { ...HEARTH, graph: { ...(HEARTH.graph as object), positions: { save: [2400, 2400] } } };
    const { edits, last } = open(moved);
    await userEvent.click(screen.getByRole('button', { name: 'AUTO-LAYOUT' }));
    expect(edits).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'REPLACE MY LAYOUT?' }));
    const laid = layoutOf(graphOf(moved));
    expect((last().graph as { positions: Record<string, number[]> }).positions.save).toEqual([laid.save.x, laid.save.y]);
  });

  it('says how much is on the map and the sample character it is worked out on', () => {
    open();
    const status = screen.getByTestId('graph-status').textContent!;
    expect(status).toContain(`${graphOf(HEARTH).nodes.length} NODES`);
    expect(status).toContain('SAMPLE: LVL 3 · STR 16 · WIT 9');
  });
});

describe('an example, looked at', () => {
  it('folds and lays out nothing, and keeps zoom usable when the page is locked', () => {
    const { edits } = open(HEARTH, true);
    lockControls(screen.getByTestId('graph-view'));
    expect((screen.getByRole('button', { name: 'Fold SAVES' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'AUTO-LAYOUT' })).toBeNull();
    const bar = screen.getByRole('toolbar', { name: 'Map' });
    for (const name of ['Zoom in', 'Zoom out', 'FIT']) expect((within(bar).getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(false);
    expect(edits).toEqual([]);
  });
});
