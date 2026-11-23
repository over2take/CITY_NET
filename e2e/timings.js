// How long each browser journey took on CI (8n4): read from Playwright's JSON report, the slowest ten written as a table
// on the run's summary page, and every test's time kept as a file of the part's own, so the parts can be balanced by
// time rather than by count (ci.yml shares them out by count today, and they ran 4 to 12 minutes on 2026-11-22).
// Plain Node, no packages: the backend's tests read it too (backend/__tests__/e2e_timings.test.js).
//
//   node timings.js <report.json> <part> <timings.json>   prints the table, writes the file

const fs = require('fs');

/** The slowest this many are listed on the summary page; the file keeps every one. */
const SHOWN = 10;

/** Every test in the report, slowest first: where it is, its name, its seconds over every try, how many tries, how it ended. */
const rowsOf = (report) => {
  const rows = [];
  const walk = (suite) => {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        const results = test.results || [];
        const ms = results.reduce((sum, r) => sum + (Number(r.duration) || 0), 0);
        rows.push({
          file: spec.file || '',
          line: spec.line || 0,
          title: spec.title || '',
          seconds: Math.round(ms / 100) / 10,
          tries: results.length,
          // Playwright's own word: expected (passed), unexpected (failed), flaky (passed on a retry), skipped.
          outcome: test.status || 'unknown',
        });
      }
    }
    for (const child of suite.suites || []) walk(child);
  };
  for (const suite of (report && report.suites) || []) walk(suite);
  return rows.sort((a, b) => b.seconds - a.seconds || a.file.localeCompare(b.file) || a.line - b.line);
};

/** Minutes and seconds, as a person reads a duration: 3m 51s, or 42s. */
const clock = (seconds) => {
  const s = Math.round(seconds);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
};

/** What a test's last column says beside its name: retried, failed, or nothing for a plain pass. */
const mark = (row) => (row.outcome === 'unexpected' ? ' **FAILED**' : row.outcome === 'flaky' ? ' (passed on a retry)' : row.tries > 1 ? ' (retried)' : '');

/** The table for the run's summary page: the part, how many tests and their time together, then the slowest. */
const summaryOf = (rows, part) => {
  const total = rows.reduce((sum, r) => sum + r.seconds, 0);
  const lines = [
    `### Browser Journeys, part ${part}: ${rows.length} test${rows.length === 1 ? '' : 's'}, ${clock(total)} of testing`,
    '',
  ];
  if (!rows.length) return [...lines, 'No tests ran.', ''].join('\n');
  lines.push(`The slowest ${Math.min(SHOWN, rows.length)}:`, '', '| SECONDS | TRIES | TEST |', '|---:|---:|---|');
  for (const r of rows.slice(0, SHOWN)) lines.push(`| ${r.seconds.toFixed(1)} | ${r.tries} | ${r.file}:${r.line} ${r.title.replace(/\|/g, '\\|')}${mark(r)} |`);
  return [...lines, ''].join('\n');
};

if (require.main === module) {
  const [reportPath, part, outPath] = process.argv.slice(2);
  // A part that never got to write its report (a hang, a build that failed) says so, rather than failing this step too.
  if (!reportPath || !fs.existsSync(reportPath)) {
    process.stdout.write(`### Browser Journeys, part ${part || '?'}: no report was written\n`);
  } else {
    const rows = rowsOf(JSON.parse(fs.readFileSync(reportPath, 'utf8')));
    process.stdout.write(summaryOf(rows, part));
    if (outPath) fs.writeFileSync(outPath, JSON.stringify({ part: Number(part), tests: rows }, null, 2));
  }
}

module.exports = { rowsOf, summaryOf, clock, SHOWN };
