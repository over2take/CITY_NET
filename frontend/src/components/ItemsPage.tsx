import React, { useState } from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import {
  itemSlots, itemList, itemFeatures, withNewSlot, withSlot, withoutSlot, withNewItem, withItem, withoutItem, needsChoices, needsWords, LIMITS,
  type Item,
} from '../sheets/items';
import { kindsOf } from '../sheets/choices';
import { HINTS } from '../sheets/builderHelp';
import { ColumnHead, FieldName } from './HelpHint';
import { ItemFeaturesEditor } from './FeaturesEditor';

// The builder's ITEMS page (7e2b; approved mockup docs/mockups/items.html, 2026-11-10): SLOTS, what an item may need
// besides being worn, each character having so many (ATTUNED, 3); and the ITEMS, each with its name, words, what its
// features need (carried, worn, or worn and in a slot) and the features themselves, the CHOICES form without a level, a
// list or an increase. A shop sells an item by its name, as it sells anything. Wearing and attuning at the table are
// 7e3's. What it reads and writes is sheets/items.ts; every change goes through the builder's `edit`.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  /** The server, for the formula boxes; none when looking at an example. */
  api?: ReturnType<typeof systemsApi>;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85, margin: 0 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };
const input: React.CSSProperties = {
  background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'monospace', fontSize: 12, padding: '4px 6px', minWidth: 0, boxSizing: 'border-box',
};
const row: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' };
const panel: React.CSSProperties = { border: '1px solid var(--dark-green)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 };
const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: '170px minmax(0, 1fr)', gap: '8px 12px', alignItems: 'center' };
const th: React.CSSProperties = { textAlign: 'left', fontSize: 10, letterSpacing: 2, opacity: 0.75, fontWeight: 'normal', padding: '4px 6px' };
const td: React.CSSProperties = { padding: '3px 6px' };
const tag: React.CSSProperties = { fontSize: 9, letterSpacing: 1, border: '1px solid currentColor', padding: '0 4px', color: 'var(--cyan)', whiteSpace: 'nowrap' };

/** Asks before deleting: DELETE, then DELETE / KEEP with what goes. */
function DeleteButton({ what, gone, onDelete }: { what: string; gone: string; onDelete: () => void }) {
  const [asking, setAsking] = useState(false);
  return asking
    ? <span role="group" aria-label={`Delete ${what}`} style={row}>
        <span style={{ ...why, color: 'var(--danger)' }}>Delete {what}? {gone}</span>
        <button type="button" className="utility-btn danger-btn" style={btn} onClick={onDelete}>DELETE</button>
        <button type="button" className="utility-btn" style={btn} onClick={() => setAsking(false)}>KEEP</button>
      </span>
    : <button type="button" className="utility-btn danger-btn" style={btn} onClick={() => setAsking(true)}>DELETE ITEM</button>;
}

/** One item: its name and what it needs on a line that opens it, and, open, its form and features. */
function ItemCard({ definition, edit, item, api, open, onOpen }: Props & { item: Item; open: boolean; onOpen: (open: boolean) => void }) {
  const name = item.label.trim() || 'NEEDS A NAME';
  const id = (part: string) => `item-${item.id}-${part}`;
  const features = itemFeatures(item);
  const kinds = [...new Set(features.flatMap(kindsOf))];
  return (
    <div role="region" aria-label={`${item.label || item.id} item`} style={{ display: 'flex', flexDirection: 'column', gap: 6, borderLeft: '2px solid var(--dark-green)', paddingLeft: 8 }}>
      <button type="button" aria-expanded={open} onClick={() => onOpen(!open)}
        style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', background: 'none', border: 0, padding: '3px 0', textAlign: 'left', cursor: 'pointer', fontFamily: 'monospace', fontSize: 12,
          color: item.label.trim() ? 'var(--green)' : 'var(--danger)' }}>
        <span>{open ? '▾' : '▸'} {name.toUpperCase()}</span>
        <span style={tag}>{needsWords(definition, item)}</span>
        {kinds.length > 0 && <span style={{ ...small, letterSpacing: 1 }}>{features.length} {features.length === 1 ? 'FEATURE' : 'FEATURES'}</span>}
      </button>
      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '10px 12px', border: '1px solid var(--green)' }}>
          <div style={grid}>
            <FieldName beside htmlFor={id('name')} hint={HINTS['items.name']} style={small}>NAME</FieldName>
            <input id={id('name')} type="text" maxLength={LIMITS.label} value={item.label} style={input}
              aria-invalid={!item.label.trim() ? true : undefined} onChange={(e) => edit(withItem(definition, item.id, { label: e.target.value }))} />
            <FieldName beside htmlFor={id('words')} hint={HINTS['items.words']} style={small}>WORDS</FieldName>
            <textarea id={id('words')} rows={2} maxLength={LIMITS.description} value={item.description ?? ''} style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }}
              onChange={(e) => edit(withItem(definition, item.id, { description: e.target.value }))} />
            <FieldName beside htmlFor={id('needs')} hint={HINTS['items.needs']} style={small}>ITS FEATURES NEED</FieldName>
            <select id={id('needs')} value={item.needs || 'worn'} style={{ ...input, justifySelf: 'start' }}
              onChange={(e) => edit(withItem(definition, item.id, { needs: e.target.value }))}>
              {!needsChoices(definition).some((n) => n.id === (item.needs || 'worn')) && <option value={item.needs}>{needsWords(definition, item)}</option>}
              {needsChoices(definition).map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
            </select>
          </div>
          <ItemFeaturesEditor definition={definition} edit={edit} item={item} api={api} />
          <div style={{ ...row, justifyContent: 'flex-end' }}>
            <DeleteButton what={item.label.trim() || item.id} gone="Its features go with it." onDelete={() => edit(withoutItem(definition, item.id))} />
          </div>
        </div>
      )}
    </div>
  );
}

export function ItemsPage({ definition, edit, api }: Props) {
  const slots = itemSlots(definition);
  const items = itemList(definition);
  const [open, setOpen] = useState<string | null>(null);
  const addItem = () => {
    const made = withNewItem(definition);
    if (!made) return;
    edit(made.definition);
    setOpen(made.id);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 980 }}>
      <p style={{ ...why, maxWidth: '72ch' }}>
        Things a character carries, wears or attunes to that do something: a bonus, uses a rest refills, a roll. A shop sells one by its name, as it sells anything.
      </p>
      <p style={{ ...why, maxWidth: '72ch' }}>
        SLOTS limit how many items can work at once, like D&amp;D&apos;s attunement: each character has so many (three), and an item that needs a slot only works while it&apos;s worn and holds one. Name the slot whatever your game calls it. With none, every item simply counts when it&apos;s carried or worn.
      </p>

      <section aria-label="Slots" style={panel}>
        <div style={row}>
          <FieldName hint={HINTS['items.slots']} style={small}>SLOTS · {slots.length} OF {LIMITS.slots}</FieldName>
          <span style={{ flex: 1 }} />
          <button type="button" className="utility-btn" style={btn} disabled={slots.length >= LIMITS.slots}
            onClick={() => { const made = withNewSlot(definition); if (made) edit(made.definition); }}>+ SLOT</button>
        </div>
        {slots.length
          ? (
            <table style={{ borderCollapse: 'collapse', fontSize: 12, alignSelf: 'start' }}>
              <thead><tr>
                <ColumnHead style={th}>NAME</ColumnHead>
                <ColumnHead style={th} hint={HINTS['items.count']}>EACH CHARACTER HAS</ColumnHead>
                <ColumnHead style={th} />
              </tr></thead>
              <tbody>
                {slots.map((s) => (
                  <tr key={s.id} data-testid={`slot-${s.id}`}>
                    <td style={td}><input type="text" aria-label={`${s.label || s.id} slot name`} maxLength={LIMITS.label} value={s.label} style={{ ...input, width: 180 }}
                      aria-invalid={!s.label.trim() ? true : undefined} onChange={(e) => edit(withSlot(definition, s.id, { label: e.target.value }))} /></td>
                    <td style={td}><input type="number" aria-label={`${s.label || s.id} each character has`} min={0} max={LIMITS.count} step={1} value={s.count} style={{ ...input, width: 70 }}
                      onChange={(e) => { if (e.target.value.trim()) edit(withSlot(definition, s.id, { count: Number(e.target.value) })); }} /></td>
                    <td style={td}><button type="button" className="utility-btn" style={{ ...btn, padding: '2px 7px' }} aria-label={`Remove the ${s.label || s.id} slot`}
                      onClick={() => edit(withoutSlot(definition, s.id))}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
          : <p style={{ ...why, fontSize: 11 }}>None: every item counts carried or worn, and the word never shows at the table. D&amp;D&apos;s ATTUNED, three each, is a slot.</p>}
      </section>

      <section aria-label="Items" style={panel}>
        <div style={row}>
          <FieldName hint={HINTS['items.items']} style={small}>ITEMS · {items.length} OF {LIMITS.items}</FieldName>
          <span style={{ flex: 1 }} />
          <button type="button" className="utility-btn" style={btn} disabled={items.length >= LIMITS.items} onClick={addItem}>+ ITEM</button>
        </div>
        {!items.length && <p style={{ ...why, fontSize: 11 }}>None yet. An item here is one that does something; a rope or a lantern needs nothing on this page.</p>}
        {items.map((i) => <ItemCard key={i.id} definition={definition} edit={edit} item={i} api={api} open={open === i.id} onOpen={(o) => setOpen(o ? i.id : null)} />)}
      </section>
    </div>
  );
}
