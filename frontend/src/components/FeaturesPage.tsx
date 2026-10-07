import React, { useState } from 'react';
import type { Definition } from '../sheets/systemsApi';
import {
  PART_ROWS, partIsOn, withPart, SHOP_TYPES, OTHER_TYPES, CATALOGUE_ROWS, BUILDING_NAME_LIMIT, buildingSetting, withBuilding,
  cataloguePartOff, currencyList, type BuildingKind,
} from '../sheets/wordsFeatures';

// The builder's FEATURES page (4b1c): which parts of the app the game uses, one switch each, the
// parts with settings opening out beneath (approved mockup docs/mockups/builder-words-features.html,
// 2026-10-06). SHOPS holds the app's building types and catalogues: renamed, turned off, and each
// catalogue's currency. Renaming buildings lives here, beside their switches, not on WORDS; a blank
// name is the app's (the user, same day). XP awards, death saves, luck and PDF import have no rules
// a custom system can use yet, so they show off and greyed (same day). What it reads and writes is
// sheets/wordsFeatures.ts; every change goes through the builder's `edit`, which autosaves it.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85 };
const field: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--black)', color: 'var(--green)', fontFamily: 'monospace', fontSize: 12, padding: '5px 7px',
};
const td: React.CSSProperties = { padding: '3px 8px 3px 0', verticalAlign: 'middle' };

/** An on/off switch, drawn as the mockup's, read as a switch by assistive tech. */
function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      style={{
        width: 44, height: 22, padding: 0, position: 'relative', cursor: disabled ? 'not-allowed' : 'pointer', flexShrink: 0,
        border: '1px solid var(--green)', background: on ? 'color-mix(in srgb, var(--green) 20%, transparent)' : 'var(--black)', opacity: disabled ? 0.45 : 1,
      }}>
      <span aria-hidden style={{ position: 'absolute', top: 2, left: on ? 24 : 2, width: 16, height: 16, background: on ? 'var(--green)' : 'var(--dark-green)', transition: 'left 0.15s' }} />
    </button>
  );
}

/** One table of building types or catalogues: the app's name, the system's, (a currency), on. */
function BuildingTable({ definition, edit, kind, rows, priced }: {
  definition: Definition; edit: (next: Definition) => void; kind: BuildingKind; rows: { id: string; label: string }[]; priced?: boolean;
}) {
  const currencies = currencyList(definition);
  const heads = ['THE APP\'S', 'CALLED', ...(priced ? ['PRICED IN'] : []), 'ON'];
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead><tr>{heads.map((h) => <th key={h} scope="col" style={{ ...td, ...small, textAlign: 'left', fontWeight: 'normal' }}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((row) => {
          const s = buildingSetting(definition, kind, row.id);
          const partOff = kind === 'catalogues' && cataloguePartOff(definition, row.id);
          return (
            <tr key={row.id} data-testid={`${kind}-${row.id}`} style={{ opacity: partOff ? 0.45 : 1 }}>
              <td style={{ ...td, width: 150 }}>
                {row.label}
                {partOff && <span style={{ display: 'block', fontSize: 10, opacity: 0.8 }}>its part is off</span>}
              </td>
              <td style={td}>
                <input type="text" maxLength={BUILDING_NAME_LIMIT} aria-label={`${row.label} called`} value={s.name ?? ''} placeholder={row.label}
                  disabled={partOff} onChange={(e) => edit(withBuilding(definition, kind, row.id, { name: e.target.value }))}
                  style={{ ...field, border: `1px solid ${s.name ? 'var(--cyan)' : 'var(--green)'}` }} />
              </td>
              {priced && (
                <td style={{ ...td, width: 150 }}>
                  <select aria-label={`${row.label} priced in`} disabled={partOff} value={s.currency ?? currencies[0]?.id}
                    onChange={(e) => edit(withBuilding(definition, kind, row.id, { currency: e.target.value }))} style={{ ...field, border: '1px solid var(--green)' }}>
                    {currencies.map((c, i) => <option key={c.id} value={c.id}>{c.name}{i === 0 ? ' (main)' : ''}</option>)}
                  </select>
                </td>
              )}
              <td style={{ ...td, width: 60 }}>
                <Switch on={s.on !== false} label={`${row.label} on`} disabled={partOff}
                  onChange={(on) => edit(withBuilding(definition, kind, row.id, { on }))} />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ShopsSettings({ definition, edit }: Props) {
  const priced = currencyList(definition).length > 0;
  const box: React.CSSProperties = { border: '1px solid var(--dark-green)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 };
  return <>
    <section aria-label="Shop buildings" style={box}>
      <h3 style={{ ...small, margin: 0, color: 'var(--green)', opacity: 1 }}>SHOP BUILDINGS</h3>
      <span style={why}>Rename the app's shop types, or turn one off. A building keeps its type and stock whatever it's called.</span>
      <BuildingTable definition={definition} edit={edit} kind="types" rows={SHOP_TYPES} />
    </section>
    <section aria-label="Catalogues" style={box}>
      <h3 style={{ ...small, margin: 0, color: 'var(--green)', opacity: 1 }}>CATALOGUES</h3>
      <span style={why}>
        {priced ? 'What the shops sell, each priced in the main currency unless you pick another.' : 'What the shops sell, priced in the app\'s money until the bank has currencies of its own.'}
      </span>
      <BuildingTable definition={definition} edit={edit} kind="catalogues" rows={CATALOGUE_ROWS} priced={priced} />
    </section>
    <section aria-label="Other buildings" style={box}>
      <h3 style={{ ...small, margin: 0, color: 'var(--green)', opacity: 1 }}>OTHER BUILDINGS</h3>
      <span style={why}>The app's buildings that don't sell anything.</span>
      <BuildingTable definition={definition} edit={edit} kind="types" rows={OTHER_TYPES} />
    </section>
  </>;
}

export function FeaturesPage({ definition, edit }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // A part's settings, where it has any. The bank's come with 4b1c2.
  const settings: Partial<Record<string, (p: Props) => React.ReactElement>> = { shops: ShopsSettings };

  return (
    <div style={{ maxWidth: 920, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ ...why, margin: 0, maxWidth: '72ch' }}>
        Everything is on unless you turn it off. Turning a part off only hides it: turn it back on and everything comes back.
      </p>
      <div style={{ border: '1px solid var(--dark-green)', display: 'flex', flexDirection: 'column' }}>
        {PART_ROWS.map((p) => {
          const on = !p.unused && partIsOn(definition, p.id);
          const Settings = settings[p.id];
          const isOpen = !!Settings && on && !!open[p.id];
          return (
            <div key={p.id} data-testid={`part-${p.id}`} style={{ borderBottom: '1px solid var(--dark-green)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', gap: '4px 14px', alignItems: 'center', padding: '10px 14px' }}>
                <Switch on={on} label={p.label} disabled={!!p.unused} onChange={(next) => edit(withPart(definition, p.id, next))} />
                <b style={{ letterSpacing: 1, color: 'var(--green)', opacity: on ? 1 : 0.5 }}>{p.label}</b>
                {Settings && on
                  ? <button type="button" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [p.id]: !isOpen })}
                      style={{ background: 'none', border: 0, color: 'var(--green)', fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, cursor: 'pointer' }}>
                      {isOpen ? '▾' : '▸'} SETTINGS
                    </button>
                  : <span />}
                <span style={{ ...why, gridColumn: 2, opacity: on ? 0.8 : 0.5 }}>
                  {p.unused ? `${p.what} Not used by custom systems yet.` : p.what}
                </span>
              </div>
              {isOpen && <div style={{ padding: '0 14px 14px 72px', display: 'flex', flexDirection: 'column', gap: 10 }}><Settings definition={definition} edit={edit} /></div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
