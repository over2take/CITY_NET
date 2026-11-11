import { describe, it, expect } from 'vitest';
import { itemsWorkedOn, itemLines, slotVerb, gearRow, slotCounters, slotCountAsked, itemUses, type ItemsShown, type ItemWorked } from '../gearItems';
import { blankItem, type InventoryItem } from '../inventory';

/**
 * A system's items on the GEAR tab (7e3b; approved mockup docs/mockups/items.html): which line draws which item, its
 * buttons and words as the mockup has them, the slot counters, and the GM's own count. The server decides; this only
 * reads what it worked out.
 */

const ITEMS: ItemsShown = {
  slots: [{ id: 'attuned', label: 'Attuned', count: 2 }],
  list: [
    { id: 'ring', label: 'Ring of Might', needs: 'attuned', features: [{ id: 'mighty', label: 'Mighty', modifies: ['Con'] }] },
    { id: 'boots', label: 'Boots of Quiet', needs: 'worn', features: [{ id: 'quiet', label: 'Quiet', uses: { refill: 'Long rest' } }, { id: 'soft', label: 'Soft' }] },
    { id: 'coin', label: 'Lucky Coin', needs: 'carried', features: [] },
  ],
};
const line = (name: string, carry: InventoryItem['carry'] = 'stowed'): InventoryItem => ({ ...blankItem(), name, carry });
const worked = (items: ItemWorked[], used = 0, count = 2) => ({ items, slots: [{ id: 'attuned', count, used }] });

describe('which line is an item', () => {
  it('by name in any case; the first carried line of it, or the first when none is; never a blank or other line', () => {
    const lines = [line('rope'), line(' ring of might ', 'stash'), line('RING OF MIGHT'), line('Ring of Might'), line('Lucky Coin', 'stash'), line('')];
    const drawn = itemLines(ITEMS, lines);
    expect([...drawn].map(([i, it]) => [i, it.id])).toEqual([[2, 'ring'], [4, 'coin']]);
    expect(itemLines(undefined, lines).size).toBe(0);
    expect(itemLines({ ...ITEMS, list: [{ ...ITEMS.list[0], label: '' }] }, [line('')]).size).toBe(0);
    expect([...itemLines(ITEMS, [line('Boots of Quiet', 'readied')])][0][0]).toBe(0);
    expect([...itemLines(ITEMS, [line('rope'), line('  boots of quiet ')])].map(([i, it]) => [i, it.id])).toEqual([[1, 'boots']]);
  });
});

describe('what the last save worked out', () => {
  it('the items and slots, those well formed; nothing without', () => {
    const data = { _worked: { items: [{ id: 'ring', needs: 'attuned', worn: true }, { needs: 'x' }, 'no'], slots: [{ id: 'attuned', count: 3, used: 1 }, { id: 'x', count: '3', used: 1 }, { id: 'y', count: 3 }] } };
    expect(itemsWorkedOn(data)).toEqual({ items: [{ id: 'ring', needs: 'attuned', worn: true }], slots: [{ id: 'attuned', count: 3, used: 1 }] });
    for (const d of [null, undefined, {}, { _worked: [] }, { _worked: { items: 'x', slots: {} } }]) expect(itemsWorkedOn(d as never)).toEqual({ items: [], slots: [] });
  });
});

describe('the slot\'s verb', () => {
  it('ATTUNED is ATTUNE; the past tense undone, its own E kept; anything else as it is', () => {
    const pairs: [string, string][] = [
      ['Attuned', 'ATTUNE'], ['BONDED', 'BOND'], ['LINKED', 'LINK'], ['PINNED', 'PIN'], ['BLESSED', 'BLESS'], ['FILLED', 'FILL'],
      ['CHAINED', 'CHAIN'], ['OPENED', 'OPEN'], ['PRIMED', 'PRIME'], ['FUSED', 'FUSE'], ['PLACED', 'PLACE'], ['CHARGED', 'CHARGE'],
      ['FORCED', 'FORCE'], ['VALUED', 'VALUE'], ['EQUIPPED', 'EQUIP'], ['BOUND', 'BOUND'], ['USED', 'USED'], [' tuned ', 'TUNE'],
    ];
    for (const [label, verb] of pairs) expect(slotVerb(label), label).toBe(verb);
  });
});

describe('an item\'s line', () => {
  const ring = ITEMS.list[0];
  const row = (items: ItemWorked[], used = 0, opts = {}) => gearRow(ring, worked(items, used), ITEMS.slots, opts);

  it('carried, not worn: WEAR, ATTUNE waiting on it, CARRIED, and its slot named', () => {
    expect(row([{ id: 'ring', needs: 'attuned' }])).toEqual({
      tag: 'NEEDS ATTUNED',
      buttons: [{ label: 'WEAR', action: { kind: 'wear', item: 'ring' } }, { label: 'ATTUNE', action: null, title: 'Wear it first' }],
      say: { text: 'CARRIED', warn: false },
    });
  });

  it('worn, with a slot free: TAKE OFF and ATTUNE, and that it does nothing yet', () => {
    const r = row([{ id: 'ring', needs: 'attuned', worn: true }], 1);
    expect(r.buttons).toEqual([{ label: 'WORN · TAKE OFF', action: { kind: 'takeOff', item: 'ring' }, on: true }, { label: 'ATTUNE', action: { kind: 'attune', item: 'ring' } }]);
    expect(r.say).toEqual({ text: 'WORN, NOT ATTUNED: DOES NOTHING YET', warn: true });
  });

  it('worn, every slot taken: no ATTUNE for a player, why, and the GM\'s ATTUNE ANYWAY', () => {
    const items: ItemWorked[] = [{ id: 'ring', needs: 'attuned', worn: true }];
    const player = row(items, 2);
    expect(player.buttons[1]).toEqual({ label: 'ATTUNE', action: null, title: 'No ATTUNED slot free: end one first, or ask your GM' });
    expect(player.say).toEqual({ text: 'WORN, NOT ATTUNED: DOES NOTHING YET · NO ATTUNED SLOT FREE', warn: true });
    const gm = row(items, 3, { gm: true });
    expect(gm.buttons[1]).toEqual({ label: 'ATTUNE ANYWAY', action: { kind: 'attune', item: 'ring' }, hot: true, title: 'Every ATTUNED slot is taken: yours to allow past it' });
    expect(gm.say).toEqual({ text: 'WORN, NOT ATTUNED: DOES NOTHING YET', warn: true });
  });

  it('worn and attuned: END, and WORKING; taken off, still attuned, it says so', () => {
    const on = row([{ id: 'ring', needs: 'attuned', worn: true, attuned: true, working: true }], 1);
    expect(on.buttons[1]).toEqual({ label: 'ATTUNED · END', action: { kind: 'end', item: 'ring' }, on: true });
    expect(on.say).toEqual({ text: 'WORKING', warn: false });
    const off = row([{ id: 'ring', needs: 'attuned', attuned: true }], 1);
    expect(off.buttons.map((b) => b.label)).toEqual(['WEAR', 'ATTUNED · END']);
    expect(off.say).toEqual({ text: 'ATTUNED, NOT WORN: DOES NOTHING', warn: true });
  });

  it('a slot with no count worked out is never full', () => {
    expect(gearRow(ring, { items: [{ id: 'ring', needs: 'attuned', worn: true }], slots: [] }, ITEMS.slots).buttons[1].action).toEqual({ kind: 'attune', item: 'ring' });
  });

  it('read-only, the same words with nothing to press', () => {
    const r = row([{ id: 'ring', needs: 'attuned', worn: true }], 0, { readOnly: true });
    expect(r.buttons.map((b) => [b.label, b.action])).toEqual([['WORN · TAKE OFF', null], ['ATTUNE', null]]);
    expect(r.say?.text).toBe('WORN, NOT ATTUNED: DOES NOTHING YET');
  });

  it('stashed, or not saved yet: nothing to press, and why', () => {
    expect(row([])).toEqual({ tag: 'NEEDS ATTUNED', buttons: [], say: { text: 'STASHED: DOES NOTHING', warn: false } });
  });

  it('worn only: WEAR alone, WORKING worn; carried only: no buttons, WORKING while carried', () => {
    const boots = ITEMS.list[1];
    expect(gearRow(boots, worked([{ id: 'boots', needs: 'worn' }]), ITEMS.slots)).toEqual({ tag: null, buttons: [{ label: 'WEAR', action: { kind: 'wear', item: 'boots' } }], say: { text: 'CARRIED', warn: false } });
    const worn = gearRow(boots, worked([{ id: 'boots', needs: 'worn', worn: true, working: true }]), ITEMS.slots);
    expect(worn.say).toEqual({ text: 'WORKING', warn: false });
    // Worn, not working (what the server says goes): nothing said.
    expect(gearRow(boots, worked([{ id: 'boots', needs: 'worn', worn: true }]), ITEMS.slots).say).toBeNull();
    const coin = ITEMS.list[2];
    expect(gearRow(coin, worked([{ id: 'coin', needs: 'carried', working: true }]), ITEMS.slots)).toEqual({ tag: null, buttons: [], say: { text: 'WORKING', warn: false } });
    expect(gearRow(coin, worked([{ id: 'coin', needs: 'carried' }]), ITEMS.slots).say).toBeNull();
  });
});

describe('the slot counters', () => {
  it('ATTUNED 1 OF 2, full when every one is used, the GM\'s own count marked', () => {
    expect(slotCounters(ITEMS, worked([], 1))).toEqual([{ id: 'attuned', label: 'ATTUNED', used: 1, count: 2, full: false, own: false, standard: 2 }]);
    expect(slotCounters(ITEMS, worked([], 2))[0].full).toBe(true);
    expect(slotCounters(ITEMS, worked([], 4, 3))[0]).toMatchObject({ used: 4, count: 3, full: true, own: true });
    // Nothing worked out yet: the system's count, none used.
    expect(slotCounters(ITEMS, { slots: [] })).toEqual([{ id: 'attuned', label: 'ATTUNED', used: 0, count: 2, full: false, own: false, standard: 2 }]);
    expect(slotCounters(undefined, { slots: [] })).toEqual([]);
  });

  it('the GM\'s box: a new number sets it; blank or the system\'s puts it back; the same or nonsense asks nothing', () => {
    const [standard] = slotCounters(ITEMS, worked([], 0));
    const [own] = slotCounters(ITEMS, worked([], 0, 4));
    expect(slotCountAsked(standard, '3')).toEqual({ kind: 'slots', slot: 'attuned', count: 3 });
    expect(slotCountAsked(standard, '0')).toEqual({ kind: 'slots', slot: 'attuned', count: 0 });
    expect(slotCountAsked(standard, ' 20 ')).toEqual({ kind: 'slots', slot: 'attuned', count: 20 });
    expect(slotCountAsked(own, '')).toEqual({ kind: 'slots', slot: 'attuned', count: null });
    expect(slotCountAsked(own, '2')).toEqual({ kind: 'slots', slot: 'attuned', count: null });
    for (const t of ['', '2', '21', '-1', '1.5', 'x']) expect(slotCountAsked(standard, t), t).toBeNull();
    expect(slotCountAsked(own, '4')).toBeNull();
  });
});

describe('an item\'s uses', () => {
  it('each feature with uses the last save counted, never more spent than there are', () => {
    const boots = ITEMS.list[1];
    expect(itemUses(boots, { quiet: { max: 2, spent: 5 }, soft: { max: 1, spent: 0 } })).toEqual([{ feature: boots.features[0], max: 2, spent: 2 }]);
    expect(itemUses(boots, {})).toEqual([]);
  });
});
