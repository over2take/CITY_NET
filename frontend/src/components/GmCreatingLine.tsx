import React, { useState } from 'react';
import { gmFlowLine, startOverWords } from '../sheets/newCharacterFlow';
import type { SheetTemplate } from '../sheets';

// The GM's line on a player's sheet (7c5; approved mockup docs/mockups/new-character.html): where the
// character is in the new character flow, SKIP IT, and START OVER, which asks first. What it says is
// sheets/newCharacterFlow.ts, and what the actions do is the server's (backend creation.js).

interface Props {
  template: SheetTemplate | null | undefined;
  data: Record<string, unknown> | null | undefined;
  system: string | null | undefined;
  onAct: (kind: 'skip' | 'startOver') => void;
  /** Why the server last said no. */
  refused?: string | null;
}

const btn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--dark-green)', color: 'var(--green)', cursor: 'pointer', whiteSpace: 'nowrap',
  fontFamily: 'inherit', fontSize: '0.6rem', letterSpacing: '1px', padding: '2px 7px',
};
const danger: React.CSSProperties = { ...btn, borderColor: 'var(--danger)', color: 'var(--danger)' };

export function GmCreatingLine({ template, data, system, onAct, refused }: Props) {
  const [asking, setAsking] = useState(false);
  const [acted, setActed] = useState(false);
  const line = gmFlowLine(template, data);
  if (!line) return null;
  const act = (kind: 'skip' | 'startOver') => { setAsking(false); setActed(true); onAct(kind); };
  return (
    <div role="group" aria-label="New character" style={{ display: 'flex', flexDirection: 'column', gap: '4px', margin: '4px 0', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', border: '1px solid var(--dark-green)', padding: '3px 8px' }}>
        <span style={{ fontSize: '0.65rem', letterSpacing: '1px', flex: '1 1 auto', minWidth: 0, textAlign: 'left' }}>{line.words}</span>
        {line.canSkip && <button type="button" style={btn} onClick={() => act('skip')}>SKIP IT</button>}
        {line.canStartOver && !asking && <button type="button" style={danger} onClick={() => setAsking(true)}>START OVER</button>}
      </div>
      {asking && (
        <div role="alertdialog" aria-label="START OVER" style={{ border: '1px solid var(--danger)', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <span style={{ fontSize: '0.7rem', lineHeight: 1.45 }}>{startOverWords(data, system)}</span>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button type="button" style={danger} onClick={() => act('startOver')}>START OVER</button>
            <button type="button" style={btn} onClick={() => setAsking(false)}>CANCEL</button>
          </div>
        </div>
      )}
      {acted && refused && <span role="alert" style={{ fontSize: '0.7rem', color: 'var(--warning)' }}>{refused}</span>}
    </div>
  );
}
