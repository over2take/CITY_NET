// What an uploaded storefront catalogue looks like, per system.
//
// **The columns are not invented here.** Each system's sheet template already declares the
// fields a weapon row or a vehicle slot has, so the column set for an uploaded catalogue is
// read out of the template rather than written down a second time and kept in step by hand.
// That means the example a GM downloads is always right for the system that is loaded, and
// cannot drift as templates change.
//
// Three shapes, because a sheet stores these three ways:
//
//   numbered slots  - weapons, vehicles. `weapon1_dmg`, `vehicle1_hp`. Columns come from
//                     the template's own field ids.
//   a row list      - cyberware. A JSON array of objects with a known shape.
//   inventory rows  - everything else: gear, armor, mods, fittings, doses. Name, price and
//                     a description, because that is all an inventory row holds.
//
// A system with no repeating groups at all - `generic` is one - can only take the third
// shape. That is the sheet having nowhere else to put an item, not a limit of the uploader,
// and the example says so rather than leaving somebody to discover it.

import { getTemplate } from './index';
import type { ShopStock } from '../data/buildingTypes';
import { BUILDING_TYPES, CATALOGUES, typeLabel, catalogueLabel } from '../data/buildingTypes';

/** Columns every catalogue carries, whatever its shape. */
const NAME = 'name';
const PRICE = 'price';

/**
 * Which numbered row group a catalogue fills, where it fills one.
 *
 * Not every catalogue does. A gas mask has no row group - it is an inventory line - and
 * that is the common case rather than the exception.
 */
const ROW_GROUP: Partial<Record<ShopStock, string>> = {
  weapons: 'weapon',
  vehicles: 'vehicle',
};

/**
 * Catalogues stored as their own list of objects rather than in numbered slots, and the
 * section layout a sheet needs to have for that list to exist.
 */
const ROW_LIST: Partial<Record<ShopStock, { layout: string; columns: string[] }>> = {
  // Matches cyberwareRows: what the shop already writes when a piece is bought.
  cyberware: { layout: 'cyberware', columns: ['type', 'strain', 'conc', 'effect'] },
};

/**
 * The section layouts a system's sheet draws.
 *
 * Whether a sheet has a cyberware table is a layout, not a field id - the whole table lives
 * under one array field - so it cannot be read the way the row groups are. Shadowrun keeps
 * its chrome in a notes box and generic has none, so a bought implant there is an inventory
 * line rather than a row in a table the sheet never shows.
 */
export const layoutsOf = (system: string): Set<string> => {
  const template = getTemplate(system) as unknown as { sections?: { layout?: string }[] };
  return new Set((template.sections ?? []).map((s) => s.layout ?? '').filter(Boolean));
};

/** What an inventory line can actually hold. */
const INVENTORY_COLUMNS = ['enc', 'description'];

/**
 * Fields a row has that a CATALOGUE does not.
 *
 * A template row carries everything about one weapon a character owns, and some of that
 * belongs to the character rather than to the thing on the shelf. A shop does not sell you
 * an attack bonus, and every gun in the case is neither readied nor stowed until somebody
 * buys it. Offering these as columns would invite a GM to fill in something that gets
 * overwritten the moment the item is bought.
 */
const NOT_CATALOGUE = new Set([
  // Per character: their bonus with the weapon, not a property of the weapon.
  'atk',
  // Set at the moment of purchase - a bought weapon arrives stowed.
  'carry',
  // Per instance: what has been bolted onto this particular one since.
  'mods',
  // Per instance: whether this vehicle is moving right now.
  'moving',
  // Per instance: what has been bolted onto this particular vehicle since.
  'fittings',
  /**
   * The same number as `price`, under the sheet's own name for it.
   *
   * `vehicle1_cost` is where the sheet records what a vehicle cost. Offering it as a
   * column beside `price` invites two answers to one question, so the purchase fills it
   * from the price instead.
   */
  'cost',
]);

/**
 * Every repeating row group in a system, as group -> the suffixes row 1 declares.
 *
 * Walks the built template looking for field ids shaped `<group><n>_<suffix>` and reads
 * row 1, which is the definition every other row copies.
 */
export const rowGroupsOf = (system: string): Record<string, string[]> => {
  const template = getTemplate(system) as unknown;
  const ids: string[] = [];
  const walk = (node: unknown): void => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === 'object') {
      const o = node as Record<string, unknown>;
      if (typeof o.id === 'string') ids.push(o.id);
      Object.values(o).forEach(walk);
    }
  };
  walk(template);

  const groups: Record<string, string[]> = {};
  for (const id of ids) {
    const m = /^([a-z_]+?)(\d+)_(.+)$/.exec(id);
    if (!m) continue;
    const [, group, n, suffix] = m;
    // Row 1 defines the shape; the rest are copies of it.
    if (n !== '1') continue;
    // A nested mount - `vehicle1_weapon1_dmg` - belongs to its vehicle, not to a group of
    // its own, and is not something a catalogue row fills.
    if (/\d/.test(suffix)) continue;
    (groups[group] ||= []).push(suffix);
  }
  return groups;
};

export interface CatalogueColumns {
  catalogue: ShopStock;
  /** The column headers, in order, starting with name and price. */
  columns: string[];
  /** Where a bought item goes, which is what decides the columns. */
  shape: 'slots' | 'list' | 'inventory';
  /** Null when this system can take the catalogue at all. Otherwise why it cannot. */
  unavailable?: string;
}

/**
 * The columns for one catalogue under one system.
 *
 * A catalogue whose row group the system does not have falls back to an inventory line
 * rather than being refused - a Shadowrun vehicle has nowhere typed to go, but a GM can
 * still sell one and have it land in the player's gear.
 */
export const columnsFor = (system: string, catalogue: ShopStock): CatalogueColumns => {
  const groups = rowGroupsOf(system);

  const group = ROW_GROUP[catalogue];
  if (group && groups[group]) {
    // `name` comes from the group too, so it is not listed twice.
    const rest = groups[group].filter((s) => s !== NAME && !NOT_CATALOGUE.has(s));
    return { catalogue, shape: 'slots', columns: [NAME, PRICE, ...rest] };
  }

  const list = ROW_LIST[catalogue];
  if (list && layoutsOf(system).has(list.layout)) {
    return { catalogue, shape: 'list', columns: [NAME, PRICE, ...list.columns] };
  }

  const missing = group ? `${group} rows` : list ? `${list.layout} table` : null;
  return {
    catalogue,
    shape: 'inventory',
    columns: [NAME, PRICE, ...INVENTORY_COLUMNS],
    ...(missing
      ? { unavailable: `${system} has no ${missing}, so these land in the inventory` }
      : {}),
  };
};

/** Which storefronts sell a given catalogue, by this game's names, for labelling a section. */
export const shopsSelling = (catalogue: ShopStock, system: string): string[] =>
  BUILDING_TYPES.filter((t) => t.shop && t.sells.includes(catalogue)).map((t) => typeLabel(t.id, system));

/**
 * A few real rows per catalogue, so the example is something to edit rather than a blank
 * form. Drawn from the book where the app already has the table, and written plainly
 * where it does not.
 */
const DEMOS: Partial<Record<ShopStock, Record<string, string>[]>> = {
  cyberware: [
    { name: 'Cranial Jack', price: '1000', type: 'head', strain: '1', conc: 'touch', effect: 'Lets you jack into a deck or a skillplug' },
    { name: 'Dermal Armor I', price: '40000', type: 'skin', strain: '1', conc: 'sight', effect: 'Base AC 13 against ranged and melee' },
  ],
  weapons: [
    { name: 'Heavy Pistol', price: '200', dmg: '1d8', skill: 'shoot', attr: 'dex', trauma: '1d8/x2', shock: '2/15', enc: '1' },
    { name: 'Combat Rifle', price: '2500', dmg: '2d8', skill: 'shoot', attr: 'dex', trauma: '1d10/x3', shock: '', enc: '2' },
  ],
  vehicles: [
    { name: 'MOTORCYCLE', price: '1000', hp: '10', hp_max: '10', armor: '4', ac: '13', spd: '1', crew: '1', size: 'S' },
  ],
  armor: [
    { name: 'Armored Clothing', price: '1000', enc: '2', description: 'Ranged AC 16, melee 14, soak 5. Subtle' },
  ],
  gear: [
    { name: 'Climbing kit', price: '150', enc: '2', description: 'Cord, grapnel, grip handholds and wall adhesive' },
    { name: 'Gas mask', price: '1000', enc: '1', description: 'Readied: immune to most inhaled gases' },
  ],
  pharmaceuticals: [
    { name: 'Boneshaker', price: '10', enc: '', description: 'Heal-1. +2 to hit for a scene, 1 System Strain' },
  ],
  weapon_mods: [
    { name: 'EXTENDED MAG', price: '500', enc: '', description: 'Fix-1. Doubles the weapon magazine' },
  ],
  armor_mods: [
    { name: 'SEALED', price: '2500', enc: '', description: 'Fix-1. Environmentally seals armor for 30 minutes' },
  ],
  vehicle_fittings: [
    { name: 'ARMOR PLATING', price: '5000', enc: '', description: 'Power 0, Mass 3, minimum size S. Adds armor' },
  ],
  vehicle_weapons: [
    { name: 'AUTOCANNON', price: '15000', enc: '', description: 'Power 2, Mass 3, minimum size M' },
  ],
};

const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));

/** A value that needs quoting: commas, quotes and newlines all force it. */
const csvCell = (value: string): string =>
  /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** One row on its way into a file. `commented` writes it out for reference only. */
export interface OutRow {
  values: Record<string, string>;
  /**
   * Written behind a `#`, so it is visible but does not come back in.
   *
   * This is what keeps "download what I have" from being a trap. A file listing all 216
   * book items would, on re-upload, turn every one of them into an override - and the
   * book would stop tracking the app. Commented, they are there to read and to copy, and
   * uncommenting one is the deliberate act of overriding it.
   */
  commented?: boolean;
}

/**
 * Write a catalogue file: every catalogue as its own section, in the columns this system
 * actually has.
 *
 * Sections are marked `[catalogue_id]` and headed with a comment naming the storefronts
 * that sell them, so somebody stocking a gun shop can find the part they care about
 * without knowing the internal names. Comment lines and blank lines are ignored on the way
 * back in, so the whole thing can be edited in place and re-uploaded.
 */
export const writeCatalogueFile = (
  system: string,
  rowsFor: (catalogue: ShopStock) => OutRow[],
  catalogues?: ShopStock[],
  preamble: string[] = [],
): string => {
  const wanted = catalogues ?? CATALOGUES.map((c) => c.id);
  const out: string[] = [
    '# CITY_NET storefront catalogue',
    `# system: ${system}`,
    '#',
    ...preamble.map((l) => (l ? `# ${l}` : '#')),
    '# Each [section] is one catalogue. Edit the rows, add your own, delete what you do',
    '# not want. Lines starting with # are ignored, and so are blank lines.',
    '#',
    '# name and price are required. Everything after them fills the character sheet when',
    '# the item is bought, and the columns are the ones this system actually has.',
    '',
  ];

  for (const catalogue of wanted) {
    const spec = columnsFor(system, catalogue);
    const shops = shopsSelling(catalogue, system);

    out.push(`# ${'─'.repeat(70)}`);
    out.push(`# ${catalogueLabel(catalogue, system).toUpperCase()}`);
    if (shops.length) out.push(`# sold by: ${shops.join(', ')}`);
    else out.push('# sold by: no storefront yet');
    if (spec.unavailable) out.push(`# note: ${spec.unavailable}`);
    if (spec.shape === 'inventory' && !spec.unavailable) {
      out.push('# these land in the inventory, so they carry a description rather than stats');
    }
    out.push(`[${catalogue}]`);

    const rows = rowsFor(catalogue);
    // Widths make the file readable in a text editor. A spreadsheet trims them, and so
    // does the parser, so nothing depends on the padding.
    const widths = spec.columns.map((col) => Math.max(
      col.length,
      ...rows.map((r) => csvCell(r.values[col] ?? '').length),
    ));
    const line = (cells: string[]) =>
      cells.map((c, i) => pad(c, widths[i])).join(', ').replace(/\s+$/, '');

    out.push(line(spec.columns));
    for (const row of rows) {
      const text = line(spec.columns.map((c) => csvCell(row.values[c] ?? '')));
      out.push(row.commented ? `# ${text}` : text);
    }
    out.push('');
  }

  return out.join('\n');
};

/** The example a GM downloads to start from: the shape, with a few real rows in it. */
export const exampleFor = (system: string, catalogues?: ShopStock[]): string =>
  writeCatalogueFile(
    system,
    (catalogue) => (DEMOS[catalogue] ?? []).map((values) => ({ values })),
    catalogues,
  );

/** One entry as the server describes it, book or uploaded. */
export interface StoredEntry {
  id: string;
  name: string;
  price: number;
  fields?: Record<string, string>;
  source: 'book' | 'uploaded';
}

/**
 * Everything a system currently sells, as a file to edit and send back.
 *
 * Uploaded rows are live; the ones that came with the app are written behind a `#`. That
 * way the file is a complete picture — a GM can see what a Heavy Pistol costs and change
 * it by uncommenting the line — while re-uploading it untouched changes nothing at all.
 */
export const currentFor = (
  system: string,
  entries: Partial<Record<ShopStock, StoredEntry[]>>,
  catalogues?: ShopStock[],
): string =>
  writeCatalogueFile(
    system,
    (catalogue) => (entries[catalogue] ?? []).map((e) => ({
      commented: e.source === 'book',
      values: {
        name: e.name,
        price: String(e.price),
        ...(e.fields ?? {}),
      },
    })),
    catalogues,
    [
      'This is what your shops currently sell.',
      '',
      'Rows behind a # came with the app. They are here to read, and re-uploading this',
      'file leaves them exactly as they are. To change one, delete its # and edit it -',
      'that is what tells CITY_NET you meant to override it.',
    ],
  );
