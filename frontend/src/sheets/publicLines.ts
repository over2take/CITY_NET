// What everyone else sees of a custom system's character (4b3e): the lines of ID.EXE's INFO. The
// user decided 2026-10-07 that a custom system shows its name and every field its sheet shows to
// EVERYONE there, as the built-in systems show handle, name and role. A value that decides whether
// attacks hit never shows, whatever it is marked; the server never sends it either
// (backend/sheets/templates.js filterPublicData). The builder's preview shows the same lines.

/** The parts of a sheet layout this reads: a custom render copy's or a template's. */
interface Layout {
  header?: { nameField?: string };
  sections: { fields?: { id: string; label: string; visibility?: string; sensitivity?: string }[] }[];
}

/** The name, then each EVERYONE field that isn't an attack number, in sheet order, with its value or a dash. */
export const othersSee = (sheet: Layout, data: Record<string, unknown>): { label: string; value: string }[] => {
  const nameField = sheet.header?.nameField ?? 'name';
  const text = (v: unknown) => (v === undefined || v === null || v === '' ? '—' : String(v));
  const fields = sheet.sections.flatMap((s) => s.fields ?? []);
  const name = fields.find((f) => f.id === nameField);
  return [
    ...(name ? [{ label: name.label, value: text(data[name.id]) }] : []),
    ...fields.filter((f) => f.id !== nameField && f.visibility === 'public' && f.sensitivity !== 'combat')
      .map((f) => ({ label: f.label, value: text(data[f.id]) })),
  ];
};
