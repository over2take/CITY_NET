/**
 * A browser journey's system and player names belong to that test alone. On CI the tests of a part share
 * one database and a system's name is unique, so two tests with one name clash: the second is refused,
 * passes on its retry under the next name, and shows only as flaky until a third takes that one too.
 * Which tests meet depends on how the parts split, so it is checked here rather than left to them.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const TESTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'e2e', 'tests');

/** The names a spec's text makes: a template ending in the retry, and any player's username. */
const namesIn = (text) => [
  ...[...text.matchAll(/`([^`$\r\n]+?)\s*\$\{(?:info\.retry[^}]*|again|retry)\}`/g)].map((m) => m[1].trim()),
  ...[...text.matchAll(/username:\s*[`']([^`'$\r\n]+)/g)].map((m) => m[1].trim()),
  // `_${info.retry + 1}` is the retry's own suffix, not a name.
].filter((n) => !/^_*$/.test(n));

/** Each name made by more than one test, with where: { spec file name: its text }. */
const sharedNames = (specs) => {
  const seen = new Map();
  for (const [file, text] of Object.entries(specs)) {
    // The part before a file's first test is its helpers, counted as one.
    text.split(/\r?\n(?=test(?:\.\w+)?\()/).forEach((part, i) => {
      for (const name of new Set(namesIn(part))) seen.set(name, [...(seen.get(name) ?? []), `${file} #${i}`]);
    });
  }
  return { count: seen.size, shared: [...seen].filter(([, where]) => where.length > 1).map(([name, where]) => `${name}: ${where.join(', ')}`) };
};

const test_ = (name) => `\ntest('t', async ({ request }, info) => {\n  const name = \`${name} \${info.retry + 1}\`;\n});`;

describe('how a clash is found', () => {
  it('between files, and between two tests of one file', () => {
    expect(sharedNames({ 'a.spec.ts': test_('Rolling Hearth'), 'b.spec.ts': test_('Rolling Hearth') }).shared).toEqual(['Rolling Hearth: a.spec.ts #1, b.spec.ts #1']);
    expect(sharedNames({ 'a.spec.ts': `${test_('Hearth')}${test_('Hearth')}` }).shared).toEqual(['Hearth: a.spec.ts #1, a.spec.ts #2']);
  });

  it('whichever way the retry is written, and with Windows line endings', () => {
    const again = (name) => `\ntest('t', async () => {\n  run(definition(\`${name}\${again}\`));\n});`;
    expect(sharedNames({ 'a.spec.ts': again('Rollfall'), 'b.spec.ts': test_('Rollfall') }).shared).toHaveLength(1);
    const crlf = (name) => `\r\ntest('t', async () => {\r\n  const a = \`${name} \${retry}\`;\r\n});`;
    expect(sharedNames({ 'a.spec.ts': `${crlf('X')}${crlf('X')}` }).shared).toEqual(['X: a.spec.ts #1, a.spec.ts #2']);
  });

  it('among players too', () => {
    const player = (name) => `\ntest('t', async () => {\n  const p = { username: \`${name}\${again}\` };\n});`;
    expect(sharedNames({ 'a.spec.ts': player('e2e_kes'), 'b.spec.ts': player('e2e_kes') }).shared).toHaveLength(1);
    const fixed = "\ntest('t', async () => {\n  const p = { username: 'e2e_kes' };\n});";
    expect(sharedNames({ 'a.spec.ts': fixed, 'b.spec.ts': fixed }).shared).toHaveLength(1);
  });

  it('not a name used twice within one test, nor different names, nor the retry\'s own suffix', () => {
    const twice = `\ntest('t', async ({ info }) => {\n  const a = \`Hearth \${info.retry}\`;\n  const b = \`Hearth \${info.retry}\`;\n});`;
    expect(sharedNames({ 'a.spec.ts': twice }).shared).toEqual([]);
    expect(sharedNames({ 'a.spec.ts': test_('One'), 'b.spec.ts': test_('Two') }).shared).toEqual([]);
    const suffix = "\ntest('t', async ({ info }) => {\n  const again = info.retry ? `_${info.retry + 1}` : '';\n});";
    expect(sharedNames({ 'a.spec.ts': suffix, 'b.spec.ts': suffix }).shared).toEqual([]);
  });
});

describe('the journeys', () => {
  const specs = Object.fromEntries(fs.readdirSync(TESTS).filter((f) => f.endsWith('.spec.ts')).map((f) => [f, fs.readFileSync(path.join(TESTS, f), 'utf8')]));

  it('are all read, so this can\'t pass by finding nothing', () => {
    expect(sharedNames(specs).count).toBeGreaterThan(50);
  });

  it('each use names of their own', () => {
    expect(sharedNames(specs).shared).toEqual([]);
  });
});
