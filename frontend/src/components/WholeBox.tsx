import React, { useState } from 'react';

/** A whole number: kept as typed, written once it reads as one, and showing a change made from elsewhere. */
export function WholeBox({ value, label, width = 64, style, onChange }: { value: number; label: string; width?: number; style?: React.CSSProperties; onChange: (next: number) => void }) {
  const [text, setText] = useState(String(value));
  const read = /^-?\d+$/.test(text.trim()) ? Number(text) : null;
  return (
    <input type="text" inputMode="numeric" aria-label={label} value={read === null || read === value ? text : String(value)} aria-invalid={read === null ? true : undefined}
      style={{ fontFamily: 'monospace', fontSize: 12, padding: '3px 5px', width, background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--dark-green)', textAlign: 'center', ...style }}
      onChange={(e) => { setText(e.target.value); if (/^-?\d+$/.test(e.target.value.trim())) onChange(Number(e.target.value)); }} />
  );
}
