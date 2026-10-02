/**
 * A system's bank settings (3c2b1): whether the bank window's celebrations run. The user decided
 * on 2026-10-02 that they are an option for every custom system, off unless its GM turns them on,
 * and that whale status also needs a threshold of the GM's own, in the main currency. Every
 * built-in system keeps them as today: none has a render copy, so the browser keeps its own rule
 * there (3c2b2).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const { bankOf } = require_('../systemBuilder/bank');
const runtime = require_('../systemBuilder/runtime');

const problems = (bank) => checkDefinition({ format: 1, name: 'A', bank }).problems.map((p) => `${p.where}: ${p.message}`);

describe('the bank section', () => {
  it('takes celebrations on or off, and a whale threshold with them on', () => {
    expect(problems(undefined)).toEqual([]);
    expect(problems({})).toEqual([]);
    expect(problems({ celebrations: false })).toEqual([]);
    expect(problems({ celebrations: true })).toEqual([]);
    expect(problems({ celebrations: true, whale: 1 })).toEqual([]);
    expect(problems({ celebrations: true, whale: 50000 })).toEqual([]);
  });

  it('names each setting it cannot take', () => {
    expect(problems('on')).toEqual(['bank: Must be the bank\'s settings']);
    expect(problems([])).toEqual(['bank: Must be the bank\'s settings']);
    expect(problems({ celebrations: 'yes' })).toEqual(['bank, celebrations: Must be true or false']);
    expect(problems({ confetti: true })).toEqual(['bank, confetti: Not a bank setting']);
    const whale = 'bank, whale: Must be a whole amount of the main currency\'s smallest unit, 1 or more';
    for (const bad of [0, -5, 2.5, '500 gp', Number.MAX_SAFE_INTEGER + 1, null]) {
      expect(problems({ celebrations: true, whale: bad }), String(bad)).toEqual([whale]);
    }
  });

  it('wants celebrations on for a whale threshold, which means nothing without them', () => {
    expect(problems({ whale: 50000 })).toEqual(['bank, whale: Only with celebrations on']);
    expect(problems({ celebrations: false, whale: 50000 })).toEqual(['bank, whale: Only with celebrations on']);
  });
});

describe('the settings the browser is sent', () => {
  it('are off unless turned on, a threshold only while they are', () => {
    expect(bankOf({ name: 'A' })).toEqual({ celebrations: false, whale: null });
    expect(bankOf({ name: 'A', bank: {} })).toEqual({ celebrations: false, whale: null });
    expect(bankOf({ name: 'A', bank: { celebrations: true } })).toEqual({ celebrations: true, whale: null });
    expect(bankOf({ name: 'A', bank: { celebrations: true, whale: 50000 } })).toEqual({ celebrations: true, whale: 50000 });
    // A draft can hold a problem; what is sent never carries it.
    expect(bankOf({ name: 'A', bank: { whale: 50000 } })).toEqual({ celebrations: false, whale: null });
    expect(bankOf({ name: 'A', bank: { celebrations: true, whale: 0 } })).toEqual({ celebrations: true, whale: null });
    expect(bankOf({ name: 'A', bank: { celebrations: 'yes' } })).toEqual({ celebrations: false, whale: null });
    expect(bankOf(null)).toEqual({ celebrations: false, whale: null });
  });
});

describe('the running game', () => {
  const ON = 'sys_aaaaaaaaaaaaaaaa';
  const PLAIN = 'sys_bbbbbbbbbbbbbbbb';
  const run = (db, sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
  beforeEach(async () => {
    const db = new sqlite3.Database(':memory:');
    await run(db, 'CREATE TABLE custom_systems (id TEXT PRIMARY KEY, name TEXT, draft TEXT, published TEXT, version INTEGER, deleted_at DATETIME)');
    for (const [id, definition] of [
      [ON, { format: 1, name: 'Hearth', currencies: [{ id: 'gold', name: 'Gold' }], bank: { celebrations: true, whale: 50000 } }],
      [PLAIN, { format: 1, name: 'Plain' }],
    ]) {
      const text = JSON.stringify(definition);
      await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [id, definition.name, text, text]);
    }
    await new Promise((resolve) => runtime.load(db, resolve));
  });

  it('sends a custom system\'s bank settings to the browser, off when it says nothing', () => {
    expect(runtime.render(ON).bank).toEqual({ celebrations: true, whale: 50000 });
    expect(runtime.render(PLAIN).bank).toEqual({ celebrations: false, whale: null });
  });

  it('has no render copy for a built-in system, which keeps its celebrations as today', () => {
    for (const system of ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic']) {
      expect(runtime.render(system), system).toBeNull();
    }
  });
});
