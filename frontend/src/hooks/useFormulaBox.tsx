import React, { useEffect, useRef, useState } from 'react';
import type { Definition, systemsApi } from '../sheets/systemsApi';
import {
  wordsOf, sampleLine, insertGroups, shapesOf, writeShape, levelTokens,
  type FormulaKind, type FormulaRead, type Shape,
} from '../sheets/formulaBox';
import { allStats, insertToken } from '../sheets/statsRules';
import { FormulaIcon } from '../components/FormulaIcon';
import { PREVIEW_DELAY_MS } from './usePreviewValues';

// The builder's formula box (formula box 1; approved mockup docs/mockups/formula-box.html,
// 2026-10-29): a formula's text with a FORMULA button beside it. Under it, always, one line saying
// it in words with what it comes to for the sample character, or its mistake in red with a fix for
// a name nearly right. The button opens SHAPE (a common formula written for you) and INSERT (the
// names it can read, put at the cursor); only the button opens them, so typing is never covered.
// The words, shapes and names are sheets/formulaBox.ts; the server reads the formula. The
// button's mark is components/FormulaIcon.tsx.

interface Options {
  definition: Definition;
  api?: ReturnType<typeof systemsApi>;
  kind: FormulaKind;
  value: string;
  onChange: (text: string) => void;
  /** The box's name: `Modifier 1: by`. */
  label: string;
  /** The text box's id, for a label beside it. */
  id?: string;
  placeholder?: string;
  inputStyle: React.CSSProperties;
}

const small: React.CSSProperties = { fontSize: 9, letterSpacing: 3, opacity: 0.7 };
const chip = (on: boolean): React.CSSProperties => ({
  border: `1px ${on ? 'solid' : 'dashed'} var(--green)`, background: on ? 'color-mix(in srgb, var(--green) 20%, transparent)' : 'none',
  color: 'var(--green)', fontFamily: 'monospace', fontSize: 10, letterSpacing: 1, padding: '3px 7px', cursor: 'pointer',
});
const askBox: React.CSSProperties = { background: 'var(--black)', color: 'var(--cyan)', border: '1px solid var(--cyan)', fontFamily: 'monospace', fontSize: 11, padding: '2px 5px' };

/** What a shape starts at: 1 to add, 13 for a stat, 5 for a level. */
const startOf = (s: Shape) => (s.id === 'at_least' ? 13 : s.id === 'level_at_least' ? 5 : s.id === 'per_level' || s.id === 'per_class_level' ? 2 : 1);

/**
 * The box, as two parts the caller places: `field`, the text and its FORMULA button, where the
 * text box was; and `help`, the words line and (while open) SHAPE and INSERT, under the row.
 */
export function useFormulaBox({ definition, api, kind, value, onChange, label, id, placeholder, inputStyle }: Options): { field: React.ReactElement; help: React.ReactElement } {
  const [open, setOpen] = useState(false);
  // What the server said, kept with the text it was said of: an answer for older text is never shown.
  const [read, setRead] = useState<{ text: string; result: FormulaRead } | null>(null);
  const [shape, setShape] = useState<{ id: string; n: number; name: string } | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const cursor = useRef(value.length);
  const placeAt = useRef<number | null>(null);

  // The server reads it a moment after typing stops, as STATS & RULES' live values are.
  useEffect(() => {
    if (!api || !value.trim()) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      api.previewFormulas(definition, [{ text: value, kind }]).then((r) => { if (live && r.ok && r.value.results[0]) setRead({ text: value, result: r.value.results[0] }); });
    }, PREVIEW_DELAY_MS);
    return () => { live = false; clearTimeout(timer); };
  }, [api, definition, value, kind]);

  // After INSERT, the cursor goes after what was put in.
  useEffect(() => {
    if (placeAt.current === null || !input.current) return;
    input.current.focus();
    input.current.setSelectionRange(placeAt.current, placeAt.current);
    cursor.current = placeAt.current;
    placeAt.current = null;
  });

  const shapes = shapesOf(definition, kind);
  const levels = levelTokens(definition);
  const stats = allStats(definition).map((s) => ({ token: `@${s.id}`, label: (s.label || s.id).toUpperCase() }));
  const write = (s: { id: string; n: number; name: string }) => { setShape(s); onChange(writeShape(s.id, s.n, s.name)); };
  const pick = (s: Shape) => {
    const names = s.asks === 'number-and-stat' ? stats : s.asks === 'number-and-level' ? levels.filter((l) => s.id !== 'per_class_level' || l.token !== '@level') : [];
    write({ id: s.id, n: startOf(s), name: names[0]?.token ?? '@level' });
  };
  const current = shapes.find((s) => s.id === shape?.id);
  const shown = value.trim() && read?.text === value ? read.result : null;
  const bad = !!shown && !shown.ok;

  const field = (
    <span style={{ display: 'flex', gap: 6, minWidth: 0 }}>
      <input ref={input} id={id} type="text" aria-label={label} maxLength={1000} value={value} placeholder={placeholder} spellCheck={false}
        aria-invalid={bad ? true : undefined}
        style={{ ...inputStyle, flex: 1, minWidth: 0, ...(bad ? { borderColor: 'var(--danger)' } : {}) }}
        onChange={(e) => { setShape(null); onChange(e.target.value); cursor.current = e.target.selectionStart ?? e.target.value.length; }}
        onSelect={(e) => { cursor.current = (e.target as HTMLInputElement).selectionStart ?? 0; }} />
      <button type="button" aria-label={`Help writing ${label}`} aria-expanded={open} title="Help writing it" onClick={() => setOpen(!open)}
        style={{
          width: 28, flexShrink: 0, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          border: `1px ${open ? 'solid var(--cyan)' : 'dashed var(--green)'}`, color: open ? 'var(--cyan)' : 'var(--green)',
          background: open ? 'color-mix(in srgb, var(--cyan) 18%, transparent)' : 'none',
        }}>
        <FormulaIcon />
      </button>
    </span>
  );

  const words = wordsOf(kind, value, shown && shown.ok ? shown.reads : []);
  const help = (
    <>
      {value.trim() && (
        <div role="status" data-testid="formula-words" style={{ textAlign: 'left', fontSize: 11, lineHeight: 1.5, color: bad ? 'var(--danger)' : 'var(--cyan)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {bad && shown && !shown.ok
            ? <>
                <span>{shown.problem}</span>
                {shown.name && shown.suggest && (
                  <button type="button" style={chip(false)}
                    onClick={() => onChange(value.replace(new RegExp(`@${shown.name}(?![a-z0-9_])`), `@${shown.suggest}`))}>USE @{shown.suggest}</button>
                )}
              </>
            : <span>{words}{shown && shown.ok && <span style={{ color: 'var(--green)', opacity: 0.75 }}> · {sampleLine(kind, shown)}</span>}</span>}
        </div>
      )}
      {open && (
        <div role="group" aria-label={`Help writing ${label}`} style={{ textAlign: 'left', border: '1px solid var(--cyan)', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={small}>SHAPE</span>
            {shapes.map((s) => (
              <button key={s.id} type="button" disabled={!!s.needs} title={s.needs} aria-pressed={shape?.id === s.id}
                style={{ ...chip(shape?.id === s.id), opacity: s.needs ? 0.45 : 1, cursor: s.needs ? 'default' : 'pointer' }} onClick={() => pick(s)}>{s.label}</button>
            ))}
          </div>
          {shape && current && current.asks !== 'none' && (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', color: 'var(--cyan)' }}>
              {kind === 'requires' ? 'NEEDS' : kind === 'amount' ? 'ADD' : ''}
              {kind === 'requires' && (
                <select aria-label="Which" value={shape.name} style={askBox} onChange={(e) => write({ ...shape, name: e.target.value })}>
                  {(current.asks === 'number-and-stat' ? stats : levels).map((o) => <option key={o.token} value={o.token}>{o.label}</option>)}
                </select>
              )}
              {kind === 'requires' && 'OF AT LEAST'}
              <input type="number" aria-label="How many" value={shape.n} style={{ ...askBox, width: 56 }} onChange={(e) => write({ ...shape, n: Number(e.target.value) })} />
              {kind === 'uses' && shape.id === 'number' && 'USES'}
              {shape.id === 'per_level' && 'FOR EACH LEVEL'}
              {shape.id === 'per_class_level' && <>
                FOR EACH
                <select aria-label="Which level" value={shape.name} style={askBox} onChange={(e) => write({ ...shape, name: e.target.value })}>
                  {levels.filter((l) => l.token !== '@level').map((o) => <option key={o.token} value={o.token}>{o.label.replace(/ LEVEL$/, '')}</option>)}
                </select>
                LEVEL
              </>}
            </div>
          )}
          {insertGroups(definition, kind).map((g) => (
            <div key={g.title} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={small}>{g.title}</span>
              <div style={{ display: 'flex', gap: '2px 10px', flexWrap: 'wrap' }}>
                {g.items.map((it) => (
                  <button key={it.token} type="button" onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { const next = insertToken(value, cursor.current, it.token); placeAt.current = next.cursor; setShape(null); onChange(next.text); }}
                    style={{ background: 'none', border: 0, padding: 0, color: 'var(--cyan)', fontFamily: 'monospace', fontSize: 11, cursor: 'pointer' }}>
                    {it.token} <span style={{ fontSize: 9, opacity: 0.6 }}>{it.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
  return { field, help };
}
