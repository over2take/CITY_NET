import React, { useState } from 'react';
import type { MapProblem } from '../sheets/graphProblems';

// PROBLEMS on the graph view (5b6b; approved mockup docs/mockups/builder-graph.html, 2026-10-17):
// in the map's bottom left corner, how many errors (✕) and warnings (!) there are, opened to the
// list (sheets/graphProblems.ts). One on the map is a click to its node; one on another page says so,
// and goes to PROBLEMS.

interface Props { problems: MapProblem[]; onPick: (p: MapProblem) => void }

export function GraphProblems({ problems, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const errors = problems.filter((p) => p.kind === 'error').length;
  const warnings = problems.length - errors;
  return (
    <div data-testid="graph-problems" style={{
      position: 'absolute', left: 10, bottom: 34, zIndex: 5, width: 340, maxWidth: 'calc(100% - 20px)', maxHeight: 240, display: 'flex', flexDirection: 'column',
      background: 'var(--black)', border: `1px solid ${errors ? 'var(--danger)' : 'var(--dark-green)'}`, fontFamily: 'monospace', textAlign: 'left',
    }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px', background: 'none', border: 0, borderBottom: open ? '1px solid var(--dark-green)' : 0,
        color: 'var(--green)', fontFamily: 'monospace', fontSize: 10, letterSpacing: 2, cursor: 'pointer', textAlign: 'left',
      }}>
        <span>PROBLEMS</span>
        <span style={{ color: errors ? 'var(--danger)' : 'var(--green)', opacity: errors ? 1 : 0.6 }}>{errors} ✕</span>
        <span style={{ color: warnings ? 'var(--warning)' : 'var(--green)', opacity: warnings ? 1 : 0.6 }}>{warnings} !</span>
        <span style={{ marginLeft: 'auto' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (problems.length
        ? (
          <ul aria-label="Problems" className="cyber-scroll" style={{ listStyle: 'none', margin: 0, padding: 0, overflowY: 'auto', minHeight: 0 }}>
            {problems.map((p, i) => (
              <li key={i}>
                <button type="button" onClick={() => onPick(p)} style={{
                  display: 'grid', gridTemplateColumns: '14px minmax(0, 1fr)', gap: 6, width: '100%', padding: '5px 10px', background: 'none', textAlign: 'left',
                  border: 0, borderTop: i ? '1px solid color-mix(in srgb, var(--dark-green) 60%, transparent)' : 0,
                  color: 'var(--text)', fontFamily: 'monospace', fontSize: 11.5, lineHeight: 1.35, cursor: 'pointer',
                }}>
                  <b style={{ color: p.kind === 'error' ? 'var(--danger)' : 'var(--warning)' }}>{p.kind === 'error' ? '✕' : '!'}</b>
                  <span style={{ wordBreak: 'break-word' }}>
                    {p.text}
                    {!p.node && <span style={{ display: 'block', fontSize: 10, letterSpacing: 1, opacity: 0.6 }}>NOT ON THE MAP · GO TO PROBLEMS</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )
        : <div style={{ padding: '8px 10px', fontSize: 12, color: 'var(--green)' }}>No problems. It can be published.</div>)}
    </div>
  );
}
