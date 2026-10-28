// The graph view's layout (Phase 5; approved mockup docs/mockups/builder-graph.html, 2026-10-17).
//
//   graph: {
//     positions: { str: [48, 216], melee: [672, 48], 'table:attribute_mod': [360, 168], 'note:n1': [984, 72] },
//     groups: [{ id: 'mods', label: 'MODIFIERS', members: ['str_mod', 'dex_mod'] }],
//     collapsed: ['mods', 'abilities'],
//     notes: [{ id: 'n1', on: 'melee', text: 'Half level, rounded down: the 2nd printing.' }],
//   }
//
// The forms and the graph are two views of one system, so this holds only what the map adds:
// where each node sits, groups of formulas (a stats group is already a group, the `stats` list),
// which groups are folded, and notes pinned to a node. No wires: a wire is a formula reading a
// name, and that is already in `derived`. Everything else ignores this section, and a game never
// reads it.
//
// FORMS can't edit any of it, so nothing done in FORMS may make a problem here: a position, a
// group member, a folded group or a note's pin naming something since deleted is not a problem,
// and the map leaves it out. What is checked is what a file could use to do harm: the shape,
// how many, how long, and names in the form ids take.
//
// Pure: checks only. definition.js runs them.

const NAME = /^[a-z][a-z0-9_]{0,63}$/;
/** A node: a stat or formula by its id, or a table, house rule or note by its kind and id. */
const NODE = /^(?:(?:table|rule|note|roll):)?[a-z][a-z0-9_]{0,63}$/;
const LIMITS = {
  /** Positions: every stat, formula, table, house rule and note a system can have, and more. */
  positions: 1000,
  /** How far from the middle a node may sit, either way. */
  reach: 100000,
  groups: 50,
  label: 40,
  members: 500,
  notes: 200,
  note: 1000,
};
const KEYS = new Set(['positions', 'groups', 'collapsed', 'notes']);

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const checkPositions = (positions, problems) => {
  if (positions === undefined) return;
  if (!isPlainObject(positions)) { problems.push({ where: 'graph positions', message: 'Must be a set of places' }); return; }
  const keys = Object.keys(positions);
  if (keys.length > LIMITS.positions) problems.push({ where: 'graph positions', message: `More than ${LIMITS.positions}` });
  for (const key of keys.slice(0, LIMITS.positions)) {
    const where = `graph position ${key}`;
    if (!NODE.test(key)) { problems.push({ where, message: 'Not the name of a node' }); continue; }
    const p = positions[key];
    if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => Number.isInteger(n) && Math.abs(n) <= LIMITS.reach)) {
      problems.push({ where, message: `Must be two whole numbers, each between -${LIMITS.reach} and ${LIMITS.reach}` });
    }
  }
};

const checkGroups = (groups, problems) => {
  if (groups === undefined) return;
  const ids = new Set();
  if (!Array.isArray(groups)) { problems.push({ where: 'graph groups', message: 'Must be a list of groups' }); return; }
  if (groups.length > LIMITS.groups) problems.push({ where: 'graph groups', message: `More than ${LIMITS.groups}` });
  const grouped = new Map();
  groups.slice(0, LIMITS.groups).forEach((g, i) => {
    const where = isPlainObject(g) && typeof g.id === 'string' ? `graph group ${g.id}` : `graph group ${i + 1}`;
    if (!isPlainObject(g)) { problems.push({ where, message: 'Must be a group' }); return; }
    for (const key of Object.keys(g)) if (!['id', 'label', 'members'].includes(key)) problems.push({ where: `${where}, ${key}`, message: 'Not part of a group' });
    if (typeof g.id !== 'string' || !NAME.test(g.id)) problems.push({ where, message: 'Ids use lowercase letters, digits and _, starting with a letter' });
    else if (ids.has(g.id)) problems.push({ where, message: 'Defined twice' });
    else ids.add(g.id);
    if (typeof g.label !== 'string' || !g.label.trim()) problems.push({ where: `${where}, label`, message: 'Cannot be blank' });
    else if (g.label.length > LIMITS.label) problems.push({ where: `${where}, label`, message: `Longer than ${LIMITS.label} characters` });
    if (!Array.isArray(g.members)) { problems.push({ where: `${where}, members`, message: 'Must be a list of formulas' }); return; }
    if (g.members.length > LIMITS.members) problems.push({ where: `${where}, members`, message: `More than ${LIMITS.members}` });
    for (const m of g.members.slice(0, LIMITS.members)) {
      if (typeof m !== 'string' || !NAME.test(m)) { problems.push({ where: `${where}, members`, message: 'Members are formula ids' }); continue; }
      if (grouped.has(m) && grouped.get(m) !== where) problems.push({ where: `${where}, members`, message: `${m} is already in another group` });
      grouped.set(m, where);
    }
  });
};

const checkCollapsed = (collapsed, problems) => {
  if (collapsed === undefined) return;
  if (!Array.isArray(collapsed)) { problems.push({ where: 'graph collapsed', message: 'Must be a list of group ids' }); return; }
  if (collapsed.length > LIMITS.groups + 20) problems.push({ where: 'graph collapsed', message: `More than ${LIMITS.groups + 20}` });
  if (!collapsed.slice(0, LIMITS.groups + 20).every((c) => typeof c === 'string' && NAME.test(c))) {
    problems.push({ where: 'graph collapsed', message: 'Must be a list of group ids' });
  }
};

const checkNotes = (notes, problems) => {
  if (notes === undefined) return;
  if (!Array.isArray(notes)) { problems.push({ where: 'graph notes', message: 'Must be a list of notes' }); return; }
  if (notes.length > LIMITS.notes) problems.push({ where: 'graph notes', message: `More than ${LIMITS.notes}` });
  const ids = new Set();
  notes.slice(0, LIMITS.notes).forEach((n, i) => {
    const where = isPlainObject(n) && typeof n.id === 'string' ? `graph note ${n.id}` : `graph note ${i + 1}`;
    if (!isPlainObject(n)) { problems.push({ where, message: 'Must be a note' }); return; }
    for (const key of Object.keys(n)) if (!['id', 'on', 'text'].includes(key)) problems.push({ where: `${where}, ${key}`, message: 'Not part of a note' });
    if (typeof n.id !== 'string' || !NAME.test(n.id)) problems.push({ where, message: 'Ids use lowercase letters, digits and _, starting with a letter' });
    else if (ids.has(n.id)) problems.push({ where, message: 'Defined twice' });
    else ids.add(n.id);
    if (n.on !== undefined && (typeof n.on !== 'string' || !NODE.test(n.on) || n.on.startsWith('note:'))) {
      problems.push({ where: `${where}, on`, message: 'Pinned to a stat, formula, table or house rule' });
    }
    if (typeof n.text !== 'string') problems.push({ where: `${where}, text`, message: 'Must be text' });
    else if (n.text.length > LIMITS.note) problems.push({ where: `${where}, text`, message: `Longer than ${LIMITS.note} characters` });
  });
};

/** Problems with a definition's `graph` section, pushed onto `problems`. */
const checkGraph = (definition, problems) => {
  const graph = definition.graph;
  if (graph === undefined) return;
  if (!isPlainObject(graph)) { problems.push({ where: 'graph', message: 'Must be the map\'s layout' }); return; }
  for (const key of Object.keys(graph)) if (!KEYS.has(key)) problems.push({ where: `graph ${key}`, message: 'Not part of the map\'s layout' });
  checkPositions(graph.positions, problems);
  checkGroups(graph.groups, problems);
  checkCollapsed(graph.collapsed, problems);
  checkNotes(graph.notes, problems);
};

module.exports = { checkGraph, LIMITS, NODE };
