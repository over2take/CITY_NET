import { describe, it, expect, beforeEach } from 'vitest';
const sqlite3 = require('sqlite3');
const identity = require('../sheets/identity');

const run = (db, sql, p = []) => new Promise((res, rej) => db.run(sql, p, (e) => (e ? rej(e) : res())));
const get = (db, sql, p = []) => new Promise((res, rej) => db.get(sql, p, (e, r) => (e ? rej(e) : res(r))));

describe('player identity (sheet as source of truth)', () => {
  let db;
  beforeEach(async () => {
    db = new sqlite3.Database(':memory:');
    await run(db, `CREATE TABLE character_sheets (id INTEGER PRIMARY KEY, username TEXT, system TEXT, data TEXT, is_npc INTEGER DEFAULT 0)`);
    await run(db, `CREATE TABLE locations (id INTEGER PRIMARY KEY, name TEXT, description TEXT, shape TEXT, owner TEXT)`);
  });

  it('nameField is name for every current system (CP:R relabels it Handle)', () => {
    expect(identity.nameField('cyberpunk_red')).toBe('name');
    expect(identity.nameField('cities_without_number')).toBe('name');
    expect(identity.nameField('generic')).toBe('name');
  });

  it('refresh caches the sheet name; displayName falls back to username', async () => {
    await run(db, `INSERT INTO character_sheets (username, system, data) VALUES ('cody', 'cyberpunk_red', ?)`,
      [JSON.stringify({ name: 'V', description: 'merc' })]);
    await new Promise((res) => identity.refresh(db, 'cyberpunk_red', 'cody', res));
    expect(identity.displayName('cody')).toBe('V');
    expect(identity.displayName('nobody')).toBe('nobody');
  });

  it('syncToken mirrors sheet name/description onto the rhombus', async () => {
    await run(db, `INSERT INTO character_sheets (username, system, data) VALUES ('cody', 'cyberpunk_red', ?)`,
      [JSON.stringify({ name: 'V', description: 'merc for hire' })]);
    await run(db, `INSERT INTO locations (name, description, shape, owner) VALUES ('old', 'stale', 'rhombus', 'cody')`);
    const changed = await new Promise((res) => identity.syncToken(db, 'cyberpunk_red', 'cody', res));
    expect(changed).toBe(true);
    const loc = await get(db, `SELECT name, description FROM locations WHERE owner = 'cody'`);
    expect(loc.name).toBe('V');
    expect(loc.description).toBe('merc for hire');
  });

  it('syncToken reports false without a sheet or token', async () => {
    expect(await new Promise((res) => identity.syncToken(db, 'generic', 'ghost', res))).toBe(false);
    await run(db, `INSERT INTO character_sheets (username, system, data) VALUES ('ghost', 'generic', '{}')`);
    expect(await new Promise((res) => identity.syncToken(db, 'generic', 'ghost', res))).toBe(false);
  });

  it('does not touch enemy/friendly tokens owned by the same user', async () => {
    await run(db, `INSERT INTO character_sheets (username, system, data) VALUES ('gm', 'generic', ?)`,
      [JSON.stringify({ name: 'GM Guy' })]);
    await run(db, `INSERT INTO locations (name, shape, owner) VALUES ('BADDIE', 'enemy_rhombus', 'gm')`);
    await new Promise((res) => identity.syncToken(db, 'generic', 'gm', res));
    const loc = await get(db, `SELECT name FROM locations WHERE shape = 'enemy_rhombus'`);
    expect(loc.name).toBe('BADDIE');
  });
});
