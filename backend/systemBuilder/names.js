// A system's name when another already has it (4a1a).
//
// DUPLICATE and keep-both installs both make a second system that would share a name with the
// first. Rather than two "Hearth"s in the picker, the new one is "Hearth copy", then
// "Hearth copy 02", "Hearth copy 03"... (decided with the user, 2026-10-03).
//
// Names are compared trimmed and ignoring case, so "hearth " and "Hearth" are the same name.
// Copying a copy counts on rather than stacking: "Hearth copy" taken gives "Hearth copy 02",
// never "Hearth copy copy". A long name is shortened to keep the result within the name limit.
//
// Pure: the store passes the names of the systems not deleted.

const { LIMITS } = require('./definition');

const keyOf = (name) => String(name).trim().toLowerCase();

/** " copy" for the first copy, then " copy 02", " copy 03"... */
const copySuffix = (n) => (n === 1 ? ' copy' : ` copy ${String(n).padStart(2, '0')}`);

/** A name already ending in a copy suffix, without it: "Hearth copy 02" → "Hearth". */
const COPIED = / copy(?: \d{2,})?$/i;

/** `head` shortened, a whole character at a time, so that `head + suffix` fits in `max`. */
const fit = (head, suffix, max) => {
  const chars = Array.from(head);
  while (chars.length && chars.join('').length + suffix.length > max) chars.pop();
  return chars.join('').trimEnd() + suffix;
};

/**
 * `wanted` if no system in `taken` has that name, else the first free copy name.
 * `taken` is a list of names; `max` the longest a name may be.
 */
const uniqueName = (wanted, taken, max = LIMITS.name) => {
  const name = String(wanted).trim();
  const used = new Set(Array.from(taken || [], keyOf));
  if (!used.has(keyOf(name))) return name;
  const base = name.replace(COPIED, '');
  for (let n = 1; ; n += 1) {
    const candidate = fit(base, copySuffix(n), max);
    if (!used.has(keyOf(candidate))) return candidate;
  }
};

module.exports = { uniqueName };
