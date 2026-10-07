import React, { useRef, useState } from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import { BUILT_IN_ICONS, formatAmount, parseAmount } from '../sheets/currencies';
import { amountProblem, amountExample } from '../sheets/moneyText';
import {
  currencyList, countedIn, shapeCurrency, withNewCurrency, withoutCurrency, withMainCurrency, withCurrency, withCountedIn, withCoins,
  bankSettings, withBank, CURRENCY_LIMITS, type CountedIn, type StoredCurrency,
} from '../sheets/wordsFeatures';
import { CurrencyIcon } from './BankWindows';

// The bank's settings on the builder's FEATURES page (4b1c2): the system's currencies and its
// celebrations (approved mockup docs/mockups/builder-words-features.html, 2026-10-06). Each currency
// is counted in whole numbers, decimals or coins, with its debt and below-zero switches and its
// icon: the five CURRENCY_ICON has always offered, or one uploaded (the user, same day). The first
// is the main one, the balance every bank account already holds, so it is never removed outright:
// another is made main first. What it reads and writes is sheets/wordsFeatures.ts; every change
// goes through the builder's `edit`, which autosaves it.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  api?: ReturnType<typeof systemsApi>;
}

/** How a sample amount reads, for each currency's READS AS line. */
const SAMPLE = 123456;
const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };
const field: React.CSSProperties = {
  background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'monospace', fontSize: 12, padding: '5px 7px', minWidth: 0,
};
const seg = (on: boolean): React.CSSProperties => ({
  background: on ? 'var(--green)' : 'none', color: on ? 'var(--black)' : 'var(--green)', border: 0, fontFamily: 'monospace',
  fontSize: 11, letterSpacing: 1, padding: '4px 10px', cursor: 'pointer',
});

function Segments<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <span role="group" aria-label={label} style={{ display: 'inline-flex', border: '1px solid var(--green)' }}>
      {options.map(([v, text]) => <button key={v} type="button" aria-pressed={v === value} style={seg(v === value)} onClick={() => onChange(v)}>{text}</button>)}
    </span>
  );
}

function CurrencyEditor({ definition, edit, api, index, say }: Props & { index: number; say: (text: string | null) => void }) {
  const c = currencyList(definition)[index];
  const main = index === 0;
  const how = countedIn(c);
  const set = (patch: Partial<StoredCurrency>) => edit(withCurrency(definition, index, patch));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File | undefined) => {
    if (!file || !api) return;
    setUploading(true);
    const r = await api.uploadIcon(file);
    setUploading(false);
    if (!r.ok) { say(r.error); return; }
    say(null);
    set({ icon: r.value.icon });
  };

  return (
    <div data-testid={`currency-${c.id}`} style={{ border: `1px solid ${main ? 'var(--green)' : 'var(--dark-green)'}`, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="text" aria-label="Currency name" maxLength={CURRENCY_LIMITS.name} value={c.name} style={{ ...field, width: 150 }}
            onChange={(e) => set({ name: e.target.value })} />
          <span style={small}>{main ? 'MAIN · THE BANK BALANCE' : 'EXTRA'}</span>
        </span>
        <span style={{ display: 'flex', gap: 6 }}>
          {!main && <button type="button" className="utility-btn" style={btn} onClick={() => edit(withMainCurrency(definition, index))}>MAKE MAIN</button>}
          {!main && <button type="button" className="utility-btn" style={btn} onClick={() => setConfirmRemove(true)}>REMOVE</button>}
        </span>
      </div>
      {confirmRemove && (
        <div role="alertdialog" aria-label={`Remove ${c.name}`} style={{ border: '1px solid var(--danger)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ ...why, opacity: 1 }}>Remove {c.name}? Players' balances in it are kept but hidden, and its catalogues go back to the main currency.</span>
          <span style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="utility-btn" style={{ ...btn, borderColor: 'var(--danger)', color: 'var(--danger)' }}
              onClick={() => { setConfirmRemove(false); edit(withoutCurrency(definition, index)); }}>REMOVE</button>
            <button type="button" className="utility-btn" style={btn} onClick={() => setConfirmRemove(false)}>KEEP IT</button>
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={small}>COUNTED IN</span>
        <Segments<CountedIn> label={`${c.name} counted in`} value={how} options={[['whole', 'WHOLE NUMBERS'], ['decimals', 'DECIMALS'], ['coins', 'COINS']]}
          onChange={(v) => edit(withCountedIn(definition, index, v))} />
      </div>

      {how !== 'coins' && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={small}>SYMBOL</span>
            <input type="text" maxLength={CURRENCY_LIMITS.symbol} value={c.symbol ?? ''} placeholder="none" style={{ ...field, width: 56 }}
              onChange={(e) => set({ symbol: e.target.value })} /></label>
          {c.symbol && (
            <Segments<'before' | 'after'> label={`${c.name} symbol`} value={c.symbolAfter ? 'after' : 'before'} options={[['before', 'BEFORE'], ['after', 'AFTER']]}
              onChange={(v) => set({ symbolAfter: v === 'after' })} />
          )}
          {how === 'decimals' && <>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={small}>DECIMALS</span>
              <input type="number" min={1} max={CURRENCY_LIMITS.decimals} value={c.decimals ?? 2} style={{ ...field, width: 56 }}
                onChange={(e) => set({ decimals: Math.max(1, Math.min(CURRENCY_LIMITS.decimals, Math.round(Number(e.target.value)) || 1)) })} /></label>
            <Segments<'.' | ','> label={`${c.name} decimal mark`} value={c.decimalMark === ',' ? ',' : '.'} options={[['.', 'POINT'], [',', 'COMMA']]}
              onChange={(v) => set({ decimalMark: v })} />
          </>}
          {how === 'whole' && (
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={small}>SHORT</span>
              <input type="text" maxLength={CURRENCY_LIMITS.short} value={c.short ?? ''} placeholder="none" style={{ ...field, width: 70 }}
                onChange={(e) => set({ short: e.target.value })} /></label>
          )}
        </div>
      )}

      {how === 'coins' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {(c.denominations ?? []).map((d, j, all) => {
            const smallest = d.value === Math.min(...all.map((x) => x.value));
            return (
              <div key={d.id} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="text" aria-label={`Coin ${j + 1} name`} maxLength={CURRENCY_LIMITS.name} value={d.name} style={{ ...field, width: 130 }}
                  onChange={(e) => edit(withCoins(definition, index, { edit: j, patch: { name: e.target.value } }))} />
                <input type="text" aria-label={`Coin ${j + 1} short`} maxLength={CURRENCY_LIMITS.short} value={d.short ?? ''} placeholder="short" style={{ ...field, width: 60 }}
                  onChange={(e) => edit(withCoins(definition, index, { edit: j, patch: { short: e.target.value } }))} />
                {smallest
                  ? <span style={{ ...why, fontSize: 11 }}>worth 1 (the smallest)</span>
                  : <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><span style={small}>WORTH</span>
                      <input type="number" min={2} aria-label={`Coin ${j + 1} worth`} value={d.value} style={{ ...field, width: 80 }}
                        onChange={(e) => edit(withCoins(definition, index, { edit: j, patch: { value: Math.max(2, Math.round(Number(e.target.value)) || 2) } }))} />
                    </label>}
                <button type="button" className="utility-btn" style={btn} aria-label={`Remove coin ${d.name}`} disabled={all.length <= 1 || smallest}
                  onClick={() => edit(withCoins(definition, index, { remove: j }))}>×</button>
              </div>
            );
          })}
          <div><button type="button" className="utility-btn" style={btn} disabled={(c.denominations?.length ?? 0) >= CURRENCY_LIMITS.denominations}
            onClick={() => edit(withCoins(definition, index, { add: true }))}>+ COIN</button></div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={small}>ICON</span>
        <span role="group" aria-label={`${c.name} icon`} style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <button type="button" aria-pressed={!c.icon} style={{ ...btn, ...seg(!c.icon), border: '1px solid var(--green)' }} onClick={() => set({ icon: '' })}>NONE</button>
          {BUILT_IN_ICONS.map((icon) => (
            <button key={icon} type="button" aria-pressed={c.icon === icon} aria-label={`${icon} for ${c.name}`}
              style={{ ...btn, ...seg(c.icon === icon), border: '1px solid var(--green)', display: 'grid', placeItems: 'center', minWidth: 30 }}
              onClick={() => set({ icon })}><CurrencyIcon icon={icon} size={16} /></button>
          ))}
          {c.icon && !(BUILT_IN_ICONS as readonly string[]).includes(c.icon) && (
            <span aria-label="Uploaded icon" style={{ ...seg(true), display: 'grid', placeItems: 'center', padding: '2px 6px' }}><CurrencyIcon icon={c.icon} size={18} /></span>
          )}
          {api && <>
            <button type="button" className="utility-btn" style={btn} disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? 'UPLOADING…' : 'UPLOAD'}</button>
            <input ref={fileRef} type="file" accept=".png,.webp,.svg" aria-label={`Upload an icon for ${c.name}`} style={{ display: 'none' }}
              onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          </>}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={small}>READS AS</span>
        <span data-testid={`reads-as-${c.id}`} style={{ color: 'var(--cyan)', fontSize: 13 }}>{formatAmount(shapeCurrency(c), SAMPLE)}</span>
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', ...why }}>
          <input type="checkbox" checked={c.debt === true} onChange={(e) => set({ debt: e.target.checked })} /> Players can borrow it (debt)
        </label>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', ...why }}>
          <input type="checkbox" checked={c.negative === true} onChange={(e) => set({ negative: e.target.checked })} /> A balance can go below zero
        </label>
      </div>
    </div>
  );
}

/** The whale threshold, written as people write money and read back in the main currency. */
function Whale({ definition, edit }: Props) {
  const main = currencyList(definition)[0];
  const shaped = main ? shapeCurrency(main) : null;
  const { whale } = bankSettings(definition);
  const [text, setText] = useState(whale !== null && shaped ? formatAmount(shaped, whale) : '');
  const [problem, setProblem] = useState<string | null>(null);
  if (!shaped) return <span style={why}>Whale status needs a currency of the system's own: add one above.</span>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={small}>WHALE STATUS AT</span>
        <input type="text" value={text} placeholder={`never (e.g. ${amountExample(shaped)})`} style={{ ...field, width: 180 }}
          aria-invalid={problem ? true : undefined}
          onChange={(e) => {
            setText(e.target.value);
            if (!e.target.value.trim()) { setProblem(null); edit(withBank(definition, { whale: null })); return; }
            const parsed = parseAmount(shaped, e.target.value);
            const p = amountProblem(shaped, parsed, { positive: true });
            setProblem(p);
            if (!p && parsed.ok) edit(withBank(definition, { whale: parsed.amount }));
          }} />
        <span style={why}>{whale !== null ? `= ${formatAmount(shaped, whale)} in ${main.name}` : 'Empty: whale status never fires.'}</span>
      </label>
      {problem && <span role="alert" style={{ ...why, color: 'var(--danger)', opacity: 1 }}>{problem}</span>}
    </div>
  );
}

export function BankSettings({ definition, edit, api }: Props) {
  const currencies = currencyList(definition);
  const { celebrations } = bankSettings(definition);
  const [message, setMessage] = useState<string | null>(null);
  const box: React.CSSProperties = { border: '1px solid var(--dark-green)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 };
  return <>
    <section aria-label="Currencies" style={box}>
      <h3 style={{ ...small, margin: 0, color: 'var(--green)', opacity: 1 }}>CURRENCIES</h3>
      <span style={why}>
        {currencies.length
          ? 'The first is the main one: the balance every bank account already holds. They don\'t convert into each other.'
          : 'None yet: the bank keeps the app\'s own money. The first you add becomes the main one, and every balance already held is in it.'}
      </span>
      {currencies.map((c, i) => <CurrencyEditor key={c.id} definition={definition} edit={edit} api={api} index={i} say={setMessage} />)}
      {message && <span role="alert" style={{ ...why, color: 'var(--danger)', opacity: 1 }}>{message}</span>}
      <div>
        <button type="button" className="utility-btn" style={btn} disabled={currencies.length >= CURRENCY_LIMITS.currencies}
          onClick={() => edit(withNewCurrency(definition))}>+ CURRENCY</button>
        <span style={{ ...why, marginLeft: 8 }}>{currencies.length} of {CURRENCY_LIMITS.currencies}.</span>
      </div>
    </section>
    <section aria-label="Celebrations" style={box}>
      <h3 style={{ ...small, margin: 0, color: 'var(--green)', opacity: 1 }}>CELEBRATIONS</h3>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', ...why }}>
        <input type="checkbox" checked={celebrations} onChange={(e) => edit(withBank(definition, { celebrations: e.target.checked }))} />
        The bank's easter eggs: first payday, overdraft and debt cleared, on the main currency
      </label>
      {celebrations && <Whale definition={definition} edit={edit} />}
    </section>
  </>;
}
