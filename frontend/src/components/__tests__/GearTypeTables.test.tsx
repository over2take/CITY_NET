import React, { useState } from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InventorySection } from '../InventorySection';
import type { SheetSection } from '../../sheets/types';
import type { ItemsShown } from '../../sheets/gearItems';
import type { GearDiceRead } from '../../sheets/gearDice';
import type { CountAnswer, GearCount } from '../../sheets/gearTypes';

/**
 * The GEAR tab by item type (8a3a; approved mockup docs/mockups/item-types.html, 2026-11-14), each thing a compact line
 * (8a3c1; approved mockup docs/mockups/gear-compact.html, 2026-11-15): name, how many, where, ✎ and × on top, only the
 * columns it has as words under it, ROLL beside a DAMAGE; ✎ opening every column as a box, an item's values faint under
 * a line's own, one line at a time; + to add a line of a type by hand, opened; and the one list without types.
 */

// Which bands are closed is kept in the browser (G2): each test starts from none kept.
afterEach(() => { cleanup(); localStorage.clear(); });

const SECTION: SheetSection = { id: 'gear', label: 'GEAR', layout: 'inventory', fields: [] };
const ITEMS: ItemsShown = {
  slots: [],
  list: [
    { id: 'pistol', label: 'Pistol', needs: 'carried', features: [], type: 'weapons', values: { damage: '2d6', range: '30 m', ammo: 6, weight: 2, grade: 'LIGHT' } },
    { id: 'ring', label: 'Ring of Might', needs: 'worn', features: [], type: 'gear', values: {} },
  ],
  types: [
    { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [
      { id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'range', label: 'RANGE', kind: 'text' },
      { id: 'ammo', label: 'AMMO', kind: 'count', button: 'FIRE', reload: ['Pistol Rounds', 'AP Rounds'] }, { id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' },
      { id: 'charges', label: 'CHARGES', kind: 'count', refill: 'short_rest' }, { id: 'grade', label: 'GRADE', kind: 'pick', options: ['LIGHT', 'HEAVY'] }] },
    { id: 'gear', label: 'GEAR', one: 'Gear', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }] },
  ],
};
const line = (name: string, more = {}) => ({ name, qty: 1, enc: '', bundled: false, carry: 'stowed', location: '', ...more });

/** What the server sends next, from outside the sheet (a WEAR, a gift): set on the sheet shown. */
const outside: { set: (more: Record<string, unknown>) => void } = { set: () => {} };
const show = (lines: object[], { readOnly = false, items = ITEMS as ItemsShown | undefined, onGearRoll = undefined as ((line: number, column: string) => void) | undefined,
  onReadGearDice = undefined as ((text: string) => Promise<GearDiceRead | null>) | undefined, onGearCount = undefined as GearCount | undefined,
  worked = undefined as object | undefined, columnsLocked = false, onReadGearLines = undefined as ((texts: string[]) => Promise<GearDiceRead[] | null>) | undefined } = {}) => {
  const writes: object[][] = [];
  const Harness = () => {
    // `worked`: what the server worked out of the items (_worked), which are worn.
    const [data, setData] = useState<Record<string, unknown>>({ inventory: JSON.stringify(lines), ...(worked ? { _worked: worked } : {}) });
    outside.set = (more) => setData((d) => ({ ...d, ...more }));
    return <InventorySection section={SECTION} data={data as never} readOnly={readOnly} itemsShown={items} columnsLocked={columnsLocked} onGearRoll={onGearRoll} onReadGearDice={onReadGearDice} onReadGearLines={onReadGearLines} onGearCount={onGearCount}
      onFieldChange={(id, v) => { writes.push(JSON.parse(v as string)); setData((d) => ({ ...d, [id]: v })); }} />;
  };
  render(<Harness />);
  return () => writes[writes.length - 1] as Record<string, unknown>[];
};
const table = (name: string) => within(screen.getByRole('region', { name: `${name} gear` }));
/** A line's name, the button opening its card (G3): "Pistol, item 2". */
const named = (i: number) => new RegExp(`, item ${i}$`);

describe('a compact line per thing, by type', () => {
  const note = (name: string, label: string) => table(name).queryByRole('note', { name: new RegExp(`^${label}: `) });
  // Its card opened by a click on its name (G3).
  const edit = (name: string, i: number) => userEvent.click(table(name).getByRole('button', { name: named(i) }));

  it('each type\'s lines under its heading; on a line only the columns it has, as words, its item\'s faint, units said', () => {
    show([line('Rope'), line('Pistol'), line('A stick', { type: 'weapons', values: { damage: '1d4' } })]);
    expect(table('WEAPONS').getByText('WEAPONS · 3')).toBeTruthy();
    expect(table('WEAPONS').getByRole('button', { name: 'Pistol, item 2' })).toBeTruthy();
    // Rope is no item of the system: the first type... which is WEAPONS; it has no columns at all.
    expect(table('WEAPONS').getByRole('button', { name: 'Rope, item 1' })).toBeTruthy();
    expect(within(screen.getByTestId('gear-line-0')).queryAllByRole('note').filter((n) => /^Item [0-9]+ /.test(n.getAttribute('aria-label') ?? ''))).toHaveLength(0);
    // Every column blank: FILL IN says which (G3).
    expect(within(screen.getByTestId('gear-line-0')).getByRole('button', { name: 'Fill in item 1: DAMAGE, RANGE, AMMO, WEIGHT, CHARGES, GRADE' })).toBeTruthy();
    // The Pistol: its item's DAMAGE, RANGE, AMMO, WEIGHT with its unit, GRADE.
    expect(within(screen.getByTestId('gear-line-1')).getAllByRole('note').map((n) => n.getAttribute('aria-label')).filter((l) => /^Item [0-9]+ /.test(l ?? '')))
      .toEqual(['Item 2 DAMAGE: 2d6', 'Item 2 RANGE: 30 m', 'Item 2 AMMO: 6 / 6', 'Item 2 WEIGHT: 2 LB', 'Item 2 GRADE: LIGHT']);
    expect(within(note('WEAPONS', 'Item 2 RANGE')!).getByText('30 m').getAttribute('title')).toBe('As the item has it');
    // A stick: its own DAMAGE, and nothing else (doesn't apply).
    expect(within(screen.getByTestId('gear-line-2')).getAllByRole('note').map((n) => n.getAttribute('aria-label')).filter((l) => /^Item [0-9]+ /.test(l ?? ''))).toEqual(['Item 3 DAMAGE: 1d4']);
    expect(within(note('WEAPONS', 'Item 3 DAMAGE')!).getByText('1d4').getAttribute('title')).toBe('This line\'s own');
    // A type with no lines has no group in its band (G2): GEAR has none.
    expect(screen.queryByRole('region', { name: 'GEAR gear' })).toBeNull();
    // No boxes for the columns until ✎; no one list, and no + ITEM under it.
    expect(table('WEAPONS').queryByLabelText('Item 2 RANGE')).toBeNull();
    expect(screen.queryByRole('button', { name: '+ ITEM' })).toBeNull();
  });

  it('✎ opens every column as a box, its item\'s faint, "none" where it has none; typed, the line\'s own; blank, the item\'s again', async () => {
    const last = show([line('Pistol'), line('A stick', { type: 'weapons', values: { damage: '1d4' } })]);
    await edit('WEAPONS', 1);
    expect(table('WEAPONS').getByRole('button', { name: 'Pistol, item 1' }).getAttribute('aria-expanded')).toBe('true');
    // Its words stay over the boxes, as the mockup draws it.
    expect(note('WEAPONS', 'Item 1 RANGE')).toBeTruthy();
    const range = table('WEAPONS').getByLabelText('Item 1 RANGE') as HTMLInputElement;
    expect([range.value, range.placeholder]).toEqual(['', '30 m']);
    expect((table('WEAPONS').getByLabelText('Item 1 AMMO') as HTMLInputElement).placeholder).toBe('6');
    expect((table('WEAPONS').getByLabelText('Item 1 GRADE') as HTMLSelectElement).options[0].textContent).toBe('LIGHT');
    fireEvent.change(range, { target: { value: '50 m' } });
    expect(last()[0]).toMatchObject({ name: 'Pistol', values: { range: '50 m' } });
    fireEvent.change(table('WEAPONS').getByLabelText('Item 1 GRADE'), { target: { value: 'HEAVY' } });
    fireEvent.change(table('WEAPONS').getByLabelText('Item 1 WEIGHT'), { target: { value: '2.5' } });
    expect(last()[0].values).toEqual({ range: '50 m', grade: 'HEAVY', weight: 2.5 });
    fireEvent.change(table('WEAPONS').getByLabelText('Item 1 RANGE'), { target: { value: '' } });
    expect(last()[0].values).toEqual({ grade: 'HEAVY', weight: 2.5 });
    // One open at a time: the stick's ✎ closes the Pistol's; its empty columns say none.
    await edit('WEAPONS', 2);
    expect(table('WEAPONS').queryByLabelText('Item 1 RANGE')).toBeNull();
    expect((table('WEAPONS').getByLabelText('Item 2 RANGE') as HTMLInputElement).placeholder).toBe('none');
    expect((table('WEAPONS').getByLabelText('Item 2 GRADE') as HTMLSelectElement).options[0].textContent).toBe('none');
    // DONE closes it, as a click on the line again does.
    await userEvent.click(table('WEAPONS').getByRole('button', { name: 'DONE' }));
    expect(table('WEAPONS').queryByLabelText('Item 2 RANGE')).toBeNull();
    await edit('WEAPONS', 2);
    await edit('WEAPONS', 2);
    expect(table('WEAPONS').queryByLabelText('Item 2 RANGE')).toBeNull();
  });

  it('+ a type\'s one adds a line of it by hand, opened to fill, which stays in its table as it is named; a stashed one says where', async () => {
    const last = show([line('Pistol')]);
    // From the row of + at the top (G2).
    await userEvent.click(within(screen.getByRole('group', { name: 'Add by hand' })).getByRole('button', { name: 'Add a Gear by hand' }));
    expect(last()[1]).toEqual(line('', { type: 'gear' }));
    expect(table('GEAR').getByLabelText('Item 2 WEIGHT')).toBeTruthy();
    // Its NAME box ready to type in (G3).
    expect(document.activeElement).toBe(table('GEAR').getByLabelText('Item 2 name'));
    fireEvent.change(table('GEAR').getByLabelText('Item 2 name'), { target: { value: 'Pistol' } });
    // Named like the pistol, it is still GEAR: what was made by hand stays where it was made.
    expect((table('GEAR').getByLabelText('Item 2 name') as HTMLInputElement).value).toBe('Pistol');
    expect(table('GEAR').getByText('GEAR · 1')).toBeTruthy();
    fireEvent.change(table('GEAR').getByLabelText('Item 2 quantity'), { target: { value: '3' } });
    fireEvent.change(table('GEAR').getByLabelText('Item 2 carried'), { target: { value: 'stash' } });
    // Stashed, it moves to the STASH band, which opens so the line is still in sight (G2).
    const stashed = within(screen.getByTestId('gear-line-1'));
    fireEvent.change(stashed.getByLabelText('Item 2 location'), { target: { value: 'the van' } });
    expect(last()[1]).toEqual(line('Pistol', { type: 'gear', qty: 3, carry: 'stash', location: 'the van' }));
    await userEvent.click(stashed.getByRole('button', { name: 'DONE' }));
    expect(within(screen.getByTestId('gear-line-1')).getByText('the van')).toBeTruthy();
    expect(within(screen.getByTestId('gear-line-1')).getByText('STASHED')).toBeTruthy();
    // REMOVE is in the card (G3).
    await userEvent.click(within(screen.getByTestId('gear-line-1')).getByRole('button', { name: 'Pistol, item 2' }));
    await userEvent.click(within(screen.getByTestId('gear-line-1')).getByRole('button', { name: 'Remove item 2' }));
    expect(last()).toHaveLength(1);
  });

  it('read only: the words and nothing to change, no card to open, no + or REMOVE', () => {
    // A Rope, with nothing filled in: said only where it could be filled.
    show([line('Pistol'), line('Rope')], { readOnly: true });
    expect(within(screen.getByTestId('gear-line-0')).getByText('Pistol')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /, item \d+$/ })).toBeNull();
    expect((table('WEAPONS').getByLabelText('Item 1 carried') as HTMLSelectElement).disabled).toBe(true);
    expect(note('WEAPONS', 'Item 1 RANGE')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Edit item/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /by hand/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove item/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Fill in/ })).toBeNull();
  });

  it('ROLL beside each DAMAGE (8a3b): its line and column sent; none where there is no DAMAGE; read only, still there', async () => {
    const rolled: [number, string][] = [];
    show([line('Rope'), line('Pistol'), line('A stick', { type: 'weapons', values: { damage: '1d4' } })], { onGearRoll: (l, c) => rolled.push([l, c]) });
    await userEvent.click(table('WEAPONS').getByRole('button', { name: 'Roll Item 2 DAMAGE' }));
    await userEvent.click(table('WEAPONS').getByRole('button', { name: 'Roll Item 3 DAMAGE' }));
    expect(rolled).toEqual([[1, 'damage'], [2, 'damage']]);
    // Only DAMAGE and DICE roll: RANGE has none; the Rope has no DAMAGE, so nothing to roll.
    expect(table('WEAPONS').queryByRole('button', { name: 'Roll Item 2 RANGE' })).toBeNull();
    expect(table('WEAPONS').getByRole('button', { name: 'Roll Item 2 DAMAGE' }).title).toBe('Roll 2d6');
    expect(table('WEAPONS').queryByRole('button', { name: 'Roll Item 1 DAMAGE' })).toBeNull();
    cleanup();
    show([line('Pistol')], { readOnly: true, onGearRoll: () => {} });
    expect(table('WEAPONS').getByRole('button', { name: 'Roll Item 1 DAMAGE' })).toBeTruthy();
    cleanup();
    show([line('Pistol')]);
    expect(table('WEAPONS').queryByRole('button', { name: /^Roll/ })).toBeNull();
  });

  it('a system without types keeps the one list', () => {
    show([line('Pistol')], { items: { slots: [], list: ITEMS.list } });
    expect(screen.queryByRole('region', { name: /gear$/ })).toBeNull();
    expect(screen.getByRole('button', { name: '+ ITEM' })).toBeTruthy();
  });
});

describe('a DAMAGE or DICE under ✎ (8a3c2)', () => {
  const NAMES = [{ token: '@might', label: 'MIGHT' }, { token: '@might_mod', label: 'MIGHT MOD' }];
  /** The server, as it reads: 1d8 + @might_mod is 3 to 10 on this character; @strength isn't a name. */
  const reader = () => {
    const asked: string[] = [];
    const read = async (text: string): Promise<GearDiceRead> => {
      asked.push(text);
      if (text.includes('@strength')) return { ok: false, error: "@strength isn't one of this system's names", names: NAMES };
      if (!text.trim()) return { ok: true, blank: true, names: NAMES };
      return { ok: true, low: 3, high: 10, used: text.includes('@might_mod') ? [{ token: '@might_mod', label: 'Might mod', value: 2 }] : [], names: NAMES };
    };
    return { asked, read };
  };

  it('says what it reads on this character, its item\'s while it has none of its own; a name the system hasn\'t got, flagged', async () => {
    const { asked, read } = reader();
    const last = show([line('Pistol', { values: { damage: '1d8 + @might_mod' } })], { onReadGearDice: read });
    await userEvent.click(table('WEAPONS').getByRole('button', { name: named(1) }));
    const words = () => table('WEAPONS').getByRole('status', { name: 'Item 1 DAMAGE on this character' });
    await waitFor(() => expect(words().textContent).toBe('ON THIS CHARACTER: 1d8 + Might mod (2): 3 to 10'));
    fireEvent.change(table('WEAPONS').getByLabelText('Item 1 DAMAGE'), { target: { value: '1d6 + @strength' } });
    expect(last()[0].values).toMatchObject({ damage: '1d6 + @strength' });
    // Until it is read, never the old text's words.
    expect(words().textContent).toBe('READING IT…');
    await waitFor(() => expect(words().textContent).toBe("@STRENGTH ISN'T ONE OF THIS SYSTEM'S NAMES: IT WON'T ROLL"));
    expect(table('WEAPONS').getByLabelText('Item 1 DAMAGE').getAttribute('aria-invalid')).toBe('true');
    // Cleared: its item's again (the Pistol's 2d6), read as that.
    fireEvent.change(table('WEAPONS').getByLabelText('Item 1 DAMAGE'), { target: { value: '' } });
    await waitFor(() => expect(asked[asked.length - 1]).toBe('2d6'));
    expect(asked).not.toContain('1d6 + @');
  });

  it('eˣ: SHAPE writes one, INSERT puts a name in; a DICE column too; without a reader, the plain box', async () => {
    const { read } = reader();
    const last = show([line('Pistol')], { onReadGearDice: read });
    await userEvent.click(table('WEAPONS').getByRole('button', { name: named(1) }));
    expect(table('WEAPONS').queryByRole('group', { name: 'Help writing Item 1 DAMAGE' })).toBeNull();
    await userEvent.click(table('WEAPONS').getByRole('button', { name: 'Help writing Item 1 DAMAGE' }));
    const help = within(table('WEAPONS').getByRole('group', { name: 'Help writing Item 1 DAMAGE' }));
    // The system's names, once read.
    await help.findByRole('button', { name: /^@might_mod/ });
    await userEvent.click(help.getByRole('button', { name: 'DICE AND A STAT' }));
    await waitFor(() => expect(last()[0].values).toMatchObject({ damage: '1d8 + @might' }));
    await userEvent.click(help.getByRole('button', { name: 'DICE' }));
    expect(last()[0].values).toMatchObject({ damage: '1d6' });
    await userEvent.click(await help.findByRole('button', { name: /^@might_mod/ }));
    expect(last()[0].values).toMatchObject({ damage: '1d6 + @might_mod' });
    cleanup();
    show([line('Pistol')]);
    await userEvent.click(table('WEAPONS').getByRole('button', { name: named(1) }));
    expect(table('WEAPONS').queryByRole('button', { name: 'Help writing Item 1 DAMAGE' })).toBeNull();
    expect(table('WEAPONS').getByLabelText('Item 1 DAMAGE')).toBeTruthy();
  });
});

describe('a COUNT on its line (8a4b; decision 6 of the gear mockup)', () => {
  /** onGearCount, each call kept, answered when the test says. */
  const server = () => {
    const calls: unknown[][] = [];
    let reply: (a: CountAnswer | null) => void = () => {};
    const onGearCount: GearCount = (...args) => { calls.push(args); return new Promise((resolve) => { reply = resolve; }); };
    return { calls, onGearCount, answer: (a: CountAnswer | null) => reply(a) };
  };
  const at = (i: number) => within(screen.getByTestId(`gear-line-${i}`));

  it('"AMMO 4 / 6" with its button and RELOAD beside it; the line and column sent; held while the server answers', async () => {
    const s = server();
    show([line('Rope'), line('Pistol', { counts: { ammo: 4 } })], { onGearCount: s.onGearCount });
    expect(at(1).getByRole('note', { name: 'Item 2 AMMO: 4 / 6' })).toBeTruthy();
    const fire = at(1).getByRole('button', { name: 'FIRE Item 2 AMMO' }) as HTMLButtonElement;
    expect(fire.title).toBe('Use one of the AMMO');
    expect((at(1).getByRole('button', { name: 'Reload Item 2 AMMO' }) as HTMLButtonElement).title).toBe('From Pistol Rounds or AP Rounds you carry');
    await userEvent.click(fire);
    expect(s.calls).toEqual([[1, 'ammo', 'spend', undefined]]);
    // Waiting on the answer: neither again, so a quick second FIRE never spends from a count not yet back.
    expect(fire.disabled).toBe(true);
    expect((at(1).getByRole('button', { name: 'Reload Item 2 AMMO' }) as HTMLButtonElement).disabled).toBe(true);
    s.answer({ ok: true, now: 3, most: 6 });
    await waitFor(() => expect(fire.disabled).toBe(false));
    await userEvent.click(at(1).getByRole('button', { name: 'Reload Item 2 AMMO' }));
    expect(s.calls[1]).toEqual([1, 'ammo', 'reload', undefined]);
  });

  it('none left: no FIRE; full: no RELOAD; refilled only by a rest: no RELOAD at all; a column with no button, USE', () => {
    const items: ItemsShown = { ...ITEMS, list: [...ITEMS.list, { id: 'wand', label: 'Wand', needs: 'carried', features: [], type: 'weapons', values: { charges: 3 } }] };
    show([line('Pistol', { counts: { ammo: 0 } }), line('Pistol'), line('Wand', { counts: { charges: 1 } })], { items, onGearCount: server().onGearCount });
    const empty = at(0).getByRole('button', { name: 'FIRE Item 1 AMMO' }) as HTMLButtonElement;
    expect(empty.disabled).toBe(true);
    expect(empty.title).toBe('No AMMO left');
    expect((at(0).getByRole('button', { name: 'Reload Item 1 AMMO' }) as HTMLButtonElement).disabled).toBe(false);
    const full = at(1).getByRole('button', { name: 'Reload Item 2 AMMO' }) as HTMLButtonElement;
    expect(full.disabled).toBe(true);
    expect(full.title).toBe('The AMMO is full');
    expect(at(2).getByRole('note', { name: 'Item 3 CHARGES: 1 / 3' })).toBeTruthy();
    expect(at(2).getByRole('button', { name: 'USE Item 3 CHARGES' })).toBeTruthy();
    expect(at(2).queryByRole('button', { name: /^Reload/ })).toBeNull();
  });

  it('several carried: RELOAD asks which on the line, each with how many; the one picked sent; CANCEL leaves it', async () => {
    const s = server();
    const ask: CountAnswer = { ok: false, ask: [{ line: 1, name: 'Pistol Rounds', qty: 10 }, { line: 2, name: 'AP Rounds', qty: 2 }] };
    show([line('Pistol', { counts: { ammo: 1 } }), line('Pistol Rounds', { qty: 10 }), line('AP Rounds', { qty: 2 })], { onGearCount: s.onGearCount });
    await userEvent.click(at(0).getByRole('button', { name: 'Reload Item 1 AMMO' }));
    s.answer(ask);
    const which = await waitFor(() => at(0).getByRole('group', { name: 'Item 1 reload AMMO from' }));
    expect(within(which).getByText('RELOAD AMMO FROM')).toBeTruthy();
    // On the line that asked alone, not under the rounds' lines.
    expect(screen.getAllByRole('group', { name: /reload/ })).toHaveLength(1);
    await userEvent.click(within(which).getByRole('button', { name: 'AP Rounds ×2' }));
    expect(s.calls[1]).toEqual([0, 'ammo', 'reload', 2]);
    expect(at(0).queryByRole('group', { name: /reload/ })).toBeNull();
    s.answer({ ok: true, now: 3, most: 6 });
    const again = at(0).getByRole('button', { name: 'Reload Item 1 AMMO' }) as HTMLButtonElement;
    await waitFor(() => expect(again.disabled).toBe(false));
    await userEvent.click(again);
    s.answer(ask);
    await userEvent.click(await waitFor(() => at(0).getByRole('button', { name: 'CANCEL' })));
    expect(at(0).queryByRole('group', { name: /reload/ })).toBeNull();
    expect(s.calls).toHaveLength(3);
  });

  it('a refusal said on the line that asked; no answer said so; gone at the next ask', async () => {
    const s = server();
    show([line('Rope'), line('Pistol', { counts: { ammo: 2 } })], { onGearCount: s.onGearCount });
    await userEvent.click(at(1).getByRole('button', { name: 'Reload Item 2 AMMO' }));
    s.answer({ ok: false, error: 'Nothing carried to reload from: Pistol Rounds or AP Rounds' });
    expect((await waitFor(() => at(1).getByRole('status'))).textContent).toBe('Nothing carried to reload from: Pistol Rounds or AP Rounds');
    expect(at(0).queryByRole('status')).toBeNull();
    await userEvent.click(at(1).getByRole('button', { name: 'FIRE Item 2 AMMO' }));
    expect(at(1).queryByRole('status')).toBeNull();
    s.answer(null);
    expect((await waitFor(() => at(1).getByRole('status'))).textContent).toBe('No answer from the server: try again');
  });

  it('no FIRE or RELOAD where the sheet can\'t send them; the count still in words', () => {
    show([line('Pistol', { counts: { ammo: 4 } })]);
    expect(at(0).getByRole('note', { name: 'Item 1 AMMO: 4 / 6' })).toBeTruthy();
    expect(at(0).queryByRole('button', { name: /AMMO$/ })).toBeNull();
  });
});

describe('in bands (G2)', () => {
  // WEAPONS EQUIPPED, POTIONS USABLE, GEAR unsaid (PACK).
  const BANDED: ItemsShown = {
    slots: [], list: [],
    types: [
      { id: 'weapons', label: 'WEAPONS', one: 'Weapon', on_sheet: 'equipped', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }] },
      { id: 'potions', label: 'POTIONS', one: 'Potion', on_sheet: 'usable', columns: [] },
      { id: 'gear', label: 'GEAR', one: 'Gear', columns: [] },
    ],
  };
  const typed = (name: string, type: string, more = {}) => line(name, { type, ...more });
  const band = (label: string) => screen.getByRole('region', { name: `${label} band` });
  const head = (label: string) => within(band(label)).getByRole('button', { name: new RegExp(`^[▸▾] ${label} · \\d+$`) });

  it('EQUIPPED, USABLE, PACK and STASH in order, each counted; a type\'s lines in its band, in hand first; STASH closed', () => {
    show([typed('Rope', 'gear'), typed('Sword', 'weapons'), typed('Pistol', 'weapons', { carry: 'readied' }), typed('Draught', 'potions'), typed('Spare Sword', 'weapons', { carry: 'stash' })], { items: BANDED });
    expect(screen.getAllByRole('button', { name: /^[▸▾] [A-Z]+ · \d+$/ }).map((b) => b.textContent)).toEqual(['▾ EQUIPPED · 2', '▾ USABLE · 1', '▾ PACK · 1', '▸ STASH · 1']);
    expect(within(band('EQUIPPED')).getAllByRole('button', { name: /, item \d+$/ }).map((b) => b.textContent)).toEqual(['Pistol', 'Sword']);
    expect(within(band('USABLE')).getByRole('region', { name: 'POTIONS gear' })).toBeTruthy();
    // POTIONS has no columns: nothing to fill in, so no FILL IN (G3).
    expect(within(band('USABLE')).queryByRole('button', { name: /^Fill in/ })).toBeNull();
    expect(within(band('PACK')).getByRole('region', { name: 'GEAR gear' })).toBeTruthy();
    expect(head('STASH').getAttribute('aria-expanded')).toBe('false');
    expect(within(band('STASH')).queryByRole('button', { name: /, item \d+$/ })).toBeNull();
  });

  it('a head closes and opens its band, remembered; the STASH says each line\'s type; an empty band says so', async () => {
    show([typed('Sword', 'weapons'), typed('Spare Sword', 'weapons', { carry: 'stash' })], { items: BANDED });
    await userEvent.click(head('STASH'));
    expect(head('STASH').getAttribute('aria-expanded')).toBe('true');
    expect(within(band('STASH')).getByText('WEAPONS')).toBeTruthy();
    expect(within(band('STASH')).getByRole('button', { name: 'Spare Sword, item 2' })).toBeTruthy();
    expect(within(band('USABLE')).getByText('Nothing here.')).toBeTruthy();
    await userEvent.click(head('EQUIPPED'));
    expect(within(band('EQUIPPED')).queryByRole('button', { name: 'Sword, item 1' })).toBeNull();
    // Shown again, as left.
    cleanup();
    show([typed('Sword', 'weapons'), typed('Spare Sword', 'weapons', { carry: 'stash' })], { items: BANDED });
    expect(head('EQUIPPED').getAttribute('aria-expanded')).toBe('false');
    expect(head('STASH').getAttribute('aria-expanded')).toBe('true');
  });

  it('a thing worn is EQUIPPED though its type is PACK (G3): the Cutlass, as the user found it', () => {
    const items: ItemsShown = { ...BANDED, list: [{ id: 'cutlass', label: 'Cutlass', needs: 'worn', features: [], type: 'gear', values: {} }] };
    show([typed('Cutlass', 'gear'), typed('Rope', 'gear')], { items, worked: { items: [{ id: 'cutlass', needs: 'worn', worn: true }] } });
    expect(within(band('EQUIPPED')).getByRole('button', { name: 'Cutlass, item 1' })).toBeTruthy();
    expect(within(band('PACK')).getByRole('button', { name: 'Rope, item 2' })).toBeTruthy();
    expect(head('EQUIPPED').textContent).toBe('▾ EQUIPPED · 1');
    cleanup();
    // Taken off: back in its type's band.
    show([typed('Cutlass', 'gear'), typed('Rope', 'gear')], { items, worked: { items: [{ id: 'cutlass', needs: 'worn' }] } });
    expect(within(band('PACK')).getByRole('button', { name: 'Cutlass, item 1' })).toBeTruthy();
  });

  it('something landing in a closed band: its head bright with a pulse until opened; not on opening the sheet, not in an open band', async () => {
    const items: ItemsShown = { ...BANDED, list: [{ id: 'cutlass', label: 'Cutlass', needs: 'worn', features: [], type: 'gear', values: {} }] };
    show([typed('Cutlass', 'gear'), typed('Rope', 'gear'), typed('Old Map', 'gear', { carry: 'stash' })], { items });
    // Opening the sheet: STASH closed with a line in it, nothing new.
    expect(head('STASH').className).toBe('');
    await userEvent.click(head('EQUIPPED'));
    // The Cutlass worn, by the server: EQUIPPED is closed, so it says so.
    act(() => outside.set({ _worked: { items: [{ id: 'cutlass', needs: 'worn', worn: true }] } }));
    expect(head('EQUIPPED').textContent).toBe('▸ EQUIPPED · 1');
    expect(head('EQUIPPED').className).toBe('gear-band-news');
    expect(head('EQUIPPED').title).toBe('Something new landed here: open to see');
    // Lit after the pulse, a tint of the theme's own color behind it.
    expect(head('EQUIPPED').style.background).toContain('var(--green) 20%');
    expect(head('PACK').style.background).toBe('none');
    // PACK, open, lost one: nothing.
    expect(head('PACK').className).toBe('');
    // Opened: seen; closed again, nothing new.
    await userEvent.click(head('EQUIPPED'));
    expect(head('EQUIPPED').className).toBe('');
    await userEvent.click(head('EQUIPPED'));
    expect(head('EQUIPPED').className).toBe('');
    expect(head('EQUIPPED').title).toBe('Open');
  });

  it('a thing made by hand opens its band if closed', async () => {
    show([typed('Sword', 'weapons')], { items: BANDED });
    await userEvent.click(head('EQUIPPED'));
    await userEvent.click(within(screen.getByRole('group', { name: 'Add by hand' })).getByRole('button', { name: 'Add a Weapon by hand' }));
    expect(head('EQUIPPED').getAttribute('aria-expanded')).toBe('true');
    expect(within(band('EQUIPPED')).getByLabelText('Item 2 name')).toBeTruthy();
    // Opened by the player's own hand: nothing to catch the eye.
    expect(head('EQUIPPED').className).toBe('');
  });
});

describe('one line a thing, its card on a click (G3)', () => {
  const at = (i: number) => within(screen.getByTestId(`gear-line-${i}`));

  it('a click on the line opens its card: NAME, HOW MANY, every column, LOCATION, REMOVE; its own buttons and where it is carried don\'t', async () => {
    const rolled: number[] = [];
    show([line('Pistol', { qty: 2 }), line('A stick', { type: 'weapons', values: { damage: '1d4' } })], { onGearRoll: (l) => rolled.push(l) });
    // On the line: its name, how many where more than one, its columns as words, where it is carried; no boxes.
    expect(at(0).getByText('×2')).toBeTruthy();
    expect(at(1).queryByText(/^×/)).toBeNull();
    expect(at(0).queryByLabelText('Item 1 name')).toBeNull();
    expect(at(0).queryByRole('button', { name: 'Remove item 1' })).toBeNull();
    // ROLL and the carried box do their own thing.
    await userEvent.click(at(0).getByRole('button', { name: 'Roll Item 1 DAMAGE' }));
    fireEvent.click(at(0).getByLabelText('Item 1 carried'));
    expect(rolled).toEqual([0]);
    expect(at(0).queryByRole('group', { name: 'Item 1 columns' })).toBeNull();
    // Anywhere else on the line opens it.
    await userEvent.click(at(0).getByText('30 m'));
    const card = within(at(0).getByRole('group', { name: 'Item 1 columns' }));
    expect([...card.getAllByRole('textbox'), ...card.getAllByRole('spinbutton'), ...card.getAllByRole('combobox')].map((b) => b.getAttribute('aria-label')))
      .toEqual(['Item 1 name', 'Item 1 DAMAGE', 'Item 1 RANGE', 'Item 1 location', 'Item 1 quantity', 'Item 1 AMMO', 'Item 1 WEIGHT', 'Item 1 CHARGES', 'Item 1 GRADE']);
    expect((card.getByLabelText('Item 1 quantity') as HTMLInputElement).value).toBe('2');
    expect(card.getByRole('button', { name: 'Remove item 1' })).toBeTruthy();
    // Another line's opens it and closes this one; its name again closes it.
    await userEvent.click(at(1).getByRole('button', { name: 'A stick, item 2' }));
    expect(at(0).queryByRole('group', { name: 'Item 1 columns' })).toBeNull();
    expect(at(1).getByRole('group', { name: 'Item 2 columns' })).toBeTruthy();
    await userEvent.click(at(1).getByRole('button', { name: 'A stick, item 2' }));
    expect(at(1).queryByRole('group', { name: 'Item 2 columns' })).toBeNull();
  });

  it('FILL IN only where nothing is filled in, naming the columns, opening the card at the first, its box ready; none while open', async () => {
    const items: ItemsShown = { ...ITEMS, list: [...ITEMS.list, { id: 'rope', label: 'Rope', needs: 'carried', features: [], type: 'gear', values: { weight: 5 } }] };
    show([line('Pistol'), line('Rope', { type: 'gear' }), line('', { type: 'gear' }), line('Knife', { type: 'weapons' })], { items });
    // The Pistol's item has every column but CHARGES: a blank beside others filled doesn't apply, so no FILL IN (2026-11-22).
    expect(at(0).queryByRole('button', { name: /^Fill in/ })).toBeNull();
    // The Rope's item has its WEIGHT: nothing blank.
    expect(at(1).queryByRole('button', { name: /^Fill in/ })).toBeNull();
    // A line with no name says so.
    expect(at(2).getByRole('button', { name: 'UNNAMED, item 3' })).toBeTruthy();
    // A Knife made by hand, nothing filled in.
    const fill = at(3).getByRole('button', { name: 'Fill in item 4: DAMAGE, RANGE, AMMO, WEIGHT, CHARGES, GRADE' });
    expect(fill.title).toBe('Blank: DAMAGE, RANGE, AMMO, WEIGHT, CHARGES, GRADE');
    await userEvent.click(fill);
    expect(document.activeElement).toBe(at(3).getByLabelText('Item 4 DAMAGE'));
    expect(at(3).queryByRole('button', { name: /^Fill in/ })).toBeNull();
    // A line's own value fills it.
    await userEvent.click(at(2).getByRole('button', { name: 'Fill in item 3: WEIGHT' }));
    fireEvent.change(at(2).getByLabelText('Item 3 WEIGHT'), { target: { value: '1' } });
    await userEvent.click(at(2).getByRole('button', { name: 'DONE' }));
    expect(at(2).queryByRole('button', { name: /^Fill in/ })).toBeNull();
  });

  it('FILL IN at a blank DAMAGE, read as dice: that box ready to type', async () => {
    show([line('Knife', { type: 'weapons' })], { onReadGearDice: async () => ({ ok: true, blank: true, names: [] }) });
    await userEvent.click(at(0).getByRole('button', { name: /^Fill in item 1: DAMAGE/ }));
    expect(document.activeElement).toBe(at(0).getByLabelText('Item 1 DAMAGE'));
  });

  it('✎ at the end of every line opens its card and closes it, as the line does; none read only', async () => {
    show([line('Pistol'), line('Rope', { type: 'gear' })]);
    const pencil = at(0).getByRole('button', { name: 'Edit item 1' });
    expect(pencil.textContent).toBe('✎');
    expect(at(1).getByRole('button', { name: 'Edit item 2' })).toBeTruthy();
    await userEvent.click(pencil);
    expect(pencil.getAttribute('aria-expanded')).toBe('true');
    expect(at(0).getByRole('group', { name: 'Item 1 columns' })).toBeTruthy();
    await userEvent.click(pencil);
    expect(at(0).queryByRole('group', { name: 'Item 1 columns' })).toBeNull();
    cleanup();
    show([line('Pistol')], { readOnly: true });
    expect(screen.queryByRole('button', { name: /^Edit item/ })).toBeNull();
  });

  it('a PICK ONE box as wide as its words, a number box 90 wide', async () => {
    show([line('Pistol')]);
    await userEvent.click(screen.getByRole('button', { name: named(1) }));
    expect((screen.getByLabelText('Item 1 GRADE') as HTMLSelectElement).style.width).toBe('auto');
    expect((screen.getByLabelText('Item 1 WEIGHT') as HTMLInputElement).style.width).toBe('90px');
    expect((screen.getByLabelText('Item 1 RANGE') as HTMLInputElement).style.width).toBe('100%');
  });
});

describe('FIND on GEAR (G4)', () => {
  const TYPES: ItemsShown = {
    slots: [], list: [],
    types: [
      { id: 'weapons', label: 'WEAPONS', one: 'Weapon', on_sheet: 'equipped', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }] },
      { id: 'gear', label: 'GEAR', one: 'Gear', columns: [] },
    ],
  };
  const lines = [line('Sword', { type: 'weapons', values: { damage: '1d8' } }), line('Rope', { type: 'gear' }), line('Spare Sword', { type: 'weapons', carry: 'stash', values: { damage: '1d8' } })];
  const box = () => screen.getByRole('searchbox', { name: 'Find in your gear' }) as HTMLInputElement;
  const band = (label: string) => screen.getByRole('region', { name: `${label} band` });
  const head = (label: string) => within(band(label)).getByRole('button', { name: new RegExp(`^[▸▾] ${label} · \\d+$`) });

  it('always there; as you type only what matches, counted, every band open; cleared, as left', async () => {
    show(lines, { items: TYPES });
    expect(box().placeholder).toBe('Find on your sheet: a name, a type, 2d6, AMMO…');
    expect(head('STASH').textContent).toBe('▸ STASH · 1');
    await userEvent.type(box(), 'sword');
    expect(screen.getAllByRole('button', { name: /^[▸▾] [A-Z]+ · \d+$/ }).map((b) => b.textContent)).toEqual(['▾ EQUIPPED · 1', '▾ USABLE · 0', '▾ PACK · 0', '▾ STASH · 1']);
    expect(within(band('STASH')).getByRole('button', { name: 'Spare Sword, item 3' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rope, item 2' })).toBeNull();
    // A band with no match: its · 0 alone, no "Nothing here." under it.
    expect(within(band('PACK')).queryByText('Nothing here.')).toBeNull();
    // Heads can't open or close while it shows what it found, but stay readable (not disabled, which is drawn faint).
    expect(head('STASH').getAttribute('aria-disabled')).toBe('true');
    expect((head('STASH') as HTMLButtonElement).disabled).toBe(false);
    expect(head('STASH').title).toBe('Showing what FIND matched: clear it to open or close bands');
    await userEvent.click(head('STASH'));
    // Its own × clears it.
    await userEvent.click(screen.getByRole('button', { name: 'Clear FIND' }));
    expect(box().value).toBe('');
    expect(screen.queryByRole('button', { name: 'Clear FIND' })).toBeNull();
    // As left: the click while finding changed nothing.
    expect(head('STASH').textContent).toBe('▸ STASH · 1');
    expect(head('STASH').getAttribute('aria-disabled')).toBeNull();
    expect(within(band('USABLE')).getByText('Nothing here.')).toBeTruthy();
    // Esc clears it too.
    await userEvent.type(box(), 'rope{Escape}');
    expect(box().value).toBe('');
    expect(screen.getByRole('button', { name: 'Rope, item 2' })).toBeTruthy();
    // Cleared, nothing lit: nothing landed anywhere.
    expect(screen.getAllByRole('button', { name: /^[▸▾] [A-Z]+ · \d+$/ }).filter((b) => b.className)).toEqual([]);
  });

  it('by a value and a column; nothing found says so, with no bands; read only too', async () => {
    show(lines, { items: TYPES, readOnly: true });
    await userEvent.type(box(), 'damage 1d8');
    expect(head('EQUIPPED').textContent).toBe('▾ EQUIPPED · 1');
    expect(head('STASH').textContent).toBe('▾ STASH · 1');
    await userEvent.clear(box());
    await userEvent.type(box(), 'lantern');
    expect(screen.getByRole('status', { name: 'What FIND found' }).textContent).toBe('Nothing on this sheet matches \u201clantern\u201d.');
    expect(screen.queryByRole('region', { name: /band$/ })).toBeNull();
  });
});

describe('the slot and install counters (2026-11-22)', () => {
  const COUNTED: ItemsShown = {
    slots: [{ id: 'attuned', label: 'Attuned', count: 3 }],
    installs: [{ id: 'cyberware', label: 'Cyberware', against: 'Strain', way: 'adds' }],
    list: [{ id: 'ring', label: 'Ring', needs: 'attuned', features: [], type: 'gear' }, { id: 'jack', label: 'Jack', needs: 'cyberware', features: [], type: 'gear' }],
    types: [{ id: 'gear', label: 'GEAR', one: 'Gear', columns: [] }],
  };
  const counters = () => [...screen.queryAllByRole('group', { name: / slots$/ }), ...screen.queryAllByRole('group', { name: / installs$/ })].map((g) => g.getAttribute('aria-label'));

  it('only those something on the sheet uses: none for a sheet of rope, the slot with a ring, the install with a jack', () => {
    show([line('Rope', { type: 'gear' })], { items: COUNTED });
    expect(counters()).toEqual([]);
    cleanup();
    show([line('Rope', { type: 'gear' }), line('Ring', { type: 'gear' })], { items: COUNTED });
    expect(counters()).toEqual(['ATTUNED slots']);
    cleanup();
    show([line('Jack', { type: 'gear' })], { items: COUNTED, worked: { items: [], slots: [], installs: [{ id: 'cyberware', used: 0, value: 0, limit: 2 }] } });
    expect(counters()).toEqual(['CYBERWARE installs']);
  });
});

describe('UNIQUE on the line and in its card (G5b)', () => {
  const AT = '2026-11-20T10:00:00.000Z';
  const at = (i: number) => within(screen.getByTestId(`gear-line-${i}`));
  // ITEMS' Pistol: DAMAGE 2d6, RANGE 30 m.
  const made = line('Pistol', { values: { damage: '3d6' }, changed: { damage: { by: 'kes', at: AT } } });

  it('the line says UNIQUE, the item\'s and who changed it on hover; a Pistol as the item has it says nothing', () => {
    show([made, line('Pistol')]);
    const tag = at(0).getByRole('note', { name: 'Item 1 is unique' });
    expect(tag.textContent).toBe('UNIQUE');
    expect(tag.title).toBe("Unique: changed from its item\nDAMAGE 3d6, the item's: 2d6 · changed by kes, 2026-11-20");
    expect(at(1).queryByRole('note', { name: 'Item 2 is unique' })).toBeNull();
  });

  it('in the card, each column made its own: UNIQUE, what the item had, who changed it; THE ITEM\'S puts it back', async () => {
    const last = show([made]);
    await userEvent.click(at(0).getByRole('button', { name: 'Edit item 1' }));
    const damage = within(at(0).getByRole('group', { name: 'Item 1 DAMAGE is unique' }));
    expect(damage.getByText("the item's: 2d6 · changed by kes, 2026-11-20")).toBeTruthy();
    // RANGE is the item's: nothing said of it.
    expect(at(0).queryByRole('group', { name: 'Item 1 RANGE is unique' })).toBeNull();
    await userEvent.click(damage.getByRole('button', { name: "Item 1 DAMAGE: the item's" }));
    expect(last()[0].values).toBeUndefined();
    expect(at(0).queryByRole('note', { name: 'Item 1 is unique' })).toBeNull();
    expect(at(0).queryByRole('group', { name: 'Item 1 DAMAGE is unique' })).toBeNull();
  });

  it('"unique" in FIND lists them; no count at the top (the user: FIND is enough)', async () => {
    show([made, line('Rope'), line('Pistol', { values: { range: '50 m' } })]);
    expect(screen.queryByRole('button', { name: /UNIQUE$/ })).toBeNull();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Find in your gear' }), 'unique');
    expect(screen.getByRole('button', { name: 'Pistol, item 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pistol, item 3' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rope, item 2' })).toBeNull();
  });
});

describe('PLAYERS CHANGE GEAR off, for a player (G6b)', () => {
  const at = (i: number) => within(screen.getByTestId(`gear-line-${i}`));
  const read = async () => ({ ok: true as const, blank: true as const, names: [] });

  it('the card shows every column without changing it, said once; no eˣ, THE ITEM\'S or FILL IN; name, how many and REMOVE still theirs', async () => {
    const made = line('Pistol', { values: { damage: '3d6' } });
    show([made, line('Knife', { type: 'weapons' })], { columnsLocked: true, onReadGearDice: read });
    // Nothing filled in on the Knife, but nothing to fill either.
    expect(at(1).queryByRole('button', { name: /^Fill in/ })).toBeNull();
    await userEvent.click(at(0).getByRole('button', { name: 'Edit item 1' }));
    const card = within(at(0).getByRole('group', { name: 'Item 1 columns' }));
    expect(card.getByRole('note', { name: 'Item 1 columns' }).textContent).toBe('ONLY THE GM CHANGES THESE AT THIS TABLE');
    expect((card.getByLabelText('Item 1 DAMAGE') as HTMLInputElement).readOnly).toBe(true);
    expect(card.queryByRole('button', { name: 'Help writing Item 1 DAMAGE' })).toBeNull();
    expect((card.getByLabelText('Item 1 RANGE') as HTMLInputElement).readOnly).toBe(true);
    expect((card.getByLabelText('Item 1 GRADE') as HTMLSelectElement).disabled).toBe(true);
    // Still UNIQUE, with what the item had; nothing to put it back with.
    expect(card.getByRole('group', { name: 'Item 1 DAMAGE is unique' })).toBeTruthy();
    expect(card.queryByRole('button', { name: "Item 1 DAMAGE: the item's" })).toBeNull();
    expect((card.getByLabelText('Item 1 name') as HTMLInputElement).readOnly).toBe(false);
    expect((card.getByLabelText('Item 1 quantity') as HTMLInputElement).readOnly).toBe(false);
    expect(card.getByRole('button', { name: 'Remove item 1' })).toBeTruthy();
  });

  it('on: none of that; a type with no columns says nothing either', async () => {
    show([line('Pistol')], { onReadGearDice: read });
    await userEvent.click(at(0).getByRole('button', { name: 'Edit item 1' }));
    expect(at(0).queryByRole('note', { name: 'Item 1 columns' })).toBeNull();
    expect(at(0).getByRole('button', { name: 'Help writing Item 1 DAMAGE' })).toBeTruthy();
    cleanup();
    const bare: ItemsShown = { slots: [], list: [], types: [{ id: 'gear', label: 'GEAR', one: 'Gear', columns: [] }] };
    show([line('Rope', { type: 'gear' })], { items: bare, columnsLocked: true });
    await userEvent.click(at(0).getByRole('button', { name: 'Edit item 1' }));
    expect(at(0).queryByRole('note', { name: 'Item 1 columns' })).toBeNull();
  });
});

describe('a DAMAGE as rows under ✎ (8b2c)', () => {
  const TYPED: ItemsShown = {
    ...ITEMS,
    types: [{ ...ITEMS.types![0], columns: ITEMS.types![0].columns.map((c) => (c.id === 'damage' ? { ...c, usual: 'COLD' } : c)) }, ITEMS.types![1]],
    damage_types: [{ id: 'fire', name: 'Fire', icon: 'flame' }, { id: 'cold', name: 'Cold', icon: 'snow' }, { id: 'slashing', name: 'Slashing', icon: 'blade' }],
  };
  const reads: string[] = [];
  const onRead = async (text: string): Promise<GearDiceRead> => { reads.push(text); return { ok: true, low: 3, high: 16, used: [], names: [] }; };
  const open = (i: number) => userEvent.click(table('WEAPONS').getByRole('button', { name: named(i) }));
  const parts = (i: number) => within(table('WEAPONS').getByRole('group', { name: `Item ${i} DAMAGE parts` }));
  const damageOf = (last: () => Record<string, unknown>[], i: number) => (last()[i] as { values?: { damage?: string } }).values?.damage;

  it('the item\'s faint in the first part until typed over; a TYPE picked and dice typed, kept as the text ROLL reads', async () => {
    const last = show([line('Pistol')], { items: TYPED, onReadGearDice: onRead });
    await open(1);
    const box = parts(1).getByRole('textbox', { name: 'Item 1 DAMAGE' }) as HTMLInputElement;
    expect([box.value, box.placeholder]).toEqual(['', '2d6']);
    // Its words read the item's, as ROLL would.
    await waitFor(() => expect(reads).toContain('2d6'));
    fireEvent.change(parts(1).getByRole('combobox', { name: 'Item 1 DAMAGE type' }), { target: { value: 'fire' } });
    fireEvent.change(box, { target: { value: '1d8' } });
    expect(damageOf(last, 0)).toBe('1d8 FIRE DMG');
  });

  /** The type picker's chosen words. */
  const chosen = (el: HTMLElement) => (el as HTMLSelectElement).selectedOptions[0].textContent;

  it('a line using its item\'s typed dice: the item\'s type shown, faint and said to be the item\'s; dice typed keep it (found 2026-11-25)', async () => {
    // Before, it said NO TYPE (or the column's MOST LINES ARE) though the item's dice were SLASHING, and dice typed lost it.
    const items: ItemsShown = { ...TYPED, list: [...TYPED.list, { id: 'saber', label: 'Saber', needs: 'carried', features: [], type: 'weapons', values: { damage: '1d8 SLASHING DMG' } }] };
    const last = show([line('Saber')], { items, onReadGearDice: onRead });
    await open(1);
    const picker = parts(1).getByRole('combobox', { name: 'Item 1 DAMAGE type' }) as HTMLSelectElement;
    expect(picker.value).toBe('slashing');
    expect(chosen(picker)).toBe('SLASHING');
    // Said beside the picker, which a card's narrow one would cut short.
    expect(parts(1).getByRole('note', { name: "Item 1 DAMAGE type is the item's" }).textContent).toBe("THE ITEM'S");
    expect(picker.style.color).toBe('color-mix(in srgb, var(--green) 55%, transparent)');
    expect(picker.title).toBe("The item's, until this line has its own");
    fireEvent.change(parts(1).getByRole('textbox', { name: 'Item 1 DAMAGE' }), { target: { value: '1d6' } });
    expect(damageOf(last, 0)).toBe('1d6 SLASHING DMG');
    // Its own now: said plainly.
    const own = parts(1).getByRole('combobox', { name: 'Item 1 DAMAGE type' }) as HTMLSelectElement;
    expect(chosen(own)).toBe('SLASHING');
    expect(parts(1).queryByRole('note', { name: "Item 1 DAMAGE type is the item's" })).toBeNull();
    expect(own.style.color).toBe('var(--green)');
    expect(own.title).toBe('');
  });

  it('an item\'s dice with no type: NO TYPE, the item\'s, not MOST LINES ARE; several parts: THE ITEM\'S', async () => {
    const last = show([line('Pistol')], { items: TYPED, onReadGearDice: onRead });
    await open(1);
    const picker = parts(1).getByRole('combobox', { name: 'Item 1 DAMAGE type' }) as HTMLSelectElement;
    expect(picker.value).toBe('');
    expect(chosen(picker)).toBe('NO TYPE');
    expect(parts(1).getByRole('note', { name: "Item 1 DAMAGE type is the item's" })).toBeTruthy();
    fireEvent.change(parts(1).getByRole('textbox', { name: 'Item 1 DAMAGE' }), { target: { value: '1d8' } });
    expect(damageOf(last, 0)).toBe('1d8');
    cleanup();
    const items: ItemsShown = { ...TYPED, list: [...TYPED.list, { id: 'tongue', label: 'Flame Tongue', needs: 'carried', features: [], type: 'weapons', values: { damage: '1d8 SLASHING + 2d6 FIRE DMG' } }] };
    show([line('Flame Tongue')], { items, onReadGearDice: onRead });
    await open(1);
    const several = parts(1).getByRole('combobox', { name: 'Item 1 DAMAGE type' }) as HTMLSelectElement;
    expect([several.value, chosen(several)]).toEqual(['', "THE ITEM'S"]);
    expect(parts(1).queryByRole('note', { name: "Item 1 DAMAGE type is the item's" })).toBeNull();
    // A type picked before any dice: the line's own, said plainly.
    fireEvent.change(several, { target: { value: 'fire' } });
    expect(chosen(parts(1).getByRole('combobox', { name: 'Item 1 DAMAGE type' }))).toBe('FIRE');
    // Its own now: NO TYPE is NO TYPE again.
    expect(parts(1).getByRole('combobox', { name: 'Item 1 DAMAGE type' }).querySelector('option[value=""]')!.textContent).toBe('NO TYPE');
  });

  it('+ PART, its own eˣ, ×; IN ALL under several, read on this character', async () => {
    const last = show([line('Torch', { type: 'weapons', values: { damage: '2d6 FIRE DMG' } })], { items: TYPED, onReadGearDice: onRead });
    await open(1);
    await userEvent.click(parts(1).getByRole('button', { name: 'Add a part to Item 1 DAMAGE' }));
    // A new part takes the column's MOST LINES ARE.
    expect((parts(1).getByRole('combobox', { name: 'Item 1 DAMAGE part 2 type' }) as HTMLSelectElement).value).toBe('cold');
    fireEvent.change(parts(1).getByRole('textbox', { name: 'Item 1 DAMAGE part 2' }), { target: { value: '1d4' } });
    expect(damageOf(last, 0)).toBe('2d6 FIRE + 1d4 COLD DMG');
    expect(parts(1).getByRole('button', { name: 'Help writing Item 1 DAMAGE part 2' })).toBeTruthy();
    // Its words under the row of its box and TYPE, not beside the TYPE (8b2c: they wrapped there).
    const picker = parts(1).getByRole('combobox', { name: 'Item 1 DAMAGE part 2 type' });
    const words = parts(1).getByRole('status', { name: 'Item 1 DAMAGE part 2 on this character' });
    const boxRow = picker.parentElement!.parentElement!;
    expect(boxRow.contains(parts(1).getByRole('textbox', { name: 'Item 1 DAMAGE part 2' }))).toBe(true);
    expect(boxRow.contains(words)).toBe(false);
    expect(boxRow.parentElement!.contains(words)).toBe(true);
    expect((await parts(1).findByRole('status', { name: 'Item 1 DAMAGE in all' })).textContent).toBe('IN ALL: 3 to 16');
    expect(reads).toContain('2d6 FIRE + 1d4 COLD DMG');
    await userEvent.click(parts(1).getByRole('button', { name: 'Remove Item 1 DAMAGE' }));
    expect(damageOf(last, 0)).toBe('1d4 COLD DMG');
    // One part: no IN ALL, even once a reading could have come.
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    expect(parts(1).queryByRole('status', { name: 'Item 1 DAMAGE in all' })).toBeNull();
    // The sheet's size: its pickers small, as a gear card's boxes.
    expect((parts(1).getByRole('combobox', { name: 'Item 1 DAMAGE type' }) as HTMLSelectElement).style.fontSize).toBe('0.6rem');
  });

  it('a line made by hand starts as MOST LINES ARE; a word that is no type, one box; a DICE, one box', async () => {
    show([line('Wand', { type: 'weapons', values: { damage: '2d6 sonic' } })], { items: TYPED, onReadGearDice: onRead });
    await open(1);
    expect(table('WEAPONS').queryByRole('group', { name: 'Item 1 DAMAGE parts' })).toBeNull();
    expect((table('WEAPONS').getByRole('textbox', { name: 'Item 1 DAMAGE' }) as HTMLInputElement).value).toBe('2d6 sonic');
    cleanup();
    show([], { items: TYPED, onReadGearDice: onRead });
    await userEvent.click(within(screen.getByRole('group', { name: 'Add by hand' })).getByRole('button', { name: 'Add a Weapon by hand' }));
    expect((parts(1).getByRole('combobox', { name: 'Item 1 DAMAGE type' }) as HTMLSelectElement).value).toBe('cold');
  });

  it('a DICE column stays one box; a whole that won\'t read says no IN ALL', async () => {
    const withHeals: ItemsShown = { ...TYPED, types: [{ ...TYPED.types![0], columns: [...TYPED.types![0].columns, { id: 'heals', label: 'HEALS', kind: 'dice' }] }, TYPED.types![1]] };
    const refuses = async (text: string): Promise<GearDiceRead> => (text.includes('+') ? { ok: false, error: 'Nope', names: [] } : { ok: true, low: 1, high: 6, used: [], names: [] });
    show([line('Torch', { type: 'weapons', values: { damage: '1d6 FIRE + 1d4 COLD DMG', heals: '1d4' } })], { items: withHeals, onReadGearDice: refuses });
    await open(1);
    expect(table('WEAPONS').queryByRole('group', { name: 'Item 1 HEALS parts' })).toBeNull();
    expect((table('WEAPONS').getByRole('textbox', { name: 'Item 1 HEALS' }) as HTMLInputElement).value).toBe('1d4');
    expect(parts(1).getByRole('textbox', { name: 'Item 1 DAMAGE part 2' })).toBeTruthy();
    await act(async () => { await new Promise((r) => setTimeout(r, 450)); });
    expect(parts(1).queryByRole('status', { name: 'Item 1 DAMAGE in all' })).toBeNull();
  });

  it('columns locked: shown, never changed; a game without damage types, the one box as before', async () => {
    show([line('Torch', { type: 'weapons', values: { damage: '2d6 FIRE DMG' } })], { items: TYPED, onReadGearDice: onRead, columnsLocked: true });
    await open(1);
    expect((parts(1).getByRole('combobox', { name: 'Item 1 DAMAGE type' }) as HTMLSelectElement).disabled).toBe(true);
    expect(parts(1).queryByRole('button', { name: 'Add a part to Item 1 DAMAGE' })).toBeNull();
    cleanup();
    show([line('Torch', { type: 'weapons', values: { damage: '2d6 FIRE DMG' } })], { onReadGearDice: onRead });
    await open(1);
    expect(table('WEAPONS').queryByRole('group', { name: 'Item 1 DAMAGE parts' })).toBeNull();
    expect((table('WEAPONS').getByRole('textbox', { name: 'Item 1 DAMAGE' }) as HTMLInputElement).value).toBe('2d6 FIRE DMG');
  });
});

describe('the numbers worked out on the character (8e1; mockup gear-table, answered 2026-11-25)', () => {
  const TYPED: ItemsShown = {
    ...ITEMS,
    list: [
      ...ITEMS.list,
      { id: 'striker', label: 'Bone Striker', needs: 'carried', features: [], type: 'weapons', values: { damage: '1d8 + @str_mod + 3 SLASHING DMG' } },
      { id: 'javelin', label: 'Javelin', needs: 'carried', features: [], type: 'weapons', values: { damage: '1d6 + @str_mod PIERCING + 4d6 LIGHTNING DMG' } },
    ],
    damage_types: [{ id: 'slashing', name: 'Slashing', icon: 'blade' }, { id: 'piercing', name: 'Piercing', icon: 'point' }, { id: 'lightning', name: 'Lightning', icon: 'bolt' }],
  };
  const ok = (low: number, high: number, worked: unknown, used: { token: string; label: string; value: number }[] = []): GearDiceRead =>
    ({ ok: true, low, high, used, names: [], worked } as GearDiceRead);
  /** The server's answers, by text; each asking kept. */
  const server = (answers: Record<string, GearDiceRead>) => {
    const asked: string[][] = [];
    return { asked, read: async (texts: string[]) => { asked.push(texts); return texts.map((t) => answers[t] ?? { ok: false, error: 'Nothing to roll' }); } };
  };
  const ANSWERS: Record<string, GearDiceRead> = {
    '2d6': ok(2, 12, [{ dice: [{ count: 2, sides: 6 }], add: 0, type: null }]),
    '1d8 + @str_mod + 3 SLASHING DMG': ok(8, 15, [{ dice: [{ count: 1, sides: 8 }], add: 7, type: 'SLASHING' }], [{ token: '@str_mod', label: 'STR mod', value: 4 }]),
    '1d6 + @str_mod PIERCING + 4d6 LIGHTNING DMG': ok(9, 34, [{ dice: [{ count: 1, sides: 6 }], add: 4, type: 'PIERCING' }, { dice: [{ count: 4, sides: 6 }], add: 0, type: 'LIGHTNING' }]),
    '1d20 + @str_mod': ok(5, 24, [{ dice: [{ count: 1, sides: 20 }], add: 4, type: null }]),
    '10 - 1d4': ok(6, 9, null),
  };
  const rolled: [number, string][] = [];
  const roll = (line: number, column: string) => { rolled.push([line, column]); };
  const button = (i: number) => table('WEAPONS').getByRole('button', { name: `Roll Item ${i} DAMAGE` });

  it('the sum done as the button, its type\'s icon in it; pressed, the roll ROLL made; its "?" saying the formula and the sum', async () => {
    const s = server(ANSWERS);
    show([line('Bone Striker')], { items: TYPED, onGearRoll: roll, onReadGearLines: s.read });
    await waitFor(() => expect(button(1).textContent).toBe('1d8+7'));
    expect(button(1).querySelector('svg')).toBeTruthy();
    // Not ROLL beside it any more, nor the formula as words.
    expect(table('WEAPONS').queryByText('ROLL')).toBeNull();
    expect(table('WEAPONS').queryByText('1d8 + @str_mod + 3 SLASHING DMG')).toBeNull();
    await userEvent.click(button(1));
    expect(rolled.at(-1)).toEqual([0, 'damage']);
    const hint = table('WEAPONS').getByRole('note', { name: /^1d8 \+ @str_mod \+ 3 SLASHING DMG · / });
    expect(hint.getAttribute('aria-label')).toBe('1d8 + @str_mod + 3 SLASHING DMG · on this character 1d8 + STR mod (4) + 3 SLASHING DMG = 1d8 + 7 SLASHING (8 to 15)');
    // Every box read in one asking.
    expect(s.asked).toEqual([['1d8 + @str_mod + 3 SLASHING DMG']]);
  });

  it('several parts each with its type; a lone d20 its bonus; the item\'s faint, the line\'s own bright', async () => {
    const withHit: ItemsShown = { ...TYPED, types: [{ ...TYPED.types![0], columns: [...TYPED.types![0].columns, { id: 'hit', label: 'HIT', kind: 'dice' }] }, TYPED.types![1]] };
    const s = server(ANSWERS);
    show([line('Javelin'), line('Pistol', { values: { hit: '1d20 + @str_mod' } })], { items: withHit, onGearRoll: roll, onReadGearLines: s.read });
    await waitFor(() => expect(within(button(1)).getAllByTestId('worked').map((w) => w.textContent)).toEqual(['1d6+4', '4d6']));
    expect(button(1).querySelectorAll('svg')).toHaveLength(2);
    const hit = table('WEAPONS').getByRole('button', { name: 'Roll Item 2 HIT' });
    expect(hit.textContent).toBe('+4');
    expect(hit.style.fontSize).toBe('0.85rem');
    expect(button(2).textContent).toBe('2d6');
    expect(button(2).style.fontSize).toBe('0.72rem');
    // Pistol's DAMAGE is its item's (faint); its HIT its own (bright).
    expect(button(2).style.opacity).toBe('0.85');
    expect(hit.style.opacity).toBe('1');
    expect(s.asked).toHaveLength(1);
    expect([...s.asked[0]].sort()).toEqual(['1d20 + @str_mod', '1d6 + @str_mod PIERCING + 4d6 LIGHTNING DMG', '2d6']);
  });

  it('no plain sum: as typed with ROLL and a "?"; won\'t roll: as typed, no button, the "?" saying why', async () => {
    const s = server(ANSWERS);
    show([line('Odd', { type: 'weapons', values: { damage: '10 - 1d4' } }), line('Bad', { type: 'weapons', values: { damage: '1d6 + @gone' } })],
      { items: TYPED, onGearRoll: roll, onReadGearLines: s.read });
    await waitFor(() => expect(table('WEAPONS').getByRole('note', { name: /^10 - 1d4: / })).toBeTruthy());
    expect(button(1).textContent).toBe('ROLL');
    expect(table('WEAPONS').getByRole('note', { name: /^10 - 1d4: / }).getAttribute('aria-label')).toBe('10 - 1d4: 6 to 9');
    expect(table('WEAPONS').queryByRole('button', { name: 'Roll Item 2 DAMAGE' })).toBeNull();
    expect(table('WEAPONS').getByRole('note', { name: '1d6 + @gone: Nothing to roll. It won\'t roll.' })).toBeTruthy();
    expect(table('WEAPONS').getByText('1d6 + @gone')).toBeTruthy();
  });

  it('until read, or with nobody to ask, or nothing to roll with: as before, words and ROLL', async () => {
    let answer!: (v: GearDiceRead[] | null) => void;
    show([line('Bone Striker')], { items: TYPED, onGearRoll: roll, onReadGearLines: () => new Promise((r) => { answer = r; }) });
    expect(button(1).textContent).toBe('ROLL');
    expect(table('WEAPONS').getByText('1d8 + @str_mod + 3 SLASHING DMG')).toBeTruthy();
    // No answer at all (the connection down): still as before.
    await waitFor(() => expect(answer).toBeTruthy());
    await act(async () => { answer(null); });
    expect(button(1).textContent).toBe('ROLL');
    cleanup();
    show([line('Bone Striker')], { items: TYPED, onGearRoll: roll });
    expect(button(1).textContent).toBe('ROLL');
    cleanup();
    // Read only with no ROLL (nothing to roll with): not asked at all.
    const s = server(ANSWERS);
    show([line('Bone Striker')], { items: TYPED, onReadGearLines: s.read });
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(s.asked).toHaveLength(0);
  });

  it('an answer to an older asking, come late, is not drawn over the newer one', async () => {
    const answers: ((v: GearDiceRead[] | null) => void)[] = [];
    const read = () => new Promise<GearDiceRead[] | null>((r) => { answers.push(r); });
    const at = (add: number) => [ok(1 + add, 8 + add, [{ dice: [{ count: 1, sides: 8 }], add, type: 'SLASHING' }])];
    show([line('Bone Striker')], { items: TYPED, onGearRoll: roll, onReadGearLines: read });
    await waitFor(() => expect(answers).toHaveLength(1));
    act(() => outside.set({ str: 20 }));
    await waitFor(() => expect(answers).toHaveLength(2));
    await act(async () => { answers[1](at(8)); });
    await waitFor(() => expect(button(1).textContent).toBe('1d8+8'));
    // The first asking's answer, late: the sheet has moved on.
    await act(async () => { answers[0](at(7)); });
    expect(button(1).textContent).toBe('1d8+8');
  });

  it('asked again when the sheet changes, the numbers following its stats; the last ones kept meanwhile', async () => {
    let str = 4;
    const asked: string[][] = [];
    const read = async (texts: string[]) => { asked.push(texts); return texts.map(() => ok(1 + str + 3, 8 + str + 3, [{ dice: [{ count: 1, sides: 8 }], add: str + 3, type: 'SLASHING' }])); };
    show([line('Bone Striker')], { items: TYPED, onGearRoll: roll, onReadGearLines: read });
    await waitFor(() => expect(button(1).textContent).toBe('1d8+7'));
    str = 5;
    act(() => outside.set({ str: 20, str_mod: 5 }));
    // Kept while asking.
    expect(button(1).textContent).toBe('1d8+7');
    await waitFor(() => expect(button(1).textContent).toBe('1d8+8'));
    expect(asked).toHaveLength(2);
  });
});

describe('each type a table (8e2a; mockup gear-table, answered 2026-11-25)', () => {
  /** The browser saying the GEAR tab is `width` wide. */
  const drawnAt = (width: number) => {
    class Seen { constructor(private fn: (e: { contentRect: { width: number } }[]) => void) {} observe() { this.fn([{ contentRect: { width } }]); } disconnect() {} }
    vi.stubGlobal('ResizeObserver', Seen);
  };
  afterEach(() => vi.unstubAllGlobals());
  const at = (i: number) => within(screen.getByTestId(`gear-line-${i}`));
  const TWO: ItemsShown = {
    ...ITEMS,
    types: [{ ...ITEMS.types![0], columns: [{ id: 'one', label: 'One handed', kind: 'damage' }, { id: 'two', label: 'Two handed', kind: 'damage' }, ...ITEMS.types![0].columns.filter((c) => c.id !== 'damage')] }, ITEMS.types![1]],
    list: [{ id: 'striker', label: 'Bone Striker', needs: 'carried', features: [], type: 'weapons', values: { one: '1d8', two: '1d10', range: '5 ft.', ammo: 6 } }, ...ITEMS.list],
  };
  const heads = (name: string) => within(screen.getByRole('region', { name: `${name} gear` })).getAllByText((_, el) => !!el && el.tagName === 'SPAN' && (el as HTMLElement).style.alignSelf === 'end').map((h) => h.textContent);

  it('wide: heads once, the name\'s first; a cell each, a dim dash where a line has none; no words beside a cell', () => {
    drawnAt(900);
    show([line('Pistol'), line('Rope', { type: 'weapons', values: { range: '50 ft.' } })], { items: ITEMS });
    expect(heads('WEAPONS')).toEqual(['WEAPON', 'DAMAGE', 'RANGE', 'AMMO', 'WEIGHT', 'CHARGES', 'GRADE']);
    expect(heads('WEAPONS')).toHaveLength(7);
    // The Pistol's RANGE its own cell, its head saying what it is: no RANGE word on the line.
    const pistol = at(0);
    expect(pistol.getByRole('note', { name: 'Item 1 RANGE: 30 m' }).textContent).toBe('30 m');
    // The Rope has no DAMAGE: a dash in its cell.
    expect(at(1).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('narrow: what fits in the row, the rest folded under it, named; a COUNT that reloads folded with what is carried beside it', () => {
    drawnAt(480);
    show([line('Pistol'), line('Pistol Rounds', { type: 'gear', qty: 24, carry: 'readied' }), line('AP Rounds', { type: 'gear', qty: 6 }), line('AP Rounds', { type: 'gear', qty: 40, carry: 'stash' })],
      { items: ITEMS, onGearCount: async () => ({ ok: true, now: 6, most: 6 }) });
    expect(heads('WEAPONS')).toEqual(['WEAPON', 'DAMAGE']);
    const ammo = at(0).getByRole('note', { name: 'Item 1 AMMO: 6 / 6' });
    expect(ammo.textContent).toMatch(/^AMMO/);
    expect(at(0).getByRole('note', { name: 'Item 1 AMMO carried' }).textContent).toBe('· PISTOL ROUNDS ×24 · AP ROUNDS ×6 CARRIED');
    expect(at(0).getByRole('note', { name: 'Item 1 RANGE: 30 m' }).textContent).toBe('RANGE30 m');
    // Each folded on a line of its own.
    expect((ammo.parentElement as HTMLElement).style.flexDirection).toBe('column');
  });

  it('every DAMAGE under one head, a button each, each named where there are two', () => {
    drawnAt(900);
    show([line('Bone Striker')], { items: TWO, onGearRoll: () => {} });
    expect(heads('WEAPONS').slice(0, 2)).toEqual(['WEAPON', 'DAMAGE']);
    const cell = at(0).getByRole('button', { name: 'Roll Item 1 One handed' }).closest('div')!;
    expect(within(cell).getByRole('button', { name: 'Roll Item 1 Two handed' })).toBeTruthy();
    expect(within(cell).getByText('ONE HANDED')).toBeTruthy();
    expect(within(cell).getByText('TWO HANDED')).toBeTruthy();
    // One DAMAGE: its own head, no name beside it.
    cleanup();
    drawnAt(900);
    show([line('Pistol')], { items: ITEMS, onGearRoll: () => {} });
    expect(at(0).getByRole('button', { name: 'Roll Item 1 DAMAGE' }).closest('div')!.textContent).not.toMatch(/DAMAGE/);
  });

  it('the name\'s cell: how many, where carried and ✎ under it; ✎ and a click on the row open the card under it', async () => {
    drawnAt(900);
    show([line('Pistol', { qty: 2 })], { items: ITEMS });
    expect(at(0).getByText('×2')).toBeTruthy();
    expect(at(0).getByRole('combobox', { name: 'Item 1 carried' })).toBeTruthy();
    await userEvent.click(at(0).getByRole('button', { name: 'Edit item 1' }));
    const card = at(0).getByRole('group', { name: 'Item 1 columns' });
    expect(card.style.gridColumn).toBe('1 / -1');
    await userEvent.click(at(0).getByRole('button', { name: 'Edit item 1' }));
    expect(at(0).queryByRole('group', { name: 'Item 1 columns' })).toBeNull();
    await userEvent.click(at(0).getByRole('note', { name: 'Item 1 RANGE: 30 m' }));
    expect(at(0).getByRole('group', { name: 'Item 1 columns' })).toBeTruthy();
  });

  it('the STASH, its types mixed: each line as before, its type said and each column named', async () => {
    drawnAt(900);
    show([line('Pistol', { carry: 'stash' })], { items: ITEMS });
    await userEvent.click(screen.getByRole('button', { name: /STASH · 1/ }));
    const stashed = at(0);
    expect(stashed.getByText('WEAPONS')).toBeTruthy();
    expect(stashed.getByRole('note', { name: 'Item 1 RANGE: 30 m' }).textContent).toBe('RANGE30 m');
  });
});
