import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import systemDiceRouteFactory from '../routes/system_dice.js';
import { SYSTEM_DICE, forSystem, byId, isBuiltinId } from '../dice/systemDice.js';

const ADMIN_TOKEN = jwt.sign(
  { id: 1, username: 'testadmin', role: 'admin', isTemporary: false },
  'test-secret'
);

let app;

beforeEach(() => {
  app = express();
  app.use(express.json());
  app.use('/api/system_dice', systemDiceRouteFactory());
});

// ─── Manifest ─────────────────────────────────────────────────────────────────

describe('system dice manifest', () => {
  it('every die carries a builtin-namespaced id', () => {
    for (const dice of Object.values(SYSTEM_DICE)) {
      for (const die of dice) {
        expect(die.id.startsWith('builtin:')).toBe(true);
      }
    }
  });

  it('ids are unique across all systems', () => {
    const ids = Object.values(SYSTEM_DICE).flat().map(d => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every die has exactly `sides` faces', () => {
    for (const dice of Object.values(SYSTEM_DICE)) {
      for (const die of dice) {
        expect(die.faces).toHaveLength(die.sides);
      }
    }
  });

  it('no face is blank', () => {
    for (const dice of Object.values(SYSTEM_DICE)) {
      for (const die of dice) {
        for (const f of die.faces) {
          expect(typeof f.value).toBe('string');
          expect(f.value.trim()).not.toBe('');
        }
      }
    }
  });

  it('ships the Fate ladder die: two +1, two -1, two 0', () => {
    const df = byId('builtin:fate_df');
    expect(df).toBeTruthy();
    expect(df.sides).toBe(6);
    const values = df.faces.map(f => f.value).sort();
    expect(values).toEqual(['+1', '+1', '-1', '-1', '0', '0'].sort());
  });

  it('Fate faces are all numeric so rolls sum to the ladder', () => {
    const df = byId('builtin:fate_df');
    const nums = df.faces.map(f => Number(f.value));
    expect(nums.every(n => !isNaN(n))).toBe(true);
    expect(nums.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

describe('forSystem / byId / isBuiltinId', () => {
  it('returns [] for a system with no built-in dice', () => {
    expect(forSystem('cyberpunk_red')).toEqual([]);
  });

  it('returns [] for an unknown system rather than throwing', () => {
    expect(forSystem('not_a_system')).toEqual([]);
  });

  it('byId returns null for an unknown id', () => {
    expect(byId('builtin:nope')).toBeNull();
  });

  it('isBuiltinId distinguishes built-ins from numeric DB ids', () => {
    expect(isBuiltinId('builtin:fate_df')).toBe(true);
    expect(isBuiltinId(7)).toBe(false);
    expect(isBuiltinId('7')).toBe(false);
    expect(isBuiltinId(null)).toBe(false);
    expect(isBuiltinId(undefined)).toBe(false);
  });
});

// ─── GET /api/system_dice ─────────────────────────────────────────────────────

describe('GET /api/system_dice', () => {
  it('returns the whole manifest keyed by system', async () => {
    const res = await request(app).get('/api/system_dice');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('fate_core');
  });

  it('is readable without a token', async () => {
    const res = await request(app).get('/api/system_dice');
    expect(res.status).toBe(200);
  });
});

describe('GET /api/system_dice/:system', () => {
  it('returns the dice for a system that ships them', async () => {
    const res = await request(app).get('/api/system_dice/fate_core');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('dF');
  });

  it('returns an empty array for a system with none', async () => {
    const res = await request(app).get('/api/system_dice/shadowrun_6e');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns an empty array for an unknown system', async () => {
    const res = await request(app).get('/api/system_dice/made_up');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ─── Immutability ─────────────────────────────────────────────────────────────

describe('system dice are read-only', () => {
  it('exposes no write routes, even to an admin', async () => {
    const body = { name: 'Hacked', sides: 2, faces: [{ value: 'a' }, { value: 'b' }] };
    for (const [method, path] of [
      ['post', '/api/system_dice'],
      ['put', '/api/system_dice/builtin:fate_df'],
      ['patch', '/api/system_dice/builtin:fate_df'],
      ['delete', '/api/system_dice/builtin:fate_df'],
    ]) {
      const res = await request(app)[method](path)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send(body);
      expect(res.status).toBe(404);
    }
  });

  it('the manifest still matches after write attempts', () => {
    expect(byId('builtin:fate_df').name).toBe('dF');
  });
});
