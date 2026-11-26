/**
 * Every DAMAGE and DICE on a sheet's gear read at once, worked out on the character (8e1; approved mockup
 * docs/mockups/gear-table.html, 2026-11-25): each part's dice kept and all else summed ("1d8 + @str_mod + 3" as 1d8 and 7),
 * with its type, for the line's numbers (+12, 1d8+7) and their "?". Only where the roll is its dice plus a number. Read
 * on the sheet ROLL would roll from: one's own, or an NPC's by its token.
 */
import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, run } from './helpers/testDb.js';
import { drain } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { readGearDice, readGearLines, workedOf, READ_LINES_LIMIT } = require_('../systemBuilder/gearRolls');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = require_('../sockets/index.js');

const STRONG = {
  format: 1, name: 'Strong', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Strength' }] }],
  derived: [{ id: 'str_mod', label: 'STR mod', formula: 'floor((@str - 10) / 2)' }, { id: 'prof', label: 'Proficiency', formula: '4' }],
  items: { types: [{ id: 'weapons', label: 'WEAPONS', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }] }], list: [] },
};
const KES = { str: 18, str_mod: 4, prof: 4 };
const names = { known: (n) => ['str', 'str_mod', 'prof'].includes(n), refused: (n) => `@${n} isn't one of this system's names` };

describe('a part worked out (workedOf)', () => {
  it('its dice kept, all else summed; dice of a size together; a number alone, no dice', () => {
    expect(workedOf('1d20 + @str_mod + @prof + 3', KES, names)).toEqual({ dice: [{ count: 1, sides: 20 }], add: 11 });
    expect(workedOf('1d6 + 1d6 + 1d8 - 1', KES, names)).toEqual({ dice: [{ count: 2, sides: 6 }, { count: 1, sides: 8 }], add: -1 });
    expect(workedOf('@str_mod d6', KES, names)).toEqual({ dice: [{ count: 4, sides: 6 }], add: 0 });
    expect(workedOf('3', KES, names)).toEqual({ dice: [], add: 3 });
    // Dice counted by a stat that is 0 on this character: none of them.
    expect(workedOf('@prof d6 + 3', { ...KES, prof: 0 }, names)).toEqual({ dice: [], add: 3 });
  });
  it('no plain sum where the dice are not simply added: taken away, doubled, in a function; nothing, or an error, none', () => {
    expect(workedOf('10 - 1d4', KES, names)).toBeNull();
    expect(workedOf('2d6 * 2', KES, names)).toBeNull();
    expect(workedOf('floor(1d6 / 2)', KES, names)).toBeNull();
    expect(workedOf('  ', KES, names)).toBeNull();
    expect(workedOf('1d6 + @gone', KES, names)).toBeNull();
  });
});

describe('a box read, with its worked parts (readGearDice)', () => {
  it('plain dice one part with no type; a DAMAGE naming types, each part with its type as written', () => {
    expect(readGearDice(STRONG, KES, '1d20 + @str_mod + @prof').worked).toEqual([{ dice: [{ count: 1, sides: 20 }], add: 8, type: null }]);
    expect(readGearDice(STRONG, KES, '1d6 + @str_mod piercing + 4d6 LIGHTNING DMG').worked).toEqual([
      { dice: [{ count: 1, sides: 6 }], add: 4, type: 'PIERCING' }, { dice: [{ count: 4, sides: 6 }], add: 0, type: 'LIGHTNING' }]);
  });
  it('none where any part has no plain sum; the reading itself as before', () => {
    expect(readGearDice(STRONG, KES, '10 - 1d4')).toMatchObject({ ok: true, low: 6, high: 9, worked: null });
    expect(readGearDice(STRONG, KES, '1d8 SLASHING + 2d6 * 2 FIRE DMG')).toMatchObject({ ok: true, worked: null });
  });
});

describe('every box at once (readGearLines)', () => {
  it('one answer each, in order, as readGearDice answers it; what isn\'t text, not dice', () => {
    const texts = ['1d20 + @str_mod', '@gone', '1d8 + 3 SLASHING DMG', 5];
    const r = readGearLines(STRONG, KES, texts);
    expect(r.ok).toBe(true);
    expect(r.reads).toHaveLength(4);
    expect(r.reads[0]).toEqual(readGearDice(STRONG, KES, '1d20 + @str_mod'));
    expect(r.reads[1]).toMatchObject({ ok: false, error: "@gone isn't one of this system's names" });
    expect(r.reads[2].worked).toEqual([{ dice: [{ count: 1, sides: 8 }], add: 3, type: 'SLASHING' }]);
    expect(r.reads[3]).toEqual({ ok: false, error: 'Not dice' });
  });
  it('not a list, or past its limit: nothing read; a text past 200 cut there', () => {
    expect(readGearLines(STRONG, KES, '1d6')).toEqual({ ok: false, error: 'Nothing to read' });
    expect(readGearLines(STRONG, KES, Array(READ_LINES_LIMIT + 1).fill('1d6'))).toEqual({ ok: false, error: 'Nothing to read' });
    expect(readGearLines(STRONG, KES, Array(READ_LINES_LIMIT).fill('1d6')).reads).toHaveLength(READ_LINES_LIMIT);
    expect(readGearLines(STRONG, KES, [`1d6 + ${'1'.repeat(300)}`]).reads[0].ok).toBe(true);
  });
});

describe('at the table (sockets readGearLines)', () => {
  const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  const setUp = async () => {
    const db = await makeTestDb();
    const ID = 'sys_strongstrongstr1';
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Strong', JSON.stringify(STRONG), JSON.stringify(STRONG)]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'game_system\', ?)', [ID]);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'kes\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Kes', ...KES })]);
    const ogre = (await run(db, 'INSERT INTO locations (name, shape, x, z) VALUES (\'Ogre\', \'enemy_rhombus\', 0, 0)')).lastID;
    const sheet = await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES (\'gm\', ?, ?, 1, \'Ogre\')', [ID, JSON.stringify({ name: 'Ogre', str: 20, str_mod: 5, prof: 2 })]);
    await run(db, 'INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)', [ogre, sheet.lastID]);
    let connection;
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const join = async (who) => {
      const handlers = {};
      connection({ id: `lines-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
      handlers.identify(who);
      await drain(db);
      return { handlers, ask: (payload) => new Promise((resolve) => handlers.readGearLines(payload, resolve)) };
    };
    return { join, ogre };
  };

  it('a player\'s own sheet; the GM an NPC\'s by its token; a player not theirs: no answer', async () => {
    const t = await setUp();
    const kes = await t.join('kes');
    const mine = await kes.ask({ texts: ['1d20 + @str_mod + @prof'] });
    expect(mine.reads[0].worked).toEqual([{ dice: [{ count: 1, sides: 20 }], add: 8, type: null }]);
    const gm = await t.join({ userName: 'gm', isAdmin: true, token: GM });
    const its = await gm.ask({ texts: ['1d20 + @str_mod + @prof'], location_id: t.ogre });
    expect(its.reads[0].worked).toEqual([{ dice: [{ count: 1, sides: 20 }], add: 7, type: null }]);
    // Kes may not read the Ogre's: no answer comes.
    let answered = false;
    kes.handlers.readGearLines({ texts: ['1d6'], location_id: t.ogre }, () => { answered = true; });
    await new Promise((r) => setTimeout(r, 80));
    expect(answered).toBe(false);
  });

  it('nothing asked: said so; no reply asked for: nothing done', async () => {
    const t = await setUp();
    const kes = await t.join('kes');
    expect(await kes.ask(null)).toEqual({ ok: false, error: 'Nothing to read' });
    expect(await kes.ask({ texts: 'x' })).toEqual({ ok: false, error: 'Nothing to read' });
    expect(() => kes.handlers.readGearLines({ texts: ['1d4'] })).not.toThrow();
  });
});
