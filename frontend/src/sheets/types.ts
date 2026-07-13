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
  /** Short helper text shown as a tooltip on the field. */
  hint?: string;
  /** Hint that this field is rollable (Phase 2 wires the actual roll). */
  roll?: { formula: string; label: string };
  /** Linked field: the value lives in another system and is overlaid by the
   *  server at read time (never stored in the sheet's JSON).
   *  - token_hp / token_hp_max: the player's rhombus health (editable;
   *    writes route to the token)
   *  - bank_balance: the player's bank balance (read-only on the sheet) */
  source?: 'token_hp' | 'token_hp_max' | 'bank_balance';
}

export type SectionLayout = 'grid' | 'list' | 'skills' | 'notes';

export interface SheetSection {
  id: string;
  label: string;
  layout: SectionLayout;
  /** grid layout: number of columns (default 4) */
  columns?: number;
  /** Which bottom tab this section lives under (default: the first tab). */
  tab?: string;
  fields: SheetField[];
}

/** Drives the identity header block: portrait frame, name, subtitle line,
 *  HP bar, and at-a-glance chips. All values read from sheet data. */
export interface SheetHeader {
  nameField: string;
  subtitleFields?: string[];
  hpField?: string;
  hpMaxField?: string;
  chips?: { field: string; label: string }[];
}

/** How this system's defense value appears on tokens. When absent, the
 *  default D&D-style AC editor is shown on the token menu. */
export interface TokenDefense {
  /** Show the melee/ranged editor on the token menu. False = defense lives
   *  on the character sheet (e.g. CP:R armor SP) and the menu links there. */
  editOnToken: boolean;
  /** What attack banners call the to-hit target ('AC', 'DV'...). */
  label: string;
  /** Shown on the token menu when editOnToken is false. */
  note?: string;
}

export interface SheetTemplate {
  id: string;
  name: string;
  header?: SheetHeader;
  tokenDefense?: TokenDefense;
  /** Bottom tab bar, in order. Sections map to tabs via section.tab. */
  tabs?: string[];
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
