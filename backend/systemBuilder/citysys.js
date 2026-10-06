// A custom system as a file to share: `vault-knights.citysys`.
//
//   {
//     "citysys": 1,
//     "manifest": { "name", "author", "version", "builder", "license", "origin", "exported" },
//     "definition": { ...the system, format 1 (definition.js) }
//   }
//
// Plain JSON, pretty-printed, so a system can be read, diffed and kept on GitHub. The plan's
// zip form, a folder of images beside the JSON, arrives when a system can hold images; until
// then every system is this one file.
//
// A file is untrusted whoever sent it: it is read here on the server, capped in size, and its
// definition goes through the same checks as the editor's (definition.js). It is data only,
// never code, and it never carries characters or sheets: those belong to the server they were
// played on. `origin` is who the system is across servers. Installing a file whose origin is
// already here offers an update or a second copy; a deleted system with that origin comes back.

const crypto = require('crypto');
const { checkDefinition, LIMITS: DEFINITION_LIMITS } = require('./definition');

const FILE_FORMAT = 1;
/** The definition's own cap plus room for the cover. */
const MAX_BYTES = DEFINITION_LIMITS.bytes + 16 * 1024;
const MANIFEST_TEXT = { name: 80, author: 80, license: 200, builder: 40 };
const ORIGIN = /^[A-Za-z0-9_-]{1,64}$/;

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** The app's version, for the cover: informative only, never trusted on install. */
const appVersion = () => {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try { return require('../../package.json').version; } catch { return 'dev'; }
};

/** A stable fingerprint of a definition as stored. */
const hashOf = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');

/** A file name from a system's name: lowercase, dashes, never empty. */
const fileNameFor = (name) => {
  // Accents come off their letters (Ä to A) rather than turning into dashes.
  const slug = String(name || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${slug || 'system'}.citysys`;
};

/** The file for a system's published definition. */
const buildFile = ({ definition, version, origin }) => ({
  citysys: FILE_FORMAT,
  manifest: {
    name: definition.name,
    author: typeof definition.author === 'string' ? definition.author : '',
    version,
    builder: appVersion(),
    license: typeof definition.license === 'string' ? definition.license : '',
    origin,
    exported: new Date().toISOString(),
  },
  definition,
});

/**
 * Read a file's text. Returns { fatal } when it cannot be installed at all (not a system file,
 * too large, unreadable), otherwise { file: { manifest, definition }, problems }. Problems are
 * the definition's own, as the editor lists them: a file with problems installs as a draft to
 * fix, never as something a game can run.
 */
const readFile = (text) => {
  if (typeof text !== 'string') return { fatal: 'Not a file' };
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) return { fatal: `Larger than ${Math.round(MAX_BYTES / 1024)} KB` };
  let parsed;
  try { parsed = JSON.parse(text); } catch { return { fatal: 'Not a CITY_NET system file' }; }
  if (!isPlainObject(parsed) || !('citysys' in parsed)) return { fatal: 'Not a CITY_NET system file' };
  if (parsed.citysys !== FILE_FORMAT) return { fatal: `Made by a newer CITY_NET (file format ${parsed.citysys}); update to install it` };
  if (!isPlainObject(parsed.manifest) || !isPlainObject(parsed.definition)) return { fatal: 'The file is missing its system' };

  const m = parsed.manifest;
  const text80 = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  if (typeof m.origin !== 'string' || !ORIGIN.test(m.origin)) return { fatal: 'The file does not say which system it is' };
  const manifest = {
    name: text80(m.name, MANIFEST_TEXT.name),
    author: text80(m.author, MANIFEST_TEXT.author),
    license: text80(m.license, MANIFEST_TEXT.license),
    builder: text80(m.builder, MANIFEST_TEXT.builder),
    version: Number.isInteger(m.version) && m.version >= 0 ? m.version : 0,
    origin: m.origin,
  };

  const checked = checkDefinition(parsed.definition);
  if (checked.fatal) return { fatal: checked.fatal };
  return { file: { manifest, definition: parsed.definition }, problems: checked.problems };
};

/** What the preview lists as inside: counts, never the content itself. */
const summarize = (definition) => {
  const sheet = isPlainObject(definition.sheet) ? definition.sheet : null;
  const count = (v) => (Array.isArray(v) ? v.length : 0);
  const fields = sheet && Array.isArray(sheet.sections)
    ? sheet.sections.reduce((n, s) => n + (isPlainObject(s) ? count(s.fields) : 0), 0) : 0;
  return {
    words: isPlainObject(definition.words) ? Object.keys(definition.words).length : 0,
    partsOff: isPlainObject(definition.parts) ? Object.values(definition.parts).filter((p) => isPlainObject(p) && p.on === false).length : 0,
    currencies: count(definition.currencies),
    derived: count(definition.derived),
    lookups: isPlainObject(definition.lookups) ? Object.keys(definition.lookups).length : 0,
    sheetFields: fields,
    npcTiers: isPlainObject(definition.npc) ? count(definition.npc.tiers) : 0,
    healthModel: isPlainObject(definition.core) && isPlainObject(definition.core.health) ? definition.core.health.model || null : null,
  };
};

module.exports = { FILE_FORMAT, MAX_BYTES, buildFile, readFile, summarize, hashOf, fileNameFor, appVersion };
