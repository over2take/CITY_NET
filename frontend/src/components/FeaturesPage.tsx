import React, { useState } from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import { BankSettings } from './BankSettings';
import {
  PART_ROWS, partIsOn, withPart, partOnlyWith, withPartOnlyWith, SHOP_TYPES, OTHER_TYPES, CATALOGUE_ROWS, BUILDING_NAME_LIMIT, buildingSetting, withBuilding,
  cataloguePartOff, currencyList, type BuildingKind,
} from '../sheets/wordsFeatures';
import { OnlyWith } from './OnlyWith';
import { ToggleSwitch } from './ToggleSwitch';
import { dyingOn, withDyingOn } from '../sheets/dying';
import { luckOn, withLuckOn } from '../sheets/luck';

/** The RULE LIBRARY's cards, by their PARTS row (8c2, 8c5b): each row's switch is its card's. */
const LIBRARY: Record<string, { on: (def: Definition) => boolean; set: (def: Definition, on: boolean) => Definition }> = {
  death: { on: dyingOn, set: withDyingOn },
  luck: { on: luckOn, set: withLuckOn },
};
import type { BuilderPage } from '../sheets/builderSession';
import { ownShopsOf, withOwnShop, withoutOwnShop, withNewShop, typesSoldAt, SHOPS_MOST } from '../sheets/gameShops';
import { useShopBuildings } from '../hooks/useShopBuildings';

// The builder's PARTS page (4b1c; called FEATURES until 7a2a, renamed so a "feature" means only
// what a pick gives, approved mockup builder-choices 2026-10-27; its id stays 'features'): which parts of the app the game uses, one switch each, the
// parts with settings opening out beneath (approved mockup docs/mockups/builder-words-features.html,
// 2026-10-06). SHOPS holds the app's building types and catalogues: renamed, turned off, and each
// catalogue's currency. Renaming buildings lives here, beside their switches, not on WORDS; a blank
// name is the app's (the user, same day). XP awards, death saves, luck and PDF import have no rules
// a custom system can use yet, so they show off and greyed (same day). What it reads and writes is
// sheets/wordsFeatures.ts; every change goes through the builder's `edit`, which autosaves it.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  /** For uploading a currency's icon (BankSettings), and how many buildings each of the game's own shops is (8a7b3b). */
  api?: ReturnType<typeof systemsApi>;
  /** The system open, for those counts. */
  systemId?: string | null;
  /** To the page a part is set up on (RULE LIBRARY, 8c2). */
  onGoTo?: (page: BuilderPage) => void;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85 };
const field: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--black)', color: 'var(--green)', fontFamily: 'monospace', fontSize: 12, padding: '5px 7px',
};
const td: React.CSSProperties = { padding: '3px 8px 3px 0', verticalAlign: 'middle' };


/** What a shop buys back (8a7b1b), as FEATURES offers it. */
const BUYS_OPTIONS = [{ id: 'sells', label: 'WHAT IT SELLS' }, { id: 'anything', label: 'ANYTHING' }] as const;

/**
 * One table of building types or catalogues: the app's name, the system's, (a currency), (what it BUYS), on. The game's
 * own shops come after the app's, as `after` (8a7b3b), with a last column for their DELETE.
 */
function BuildingTable({ definition, edit, kind, rows, priced, buys, after }: {
  definition: Definition; edit: (next: Definition) => void; kind: BuildingKind; rows: { id: string; label: string }[]; priced?: boolean;
  buys?: boolean; after?: React.ReactNode;
}) {
  const currencies = currencyList(definition);
  const heads = ['THE APP\'S', 'CALLED', ...(priced ? ['PRICED IN'] : []), ...(buys ? ['BUYS'] : []), 'ON', ...(after ? [''] : [])];
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
              {buys && (
                <td style={{ ...td, width: 150 }}>
                  <select aria-label={`${row.label} buys`} value={s.buys === 'anything' ? 'anything' : 'sells'}
                    onChange={(e) => edit(withBuilding(definition, kind, row.id, { buys: e.target.value as 'sells' | 'anything' }))} style={{ ...field, border: '1px solid var(--green)' }}>
                    {BUYS_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </td>
              )}
              <td style={{ ...td, width: 60 }}>
                <ToggleSwitch on={s.on !== false} name={`${row.label} on`} disabled={partOff}
                  onChange={(on) => edit(withBuilding(definition, kind, row.id, { on }))} />
              </td>
              {after && <td style={td} />}
            </tr>
          );
        })}
        {after}
      </tbody>
    </table>
  );
}

/** How many buildings, said: "1 building", "3 buildings", "no building". */
const buildingsSaid = (n: number) => (n === 0 ? 'no building' : n === 1 ? '1 building' : `${n} buildings`);

/**
 * The game's own shops (8a7b3b; approved mockup docs/mockups/types-in-shops.html, section 4), at the foot of SHOP BUILDINGS:
 * each renamed, set to buy anything, switched off, or deleted, saying what it sells and how many buildings it is in this
 * game. DELETE asks once, naming them: each goes back to its ordinary type (8a7b3c1, kept per game).
 */
function OwnShopRows({ definition, edit, counts }: Props & { counts: Record<string, number> | null }) {
  const [asking, setAsking] = useState<string | null>(null);
  return <>
    {ownShopsOf(definition).map((shop) => {
      const name = shop.name.trim() || shop.id;
      const sells = typesSoldAt(definition, shop.id);
      const count = counts ? counts[shop.id] ?? 0 : null;
      const says = [sells.length ? `sells ${sells.join(', ')}` : 'sells nothing', ...(shop.buys === 'anything' ? ['buys anything'] : []), ...(count === null ? [] : [buildingsSaid(count)])].join(' · ');
      return (
        <React.Fragment key={shop.id}>
          <tr data-testid={`own-shop-${shop.id}`}>
            <td style={{ ...td, width: 150 }}>
              <span style={{ color: 'var(--cyan)' }}>THIS GAME'S</span>
              <span style={{ display: 'block', fontSize: 10, opacity: 0.8 }}>{says}</span>
            </td>
            <td style={td}>
              <input type="text" maxLength={BUILDING_NAME_LIMIT} aria-label={`${name} called`} value={shop.name} aria-invalid={!shop.name.trim() ? true : undefined}
                onChange={(e) => edit(withOwnShop(definition, shop.id, { name: e.target.value }))} style={{ ...field, border: '1px solid var(--cyan)' }} />
            </td>
            <td style={{ ...td, width: 150 }}>
              <select aria-label={`${name} buys`} value={shop.buys === 'anything' ? 'anything' : 'sells'}
                onChange={(e) => edit(withOwnShop(definition, shop.id, { buys: e.target.value as 'sells' | 'anything' }))} style={{ ...field, border: '1px solid var(--green)' }}>
                {BUYS_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </td>
            <td style={{ ...td, width: 60 }}>
              <ToggleSwitch on={shop.on !== false} name={`${name} on`} onChange={(on) => edit(withOwnShop(definition, shop.id, { on }))} />
            </td>
            <td style={td}>
              <button type="button" className="utility-btn danger-btn" aria-label={`Delete ${name}`} style={{ fontFamily: 'monospace', fontSize: 11, padding: '3px 8px' }}
                onClick={() => setAsking(shop.id)}>DELETE</button>
            </td>
          </tr>
          {asking === shop.id && (
            <tr>
              <td colSpan={5} style={{ ...td, paddingBottom: 8 }}>
                <span role="group" aria-label={`Delete ${name}?`} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ ...why, color: 'var(--danger)' }}>
                    Delete {name}? {count ? `${count === 1 ? '1 building is one' : `${count} buildings are one`} in this game: ${count === 1 ? 'it goes' : 'they go'} back to ${count === 1 ? 'its' : 'their'} ordinary type once you publish.` : 'No building is one in this game.'}
                  </span>
                  <button type="button" className="utility-btn danger-btn" style={{ fontFamily: 'monospace', fontSize: 11, padding: '3px 8px' }}
                    onClick={() => { edit(withoutOwnShop(definition, shop.id)); setAsking(null); }}>DELETE</button>
                  <button type="button" className="utility-btn" style={{ fontFamily: 'monospace', fontSize: 11, padding: '3px 8px' }} onClick={() => setAsking(null)}>KEEP</button>
                </span>
              </td>
            </tr>
          )}
        </React.Fragment>
      );
    })}
  </>;
}

/** + NEW SHOP on FEATURES (8a7b3b; answered 2: here and on SOLD AT, making the same thing): a name, ADDed or by Enter. */
function NewShop({ definition, edit }: Props) {
  const [name, setName] = useState('');
  const full = ownShopsOf(definition).length >= SHOPS_MOST;
  const add = () => { const made = withNewShop(definition, name); if (!made) return; edit(made.definition); setName(''); };
  return (
    <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <input type="text" aria-label="New shop name" maxLength={BUILDING_NAME_LIMIT} value={name} placeholder="+ NEW SHOP: a name, like Apothecary" disabled={full && !name}
        onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        style={{ ...field, width: 280, border: '1px solid var(--green)' }} />
      <button type="button" className="utility-btn" style={{ fontFamily: 'monospace', fontSize: 11, padding: '4px 9px' }} disabled={!name.trim()} onClick={add}>ADD</button>
      <span style={{ ...why, fontSize: 11 }}>{full ? `${SHOPS_MOST} OF ${SHOPS_MOST}: delete one to make another.` :'A shop of this game\'s own: tick it under SOLD AT on an item type, and give it to a building in BUILDING TYPE.'}</span>
    </span>
  );
}

function ShopsSettings({ definition, edit, api, systemId }: Props) {
  const priced = currencyList(definition).length > 0;
  const counts = useShopBuildings(api, systemId);
  const own = ownShopsOf(definition).length > 0;
  const box: React.CSSProperties = { border: '1px solid var(--dark-green)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 };
  return <>
    <section aria-label="Shop buildings" style={box}>
      <h3 style={{ ...small, margin: 0, color: 'var(--green)', opacity: 1 }}>SHOP BUILDINGS</h3>
      <span style={why}>Rename the app's shop types, or turn one off, and say what each BUYS back. A building keeps its type and stock whatever it's called. This game's own shops are listed under them.</span>
      <BuildingTable definition={definition} edit={edit} kind="types" rows={SHOP_TYPES} buys
        after={own ? <OwnShopRows definition={definition} edit={edit} counts={counts} /> : undefined} />
      <NewShop definition={definition} edit={edit} />
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

export function FeaturesPage({ definition, edit, api, systemId, onGoTo }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // A part's settings, where it has any.
  const settings: Partial<Record<string, (p: Props) => React.ReactElement>> = { bank: BankSettings, shops: ShopsSettings };

  return (
    <div style={{ maxWidth: 920, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ ...why, margin: 0, maxWidth: '72ch' }}>
        Everything is on unless you turn it off. Turning a part off only hides it: turn it back on and everything comes back.
      </p>
      <div style={{ border: '1px solid var(--dark-green)', display: 'flex', flexDirection: 'column' }}>
        {PART_ROWS.map((p) => {
          // A RULE LIBRARY rule (8c2): its card's switch, on with the part and the rule written.
          const card = p.library ? LIBRARY[p.id] : undefined;
          const on = card ? card.on(definition) : !p.unused && partIsOn(definition, p.id);
          const Settings = settings[p.id];
          const isOpen = !!Settings && on && !!open[p.id];
          return (
            <div key={p.id} data-testid={`part-${p.id}`} style={{ borderBottom: '1px solid var(--dark-green)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', gap: '4px 14px', alignItems: 'center', padding: '10px 14px' }}>
                <ToggleSwitch on={on} name={p.label} disabled={!!p.unused} onChange={(next) => edit(card ? card.set(definition, next) : withPart(definition, p.id, next))} />
                <b style={{ letterSpacing: 1, color: 'var(--green)', opacity: on ? 1 : 0.5 }}>{p.label}</b>
                {Settings && on
                  ? <button type="button" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [p.id]: !isOpen })}
                      style={{ background: 'none', border: 0, color: 'var(--green)', fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, cursor: 'pointer' }}>
                      {isOpen ? '▾' : '▸'} SETTINGS
                    </button>
                  : <span />}
                <span style={{ ...why, gridColumn: 2, opacity: on ? 0.8 : 0.5 }}>
                  {p.unused ? `${p.what} Not used by custom systems yet.` : p.library ? `${p.what} Set up on RULE LIBRARY.` : p.what}
                </span>
                {p.library && onGoTo && (
                  <span style={{ gridColumn: 2 }}>
                    <button type="button" className="utility-btn" onClick={() => onGoTo('rule_library')}
                      style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '3px 8px' }}>RULE LIBRARY ▸</button>
                  </span>
                )}
                {on && !p.library && (
                  <span style={{ gridColumn: 2, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <OnlyWith definition={definition} value={partOnlyWith(definition, p.id)} style={small} selectStyle={{ ...field, width: 'auto', border: '1px solid var(--green)' }}
                      onChange={(rule) => edit(withPartOnlyWith(definition, p.id, rule))} />
                  </span>
                )}
              </div>
              {isOpen && <div style={{ padding: '0 14px 14px 72px', display: 'flex', flexDirection: 'column', gap: 10 }}><Settings definition={definition} edit={edit} api={api} systemId={systemId} /></div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
