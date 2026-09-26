import { useEffect, useState } from 'react';

// A BIOS-style boot screen over the map right after login, while the startup sound plays.
//
// A mock-up to try: lines type out one after another like a power-on self test, then it
// fades away. Any click or key skips it. Theme colors only, so it boots in the table's own
// palette. It also covers the map while that first loads.

const LINE_MS = 320;
const HOLD_MS = 700;
const FADE_MS = 450;

export const bootLines = (version: string, operator: string) => [
  `CITY_NET BIOS v${version}   (C) NAV_OS SYSTEMS`,
  'MEMORY TEST ................ 65536K OK',
  'DETECTING NEURAL LINK ...... OK',
  'MOUNTING /CITY/GRID ........ OK',
  'LOADING DISTRICT MAPS ...... OK',
  `SYNCING OPERATOR: ${operator.toUpperCase()}`,
  'HANDSHAKE WITH GM NODE ..... OK',
  'NAV_OS READY',
];

export function BootScreen({ operator, onDone }: { operator: string; onDone: () => void }) {
  const lines = bootLines(__APP_VERSION__, operator);
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

  // Skippable: nobody should have to sit through it twice.
  useEffect(() => {
    const skip = () => onDone();
    window.addEventListener('keydown', skip);
    return () => window.removeEventListener('keydown', skip);
  }, [onDone]);

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
      {lines.slice(0, shown).map((line, i) => (
        <div key={i}>{line}</div>
      ))}
      <span style={{ animation: 'blink 1s steps(2, start) infinite' }}>█</span>
      <div style={{ position: 'absolute', bottom: 24, right: 32, fontSize: 11, opacity: 0.6 }}>
        CLICK OR PRESS ANY KEY TO SKIP
      </div>
    </div>
  );
}
