// A custom system's character sheet: its layout, as data.
//
// The built-in systems' sheets are TypeScript templates (frontend/src/sheets/templates) drawn by
// SheetRenderer. A custom system's sheet is the same shape, cut down to what can be plain data -
// sections of text, number and pick-one fields, with the flags the server needs (public or
// private, combat-sensitive, current/max pairs, values that live on the token or in the bank).
// The same renderer draws it.
//
// A field whose id matches one of the system's derived values shows that value, read-only: the
// server recomputes it on every save. A system with no sheet yet gets a starter one (the
// generic layout plus its derived values), so a published system can always be drawn.

const { healthLayout } = require('./core');

const NAME = /^[a-z][a-z0-9_]{0,63}$/;

const LIMITS = { sections: 50, fields: 500, perSection: 100, tabs: 12, label: 60, hint: 300, options: 100 };
const LAYOUTS = ['list', 'grid', 'notes', 'inventory'];
const TYPES = ['number', 'text', 'textarea', 'select'];
/** Values that live elsewhere and are overlaid at read time (sheets/templates.js linkedFields). */
const SOURCES = ['token_hp', 'token_hp_max', 'token_ac', 'bank_balance'];

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const text = (value, where, max, problems, { required = false } = {}) => {
  if (value === undefined || value === null) { if (required) problems.push({ where, message: 'Required' }); return; }
  if (typeof value !== 'string') { problems.push({ where, message: 'Must be text' }); return; }
  if (required && !value.trim()) problems.push({ where, message: 'Cannot be blank' });
  if (value.length > max) problems.push({ where, message: `Longer than ${max} characters` });
};

/**
 * Who changes a field. 'player' (the default) is the character's owner, as on every built-in
 * sheet; 'gm' is a value the owner sees but only the GM sets - XP, awarded items. A derived
 * value is neither: it is worked out, so nobody edits it.
 */
const EDIT = ['player', 'gm'];

const FIELD_KEYS = new Set(['id', 'label', 'type', 'visibility', 'sensitivity', 'maxField', 'hint', 'placeholder', 'unit', 'options', 'source', 'edit']);
const SECTION_KEYS = new Set(['id', 'label', 'layout', 'tab', 'columns', 'fields']);
const HEADER_KEYS = new Set(['nameField', 'subtitleFields', 'hpField', 'hpMaxField', 'chips']);

/** Check a sheet layout. `derivedIds` are the system's derived values, which fields may show. */
const checkSheet = (sheet, derivedIds, problems) => {
  if (sheet === undefined) return;
  if (!isPlainObject(sheet)) { problems.push({ where: 'sheet', message: 'Must be a layout' }); return; }
  for (const key of Object.keys(sheet)) {
    if (!['tabs', 'header', 'sections'].includes(key)) problems.push({ where: `sheet ${key}`, message: 'Not part of a sheet' });
  }

  let tabs = null;
  if (sheet.tabs !== undefined) {
    if (!Array.isArray(sheet.tabs) || !sheet.tabs.length) problems.push({ where: 'sheet tabs', message: 'Must be a list of tab names' });
    else {
      if (sheet.tabs.length > LIMITS.tabs) problems.push({ where: 'sheet tabs', message: `More than ${LIMITS.tabs} tabs` });
      sheet.tabs.forEach((t, i) => text(t, `sheet tab ${i + 1}`, 20, problems, { required: true }));
      tabs = new Set(sheet.tabs);
    }
  }

  const fieldIds = new Set();
  const maxRefs = [];
  if (!Array.isArray(sheet.sections)) {
    problems.push({ where: 'sheet sections', message: 'Must be a list of sections' });
  } else {
    if (sheet.sections.length > LIMITS.sections) problems.push({ where: 'sheet sections', message: `More than ${LIMITS.sections} sections` });
    const sectionIds = new Set();
    let total = 0;
    sheet.sections.slice(0, LIMITS.sections).forEach((section, si) => {
      const sw = isPlainObject(section) && typeof section.id === 'string' ? `sheet section ${section.id}` : `sheet section ${si + 1}`;
      if (!isPlainObject(section)) { problems.push({ where: sw, message: 'Must be a section' }); return; }
      for (const key of Object.keys(section)) if (!SECTION_KEYS.has(key)) problems.push({ where: `${sw}, ${key}`, message: 'Not part of a section' });
      if (typeof section.id !== 'string' || !NAME.test(section.id)) problems.push({ where: sw, message: 'Ids use lowercase letters, digits and _, starting with a letter' });
      else if (sectionIds.has(section.id)) problems.push({ where: sw, message: 'Defined twice' });
      else sectionIds.add(section.id);
      text(section.label, `${sw}, label`, LIMITS.label, problems, { required: true });
      if (!LAYOUTS.includes(section.layout)) problems.push({ where: `${sw}, layout`, message: `One of ${LAYOUTS.join(', ')}` });
      if (section.tab !== undefined) {
        text(section.tab, `${sw}, tab`, 20, problems, { required: true });
        if (tabs && typeof section.tab === 'string' && !tabs.has(section.tab)) problems.push({ where: `${sw}, tab`, message: 'Not one of the sheet\'s tabs' });
      }
      if (section.columns !== undefined && !(Number.isInteger(section.columns) && section.columns >= 1 && section.columns <= 8)) {
        problems.push({ where: `${sw}, columns`, message: 'A whole number from 1 to 8' });
      }
      if (!Array.isArray(section.fields)) { problems.push({ where: `${sw}, fields`, message: 'Must be a list of fields' }); return; }
      if (section.fields.length > LIMITS.perSection) problems.push({ where: `${sw}, fields`, message: `More than ${LIMITS.perSection} fields` });
      section.fields.slice(0, LIMITS.perSection).forEach((field, fi) => {
        total += 1;
        const fw = isPlainObject(field) && typeof field.id === 'string' ? `sheet field ${field.id}` : `${sw}, field ${fi + 1}`;
        if (!isPlainObject(field)) { problems.push({ where: fw, message: 'Must be a field' }); return; }
        for (const key of Object.keys(field)) if (!FIELD_KEYS.has(key)) problems.push({ where: `${fw}, ${key}`, message: 'Not part of a field' });
        if (typeof field.id !== 'string' || !NAME.test(field.id)) problems.push({ where: fw, message: 'Ids use lowercase letters, digits and _, starting with a letter' });
        else if (fieldIds.has(field.id)) problems.push({ where: fw, message: 'Defined twice' });
        else fieldIds.add(field.id);
        text(field.label, `${fw}, label`, LIMITS.label, problems, { required: true });
        if (!TYPES.includes(field.type)) problems.push({ where: `${fw}, type`, message: `One of ${TYPES.join(', ')}` });
        if (field.visibility !== undefined && !['public', 'private'].includes(field.visibility)) problems.push({ where: `${fw}, visibility`, message: 'public or private' });
        if (field.sensitivity !== undefined && field.sensitivity !== 'combat') problems.push({ where: `${fw}, sensitivity`, message: 'Only "combat"' });
        if (field.sensitivity === 'combat' && field.visibility === 'public') problems.push({ where: fw, message: 'A combat value is never public' });
        text(field.hint, `${fw}, hint`, LIMITS.hint, problems);
        text(field.placeholder, `${fw}, placeholder`, LIMITS.label, problems);
        text(field.unit, `${fw}, unit`, 20, problems);
        if (field.source !== undefined && !SOURCES.includes(field.source)) problems.push({ where: `${fw}, source`, message: `One of ${SOURCES.join(', ')}` });
        if (field.source !== undefined && derivedIds.has(field.id)) problems.push({ where: fw, message: 'Cannot be both a derived value and a linked one' });
        if (field.edit !== undefined && !EDIT.includes(field.edit)) problems.push({ where: `${fw}, edit`, message: 'player or gm' });
        if (field.edit !== undefined && derivedIds.has(field.id)) problems.push({ where: `${fw}, edit`, message: 'A derived value is worked out, so nobody edits it' });
        if (field.maxField !== undefined) maxRefs.push({ fw, ref: field.maxField });
        if (field.options !== undefined || field.type === 'select') {
          if (field.type !== 'select') problems.push({ where: `${fw}, options`, message: 'Only a select field has options' });
          else if (!Array.isArray(field.options) || !field.options.length) problems.push({ where: `${fw}, options`, message: 'A select field needs options' });
          else {
            if (field.options.length > LIMITS.options) problems.push({ where: `${fw}, options`, message: `More than ${LIMITS.options} options` });
            field.options.forEach((o, oi) => {
              if (!isPlainObject(o)) { problems.push({ where: `${fw}, option ${oi + 1}`, message: 'Needs a value and a label' }); return; }
              text(o.value, `${fw}, option ${oi + 1} value`, LIMITS.label, problems);
              text(o.label, `${fw}, option ${oi + 1} label`, LIMITS.label, problems, { required: true });
            });
          }
        }
      });
    });
    if (total > LIMITS.fields) problems.push({ where: 'sheet', message: `More than ${LIMITS.fields} fields` });
  }

  const known = (id) => fieldIds.has(id) || derivedIds.has(id);
  for (const { fw, ref } of maxRefs) {
    if (typeof ref !== 'string' || !known(ref)) problems.push({ where: `${fw}, maxField`, message: 'Not a field on this sheet' });
  }
  if (sheet.header !== undefined) {
    const h = sheet.header;
    if (!isPlainObject(h)) { problems.push({ where: 'sheet header', message: 'Must be a header' }); return; }
    for (const key of Object.keys(h)) if (!HEADER_KEYS.has(key)) problems.push({ where: `sheet header ${key}`, message: 'Not part of a header' });
    for (const key of ['nameField', 'hpField', 'hpMaxField']) {
      if (h[key] !== undefined && !known(h[key])) problems.push({ where: `sheet header ${key}`, message: 'Not a field on this sheet' });
    }
    if (h.subtitleFields !== undefined) {
      if (!Array.isArray(h.subtitleFields)) problems.push({ where: 'sheet header subtitleFields', message: 'Must be a list of fields' });
      else h.subtitleFields.forEach((f) => { if (!known(f)) problems.push({ where: 'sheet header subtitleFields', message: `${f} is not a field on this sheet` }); });
    }
    if (h.chips !== undefined) {
      if (!Array.isArray(h.chips)) problems.push({ where: 'sheet header chips', message: 'Must be a list' });
      else h.chips.forEach((c, ci) => {
        if (!isPlainObject(c) || !known(c.field)) problems.push({ where: `sheet header chip ${ci + 1}`, message: 'Must name a field on this sheet' });
        else text(c.label, `sheet header chip ${ci + 1}, label`, 20, problems, { required: true });
      });
    }
  }
};

/**
 * The sheet a system is drawn with: its own, or a starter one. The starter is the generic
 * layout (name, concept, description, health, cash, notes) with the system's derived values in
 * a section of their own, so a system that has not designed its sheet yet still has one. Its
 * health is shaped by the system's health model (core.js); with none, it is one HP pool.
 */
const effectiveSheet = (definition) => {
  if (definition && isPlainObject(definition.sheet)) return definition.sheet;
  const derived = Array.isArray(definition && definition.derived) ? definition.derived.filter((d) => d && typeof d.id === 'string') : [];
  const health = healthLayout(definition && isPlainObject(definition.core) ? definition.core.health : undefined);
  const sections = [
    { id: 'identity', label: 'IDENTITY', layout: 'list', tab: 'STATS', fields: [
      { id: 'name', label: 'Name', type: 'text', visibility: 'public' },
      { id: 'concept', label: 'Concept', type: 'text' },
      { id: 'description', label: 'Description', type: 'textarea', visibility: 'public' },
    ] },
    ...health.sections,
  ];
  if (derived.length) {
    sections.push({ id: 'derived', label: 'DERIVED', layout: 'grid', tab: 'STATS', columns: 4,
      fields: derived.map((d) => ({ id: d.id, label: d.id.replace(/_/g, ' ').toUpperCase(), type: 'number' })) });
  }
  sections.push(
    { id: 'inventory', label: 'INVENTORY', layout: 'inventory', tab: 'GEAR', fields: [] },
    { id: 'money', label: 'MONEY', layout: 'list', tab: 'GEAR', fields: [{ id: 'cash', label: 'Cash', type: 'number', source: 'bank_balance' }] },
    { id: 'notes', label: 'NOTES', layout: 'notes', tab: 'NOTES', fields: [{ id: 'notes', label: 'Notes', type: 'textarea' }] },
  );
  return { tabs: ['STATS', 'GEAR', 'NOTES'], header: { nameField: 'name', subtitleFields: ['concept'], ...health.header }, sections };
};

/** Every field on a sheet, in order. */
const fieldsOf = (sheet) => (Array.isArray(sheet && sheet.sections) ? sheet.sections : [])
  .flatMap((s) => (s && Array.isArray(s.fields) ? s.fields : []));

module.exports = { checkSheet, effectiveSheet, fieldsOf, LAYOUTS, TYPES, SOURCES, EDIT, LIMITS };
