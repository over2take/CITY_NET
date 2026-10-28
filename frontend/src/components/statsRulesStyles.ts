import type React from 'react';

// The look of STATS & RULES' controls (statsRulesFields.tsx), shared by FORMS and the graph view's
// node panel. Its own file so the components file exports components only (fast refresh).

export const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
export const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85 };
export const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };
export const field: React.CSSProperties = {
  background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--green)', fontFamily: 'monospace', fontSize: 12, padding: '5px 7px', minWidth: 0, boxSizing: 'border-box',
};
export const th: React.CSSProperties = { textAlign: 'left', ...small, fontWeight: 'normal', padding: '6px 8px 4px 10px' };
export const td: React.CSSProperties = { padding: '3px 8px 3px 10px', verticalAlign: 'middle', borderTop: '1px solid color-mix(in srgb, var(--dark-green) 60%, transparent)' };
export const box: React.CSSProperties = { border: '1px solid var(--dark-green)', marginBottom: 12 };
export const head: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid var(--dark-green)', background: 'color-mix(in srgb, var(--green) 8%, transparent)', flexWrap: 'wrap' };
