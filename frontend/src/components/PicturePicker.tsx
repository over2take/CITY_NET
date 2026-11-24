import React, { useState } from 'react';
import type { systemsApi } from '../sheets/systemsApi';
import { BLANK_DRAWN } from '../sheets/drawings';
import { ConditionIconPicker } from './ConditionIconPicker';
import { DrawPad } from './DrawPad';
import { Drawing } from './Drawing';

// A builder picture picked (8b1b): one of the drawn icons, one uploaded, or one DRAWn on the 16 x 16 pad with how it will
// look where it is shown, DONE to close it. One picture: picking an icon takes the drawing off, drawing takes the icon.
// DAMAGE TYPES, CONDITIONS and the GAME tab's CONDITIONS panel pick with it.

interface Props {
  /** The icon picked, or none while it is drawn. */
  icon?: string;
  drawn?: string[];
  onIcon: (icon: string) => void;
  /** The drawing, a stroke at a time; a blank one when DRAW is first pressed. */
  onDrawn: (drawn: string[]) => void;
  /** What it is a picture of, for the labels: "Fire". */
  name: string;
  /** The drawn icons offered (a condition's 27 unless said). */
  icons?: readonly string[];
  api?: ReturnType<typeof systemsApi>;
  /** Each icon's size in the picker. */
  size?: number;
  /** How a drawing looks where it is shown, beside the pad. */
  preview?: (drawn: string[]) => React.ReactNode;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 11, lineHeight: 1.45, opacity: 0.85, margin: 0 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };

export function PicturePicker({ icon, drawn, onIcon, onDrawn, name, icons, api, size, preview }: Props) {
  const [drawing, setDrawing] = useState(false);
  const shown = name.toUpperCase();
  const draw = () => {
    if (!drawn) onDrawn(BLANK_DRAWN);
    setDrawing(true);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
      {/* While it is drawn, no icon is checked; picking one takes the drawing, and the pad, away. */}
      <ConditionIconPicker value={drawn ? '' : icon ?? ''} icons={icons} api={api} name={name} size={size} onPick={onIcon} />
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        {drawn && (
          <span role="img" aria-label={`${shown} drawn`} style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: '1px solid var(--green)', color: 'var(--green)' }}><Drawing drawn={drawn} size={18} /></span>
        )}
        <button type="button" className="utility-btn" style={btn} aria-pressed={!!drawn} onClick={draw}>{drawn ? 'DRAW · EDIT' : 'DRAW'}</button>
        <span style={why}>A drawing on the 16 × 16 pad, kept in the system and its file.</span>
      </div>
      {drawing && drawn && (
        <div style={{ border: '1px solid var(--dark-green)', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={small}>DRAW {shown}</span>
          <DrawPad drawn={drawn} name={name} onChange={onDrawn} preview={preview} />
          <div><button type="button" className="utility-btn" style={btn} onClick={() => setDrawing(false)}>DONE</button></div>
        </div>
      )}
    </div>
  );
}

/** A damage type's drawing where it will be shown: in the HEALTH folder's ring (8b4), and large. */
export function OnTheRing({ drawn }: { drawn: string[] }) {
  return (
    <>
      <span style={small}>ON THE HEALTH PAGE</span>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--cyan)' }}>
        <span style={{ width: 30, height: 30, borderRadius: '50%', border: '2px solid var(--cyan)', display: 'grid', placeItems: 'center' }}><Drawing drawn={drawn} size={16} /></span>
        <span style={{ color: 'var(--green)' }}><Drawing drawn={drawn} size={40} /></span>
      </div>
      <span style={{ fontSize: 11, opacity: 0.85, maxWidth: '26ch' }}>One color: the theme&apos;s. Press and drag to draw.</span>
    </>
  );
}

/** A condition's drawing where it will be shown: its chip in a HEALTH folder, over a token on the map, and large. */
export function OnAChip({ drawn, short }: { drawn: string[]; short: string }) {
  return (
    <>
      <span style={small}>ON A CHIP · ON THE MAP</span>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--green)' }}>
        <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', border: '1px solid var(--green)', padding: '1px 6px', fontSize: 10, letterSpacing: 1 }}><Drawing drawn={drawn} size={13} />{short}</span>
        <Drawing drawn={drawn} size={11} />
        <Drawing drawn={drawn} size={40} />
      </div>
      <span style={{ fontSize: 11, opacity: 0.85, maxWidth: '26ch' }}>One color: the theme&apos;s. Press and drag to draw.</span>
    </>
  );
}
