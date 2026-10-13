// GIVE ITEM's GIVEN list (4g2c; approved mockup docs/mockups/give-item.html, 2026-10-12): who gave
// what to whom, and when, kept on the server for the GM's window. One line per GIVE, naming those
// given it; a GIVE nobody got leaves no line. Each game keeps its last 50, so another game's gifts
// never push its own out.

const LIMIT = 50;

const run = (db, sql, params) => new Promise((ok, no) => db.run(sql, params, (e) => (e ? no(e) : ok())));
const all = (db, sql, params) => new Promise((ok, no) => db.all(sql, params, (e, rows) => (e ? no(e) : ok(rows || []))));

const names = (text) => {
  try { return JSON.parse(text).filter((n) => typeof n === 'string'); } catch { return []; }
};

/** A stored line as the window reads it, newest first. */
const shown = (r) => ({ id: r.id, at: r.given_at, by: r.given_by, catalogue: r.catalogue, item: r.item, qty: r.qty, to: names(r.recipients), note: r.note });

/** A game's last gifts, newest first. */
const recent = async (db, system) => (await all(db,
  'SELECT * FROM given_items WHERE system = ? ORDER BY id DESC LIMIT ?', [system, LIMIT])).map(shown);

/**
 * Write a GIVE's line and let the oldest of that game's go past 50. `to` is the names given it;
 * none, and nothing is written. Answers the game's list as it then stands.
 */
const record = async (db, { system, by, catalogue, item, qty, to, note }) => {
  if (to.length) {
    await run(db, 'INSERT INTO given_items (system, given_by, catalogue, item, qty, recipients, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [system, by, catalogue, item, qty, JSON.stringify(to), note]);
    await run(db, `DELETE FROM given_items WHERE system = ? AND id NOT IN
      (SELECT id FROM given_items WHERE system = ? ORDER BY id DESC LIMIT ?)`, [system, system, LIMIT]);
  }
  return recent(db, system);
};

module.exports = { LIMIT, recent, record };
