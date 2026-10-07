// The builder's CHARACTER SHEET page as logic (4b3b): a system's own sheet layout, read from its
// definition and written back. Pure, so the page only draws it. Approved mockup
// docs/mockups/builder-sheet.html (2026-10-07).
//
// A system's sheet is automatic (the server's starter sheet, built from its stats, formulas and
// health model) until the GM customizes it, which copies the starter into `sheet`; going back to
// automatic drops it. The server checks the layout (backend/systemBuilder/sheet.js checkSheet) and
// answers the starter (POST /api/systems/preview-sheet). Decided with the user the same day:
//  - stats, formulas and the starter's other fields not on a customized sheet wait in a tray until
//    placed, rather than appearing by themselves;
//  - removing a tab moves its sections to another; removing the last makes a sheet of one page;
//  - who sees a field: the owner and the GM always; EVERYONE adds other players. A value that
//    decides whether attacks hit is never shown to anyone else, so it is never EVERYONE.

import type { Definition } from './systemsApi';
import type { CustomRenderField, CustomRenderSheet } from './customTemplates';
import { idFor } from './setup';
import { allStats, formulaList, takenIds } from './statsRules';

type Section = CustomRenderSheet['sections'][number];
type Field = CustomRenderField;
type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** The server's limits (sheet.js LIMITS), so the page refuses before the server would. */
export const LIMITS = { tabs: 12, tabName: 20, label: 60, hint: 300, options: 100, perSection: 100 };
/** How a section looks (sheet.js LAYOUTS), with the page's names for them. */
export const LAYOUTS = [
  { id: 'list', label: 'LIST' }, { id: 'grid', label: 'GRID' }, { id: 'notes', label: 'NOTES' }, { id: 'inventory', label: 'ITEMS' },
] as const;
/** What a field holds (sheet.js TYPES), with the page's names for them. */
export const TYPES = [
  { id: 'number', label: 'NUMBER' }, { id: 'text', label: 'TEXT' }, { id: 'textarea', label: 'LONG TEXT' }, { id: 'select', label: 'PICK ONE' },
] as const;
/** The field every sheet keeps: the character's name, which the app shows everywhere. */
export const NAME_FIELD = 'name';

/** The system's own sheet, or null while it is automatic. */
export const sheetOf = (def: Definition): CustomRenderSheet | null =>
  (isObject(def.sheet) && Array.isArray((def.sheet as Obj).sections) ? def.sheet as unknown as CustomRenderSheet : null);

/** Every field on a sheet, in order. */
export const fieldsOn = (sheet: CustomRenderSheet | null): Field[] => (sheet ? sheet.sections.flatMap((s) => s.fields) : []);

const withSheet = (def: Definition, sheet: CustomRenderSheet): Definition => ({ ...def, sheet });

/** The starter sheet as the system's own: CUSTOMIZE. Every change makes new objects, so it is never altered. */
export const withCustomized = (def: Definition, starter: CustomRenderSheet): Definition => withSheet(def, starter);

/** The system's own sheet dropped, so the starter draws it again: BACK TO AUTOMATIC. */
export const withAutomatic = (def: Definition): Definition => {
  const { sheet: _gone, ...rest } = def;
  return rest as Definition;
};

/**
 * What a field is, for the page: a FORMULA (worked out, nobody edits it), LINKED (lives on the
 * token or in the bank), a STAT the system defines, or a plain field of the sheet's own.
 */
export const fieldKind = (def: Definition, field: Field): 'formula' | 'linked' | 'stat' | 'plain' => {
  if (formulaList(def).some((f) => f.id === field.id)) return 'formula';
  if (field.source) return 'linked';
  if (allStats(def).some((s) => s.id === field.id)) return 'stat';
  return 'plain';
};

/** The starter's fields a customized sheet doesn't have, in the starter's order: NOT ON THE SHEET YET. */
export const tray = (def: Definition, starter: CustomRenderSheet | null): Field[] => {
  const sheet = sheetOf(def);
  if (!sheet || !starter) return [];
  const on = new Set(fieldsOn(sheet).map((f) => f.id));
  return fieldsOn(starter).filter((f) => !on.has(f.id));
};

/** The ids sections and tabs group by: the tabs, or one untabbed page (null) when there are none. */
export const pagesOf = (sheet: CustomRenderSheet): (string | null)[] => (sheet.tabs && sheet.tabs.length ? sheet.tabs : [null]);
/** The sections on a tab (or on the one page), in order. */
export const sectionsOn = (sheet: CustomRenderSheet, tab: string | null): Section[] =>
  sheet.sections.filter((s) => (tab === null ? true : s.tab === tab));

const withSections = (def: Definition, map: (sections: Section[]) => Section[]): Definition => {
  const sheet = sheetOf(def);
  return sheet ? withSheet(def, { ...sheet, sections: map(sheet.sections) }) : def;
};

/** Swap a list's item at `i` with its neighbor `dir` away, when there is one. */
const swapped = <T,>(list: T[], i: number, j: number): T[] => {
  if (i < 0 || j < 0 || i >= list.length || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

// ─── TABS ───────────────────────────────────────────────────────────────────

/** Why a tab can't be called `name` (blank, too long, another tab's), or null when it can. */
export const tabNameProblem = (def: Definition, current: string | null, name: string): string | null => {
  const sheet = sheetOf(def);
  const trimmed = name.trim();
  if (!trimmed) return 'A tab needs a name.';
  if (trimmed.length > LIMITS.tabName) return `At most ${LIMITS.tabName} characters.`;
  if ((sheet?.tabs ?? []).some((t) => t !== current && t.toLowerCase() === trimmed.toLowerCase())) return `There is already a tab called ${trimmed}.`;
  return null;
};

/**
 * A new tab at the end, named TAB 2, TAB 3... A sheet of one page gets its first tab, holding
 * every section. Refused (unchanged) at the server's limit.
 */
export const withNewTab = (def: Definition): Definition => {
  const sheet = sheetOf(def);
  if (!sheet) return def;
  const tabs = sheet.tabs ?? [];
  if (tabs.length >= LIMITS.tabs) return def;
  let n = tabs.length + 1;
  while (tabs.some((t) => t.toLowerCase() === `tab ${n}`)) n += 1;
  const name = `TAB ${n}`;
  const sections = tabs.length ? sheet.sections : sheet.sections.map((s) => ({ ...s, tab: name }));
  return withSheet(def, { ...sheet, tabs: [...tabs, name], sections });
};

/** A tab renamed, its sections with it. A name tabNameProblem refuses leaves it unchanged. */
export const withTabName = (def: Definition, current: string, name: string): Definition => {
  const sheet = sheetOf(def);
  if (!sheet || !sheet.tabs?.includes(current) || tabNameProblem(def, current, name)) return def;
  const next = name.trim();
  return withSheet(def, {
    ...sheet,
    tabs: sheet.tabs.map((t) => (t === current ? next : t)),
    sections: sheet.sections.map((s) => (s.tab === current ? { ...s, tab: next } : s)),
  });
};

/** A tab moved one place left (-1) or right (+1). */
export const withTabMoved = (def: Definition, name: string, dir: -1 | 1): Definition => {
  const sheet = sheetOf(def);
  if (!sheet?.tabs) return def;
  const i = sheet.tabs.indexOf(name);
  return withSheet(def, { ...sheet, tabs: swapped(sheet.tabs, i, i + dir) });
};

/**
 * A tab removed, its sections moved to `to` (another tab; the first other one when not given). The
 * last tab removed makes the sheet one page: no tabs, its sections kept in order.
 */
export const withoutTab = (def: Definition, name: string, to?: string): Definition => {
  const sheet = sheetOf(def);
  if (!sheet?.tabs?.includes(name)) return def;
  const others = sheet.tabs.filter((t) => t !== name);
  if (!others.length) {
    const { tabs: _gone, ...rest } = sheet;
    return withSheet(def, { ...rest, sections: sheet.sections.map(({ tab: _t, ...s }) => s) });
  }
  const dest = to && others.includes(to) ? to : others[0];
  return withSheet(def, { ...sheet, tabs: others, sections: sheet.sections.map((s) => (s.tab === name ? { ...s, tab: dest } : s)) });
};

// ─── SECTIONS ───────────────────────────────────────────────────────────────

/**
 * A new, empty list section at the end of `tab`: the first tab when that isn't one, and none on a
 * sheet of one page.
 */
export const withNewSection = (def: Definition, tab: string | null, label = 'NEW SECTION'): Definition => {
  const sheet = sheetOf(def);
  if (!sheet) return def;
  const id = idFor(label, sheet.sections.map((s) => s.id));
  const tabs = sheet.tabs ?? [];
  const on = tabs.length ? (tab !== null && tabs.includes(tab) ? tab : tabs[0]) : null;
  const section: Section = { id, label, layout: 'list', ...(on !== null ? { tab: on } : {}), fields: [] };
  return withSheet(def, { ...sheet, sections: [...sheet.sections, section] });
};

/**
 * A section changed: its name, its tab, how it looks, its columns (1 to 8, for a grid). Its id
 * stays. A blank name or one tab the sheet doesn't have is not stored.
 */
export const withSection = (def: Definition, id: string, patch: { label?: string; tab?: string; layout?: Section['layout']; columns?: number }): Definition => {
  const tabs = sheetOf(def)?.tabs ?? [];
  return withSections(def, (sections) => sections.map((s) => {
    if (s.id !== id) return s;
    const next: Section = { ...s };
    if (patch.label !== undefined && patch.label.trim()) next.label = patch.label.slice(0, LIMITS.label);
    if (patch.tab !== undefined && tabs.includes(patch.tab)) next.tab = patch.tab;
    if (patch.layout !== undefined && LAYOUTS.some((l) => l.id === patch.layout)) next.layout = patch.layout;
    if (patch.columns !== undefined && Number.isFinite(patch.columns)) next.columns = Math.max(1, Math.min(8, Math.round(patch.columns)));
    return next;
  }));
};

/** A section moved up (-1) or down (+1) among the sections on its own tab. */
export const withSectionMoved = (def: Definition, id: string, dir: -1 | 1): Definition => withSections(def, (sections) => {
  const i = sections.findIndex((s) => s.id === id);
  if (i < 0) return sections;
  const same = (s: Section) => (s.tab ?? null) === (sections[i].tab ?? null);
  let j = i + dir;
  while (j >= 0 && j < sections.length && !same(sections[j])) j += dir;
  return swapped(sections, i, j);
});

/** Why a section can't be removed (it holds the name), or null when it can. */
export const sectionRemoveProblem = (def: Definition, id: string): string | null =>
  (sheetOf(def)?.sections.find((s) => s.id === id)?.fields.some((f) => f.id === NAME_FIELD)
    ? 'It holds the character\'s name. Move Name to another section first.' : null);

/**
 * A section removed. Its stats, formulas and starter fields go back to the tray; its own plain
 * fields go with it. Refused (unchanged) while it holds the name.
 */
export const withoutSection = (def: Definition, id: string): Definition => {
  const sheet = sheetOf(def);
  const section = sheet?.sections.find((s) => s.id === id);
  if (!sheet || !section || sectionRemoveProblem(def, id)) return def;
  return forgetFields(withSheet(def, { ...sheet, sections: sheet.sections.filter((s) => s.id !== id) }), section.fields.map((f) => f.id));
};

// ─── FIELDS ─────────────────────────────────────────────────────────────────

/**
 * A new text field at the end of a section, its id from its first name and kept after. It never
 * takes an id the system has (takenIds: the starter's fields, health, stats, formulas, tables and
 * this sheet's own fields), so it never turns into one of those.
 */
export const withNewField = (def: Definition, sectionId: string, label = 'New field'): Definition => {
  const id = idFor(label, takenIds(def));
  return withSections(def, (sections) => sections.map((s) => (s.id === sectionId && s.fields.length < LIMITS.perSection
    ? { ...s, fields: [...s.fields, { id, label, type: 'text' }] } : s)));
};

/** Choices typed one per line (or comma-separated) as a pick-one field's options. */
export const optionsFrom = (text: string): { value: string; label: string }[] => {
  const seen = new Set<string>();
  return text.split(/[\n,]/).map((o) => o.trim().slice(0, LIMITS.label)).filter((o) => o && !seen.has(o.toLowerCase()) && seen.add(o.toLowerCase()))
    .slice(0, LIMITS.options).map((o) => ({ value: o, label: o }));
};

/** A pick-one field's choices as the page shows them, one per line. */
export const optionsText = (field: Field): string => (field.options ?? []).map((o) => o.label).join('\n');

export interface FieldPatch {
  label?: string;
  type?: Field['type'];
  /** Choices, one per line. */
  options?: string;
  /** EVERYONE (true) or the owner and the GM (false). */
  everyone?: boolean;
  /** Decides whether attacks hit: never shown to anyone else. */
  attack?: boolean;
  /** Only the GM changes it (true) or the player (false). */
  gmOnly?: boolean;
  hint?: string;
}

/**
 * A field changed; its id stays. A formula's kind and editing are fixed (it is worked out), as is
 * a linked field's kind. An attack number is never EVERYONE. Blank text clears hints, and a blank
 * name is not stored.
 */
export const withField = (def: Definition, id: string, patch: FieldPatch): Definition => {
  const fixed = (f: Field) => fieldKind(def, f) === 'formula' || fieldKind(def, f) === 'linked';
  return withSections(def, (sections) => sections.map((s) => ({
    ...s,
    fields: s.fields.map((f) => {
      if (f.id !== id) return f;
      const next: Field = { ...f };
      if (patch.label !== undefined && patch.label.trim()) next.label = patch.label.slice(0, LIMITS.label);
      if (patch.type !== undefined && !fixed(f) && TYPES.some((t) => t.id === patch.type)) {
        next.type = patch.type;
        if (patch.type === 'select') { if (!next.options?.length) next.options = optionsFrom('Option 1\nOption 2'); } else delete next.options;
      }
      if (patch.options !== undefined && next.type === 'select') {
        const options = optionsFrom(patch.options);
        if (options.length) next.options = options;
      }
      if (patch.attack !== undefined) {
        if (patch.attack) { next.sensitivity = 'combat'; delete next.visibility; } else delete next.sensitivity;
      }
      if (patch.everyone !== undefined) {
        if (patch.everyone && next.sensitivity !== 'combat') next.visibility = 'public'; else delete next.visibility;
      }
      if (patch.gmOnly !== undefined && fieldKind(def, f) !== 'formula') {
        if (patch.gmOnly) next.edit = 'gm'; else delete next.edit;
      }
      if (patch.hint !== undefined) {
        if (patch.hint.trim()) next.hint = patch.hint.slice(0, LIMITS.hint); else delete next.hint;
      }
      return next;
    }),
  })));
};

/** A field moved up (-1) or down (+1) within its section. */
export const withFieldMoved = (def: Definition, id: string, dir: -1 | 1): Definition => withSections(def, (sections) => sections.map((s) => {
  const i = s.fields.findIndex((f) => f.id === id);
  return i < 0 ? s : { ...s, fields: swapped(s.fields, i, i + dir) };
}));

/** A field moved to the end of another section. */
export const withFieldIn = (def: Definition, id: string, sectionId: string): Definition => {
  const field = fieldsOn(sheetOf(def)).find((f) => f.id === id);
  const to = sheetOf(def)?.sections.find((s) => s.id === sectionId);
  if (!field || !to || to.fields.some((f) => f.id === id) || to.fields.length >= LIMITS.perSection) return def;
  return withSections(def, (sections) => sections.map((s) => (s.id === sectionId
    ? { ...s, fields: [...s.fields, field] } : { ...s, fields: s.fields.filter((f) => f.id !== id) })));
};

/**
 * A field taken off the sheet: a stat, formula or starter field back to the tray, a plain field of
 * the sheet's own gone. The name stays (unchanged).
 */
export const withoutField = (def: Definition, id: string): Definition => {
  if (id === NAME_FIELD) return def;
  return forgetFields(withSections(def, (sections) => sections.map((s) => ({ ...s, fields: s.fields.filter((f) => f.id !== id) }))), [id]);
};

/**
 * A field from the tray put at the end of a section, or of a new section when there is none to
 * put it in (`sectionId` null, or a section that is gone).
 */
export const withPlaced = (def: Definition, field: Field, sectionId: string | null, tab: string | null = null): Definition => {
  const sheet = sheetOf(def);
  if (!sheet || fieldsOn(sheet).some((f) => f.id === field.id)) return def;
  let next = def;
  let target = sectionId && sheet.sections.some((s) => s.id === sectionId) ? sectionId : null;
  if (!target) {
    next = withNewSection(def, tab ?? sheet.tabs?.[0] ?? null);
    const after = sheetOf(next)!.sections;
    target = after[after.length - 1].id;
  }
  return withSections(next, (sections) => sections.map((s) => (s.id === target && s.fields.length < LIMITS.perSection
    ? { ...s, fields: [...s.fields, { ...field }] } : s)));
};

/** References to fields that left: the header's, and a current value's max. */
const forgetFields = (def: Definition, gone: string[]): Definition => {
  const sheet = sheetOf(def);
  if (!sheet || !gone.length) return def;
  const left = new Set(gone);
  const sections = sheet.sections.map((s) => ({
    ...s,
    fields: s.fields.map((f) => { if (f.maxField && left.has(f.maxField)) { const { maxField: _m, ...rest } = f; return rest; } return f; }),
  }));
  if (!sheet.header) return withSheet(def, { ...sheet, sections });
  const h = { ...sheet.header };
  if (h.nameField && left.has(h.nameField)) delete h.nameField;
  if (h.hpField && left.has(h.hpField)) { delete h.hpField; delete h.hpMaxField; }
  if (h.hpMaxField && left.has(h.hpMaxField)) delete h.hpMaxField;
  if (h.subtitleFields) { h.subtitleFields = h.subtitleFields.filter((f) => !left.has(f)); if (!h.subtitleFields.length) delete h.subtitleFields; }
  if (h.chips) { h.chips = h.chips.filter((c) => !left.has(c.field)); if (!h.chips.length) delete h.chips; }
  return withSheet(def, { ...sheet, sections, header: h });
};

// ─── PROBLEMS ───────────────────────────────────────────────────────────────

/** The server's problems with the sheet, by the field or section they belong to ("sheet field str, label" is str's). */
export const sheetProblems = (problems: { where: string; message: string }[]): { fields: Record<string, string>; sections: Record<string, string>; other: string[] } => {
  const out = { fields: {} as Record<string, string>, sections: {} as Record<string, string>, other: [] as string[] };
  for (const p of problems) {
    const field = /^sheet field ([a-z][a-z0-9_]*)(,|$)/.exec(p.where);
    const section = /^sheet section ([a-z][a-z0-9_]*)(,|$)/.exec(p.where);
    if (field) { if (!out.fields[field[1]]) out.fields[field[1]] = p.message; } else if (section) { if (!out.sections[section[1]]) out.sections[section[1]] = p.message; } else if (p.where.startsWith('sheet')) out.other.push(`${p.where}: ${p.message}`);
  }
  return out;
};
