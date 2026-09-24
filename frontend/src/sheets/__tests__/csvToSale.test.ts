/**
 * A CSV, all the way to money and back.
 *
 * Every piece of this is tested on its own: the file the app writes, the server's parser,
 * placing an item on a sheet, and the server's sale. What those tests cannot see is the
 * seams between them - each builds its input by hand, so a parser that started handing
 * back `ROF` instead of `rof` would pass all of them while a bought gun quietly arrived
 * without its rate of fire.
 *
 * So this runs the real chain on the same data: a CSV is parsed by the server's parser,
 * stored and read back the way the database does it, bought onto a sheet by the window's
 * writer, and sold back by the server's planner. The sheet has to end up empty and the
 * money has to add up.
 *
 * Cyberpunk RED, Shadowrun and generic here. CWN places through its own book shelves in
 * the window, so its version of this chain lives in ShopWindow.test.tsx.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import { exampleFor, columnsFor } from '../catalogueSchema';
import { placeUploaded } from '../shopPlacement';
import { ownedItems } from '../ownedItems';
import { slotsOf } from '../sheetSlots';
import { loadUploaded, clearUploaded, type UploadedEntry } from '../uploadedCatalogues';
import { CATALOGUES, type ShopStock } from '../../data/buildingTypes';

const require_ = createRequire(import.meta.url);
const { parseCatalogue } = require_('../../../../backend/shops/catalogueParse.js');
const catalogueDb = require_('../../../../backend/shops/catalogueDb.js');
const store = require_('../../../../backend/shops/catalogueStore.js');
const { planSale } = require_('../../../../backend/shops/sell.js');

const SYSTEMS = ['cyberpunk_red', 'shadowrun_6e', 'generic'];
/** What a shop can actually put on a shelf. */
const SHELVED = CATALOGUES.filter((c) => c.shelved).map((c) => c.id);
const PCT = 50;

type Sections = Partial<Record<ShopStock, UploadedEntry[]>>;

/**
 * Parse a file, then store and read it back the way saving it does.
 *
 * The database hop is included because it is a seam too: fields go in as JSON text and
 * come out through `shape`, and a field lost there would be lost for real.
 */
const upload = (system: string, text: string): Sections => {
  const parsed = parseCatalogue(text);
  expect(parsed.problems, 'the file had problems').toEqual([]);
  const rows = Object.entries(parsed.sections as Record<string, UploadedEntry[]>)
    .flatMap(([catalogue, entries]) => entries.map((e) => ({
      catalogue, id: e.id, name: e.name, price: e.price, fields: JSON.stringify(e.fields),
    })));
  const sections = catalogueDb.shape(rows) as Sections;
  store.load(system, sections);
  loadUploaded(sections);
  return sections;
};

/** Every row in every shelved section, in file order. */
const everything = (sections: Sections) =>
  SHELVED.flatMap((catalogue) => (sections[catalogue] ?? []).map((entry) => ({ catalogue, entry })));

/**
 * Buy each item in turn onto one sheet, the way a player walking round the shops would.
 *
 * Each placement reads the sheet as the last one left it, which is what makes the second
 * gun go in the second row.
 */
const buyAll = (system: string, sections: Sections) => {
  let sheet: Record<string, unknown> = {};
  for (const { catalogue, entry } of everything(sections)) {
    const placed = placeUploaded(system, catalogue, entry, sheet);
    expect(placed.ok, `${system}: nowhere to put ${entry.name}`).toBe(true);
    if (placed.ok) sheet = { ...sheet, ...placed.patch };
  }
  return sheet;
};

/** Sell every one of them back in one basket, as the SELL tab would send it. */
const sellAll = (system: string, sections: Sections, sheet: Record<string, unknown>) => planSale({
  data: sheet,
  items: everything(sections).map(({ catalogue, entry }) => ({ catalogue, id: entry.id, qty: 1 })),
  catalogues: SHELVED,
  locationPct: PCT,
  globalPct: null,
  system,
});

/** What the sale should pay: each item at the rate, each rounded down on its own. */
const expectedPayout = (sections: Sections) =>
  everything(sections).reduce((n, { entry }) => n + Math.floor((entry.price * PCT) / 100), 0);

afterEach(() => { store.clear(); clearUploaded(); });

describe('the example file, bought and sold back', () => {
  for (const system of SYSTEMS) {
    it(`${system}: every demo item is owned once bought, and gone once sold`, () => {
      const sections = upload(system, exampleFor(system));
      expect(everything(sections).length, 'an example with nothing in it proves nothing')
        .toBeGreaterThan(5);

      const sheet = buyAll(system, sections);
      // The window's own reader sees each thing as the uploaded item it was bought as.
      const owned = ownedItems(sheet, system);
      for (const { catalogue, entry } of everything(sections)) {
        expect(owned.find((l) => l.key === `${catalogue}/${entry.id}`), `${system}: ${entry.name}`)
          .toMatchObject({ qty: 1, unitPrice: entry.price });
      }

      const sale = sellAll(system, sections, sheet);
      expect(sale).toMatchObject({ ok: true, payout: expectedPayout(sections) });
      expect(ownedItems({ ...sheet, ...sale.patch }, system), 'left on the sheet after selling')
        .toEqual([]);
    });
  }
});

describe("a GM's own file, with every column filled in", () => {
  /**
   * The example leaves columns blank - a Cyberpunk RED gun in it has no rate of fire - so
   * it cannot show that each column reaches the sheet. This file fills every one, with a
   * value naming its column so a field landing in the wrong place is visible.
   */
  const VALUE: Record<string, string> = {
    // The two a cyberware row checks: strain is a number, concealment one of four words.
    strain: '3',
    conc: 'touch',
  };
  const valueOf = (col: string) => VALUE[col] ?? `${col} value`;

  const fileFor = (system: string) => SHELVED.flatMap((catalogue) => {
    const { columns } = columnsFor(system, catalogue);
    const cells = columns.map((col) => (
      // Quoted, as a spreadsheet saves it: bare, the comma would split it into two cells.
      col === 'name' ? `House ${catalogue}` : col === 'price' ? '"1,200"' : valueOf(col)
    ));
    return [
      `[${catalogue}]`,
      columns.join(','),
      // One cell quoted with a comma inside, which is how a spreadsheet saves prose.
      cells.map((c, i) => (i === columns.length - 1 && columns.length > 2 ? `"${c}, still one cell"` : c)).join(','),
      '',
    ];
  }).join('\n');

  for (const system of SYSTEMS) {
    it(`${system}: every column lands in its own field, and all of it leaves again`, () => {
      const sections = upload(system, fileFor(system));
      for (const { catalogue, entry } of everything(sections)) {
        // A price with a thousands separator is still twelve hundred.
        expect(entry.price, entry.name).toBe(1200);
        // Every column in the file came through the parser and the database, by its own
        // name - checked against the file rather than against whatever survived.
        expect(Object.keys(entry.fields).sort(), `${system} ${catalogue}`)
          .toEqual(columnsFor(system, catalogue).columns.slice(2).sort());
      }

      const sheet = buyAll(system, sections);

      // Numbered rows: each column the row has is in the field of that name, verbatim.
      for (const [group, catalogue] of [['weapon', 'weapons'], ['vehicle', 'vehicles']] as const) {
        const slots = slotsOf(system)[group];
        if (!slots || columnsFor(system, catalogue).shape !== 'slots') continue;
        const entry = sections[catalogue]![0];
        expect(sheet[`${group}1_name`], `${system} ${group} name`).toBe(entry.name);
        for (const [col, value] of Object.entries(entry.fields)) {
          if (!slots.fields.includes(col)) continue;
          expect(sheet[`${group}1_${col}`], `${system} ${group}1_${col}`).toBe(value);
        }
      }

      const sale = sellAll(system, sections, sheet);
      expect(sale).toMatchObject({ ok: true, payout: expectedPayout(sections) });

      // Every field the purchases wrote is blank again: nothing half-sold.
      const after: Record<string, unknown> = { ...sheet, ...sale.patch };
      for (const [key, value] of Object.entries(after)) {
        const empty = value === '' || value === '[]' || (Array.isArray(value) && value.length === 0);
        expect(empty, `${system}: ${key} = ${JSON.stringify(value)}`).toBe(true);
      }
    });
  }

  it('carries a Cyberpunk RED rate of fire from the file to the sheet', () => {
    // The one the whole modular change was for, named rather than left to the loop.
    const sections = upload('cyberpunk_red', fileFor('cyberpunk_red'));
    // The last column, so it is also the quoted one: its comma survived as part of the value.
    expect(buyAll('cyberpunk_red', sections).weapon1_rof).toBe('rof value, still one cell');
  });

  it('carries Shadowrun damage and armor ratings the same way', () => {
    const sheet = buyAll('shadowrun_6e', upload('shadowrun_6e', fileFor('shadowrun_6e')));
    expect(sheet).toMatchObject({ weapon1_dv: 'dv value', weapon1_ar: 'ar value' });
  });
});
