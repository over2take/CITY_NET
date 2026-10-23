// A custom system as a zip, to share it with its uploaded images (decided with the user,
// 2026-10-23):
//
//   ember.zip
//     ember.citysys                    the file EXPORT has always made, every address unchanged
//     IMAGES.txt                       where each image is used
//     images/symbols/hit.png           a symbol's icon, named by the symbol's id
//     images/conditions/glitching.png  a condition's
//     images/currencies/scrip.svg      a currency's
//
// An uploaded icon's address is the SHA-256 of its bytes (routes/systems.js iconUpload), so the
// file inside needs no rewriting: installing stores each image under its own hash, and the
// system's addresses find it. Only an image whose hash is an address the system names is stored;
// anything else in the zip is never even unpacked, and no image is unpacked past the size the zip
// claims for it (fflate stops there), so a zip can't fill the disk or the memory.
//
// Without the images (the GM's choice at EXPORT) the file leaves their addresses out instead, so
// the system falls back cleanly on another server: a symbol shows its mark, a condition a drawn
// icon, a currency none. Drawn symbols are data in the definition and travel either way.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { zipSync, unzipSync, strToU8, strFromU8 } = require('fflate');
const citysys = require('./citysys');
const { UPLOADED_ICON: CONDITION_ICON, STANDARD } = require('./conditions');
const { UPLOADED_ICON: CURRENCY_ICON } = require('./currencies');

/** Where /uploads keeps its files: routes/systems.js iconUpload writes here. */
const UPLOADS = path.join(__dirname, '../uploads');

/** Each kind of picture: where it is in the zip, the uploads folder it lives in, its address. */
const KINDS = {
  symbols: { folder: 'condition_icons', address: CONDITION_ICON },
  conditions: { folder: 'condition_icons', address: CONDITION_ICON },
  currencies: { folder: 'currency_icons', address: CURRENCY_ICON },
};

const LIMITS = {
  /** The zip as sent: a system's file and at most 72 icons of a quarter megabyte, with room. */
  zipBytes: 16 * 1024 * 1024,
  /** One icon, as an upload is capped (middleware/uploadConstraints.js). */
  imageBytes: 256 * 1024,
  /** Twelve symbols, sixty conditions and the currencies, with room. */
  images: 100,
};

const ENTRY = /^images\/(symbols|conditions|currencies)\/[^/]+\.(png|webp|svg)$/;
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Where a symbol shows on the system's dice: "Good faces 2, 3; Bad face 4". */
const facesWith = (definition, symbol) => (Array.isArray(definition.dice) ? definition.dice : [])
  .filter(isPlainObject)
  .map((d) => {
    const at = (Array.isArray(d.faces) ? d.faces : []).map((f, i) => (isPlainObject(f) && Array.isArray(f.s) && f.s.includes(symbol) ? i + 1 : 0)).filter(Boolean);
    return at.length ? `${d.name || d.id} ${at.length === 1 ? 'face' : 'faces'} ${at.join(', ')}` : null;
  })
  .filter(Boolean)
  .join('; ');

/**
 * Every uploaded picture a definition names: { kind, id, name, address, used }, `used` saying where
 * a symbol shows. Drawn and built-in icons aren't uploads and travel in the definition itself.
 */
const uploadsIn = (definition) => {
  if (!isPlainObject(definition)) return [];
  const out = [];
  const add = (kind, id, name, icon, used = '') => {
    if (typeof icon === 'string' && KINDS[kind].address.test(icon)) out.push({ kind, id, name, address: icon, used });
  };
  for (const s of Array.isArray(definition.symbols) ? definition.symbols : []) {
    if (isPlainObject(s)) add('symbols', s.id, s.name || s.id, s.icon, facesWith(definition, s.id));
  }
  for (const [id, c] of Object.entries(isPlainObject(definition.conditions) ? definition.conditions : {})) {
    if (isPlainObject(c)) add('conditions', id, c.name || STANDARD.find((b) => b.id === id)?.name || id, c.icon);
  }
  for (const c of Array.isArray(definition.currencies) ? definition.currencies : []) {
    if (isPlainObject(c)) add('currencies', c.id, c.name || c.id, c.icon);
  }
  return out;
};

/** The definition with the uploaded pictures' addresses left out, or only those in `drop`. */
const withoutUploads = (definition, drop = null) => {
  const gone = (icon) => typeof icon === 'string' && (drop ? drop.has(icon) : Object.values(KINDS).some((k) => k.address.test(icon)));
  const strip = (item) => {
    if (!isPlainObject(item) || !gone(item.icon)) return item;
    const { icon, ...rest } = item;
    return rest;
  };
  const out = { ...definition };
  // A symbol needs something to show on the dice: without its picture and a mark of its own, the
  // first letter of its name, as the log already writes it (tableRolls.js marksOf).
  const marked = (s) => (isPlainObject(s) && s.mark === undefined && s.icon === undefined && s.drawn === undefined
    ? { ...s, mark: String(s.name || s.id || '?').trim().slice(0, 1).toUpperCase() || '?' } : s);
  if (Array.isArray(out.symbols)) out.symbols = out.symbols.map((s) => (s === strip(s) ? s : marked(strip(s))));
  if (Array.isArray(out.currencies)) out.currencies = out.currencies.map(strip);
  if (isPlainObject(out.conditions)) out.conditions = Object.fromEntries(Object.entries(out.conditions).map(([id, c]) => [id, strip(c)]));
  return out;
};

/** The file an uploaded picture is kept in, from its address. */
const fileOf = (root, address) => path.join(root, ...address.replace(/^\/uploads\//, '').split('/'));

/** IMAGES.txt: each picture in the zip, what it is, and where a symbol shows. */
const listing = (systemName, placed) => [
  `${systemName}: the pictures uploaded for it, which install with it.`,
  '',
  ...placed.map((p) => `${p.entry}  ${p.name.toUpperCase()}${p.used ? `: ${p.used}` : ''}`),
  '',
].join('\n');

/**
 * A published system as a zip with its uploaded pictures: { fileName, bytes, images }. A picture
 * no longer on disk is left out, its address with it, so the system falls back cleanly rather
 * than naming a picture that isn't there. Null when the system has no pictures to send: the
 * plain .citysys is the whole of it.
 */
const buildZip = ({ definition, version, origin, root = UPLOADS }) => {
  const placed = [];
  const missing = new Set();
  for (const u of uploadsIn(definition)) {
    let bytes;
    try { bytes = fs.readFileSync(fileOf(root, u.address)); } catch { missing.add(u.address); continue; }
    // By its id, unique in its kind; two things sharing one picture send it once each, so.
    placed.push({ ...u, entry: `images/${u.kind}/${String(u.id).replace(/[^A-Za-z0-9_-]/g, '_')}${path.extname(u.address)}`, bytes });
  }
  if (!placed.length) return null;
  const kept = missing.size ? withoutUploads(definition, missing) : definition;
  const file = citysys.buildFile({ definition: kept, version, origin });
  const name = citysys.fileNameFor(definition.name);
  const files = {
    [name]: strToU8(JSON.stringify(file, null, 2)),
    'IMAGES.txt': strToU8(listing(definition.name, placed)),
    ...Object.fromEntries(placed.map((p) => [p.entry, new Uint8Array(p.bytes)])),
  };
  return { fileName: name.replace(/\.citysys$/, '.zip'), bytes: Buffer.from(zipSync(files, { level: 6 })), images: placed.length };
};

/**
 * Read a zip someone sent: { fatal } when it can't be installed at all, otherwise { text, images },
 * `text` its .citysys and `images` each picture as { folder, name, bytes }, named by its own hash
 * as an upload is. Which of them the system names is for imagesFor to say.
 */
const readZip = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return { fatal: 'Not a file' };
  if (buffer.length > LIMITS.zipBytes) return { fatal: `Larger than ${LIMITS.zipBytes / 1024 / 1024} MB` };
  const systems = [];
  let images = 0;
  let tooBig = null;
  let unpacked;
  try {
    unpacked = unzipSync(new Uint8Array(buffer), {
      filter: (f) => {
        if (/^[^/]+\.citysys$/.test(f.name)) {
          systems.push(f.name);
          if (f.originalSize > citysys.MAX_BYTES) tooBig = f.name;
          return systems.length === 1 && !tooBig;
        }
        if (!ENTRY.test(f.name)) return false;
        if (f.originalSize > LIMITS.imageBytes) return false;
        images += 1;
        return images <= LIMITS.images;
      },
    });
  } catch {
    return { fatal: 'Not a zip file CITY_NET can read' };
  }
  if (!systems.length) return { fatal: 'The zip has no .citysys file in it' };
  if (systems.length > 1) return { fatal: 'The zip holds more than one system; share one at a time' };
  if (tooBig) return { fatal: `${tooBig} is larger than ${Math.round(citysys.MAX_BYTES / 1024)} KB` };
  if (images > LIMITS.images) return { fatal: `More than ${LIMITS.images} pictures` };
  const pictures = Object.entries(unpacked).filter(([name]) => ENTRY.test(name)).map(([name, bytes]) => {
    const kind = ENTRY.exec(name)[1];
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    return { folder: KINDS[kind].folder, name: `${hash}${path.extname(name).toLowerCase()}`, bytes: Buffer.from(bytes) };
  });
  return { text: strFromU8(unpacked[systems[0]]), images: pictures };
};

/** The zip's pictures the system names, each once: the only ones installing stores. */
const imagesFor = (definition, images) => {
  const named = new Set(uploadsIn(definition).map((u) => u.address));
  const seen = new Set();
  return images.filter((p) => {
    const address = `/uploads/${p.folder}/${p.name}`;
    if (!named.has(address) || seen.has(address)) return false;
    seen.add(address);
    return true;
  });
};

/** Store pictures under /uploads, each under its hash, as an upload is; one already there is left. */
const storeImages = (images, root = UPLOADS) => {
  for (const p of images) {
    const dir = path.join(root, p.folder);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, p.name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, p.bytes);
  }
};

module.exports = { UPLOADS, LIMITS, uploadsIn, withoutUploads, buildZip, readZip, imagesFor, storeImages };
