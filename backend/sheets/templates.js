// Server-side template metadata for character sheets.
//
// The full templates (sections, layouts, labels, roll formulas) live in the
// frontend at src/sheets/templates/. The backend only needs to know, per
// system, which fields are safe to expose:
//
//  - publicFields: shown on the quick-sheet card to other players and
//    spectators. Everything not listed here is owner+admin only.
//  - combatFields: values that determine whether an attack hits (SP, AC,
//    evasion bases...). NEVER exposed to non-owners regardless of any other
//    flag - listed separately so a template edit can't accidentally leak them.
//
// The server filter is the only privacy gate; the client never receives
// fields it shouldn't show.

const TEMPLATES = {
  generic: {
    name: 'Generic',
    publicFields: ['name', 'description'],
    combatFields: [],
  },
  cyberpunk_red: {
    name: 'Cyberpunk RED',
    publicFields: ['handle', 'role', 'description'],
    combatFields: ['sp_head', 'sp_head_max', 'sp_body', 'sp_body_max', 'sp_shield', 'sp_shield_max'],
  },
};

const DEFAULT_SYSTEM = 'generic';

const isValidSystem = (system) => Object.prototype.hasOwnProperty.call(TEMPLATES, system);

// Strip a sheet's data down to what non-owners may see.
const filterPublicData = (system, data) => {
  const meta = TEMPLATES[system] || TEMPLATES[DEFAULT_SYSTEM];
  const parsed = typeof data === 'string' ? JSON.parse(data || '{}') : (data || {});
  const out = {};
  meta.publicFields.forEach((f) => {
    if (!meta.combatFields.includes(f) && parsed[f] !== undefined) out[f] = parsed[f];
  });
  return out;
};

module.exports = { TEMPLATES, DEFAULT_SYSTEM, isValidSystem, filterPublicData };
