/**
 * How long each browser journey took on CI (8n4, e2e/timings.js): Playwright's JSON report read into every test's time,
 * slowest first, retries counted in; the slowest ten as a table for the run's summary page; and a part that wrote no
 * report says so without failing the step.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'e2e', 'timings.js');
const { rowsOf, summaryOf, clock, SHOWN } = createRequire(import.meta.url)(SCRIPT);

const spec = (file, line, title, durations, status = 'expected') => ({ title, file, line, tests: [{ status, results: durations.map((duration, retry) => ({ duration, retry })) }] });
const REPORT = {
  suites: [
    { title: 'a.spec.ts', file: 'a.spec.ts', specs: [spec('a.spec.ts', 8, 'quick one', [3400])],
      // A describe block inside the file: its tests are found too.
      // Each spec names its own file, as Playwright's do.
      suites: [{ title: 'in a block', specs: [spec('a.spec.ts', 30, 'slow | piped', [61000])] }] },
    { title: 'b.spec.ts', file: 'b.spec.ts', specs: [spec('b.spec.ts', 12, 'flaky one', [120000, 9500], 'flaky'), spec('b.spec.ts', 50, 'broken one', [8000, 7000], 'unexpected')] },
  ],
};

describe('the times', () => {
  it('every test, in blocks too, slowest first, its tries added together and counted', () => {
    expect(rowsOf(REPORT)).toEqual([
      { file: 'b.spec.ts', line: 12, title: 'flaky one', seconds: 129.5, tries: 2, outcome: 'flaky' },
      { file: 'a.spec.ts', line: 30, title: 'slow | piped', seconds: 61, tries: 1, outcome: 'expected' },
      { file: 'b.spec.ts', line: 50, title: 'broken one', seconds: 15, tries: 2, outcome: 'unexpected' },
      { file: 'a.spec.ts', line: 8, title: 'quick one', seconds: 3.4, tries: 1, outcome: 'expected' },
    ]);
    expect(rowsOf({})).toEqual([]);
  });

  it('as a person reads a duration', () => {
    expect(clock(42.4)).toBe('42s');
    expect(clock(231)).toBe('3m 51s');
    expect(clock(60)).toBe('1m 0s');
  });
});

describe('the summary page', () => {
  it('the part, its tests and their time; the slowest as a table, a failure and a retry said', () => {
    const text = summaryOf(rowsOf(REPORT), 5);
    expect(text.split('\n')).toEqual([
      '### Browser Journeys, part 5: 4 tests, 3m 29s of testing',
      '',
      'The slowest 4:',
      '',
      '| SECONDS | TRIES | TEST |',
      '|---:|---:|---|',
      '| 129.5 | 2 | b.spec.ts:12 flaky one (passed on a retry) |',
      '| 61.0 | 1 | a.spec.ts:30 slow \\| piped |',
      '| 15.0 | 2 | b.spec.ts:50 broken one **FAILED** |',
      '| 3.4 | 1 | a.spec.ts:8 quick one |',
      '',
    ]);
  });

  it('only the slowest ten; a part with none says so', () => {
    expect(SHOWN).toBe(10);
    const many = { suites: [{ file: 'm.spec.ts', specs: Array.from({ length: 14 }, (_, n) => spec('m.spec.ts', n + 1, `t${n}`, [1000 * (n + 1)])) }] };
    const text = summaryOf(rowsOf(many), 2);
    expect(text).toContain('14 tests');
    expect(text).toContain('The slowest 10:');
    expect(text.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| SECONDS'))).toHaveLength(10);
    expect(summaryOf(rowsOf({ suites: [{ file: 'o.spec.ts', specs: [spec('o.spec.ts', 3, 'only', [2000])] }] }), 4)).toContain('part 4: 1 test, 2s of testing');
    expect(summaryOf([], 3)).toBe('### Browser Journeys, part 3: 0 tests, 0s of testing\n\nNo tests ran.\n');
  });
});

describe('run on CI', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-timings-'));

  it('prints the table and writes every test\'s time to the part\'s file', () => {
    const report = path.join(dir, 'report.json');
    const out = path.join(dir, 'timings-part-5.json');
    fs.writeFileSync(report, JSON.stringify(REPORT));
    const printed = execFileSync(process.execPath, [SCRIPT, report, '5', out], { encoding: 'utf8' });
    expect(printed).toBe(summaryOf(rowsOf(REPORT), 5));
    expect(JSON.parse(fs.readFileSync(out, 'utf8'))).toEqual({ part: 5, tests: rowsOf(REPORT) });
  });

  it('a part that wrote no report says so, and the step still passes', () => {
    const printed = execFileSync(process.execPath, [SCRIPT, path.join(dir, 'none.json'), '7', path.join(dir, 'x.json')], { encoding: 'utf8' });
    expect(printed).toBe('### Browser Journeys, part 7: no report was written\n');
    expect(fs.existsSync(path.join(dir, 'x.json'))).toBe(false);
  });
});
