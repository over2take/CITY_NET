#!/usr/bin/env node
// Adds an entry to CHANGELOG.md under a heading of its [Unreleased] section: the first heading of that
// name before the first released version. The entry is a file (written with an editor, so it has no
// stray BOM or shell quoting), its own lines kept; the changelog keeps its line endings.
//
//   node scripts/changelog-add.js "### Added" entry.md

const fs = require('fs');
const path = require('path');

const [heading, entryFile] = process.argv.slice(2);
if (!heading || !entryFile) {
  console.error('Usage: node scripts/changelog-add.js "### Added" <entry-file>');
  process.exit(2);
}
const F = path.resolve(__dirname, '..', 'CHANGELOG.md');
let t = fs.readFileSync(F, 'utf8');
const crlf = t.includes('\r\n');
if (crlf) t = t.replace(/\r\n/g, '\n');
const entry = fs.readFileSync(entryFile, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\n*$/, '\n');
const start = t.indexOf('## [Unreleased]');
const end = t.indexOf('\n## [', start + 1);
const head = `${heading}\n\n`;
const at = t.indexOf(head, start);
if (start < 0 || at < 0 || (end > 0 && at > end)) {
  console.error(`No "${heading}" under [Unreleased] in CHANGELOG.md`);
  process.exit(1);
}
t = t.slice(0, at + head.length) + entry + t.slice(at + head.length);
fs.writeFileSync(F, crlf ? t.replace(/\n/g, '\r\n') : t);
console.log(`Added under ${heading}.`);
