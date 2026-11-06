import React, { useState } from 'react';
import type { Definition } from '../sheets/systemsApi';
import type { systemsApi } from '../sheets/systemsApi';
import { kitItemsText, kitsOf, parseKitItems, withKit, withNewKit, withoutKit, type Kit, type KitWho } from '../sheets/newCharacter';
import { HINTS } from '../sheets/builderHelp';
import { useFormulaBox } from '../hooks/useFormulaBox';
import { FieldName } from './HelpHint';

// A system's kits, on the NEW CHARACTER page's KITS step (7c4a; approved mockup new-character): each with
// a name, its items, and who gets it. Written as the rest of the page is, through the builder's `edit`;
// the logic is sheets/newCharacter.ts and the checks backend creation.js. An item named as one in a
// catalogue will land as that does when it is given out (7c4b); any other is a line in the inventory.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  api?: Pick<ReturnType<typeof systemsApi>, 'previewFormulas'>;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const note: React.CSSProperties = { fontSize: 11, lineHeight: 1.45, opacity: 0.7, margin: 0 };
const box: React.CSSProperties = { fontFamily: 'monospace', fontSize: 12, padding: '4px 6px', background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--dark-green)', minWidth: 0 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };
const mini: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, padding: '1px 6px', background: 'none', color: 'var(--green)', border: '1px solid var(--dark-green)', cursor: 'pointer' };
const danger: React.CSSProperties = { ...mini, color: 'var(--danger)', borderColor: 'var(--danger)' };

const WHO: { id: KitWho; label: string; why: string }[] = [
  { id: 'all', label: 'EVERYONE GETS IT', why: 'Every new character starts with this.' },
  { id: 'pick', label: 'A PLAYER MAY PICK IT', why: 'Offered to pick from, one kit per character.' },
  { id: 'needs', label: 'ONLY IF', why: 'Offered to pick from, but off until the requirement is met.' },
  { id: 'gm', label: 'THE GM GIVES IT', why: 'Not offered to players. It is yours to hand out, as a kit for one character.' },
];

function KitRow({ kit, definition, edit, api }: Props & { kit: Kit }) {
  // The items as typed: read into items as they are typed, so "Rope, " can be typed through.
  const [text, setText] = useState(kitItemsText(kit.items));
  const [asking, setAsking] = useState(false);
  const set = (patch: Parameters<typeof withKit>[2]) => edit(withKit(definition, kit.id, patch));
  const requires = useFormulaBox({
    definition, api, kind: 'requires', value: kit.requires ?? '', onChange: (next) => set({ requires: next }),
    label: 'ONLY IF', id: `kit-${kit.id}-requires`, placeholder: "@wits >= 12 · has(mage)", inputStyle: box,
  });
  const name = kit.name.trim() || 'THIS KIT';
  return (
    <div role="group" aria-label={`Kit ${name}`} style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px', border: '1px solid color-mix(in srgb, var(--dark-green) 70%, transparent)' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="text" aria-label="Kit name" maxLength={60} value={kit.name} style={{ ...box, flex: '1 1 140px' }} aria-invalid={kit.name.trim() ? undefined : true} onChange={(e) => set({ name: e.target.value })} />
        <select aria-label={`${name} goes to`} value={kit.who} style={{ ...box, flex: '0 1 auto' }} onChange={(e) => set({ who: e.target.value as KitWho })}>
          {WHO.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
        </select>
        {asking ? (
          <span role="group" aria-label={`Delete ${name}`} style={{ display: 'inline-flex', gap: 4 }}>
            <button type="button" style={danger} onClick={() => edit(withoutKit(definition, kit.id))}>DELETE</button>
            <button type="button" style={mini} onClick={() => setAsking(false)}>KEEP</button>
          </span>
        ) : <button type="button" style={mini} aria-label={`Delete ${name}`} onClick={() => setAsking(true)}>×</button>}
      </div>
      <input type="text" aria-label={`${name} items`} value={text} placeholder="Rope, Lantern, 3x Rations" style={box}
        onChange={(e) => { setText(e.target.value); set({ items: parseKitItems(e.target.value) }); }} />
      {kit.who === 'needs' && <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>{requires.field}{requires.help}</div>}
      <p style={note}>{WHO.find((w) => w.id === kit.who)?.why}</p>
    </div>
  );
}

export function KitsPanel({ definition, edit, api }: Props) {
  const kits = kitsOf(definition);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <FieldName hint={HINTS['creation.kits']} style={small}>THE KITS</FieldName>
      {!kits.length && <p style={note}>No kits yet.</p>}
      {kits.map((kit) => <KitRow key={kit.id} kit={kit} definition={definition} edit={edit} api={api} />)}
      <div><button type="button" className="utility-btn" style={btn} onClick={() => edit(withNewKit(definition).definition)}>+ KIT</button></div>
    </div>
  );
}
