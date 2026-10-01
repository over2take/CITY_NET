import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, run } from './helpers/testDb.js';

/**
 * The glossary's plumbing (Layer 1): a custom system's words for the app's terms, every form
 * resolved on the server, and a lookup for text the server writes that leaves the built-in
 * systems' wording exactly as it is.
 */

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { resolveWords, TERMS, WORD_FORMS } = require_('../systemBuilder/definition');
const runtime = require_('../systemBuilder/runtime');

const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const gm = { Authorization: `Bearer ${GM}` };
const FANTASY = { format: 1, name: 'Hearth', words: { hp: { singular: 'WOUND', plural: 'WOUNDS' }, money: { plural: 'GOLD', short: 'GP' }, gm: { singular: 'WARDEN' } } };

describe('resolving a system\'s words', () => {
  it('gives every term in every form', () => {
    const words = resolveWords(FANTASY);
    expect(Object.keys(words).sort()).toEqual(Object.keys(TERMS).sort());
    for (const term of Object.keys(TERMS)) expect(Object.keys(words[term]).sort(), term).toEqual([...WORD_FORMS].sort());
  });

  it('uses the system\'s own words, and the neutral defaults for the rest', () => {
    const words = resolveWords(FANTASY);
    expect(words.hp).toEqual({ singular: 'WOUND', plural: 'WOUNDS', short: 'HP' });
    expect(words.money).toEqual({ singular: 'CREDIT', plural: 'GOLD', short: 'GP' });
    expect(words.gm.singular).toBe('WARDEN');
    expect(words.level).toEqual({ singular: 'LEVEL', plural: 'LEVELS', short: 'LVL' });
    // A term with no short form uses its singular.
    expect(words.character.short).toBe('CHARACTER');
    expect(resolveWords({ name: 'Bare' })).toEqual(resolveWords({}));
  });

  it('sends the browser the resolved words with a custom system\'s sheet', () => {
    expect(runtime.renderOf('sys_0123456789abcdef', FANTASY).words).toEqual(resolveWords(FANTASY));
  });
});

describe('the server\'s own text', () => {
  let db;
  let app;
  beforeEach(async () => {
    db = await makeTestDb();
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cities_without_number')`);
    app = express();
    app.use(express.json());
    app.use('/api/systems', require_('../routes/systems.js')(db));
    await new Promise((resolve) => runtime.load(db, resolve));
  });

  it('keeps every built-in system\'s wording exactly as it is', () => {
    for (const system of ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic', null, undefined]) {
      expect(runtime.wordIn(system, 'money', 'plural', 'EDDIES'), String(system)).toBe('EDDIES');
    }
  });

  it('uses a published custom system\'s words, defaults included', async () => {
    const { id } = (await request(app).post('/api/systems').set(gm).send({ definition: FANTASY })).body;
    expect(runtime.wordIn(id, 'gm', 'singular', 'GM')).toBe('GM');
    await request(app).post(`/api/systems/${id}/publish`).set(gm);
    expect(runtime.wordIn(id, 'gm', 'singular', 'GM')).toBe('WARDEN');
    expect(runtime.wordIn(id, 'money', 'short', 'CR')).toBe('GP');
    // A term it did not rename: the neutral default, not the built-in text of that place.
    expect(runtime.wordIn(id, 'xp', 'short', 'EXP')).toBe('XP');
    expect(runtime.wordIn(id, 'nonsense', 'singular', 'KEPT')).toBe('KEPT');
    await request(app).delete(`/api/systems/${id}`).set(gm);
    expect(runtime.wordIn(id, 'gm', 'singular', 'GM')).toBe('GM');
  });
});
