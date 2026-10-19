import React, { useState } from 'react';
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { GraphView } from '../GraphView';
import { StatsRulesPage } from '../StatsRulesPage';
import type { Definition } from '../../sheets/systemsApi';
import { lockControls } from '../../sheets/examples';
import { standInsForReactFlow } from '../../test/reactFlow';

/**
 * The graph view's node panel (5a3b2). Approved mockup builder-graph (2026-10-17): "the panel is
 * the same form as FORMS". A node clicked opens its controls beside the map, the very controls
 * FORMS lays out (statsRulesFields): so here every change is made twice, once in FORMS and once in
 * the panel, and the two systems that come out must be the same. And the panel's own ways: closing
 * with ×, Escape or a click on the map; a house rule going to HOUSE RULES; a note read; a formula
 * removed closing it; an example's panel read but not changed.
 */

beforeAll(() => standInsForReactFlow());
afterEach(() => cleanup());

const HEARTH: Definition = {
  format: 1,
  name: 'Hearth',
  stats: [
    { id: 'character', label: 'Character', stats: [{ id: 'lvl', label: 'Level', min: 1, max: 10 }] },
    { id: 'abilities', label: 'Abilities', stats: [{ id: 'str', label: 'Strength', min: 3, max: 18 }] },
  ],
  samples: { lvl: 3, str: 16 },
  lookups: { attribute_mod: { label: 'Attribute mod', bands: [{ upTo: 13, value: 0 }, { value: 1 }] } },
  derived: [
    { id: 'str_mod', label: 'Str mod', formula: 'attribute_mod(@str)' },
    { id: 'melee', label: 'Melee attack', formula: '@str_mod + 1' },
  ],
  house_rules: [{ id: 'magic', name: 'Magic', description: 'Characters can learn spells.' }],
  graph: { notes: [{ id: 'n1', on: 'melee', text: 'Half level, rounded down.' }] },
};

const api = { previewValues: vi.fn(async () => ({ ok: true as const, value: { values: { str_mod: 1, melee: 2 }, problems: [] } })) } as never;

/** A harness that keeps its own definition, and every edit made. */
const harness = (draw: (def: Definition, edit: (next: Definition) => void) => React.ReactNode, start: Definition = HEARTH) => {
  const edits: Definition[] = [];
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <>{draw(def, (next) => { edits.push(next); setDef(next); })}</>;
  };
  const view = render(<Harness />);
  return { edits, last: () => edits[edits.length - 1], unmount: view.unmount };
};
const openMap = (start: Definition = HEARTH, extra: Partial<React.ComponentProps<typeof GraphView>> = {}) =>
  harness((def, edit) => <div style={{ width: 1200, height: 800 }}><GraphView definition={def} edit={edit} api={api} {...extra} /></div>, start);
const openForms = (start: Definition = HEARTH) => harness((def, edit) => <StatsRulesPage definition={def} edit={edit} api={api} />, start);
// A plain click: React Flow drags with d3-drag, which reads the mouse-down's window, and jsdom's
// pointer events from user-event have none. The real pointer is e2e/tests/builder-graph.spec.ts.
const pick = async (id: string) => { fireEvent.click(screen.getByTestId(`graph-node-${id}`)); return screen.findByTestId('graph-panel'); };

/** The same change made in FORMS (on `tab`) and in the panel (on node `node`): both systems out. */
const both = async (tab: 'STATS' | 'FORMULAS' | 'TABLES', node: string, act: () => Promise<void>) => {
  const forms = openForms();
  await userEvent.click(screen.getByRole('tab', { name: tab }));
  await act();
  const fromForms = forms.last();
  forms.unmount();
  const map = openMap();
  await pick(node);
  await act();
  const fromPanel = map.last();
  map.unmount();
  return { fromForms, fromPanel };
};

describe('the panel is the same form as FORMS', () => {
  it('a formula\'s text changed', async () => {
    const { fromForms, fromPanel } = await both('FORMULAS', 'melee', async () => {
      await userEvent.type(screen.getByLabelText('Melee attack formula'), ' + 2');
    });
    expect(fromPanel).toEqual(fromForms);
    expect((fromPanel.derived as { formula: string }[])[1].formula).toBe('@str_mod + 1 + 2');
  });

  it('a formula renamed', async () => {
    const { fromForms, fromPanel } = await both('FORMULAS', 'melee', async () => {
      const name = screen.getByLabelText('Melee attack name');
      await userEvent.clear(name);
      await userEvent.type(name, 'Strike');
    });
    expect(fromPanel).toEqual(fromForms);
  });

  it('a name put in with INSERT', async () => {
    const { fromForms, fromPanel } = await both('FORMULAS', 'melee', async () => {
      const text = screen.getByLabelText('Melee attack formula') as HTMLInputElement;
      await userEvent.click(text);
      text.setSelectionRange(text.value.length, text.value.length);
      fireEvent.select(text);
      await userEvent.click(screen.getByRole('button', { name: '@lvl' }));
    });
    expect(fromPanel).toEqual(fromForms);
    expect((fromPanel.derived as { formula: string }[])[1].formula).toBe('@str_mod + 1@lvl');
  });

  it('a stat\'s sample changed, from its list', async () => {
    const { fromForms, fromPanel } = await both('STATS', 'abilities', async () => {
      const sample = screen.getByLabelText('Strength sample');
      await userEvent.clear(sample);
      await userEvent.type(sample, '12');
    });
    expect(fromPanel).toEqual(fromForms);
    expect(fromPanel.samples).toEqual({ lvl: 3, str: 12 });
  });

  it('a table\'s row changed', async () => {
    const { fromForms, fromPanel } = await both('TABLES', 'table:attribute_mod', async () => {
      const gives = screen.getByLabelText('Row 1 gives');
      await userEvent.clear(gives);
      await userEvent.type(gives, '5');
    });
    expect(fromPanel).toEqual(fromForms);
  });
});

describe('ON THE WAY IN (5b3)', () => {
  const HALF: Definition = { ...HEARTH, derived: [...(HEARTH.derived as unknown[]), { id: 'half', label: 'Half level', formula: '@str_mod + floor(@lvl / 2)' }] };
  const node = (id: string) => screen.getByTestId(`graph-node-${id}`);

  it("a modifier's number changed is the formula typed anew in FORMS", async () => {
    const forms = openForms(HALF);
    await userEvent.click(screen.getByRole('tab', { name: 'FORMULAS' }));
    const text = screen.getByLabelText('Half level formula');
    await userEvent.clear(text);
    await userEvent.type(text, '@str_mod + floor(@lvl / 4)');
    const fromForms = forms.last();
    forms.unmount();
    const map = openMap(HALF);
    const panel = await pick('half');
    const box = within(panel).getByLabelText('LEVEL divided by, rounded down');
    expect((box as HTMLInputElement).value).toBe('2');
    await userEvent.clear(box);
    await userEvent.type(box, '4');
    expect(map.last()).toEqual(fromForms);
    expect(within(node('half')).getByText('÷4↓')).toBeTruthy();
  });

  it("shows a WITH-rule formula's modifiers too, and changes that formula", async () => {
    const def: Definition = { ...HEARTH, derived: [...(HEARTH.derived as unknown[]), { id: 'spell', label: 'Spell', formula: '0', alternative: { rule: 'magic', formula: '@lvl * 2' } }] };
    const { last } = openMap(def);
    const box = within(await pick('spell')).getByLabelText('LEVEL times (WITH-rule formula)');
    await userEvent.clear(box);
    await userEvent.type(box, '3');
    expect((last().derived as { id: string; formula: string; alternative?: { formula: string } }[]).find((d) => d.id === 'spell')).toMatchObject({ formula: '0', alternative: { formula: '@lvl * 3' } });
  });

  it('is not there for a formula with no modifier', async () => {
    openMap(HALF);
    expect((await pick('melee')).textContent).not.toContain('ON THE WAY IN');
  });
});

describe('the panel', () => {
  it('opens on the node clicked, outlined, and closes with ×, Escape or a click on the map', async () => {
    openMap();
    const panel = await pick('melee');
    expect(panel.getAttribute('aria-label')).toBe('FORMULA MELEE ATTACK');
    expect(screen.getByTestId('graph-node-melee').parentElement!.style.outline).toContain('solid');
    await userEvent.click(within(panel).getByRole('button', { name: 'Close the panel' }));
    expect(screen.queryByTestId('graph-panel')).toBeNull();
    await pick('melee');
    fireEvent.keyDown(screen.getByTestId('graph-panel'), { key: 'Escape' });
    expect(screen.queryByTestId('graph-panel')).toBeNull();
    await pick('melee');
    fireEvent.click(document.querySelector('.react-flow__pane')!);
    expect(screen.queryByTestId('graph-panel')).toBeNull();
  });

  it('a stats list shows its group, and the modifiers its table gives', async () => {
    openMap();
    const panel = await pick('abilities');
    expect(within(panel).getByLabelText('Group name')).toBeTruthy();
    expect(panel.textContent).toContain('MODIFIERS · FROM ATTRIBUTE MOD');
    expect(within(panel).getByLabelText('Str mod formula')).toBeTruthy();
  });

  it('a formula removed closes the panel, its node gone', async () => {
    const { last } = openMap();
    const panel = await pick('melee');
    await userEvent.click(within(panel).getByRole('button', { name: 'REMOVE FORMULA' }));
    expect((last().derived as { id: string }[]).map((d) => d.id)).toEqual(['str_mod']);
    expect(screen.queryByTestId('graph-panel')).toBeNull();
  });

  it('a house rule says what it is and goes to HOUSE RULES, where it is made', async () => {
    const onGoTo = vi.fn();
    openMap(HEARTH, { onGoTo });
    const panel = await pick('rule:magic');
    expect(panel.textContent).toContain('Characters can learn spells.');
    await userEvent.click(within(panel).getByRole('button', { name: 'GO TO HOUSE RULES' }));
    expect(onGoTo).toHaveBeenCalledWith('house_rules');
  });

  it('a note is read in the panel', async () => {
    openMap();
    const panel = await pick('note:n1');
    expect(panel.textContent).toContain('Half level, rounded down.');
    expect(within(panel).queryByRole('textbox')).toBeNull();
  });

  it('an example\'s panel is read, nothing in it changed, and still closes', async () => {
    const { edits } = openMap(HEARTH, { readOnly: true });
    const panel = await pick('melee');
    lockControls(screen.getByTestId('graph-view'));
    expect((within(panel).getByLabelText('Melee attack formula') as HTMLInputElement).disabled).toBe(true);
    await userEvent.click(within(panel).getByRole('button', { name: 'Close the panel' }));
    expect(screen.queryByTestId('graph-panel')).toBeNull();
    expect(edits).toEqual([]);
  });
});
