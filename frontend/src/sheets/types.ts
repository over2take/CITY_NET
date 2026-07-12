// Character sheet template engine types.
//
// A game system is a data-driven template: sections of fields that one
// renderer (SheetRenderer) can draw for any system. Adding a system later
// means adding a template file, not new UI.

export type SheetFieldType = 'number' | 'text' | 'textarea';

export interface SheetField {
  id: string;
  label: string;
  type: SheetFieldType;
  /** 'public' fields appear on the quick-sheet card other players see.
   *  Default is private. The server enforces this - the client flag only
   *  drives edit-time hints. */
  visibility?: 'public' | 'private';
  /** Combat-sensitive values (SP, AC...) - never exposed to non-owners,
   *  server-enforced regardless of visibility. */
  sensitivity?: 'combat';
  /** For skill rows: the id of the stat field this skill keys off.
   *  The renderer shows BASE = skill level + stat value. */
  stat?: string;
  /** Paired field id holding this field's maximum (renders as current/max). */
  maxField?: string;
  /** Hint that this field is rollable (Phase 2 wires the actual roll). */
  roll?: { formula: string; label: string };
}

export type SectionLayout = 'grid' | 'list' | 'skills' | 'notes';

export interface SheetSection {
  id: string;
  label: string;
  layout: SectionLayout;
  /** grid layout: number of columns (default 4) */
  columns?: number;
  fields: SheetField[];
}

export interface SheetTemplate {
  id: string;
  name: string;
  sections: SheetSection[];
}

export interface SheetData {
  [fieldId: string]: string | number | null | undefined;
}

export interface CharacterSheet {
  id: number;
  username: string;
  system: string;
  data: SheetData;
  portrait_url: string | null;
  is_npc: number;
  npc_label?: string | null;
}
