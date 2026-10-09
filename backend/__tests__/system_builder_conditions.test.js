/**
 * A system's conditions as data (4e1a). Approved mockup builder-conditions (2026-10-09): a standard
 * set every system starts with, each edited or turned off; a system's own, as many as a table
 * needs; icons drawn for CITY_NET or uploaded; ending when removed or after rounds; modifiers on a
 * stat, a formula or all rolls, recorded now and applied to rolls with Phase 6.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { makeTestDb } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { STANDARD, ICONS, LIMITS, isIcon, checkConditions, conditionsOf } = require_('../systemBuilder/conditions');
const { checkDefinition } = require_('../systemBuilder/definition');
const { LIMITS: UPLOAD } = require_('../middleware/uploadConstraints');
const { elevatedUsers } = require_('../middleware/auth');
const systemsRoute = require_('../routes/systems.js');

const HASH = 'a'.repeat(64);
const UPLOADED = `/uploads/condition_icons/${HASH}.png`;
const check = (conditions, targets = ['str', 'save']) => {
  const problems = [];
  checkConditions(conditions, new Set(targets), problems);
  return problems;
};
const messages = (conditions, targets) => check(conditions, targets).map((p) => `${p.where}: ${p.message}`);

describe('the standard set', () => {
  it('is ten conditions every system starts with, each named, labelled and drawn', () => {
    expect(STANDARD.map((c) => c.id)).toEqual([
      'blinded', 'bleeding', 'poisoned', 'prone', 'stunned', 'grappled', 'frightened', 'unconscious', 'restrained', 'exhausted',
    ]);
    for (const c of STANDARD) {
      expect(ICONS, c.id).toContain(c.icon);
      expect(c.short.length, c.id).toBeLessThanOrEqual(LIMITS.short);
      expect(c.description, c.id).toBeTruthy();
    }
    expect(ICONS).toHaveLength(24);
    expect(new Set(ICONS).size).toBe(24);
  });

  it('is what a system with no conditions section offers, ending when removed, with no modifiers', () => {
    const all = conditionsOf({ format: 1, name: 'Hearth' });
    expect(all.map((c) => c.id)).toEqual(STANDARD.map((c) => c.id));
    expect(all[0]).toEqual({ id: 'blinded', name: 'Blinded', short: 'BLIND', icon: 'blind', description: 'Can\'t see.', ends: 'removed', modifiers: [], standard: true });
    expect(conditionsOf(null)).toHaveLength(STANDARD.length);
  });
});

describe('a system\'s conditions, resolved', () => {
  const def = {
    conditions: {
      blinded: { on: false },
      poisoned: { name: 'Toxed', ends: 'rounds', rounds: 3, modifiers: [{ target: 'all_rolls', amount: -1 }] },
      glitching: { name: 'Glitching', icon: UPLOADED, description: 'Chrome misfiring.', modifiers: [{ target: 'str', amount: -2 }] },
      frozen: { name: 'frozen solid', icon: 'snow' },
      nameless: { icon: 'bolt' },
    },
  };

  it('leaves out the standard ones turned off, keeps the edits, and adds the system\'s own after, in order', () => {
    const all = conditionsOf(def);
    expect(all.map((c) => c.id)).toEqual([...STANDARD.slice(1).map((c) => c.id), 'glitching', 'frozen']);
    expect(all.find((c) => c.id === 'poisoned')).toEqual({
      id: 'poisoned', name: 'Toxed', short: 'POISON', icon: 'skull', description: 'Sickened by a toxin.',
      ends: 'rounds', rounds: 3, modifiers: [{ target: 'all_rolls', amount: -1 }], standard: true,
    });
    expect(all.find((c) => c.id === 'glitching')).toEqual({
      id: 'glitching', name: 'Glitching', short: 'GLITCHING'.slice(0, 8), icon: UPLOADED, description: 'Chrome misfiring.',
      ends: 'removed', modifiers: [{ target: 'str', amount: -2 }], standard: false,
    });
  });

  it('gives one of the system\'s own a chip label from its first word, and an icon when it has none', () => {
    const frozen = conditionsOf(def).find((c) => c.id === 'frozen');
    expect(frozen).toMatchObject({ name: 'frozen solid', short: 'FROZEN', icon: 'snow', description: '' });
    expect(conditionsOf({ conditions: { hex: { name: 'Hexed' } } }).find((c) => c.id === 'hex').icon).toBe('target');
    expect(conditionsOf({ conditions: { hex: { name: 'Hexed', short: 'cursed' } } }).find((c) => c.id === 'hex').short).toBe('CURSED');
  });

  it('keeps a standard name where the edit leaves it blank', () => {
    expect(conditionsOf({ conditions: { prone: { name: '  ' } } }).find((c) => c.id === 'prone').name).toBe('Prone');
  });

  it('carries rounds only on one that ends after rounds, whatever a draft holds', () => {
    expect(conditionsOf({ conditions: { prone: { rounds: 2 } } }).find((c) => c.id === 'prone')).not.toHaveProperty('rounds');
    expect(conditionsOf({ conditions: { prone: { ends: 'scene', rounds: 2 } } }).find((c) => c.id === 'prone')).toMatchObject({ ends: 'removed' });
  });

  it('never offers more than the limit, however many are written', () => {
    const many = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`c${i}`, { name: `C${i}` }]));
    expect(conditionsOf({ conditions: many })).toHaveLength(LIMITS.conditions);
  });
});

describe('the checks', () => {
  it('accept the standard set left alone, edited or turned off, and a system\'s own', () => {
    expect(check(undefined)).toEqual([]);
    expect(check({
      blinded: { on: false },
      poisoned: { name: 'Toxed', short: 'TOX', icon: 'pill', description: 'Sick.', ends: 'rounds', rounds: 3, modifiers: [{ target: 'all_rolls', amount: -1 }, { target: 'save', amount: 2 }] },
      glitching: { name: 'Glitching', short: 'GLITCH', icon: UPLOADED, description: '', ends: 'removed', modifiers: [] },
    })).toEqual([]);
  });

  it('refuses a section that isn\'t a set, ids that aren\'t ids, and entries that aren\'t conditions', () => {
    expect(messages([])).toEqual(['conditions: Must be a set of conditions']);
    expect(messages({ 'Bad Id': { name: 'X' }, ok: 'x' })).toEqual([
      'condition Bad Id: Ids use lowercase letters, digits and _, starting with a letter',
      'condition ok: Must be a condition',
    ]);
  });

  it('needs a name on the system\'s own, and keeps every text within its limit', () => {
    expect(messages({ hex: {} })).toEqual(['condition hex, name: Required']);
    expect(messages({ hex: { name: ' ' } })).toEqual(['condition hex, name: Cannot be blank']);
    expect(messages({ hex: { name: 'x'.repeat(31), short: 'TOOLONGXX', description: 'd'.repeat(301) } })).toEqual([
      'condition hex, name: Longer than 30 characters',
      'condition hex, short: Longer than 8 characters',
      'condition hex, description: Longer than 300 characters',
    ]);
    expect(messages({ prone: { name: 3 } })).toEqual(['condition prone, name: Must be text']);
  });

  it('turns off only a standard one, and refuses keys that aren\'t part of a condition', () => {
    expect(messages({ hex: { name: 'Hexed', on: false } })).toEqual([
      'condition hex, on: Only a standard condition is turned off; delete one of the system\'s own instead',
    ]);
    expect(messages({ prone: { on: 'no', color: 'red' } })).toEqual([
      'condition prone, color: Not part of a condition',
      'condition prone, on: Must say on: true or on: false',
    ]);
  });

  it('takes a drawn icon or an uploaded one, nothing else', () => {
    for (const ok of [...ICONS, UPLOADED, `/uploads/condition_icons/${HASH}.webp`, `/uploads/condition_icons/${HASH}.svg`]) expect(isIcon(ok), ok).toBe(true);
    for (const bad of ['eye', `/uploads/currency_icons/${HASH}.png`, `/uploads/condition_icons/${HASH}.gif`, `/uploads/condition_icons/${'a'.repeat(63)}.png`,
      `/uploads/condition_icons/../${HASH}.png`, `https://x.test/uploads/condition_icons/${HASH}.png`, '', 3, null]) {
      expect(isIcon(bad), String(bad)).toBe(false);
    }
    expect(messages({ prone: { icon: 'eye' } })).toEqual(['condition prone, icon: Must be one of the drawn icons or an uploaded one']);
  });

  it('ends when removed or after 1 to 99 rounds, and has rounds only then', () => {
    expect(messages({ prone: { ends: 'scene' } })).toEqual(['condition prone, ends: Ends when removed, after rounds, or at a rest']);
    for (const rounds of [0, 100, 2.5, '3', undefined]) {
      expect(messages({ prone: { ends: 'rounds', rounds } }), String(rounds)).toEqual(['condition prone, rounds: A whole number from 1 to 99']);
    }
    expect(check({ prone: { ends: 'rounds', rounds: 99 } })).toEqual([]);
    expect(messages({ prone: { rounds: 2 } })).toEqual(['condition prone, rounds: Only a condition that ends after rounds has rounds']);
  });

  it('modifies all rolls, or one of the system\'s stats or formulas, by a whole amount that isn\'t 0', () => {
    expect(messages({ prone: { modifiers: [{ target: 'dex', amount: -1 }, { target: 'str', amount: 0 }, { target: 'all_rolls', amount: 100 }, { target: 'str', amount: 1.5 }] } })).toEqual([
      'condition prone, modifier 1, target: Must be all rolls, or one of this system\'s stats or formulas',
      'condition prone, modifier 2, amount: A whole number from -99 to 99, not 0',
      'condition prone, modifier 3, amount: A whole number from -99 to 99, not 0',
      'condition prone, modifier 4, amount: A whole number from -99 to 99, not 0',
    ]);
    expect(messages({ prone: { modifiers: 'x' } })).toEqual(['condition prone, modifier: Must be a list of modifiers']);
    expect(messages({ prone: { modifiers: ['x', { target: 'str', amount: 1, note: 'n' }] } })).toEqual([
      'condition prone, modifier 1: Must say a target and an amount',
      'condition prone, modifier 2, note: Only a target and an amount',
    ]);
    expect(messages({ prone: { modifiers: Array.from({ length: 11 }, () => ({ target: 'str', amount: 1 })) } })).toEqual([
      'condition prone, modifier: At most 10 modifiers',
    ]);
  });

  it('allows as many as a table needs, up to sixty with the standard ones', () => {
    const own = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`c${i}`, { name: `C${i}` }]));
    expect(check(own(LIMITS.conditions - STANDARD.length))).toEqual([]);
    expect(messages(own(LIMITS.conditions - STANDARD.length + 1))).toEqual(['conditions: At most 60 conditions, the 10 standard ones included']);
    // Edits to the standard ones don't count twice.
    expect(check({ ...own(LIMITS.conditions - STANDARD.length), prone: { name: 'Down' } })).toEqual([]);
  });
});

describe('in a definition', () => {
  const base = {
    format: 1, name: 'Hearth',
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Strength' }] }],
    derived: [{ id: 'save', label: 'Save', formula: '16 - @str' }],
  };

  it('is a section the checks know, its modifiers reaching the system\'s own stats and formulas', () => {
    const def = { ...base, conditions: { prone: { modifiers: [{ target: 'str', amount: -1 }, { target: 'save', amount: 1 }] } } };
    expect(checkDefinition(def)).toEqual({ problems: [] });
    expect(checkDefinition({ ...base, conditions: { prone: { modifiers: [{ target: 'dex', amount: -1 }] } } }).problems).toEqual([
      { where: 'condition prone, modifier 1, target', message: 'Must be all rolls, or one of this system\'s stats or formulas' },
    ]);
  });
});

describe('uploading a condition\'s icon', () => {
  const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  const EDITOR = jwt.sign({ username: 'ghost', isTemporary: true }, 'test-secret');
  const PLAYER = jwt.sign({ username: 'vex', role: 'player' }, 'test-secret');
  const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../uploads/condition_icons');
  const created = [];
  let app;
  beforeEach(async () => {
    elevatedUsers.add('ghost');
    app = express();
    app.use(express.json());
    app.use('/api/systems', systemsRoute(await makeTestDb()));
  });
  afterEach(() => {
    elevatedUsers.delete('ghost');
    for (const f of created.splice(0)) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
  });
  const unique = (kind) => Buffer.from(`${kind} citynet-condition-test ${crypto.randomBytes(16).toString('hex')}`);
  const upload = async (body, name, token = GM) => {
    const res = await request(app).post('/api/systems/condition-icons').set({ Authorization: `Bearer ${token}` }).attach('icon', body, name);
    if (res.status === 200) created.push(path.join(DIR, path.basename(res.body.icon)));
    return res;
  };

  it('stores a PNG, WebP or SVG under its content hash, at an address a condition can name', async () => {
    for (const ext of ['png', 'webp', 'svg']) {
      const body = unique(ext);
      const res = await upload(body, `hex.${ext}`);
      const hash = crypto.createHash('sha256').update(body).digest('hex');
      expect(res.body, ext).toEqual({ icon: `/uploads/condition_icons/${hash}.${ext}` });
      expect(fs.readFileSync(path.join(DIR, `${hash}.${ext}`)).equals(body), ext).toBe(true);
      expect(isIcon(res.body.icon), ext).toBe(true);
    }
  });

  it('refuses another kind of file or one over a quarter of a megabyte, saying why', async () => {
    expect(UPLOAD.condition_icon).toBe(256 * 1024);
    expect((await upload(unique('gif'), 'hex.gif')).body).toMatchObject({ reason: 'UNSUPPORTED_FORMAT', allowed: ['.png', '.webp', '.svg'], maxBytes: UPLOAD.condition_icon });
    expect((await upload(Buffer.alloc(UPLOAD.condition_icon + 1, 1), 'huge.png')).body).toMatchObject({ reason: 'FILE_TOO_LARGE', error: '"huge.png" is over the 0.25MB limit.' });
    expect((await request(app).post('/api/systems/condition-icons').set({ Authorization: `Bearer ${GM}` })).body).toEqual({ error: 'No icon was sent' });
  });

  it('is the main admin\'s alone, and stores nothing for anybody else', async () => {
    const before = fs.existsSync(DIR) ? fs.readdirSync(DIR).length : 0;
    expect((await upload(unique('png'), 'a.png', EDITOR)).status).toBe(403);
    expect((await upload(unique('png'), 'a.png', PLAYER)).status).toBe(403);
    expect((await request(app).post('/api/systems/condition-icons').attach('icon', unique('png'), 'a.png')).status).toBe(401);
    expect(fs.existsSync(DIR) ? fs.readdirSync(DIR).length : 0).toBe(before);
  });
});
