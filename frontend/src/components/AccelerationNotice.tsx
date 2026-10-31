import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { accelerationOf, accelerationOnce, browserOf, stepsFor, warnOn, setWarn, WARN_EVENT, CHECK_ANYWAY_KEY, type Acceleration } from '../utils/hardwareAccel';
import { themeRoot } from '../utils/themeRoot';
import { useBuilderOpen } from './windowFocus';

// HARDWARE ACCELERATION IS OFF (the user, 2026-10-31: "Can we identify this and tell the user? Admin
// and Users"): a small notice at the foot of the screen, for the GM and players alike, when the
// browser says it draws the map on the processor (utils/hardwareAccel.ts), with the steps for their
// browser. Only when it is sure, never from a guess (the user: "I don't want to show the
// notification on accident"). DISMISS turns SYSTEM_INFO's WARN ME switch off, for good in this
// browser, until it is switched back on. Not over the system builder, and never in an automated
// browser unless asked (CHECK_ANYWAY_KEY).

const read = (key: string) => { try { return window.localStorage.getItem(key); } catch { return null; } };

interface Props {
  /** The check; the real one asks WebGL, once per page. */
  check?: () => { state: Acceleration };
  /** The browser's user agent, for its steps. */
  agent?: string;
}

/** Whether an automated browser was asked to be checked all the same. */
const automatedSkips = () => !!navigator.webdriver && read(CHECK_ANYWAY_KEY) !== '1';

export function AccelerationNotice({ check = accelerationOf, agent = navigator.userAgent }: Props) {
  const [warn, setWarnState] = useState(warnOn);
  // The switch in SYSTEM_INFO and DISMISS here change the same setting.
  useEffect(() => {
    const again = () => setWarnState(warnOn());
    window.addEventListener(WARN_EVENT, again);
    return () => window.removeEventListener(WARN_EVENT, again);
  }, []);
  const builder = useBuilderOpen();
  // Asked only when it would be shown, and once per page.
  if (!warn || builder || automatedSkips() || accelerationOnce(check) !== 'off') return null;
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
        <button type="button" className="utility-btn" onClick={() => setWarn(false)} style={{ fontSize: 10, color: 'var(--warning)', borderColor: 'var(--warning)', flexShrink: 0 }}>DISMISS</button>
      </div>
      <ol style={{ margin: 0, paddingLeft: 18, color: 'var(--green)' }}>
        {stepsFor(browserOf(agent)).map((s) => <li key={s}>{s}</li>)}
      </ol>
      <span style={{ fontSize: 10, opacity: 0.7, color: 'var(--green)' }}>DISMISS stops this warning in this browser; SYSTEM_INFO turns it back on, and has these steps under MAP SLOW?.</span>
    </div>,
    themeRoot(),
  );
}
