import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { accelerationOf, browserOf, stepsFor, DISMISSED_KEY, CHECK_ANYWAY_KEY, type Acceleration } from '../utils/hardwareAccel';
import { themeRoot } from '../utils/themeRoot';
import { useBuilderOpen } from './windowFocus';

// HARDWARE ACCELERATION IS OFF (the user, 2026-10-31: "Can we identify this and tell the user? Admin
// and Users"): a small notice at the foot of the screen, for the GM and players alike, when the
// browser draws the map on the processor (utils/hardwareAccel.ts), with the steps for their browser.
// It covers nothing: DISMISS hides it for good in this browser. Not over the system builder, which
// takes the screen, and never in an automated browser unless asked (CHECK_ANYWAY_KEY).

const read = (key: string) => { try { return window.localStorage.getItem(key); } catch { return null; } };

interface Props {
  /** The check, run once; the real one asks WebGL. */
  check?: () => { state: Acceleration };
  /** The browser's user agent, for its steps. */
  agent?: string;
}

/** Whether to check at all: not once dismissed, nor in an automated browser unless asked. */
const wanted = () => read(DISMISSED_KEY) !== '1' && (!navigator.webdriver || read(CHECK_ANYWAY_KEY) === '1');

export function AccelerationNotice({ check = accelerationOf, agent = navigator.userAgent }: Props) {
  // Checked once, on the first draw.
  const [off, setOff] = useState(() => wanted() && check().state === 'off');
  const builder = useBuilderOpen();
  if (!off || builder) return null;
  const dismiss = () => {
    setOff(false);
    try { window.localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* a private window: gone for now only */ }
  };
  return createPortal(
    <div role="status" aria-label="Hardware acceleration is off" data-testid="acceleration-notice" style={{
      // Above the map's status line at the foot, left-aligned where #root centres.
      position: 'fixed', bottom: 48, left: '50%', transform: 'translateX(-50%)', zIndex: 3000, width: 'min(460px, calc(100vw - 32px))', textAlign: 'left',
      boxSizing: 'border-box', background: 'var(--black)', border: '1px solid var(--warning)', color: 'var(--warning)',
      fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, lineHeight: 1.5, padding: '8px 10px', pointerEvents: 'auto',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <b>HARDWARE ACCELERATION IS OFF: THE 3D MAP WILL BE SLOW</b>
        <button type="button" className="utility-btn" onClick={dismiss} style={{ fontSize: 10, color: 'var(--warning)', borderColor: 'var(--warning)', flexShrink: 0 }}>DISMISS</button>
      </div>
      <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--green)' }}>
        {stepsFor(browserOf(agent)).map((s) => <li key={s}>{s}</li>)}
      </ol>
    </div>,
    themeRoot(),
  );
}
