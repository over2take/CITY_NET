import React from 'react';

// One on/off switch for the whole app (switches 1; approved mockup docs/mockups/toggle-switch.html,
// 2026-10-29): a pill whose knob slides across and lights up when on, the label beside it, all of it
// one button. Asked for after LEVELLED on the builder's CHOICES page, drawn as plain text with a ○,
// went unseen as a control. Colors come from the theme, cyan unless the caller says otherwise.

/** A button's own attributes pass through (a title, a class, a click seen first), all but its role and state. */
interface Props extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'role' | 'type' | 'children' | 'name'> {
  on: boolean;
  /** Called with what the switch becomes. */
  onChange: (on: boolean) => void;
  /** Shown beside the pill, and its name. */
  label?: React.ReactNode;
  /** Its name when the words are elsewhere (a table's row): the screen reader's only. */
  name?: string;
  disabled?: boolean;
  /** A theme variable, `var(--cyan)` when none is given. */
  color?: string;
  style?: React.CSSProperties;
}

export function ToggleSwitch({ on, onChange, label, name, disabled, color = 'var(--cyan)', style, onClick, ...rest }: Props) {
  return (
    <button {...rest} type="button" role="switch" aria-checked={on} aria-label={name} disabled={disabled}
      onClick={(e) => { onClick?.(e); onChange(!on); }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8, justifySelf: 'start', alignSelf: 'center', background: 'none', border: 0, padding: 0,
        color, fontFamily: 'monospace', fontSize: 12, letterSpacing: 1, textAlign: 'left', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1, ...style,
      }}>
      <span aria-hidden data-toggle-track style={{
        position: 'relative', flexShrink: 0, width: 34, height: 18, borderRadius: 9, border: `1px solid ${color}`, boxSizing: 'border-box',
        background: on ? `color-mix(in srgb, ${color} 25%, transparent)` : 'none', transition: 'background 0.15s',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: on ? 18 : 2, width: 12, height: 12, borderRadius: '50%',
          background: on ? color : `color-mix(in srgb, ${color} 40%, transparent)`, transition: 'left 0.15s, background 0.15s',
        }} />
      </span>
      {label}
    </button>
  );
}
