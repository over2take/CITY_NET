import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const rolls = require('../sheets/rolls.js');

/**
 * A roll button on the sheet is only a button. The roll itself is resolved server-side
 * by field id, so a template that offers one the server does not know about renders a
 * control that fails when pressed — which is what adding BODY to the sheet alone would
 * have done.
 */

const templateSrc = fs.readFileSync(
  path.join(import.meta.dirname, '..', '..', 'frontend', 'src', 'sheets', 'templates', 'cyberpunk_red.ts'),
  'utf8'
);

/**
 * Field ids the template gives a roll button to.
 *
 * Read line by line — fields are declared one per line, and a regex spanning object
 * boundaries picks up the section id instead.
 */
const buttonedFields = templateSrc
  .split(/\r?\n/)
  .filter(line => line.includes('roll: {'))
  .map(line => /id:\s*'([a-z0-9_]+)'/.exec(line))
  .filter(Boolean)
  .map(m => m[1]);

describe('Cyberpunk RED stat rolls', () => {
  it('gives BODY a roll, like the other stats', () => {
    const roll = rolls.getRoll('cyberpunk_red', 'body');
    expect(roll).toBeTruthy();
    expect(roll.formula).toBe('1d10 + @body');
    // CP:R d10s explode; a stat roll that did not would be quietly wrong rather than
    // visibly broken.
    expect(roll.shape).toBe('explode10');
  });

  it('leaves MOVE and LUCK unrollable', () => {
    // MOVE is a movement allowance rather than a check, and LUCK is a pool you spend.
    expect(rolls.getRoll('cyberpunk_red', 'move')).toBeNull();
    expect(rolls.getRoll('cyberpunk_red', 'luck')).toBeNull();
  });

  it('backs every roll button in the template with a server-side roll', () => {
    // The general form of the bug, not just BODY: the two sides are separate files and
    // nothing else makes them agree.
    expect(buttonedFields.length).toBeGreaterThan(5);
    for (const id of buttonedFields) {
      expect(rolls.getRoll('cyberpunk_red', id), `${id} has a button but no server roll`).toBeTruthy();
    }
  });
});
