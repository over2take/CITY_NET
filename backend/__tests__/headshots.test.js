import { describe, it, expect } from 'vitest';
const headshots = require('../sheets/headshots');
const fs = require('fs');
const path = require('path');

describe('stock headshot pools', () => {
  it('enemy pool serves from /npc-headshots/, friendly from /friendly-headshots/', () => {
    expect(headshots.ENEMY_HEADSHOTS.length).toBeGreaterThan(0);
    expect(headshots.FRIENDLY_HEADSHOTS.length).toBeGreaterThan(0);
    headshots.ENEMY_HEADSHOTS.forEach(u => expect(u).toMatch(/^\/npc-headshots\/.+\.png$/));
    headshots.FRIENDLY_HEADSHOTS.forEach(u => expect(u).toMatch(/^\/friendly-headshots\/.+\.png$/));
  });

  it('headshotsForShape picks the matching pool, both pools when shape unknown', () => {
    expect(headshots.headshotsForShape('enemy_rhombus')).toBe(headshots.ENEMY_HEADSHOTS);
    expect(headshots.headshotsForShape('friendly_rhombus')).toBe(headshots.FRIENDLY_HEADSHOTS);
    expect(headshots.headshotsForShape(undefined)).toEqual(headshots.ALL_HEADSHOTS);
    expect(headshots.headshotsForShape('rhombus')).toEqual(headshots.ALL_HEADSHOTS);
  });

  it('randomHeadshot returns a url from the shape pool', () => {
    for (let i = 0; i < 20; i++) {
      expect(headshots.ENEMY_HEADSHOTS).toContain(headshots.randomHeadshot('enemy_rhombus'));
      expect(headshots.FRIENDLY_HEADSHOTS).toContain(headshots.randomHeadshot('friendly_rhombus'));
    }
  });

  it('isStockHeadshot accepts bundled urls and rejects everything else', () => {
    expect(headshots.isStockHeadshot(headshots.ENEMY_HEADSHOTS[0])).toBe(true);
    expect(headshots.isStockHeadshot(headshots.FRIENDLY_HEADSHOTS[0])).toBe(true);
    expect(headshots.isStockHeadshot('/npc-headshots/../secrets.png')).toBe(false);
    expect(headshots.isStockHeadshot('/uploads/whatever.png')).toBe(false);
    expect(headshots.isStockHeadshot('https://evil.example/x.png')).toBe(false);
  });

  it('every listed headshot exists in frontend/public', () => {
    const pub = path.join(__dirname, '..', '..', 'frontend', 'public');
    headshots.ALL_HEADSHOTS.forEach(u => {
      expect(fs.existsSync(path.join(pub, u.slice(1))), `${u} missing from frontend/public`).toBe(true);
    });
  });
});
