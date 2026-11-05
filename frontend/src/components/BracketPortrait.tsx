import React from 'react';
import { TvPortrait } from './TvPortrait';

// Targeting-bracket portrait frame - the visual identity of the sheet system.
// Uploaded portraits get a CSS take on the signs' TV shader: scanlines,
// R/B chromatic fringe, and an intermittent glitch jitter.
const PORTRAIT_HINT = 'Best results: a square image, 400×400px or larger. JPG / PNG / WebP / GIF, max 8MB.';

export function BracketPortrait({ initial, portraitUrl, size = 64, onUpload, shadowFilter = false, onToggleShadow }: {
  initial: string;
  portraitUrl?: string | null;
  size?: number;
  onUpload?: (file: File) => void;
  /** Darken the portrait to a shadow silhouette (hides reused stock art). */
  shadowFilter?: boolean;
  onToggleShadow?: () => void;
}) {
  const b = Math.max(9, Math.round(size * 0.18));
  const corner = (pos: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute', width: `${b}px`, height: `${b}px`, ...pos,
  });
  const frame = (
    <div style={{ position: 'relative', width: `${size}px`, height: `${size}px`, background: 'color-mix(in srgb, var(--black) 60%, transparent)', flex: '0 0 auto', overflow: 'hidden' }}>
      {portraitUrl ? (
        <TvPortrait src={portraitUrl} silhouette={shadowFilter} />
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--green)', fontSize: `${Math.round(size * 0.38)}px`, letterSpacing: '1px' }}>
          {initial}
        </div>
      )}
      <div style={corner({ top: 0, left: 0, borderTop: '2px solid var(--green)', borderLeft: '2px solid var(--green)' })} />
      <div style={corner({ top: 0, right: 0, borderTop: '2px solid var(--green)', borderRight: '2px solid var(--green)' })} />
      <div style={corner({ bottom: 0, left: 0, borderBottom: '2px solid var(--green)', borderLeft: '2px solid var(--green)' })} />
      <div style={corner({ bottom: 0, right: 0, borderBottom: '2px solid var(--green)', borderRight: '2px solid var(--green)' })} />
    </div>
  );
  if (!onUpload && !onToggleShadow) return frame;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: '0 0 auto' }}>
      {frame}
      <div style={{ display: 'flex', gap: '1px' }}>
        {onUpload && (
          <label title={PORTRAIT_HINT} style={{
            cursor: 'pointer', background: 'rgba(0, 0, 0, 0.85)', flex: 1,
            border: '1px solid var(--green)', borderTop: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '4px 6px', userSelect: 'none',
          }}>
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }}
            />
            <span style={{ fontSize: '9px', letterSpacing: '1px', color: 'var(--green)', fontWeight: 600, whiteSpace: 'nowrap' }}>UPLOAD · MAX 8MB</span>
          </label>
        )}
        {onToggleShadow && (
          <button
            onClick={onToggleShadow}
            title={shadowFilter ? 'Reveal portrait' : 'Shadow silhouette — hide reused stock art'}
            style={{
              cursor: 'pointer', background: shadowFilter ? 'color-mix(in srgb, var(--green) 8%, transparent)' : 'rgba(0,0,0,0.85)',
              border: '1px solid var(--green)', borderTop: 'none', borderLeft: onUpload ? 'none' : '1px solid var(--green)',
              padding: '4px 6px', color: 'var(--green)', fontSize: '9px',
              letterSpacing: '1px', fontWeight: 600, whiteSpace: 'nowrap',
            }}
          >
            {shadowFilter ? 'SHADOW ■' : 'SHADOW □'}
          </button>
        )}
      </div>
    </div>
  );
}
