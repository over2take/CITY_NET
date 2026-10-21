/**
 * Every roll on the server comes from the secure source (utils/random.js cryptoRng), as the rolls
 * mockup decided (docs/mockups/builder-rolls.html, 2026-10-19, "Random source"). The built-in
 * games' sheet rolls, attacks, NPC rolls and a vehicle's ram used Math.random until 6d; a custom
 * system's rolls never did. Held here so none goes back: a file that rolls dice never names
 * Math.random. (A face picture picked for a new NPC, a file name or a boot id isn't a roll.)
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
/** What a file that rolls dice calls or passes: the engine's rolls, or a source of dice handed on. */
const ROLLS = /\b(executeRoll|rollToHit|makeRoll|rollField|rollTier|rollDie|rng)\b/;

const sources = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  if (e.name === 'node_modules' || e.name === '__tests__' || e.name.startsWith('.')) return [];
  const p = path.join(dir, e.name);
  return e.isDirectory() ? sources(p) : e.name.endsWith('.js') ? [p] : [];
});

describe('the server\'s dice', () => {
  const rolling = sources(BACKEND).filter((f) => ROLLS.test(fs.readFileSync(f, 'utf8')));

  it('are found where the rolls are: the sockets, the sheets\' engines, a custom system\'s rolls', () => {
    const names = rolling.map((f) => path.relative(BACKEND, f).replace(/\\/g, '/'));
    for (const f of ['sockets/index.js', 'sheets/rollEngine.js', 'sheets/attack.js', 'systemBuilder/rollStyles.js', 'systemBuilder/tableRolls.js']) expect(names).toContain(f);
  });

  it('never come from Math.random in a file that rolls', () => {
    const weak = rolling.filter((f) => /Math\.random/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(BACKEND, f));
    expect(weak).toEqual([]);
  });

  it('come from the secure source when none is handed in: every default source of dice is it', () => {
    const defaults = rolling.flatMap((f) => [...fs.readFileSync(f, 'utf8').matchAll(/\brng\s*=\s*([A-Za-z_.]+)/g)].map((m) => `${path.relative(BACKEND, f)}: ${m[1]}`));
    expect(defaults.length).toBeGreaterThan(5);
    // null is a preview's: nothing rolled at all (a rest shows its dice still to roll).
    expect(defaults.filter((d) => !d.endsWith(': cryptoRng') && !d.endsWith(': null'))).toEqual([]);
  });
});
