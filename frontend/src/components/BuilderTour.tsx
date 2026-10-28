import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TOUR } from '../sheets/builderHelp';

// The builder's first-time tour (4i; approved mockup docs/mockups/builder-help.html, 2026-10-13):
// short steps (nine since CHOICES, 2026-10-28), a welcome and then the rail top to bottom, each beside the place on the rail
// it explains (lit there by the builder, which marks it with data-tour-place). BACK, NEXT, and SKIP
// THE TOUR or Escape; the builder remembers on the server that it was seen once finished or
// skipped. The words are sheets/builderHelp.ts.

/** How wide the box is, about how tall, and how far it keeps from the screen's edges. */
export const TOUR_WIDTH = 320;
const TOUR_HEIGHT = 220;
const EDGE = 16;

/**
 * Where the box goes: beside the lit rail button at `rect` (the rail held open `railWidth` wide),
 * or, for the welcome with nothing lit, in the middle of the upper screen; always on the screen.
 */
export const tourPlace = (rect: { top: number } | null, screen: { width: number; height: number }, railWidth: number) => {
  if (!rect) return { left: Math.max(EDGE, Math.round((screen.width - TOUR_WIDTH) / 2)), top: Math.max(EDGE, Math.round(screen.height * 0.2)) };
  const top = Math.min(Math.max(EDGE, rect.top - 10), Math.max(EDGE, screen.height - TOUR_HEIGHT - EDGE));
  return { left: railWidth + 14, top, arrow: Math.max(12, Math.min(TOUR_HEIGHT - 24, rect.top - top + 8)) };
};

const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };

interface Props {
  step: number;
  /** How wide the rail is held open while a step points at it. */
  railWidth: number;
  /** Finds the rail button a step points at; the builder's own root, so nothing outside it is lit. */
  root: () => HTMLElement | null;
  onBack: () => void;
  onNext: () => void;
  /** Finished early: SKIP THE TOUR or Escape. */
  onSkip: () => void;
}

export function BuilderTour({ step, railWidth, root, onBack, onNext, onSkip }: Props) {
  const s = TOUR[step];
  const last = step === TOUR.length - 1;
  const next = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState(() => tourPlace(null, { width: window.innerWidth, height: window.innerHeight }, railWidth));

  // Beside the button the step points at, measured once it is drawn.
  useLayoutEffect(() => {
    const lit = s.at ? root()?.querySelector(`[data-tour-place="${s.at}"]`) : null;
    setPlace(tourPlace(lit ? lit.getBoundingClientRect() : null, { width: window.innerWidth, height: window.innerHeight }, railWidth));
  }, [s.at, railWidth, root]);
  // The keyboard follows the tour: NEXT (or DONE) has focus at every step.
  useEffect(() => { next.current?.focus(); }, [step]);

  return (
    <div role="dialog" aria-label="The builder tour" aria-describedby="builder-tour-text"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onSkip(); } }}
      style={{
        position: 'fixed', left: place.left, top: place.top, width: TOUR_WIDTH, zIndex: 5, boxSizing: 'border-box',
        background: 'var(--black)', border: '1px solid var(--warning)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8,
        boxShadow: '0 0 22px color-mix(in srgb, var(--warning) 30%, transparent)', fontFamily: 'monospace',
      }}>
      {'arrow' in place && (
        <span aria-hidden data-testid="tour-arrow" style={{
          position: 'absolute', left: -9, top: place.arrow, width: 0, height: 0,
          borderTop: '8px solid transparent', borderBottom: '8px solid transparent', borderRight: '8px solid var(--warning)',
        }} />
      )}
      <span style={{ fontSize: 10, letterSpacing: 2, color: 'var(--warning)' }}>STEP {step + 1} OF {TOUR.length}</span>
      <h2 style={{ margin: 0, fontSize: 13, letterSpacing: 1, color: 'var(--green)' }}>{s.title}</h2>
      <p id="builder-tour-text" style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--text)' }}>{s.text}</p>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
        <span aria-hidden style={{ display: 'flex', gap: 4 }}>
          {TOUR.map((_, i) => (
            <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', border: '1px solid var(--green)', background: i === step ? 'var(--green)' : 'none' }} />
          ))}
        </span>
        <span style={{ display: 'flex', gap: 6 }}>
          <button type="button" className="utility-btn" style={btn} onClick={onSkip}>SKIP THE TOUR</button>
          {step > 0 && <button type="button" className="utility-btn" style={btn} onClick={onBack}>BACK</button>}
          <button ref={next} type="button" className="utility-btn active" style={btn} onClick={onNext}>{last ? 'DONE' : 'NEXT'}</button>
        </span>
      </div>
    </div>
  );
}
