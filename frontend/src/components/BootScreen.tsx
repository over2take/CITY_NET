import { useEffect, useRef, useState } from 'react';

// A BIOS-style boot screen before the login screen, as the "computer" is switched on.
//
// It starts by itself: a power-on self test types out, holds a moment, and fades as the
// login window fades in behind it (App plays the startup sound and fades the hum in then).
// Only the SKIP button in the corner skips it. Each line is reported as it appears, for the
// drive clicks, and a click on the screen is passed on - it is when a browser first lets the
// page make sound. Theme colors only, in the table's own palette.

const LINE_MS = 260;
const HOLD_MS = 600;
const FADE_MS = 450;

export const bootLines = (version: string) => [
  `CITY_NET BIOS v${version}   (C) NAV_OS SYSTEMS`,
  'CPU: NEUROCORE X9 @ 4.77 GHZ',
  'MEMORY TEST ................ 65536K OK',
  'CHECKING CYBERDECK INTERFACE  OK',
  'DETECTING NEURAL LINK ...... OK',
  'LOADING KERNEL NAV_OS ...... OK',
  'MOUNTING /CITY/GRID ........ OK',
  'LOADING DISTRICT MAPS ...... OK',
  'INDEXING STREET NETWORK .... OK',
  'SYNCING BANK LEDGER ........ OK',
  'OPENING COMMS CHANNEL ...... OK',
  'HANDSHAKE WITH GM NODE ..... OK',
  'NAV_OS READY · AWAITING OPERATOR',
];

export function BootScreen({ onDone, onLine, onTouch }: {
  onDone: () => void;
  /** A line of the self test just appeared - the drive reads for each one. */
  onLine?: (index: number) => void;
  /** The page was clicked during the boot: the moment a browser lets it make sound. */
  onTouch?: () => void;
}) {
  const lines = bootLines(__APP_VERSION__);
  const [shown, setShown] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (shown < lines.length) {
      const t = setTimeout(() => setShown((n) => n + 1), LINE_MS);
      return () => clearTimeout(t);
    }
    const hold = setTimeout(() => setFading(true), HOLD_MS);
    return () => clearTimeout(hold);
  }, [shown, lines.length]);

  const onLineRef = useRef(onLine);
  onLineRef.current = onLine;
  useEffect(() => {
    if (shown > 0) onLineRef.current?.(shown - 1);
  }, [shown]);

  useEffect(() => {
    if (!fading) return;
    const t = setTimeout(onDone, FADE_MS);
    return () => clearTimeout(t);
  }, [fading, onDone]);


  return (
    <div
      data-testid="boot-screen"
      role="status"
      aria-label="Starting NAV_OS"
      onPointerDown={onTouch}
      style={{
        position: 'fixed', inset: 0, zIndex: 100000,
        background: 'var(--black)', color: 'var(--green)',
        fontFamily: 'monospace', fontSize: 14, letterSpacing: 1, lineHeight: 1.7,
        // Left-aligned like a real BIOS screen; the app around it centers its text.
        padding: '48px 56px', textShadow: 'var(--glow)', textAlign: 'left',
        opacity: fading ? 0 : 1, transition: `opacity ${FADE_MS}ms ease`,
      }}
    >
      {lines.slice(0, shown).map((line, i) => <div key={i}>{line}</div>)}
      <span style={{ animation: 'blink 1s steps(2, start) infinite' }}>█</span>
      <button
        type="button"
        className="utility-btn"
        onClick={onDone}
        style={{ position: 'absolute', bottom: 24, right: 32, fontFamily: 'monospace', fontSize: 12, letterSpacing: 2, padding: '6px 16px' }}
      >SKIP</button>
    </div>
  );
}
