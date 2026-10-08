// What of an NPC's sheet a caller may see.
//
// The map list and the token card are public: every player loads them. They used to carry
// every linked NPC's whole sheet (stats, notes, everything) and its real portrait, with the
// silhouette only a CSS filter on the player's screen - so the face the GM hid was one "open
// image in new tab" away, and the sheet was in the network tab.
//
// The line is the one the sheet routes already draw (requireAdmin in routes/sheets.js): the
// GM, or someone the GM granted editing rights, who can open the full sheet anyway. Everyone
// else gets no sheet, and no portrait for an NPC the GM silhouetted - the client draws the
// token in its side's color instead. One exception, asked for by the user (4b5b2): a player the
// GM gave control of a friendly NPC reads that one NPC's sheet, read-only, through its own route
// (GET /api/sheets/npcs/controlled/:location_id; tokens/tokenAccess.js controls).

/** May this caller read NPC sheets? `user` is req.user after optionalAuthenticate. */
const canReadNpcSheets = (user) => !!user && (user.role === 'admin' || !!user.isTemporary);

/** Is this NPC's portrait silhouetted? Off unless the sheet says otherwise. */
const isSilhouetted = (flag) => Number(flag ?? 0) !== 0;

/**
 * A location row as this caller may see it. Rows are the GET /api/locations shape:
 * `sheet_data` and `portrait_shadow_filter` come from the linked NPC sheet, if any.
 */
const redactLocation = (row, canRead) => {
  if (canRead) return row;
  const out = { ...row };
  delete out.sheet_data;
  if (isSilhouetted(out.portrait_shadow_filter)) out.portrait_url = null;
  return out;
};

/** The public token card (name, description, portrait) as this caller may see it. */
const redactTokenCard = (card, canRead) => {
  if (canRead || !card || !isSilhouetted(card.portrait_shadow_filter)) return card;
  return { ...card, portrait_url: null };
};

module.exports = { canReadNpcSheets, isSilhouetted, redactLocation, redactTokenCard };
