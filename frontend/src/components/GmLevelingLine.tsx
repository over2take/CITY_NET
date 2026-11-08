import React from 'react';
import { gmLevelingLine } from '../sheets/levelUpFlow';
import type { SheetTemplate } from '../sheets';

// The GM's line on a player's sheet while they level up (7d5b; approved mockup docs/mockups/level-up.html): where they
// are in LEVEL_UP.EXE, a health roll kept, and CLEAR THE ROLL for them to roll again. What it says is
// sheets/levelUpFlow.ts gmLevelingLine; clearing is the server's (backend levelUp.js, 'clearHealth').

interface Props {
  template: SheetTemplate | null | undefined;
  data: Record<string, unknown> | null | undefined;
  onClear: () => void;
}

const btn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--dark-green)', color: 'var(--green)', cursor: 'pointer', whiteSpace: 'nowrap',
  fontFamily: 'inherit', fontSize: '0.6rem', letterSpacing: '1px', padding: '2px 7px',
};

export function GmLevelingLine({ template, data, onClear }: Props) {
  const line = gmLevelingLine(template, data);
  if (!line) return null;
  return (
    <div role="group" aria-label="Leveling up" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', border: '1px solid var(--dark-green)', padding: '3px 8px', margin: '4px 0', flexShrink: 0 }}>
      <span style={{ fontSize: '0.65rem', letterSpacing: '1px', flex: '1 1 auto', minWidth: 0, textAlign: 'left' }}>{line.words}</span>
      {line.canClear && <button type="button" style={btn} onClick={onClear}>CLEAR THE ROLL</button>}
    </div>
  );
}
