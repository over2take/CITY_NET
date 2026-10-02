import { describe, it, expect, beforeEach } from 'vitest';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

/**
 * Which parts of the app the running system uses (3b1). Every built-in system, and any id the
 * server does not know, has every part on, so each place keeps today's own rule. A published
 * custom system has a part off only where its definition says so; a draft never counts, and
 * a deleted system is not running. Nothing is hidden by this yet.
 */

const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const { PARTS } = require_('../systemBuilder/definition');

const OFF = 'sys_aaaaaaaaaaaaaaaa';
const PLAIN = 'sys_bbbbbbbbbbbbbbbb';
const DRAFTED = 'sys_cccccccccccccccc';
const DELETED = 'sys_dddddddddddddddd';
const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];

const run = (db, sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
const def = (name, parts) => JSON.stringify({ format: 1, name, ...(parts ? { parts } : {}) });
const offWith = (bankOn) => def('Hearth', { bank: { on: bankOn }, vehicles: { on: false }, shops: { on: true } });

let db;
beforeEach(async () => {
  db = new sqlite3.Database(':memory:');
  await run(db, `CREATE TABLE custom_systems (id TEXT PRIMARY KEY, name TEXT, draft TEXT, published TEXT, version INTEGER, deleted_at DATETIME)`);
  const rows = [
    [OFF, offWith(false), offWith(false), null],
    [PLAIN, def('Plain'), def('Plain'), null],
    // Its draft turns the bank off; what runs is the published version, which does not.
    [DRAFTED, def('Drafted', { bank: { on: false } }), def('Drafted'), null],
    [DELETED, def('Gone', { bank: { on: false } }), def('Gone', { bank: { on: false } }), '2026-10-01'],
  ];
  for (const [id, draft, published, deleted] of rows) {
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version, deleted_at) VALUES (?, ?, ?, ?, 1, ?)',
      [id, id, draft, published, deleted]);
  }
  await new Promise((resolve) => runtime.load(db, resolve));
});

const offIn = (system) => PARTS.filter((p) => !runtime.partIn(system, p));

describe('partIn', () => {
  it('has every part on under every built-in system, and for an id it does not know', () => {
    for (const system of [...BUILT_INS, undefined, null, '', 'sys_eeeeeeeeeeeeeeee']) {
      expect(offIn(system), String(system)).toEqual([]);
    }
  });

  it('has every part on in a custom system that turned none off', () => {
    expect(offIn(PLAIN)).toEqual([]);
  });

  it('has off exactly the parts a custom system turned off', () => {
    expect(offIn(OFF)).toEqual(['bank', 'vehicles']);
  });

  it('reads the published version, never a draft, and nothing of a deleted system', () => {
    expect(offIn(DRAFTED)).toEqual([]);
    expect(offIn(DELETED)).toEqual([]);
  });

  it('follows a new version: a part turned back on is on again', async () => {
    await run(db, 'UPDATE custom_systems SET published = ?, version = 2 WHERE id = ?', [offWith(true), OFF]);
    await new Promise((resolve) => runtime.refresh(db, OFF, resolve));
    expect(offIn(OFF)).toEqual(['vehicles']);
  });

  it('refuses a part the app does not have, so a misspelling fails rather than reading as on', () => {
    expect(() => runtime.partIn(OFF, 'bnak')).toThrow(/Not a part of the app/);
    expect(() => runtime.partIn('generic', 'vehicle')).toThrow(/Not a part of the app/);
  });
});

describe('the render copy the browser reads', () => {
  it('carries the parts as the system set them', () => {
    expect(runtime.render(OFF).parts).toEqual({ bank: { on: false }, vehicles: { on: false }, shops: { on: true } });
    expect(runtime.render(PLAIN).parts).toEqual({});
  });

  it('names the same parts as the browser does (frontend/src/sheets/parts.ts)', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readFileSync(path.join(here, '../../frontend/src/sheets/parts.ts'), 'utf8');
    const list = source.match(/export const PARTS = \[([\s\S]*?)\] as const;/);
    expect(list).not.toBeNull();
    expect([...list[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual(PARTS);
  });
});
