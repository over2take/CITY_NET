import React, { useEffect, useState } from 'react';
import { browserOf, stepsFor, warnOn, setWarn, WARN_EVENT } from '../utils/hardwareAccel';
import { ToggleSwitch } from './ToggleSwitch';

// MAP SLOW? in SYSTEM_INFO (the user, 2026-10-31): for the GM and players alike, the steps to turn
// hardware acceleration on in their browser, opened when they want them, never popped up; and WARN ME
// IF HARDWARE ACCELERATION IS OFF, the setting the notice (AccelerationNotice.tsx) follows, kept in
// this browser's local storage. DISMISS on the notice turns it off; only this turns it back on.

export function MapSlowHelp({ agent = navigator.userAgent }: { agent?: string }) {
  const [open, setOpen] = useState(false);
  const [warn, setWarnState] = useState(warnOn);
  useEffect(() => {
    const again = () => setWarnState(warnOn());
    window.addEventListener(WARN_EVENT, again);
    return () => window.removeEventListener(WARN_EVENT, again);
  }, []);
  return (
    <div style={{ marginBottom: '20px' }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)}
        style={{ background: 'none', border: 0, padding: 0, color: 'var(--green)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', opacity: 0.85 }}>
        {open ? '▾' : '▸'} MAP SLOW?
      </button>
      {open && (
        <div role="region" aria-label="Map slow?" style={{ fontSize: '0.65rem', lineHeight: 1.5, textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          <span style={{ opacity: 0.75 }}>A slow 3D map usually means hardware acceleration is off in your browser. To turn it on:</span>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {stepsFor(browserOf(agent)).map((s) => <li key={s}>{s}</li>)}
          </ol>
        </div>
      )}
      <div style={{ marginTop: 6 }}>
        <ToggleSwitch label="WARN ME IF HARDWARE ACCELERATION IS OFF" on={warn} onChange={setWarn} style={{ fontSize: '0.6rem' }} />
      </div>
    </div>
  );
}
