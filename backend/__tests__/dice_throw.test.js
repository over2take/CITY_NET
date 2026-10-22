/**
 * The tray's throw (6c4b1; approved mockup docs/mockups/builder-dice.html, decision 9): every roll
 * goes out with the face each die landed on and one seed for the tumble, so the 3D dice show the
 * server's result and everyone watching sees the same throw.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { makeTestDb, run } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';

const require_ = createRequire(import.meta.url);
const { throwOf, withThrow, FATE } = require_('../utils/diceThrow');
const { rollField, rollMenuDice } = require_('../systemBuilder/tableRolls');

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

afterEach(() => vi.restoreAllMocks());

describe('the throw', () => {
  it('lands plain dice on the face they show, counted from 0', () => {
    const t = throwOf({ results: { 6: [5, 2], 20: [20] } });
    expect(t.dice).toEqual([{ key: '6', sides: 6, landed: [4, 1] }, { key: '20', sides: 20, landed: [19] }]);
    expect(t).not.toHaveProperty('symbols');
  });

  it('takes its seed from the secure source, one for the whole roll', () => {
    const spy = vi.spyOn(crypto, 'randomInt').mockReturnValue(1234);
    expect(throwOf({ results: { 6: [1] } }).seed).toBe(1234);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
    const seeds = new Set(Array.from({ length: 20 }, () => throwOf({ results: { 6: [1] } }).seed));
    expect(seeds.size).toBeGreaterThan(15);
  });

  it('keeps a score with no dice behind it to the die, and sizes a named kind by diceSides', () => {
    // Initiative with no dice sends the score as a d20's or a d8's.
    expect(throwOf({ results: { 20: [25], 8: [0] } }).dice.map((d) => [d.key, d.landed])).toEqual([['8', [0]], ['20', [19]]]);
    expect(throwOf({ results: { Hunger: [10, 3] }, diceSides: { Hunger: 10 } }).dice).toEqual([{ key: 'Hunger', sides: 10, landed: [9, 2] }]);
    expect(throwOf({ results: { Mystery: [2] } }).dice).toEqual([{ key: 'Mystery', sides: 6, landed: [1] }]);
    // One value rather than a list is one die.
    expect(throwOf({ results: { 4: 3 } }).dice).toEqual([{ key: '4', sides: 4, landed: [2] }]);
  });

  it('gives Fate dice their faces, two of each, landing on one showing what was rolled', () => {
    const [k] = throwOf({ results: { dF: [1, 0, -1, '+1', '-1'] } }).dice;
    expect(k.faces.map((f) => f.text)).toEqual(FATE);
    expect(k.landed.map((i) => k.faces[i].text)).toEqual(['+1', '0', '-1', '+1', '-1']);
  });

  it('takes the faces, landings, color and symbols it is given', () => {
    const t = throwOf({ results: { Bad: ['✕', '·'] } }, {
      kinds: { Bad: { faces: [{ text: '·' }, { text: '✕', s: ['miss'] }], landed: [1, 0], color: 'danger' } },
      symbols: [{ id: 'miss', mark: '✕' }],
    });
    expect(t.dice).toEqual([{ key: 'Bad', sides: 2, faces: [{ text: '·' }, { text: '✕', s: ['miss'] }], landed: [1, 0], color: 'danger' }]);
    expect(t.symbols).toEqual([{ id: 'miss', mark: '✕' }]);
    expect(withThrow({ total: 3, results: { 6: [3] } })).toMatchObject({ total: 3, results: { 6: [3] }, throw: { dice: [{ key: '6', landed: [2] }] } });
  });
});

describe('every roll broadcast', () => {
  const sources = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === 'node_modules' || e.name === '__tests__' || e.name.startsWith('.')) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? sources(p) : e.name.endsWith('.js') ? [p] : [];
  });

  it('goes out with its throw', () => {
    const sends = sources(BACKEND).flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/emit\(\s*'diceRollBroadcast'\s*,\s*(\w+)\(?/g)]
      .map((m) => `${path.relative(BACKEND, f).replace(/\\/g, '/')}: ${m[1]}`));
    expect(sends.length).toBeGreaterThanOrEqual(12);
    expect(sends.filter((s) => !s.endsWith(': withThrow'))).toEqual([]);
  });
});

describe('a system\'s own dice in the throw', () => {
  const SYMBOLS = [
    { id: 'hit', name: 'Hit', mark: '✶', cancels: 'miss' },
    { id: 'miss', name: 'Miss', mark: '✕', cancels: 'hit' },
    { id: 'skull', name: 'Skull', drawn: ['8001', ...Array(14).fill('0000'), '8001'] },
    { id: 'edge', name: 'Edge', mark: '◆' },
  ];
  const DICE = [
    { id: 'good', name: 'Good', faces: [{}, { s: ['hit'] }, { s: ['hit', 'hit'] }] },
    { id: 'bad', name: 'Bad', color: 'danger', faces: [{}, { s: ['miss'] }, { s: ['skull'] }, { n: -1 }] },
  ];
  const DEF = { format: 1, name: 'Throw', symbols: SYMBOLS, dice: DICE, rolls: [] };
  // A face by its place among a die's faces (1 for the first) out of how many.
  const faces = (...plan) => { let i = 0; return () => { const [f, of] = plan[i++ % plan.length]; return (f - 1 + 0.5) / of; }; };

  it('brings every face of each kind rolled, the one each landed on, its color, and the looks of the symbols shown', () => {
    const roll = { id: 'clash', label: 'Clash', dice: [{ count: '2', die: 'good' }, { count: '2', die: 'bad' }, { count: '1', sides: 6 }], read: 'symbols', on: 'hit' };
    const made = rollField({ definition: DEF, data: {}, roll, rng: faces([3, 3], [1, 3], [3, 4], [4, 4], [5, 6]), who: 'K' });
    const t = throwOf(made, made.own);
    // In the results' own order, which puts a key like '6' first.
    expect(t.dice.map((d) => [d.key, d.sides, d.landed, d.color])).toEqual([['6', 6, [4], undefined], ['Good', 3, [2, 0], undefined], ['Bad', 4, [2, 3], 'danger']]);
    const kind = (key) => t.dice.find((d) => d.key === key);
    expect(kind('Good').faces).toEqual([{ text: '·' }, { text: '✶', s: ['hit'] }, { text: '✶✶', s: ['hit', 'hit'] }]);
    // A die with a face below 0 writes its numbers signed; a drawn symbol with no mark, its letter.
    expect(kind('Bad').faces).toEqual([{ text: '·' }, { text: '✕', s: ['miss'] }, { text: 'S', s: ['skull'] }, { text: '-1', n: -1 }]);
    // Each landed on a face showing what the log and the tray's results say it rolled.
    for (const d of t.dice.filter((k) => k.faces)) expect(d.landed.map((i) => d.faces[i].text), d.key).toEqual(made.results[d.key]);
    // Only the symbols the rolled kinds show, each with its look; EDGE is on neither.
    expect(t.symbols).toEqual([{ id: 'hit', mark: '✶' }, { id: 'miss', mark: '✕' }, { id: 'skull', mark: 'S', drawn: SYMBOLS[2].drawn }]);
  });

  it('from the dice menu, the same', () => {
    const made = rollMenuDice({ definition: DEF, dieId: 'good', count: 3, rng: faces([2, 3], [3, 3], [1, 3]), who: 'K' });
    const [d] = throwOf(made, made.own).dice;
    expect([d.key, d.landed, d.faces[d.landed[1]].text]).toEqual(['Good', [1, 2, 0], '✶✶']);
  });

  it('none for a roll of plain dice only', () => {
    const made = rollField({ definition: DEF, data: {}, roll: { id: 'r', label: 'R', dice: [{ count: '2', sides: 8 }] }, rng: faces([3, 8], [8, 8]), who: 'K' });
    expect(made.own).toEqual({ kinds: {}, symbols: [] });
    expect(throwOf(made, made.own).dice).toEqual([{ key: '8', sides: 8, landed: [2, 7] }]);
  });
});

describe('a roll of plain dice from the dice menu', () => {
  let db;
  beforeEach(async () => {
    db = await makeTestDb();
    await run(db, 'CREATE TABLE dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)');
    await run(db, "INSERT INTO global_settings (key, value) VALUES ('game_system', 'generic')");
  });

  it('lands each die on the face it rolled, for everyone the same', async () => {
    const socketsFactory = (await import('../sockets/index.js')).default;
    const emitted = [];
    let connectionCb;
    const io = { on: (e, cb) => { if (e === 'connection') connectionCb = cb; }, emit: (event, data) => emitted.push({ event, data }), to: () => ({ emit: () => {} }) };
    socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    connectionCb({ id: 'sock-1', on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, use: () => {}, join: () => {} });
    handlers.requestDiceRoll({ userName: 'GHOST', diceCounts: { 6: 3, 20: 1 }, modifiers: [], color: '#0f0' });
    const deadline = Date.now() + 3000;
    let sent;
    while (!(sent = emitted.find((e) => e.event === 'diceRollBroadcast')) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
    const { results, throw: thrown } = sent.data;
    expect(Number.isInteger(thrown.seed)).toBe(true);
    expect(thrown.dice.map((d) => [d.key, d.sides, d.landed])).toEqual([['6', 6, results[6].map((v) => v - 1)], ['20', 20, results[20].map((v) => v - 1)]]);
  });
});
