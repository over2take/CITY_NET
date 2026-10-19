import React, { useState } from 'react';
import type { AddChoice } from '../sheets/graphAdds';
import { matching } from '../sheets/graphAdds';

// + ADD on the graph view (5b4; approved mockup docs/mockups/builder-graph.html: "add-node search,
// press A"): what can be added, searched as it is typed, picked with a click or the arrow keys and
// Enter; Escape closes it. What isn't added from the map yet is shown, greyed, saying when it will be.

interface Props { choices: AddChoice[]; onAdd: (key: string) => void; onClose: () => void }

export function GraphAddPalette({ choices, onAdd, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);
  const shown = matching(choices, query);
  const ready = shown.filter((c) => !c.soon);
  const lit = ready[Math.min(at, ready.length - 1)];
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); } else if (e.key === 'ArrowDown') { e.preventDefault(); setAt((a) => Math.min(a + 1, ready.length - 1)); } else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((a) => Math.max(a - 1, 0)); } else if (e.key === 'Enter' && lit) { e.preventDefault(); onAdd(lit.key); }
  };
  return (
    <div role="dialog" aria-label="Add a node" style={{
      position: 'absolute', top: 54, left: '50%', transform: 'translateX(-50%)', zIndex: 7, width: 380, maxWidth: '90%', display: 'flex', flexDirection: 'column',
      background: 'var(--black)', border: '1px solid var(--green)', boxShadow: '0 0 14px color-mix(in srgb, var(--green) 40%, transparent)', fontFamily: 'monospace', textAlign: 'left',
    }}>
      <input autoFocus type="text" aria-label="Add a node: type to search" placeholder="Add a node: type to search" value={query}
        onChange={(e) => { setQuery(e.target.value); setAt(0); }} onKeyDown={keys}
        style={{ background: 'var(--black)', color: 'var(--green)', border: 0, borderBottom: '1px solid var(--dark-green)', fontFamily: 'monospace', fontSize: 12, padding: '8px 10px', outline: 'none' }} />
      <div role="listbox" aria-label="What to add" style={{ maxHeight: 320, overflowY: 'auto' }}>
        {shown.map((c) => (
          <button key={c.key} type="button" role="option" aria-selected={c === lit} disabled={!!c.soon} onClick={() => onAdd(c.key)}
            style={{
              display: 'grid', gridTemplateColumns: '150px minmax(0, 1fr)', gap: 8, width: '100%', textAlign: 'left', padding: '6px 10px', border: 0,
              borderTop: '1px solid color-mix(in srgb, var(--dark-green) 60%, transparent)', fontFamily: 'monospace', fontSize: 11, letterSpacing: 1,
              background: c === lit ? 'color-mix(in srgb, var(--green) 12%, transparent)' : 'none', color: 'var(--green)', cursor: c.soon ? 'default' : 'pointer', opacity: c.soon ? 0.45 : 1,
            }}>
            <span>{c.label}</span>
            <span style={{ letterSpacing: 0, fontSize: 11, color: 'var(--text)', opacity: 0.85 }}>{c.soon ? `${c.what} · ${c.soon}` : c.what}</span>
          </button>
        ))}
        {!shown.length && <div style={{ padding: '8px 10px', fontSize: 12, opacity: 0.7 }}>Nothing by that name.</div>}
      </div>
    </div>
  );
}
