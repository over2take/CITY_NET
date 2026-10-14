// The inventory, as an import brings it in: one list of countable things - ammunition, stims,
// rations, rope - stored as a JSON array under a single field. The same field on Cyberpunk RED,
// Cities Without Number, Shadowrun and every custom system (4h2a), so one reader for all of them.
//
// Its own module, needing nothing, so the custom systems' importer (systemBuilder/sheetImport.js)
// can use it without pdf-lib, which importers.js reads PDFs with.

/**
 * One line of a written-out inventory.
 *
 * A form prints "3x Stim" or "Stim x3" or just "Rope", so both places a quantity can sit
 * are read and the rest is the name. A number that is only part of the name - "9mm rounds",
 * "Type 2 Vacc Suit" - is left alone: it is not at either end with an x beside it.
 */
const parseInventoryLine = (line) => {
  const text = String(line).trim();
  if (!text) return null;
  let qty = 1;
  let name = text;
  const lead = /^(\d{1,4})\s*[x×]\s*(.+)$/i.exec(text);
  const trail = /^(.+?)\s*[x×]\s*(\d{1,4})$/i.exec(text);
  if (lead) { qty = Number(lead[1]); name = lead[2].trim(); }
  else if (trail) { name = trail[1].trim(); qty = Number(trail[2]); }
  if (!name) return null;
  // Stowed rather than unfiled: an imported sheet lists what the character is carrying,
  // and the stash - which costs nothing and is not on them - is a claim the form did not
  // make. Same reading the weapon rows take of a row nobody filed.
  return { name, qty: Math.max(1, qty), enc: '', bundled: false, carry: 'stowed', location: '' };
};

/**
 * The inventory as the sheet stores it, from whichever way it arrived.
 *
 * JSON from a sheet round-trip, or "2x Stim, Rope; 9mm rounds" from a printed form. Rows
 * that come in as JSON are passed through as objects rather than rebuilt: the sheet
 * normalises what it reads (sheets/inventory.ts), so a second copy of that rule here would
 * only be somewhere for the two to disagree. What is enforced is that it is a list of
 * objects, which is the part that would throw.
 */
const normaliseInventory = (mapped) => {
  if (typeof mapped.inventory !== 'string') return;
  const raw = mapped.inventory.trim();
  let items = null;
  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) items = parsed.filter((r) => r && typeof r === 'object');
    } catch { items = null; }
  }
  if (!items) items = raw.split(/[,;\n]/).map(parseInventoryLine).filter(Boolean);
  if (items.length) mapped.inventory = JSON.stringify(items);
  else delete mapped.inventory;
};

module.exports = { parseInventoryLine, normaliseInventory };
