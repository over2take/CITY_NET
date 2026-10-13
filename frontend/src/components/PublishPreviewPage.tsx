import React, { useState } from 'react';
import {
  byChange, byCharacter, otherLine, changesCharacters, headline, subline, type PublishPreview,
} from '../sheets/versionPreview';

// The builder's PUBLISH, stopping first to say what the new version changes (4h4; approved mockup
// docs/mockups/version-preview.html, 2026-10-13). Shown in place of the open page from v2 on,
// characters or not; a first version publishes at once. BY CHANGE, and BY CHARACTER when someone
// plays the system. Nothing is deleted by publishing: what stops showing is marked KEPT. The words
// are sheets/versionPreview.ts.

interface Props {
  preview: Extract<PublishPreview, { first: false }>;
  /** The system's name, as the heading says it. */
  system: string;
  onBack: () => void;
  onPublish: () => void;
  busy: boolean;
}

const mono: React.CSSProperties = { fontFamily: "'Courier New', Courier, monospace" };
const box: React.CSSProperties = { border: '1px solid var(--dark-green)' };
const head: React.CSSProperties = {
  display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 10px', borderBottom: '1px solid var(--dark-green)',
  color: 'var(--green)', letterSpacing: 1, fontSize: 11,
};
const row: React.CSSProperties = { padding: '7px 10px', borderBottom: '1px solid color-mix(in srgb, var(--dark-green) 70%, transparent)', display: 'flex', flexDirection: 'column', gap: 3 };
const kept = <span style={{ color: 'var(--cyan)', fontSize: 10, letterSpacing: 1 }}> · KEPT</span>;
const count = (n: number) => `${n} CHANGE${n === 1 ? '' : 'S'}`;

export function PublishPreviewPage({ preview, system, onBack, onPublish, busy }: Props) {
  const [view, setView] = useState<'change' | 'character'>('change');
  const people = preview.characters.length > 0;
  const showing = people ? view : 'change';
  const groups = byChange(preview);
  const other = otherLine(preview);

  return (
    <div data-testid="publish-preview" style={{ ...mono, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 820 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 style={{ margin: 0, fontSize: 14, color: 'var(--green)', letterSpacing: 1 }}>{headline(preview, system)}</h2>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, opacity: 0.85 }}>{subline(preview, system)}</p>
      </div>

      {changesCharacters(preview) && people && (
        <div role="tablist" aria-label="Read it" style={{ display: 'flex', gap: 4 }}>
          {(['change', 'character'] as const).map((v) => (
            <button key={v} type="button" role="tab" aria-selected={showing === v} className={`utility-btn ${showing === v ? 'active' : ''}`}
              onClick={() => setView(v)} style={{ ...mono, fontSize: 11, letterSpacing: 1, padding: '4px 10px' }}>
              {v === 'change' ? 'BY CHANGE' : 'BY CHARACTER'}
            </button>
          ))}
        </div>
      )}

      {!changesCharacters(preview) && (
        <div style={{ ...box, padding: 12, color: 'var(--green)', letterSpacing: 1, fontSize: 12 }}>NOTHING CHANGES FOR ANY CHARACTER.</div>
      )}

      {showing === 'change' && groups.map((g) => (
        <section key={g.id} aria-label={g.label} style={box}>
          <div style={head}><span>{g.label}</span><span style={{ opacity: 0.6 }}>{count(g.lines.length)}</span></div>
          {g.lines.map((l) => (
            <div key={l.key} style={row}>
              <span style={{ color: 'var(--green)', fontSize: 12 }}>{l.what}{l.kept && kept}</span>
              <span style={{ fontSize: 12, lineHeight: 1.45, opacity: 0.85 }}>{l.how}</span>
              {l.who.length > 0 && (
                <span data-testid="who" style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 14px', fontSize: 11 }}>
                  {l.who.map((w, i) => <span key={`${w.name}-${i}`}>{w.name.toUpperCase()} <span style={{ color: 'var(--cyan)' }}>{w.text}</span></span>)}
                </span>
              )}
            </div>
          ))}
        </section>
      ))}

      {showing === 'character' && byCharacter(preview).map((ch, i) => (
        <section key={`${ch.name}-${i}`} aria-label={ch.name} style={box}>
          <div style={head}>
            <span>{ch.name.toUpperCase()}{ch.kind === 'npc' && <span style={{ opacity: 0.6 }}> · NPC</span>}</span>
            <span style={{ opacity: 0.6 }}>{ch.lines.length ? count(ch.lines.length) : 'NOTHING CHANGES'}</span>
          </div>
          {ch.lines.map((l) => (
            <div key={l.key} style={{ ...row, flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: 'var(--green)', fontSize: 12 }}>{l.what}</span>
              <span style={{ color: 'var(--cyan)', fontSize: 11, textAlign: 'right' }}>{l.text}</span>
            </div>
          ))}
        </section>
      ))}

      {other && <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>{other}</p>}

      {preview.problems > 0 && (
        <p role="alert" style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>
          The draft has {preview.problems} problem{preview.problems === 1 ? '' : 's'}: fix {preview.problems === 1 ? 'it' : 'them'} in PROBLEMS before publishing.
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="utility-btn" onClick={onBack} style={{ ...mono, fontSize: 11, letterSpacing: 1, padding: '6px 12px' }}>BACK TO EDITING</button>
        <button type="button" className="utility-btn active" disabled={busy || preview.problems > 0} onClick={onPublish}
          style={{ ...mono, fontSize: 11, letterSpacing: 1, padding: '6px 12px' }}>
          {busy ? 'PUBLISHING…' : `PUBLISH v${preview.to}`}
        </button>
      </div>
    </div>
  );
}
