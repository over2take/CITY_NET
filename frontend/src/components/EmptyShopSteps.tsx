import React from 'react';
import {
  shelvedCatalogues, typeLabel, catalogueLabel, type ShopStock,
} from '../data/buildingTypes';
import { uploadedIn } from '../sheets/uploadedCatalogues';
import { BOOK_SYSTEM } from '../sheets/ownedItems';
import { columnsFor } from '../sheets/catalogueSchema';

// What a GM is told when a shop has nothing to sell.
//
// Outside Cities Without Number a shop starts empty - there is no book behind it, only
// what the GM uploads - so setting a building to Gun Shop and walking a player in shows
// them bare shelves. The fix is a few steps away in another panel, and nobody should have
// to be told where. This is the telling, shown where the shop is set up and again where it
// is opened, with a button straight to the place the steps start.

/**
 * The shelves this shop has that nothing would appear on, in this game.
 *
 * Empty only when every one of them is: a gun shop with guns and no mods is a working
 * shop, just a small one. On CWN never, because the book stocks every shelf.
 */
export const emptyShelves = (
  buildingType: string | null | undefined, system: string,
): ShopStock[] => {
  const shelves = shelvedCatalogues(buildingType);
  if (!shelves.length || system === BOOK_SYSTEM) return [];
  return shelves.every((c) => uploadedIn(c).length === 0) ? shelves : [];
};

const mono: React.CSSProperties = {
  fontFamily: 'monospace', fontSize: 10, letterSpacing: 0, lineHeight: 1.6,
};

interface Props {
  buildingType: string;
  system: string;
  /** Opens SHOP_CATALOGUES. Absent where it cannot be opened from, and the step says where. */
  onOpenCatalogues?: () => void;
}

/** The steps, or nothing when this shop has something to sell. */
export function EmptyShopSteps({ buildingType, system, onOpenCatalogues }: Props) {
  const shelves = emptyShelves(buildingType, system);
  if (!shelves.length) return null;

  const shop = typeLabel(buildingType, system);
  const sections = shelves.map((c) => `[${c}]`).join(' and ');
  // What typing one in by hand looks like for this game: the section, the header this
  // system's file has, and one line. Columns after the price can be left off.
  const first = shelves[0];
  const sample = [
    `[${first}]`,
    columnsFor(system, first).columns.join(', '),
    'Street Special, 100',
  ].join('\n');

  return (
    <div
      role="note"
      aria-label="How to stock this shop"
      style={{
        ...mono, textAlign: 'left', marginTop: 8, padding: '8px 10px',
        border: '1px solid var(--warning)', color: 'var(--green)',
        // Solid, because the admin panel is see-through and the map behind it would
        // otherwise run through the middle of the instructions.
        background: 'var(--black)',
      }}
    >
      <div style={{ color: 'var(--warning)', marginBottom: 4 }}>
        THIS {shop.toUpperCase()} HAS NOTHING TO SELL YET
      </div>
      <div style={{ color: 'var(--grid-section)', marginBottom: 6 }}>
        Shops in this game sell only what you add. It sells {shelves.map((c) => catalogueLabel(c, system)).join(' and ')}.
      </div>
      <ol style={{ margin: 0, paddingLeft: 18 }}>
        <li>
          Open <strong>SHOP_CATALOGUES</strong>, in the admin panel&apos;s <strong>GAME</strong> tab.
          {onOpenCatalogues && (
            <>
              {' '}
              <button
                type="button"
                className="utility-btn"
                onClick={onOpenCatalogues}
                style={{ fontSize: 9, padding: '1px 8px' }}
              >OPEN IT</button>
            </>
          )}
        </li>
        <li>
          Press <strong>DOWNLOAD EXAMPLE</strong>. It has a section for every catalogue, with the
          columns this game&apos;s sheet uses, and a few rows to copy.
        </li>
        <li>
          Fill in the {sections} section{shelves.length > 1 ? 's' : ''} in a spreadsheet or text
          editor: one item per line, name and price first. Save it as CSV.
        </li>
        <li>
          Press <strong>UPLOAD FILE</strong> and pick it. To add a few by hand instead, type them
          straight into the box, like this:
          <pre
            style={{
              ...mono, margin: '4px 0', padding: '4px 6px',
              border: '1px solid var(--dark-green)', color: 'var(--cyan)', whiteSpace: 'pre-wrap',
            }}
          >{sample}</pre>
        </li>
        <li>
          Press <strong>PREVIEW</strong>, check the rows, then <strong>SAVE</strong>. Every{' '}
          {shop} in this game sells them straight away.
        </li>
      </ol>
    </div>
  );
}
