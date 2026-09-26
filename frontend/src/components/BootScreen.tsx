import { useEffect, useRef, useState } from 'react';

// A BIOS-style boot screen before the login screen, as the "computer" is switched on.
//
// It waits for a key - browsers will not play a sound until the page has been touched, and
// "PRESS ANY KEY" is what an old machine said anyway - then plays the startup sound while a
// power-on self test types out, fades, and leaves the login screen. A second key or click
// skips the rest. Theme colors only, so it boots in the table's own palette.

const LINE_MS = 320;
const HOLD_MS = 700;
const FADE_MS = 450;

export const bootLines = (version: string) => [
  `CITY_NET BIOS v${version}   (C) NAV_OS SYSTEMS`,
  'MEMORY TEST ................ 65536K OK',
  'DETECTING NEURAL LINK ...... OK',
  'MOUNTING /CITY/GRID ........ OK',
  'LOADING DISTRICT MAPS ...... OK',
  'HANDSHAKE WITH GM NODE ..... OK',
  'NAV_OS READY · AWAITING OPERATOR',
];

type Phase = 'waiting' | 'typing' | 'fading';

export function BootScreen({ onStart, onDone }: {
  /** The key that boots it: the moment a sound is allowed to play. */
  onStart?: () => void;
  onDone: () => void;
}) {
  const lines = bootLines(__APP_VERSION__);
  const [phase, setPhase] = useState<Phase>('waiting');
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (phase !== 'typing') return;
    if (shown < lines.length) {
      const t = setTimeout(() => setShown((n) => n + 1), LINE_MS);
      return () => clearTimeout(t);
    }
    const hold = setTimeout(() => setPhase('fading'), HOLD_MS);
    return () => clearTimeout(hold);
  }, [phase, shown, lines.length]);

  useEffect(() => {
    if (phase !== 'fading') return;
    const t = setTimeout(onDone, FADE_MS);
    return () => clearTimeout(t);
  }, [phase, onDone]);

  /** The first press boots; any after it skips to the login screen. */
  const press = () => {
    if (phase === 'waiting') { onStart?.(); setPhase('typing'); } else onDone();
  };
  const pressRef = useRef(press);
  pressRef.current = press;
  useEffect(() => {
    const onKey = () => pressRef.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      data-testid="boot-screen"
      role="status"
      aria-label="Starting NAV_OS"
      onMouseDown={press}
      style={{
        position: 'fixed', inset: 0, zIndex: 100000, cursor: 'pointer',
        background: 'var(--black)', color: 'var(--green)',
        fontFamily: 'monospace', fontSize: 14, letterSpacing: 1, lineHeight: 1.7,
        padding: '48px 56px', textShadow: 'var(--glow)',
        opacity: phase === 'fading' ? 0 : 1, transition: `opacity ${FADE_MS}ms ease`,
      }}
    >
      {phase === 'waiting' ? (
        <div>PRESS ANY KEY TO BOOT <span style={{ animation: 'blink 1s steps(2, start) infinite' }}>█</span></div>
      ) : (
        <>
          {lines.slice(0, shown).map((line, i) => <div key={i}>{line}</div>)}
          <span style={{ animation: 'blink 1s steps(2, start) infinite' }}>█</span>
          <div style={{ position: 'absolute', bottom: 24, right: 32, fontSize: 11, opacity: 0.6 }}>
            CLICK OR PRESS ANY KEY TO SKIP
          </div>
        </>
      )}
    </div>
  );
}
