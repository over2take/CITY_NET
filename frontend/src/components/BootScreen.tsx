import { useEffect, useRef, useState } from 'react';

// A BIOS-style boot screen before the login screen, as the "computer" is switched on.
//
// It starts by itself: a power-on self test types out, holds a moment, and fades as the
// login window fades in behind it (App plays the startup sound then). Any key or click
// skips the rest. Theme colors only, so it boots in the table's own palette.

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

/** How long the boot runs start to finish, so its sound can be made the same length. */
export const BOOT_SECONDS = (bootLines('').length * LINE_MS + HOLD_MS + FADE_MS) / 1000;

export function BootScreen({ onDone }: { onDone: () => void }) {
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

  useEffect(() => {
    if (!fading) return;
    const t = setTimeout(onDone, FADE_MS);
    return () => clearTimeout(t);
  }, [fading, onDone]);

  // Skippable: a key or a click goes straight to the login window.
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    const onKey = () => doneRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      data-testid="boot-screen"
      role="status"
      aria-label="Starting NAV_OS"
      onMouseDown={onDone}
      style={{
        position: 'fixed', inset: 0, zIndex: 100000, cursor: 'pointer',
        background: 'var(--black)', color: 'var(--green)',
        fontFamily: 'monospace', fontSize: 14, letterSpacing: 1, lineHeight: 1.7,
        padding: '48px 56px', textShadow: 'var(--glow)',
        opacity: fading ? 0 : 1, transition: `opacity ${FADE_MS}ms ease`,
      }}
    >
      {lines.slice(0, shown).map((line, i) => <div key={i}>{line}</div>)}
      <span style={{ animation: 'blink 1s steps(2, start) infinite' }}>█</span>
      <div style={{ position: 'absolute', bottom: 24, right: 32, fontSize: 11, opacity: 0.6 }}>
        CLICK OR PRESS ANY KEY TO SKIP
      </div>
    </div>
  );
}
