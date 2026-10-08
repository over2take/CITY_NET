/**
 * NPC tiers that roll (4b4a1). Approved mockup builder-npcs (2026-10-07): a tier is a difficulty,
 * GENERATE_SHEET asks for a level, and each box is a number, a formula with @level, or dice.
 * Dice come from a fixed sequence here, so every roll is known.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { rollBox, rollTier, boxProblem, levelOf } = require_('../systemBuilder/tierRolls');
const { elevatedUsers } = require_('../middleware/auth');
const systemsRoute = require_('../routes/systems.js');

/** Dice that come up as listed, in order: a 4 on a d6 is 0.5 of the way (floor(0.5 * 6) + 1). */
const faces = (...rolls) => (sides) => { let i = 0; return () => (rolls[i++] - 1) / sides + 1e-9; };

describe('a box', () => {
  it('is a number as it is, rounded', () => {
    expect(rollBox(14, 3)).toEqual({ value: 14, dice: [] });
    expect(rollBox(2.5, 3)).toEqual({ value: 3, dice: [] });
    expect(rollBox('14', 3)).toEqual({ value: 14, dice: [] });
  });

  it('works a formula out for the level', () => {
    expect(rollBox('12 + floor(@level / 3)', 7).value).toBe(14);
    expect(rollBox('@level * 2', 0).value).toBe(0);
    expect(rollBox('max(@level, 5)', 3).value).toBe(5);
    // A whole number, halves up.
    expect(rollBox('@level / 2', 3).value).toBe(2);
    expect(rollBox('@level / 4', 3).value).toBe(1);
  });

  it('rolls dice, one roll per die, and says what came up', () => {
    expect(rollBox('3d6 + 2', 1, faces(4, 1, 6)(6))).toEqual({ value: 13, dice: [{ count: 3, sides: 6, rolls: [4, 1, 6] }] });
    expect(rollBox('d20', 1, faces(17)(20))).toEqual({ value: 17, dice: [{ count: 1, sides: 20, rolls: [17] }] });
    expect(rollBox('2D4', 1, faces(1, 2)(4)).value).toBe(3);
  });

  it('rolls as many dice as the level', () => {
    expect(rollBox('@level d8 + 4', 3, faces(8, 1, 5)(8))).toEqual({ value: 18, dice: [{ count: 3, sides: 8, rolls: [8, 1, 5] }] });
    expect(rollBox('@level  d8', 2, faces(2, 2)(8)).value).toBe(4);
    // Run together it reads as one name, and says so.
    expect(rollBox('@leveld8', 2)).toEqual({ error: 'Only @level can be used here, not @leveld8' });
    expect(rollBox('@level d8', 0)).toEqual({ value: 0, dice: [{ count: 0, sides: 8, rolls: [] }] });
  });

  it('mixes dice of different sizes, each rolled once', () => {
    const r = rollBox('1d4 + 1d6 + @level', 2, (() => { const seq = [0, 0.99]; let i = 0; return () => seq[i++]; })());
    expect(r).toEqual({ value: 9, dice: [{ count: 1, sides: 4, rolls: [1] }, { count: 1, sides: 6, rolls: [6] }] });
  });

  it('never takes a name containing d and digits for dice', () => {
    expect(boxProblem('@hd6 + 1')).toBe('Only @level can be used here, not @hd6');
    expect(rollBox('floor(7 / 2)', 1).value).toBe(3);
  });

  it('is blank when empty', () => {
    expect(rollBox('', 3)).toEqual({ blank: true });
    expect(rollBox('  ', 3)).toEqual({ blank: true });
    expect(rollBox(undefined, 3)).toEqual({ blank: true });
    expect(rollBox(null, 3)).toEqual({ blank: true });
  });

  it('says what is wrong rather than guessing', () => {
    expect(rollBox('12 + oops', 1)).toEqual({ error: expect.stringMatching(/Unknown function|oops/) });
    expect(rollBox('@str + 1', 1)).toEqual({ error: 'Only @level can be used here, not @str' });
    expect(rollBox('$armor_soak', 1)).toEqual({ error: 'Only @level can be used here' });
    expect(rollBox('3d1', 1)).toEqual({ error: 'A die has 2 to 1000 sides' });
    expect(rollBox('2d1001', 1)).toEqual({ error: 'A die has 2 to 1000 sides' });
    expect(rollBox('101d6', 1)).toEqual({ error: 'At most 100 dice' });
    expect(rollBox(Infinity, 1)).toEqual({ error: 'Not a number' });
  });

  it('never shows the dice\'s stand-in names in a mistake', () => {
    for (const bad of ['3d6 3d6', '2d6 +', '(1d4', '@level d8 @level']) {
      const r = rollBox(bad, 1);
      expect(r.error, bad).toBeTruthy();
      expect(r.error, bad).not.toMatch(/tier_die|at character/);
    }
    expect(rollBox('3d6 3d6', 1).error).toMatch(/dice/);
  });

  it('never rolls more than a hundred dice at the top level', () => {
    expect(rollBox('@level d6', 99, () => 0).dice[0].count).toBe(99);
  });
});

describe('checking a box', () => {
  it('passes numbers, formulas, dice and nothing', () => {
    for (const ok of [14, '14', '12 + floor(@level / 3)', '3d6', '@level d8 + 4', '', undefined, null]) expect(boxProblem(ok), String(ok)).toBeNull();
  });

  it('names the problem', () => {
    expect(boxProblem('3d6 +')).toMatch(/./);
    expect(boxProblem('@str')).toBe('Only @level can be used here, not @str');
    expect(boxProblem(['3d6'])).toBe('A number, a formula or dice');
  });
});

describe('the level', () => {
  it('is a whole number from 0 to 99, 1 when none is given', () => {
    expect([undefined, null, '', 'x', 3, 3.6, -2, 150, '7'].map(levelOf)).toEqual([1, 1, 1, 1, 3, 4, 0, 99, 7]);
  });
});

describe('a tier', () => {
  const fields = new Map([
    ['level', { id: 'level', type: 'number' }], ['str', { id: 'str', type: 'number' }],
    ['tactics', { id: 'tactics', type: 'text' }], ['morale', { id: 'morale', type: 'select' }],
  ]);
  const LIMITS = { hp: 9999, defense: 99 };
  const BOSS = { id: 'boss', label: 'BOSS', hp: '@level d10 + 10', defense: '14 + floor(@level / 2)',
    values: { level: '@level', str: '4d6', tactics: 'Calls for backup', morale: 'Fanatic' } };

  it('rolls HP, defense and number fields for the level, and sets the rest as written', () => {
    const r = rollTier(BOSS, 2, fields, LIMITS, faces(10, 3, 6, 6, 6, 6)(10));
    expect(r.level).toBe(2);
    expect(r.hp).toEqual({ value: 23, dice: [{ count: 2, sides: 10, rolls: [10, 3] }] });
    expect(r.defense).toEqual({ value: 15, dice: [] });
    expect(r.values.level).toEqual({ value: 2, dice: [] });
    expect(r.values.str.dice[0].count).toBe(4);
    expect(r.values.tactics).toEqual({ value: 'Calls for backup', dice: [] });
    expect(r.values.morale).toEqual({ value: 'Fanatic', dice: [] });
  });

  it('keeps HP and defense within the token\'s limits', () => {
    const r = rollTier({ hp: '20000', defense: '-5 + @level' }, 1, fields, LIMITS);
    expect(r.hp.value).toBe(9999);
    expect(r.defense.value).toBe(0);
  });

  it('leaves out what a tier leaves blank, and fixed numbers as they were', () => {
    const r = rollTier({ hp: 5, values: { str: 12 } }, 4, fields, LIMITS);
    expect(r.hp).toEqual({ value: 5, dice: [] });
    expect(r.defense).toEqual({ blank: true });
    expect(r.values).toEqual({ str: { value: 12, dice: [] } });
  });
});

describe('TRY IT (4b4a2)', () => {
  const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  const EDITOR = jwt.sign({ username: 'ghost', isTemporary: true }, 'test-secret');
  const PLAYER = jwt.sign({ username: 'vex', role: 'player' }, 'test-secret');
  const HEARTH = {
    format: 1,
    name: 'Hearth',
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Strength' }] }],
    npc: { tiers: [{ id: 'boss', label: 'BOSS', hp: '@level d10 + 10', defense: '14 + floor(@level / 2)', values: { str: '4d6', concept: 'Warlord' } }] },
  };
  let app;
  beforeEach(async () => {
    elevatedUsers.add('ghost');
    const db = await makeTestDb();
    app = express();
    app.use(express.json());
    app.use('/api/systems', systemsRoute(db));
  });
  afterEach(() => elevatedUsers.delete('ghost'));
  const post = (body, token = GM) => request(app).post('/api/systems/try-tier').set({ Authorization: `Bearer ${token}` }).send(body);

  it('rolls one of a draft\'s tiers for a level, each box with its dice', async () => {
    const res = await post({ definition: HEARTH, tier: 'boss', level: 6 });
    expect(res.status).toBe(200);
    expect(res.body.level).toBe(6);
    expect(res.body.hp.dice).toEqual([{ count: 6, sides: 10, rolls: expect.any(Array) }]);
    expect(res.body.hp.value).toBe(10 + res.body.hp.dice[0].rolls.reduce((a, b) => a + b, 0));
    expect(res.body.defense).toEqual({ value: 17, dice: [] });
    expect(res.body.values.str.dice[0].rolls).toHaveLength(4);
    expect(res.body.values.concept).toEqual({ value: 'Warlord', dice: [] });
  });

  it('says what is wrong with a box still being written, rolling the rest', async () => {
    const draft = { ...HEARTH, npc: { tiers: [{ ...HEARTH.npc.tiers[0], defense: '14 +' }] } };
    const res = await post({ definition: draft, tier: 'boss', level: 2 });
    expect(res.status).toBe(200);
    expect(res.body.defense.error).toBeTruthy();
    expect(res.body.hp.value).toBeGreaterThan(10);
  });

  it('answers level 1 without a level, and refuses a tier that isn\'t there or no definition', async () => {
    expect((await post({ definition: HEARTH, tier: 'boss' })).body.level).toBe(1);
    expect(await post({ definition: HEARTH, tier: 'dragon', level: 2 })).toMatchObject({ status: 404, body: { error: 'No such tier' } });
    expect((await post({ definition: { format: 1, name: 'H' }, tier: 'boss' })).status).toBe(404);
    expect(await post({ definition: 'nope', tier: 'boss' })).toMatchObject({ status: 400, body: { error: 'A system definition must be an object' } });
  });

  it('is the main admin\'s alone', async () => {
    expect((await post({ definition: HEARTH, tier: 'boss' }, EDITOR)).status).toBe(403);
    expect((await post({ definition: HEARTH, tier: 'boss' }, PLAYER)).status).toBe(403);
    expect((await request(app).post('/api/systems/try-tier').send({ definition: HEARTH, tier: 'boss' })).status).toBe(401);
  });
});