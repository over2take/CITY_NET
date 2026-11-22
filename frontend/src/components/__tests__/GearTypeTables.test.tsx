import React, { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup, waitFor } from '@testing-library/react';
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

const show = (lines: object[], { readOnly = false, items = ITEMS as ItemsShown | undefined, onGearRoll = undefined as ((line: number, column: string) => void) | undefined,
  onReadGearDice = undefined as ((text: string) => Promise<GearDiceRead | null>) | undefined, onGearCount = undefined as GearCount | undefined,
  worked = undefined as object | undefined } = {}) => {
  const writes: object[][] = [];
  const Harness = () => {
    // `worked`: what the server worked out of the items (_worked), which are worn.
    const [data, setData] = useState<Record<string, unknown>>({ inventory: JSON.stringify(lines), ...(worked ? { _worked: worked } : {}) });
    return <InventorySection section={SECTION} data={data as never} readOnly={readOnly} itemsShown={items} onGearRoll={onGearRoll} onReadGearDice={onReadGearDice} onGearCount={onGearCount}
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

  it('a thing made by hand opens its band if closed', async () => {
    show([typed('Sword', 'weapons')], { items: BANDED });
    await userEvent.click(head('EQUIPPED'));
    await userEvent.click(within(screen.getByRole('group', { name: 'Add by hand' })).getByRole('button', { name: 'Add a Weapon by hand' }));
    expect(head('EQUIPPED').getAttribute('aria-expanded')).toBe('true');
    expect(within(band('EQUIPPED')).getByLabelText('Item 2 name')).toBeTruthy();
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
