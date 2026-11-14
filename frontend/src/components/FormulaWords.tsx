import React from 'react';
import { wordsOf, sampleLine, isMistake, type FormulaKind, type FormulaRead } from '../sheets/formulaBox';

// The line under a formula (formula box 1; approved mockup docs/mockups/formula-box.html,
// 2026-10-29): the formula in words with what it comes to for the sample character, or its mistake
// in red with a fix for a name nearly right. The formula box (hooks/useFormulaBox.tsx) draws it under
// its box; STATS & RULES and the graph view's panel draw it under each formula (formula box 3), where
// the VALUE column already says the sample's value.

const fix: React.CSSProperties = {
  border: '1px dashed var(--green)', background: 'none', color: 'var(--green)', fontFamily: 'monospace', fontSize: 10, letterSpacing: 1, padding: '3px 7px', cursor: 'pointer',
};

interface Props {
  kind: FormulaKind;
  text: string;
  /** What the server made of this very text, or null while it hasn't answered. */
  read: FormulaRead | null | undefined;
  /** The text with a name put right, for USE @name. */
  onFix: (next: string) => void;
  /** The sample's value after the words: off where a VALUE column shows it. */
  sample?: boolean;
  /** A live status read out as it changes (one box); off where many sit on a page, read with their box instead. */
  live?: boolean;
  /** For the box's aria-describedby. */
  id?: string;
}

export function FormulaWords({ kind, text, read, onFix, sample = true, live = true, id }: Props) {
  if (!text.trim()) return null;
  const bad = isMistake(read);
  const said = wordsOf(kind, text, read && read.ok ? read.reads : []);
  return (
    <div id={id} role={live ? 'status' : undefined} data-testid="formula-words"
      style={{ textAlign: 'left', fontSize: 11, lineHeight: 1.5, color: bad ? 'var(--danger)' : 'var(--cyan)', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {bad
        ? <>
            <span>{read.problem}</span>
            {read.name && read.suggest && (
              <button type="button" style={fix}
                onClick={() => onFix(text.replace(new RegExp(`@${read.name}(?![a-z0-9_])`), `@${read.suggest}`))}>USE @{read.suggest}</button>
            )}
          </>
        : <span>{said}{sample && read && read.ok && <span style={{ color: 'var(--green)', opacity: 0.75 }}> · {sampleLine(kind, read)}</span>}</span>}
    </div>
  );
}
