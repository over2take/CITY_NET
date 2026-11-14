import React, { useState } from 'react';

// A whole number that may be left blank, for "no end" (SPEND XP's UP TO, 7f2b; IMPROVE BY USE's, 7f3a2). Written when it
// is left or Enter is pressed, so typing 12 doesn't pass through 1; anything that isn't a whole number goes back to what
// it was. The caller keys it by its value, so a change made elsewhere shows.

interface Props {
  value: number | undefined;
  label: string;
  onChange: (next: number | null) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}

export function OptionalWhole({ value, label, onChange, placeholder = 'NO END', style }: Props) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const commit = () => {
    const t = text.trim();
    if (!t) onChange(null);
    else if (/^-?\d+$/.test(t)) onChange(Number(t));
    else setText(value === undefined ? '' : String(value));
  };
  return (
    <input type="text" inputMode="numeric" aria-label={label} value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} style={style} />
  );
}
