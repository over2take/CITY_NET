import React from 'react';
import type { SheetSection, SheetData, SheetFieldValue } from '../sheets/types';
import {
  INVENTORY_FIELD, CARRY_STATES, readInventory, writeInventory, blankItem, itemEnc,
  type InventoryItem,
} from '../sheets/inventory';

// Everything a character carries that is not a weapon.
//
// Structured rows rather than the textarea every system had, because a textarea cannot be
// counted: ammunition, stims, rations and rope all have quantities, and Encumbrance has to
// add them up.
//
// Weapons stay in their own section - they carry combat stats and feed the attack picker -
// but share this vocabulary, so Readied and Stowed mean one thing across the whole sheet.
//
// Its own file because SheetRenderer is long enough, and because this is the first sheet
// feature in a while that belongs to every system rather than to Cities Without Number.

const input: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--black) 50%, transparent)',
  border: '1px solid var(--green)',
  color: 'var(--green)',
  fontFamily: 'inherit',
  fontSize: '0.7rem',
  padding: '1px 4px',
  width: '100%',
  boxSizing: 'border-box',
};

const heading: React.CSSProperties = {
  fontSize: '0.55rem', opacity: 0.65, letterSpacing: '1px',
};

/**
 * An extra button on the rows that want one.
 *
 * Generic on purpose. This table is on all four systems and the only thing that needs a
 * per-row button so far is a Cities Without Number drug, so the rule about which rows get
 * one and what pressing it does is supplied from outside rather than known in here.
 */
export interface RowAction {
  label: string;
  /** Nothing is drawn for a row this returns null for. */
  applies: (item: InventoryItem) => boolean;
  enabled: (item: InventoryItem) => boolean;
  /** Tooltip, and the whole explanation when the button is disabled. */
  title: (item: InventoryItem) => string;
  onAct: (index: number) => void;
}

interface Props {
  section: SheetSection;
  data: SheetData;
  readOnly: boolean;
  onFieldChange: (fieldId: string, value: SheetFieldValue) => void;
  rowAction?: RowAction;
}

export function InventorySection({ section, data, readOnly, onFieldChange, rowAction }: Props) {
  const items = readInventory(data);
  // Encumbrance is Cities Without Number's. A system with no carrying rule gets the table
  // without the column, rather than a rule invented for it.
  const showEnc = section.inventoryEnc === true;

  const write = (next: InventoryItem[]) => onFieldChange(INVENTORY_FIELD, writeInventory(next));
  const patch = (i: number, change: Partial<InventoryItem>) =>
    write(items.map((it, n) => (n === i ? { ...it, ...change } : it)));

  // The action column is only laid out when something actually uses it, so a system with
  // no per-row button loses no width to an empty column.
  const showAction = !readOnly && !!rowAction && items.some((it) => rowAction.applies(it));
  const columns = [
    '1fr', '48px',
    ...(showEnc ? ['48px', '28px'] : []),
    '84px', '1fr',
    ...(showAction ? ['auto'] : []),
    ...(readOnly ? [] : ['20px']),
  ].join(' ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      {/* Scrollable: an inventory grows, and the tab strip below should not move every
          time somebody picks up a rope. */}
      <div className="crt-scroll" style={{ maxHeight: '220px', overflowY: 'auto', paddingRight: '4px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: columns, gap: '4px 6px', alignItems: 'center' }}>
          <div style={heading}>ITEM</div>
          <div style={heading}>QTY</div>
          {showEnc && <div style={heading} title="Encumbrance of one of them">ENC</div>}
          {showEnc && (
            <div style={heading} title="Three of these bundle into one item of Encumbrance (p48)">x3</div>
          )}
          <div style={heading}>WHERE</div>
          <div style={heading} title="Where a stashed item actually is">LOCATION</div>
          {showAction && <div />}
          {!readOnly && <div />}

          {items.map((item, i) => (
            <React.Fragment key={i}>
              <input
                aria-label={`Item ${i + 1} name`}
                value={item.name}
                readOnly={readOnly}
                onChange={(e) => patch(i, { name: e.target.value })}
                style={input}
              />
              <input
                aria-label={`Item ${i + 1} quantity`}
                type="number"
                min="1"
                value={item.qty}
                readOnly={readOnly}
                onChange={(e) => patch(i, { qty: Math.max(1, Number(e.target.value) || 1) })}
                style={{ ...input, textAlign: 'center' }}
              />
              {showEnc && (
                <input
                  aria-label={`Item ${i + 1} encumbrance`}
                  type="number"
                  min="0"
                  value={item.enc}
                  placeholder="0"
                  readOnly={readOnly}
                  onChange={(e) => patch(i, { enc: e.target.value })}
                  style={{ ...input, textAlign: 'center' }}
                />
              )}
              {showEnc && (
                <input
                  aria-label={`Item ${i + 1} bundles`}
                  type="checkbox"
                  checked={item.bundled}
                  disabled={readOnly}
                  onChange={(e) => patch(i, { bundled: e.target.checked })}
                  style={{ accentColor: 'var(--green)', margin: 0 }}
                />
              )}
              <select
                aria-label={`Item ${i + 1} carried`}
                value={item.carry}
                disabled={readOnly}
                onChange={(e) => patch(i, { carry: e.target.value as InventoryItem['carry'] })}
                style={input}
              >
                {CARRY_STATES.map((c) => (
                  <option key={c.value} value={c.value} title={c.title}>
                    {c.value === 'stash' ? 'STASH' : c.value.toUpperCase()}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Item ${i + 1} location`}
                value={item.location}
                readOnly={readOnly}
                placeholder={item.carry === 'stash' ? 'where is it?' : ''}
                onChange={(e) => patch(i, { location: e.target.value })}
                style={input}
              />
              {showAction && (
                rowAction!.applies(item) ? (
                  <button
                    type="button"
                    aria-label={`${rowAction!.label} ${item.name}`}
                    className="utility-btn"
                    disabled={!rowAction!.enabled(item)}
                    title={rowAction!.title(item)}
                    onClick={() => rowAction!.onAct(i)}
                    style={{ fontSize: '0.55rem', padding: '1px 6px', whiteSpace: 'nowrap' }}
                  >{rowAction!.label}</button>
                ) : <div />
              )}
              {!readOnly && (
                <button
                  type="button"
                  aria-label={`Remove item ${i + 1}`}
                  onClick={() => write(items.filter((_, n) => n !== i))}
                  style={{
                    background: 'none', border: 'none', color: 'var(--danger)',
                    cursor: 'pointer', padding: 0, fontSize: '0.8rem', lineHeight: 1,
                  }}
                >×</button>
              )}
            </React.Fragment>
          ))}
        </div>

        {items.length === 0 && (
          <div style={{ fontSize: '0.65rem', opacity: 0.5, padding: '4px 0' }}>
            Nothing carried. Ammunition, stims, rations, rope — anything with a number
            beside it belongs here.
          </div>
        )}
      </div>

      {!readOnly && (
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            type="button"
            className="utility-btn"
            style={{ fontSize: '0.6rem', padding: '2px 10px' }}
            onClick={() => write([...items, blankItem()])}
          >+ ITEM</button>
          {showEnc && items.length > 0 && (
            <span style={{ fontSize: '0.6rem', opacity: 0.6 }}>
              {items.reduce((n, it) => n + itemEnc(it), 0)} Enc of this is on you.
            </span>
          )}
        </div>
      )}
    </div>
  );
}
