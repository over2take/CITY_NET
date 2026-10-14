import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { HouseRulesPage } from '../HouseRulesPage';
import type { Definition } from '../../sheets/systemsApi';
import { HINTS } from '../../sheets/builderHelp';
import { LIMITS } from '../../sheets/houseRules';

/**
 * The builder's HOUSE RULES page (4j3b). Approved mockup optional-rules (2026-10-14): the rules down
 * the left, the open one with its name, what it means, STARTS, and what waits on it with GO TO;
 * DELETE asks first, and what waited on it is then always there.
 */

afterEach(() => cleanup());

const HEARTH = {
  format: 1, name: 'Hearth',
  house_rules: [{ id: 'magic', name: 'MAGIC', description: 'Spells.' }, { id: 'markets', name: 'TOWN MARKETS', starts: true }],
  parts: { shops: { on: true, only_with: 'markets' } },
  conditions: { hexed: { name: 'Hexed', only_with: 'magic' } },
  derived: [{ id: 'mana', label: 'Mana', formula: '2', alternative: { rule: 'magic', formula: '4' } }],
} as unknown as Definition;

const open = (start: Definition = HEARTH) => {
  const edits: Definition[] = [];
  const onGoTo = vi.fn();
  const Harness = () => {
    const [def, setDef] = useState(start);
    return <HouseRulesPage definition={def} edit={(next) => { edits.push(next); setDef(next); }} onGoTo={onGoTo} />;
  };
  render(<Harness />);
  return { edits, onGoTo, last: () => edits[edits.length - 1] };
};
const list = () => within(screen.getByRole('list', { name: 'House rules' }));
const detail = (name: string) => within(screen.getByRole('region', { name: `${name} house rule` }));

describe('the list', () => {
  it('shows each rule and how it starts, the first open', () => {
    open();
    expect(list().getAllByRole('button').map((b) => b.textContent)).toEqual(['MAGIC', 'TOWN MARKETS']);
    expect(list().getByText('STARTS OFF')).toBeTruthy();
    expect(list().getByText('STARTS ON')).toBeTruthy();
    expect(screen.getByText(`2 OF ${LIMITS.rules}`)).toBeTruthy();
    expect(list().getByRole('button', { name: 'MAGIC' }).getAttribute('aria-current')).toBe('true');
    expect((detail('MAGIC').getByLabelText('NAME') as HTMLInputElement).value).toBe('MAGIC');
  });

  it('says what a house rule is when there are none, and + RULE makes one, opened', async () => {
    const { last } = open({ format: 1, name: 'Hearth' } as Definition);
    expect(screen.getByText(/None yet\. A house rule is a choice the GM makes for their table/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '+ RULE' }));
    expect(last().house_rules).toEqual([{ id: 'new_rule', name: 'NEW RULE' }]);
    expect(detail('NEW RULE').getByText(/Nothing yet, so this rule changes nothing/)).toBeTruthy();
  });

  it('opens a new rule at the end of the list, the others still there', async () => {
    open();
    await userEvent.click(screen.getByRole('button', { name: '+ RULE' }));
    expect(list().getAllByRole('button').map((b) => b.textContent)).toEqual(['MAGIC', 'TOWN MARKETS', 'NEW RULE']);
    expect(list().getByRole('button', { name: 'NEW RULE' }).getAttribute('aria-current')).toBe('true');
    expect(screen.getByRole('region', { name: 'NEW RULE house rule' })).toBeTruthy();
  });

  it('opens another when it is picked', async () => {
    open();
    await userEvent.click(list().getByRole('button', { name: 'TOWN MARKETS' }));
    expect(detail('TOWN MARKETS').getByRole('button', { name: 'ON' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('holds twenty at most', () => {
    const many = Array.from({ length: LIMITS.rules }, (_, i) => ({ id: `r${i}`, name: `R${i}` }));
    open({ format: 1, name: 'Hearth', house_rules: many } as unknown as Definition);
    expect((screen.getByRole('button', { name: '+ RULE' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('a rule', () => {
  it('is renamed, described and set to start on or off', async () => {
    const { last } = open();
    const name = detail('MAGIC').getByLabelText('NAME');
    await userEvent.clear(name);
    expect(list().getByRole('button', { name: 'NEEDS A NAME' })).toBeTruthy();
    expect(name.getAttribute('aria-invalid')).toBe('true');
    await userEvent.type(name, 'SORCERY');
    fireEvent.change(detail('SORCERY').getByLabelText('WHAT IT MEANS'), { target: { value: '' } });
    await userEvent.click(within(detail('SORCERY').getByRole('group', { name: 'Starts' })).getByRole('button', { name: 'ON' }));
    expect((last().house_rules as object[])[0]).toEqual({ id: 'magic', name: 'SORCERY', starts: true });
    expect(list().getAllByText('STARTS ON')).toHaveLength(2);
    await userEvent.click(within(detail('SORCERY').getByRole('group', { name: 'Starts' })).getByRole('button', { name: 'OFF' }));
    expect((last().house_rules as object[])[0]).toEqual({ id: 'magic', name: 'SORCERY' });
  });

  it('lists what waits on it, each going to its own page', async () => {
    const { onGoTo } = open();
    const waits = within(detail('MAGIC').getByRole('list', { name: 'What waits on it' }));
    expect(waits.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['CONDITIONHexedGO TO', 'FORMULAManaGO TO']);
    await userEvent.click(waits.getByRole('button', { name: 'Go to Mana' }));
    expect(onGoTo).toHaveBeenCalledWith('rules');
    await userEvent.click(list().getByRole('button', { name: 'TOWN MARKETS' }));
    await userEvent.click(detail('TOWN MARKETS').getByRole('button', { name: 'Go to SHOPS' }));
    expect(onGoTo).toHaveBeenLastCalledWith('features');
  });

  it('asks before it is deleted, saying what stays, and then frees it', async () => {
    const { edits, last } = open();
    await userEvent.click(detail('MAGIC').getByRole('button', { name: 'DELETE' }));
    const ask = within(screen.getByRole('group', { name: 'Delete MAGIC' }));
    expect(ask.getByText('Delete MAGIC? What waits on it (2) stays, always there.')).toBeTruthy();
    await userEvent.click(ask.getByRole('button', { name: 'KEEP' }));
    expect(edits).toEqual([]);
    await userEvent.click(detail('MAGIC').getByRole('button', { name: 'DELETE' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Delete MAGIC' })).getByRole('button', { name: 'DELETE' }));
    expect((last().house_rules as { id: string }[]).map((r) => r.id)).toEqual(['markets']);
    expect(last().conditions).toEqual({ hexed: { name: 'Hexed' } });
    expect(last().derived).toEqual([{ id: 'mana', label: 'Mana', formula: '2' }]);
    // The next one opens in its place.
    expect(screen.getByRole('region', { name: 'TOWN MARKETS house rule' })).toBeTruthy();
  });
});

describe('the "?"', () => {
  it('sits beside each setting, the fields still named by their words', () => {
    open();
    const keys = Object.keys(HINTS).filter((k) => k.startsWith('house.')) as (keyof typeof HINTS)[];
    expect(keys).toHaveLength(3);
    for (const k of keys) expect(screen.getByRole('note', { name: HINTS[k] }), k).toBeTruthy();
    for (const name of ['NAME', 'WHAT IT MEANS']) expect(screen.getByRole('textbox', { name }), name).toBeTruthy();
  });
});
