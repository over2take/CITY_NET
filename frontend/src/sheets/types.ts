// Character sheet template engine types.
//
// A game system is a data-driven template: sections of fields that one
// renderer (SheetRenderer) can draw for any system. Adding a system later
// means adding a template file, not new UI.

export type SheetFieldType = 'number' | 'text' | 'textarea' | 'select';

export interface SheetOption { value: string; label: string }

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
  /** Give this field a row of its own spanning the whole grid, with its label above it.
   *  For a notes box inside a repeated entry, where a grid cell will not do. */
  fullWidth?: boolean;
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
  /** For 'select' fields: the allowed choices. Supply one with an empty value to name
   *  the blank state; otherwise an em-dash placeholder is added for you. */
  options?: SheetOption[];
  /** For 'select' fields: other fields to write when this one changes.
   *
   *  Picking a vehicle type fills its stat block from the book. Given the chosen value
   *  and the current data, so it can decline to overwrite what someone has already
   *  typed. Returning {} writes nothing. */
  presetFill?: (value: string, data: SheetData) => Record<string, string | number>;
}

/** 'weapons' lays fields out as structured rows (name / dmg / skill / rof),
 *  chunked in field order - every section.columns (default 4) consecutive
 *  fields form one row. 'spells' is the same shape plus a CAST button per
 *  row (one-click: rolls the row's damage dice and spends its Effort cost).
 *  'ability_list' is a dynamic add/remove list stored as JSON in a single
 *  field; each item has name, cost, attr (dropdown), die, and effect. */
export type SectionLayout = 'grid' | 'list' | 'skills' | 'notes' | 'weapons' | 'spells' | 'ability_list';

/** Configuration for the 'ability_list' section layout. */
export interface AbilityListConfig {
  /** Label for the cost column (default: 'COST'). */
  costLabel?: string;
  /** Attribute dropdown options. Omit to hide the attribute column. */
  attrs?: { value: string; label: string }[];
  /** Roll/cast button label (default: 'ROLL'). */
  rollLabel?: string;
}

export interface SheetSection {
  id: string;
  label: string;
  layout: SectionLayout;
  /**
   * Fields per repeated entry, for sections that hold several of the same thing.
   *
   * Set it and the section shows only entries that have data, plus one blank and a
   * button to reveal the next — so a sheet with one vehicle shows one vehicle, and the
   * ones you have filled in come back on their own after a reload. Leave it unset and
   * the section renders every row it declares, which is what weapons and spells do.
   */
  groupSize?: number;
  /** grid layout: number of columns (default 4) */
  columns?: number;
  /**
   * Hide a row of a repeated entry, given its fields and the sheet's data.
   *
   * A vehicle with no hardpoints has no mounts, and drawing three empty mount rows for a
   * motorcycle states something false about it. Applied at render time only, so the
   * grouping arithmetic is untouched and a hidden row keeps whatever is stored in it.
   */
  rowHidden?: (row: SheetField[], data: SheetData) => boolean;
  /** Which bottom tab this section lives under (default: the first tab). */
  tab?: string;
  fields: SheetField[];
  /** ability_list layout configuration. */
  listConfig?: AbilityListConfig;
}

/** Drives the identity header block: portrait frame, name, subtitle line,
 *  HP bar, and at-a-glance chips. All values read from sheet data. */
export interface SheetHeader {
  /** IMPORTANT: the sheet is the single source of truth for player identity.
   *  The backend mirrors this field (plus `description`) onto the player's
   *  token and uses it as the roll display name — via its own map in
   *  backend/sheets/identity.js NAME_FIELDS, which defaults to 'name'.
   *  Use 'name' as the id (relabel it per system — CP:R labels it Handle).
   *  If a template must use another id, add a matching entry to
   *  NAME_FIELDS or tokens/rolls will fall back to the login username. */
  nameField: string;
  subtitleFields?: string[];
  hpField?: string;
  hpMaxField?: string;
  chips?: { field: string; label: string }[];
  /** If set, a row of clickable pips is shown for this field (current/max).
   *  Clicking a pip decrements the current value by 1 (spend). */
  luckField?: string;
  luckMaxField?: string;
  /** Label shown above the pip row. Defaults to 'LUCK'. */
  luckLabel?: string;
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
  /** When false, the fumble-shield pip control is hidden even if the
   *  luck_negates_fumble house rule is on. Set false for systems whose
   *  critical-failure mechanic is not a nat-1 on a single die (e.g. SR6
   *  glitches are pool-based). Defaults to true. */
  allowFumbleShield?: boolean;
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
  /** Envelope fields the server attaches, not stored on the sheet. */
  players?: string[];
  ride?: { owner: string; vehicleName: string; mounts: { index: number; name: string; dmg: string; skill: string }[] } | null;
}
