#!/usr/bin/env node
// A mutation check: breaks the code on purpose, one small change at a time, and runs the tests that
// guard it. A break the tests catch (they fail) is "caught"; one they miss "survived", and points at
// a missing test or code that isn't needed. See .claude/skills/mutation-check/SKILL.md.
//
//   node scripts/mutation-check.js plan.json     run the plan
//   node scripts/mutation-check.js --restore     put files back after a run was killed
//
// plan.json, paths from the repo root:
//   {
//     "tests": { "server": { "cwd": "backend", "cmd": "npx vitest run --maxWorkers=2 --bail=1 __tests__/x.test.js" } },
//     "files": [
//       { "file": "backend/systemBuilder/x.js", "tests": "server",
//         "mutants": [["const most = 20;", "const most = 2;"], ["if (a && b)", "if (a)"]] }
//     ]
//   }
//
// Each "from" must appear exactly once in its file; one that doesn't is reported MISSING. Files keep
// their line endings (CRLF here): "from" and "to" are written with \n. Every file's text is saved
// before anything changes, so --restore can put it back even after the run is killed (a killed
// process skips its own clean-up). Exits 1 when a break survived, was missing, or a file didn't
// come back as it was.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BACKUP = path.join(os.tmpdir(), 'citynet-mutation-backup.json');
const at = (p) => path.resolve(ROOT, p);

const restore = () => {
  if (!fs.existsSync(BACKUP)) return false;
  const saved = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
  for (const [file, text] of Object.entries(saved)) fs.writeFileSync(file, text);
  fs.unlinkSync(BACKUP);
  return true;
};

if (process.argv[2] === '--restore') {
  console.log(restore() ? 'Restored every file from the last run.' : 'Nothing to restore.');
  process.exit(0);
}
if (fs.existsSync(BACKUP)) {
  console.error(`A previous run was killed before it put its files back. Run: node scripts/mutation-check.js --restore\n(${BACKUP})`);
  process.exit(2);
}
if (!process.argv[2]) {
  console.error('Usage: node scripts/mutation-check.js <plan.json> | --restore');
  process.exit(2);
}

const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const run = (name) => {
  const t = plan.tests[name];
  if (!t) throw new Error(`No tests named ${name}`);
  try { execSync(t.cmd, { cwd: at(t.cwd), stdio: 'pipe', timeout: 300_000 }); return true; } catch { return false; }
};

// The tests must pass on the code as it is, or every break would look caught.
for (const name of new Set(plan.files.map((f) => f.tests))) {
  if (!run(name)) {
    console.error(`The "${name}" tests fail before anything is broken: fix them first.\n  ${plan.tests[name].cmd}`);
    process.exit(2);
  }
}

const originals = Object.fromEntries(plan.files.map((f) => [at(f.file), fs.readFileSync(at(f.file), 'utf8')]));
fs.writeFileSync(BACKUP, JSON.stringify(originals));
const stop = () => { restore(); console.error('\nStopped: every file put back.'); process.exit(130); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const results = [];
try {
  for (const f of plan.files) {
    const file = at(f.file);
    const original = originals[file];
    const crlf = original.includes('\r\n');
    const text = original.split('\r\n').join('\n');
    for (const [from, to] of f.mutants) {
      const label = from.split('\n')[0].trim().slice(0, 90);
      if (text.split(from).length !== 2) { results.push(['MISSING', f.file, label]); continue; }
      const broken = text.replace(from, () => to);
      fs.writeFileSync(file, crlf ? broken.split('\n').join('\r\n') : broken);
      const caught = !run(f.tests);
      fs.writeFileSync(file, original);
      results.push([caught ? 'caught' : 'SURVIVED', f.file, label]);
      console.log(`${caught ? 'caught  ' : 'SURVIVED'}  ${path.basename(f.file)}  ${label}`);
    }
  }
} finally {
  restore();
}

const changed = Object.entries(originals).filter(([file, text]) => fs.readFileSync(file, 'utf8') !== text).map(([file]) => file);
const caught = results.filter((r) => r[0] === 'caught').length;
console.log(`\n${caught} of ${results.length} caught.`);
for (const r of results.filter((x) => x[0] !== 'caught')) console.log(`${r[0]}: ${r[1]}: ${r[2]}`);
if (changed.length) console.error(`NOT PUT BACK: ${changed.join(', ')}`);
process.exit(caught === results.length && !changed.length ? 0 : 1);
