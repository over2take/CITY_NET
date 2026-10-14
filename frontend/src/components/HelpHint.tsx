import React, { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { themeRoot } from '../utils/themeRoot';

// The "?" beside a builder setting (4i; approved mockup docs/mockups/builder-help.html,
// 2026-10-13): what the setting does, shown on hover and on keyboard focus rather than as the
// browser's slow native tooltip, in the theme's colors. The words come from sheets/builderHelp.ts.
//
// The popover is drawn in the theme's root at a fixed place beside the "?", so a scrolling panel
// can't clip it, and moves to the left of the "?" when there's no room on the right.

/** How wide the popover is, and the gap between it and the "?". */
export const POP_WIDTH = 260;
const GAP = 8;

/** Where the popover goes for a "?" at `rect` on a screen `screenWidth` wide. */
export const popoverPlace = (rect: { left: number; right: number; top: number }, screenWidth: number) => {
  const right = rect.right + GAP;
  const left = right + POP_WIDTH <= screenWidth - GAP ? right : Math.max(GAP, rect.left - GAP - POP_WIDTH);
  return { left, top: Math.max(GAP, rect.top - 4) };
};

export function HelpHint({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const show = () => { if (ref.current) setAt(popoverPlace(ref.current.getBoundingClientRect(), window.innerWidth)); };
  const hide = () => setAt(null);

  return (
    <span
      ref={ref}
      role="note"
      tabIndex={0}
      aria-label={text}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => { if (e.key === 'Escape' && at) { e.stopPropagation(); hide(); } }}
      style={{
        display: 'inline-grid', placeItems: 'center', width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
        border: '1px solid currentColor', fontSize: 9, lineHeight: 1, cursor: 'help', opacity: 0.8,
        fontFamily: 'monospace', verticalAlign: 'middle',
      }}
    >
      ?
      {at && createPortal(
        <span role="tooltip" style={{
          position: 'fixed', left: at.left, top: at.top, width: POP_WIDTH, zIndex: 3000, boxSizing: 'border-box',
          background: 'var(--black)', border: '1px solid var(--cyan)', color: 'var(--text)', padding: '8px 10px',
          fontSize: 12, lineHeight: 1.45, letterSpacing: 0, textAlign: 'left', textTransform: 'none',
          boxShadow: '0 4px 18px color-mix(in srgb, var(--black) 70%, transparent)', pointerEvents: 'none',
        }}>{text}</span>,
        themeRoot(),
      )}
    </span>
  );
}

/**
 * A table's column header with its "?". The header is named by its word alone, so the "?"'s words
 * aren't read out with every cell under it.
 */
export function ColumnHead({ hint, style, children }: { hint?: string; style?: CSSProperties; children?: string }) {
  return (
    <th scope="col" aria-label={hint ? children : undefined} style={style}>
      {hint ? <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>{children}<HelpHint text={hint} /></span> : children}
    </th>
  );
}

/**
 * A setting's name with its "?" after it. The "?" stays outside the <label>: inside, its words would
 * be read as part of the field's name. `htmlFor` ties the name to its field, when it has one.
 */
export function FieldName({ htmlFor, hint, style, children }: { htmlFor?: string; hint: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
      {htmlFor ? <label htmlFor={htmlFor} style={style}>{children}</label> : <span style={style}>{children}</span>}
      <HelpHint text={hint} />
    </span>
  );
}