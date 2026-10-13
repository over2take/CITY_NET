import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import {
  clampQty, searchItems, itemKey, chipLabel, worthOf, landsText, shortReason, recipientText, resultText, giveLabel,
  refusalText, givenAt, givenText, noticeText, recipientKey, previewRequest, giveRequest, askOnce, giveCalls,
  QTY_MAX, NOTE_MAX, ASK_TIMEOUT_MS, type GivableCatalogue, type Recipient, type AskSocket,
} from '../giveItems';
import { giveAvailable, cataloguesAvailable, shopsAvailable } from '../../data/buildingTypes';
import { registerCustomTemplate, clearCustomTemplates, type CustomRender } from '../customTemplates';
import type { Currency } from '../currencies';

/**
 * GIVE ITEM's window as logic (4g4a; approved mockup docs/mockups/give-item.html, 2026-10-12):
 * searching what the game can give, saying where a gift lands and why not, and what is sent. Held to
 * the server's limits (backend/sheets/giving.js).
 */

const req = createRequire(import.meta.url);
const { LIMITS } = req('../../../../backend/sheets/giving.js');

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const NOGIVE = 'sys_bbbbbbbbbbbbbbbb';
const NOSHOPS = 'sys_cccccccccccccccc';
const NEITHER = 'sys_dddddddddddddddd';
const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];
const gold: Currency = { id: 'gold', name: 'Gold', short: 'gp', decimals: 0, decimalMark: '.', debt: false, negative: false, denominations: [] };
const favor: Currency = { ...gold, id: 'favor', name: 'Favor', short: 'fv' };
const system = (id: string, parts: CustomRender['parts'], more: Partial<CustomRender> = {}): CustomRender =>
  ({ id, name: 'Hearth', parts, derived: [], sheet: { sections: [] }, words: {}, ...more } as CustomRender);

beforeEach(() => {
  clearCustomTemplates();
  registerCustomTemplate(system(HEARTH, {}, {
    currencies: [gold, favor],
    buildings: { types: {}, catalogues: { weapon_mods: { currency: 'favor' }, weapons: { name: 'Blades' } } },
  } as Partial<CustomRender>));
  registerCustomTemplate(system(NOGIVE, { give_items: { on: false } }));
  registerCustomTemplate(system(NOSHOPS, { shops: { on: false } }));
  registerCustomTemplate(system(NEITHER, { shops: { on: false }, give_items: { on: false } }));
});
afterEach(() => clearCustomTemplates());

const CATALOGUES: GivableCatalogue[] = [
  { catalogue: 'weapons', items: [{ id: 'heavy_pistol', name: 'Heavy Pistol', price: 200 }, { id: 'knife', name: 'Knife', price: 10 }] },
  { catalogue: 'gear', items: [{ id: 'rope', name: 'Rope, 50 ft', price: 5 }, { id: 'knife', name: 'knife sharpener', price: 0 }] },
];

describe('where GIVE ITEM is', () => {
  it('is in every built-in game and a custom one, unless it switched GIVE ITEM off', () => {
    for (const s of [...BUILT_INS, HEARTH, NOSHOPS]) expect(giveAvailable(s), s).toBe(true);
    for (const s of [NOGIVE, NEITHER, 'dnd_5e', '', null, undefined]) expect(giveAvailable(s), String(s)).toBe(false);
  });

  it('keeps the catalogue upload for a game with no shops but GIVE ITEM on, and only then', () => {
    expect(shopsAvailable(NOSHOPS)).toBe(false);
    expect(cataloguesAvailable(NOSHOPS)).toBe(true);
    expect(cataloguesAvailable(NOGIVE)).toBe(true);
    for (const s of BUILT_INS) expect(cataloguesAvailable(s), s).toBe(true);
    for (const s of [NEITHER, 'dnd_5e', null]) expect(cataloguesAvailable(s), String(s)).toBe(false);
  });
});

describe('searching', () => {
  it('lists every item by name, each with its catalogue', () => {
    expect(searchItems(CATALOGUES, '', null).map((i) => itemKey(i))).toEqual(['weapons/heavy_pistol', 'weapons/knife', 'gear/knife', 'gear/rope']);
    expect(searchItems(CATALOGUES, '', null)[0]).toEqual({ id: 'heavy_pistol', name: 'Heavy Pistol', price: 200, catalogue: 'weapons' });
  });

  it('narrows to names holding the words, any case, and to one catalogue', () => {
    expect(searchItems(CATALOGUES, '  KNIFE ', null).map((i) => i.name)).toEqual(['Knife', 'knife sharpener']);
    expect(searchItems(CATALOGUES, 'knife', 'gear').map((i) => i.name)).toEqual(['knife sharpener']);
    expect(searchItems(CATALOGUES, '', 'weapons').map((i) => i.name)).toEqual(['Heavy Pistol', 'Knife']);
    expect(searchItems(CATALOGUES, 'zzz', null)).toEqual([]);
  });

  it('puts one name in two catalogues in catalogue order', () => {
    const twice = [CATALOGUES[0], { catalogue: 'gear', items: [{ id: 'k', name: 'Knife', price: 1 }] }];
    expect(searchItems(twice, 'knife', null).map((i) => itemKey(i))).toEqual(['gear/k', 'weapons/knife']);
  });

  it('names each chip as the game calls the catalogue', () => {
    expect(chipLabel('weapons', HEARTH)).toBe('BLADES');
    expect(chipLabel('gear', 'cities_without_number')).toBe('OPERATOR GEAR');
  });

  it('says what each is worth, as the shop prints it', () => {
    expect(worthOf('cities_without_number', 'weapons', 1200)).toBe('1,200cr');
    expect(worthOf('cities_without_number', 'weapons', 0)).toBe('N/A');
    expect(worthOf(HEARTH, 'weapons', 15)).toContain('15');
    expect(worthOf(HEARTH, 'weapons', 15)).toContain('gp');
    expect(worthOf(HEARTH, 'weapon_mods', 3)).toContain('fv');
  });
});

describe('HOW MANY', () => {
  it('is kept to what the server takes', () => {
    expect([clampQty(0), clampQty(-3), clampQty(2.7), clampQty(150), clampQty(NaN), clampQty(99)]).toEqual([1, 1, 2, 99, 1, 99]);
    expect([QTY_MAX, NOTE_MAX]).toEqual([LIMITS.qty, LIMITS.note]);
  });
});

describe('where it lands', () => {
  it('says the rows it fills, Stowed for a CWN weapon', () => {
    expect(landsText({ shape: 'rows', group: 'weapon', rows: [3] }, 1, true)).toBe('weapon row 3, Stowed');
    expect(landsText({ shape: 'rows', group: 'weapon', rows: [2, 3, 4] }, 3, true)).toBe('weapon rows 2–4, Stowed');
    expect(landsText({ shape: 'rows', group: 'weapon', rows: [1] }, 1, false)).toBe('weapon row 1');
    expect(landsText({ shape: 'rows', group: 'vehicle', rows: [2] }, 1, true)).toBe('vehicle row 2');
  });

  it('says cyberware and the inventory', () => {
    expect(landsText({ shape: 'cyberware' }, 1, true)).toBe('a cyberware row, not yet placed');
    expect(landsText({ shape: 'cyberware' }, 2, true)).toBe('2 cyberware rows, not yet placed');
    expect(landsText({ shape: 'inventory', stacked: false }, 1, false)).toBe('an inventory line');
    expect(landsText({ shape: 'inventory', stacked: false }, 3, false)).toBe('inventory ×3');
    expect(landsText({ shape: 'inventory', stacked: true }, 1, false)).toBe('inventory ×1, stacked');
  });

  it('says why not, short', () => {
    expect(shortReason('No free weapon row — all 6 are full. Clear one on the sheet first.')).toBe('No free weapon row');
    expect(shortReason('No character in this game.')).toBe('No character in this game');
  });

  it('says each recipient\'s line, and the result after', () => {
    const vex: Recipient = { kind: 'player', username: 'vex', name: 'Vex', given: true, lands: { shape: 'rows', group: 'weapon', rows: [2, 3] } };
    const juno: Recipient = { kind: 'player', username: 'juno', name: 'Juno', given: false, reason: 'No free weapon row — all 6 are full.' };
    expect(recipientText(vex, 2, false)).toBe('weapon rows 2–3');
    expect(recipientText(juno, 2, false)).toBe('No free weapon row');
    expect(recipientText({ ...juno, reason: undefined }, 2, false)).toBe('');
    expect(resultText(vex, 2, true)).toBe('VEX: GIVEN, WEAPON ROWS 2–3, STOWED');
    expect(resultText(juno, 2, true)).toBe('JUNO: NOT GIVEN, NO FREE WEAPON ROW');
  });
});

describe('the words around it', () => {
  it('labels the GIVE button', () => {
    expect(giveLabel(2, 'Heavy Pistol', 3)).toBe('GIVE 2 × HEAVY PISTOL TO 3');
    expect(giveLabel(1, 'Rope', 0)).toBe('GIVE 1 × ROPE');
  });

  it('says why a whole GIVE was refused', () => {
    expect(refusalText('give_off')).toBe('GIVE ITEM is switched off in this game.');
    expect(refusalText('no_system')).toMatch(/which game/);
    expect(refusalText('write')).toMatch(/GIVEN list/);
    expect(refusalText('read')).toMatch(/could not be read/);
    expect(refusalText('Not something this game can give.')).toBe('Not something this game can give.');
  });

  it('dates a GIVEN line: a time today, the day before that', () => {
    const now = new Date('2026-10-13T18:00:00Z');
    const today = new Date('2026-10-13T14:05:00Z');
    expect(givenAt('2026-10-13 14:05:00', now)).toBe(`${String(today.getHours()).padStart(2, '0')}:${String(today.getMinutes()).padStart(2, '0')}`);
    expect(givenAt('2026-10-01 14:05:00', now)).toBe(new Date('2026-10-01T14:05:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
    expect(givenAt('nonsense', now)).toBe('nonsense');
  });

  it('reads a GIVEN line and the player\'s notice', () => {
    const now = new Date('2026-10-13T18:00:00Z');
    const line = { id: 1, at: '2026-10-13 14:05:00', by: 'gm', catalogue: 'weapons', item: 'Heavy Pistol', qty: 2, to: ['Vex', 'Rook'], note: '' };
    expect(givenText(line, now)).toBe(`${givenAt(line.at, now)} · gm gave Vex, Rook: Heavy Pistol ×2`);
    expect(noticeText({ item: 'Heavy Pistol', catalogue: 'weapons', qty: 2, note: 'x' })).toBe('THE GM GAVE YOU HEAVY PISTOL ×2');
    expect(noticeText({ item: 'Rope', catalogue: 'gear', qty: 1, note: '' }, 'Keeper')).toBe('THE KEEPER GAVE YOU ROPE ×1');
  });
});

describe('what is sent', () => {
  const vex: Recipient = { kind: 'player', username: 'Vex', name: 'Vex', given: false };
  const ganger: Recipient = { kind: 'npc', location_id: 12, name: 'GANGER', given: false };

  it('keys a recipient a player by name, an NPC by token', () => {
    expect(recipientKey(vex)).toBe('player:vex');
    expect(recipientKey(ganger)).toBe('npc:12');
  });

  it('previews for every player character and the NPCs on the map', () => {
    expect(previewRequest({ catalogue: 'weapons', id: 'knife' }, 150, [12, 13]))
      .toEqual({ catalogue: 'weapons', id: 'knife', qty: 99, players: true, npcs: [12, 13], preview: true });
  });

  it('gives to the ticked ones by name and token, with the note cut to fit', () => {
    expect(giveRequest({ catalogue: 'weapons', id: 'knife' }, 2, [vex, ganger], 'x'.repeat(250)))
      .toEqual({ catalogue: 'weapons', id: 'knife', qty: 2, players: ['Vex'], npcs: [12], note: 'x'.repeat(200) });
    expect(giveRequest({ catalogue: 'gear', id: 'rope' }, 0, [], 'hi')).toEqual({ catalogue: 'gear', id: 'rope', qty: 1, players: [], npcs: [], note: 'hi' });
  });
});

describe('asking the server', () => {
  const fakeSocket = () => {
    const listeners: Record<string, ((d: unknown) => void)[]> = {};
    const sent: { event: string; payload: unknown }[] = [];
    const socket: AskSocket = {
      emit: (event, payload) => { sent.push({ event, payload }); },
      on: (event, fn) => { (listeners[event] ??= []).push(fn as (d: unknown) => void); },
      off: (event, fn) => { listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn); },
    };
    const reply = (event: string, data: unknown) => (listeners[event] ?? []).slice().forEach((f) => f(data));
    return { socket, sent, reply, count: (event: string) => (listeners[event] ?? []).length };
  };

  it('sends once and hears the first answer, then stops listening', async () => {
    const s = fakeSocket();
    const answer = askOnce<{ ok: boolean }>(s.socket, 'requestGivable', undefined, 'givableItems');
    expect(s.sent).toEqual([{ event: 'requestGivable', payload: undefined }]);
    s.reply('givableItems', { ok: true });
    s.reply('givableItems', { ok: false });
    expect(await answer).toEqual({ ok: true });
    expect(s.count('givableItems')).toBe(0);
  });

  it('gives up after the wait, and stops listening', async () => {
    vi.useFakeTimers();
    try {
      const s = fakeSocket();
      const answer = askOnce(s.socket, 'requestGiven', undefined, 'givenList', 1000);
      vi.advanceTimersByTime(999);
      expect(s.count('givenList')).toBe(1);
      vi.advanceTimersByTime(1);
      expect(await answer).toBeNull();
      expect(s.count('givenList')).toBe(0);
      expect(ASK_TIMEOUT_MS).toBe(15_000);
    } finally { vi.useRealTimers(); }
  });

  it('asks the three questions by the server\'s names', async () => {
    const s = fakeSocket();
    const calls = giveCalls(s.socket);
    const a = calls.givable(); s.reply('givableItems', { ok: true, system: 'x', catalogues: [] });
    const b = calls.give(previewRequest({ catalogue: 'gear', id: 'rope' }, 1, [])); s.reply('itemGiven', { ok: false, reason: 'give_off' });
    const c = calls.given(); s.reply('givenList', { ok: true, system: 'x', entries: [] });
    expect(await Promise.all([a, b, c])).toEqual([{ ok: true, system: 'x', catalogues: [] }, { ok: false, reason: 'give_off' }, { ok: true, system: 'x', entries: [] }]);
    expect(s.sent.map((x) => x.event)).toEqual(['requestGivable', 'giveItem', 'requestGiven']);
    expect(s.sent[1].payload).toMatchObject({ players: true, preview: true });
  });
});
