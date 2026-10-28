import React, { useRef, useState } from 'react';
import type { Definition, systemsApi, TestedDice } from '../sheets/systemsApi';
import type { CustomDie } from '../types';
import {
  DICE_PRESETS, LIMITS, symbolList, dieList, withDicePreset, withNewDie, withDieName, withDieColor, withFaceCount, withFace, withoutDie,
  withNewSymbol, withSymbol, alsoChoices, withoutSymbol, withSymbolLook, withTableDie, faceWords, BLANK_DRAWN,
  type OwnDie, type DieSymbol,
} from '../sheets/dice';
import { small, why, btn, field } from './statsRulesStyles';
import { DrawPad, SymbolLook, FaceShown } from './DrawPad';
import { ConditionIconPicker } from './ConditionIconPicker';
import { FieldName, HelpHint } from './HelpHint';
import { HINTS } from '../sheets/builderHelp';

// STATS & RULES' DICE tab (6c2b2; approved mockup docs/mockups/builder-dice.html, 2026-10-21): the
// system's own dice, beside ROLLS. A list on the left (presets, + DIE, COPY FROM THE TABLE'S
// DICE); the die picked in the middle (its name, color, faces, and the face picked: a number and
// symbols); the system's symbols under it, each with its look (a mark, a drawn icon, a drawing on
// the pad, or an upload); TEST on the right, a handful thrown on the server. All of it through
// the builder's `edit`, held to the server by sheets/dice.ts.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
  api?: ReturnType<typeof systemsApi>;
}

const mono: React.CSSProperties = { fontFamily: 'monospace' };
const section: React.CSSProperties = { border: '1px solid var(--dark-green)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 };
/** A symbol's row: its look, name, mark, what it cancels, what it also counts as, and ×. */
const SYMBOL_COLUMNS = '60px minmax(0, 1.2fr) 58px minmax(0, 1fr) minmax(0, 1fr) auto';
const heading: React.CSSProperties = { ...small, color: 'var(--green)', opacity: 1, display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' };

/** A whole number typed in a box, kept on leaving it (blank allowed where `blank` says what it means). */
function NumberBox({ label, value, onNumber, width = 60, blank }: { label: string; value: number | undefined; onNumber: (n: number | null) => void; width?: number; blank?: string }) {
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed ?? (value === undefined ? '' : String(value));
  const keep = () => {
    if (typed === null) return;
    const t = typed.trim();
    if (t === '' && blank) onNumber(null);
    else if (/^[+-]?\d+$/.test(t)) onNumber(Number(t));
    setTyped(null);
  };
  return <input type="text" inputMode="numeric" aria-label={label} value={shown} placeholder={blank} style={{ ...field, width }} onChange={(e) => setTyped(e.target.value)} onBlur={keep} onKeyDown={(e) => { if (e.key === 'Enter') keep(); }} />;
}

/** A symbol's row: how it looks, its name and mark, what it cancels and counts as, and its look picked. */
function SymbolRow({ definition, edit, symbol, api, drawing, onDraw }: Props & { symbol: DieSymbol; drawing: boolean; onDraw: (on: boolean) => void }) {
  const symbols = symbolList(definition);
  const [picking, setPicking] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const look = symbol.drawn ? 'DRAW' : symbol.icon ? (symbol.icon.startsWith('/uploads/') ? 'UPLOAD' : 'ICON') : 'MARK';
  const upload = async (file: File | undefined) => {
    if (!file || !api) return;
    const r = await api.uploadIcon(file, 'condition');
    if (!r.ok) { setUploadError(r.error); return; }
    setUploadError(null);
    edit(withSymbolLook(definition, symbol.id, { icon: r.value.icon }));
  };
  const pick = (to: 'MARK' | 'ICON' | 'DRAW' | 'UPLOAD') => {
    setPicking(to === 'ICON');
    onDraw(to === 'DRAW');
    if (to === 'MARK') edit(withSymbolLook(definition, symbol.id, { mark: true }));
    else if (to === 'DRAW' && !symbol.drawn) edit(withSymbolLook(definition, symbol.id, { drawn: BLANK_DRAWN }));
    else if (to === 'UPLOAD') fileRef.current?.click();
  };
  const name = symbol.name || symbol.id;
  return (
    <div role="group" aria-label={`Symbol ${name}`} style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 6, borderTop: '1px solid color-mix(in srgb, var(--dark-green) 60%, transparent)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: SYMBOL_COLUMNS, gap: 6, alignItems: 'center', fontSize: 12 }}>
        <span aria-label={`${name} on the dice`} style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', border: '1px solid var(--green)', color: 'var(--green)', fontSize: 15 }}><SymbolLook symbol={symbol} size={18} /></span>
        <input aria-label={`${name}: name`} value={symbol.name} maxLength={LIMITS.name} style={field} onChange={(e) => edit(withSymbol(definition, symbol.id, { name: e.target.value }))} />
        <input aria-label={`${name}: mark`} value={symbol.mark ?? ''} maxLength={4} style={{ ...field, textAlign: 'center' }} onChange={(e) => edit(withSymbol(definition, symbol.id, { mark: e.target.value }))} />
        <select aria-label={`${name}: cancels`} value={symbol.cancels ?? ''} style={field} onChange={(e) => edit(withSymbol(definition, symbol.id, { cancels: e.target.value || null }))}>
          <option value="">NOTHING</option>
          {symbols.filter((s) => s.id !== symbol.id).map((s) => <option key={s.id} value={s.id}>{s.name.toUpperCase()}</option>)}
        </select>
        <select aria-label={`${name}: also counts as`} value={symbol.also ?? ''} style={field} onChange={(e) => edit(withSymbol(definition, symbol.id, { also: e.target.value || null }))}>
          <option value="">NOTHING</option>
          {[...new Set([...alsoChoices(definition, symbol.id), ...symbols.filter((s) => s.id === symbol.also)])].map((s) => <option key={s.id} value={s.id}>{s.name.toUpperCase()}</option>)}
        </select>
        <button type="button" aria-label={`Remove ${name}`} className="utility-btn danger-btn" style={btn} onClick={() => edit(withoutSymbol(definition, symbol.id))}>×</button>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', paddingLeft: 36 }}>
        <div role="group" aria-label={`${name}: look`} style={{ display: 'inline-flex', border: '1px solid var(--dark-green)' }}>
          {(['MARK', 'ICON', 'DRAW', 'UPLOAD'] as const).filter((l) => l !== 'UPLOAD' || api).map((l) => (
            <button key={l} type="button" aria-pressed={look === l} onClick={() => pick(l)}
              style={{ ...mono, fontSize: 10, letterSpacing: 1, padding: '3px 7px', border: 0, borderRight: '1px solid var(--dark-green)', background: look === l ? 'var(--green)' : 'none', color: look === l ? 'var(--black)' : 'var(--text)', cursor: 'pointer' }}>{l}</button>
          ))}
        </div>
        <span style={{ ...why, fontSize: 11 }}>THE LOG WRITES {symbol.mark || [...name][0]?.toUpperCase()}</span>
        <input ref={fileRef} type="file" accept=".png,.webp,.svg" aria-label={`Upload a picture for ${name}`} style={{ display: 'none' }}
          onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
      </div>
      {uploadError && <span role="alert" style={{ color: 'var(--danger)', fontSize: 11, paddingLeft: 36 }}>{uploadError}</span>}
      {picking && (
        <div style={{ paddingLeft: 36 }}>
          <ConditionIconPicker value={symbol.icon ?? ''} name={name} onPick={(icon) => { edit(withSymbolLook(definition, symbol.id, { icon })); setPicking(false); }} />
        </div>
      )}
      {drawing && symbol.drawn && (
        <div style={{ ...section, marginLeft: 36 }}>
          <div style={heading}><span>DRAW {name.toUpperCase()}</span><span style={{ color: 'var(--cyan)' }}>16 × 16 · KEPT IN THE SYSTEM, IN ITS FILE</span></div>
          <DrawPad drawn={symbol.drawn} name={name} onChange={(drawn) => edit(withSymbolLook(definition, symbol.id, { drawn }))} />
          <div><button type="button" className="utility-btn" style={btn} onClick={() => onDraw(false)}>DONE</button></div>
        </div>
      )}
    </div>
  );
}

/** The die picked: its name, color, faces, the face picked, and the system's symbols. */
function DieEditor({ definition, edit, api, die, onRemoved }: Props & { die: OwnDie; onRemoved: () => void }) {
  const symbols = symbolList(definition);
  const [facePick, setFacePick] = useState(0);
  const [drawing, setDrawing] = useState<string | null>(null);
  const at = Math.min(facePick, die.faces.length - 1);
  const face = die.faces[at];
  const color = die.color === 'danger' ? 'var(--danger)' : 'var(--green)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <section aria-label="The die" style={section}>
        <div style={heading}><span>THE DIE</span><span style={{ color: 'var(--cyan)' }}>ITS NAME IN THE MENU AND THE LOG</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: '80px minmax(0, 1fr)', gap: '6px 10px', alignItems: 'center', fontSize: 12 }}>
          <FieldName hint={HINTS['dice.name']} style={small}>NAME</FieldName><input aria-label="Die name" value={die.name} maxLength={LIMITS.name} style={field} onChange={(e) => edit(withDieName(definition, die.id, e.target.value))} />
          <FieldName hint={HINTS['dice.faces']} style={small}>FACES</FieldName><NumberBox label="How many faces" value={die.faces.length} onNumber={(n) => { if (n !== null) edit(withFaceCount(definition, die.id, n)); }} />
          <FieldName hint={HINTS['dice.color']} style={small}>COLOR</FieldName>
          <div role="group" aria-label="Die color" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {([[false, 'THE THEME\'S'], [true, 'DANGER (A BAD DIE)']] as const).map(([danger, label]) => (
              <button key={label} type="button" aria-pressed={(die.color === 'danger') === danger} className="utility-btn" onClick={() => edit(withDieColor(definition, die.id, danger))}
                style={{ ...btn, ...((die.color === 'danger') === danger ? { background: danger ? 'var(--danger)' : 'var(--green)', color: 'var(--black)' } : {}) }}>{label}</button>
            ))}
          </div>
        </div>
      </section>
      <section aria-label="Faces" style={section}>
        <div style={heading}><span>FACES</span><span style={{ color: 'var(--cyan)' }}>CLICK ONE TO CHANGE IT</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))', gap: 6 }}>
          {die.faces.map((f, i) => (
            <button key={i} type="button" aria-pressed={i === at} aria-label={`Face ${i + 1}: ${faceWords(f, symbols)}`} onClick={() => setFacePick(i)}
              style={{ ...mono, textAlign: 'left', background: 'none', color: 'var(--text)', padding: 6, display: 'flex', flexDirection: 'column', gap: 3, cursor: 'pointer',
                border: `1px solid ${i === at ? 'var(--cyan)' : 'var(--dark-green)'}`, boxShadow: i === at ? '0 0 0 1px var(--cyan)' : 'none' }}>
              <span style={{ fontSize: 9, letterSpacing: 1, opacity: 0.6 }}>FACE {i + 1}</span>
              <span style={{ fontSize: 15, fontWeight: 'bold', color }}><FaceShown die={die} face={f} symbols={symbols} /></span>
              <span style={{ fontSize: 10, letterSpacing: 1, opacity: 0.8 }}>{faceWords(f, symbols)}</span>
            </button>
          ))}
        </div>
      </section>
      <section aria-label={`Face ${at + 1} shows`} style={section}>
        <div style={heading}><span>FACE {at + 1} SHOWS</span></div>
        <div style={{ display: 'grid', gridTemplateColumns: '80px minmax(0, 1fr)', gap: '6px 10px', alignItems: 'center', fontSize: 12 }}>
          <FieldName hint={HINTS['dice.number']} style={small}>NUMBER</FieldName>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <NumberBox key={`${die.id}:${at}`} label={`Face ${at + 1} number`} value={face.n} blank="none" onNumber={(n) => edit(withFace(definition, die.id, at, { n }))} />
            <span style={{ ...why, fontSize: 11 }}>+1 and -1 keep their sign; blank for none</span>
          </span>
          <FieldName hint={HINTS['dice.symbols']} style={small}>SYMBOLS</FieldName>
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {(face.s ?? []).map((id, i) => {
              const s = symbols.find((x) => x.id === id);
              return (
                <button key={`${id}${i}`} type="button" className="utility-btn" aria-label={`Take ${s?.name ?? id} off face ${at + 1}`} style={{ ...btn, display: 'inline-flex', gap: 5, alignItems: 'center' }}
                  onClick={() => edit(withFace(definition, die.id, at, { s: (face.s ?? []).filter((_, k) => k !== i) }))}>
                  {s ? <SymbolLook symbol={s} /> : '?'} {(s?.name ?? id).toUpperCase()} ×
                </button>
              );
            })}
            {symbols.length > 0 && (face.s ?? []).length < LIMITS.perFace && (
              <select aria-label={`Add a symbol to face ${at + 1}`} value="" style={field} onChange={(e) => { if (e.target.value) edit(withFace(definition, die.id, at, { s: [...(face.s ?? []), e.target.value] })); }}>
                <option value="">+ SYMBOL</option>
                {symbols.map((s) => <option key={s.id} value={s.id}>{s.name.toUpperCase()}</option>)}
              </select>
            )}
            {!symbols.length && <span style={{ ...why, fontSize: 11 }}>No symbols yet: add one below.</span>}
          </span>
        </div>
      </section>
      <section aria-label="Symbols" style={section}>
        <div style={heading}><span>THE SYSTEM&apos;S SYMBOLS</span><span style={{ color: 'var(--cyan)' }}>SHARED BY ALL ITS DICE · UP TO {LIMITS.symbols}</span></div>
        {symbols.length > 0 && (
          // The words are only a heading over each row's own named fields; the "?"s are read.
          <div style={{ display: 'grid', gridTemplateColumns: SYMBOL_COLUMNS, gap: 6, ...small }}>
            <FieldName hint={HINTS['dice.look']}><span aria-hidden>LOOK</span></FieldName>
            <span aria-hidden>NAME</span>
            <FieldName hint={HINTS['dice.mark']}><span aria-hidden>MARK</span></FieldName>
            <FieldName hint={HINTS['dice.cancels']}><span aria-hidden>CANCELS</span></FieldName>
            <FieldName hint={HINTS['dice.countsAs']}><span aria-hidden>COUNTS AS</span></FieldName>
            <span />
          </div>
        )}
        {symbols.map((s) => (
          <SymbolRow key={s.id} definition={definition} edit={edit} api={api} symbol={s} drawing={drawing === s.id} onDraw={(on) => setDrawing(on ? s.id : null)} />
        ))}
        <div><button type="button" className="utility-btn" style={btn} disabled={symbols.length >= LIMITS.symbols} onClick={() => { const r = withNewSymbol(definition); if (r) edit(r.definition); }}>+ SYMBOL</button></div>
      </section>
      <div><button type="button" className="utility-btn danger-btn" style={btn} onClick={() => { edit(withoutDie(definition, die.id)); onRemoved(); }}>REMOVE DIE</button></div>
    </div>
  );
}

/** TEST: a handful of the die thrown on the server, its faces and what its symbols come to. */
function TestDice({ definition, api, die }: { definition: Definition; api?: ReturnType<typeof systemsApi>; die: OwnDie }) {
  const [count, setCount] = useState(4);
  const [shown, setShown] = useState<{ tested?: TestedDice; error?: string; busy?: boolean }>({});
  const symbols = symbolList(definition);
  const name = (id: string) => (symbols.find((s) => s.id === id)?.name ?? id).toUpperCase();
  const run = async () => {
    if (!api) return;
    setShown({ busy: true });
    const r = await api.testDice(definition, die.id, count);
    setShown(r.ok ? { tested: r.value } : { error: r.error });
  };
  const t = shown.tested;
  const left = t ? Object.entries(t.symbols.left).filter(([, n]) => n > 0) : [];
  const color = die.color === 'danger' ? 'var(--danger)' : 'var(--green)';
  return (
    <aside aria-label="Test the die" data-testid="test-dice" style={{ border: '1px solid var(--dark-green)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0, fontSize: 12 }}>
      <FieldName hint={HINTS['dice.test']} style={{ ...small, color: 'var(--cyan)' }}>TEST · THROW SOME</FieldName>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <NumberBox label="How many to throw" value={count} width={50} onNumber={(n) => { if (n !== null) setCount(Math.max(1, Math.min(20, n))); }} />
        <span>× {die.name.toUpperCase()}</span>
        <button type="button" className="utility-btn" style={btn} disabled={!api || shown.busy} onClick={run}>THROW ▸</button>
      </div>
      {t && (
        <>
          <div data-testid="test-dice-faces" style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {t.faces.map((f, i) => <span key={i} style={{ minWidth: 30, height: 30, padding: '0 4px', boxSizing: 'border-box', display: 'grid', placeItems: 'center', fontWeight: 'bold', border: `2px solid ${color}`, color }}>{f}</span>)}
          </div>
          <span data-testid="test-dice-left">{left.length ? left.map(([id, n]) => `${n} ${name(id)}`).join(', ') : 'NOTHING LEFT'}{t.faces.some((f) => /\d/.test(f)) ? ` · TOTAL ${t.total}` : ''}</span>
        </>
      )}
      {shown.error && <span role="alert" style={{ color: 'var(--danger)', fontSize: 11 }}>{shown.error}</span>}
      <span style={{ ...why, fontSize: 11 }}>Never reaches the game or the log. Symbols counted and cancelled as a roll that COUNTS THE SYMBOLS reads them; drawn pictures show as their marks here.</span>
    </aside>
  );
}

export function DiceTab({ definition, edit, api }: Props) {
  const dice = dieList(definition);
  const [picked, setPicked] = useState<string | null>(null);
  const [copying, setCopying] = useState<{ dice?: CustomDie[]; error?: string } | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const die = dice.find((d) => d.id === picked) ?? dice[0];
  const symbols = symbolList(definition);
  const added = (r: { definition: Definition | null; id?: string; message?: string } | null, full: string) => {
    if (!r || !r.definition) { setSaid(r && 'message' in r && r.message ? r.message : full); return; }
    edit(r.definition);
    if (r.id) setPicked(r.id);
    setSaid(null);
    setCopying(null);
  };
  const openCopy = async () => {
    if (!api) return;
    setCopying({});
    const r = await api.tableDice();
    setCopying(r.ok ? { dice: r.value } : { error: r.error });
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}>
      <p style={{ ...why, margin: 0, maxWidth: '72ch' }}>
        The system&apos;s own dice: faces with numbers, signs or symbols. A roll can use them in its dice, and COUNT THE SYMBOLS reads what they show. The table&apos;s dice from CUSTOM_DIE.EXE stay the table&apos;s.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(150px, 210px) minmax(0, 1fr) minmax(200px, 280px)', gap: 14, alignItems: 'start' }}>
        <nav aria-label="Dice" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {dice.map((d) => (
            <button key={d.id} type="button" aria-current={d.id === die?.id} onClick={() => setPicked(d.id)}
              style={{ ...mono, textAlign: 'left', background: d.id === die?.id ? 'color-mix(in srgb, var(--green) 8%, transparent)' : 'none', border: `1px solid ${d.id === die?.id ? 'var(--green)' : 'transparent'}`, color: d.color === 'danger' ? 'var(--danger)' : 'var(--green)', fontSize: 12, padding: '5px 8px', display: 'flex', flexDirection: 'column', gap: 2, cursor: 'pointer' }}>
              <span>{d.name.toUpperCase()}</span>
              <span style={{ fontSize: 10, opacity: 0.7, display: 'flex', gap: 4, flexWrap: 'wrap' }}>{d.faces.length} FACES · {d.faces.slice(0, 8).map((f, i) => <FaceShown key={i} die={d} face={f} symbols={symbols} size={11} />)}</span>
            </button>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
            <button type="button" className="utility-btn" style={btn} onClick={() => added(withNewDie(definition), `A system has at most ${LIMITS.dice} dice.`)}>+ DIE</button>
            {api && (
              <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <button type="button" className="utility-btn" style={{ ...btn, flex: 1 }} onClick={openCopy}>COPY FROM THE TABLE&apos;S DICE</button>
                <HelpHint text={HINTS['dice.copy']} />
              </span>
            )}
            <FieldName hint={HINTS['dice.preset']} style={small}>FROM A PRESET</FieldName>
            <div role="group" aria-label="New dice from a preset" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {Object.entries(DICE_PRESETS).map(([k, p]) => (
                <button key={k} type="button" className="utility-btn" style={btn} onClick={() => added(withDicePreset(definition, k), 'There isn\'t room for those dice and their symbols.')}>{p.label.toUpperCase()}</button>
              ))}
            </div>
          </div>
          {copying && (
            <div role="group" aria-label="The table's dice" style={{ border: '1px solid var(--dark-green)', padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={small}>THE TABLE&apos;S DICE</span>
              {!copying.dice && !copying.error && <span style={{ ...why, fontSize: 11 }}>Looking…</span>}
              {copying.dice?.filter((d) => !d.locked).map((d) => (
                <button key={String(d.id)} type="button" className="utility-btn" style={{ ...btn, textAlign: 'left' }} onClick={() => added(withTableDie(definition, d), '')}>
                  {d.name.toUpperCase()} · {d.faces.length} FACES
                </button>
              ))}
              {copying.dice && !copying.dice.some((d) => !d.locked) && <span style={{ ...why, fontSize: 11 }}>The table has no dice of its own yet: make one with CUSTOM_DIE.EXE in the dice menu.</span>}
              {copying.error && <span role="alert" style={{ color: 'var(--danger)', fontSize: 11 }}>{copying.error}</span>}
              <div><button type="button" className="utility-btn" style={btn} onClick={() => setCopying(null)}>CANCEL</button></div>
            </div>
          )}
          {said && <span role="alert" style={{ color: 'var(--danger)', fontSize: 11 }}>{said}</span>}
        </nav>
        {die ? (
          <DieEditor key={`edit:${die.id}`} definition={definition} edit={edit} api={api} die={die} onRemoved={() => setPicked(null)} />
        ) : (
          <span style={{ ...why, fontSize: 12 }}>No dice of its own yet. Start from a preset, or + DIE for a plain d6 to change.</span>
        )}
        {die ? <TestDice key={`test:${die.id}`} definition={definition} api={api} die={die} /> : <span />}
      </div>
    </div>
  );
}
