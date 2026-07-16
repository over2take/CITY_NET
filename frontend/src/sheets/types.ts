// Character sheet template engine types.
//
// A game system is a data-driven template: sections of fields that one
// renderer (SheetRenderer) can draw for any system. Adding a system later
// means adding a template file, not new UI.

export type SheetFieldType = 'number' | 'text' | 'textarea' | 'select';

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
  /** Example value shown as ghost text inside an empty field (input placeholder). */
  placeholder?: string;
  /** Hint that this field is rollable (Phase 2 wires the actual roll). */
  roll?: { formula: string; label: string };
  /** Linked field: the value lives in another system and is overlaid by the
   *  server at read time (never stored in the sheet's JSON).
   *  - token_hp / token_hp_max: the player's rhombus health
   *  - bank_balance: the player's bank balance (read-only on the sheet)
   *  - token_ac: the token's armor class (writable; see sourceWritable) */
  source?: 'token_hp' | 'token_hp_max' | 'bank_balance' | 'token_ac';
  /** Writable linked field: renders as a normal input; the server routes the
   *  write to the owning system (e.g. token_ac -> the token's AC). */
  sourceWritable?: boolean;
  /** For 'select' fields: the allowed choices. */
  options?: { value: string; label: string }[];
}

/** 'weapons' lays fields out as structured rows (name / dmg / skill / rof),
 *  chunked in field order - every section.columns (default 4) consecutive
 *  fields form one row. 'spells' is the same shape plus a CAST button per
 *  row (one-click: rolls the row's damage dice and spends its Effort cost). */
export type SectionLayout = 'grid' | 'list' | 'skills' | 'notes' | 'weapons' | 'spells';

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
  /** If set, a row of clickable pips is shown for this field (current/max).
   *  Clicking a pip decrements the current value by 1 (spend). */
  luckField?: string;
  luckMaxField?: string;
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
  /** When set, dropping to 0 HP shows a MORTALLY WOUNDED banner with a
   *  DEATH SAVE button. The server rolls 1d10 + penalty vs statField and
   *  tracks the escalating penalty in penaltyField. */
  deathSave?: { statField: string; penaltyField: string };
  /** When set, dropping to 0 HP shows a MORTALLY WOUNDED banner with a
   *  STABILIZE button (CWN-style: an ally's Heal check vs a rising DC; the
   *  server rolls the clicking user's own sheet). Mutually exclusive with
   *  deathSave in practice - a template defines one death flow. */
  stabilize?: boolean;
  /** NPC power tiers offered by GENERATE_SHEET (must mirror the server's
   *  npcTiers registry for this system). Absent = untiered generation. */
  npcTiers?: { id: string; label: string }[];
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
