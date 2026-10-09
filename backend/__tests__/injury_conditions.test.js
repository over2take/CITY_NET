/**
 * BLIND and BLEED moved from the injury map into conditions, once (4e2b1; decided with the user
 * 2026-10-09). A token with a flag gets the Blinded or Bleeding condition instead and keeps every
 * other injury and condition, on the token and in every game's saved values, so nothing is lost.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { makeTestDb, get, run, all } from './helpers/testDb.js';

const require_ = createRequire(import.meta.url);
const { moveInjuryConditions, moved, MARKER } = require_('../startup/injuryConditions');

/** A logger that says nothing, shaped like the console the move writes to. */
const quiet = { log: { log: () => {} } };

describe('one record moved', () => {
  it('turns each flag into its condition and takes the flag out, keeping the body and other conditions', () => {
    expect(moved('{"blind":true,"head":true,"bleeding":true}', '[{"id":"prone","left":2}]')).toEqual({
      injuries: '{"head":true}',
      conditions: '[{"id":"prone","left":2},{"id":"blinded"},{"id":"bleeding"}]',
    });
  });

  it('takes out a flag that was off without adding anything, and adds none twice', () => {
    expect(moved('{"blind":false,"torso":true}', '[]')).toEqual({ injuries: '{"torso":true}', conditions: '[]' });
    expect(moved('{"bleeding":true}', '[{"id":"bleeding"}]')).toEqual({ injuries: '{}', conditions: '[{"id":"bleeding"}]' });
  });

  it('leaves alone a record with neither flag, or one it can\'t read', () => {
    expect(moved('{"head":true}', '[]')).toBeNull();
    expect(moved('{}', '[]')).toBeNull();
    expect(moved('broken', '[]')).toBeNull();
    expect(moved(null, null)).toBeNull();
    expect(moved('{"blind":true}', 'broken')).toEqual({ injuries: '{}', conditions: '[{"id":"blinded"}]' });
  });
});

describe('the move on first start', () => {
  let db;
  let ids;
  beforeEach(async () => {
    db = await makeTestDb();
    const token = async (shape, injuries, conditions = '[]') => (await run(db,
      'INSERT INTO locations (name, x, y, z, shape, injuries, conditions) VALUES (?, 0, 0, 0, ?, ?, ?)', [shape, shape, injuries, conditions])).lastID;
    ids = {
      vex: await token('rhombus', '{"blind":true,"left_arm":true}'),
      ganger: await token('enemy_rhombus', '{"bleeding":true}', '[{"id":"prone"}]'),
      fine: await token('friendly_rhombus', '{"head":true}'),
      crate: await token('box', '{"blind":true}'),
    };
    await run(db, `INSERT INTO token_vitals (location_id, system, injuries, conditions) VALUES (?, 'shadowrun_6e', '{"bleeding":true}', '[]')`, [ids.vex]);
    await run(db, `INSERT INTO token_vitals (location_id, system, injuries, conditions) VALUES (?, 'cyberpunk_red', '{"torso":true}', '[]')`, [ids.ganger]);
  });
  const row = (id) => get(db, 'SELECT injuries, conditions FROM locations WHERE id = ?', [id]);

  it('moves every token\'s flags and every game\'s saved ones, and nothing else', async () => {
    expect(await moveInjuryConditions(db, quiet)).toEqual({ ran: true, changed: 3 });
    expect(await row(ids.vex)).toEqual({ injuries: '{"left_arm":true}', conditions: '[{"id":"blinded"}]' });
    expect(await row(ids.ganger)).toEqual({ injuries: '{}', conditions: '[{"id":"prone"},{"id":"bleeding"}]' });
    expect(await row(ids.fine)).toEqual({ injuries: '{"head":true}', conditions: '[]' });
    // Not a token: never touched.
    expect(await row(ids.crate)).toEqual({ injuries: '{"blind":true}', conditions: '[]' });
    expect(await all(db, 'SELECT location_id, system, injuries, conditions FROM token_vitals ORDER BY system')).toEqual([
      { location_id: ids.ganger, system: 'cyberpunk_red', injuries: '{"torso":true}', conditions: '[]' },
      { location_id: ids.vex, system: 'shadowrun_6e', injuries: '{}', conditions: '[{"id":"bleeding"}]' },
    ]);
  });

  it('runs once', async () => {
    await moveInjuryConditions(db, quiet);
    expect(await get(db, 'SELECT value FROM global_settings WHERE key = ?', [MARKER])).toBeTruthy();
    await run(db, `UPDATE locations SET injuries = '{"blind":true}' WHERE id = ?`, [ids.fine]);
    expect(await moveInjuryConditions(db, quiet)).toEqual({ ran: false });
    expect((await row(ids.fine)).injuries).toBe('{"blind":true}');
  });

  it('moves all or nothing', async () => {
    await run(db, 'CREATE TRIGGER no_vitals BEFORE UPDATE ON token_vitals BEGIN SELECT RAISE(ABORT, \'refused\'); END');
    await expect(moveInjuryConditions(db, quiet)).rejects.toThrow('refused');
    expect(await row(ids.vex)).toEqual({ injuries: '{"blind":true,"left_arm":true}', conditions: '[]' });
    expect(await get(db, 'SELECT value FROM global_settings WHERE key = ?', [MARKER])).toBeUndefined();
  });

  it('says how many records it moved', async () => {
    const lines = [];
    await moveInjuryConditions(db, { log: { log: (m) => lines.push(m) } });
    expect(lines).toEqual(['[tokens] Moved BLIND and BLEED into conditions on 3 token record(s).']);
  });
});
