import React, { useState, useEffect } from 'react';
import type { SheetTemplate, SheetSection, SheetField, SheetData } from '../sheets';

function DiceIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 80 80"
      width={size}
      height={size}
      style={{ display: 'inline-block', verticalAlign: 'middle', color: 'var(--green)', flexShrink: 0 }}
      aria-hidden="true"
    >
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4">
        <path d="M12.657 39.284a8 8 0 0 1 0-11.314L23.97 16.657a8 8 0 0 1 11.314 0L46.598 27.97a8 8 0 0 1 0 11.314L35.284 50.598a8 8 0 0 1-11.314 0z" />
        <path d="M16.428 34.57a2.667 2.667 0 1 1 3.771-3.77a2.667 2.667 0 0 1-3.771 3.77M26.8 24.2a2.667 2.667 0 1 1 3.77-3.772a2.667 2.667 0 0 1-3.77 3.771m1.884 22.628a2.667 2.667 0 1 1 3.772-3.771a2.667 2.667 0 0 1-3.772 3.77m10.372-10.37a2.667 2.667 0 1 1 3.77-3.772a2.667 2.667 0 0 1-3.77 3.772m-1.56 11.931l-1.394 5.2a8 8 0 0 0 5.657 9.798l15.455 4.14a8 8 0 0 0 9.798-5.656l4.14-15.455a8 8 0 0 0-5.656-9.798l-15.455-4.141a8 8 0 0 0-1.22-.228" />
        <path d="M60.378 42.836a2.667 2.667 0 1 1 5.152 1.38a2.667 2.667 0 0 1-5.152-1.38M41.725 55.783a2.667 2.667 0 1 1 5.152 1.38a2.667 2.667 0 0 1-5.152-1.38" />
      </g>
    </svg>
  );
}

// Renders any game-system template. One renderer for every system - the
// template data decides what appears.
//
// Layout (matches the agreed style baseline):
//   [ identity header: bracket portrait / name / subtitle / HP bar / chips ]
//   [ scrollable sections for the active tab ]
//   [ bottom tab bar: STATS / SKILLS / GEAR / NOTES ]

interface SheetRendererProps {
  template: SheetTemplate;
  data: SheetData;
  readOnly?: boolean;
  onFieldChange: (fieldId: string, value: string | number) => void;
  portraitUrl?: string | null;
  /** Called with the selected File when the player wants to change their portrait. */
  onPortraitUpload?: (file: File) => void;
  /** In-app only: linked fields (token HP, bank cash) open their own window
   *  when clicked. Absent on the standalone tab - values still display live. */
  onOpenLink?: (source: NonNullable<SheetField['source']>) => void;
  /** Roll a rollable field. The server resolves the formula against the
   *  stored sheet - the client only names the field. luck = declared LUCK
   *  spend for this roll (armed on the sheet, consumed server-side). */
  onRoll?: (fieldId: string, luck?: number, negateFumble?: boolean) => void;
  /** House-rule gate: show the 1-LUCK fumble shield control. Off = a natural
   *  1 always fumbles and the button is hidden. */
  allowFumbleShield?: boolean;
  /** Roll a death save (shown at 0 HP when the template defines deathSave).
   *  Server-resolved: 1d10 + tracked penalty vs the save stat. */
  onDeathSave?: () => void;
  /** Roll a stabilization check (shown at 0 HP when the template sets
   *  stabilize). Server-resolved: the clicking user's Heal check vs a DC
   *  that rises each failed round. */
  onStabilize?: () => void;
  /** Tabs hidden by house rules (e.g. CWN DELUXE while cwn_deluxe is off).
   *  Their sections are not rendered. */
  hiddenTabs?: string[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const inputStyle: React.CSSProperties = {
  background: 'rgba(0, 20, 0, 0.5)',
  border: '1px solid var(--green)',
  color: 'var(--green)',
  fontFamily: 'inherit',
  fontSize: '0.75rem',
  padding: '3px 6px',
  width: '100%',
  boxSizing: 'border-box',
};

function FieldInput({ field, data, readOnly, onFieldChange, style, onOpenLink }: {
  field: SheetField; data: SheetData; readOnly: boolean;
  onFieldChange: (fieldId: string, value: string | number) => void;
  style?: React.CSSProperties;
  onOpenLink?: (source: NonNullable<SheetField['source']>) => void;
}) {
  const value = data[field.id] ?? '';
  if (field.source) {
    // Linked field: value lives in another system (bank, token HP). Display
    // only - clicking jumps to the window that owns it, when available.
    const clickable = !!onOpenLink;
    return (
      <div
        role={clickable ? 'button' : undefined}
        title={clickable ? 'Open linked window' : 'Synced from the linked system'}
        onClick={clickable ? () => onOpenLink!(field.source!) : undefined}
        style={{
          ...inputStyle, border: '1px dashed var(--green)', cursor: clickable ? 'pointer' : 'default',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', ...style,
        }}
      >
        <span>{value === '' || value === null || value === undefined ? '—' : String(value)}</span>
        <span style={{ opacity: 0.6, fontSize: '0.6rem' }}>{clickable ? '⇗ LINKED' : 'LINKED'}</span>
      </div>
    );
  }
  if (field.type === 'select') {
    return (
      <select
        aria-label={field.label}
        className="sheet-input"
        style={{ ...inputStyle, ...style }}
        value={String(value)}
        disabled={readOnly}
        onChange={(e) => onFieldChange(field.id, e.target.value)}
      >
        <option value="">—</option>
        {(field.options ?? []).map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }
  if (field.type === 'textarea') {
    return (
      <textarea
        aria-label={field.label}
        className="sheet-input"
        style={{ ...inputStyle, minHeight: '60px', resize: 'vertical', ...style }}
        value={String(value)}
        placeholder={field.placeholder}
        readOnly={readOnly}
        onChange={(e) => onFieldChange(field.id, e.target.value)}
      />
    );
  }
  const isNumber = field.type === 'number';
  // Number fields default to 0 - an untouched sheet reads as all zeroes,
  // not blanks. Fields with a placeholder stay blank so the example shows.
  const display = value === null || value === undefined || value === ''
    ? (isNumber && !field.placeholder ? '0' : '')
    : String(value);
  return (
    <input
      aria-label={field.label}
      type={isNumber ? 'number' : 'text'}
      className="sheet-input"
      style={{ ...inputStyle, ...style }}
      value={display}
      placeholder={field.placeholder}
      readOnly={readOnly}
      onFocus={isNumber ? (e) => e.target.select() : undefined}
      onChange={(e) => onFieldChange(field.id, isNumber ? Number(e.target.value) : e.target.value)}
    />
  );
}

// Targeting-bracket portrait frame - the visual identity of the sheet system.
// Uploaded portraits get a CSS take on the signs' TV shader: scanlines,
// R/B chromatic fringe, and an intermittent glitch jitter.
const PORTRAIT_HINT = 'Best results: a square image, 400×400px or larger. JPG / PNG / WebP / GIF, max 8MB.';

function BracketPortrait({ initial, portraitUrl, size = 64, onUpload }: { initial: string; portraitUrl?: string | null; size?: number; onUpload?: (file: File) => void }) {
  const b = Math.max(9, Math.round(size * 0.18));
  const corner = (pos: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute', width: `${b}px`, height: `${b}px`, ...pos,
  });
  const imgStyle: React.CSSProperties = {
    position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover',
  };
  const frame = (
    <div style={{ position: 'relative', width: `${size}px`, height: `${size}px`, background: 'rgba(0, 20, 0, 0.6)', flex: '0 0 auto', overflow: 'hidden' }}>
      {portraitUrl ? (
        <div className="portrait-tv" style={{ position: 'absolute', inset: 0 }}>
          {/* Chromatic fringe: R and B copies offset either side of the base */}
          <img src={portraitUrl} alt="" aria-hidden style={{ ...imgStyle, filter: 'url(#portrait-red)', transform: 'translateX(1.5px)', mixBlendMode: 'screen', opacity: 0.85 }} />
          <img src={portraitUrl} alt="" aria-hidden style={{ ...imgStyle, filter: 'url(#portrait-blue)', transform: 'translateX(-1.5px)', mixBlendMode: 'screen', opacity: 0.85 }} />
          <img src={portraitUrl} alt="portrait" style={{ ...imgStyle, mixBlendMode: 'screen' }} />
          {/* Scanlines + rolling refresh band */}
          <div className="portrait-scanlines" />
          <div className="portrait-rollband" />
          {/* SVG color-isolation filters for the fringe layers */}
          <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
            <filter id="portrait-red"><feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" /></filter>
            <filter id="portrait-blue"><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" /></filter>
          </svg>
        </div>
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--green)', fontSize: `${Math.round(size * 0.38)}px`, letterSpacing: '1px' }}>
          {initial}
        </div>
      )}
      <div style={corner({ top: 0, left: 0, borderTop: '2px solid var(--green)', borderLeft: '2px solid var(--green)' })} />
      <div style={corner({ top: 0, right: 0, borderTop: '2px solid var(--green)', borderRight: '2px solid var(--green)' })} />
      <div style={corner({ bottom: 0, left: 0, borderBottom: '2px solid var(--green)', borderLeft: '2px solid var(--green)' })} />
      <div style={corner({ bottom: 0, right: 0, borderBottom: '2px solid var(--green)', borderRight: '2px solid var(--green)' })} />
    </div>
  );
  if (!onUpload) return frame;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: '0 0 auto' }}>
      {frame}
      <label title={PORTRAIT_HINT} style={{
        cursor: 'pointer', background: 'rgba(0, 0, 0, 0.85)',
        border: '1px solid var(--green)', borderTop: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '4px 6px', userSelect: 'none',
      }}>
        <input
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }}
        />
        <span style={{ fontSize: '9px', letterSpacing: '1px', color: 'var(--green)', fontWeight: 600, whiteSpace: 'nowrap' }}>UPLOAD → ≥400PX · MAX 8MB</span>
      </label>
    </div>
  );
}

function SheetHeaderBlock({ template, data, portraitUrl, onPortraitUpload, onOpenLink, onFieldChange, onDeathSave, onStabilize, armedLuck, setArmedLuck, armedNegate, setArmedNegate, allowFumbleShield, canRoll }: {
  template: SheetTemplate; data: SheetData; portraitUrl?: string | null;
  onPortraitUpload?: (file: File) => void;
  onOpenLink?: (source: NonNullable<SheetField['source']>) => void;
  onFieldChange: (fieldId: string, value: string | number) => void;
  onDeathSave?: () => void;
  onStabilize?: () => void;
  /** LUCK armed for the next roll (declared before rolling, per CP:R). */
  armedLuck?: number;
  setArmedLuck?: (n: number) => void;
  /** 1-LUCK fumble shield armed for the next roll (no bonus, negates nat-1). */
  armedNegate?: boolean;
  setArmedNegate?: (v: boolean) => void;
  allowFumbleShield?: boolean;
  canRoll?: boolean;
}) {
  const h = template.header;
  if (!h) return null;
  const name = String(data[h.nameField] ?? '').trim();
  const subtitle = (h.subtitleFields ?? [])
    .map(f => String(data[f] ?? '').trim())
    .filter(Boolean)
    .join(' · ');
  const hp = h.hpField ? num(data[h.hpField]) : null;
  const hpMax = h.hpMaxField ? num(data[h.hpMaxField]) : null;
  const hpPct = hp !== null && hpMax ? Math.max(0, Math.min(100, (hp / hpMax) * 100)) : 0;

  return (
    <div style={{ display: 'flex', gap: '12px', padding: '10px 2px 8px' }}>
      <BracketPortrait initial={(name || '?').charAt(0).toUpperCase()} portraitUrl={portraitUrl} size={192} onUpload={onPortraitUpload} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '1rem', color: 'var(--green)', letterSpacing: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name ? name.toUpperCase() : 'UNNAMED'}
        </div>
        {subtitle && (
          <div style={{ fontSize: '0.65rem', opacity: 0.65, marginTop: '1px', letterSpacing: '1px' }}>{subtitle.toUpperCase()}</div>
        )}
        {h.hpField && (() => {
          // One segment per max HP point; color shifts as health drops
          const max = hpMax ?? 0;
          const cur = Math.max(0, Math.min(hp ?? 0, max));
          const ratio = max > 0 ? cur / max : 0;
          const hpColor = ratio > 0.5 ? 'var(--green)' : ratio > 0.25 ? '#ffcc00' : '#ff3333';
          return (
            <div
              role={onOpenLink ? 'button' : undefined}
              title={onOpenLink ? 'Synced with your token — click to open HIT_POINTS' : 'Synced with your token'}
              onClick={onOpenLink ? () => onOpenLink('token_hp') : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', cursor: onOpenLink ? 'pointer' : 'default' }}
            >
              <span style={{ fontSize: '0.6rem', opacity: 0.65 }}>HP</span>
              <div style={{ flex: 1, display: 'flex', gap: max > 40 ? '1px' : '2px', height: '12px', border: `1px solid ${hpColor}`, background: 'rgba(0, 20, 0, 0.6)', padding: '1px', transition: 'border-color 0.3s' }}>
                {max > 0 ? Array.from({ length: max }, (_, i) => (
                  <div
                    key={i}
                    style={{
                      flex: 1, height: '100%',
                      background: i < cur ? hpColor : 'transparent',
                      transition: 'background 0.2s',
                    }}
                  />
                )) : (
                  <div style={{ width: `${hpPct}%`, height: '100%', background: 'var(--green)' }} />
                )}
              </div>
              <span style={{ fontSize: '0.65rem', color: hpColor, transition: 'color 0.3s' }}>{hp ?? 0}/{hpMax ?? 0}</span>
            </div>
          );
        })()}
        {template.deathSave && h.hpField && (hpMax ?? 0) > 0 && (hp ?? 1) <= 0 && (() => {
          const ds = template.deathSave!;
          const body = num(data[ds.statField]);
          const penalty = num(data[ds.penaltyField]);
          return (
            <div style={{
              marginTop: '6px', border: '1px solid #ff3333', background: 'rgba(60, 0, 0, 0.45)',
              padding: '5px 8px', display: 'flex', flexDirection: 'column', gap: '4px',
            }}>
              <span style={{ color: '#ff3333', fontSize: '0.7rem', letterSpacing: '2px', fontWeight: 600, animation: 'death-pulse 1.2s ease-in-out infinite' }}>
                ⚠ MORTALLY WOUNDED
              </span>
              <span style={{ color: '#ff3333', fontSize: '0.6rem', opacity: 0.85, letterSpacing: '1px' }}>
                1d10{penalty > 0 ? ` +${penalty}` : ''} vs BODY {body} — roll every turn until stabilized
              </span>
              <button
                onClick={onDeathSave}
                disabled={!onDeathSave}
                title="First Aid or Paramedic check (DV15) stabilizes; healing above 0 HP clears this."
                style={{
                  alignSelf: 'center', background: 'none', border: '1px solid #ff3333', color: '#ff3333',
                  fontFamily: 'inherit', fontSize: '0.65rem', letterSpacing: '1px', padding: '3px 10px',
                  cursor: onDeathSave ? 'pointer' : 'default', opacity: onDeathSave ? 1 : 0.5,
                  display: 'flex', alignItems: 'center', gap: '4px',
                }}
              >
                DEATH SAVE
              </button>
            </div>
          );
        })()}
        {template.stabilize && h.hpField && (hpMax ?? 0) > 0 && (hp ?? 1) <= 0 && (() => {
          const rounds = num(data.rounds_since_downed);
          const frail = num(data.frail) === 1;
          return (
            <div style={{
              marginTop: '6px', border: '1px solid #ff3333', background: 'rgba(60, 0, 0, 0.45)',
              padding: '5px 8px', display: 'flex', flexDirection: 'column', gap: '4px',
            }}>
              <span style={{ color: '#ff3333', fontSize: '0.7rem', letterSpacing: '2px', fontWeight: 600, animation: 'death-pulse 1.2s ease-in-out infinite' }}>
                ⚠ {frail ? 'FRAIL — DEAD AT 0 HP' : 'MORTALLY WOUNDED'}
              </span>
              {!frail && (
                <>
                  <span style={{ color: '#ff3333', fontSize: '0.6rem', opacity: 0.85, letterSpacing: '1px' }}>
                    Dead in {Math.max(0, 6 - rounds)} rounds — 2d6 + Heal + INT vs DC {8 + rounds}, rising each round
                  </span>
                  <button
                    onClick={onStabilize}
                    disabled={!onStabilize}
                    title="An ally's Main Action: Heal check vs 8 + rounds down (+2 without tools). Success: 1 HP and the Frail condition."
                    style={{
                      alignSelf: 'center', background: 'none', border: '1px solid #ff3333', color: '#ff3333',
                      fontFamily: 'inherit', fontSize: '0.65rem', letterSpacing: '1px', padding: '3px 10px',
                      cursor: onStabilize ? 'pointer' : 'default', opacity: onStabilize ? 1 : 0.5,
                      display: 'flex', alignItems: 'center', gap: '4px',
                    }}
                  >
                    STABILIZE
                  </button>
                </>
              )}
            </div>
          );
        })()}
        {template.stabilize && h.hpField && (hp ?? 0) > 0 && num(data.frail) === 1 && (
          <div style={{
            marginTop: '6px', border: '1px solid #ffcc00', background: 'rgba(60, 45, 0, 0.4)',
            padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: '4px',
          }}>
            <span style={{ color: '#ffcc00', fontSize: '0.7rem', letterSpacing: '2px', fontWeight: 600, animation: 'wound-pulse 1.6s ease-in-out infinite' }}>
              ⚠ FRAIL
            </span>
            <span style={{ color: '#ffcc00', fontSize: '0.6rem', opacity: 0.85, letterSpacing: '1px' }}>
              Hitting 0 HP again is instant death — cleared by a week of care or medical treatment
            </span>
            <button
              onClick={() => onFieldChange('frail', 0)}
              disabled={false}
              title="Click when the GM confirms the recovery conditions are met (a week of bedrest and care, or successful medical treatment)."
              style={{
                alignSelf: 'center', background: 'none', border: '1px solid #ffcc00', color: '#ffcc00',
                fontFamily: 'inherit', fontSize: '0.65rem', letterSpacing: '1px', padding: '3px 10px',
                cursor: 'pointer',
              }}
            >
              CLEAR FRAIL (GM APPROVED)
            </button>
          </div>
        )}
        {template.deathSave && h.hpField && (hp ?? 0) > 0 && num(data.seriously_wounded) > 0 && (hp ?? 0) <= num(data.seriously_wounded) && (
          <div style={{
            marginTop: '6px', border: '1px solid #ffcc00', background: 'rgba(60, 45, 0, 0.4)',
            padding: '4px 8px', display: 'flex', flexDirection: 'column', gap: '2px',
          }}>
            <span style={{ color: '#ffcc00', fontSize: '0.7rem', letterSpacing: '2px', fontWeight: 600, animation: 'wound-pulse 1.6s ease-in-out infinite' }}>
              ⚠ SERIOUSLY WOUNDED
            </span>
            <span style={{ color: '#ffcc00', fontSize: '0.6rem', opacity: 0.85, letterSpacing: '1px' }}>
              −2 to all checks (applied automatically)
            </span>
          </div>
        )}
        {h.chips && h.chips.length > 0 && (
          <div style={{ display: 'flex', gap: '10px', marginTop: '5px', fontSize: '0.65rem' }}>
            {h.chips.map(c => (
              <span key={c.field} style={{ opacity: 0.8 }}>
                <span style={{ opacity: 0.65 }}>{c.label} </span>
                <span style={{ color: 'var(--green)' }}>{num(data[c.field])}</span>
              </span>
            ))}
          </div>
        )}
        {h.luckField && (() => {
          const luckCur = num(data[h.luckField!]) ?? 0;
          const luckMax = h.luckMaxField ? (num(data[h.luckMaxField]) ?? 0) : luckCur;
          const pips = Math.max(0, luckMax);
          if (pips === 0) return null;
          const hexSize = 20;
          const hexPoints = Array.from({ length: 6 }, (_, i) => {
            const angle = (Math.PI / 3) * i - Math.PI / 6;
            const r = hexSize / 2 - 1.5;
            return `${hexSize / 2 + r * Math.cos(angle)},${hexSize / 2 + r * Math.sin(angle)}`;
          }).join(' ');
          const negate = !!(allowFumbleShield && armedNegate && luckCur >= 1);
          const armed = Math.min(armedLuck ?? 0, Math.max(0, luckCur - (negate ? 1 : 0)));
          const committed = armed + (negate ? 1 : 0);
          const arming = !!(canRoll && setArmedLuck);
          return (
            <div style={{ marginTop: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.7rem', opacity: 0.65, letterSpacing: '0.5px' }}>LUCK</span>
                <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                  {Array.from({ length: pips }, (_, i) => {
                    const filled = i < luckCur;
                    // The last `armed` filled pips light up amber: committed to the next roll
                    const isArmed = filled && i >= luckCur - committed;
                    const color = isArmed ? '#ffcc00' : 'var(--green)';
                    return (
                      <button
                        key={i}
                        aria-label={filled ? `LUCK ${i + 1} of ${pips}${isArmed ? ' (armed)' : ''}` : `LUCK spent (${i + 1} of ${pips})`}
                        title={!arming ? undefined : filled ? (isArmed ? 'Click to disarm' : 'Arm 1 LUCK for the next roll') : 'LUCK spent'}
                        onClick={() => {
                          if (!arming || !filled) return;
                          setArmedLuck!(isArmed ? Math.max(0, armed - 1) : Math.min(luckCur - (negate ? 1 : 0), armed + 1));
                        }}
                        style={{ padding: 0, background: 'none', border: 'none', cursor: arming && filled ? 'pointer' : 'default', display: 'flex', appearance: 'none' }}
                      >
                        <svg width={hexSize} height={hexSize} viewBox={`0 0 ${hexSize} ${hexSize}`} style={{ transition: 'opacity 0.1s', opacity: filled ? 1 : 0.35 }}>
                          <polygon
                            points={hexPoints}
                            fill={filled ? color : 'transparent'}
                            stroke={color}
                            strokeWidth="1.5"
                          />
                        </svg>
                      </button>
                    );
                  })}
                </div>
                <span style={{ fontSize: '0.7rem', color: 'var(--green)', opacity: 0.85 }}>{luckCur}/{pips}</span>
              </div>
              {arming && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '3px', flexWrap: 'wrap' }}>
                  {allowFumbleShield && setArmedNegate && luckCur > 0 && (
                    <button
                      onClick={() => setArmedNegate!(!negate)}
                      title="Burn 1 LUCK so a natural 1 on the next roll is not a critical fumble. No bonus to the roll."
                      style={{
                        background: negate ? '#ffcc00' : 'none', border: '1px solid #ffcc00',
                        color: negate ? '#000' : '#ffcc00', fontFamily: 'inherit',
                        fontSize: '0.55rem', letterSpacing: '1px', padding: '1px 6px', cursor: 'pointer',
                      }}
                    >
                      {negate ? '✓ ' : ''}FUMBLE SHIELD (1 LUCK)
                    </button>
                  )}
                  {committed > 0 && (
                    <>
                      <span style={{ fontSize: '0.62rem', color: '#ffcc00', letterSpacing: '1px' }}>
                        NEXT ROLL{armed > 0 ? ` +${armed}` : ''}{negate ? ' · NAT-1 NEGATED' : ''} · COST {committed} LUCK
                      </span>
                      <button
                        onClick={() => { setArmedLuck!(0); setArmedNegate?.(false); }}
                        style={{ background: 'none', border: '1px solid #ffcc00', color: '#ffcc00', fontFamily: 'inherit', fontSize: '0.55rem', padding: '1px 6px', cursor: 'pointer' }}
                      >
                        CLEAR
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function GridSection({ section, data, readOnly, onFieldChange, onRoll }: {
  section: SheetSection; data: SheetData; readOnly: boolean;
  onFieldChange: (fieldId: string, value: string | number) => void;
  onRoll?: (fieldId: string) => void;
}) {
  // maxField pairs render inside their base field's cell as CUR / MAX
  const maxIds = new Set(section.fields.filter(f => f.maxField).map(f => f.maxField as string));
  const visible = section.fields.filter(f => !maxIds.has(f.id));
  const numInput: React.CSSProperties = { textAlign: 'center', fontSize: '0.95rem', padding: '2px', background: 'transparent', border: 'none' };
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(82px, 1fr))', gap: '6px' }}>
      {visible.map((field) => {
        const maxField = field.maxField ? section.fields.find(f => f.id === field.maxField) : undefined;
        return (
          <div key={field.id} title={field.hint} style={{ border: '1px solid var(--green)', background: 'rgba(0, 20, 0, 0.35)', textAlign: 'center', display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: '0.55rem', opacity: 0.65, letterSpacing: '1px', padding: '4px 2px 0' }}>{field.label}</div>
            {maxField ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', padding: '0 2px' }}>
                  <FieldInput field={field} data={data} readOnly={readOnly} onFieldChange={onFieldChange} style={numInput} />
                  <span style={{ opacity: 0.5 }}>/</span>
                  <FieldInput field={maxField} data={data} readOnly={readOnly} onFieldChange={onFieldChange} style={numInput} />
                </div>
                <div style={{ display: 'flex', fontSize: '0.45rem', opacity: 0.5, letterSpacing: '1px', padding: '0 6px 2px' }}>
                  <span style={{ flex: 1 }}>CUR</span>
                  <span style={{ flex: 1 }}>MAX</span>
                </div>
              </>
            ) : (
              <FieldInput field={field} data={data} readOnly={readOnly} onFieldChange={onFieldChange} style={numInput} />
            )}
            {field.roll && (
              <button
                onClick={onRoll ? () => onRoll(field.id) : undefined}
                disabled={!onRoll}
                aria-label={`Roll ${field.roll.label}`}
                title={onRoll ? `Roll ${field.roll.label}` : 'Roll'}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px',
                  width: '100%', marginTop: 'auto',
                  borderTop: '1px solid var(--green)', borderLeft: 'none', borderRight: 'none', borderBottom: 'none',
                  background: 'none', fontSize: '0.6rem', padding: '3px 0', color: 'var(--green)',
                  opacity: onRoll ? 0.9 : 0.5, cursor: onRoll ? 'pointer' : 'default', fontFamily: 'inherit',
                }}
              >
                <DiceIcon size={12} /> ROLL
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SkillsSection({ section, data, readOnly, onFieldChange, onRoll }: {
  section: SheetSection; data: SheetData; readOnly: boolean;
  onFieldChange: (fieldId: string, value: string | number) => void;
  onRoll?: (fieldId: string) => void;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '2px 12px' }}>
      {section.fields.map((field) => {
        const lvl = num(data[field.id]);
        const base = lvl + (field.stat ? num(data[field.stat]) : 0);
        return (
          <div key={field.id} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '1px 4px', background: lvl > 0 ? 'rgba(0, 40, 0, 0.45)' : 'transparent' }}>
            <span style={{ flex: 1, fontSize: '0.68rem', opacity: lvl > 0 ? 1 : 0.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {field.label}{lvl > 0 ? ' ●' : ''}
            </span>
            <input
              aria-label={field.label}
              type="number"
              className="sheet-input"
              style={{ ...inputStyle, width: '30px', textAlign: 'center', padding: '1px 2px', background: 'transparent' }}
              value={data[field.id] === null || data[field.id] === undefined || data[field.id] === '' ? '0' : String(data[field.id])}
              readOnly={readOnly}
              onFocus={(e) => e.target.select()}
              onChange={(e) => onFieldChange(field.id, Number(e.target.value))}
            />
            <button
              onClick={onRoll && field.roll ? () => onRoll(field.id) : undefined}
              disabled={!onRoll || !field.roll}
              aria-label={`Roll ${field.label}`}
              title={onRoll && field.roll ? `Roll ${field.label} (1d10 ${base >= 0 ? '+' : ''}${base})` : 'BASE = level + stat'}
              style={{
                fontSize: '0.68rem', minWidth: '46px', textAlign: 'right', color: 'var(--green)',
                background: 'none', border: 'none', padding: 0, fontFamily: 'inherit',
                cursor: onRoll && field.roll ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', gap: '2px',
              }}
            >
              {base >= 0 ? `+${base}` : base} <DiceIcon size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// Structured weapon rows: every N consecutive fields form one weapon, where
// N is section.columns (default 4, CP:R's name/dmg/skill/rof). Headers come
// from the first row's field labels.
function WeaponsSection({ section, data, readOnly, onFieldChange }: {
  section: SheetSection; data: SheetData; readOnly: boolean;
  onFieldChange: (fieldId: string, value: string | number) => void;
}) {
  const perRow = section.columns ?? 4;
  const rows: SheetField[][] = [];
  for (let i = 0; i < section.fields.length; i += perRow) rows.push(section.fields.slice(i, i + perRow));
  const cell: React.CSSProperties = { padding: '2px 4px', fontSize: '0.7rem' };
  // CP:R keeps its hand-tuned column widths; other row shapes get a generic
  // grid: name column flexes, selects get room, the rest stay compact.
  const gridTemplateColumns = perRow === 4
    ? '1fr 70px 130px 44px'
    : (rows[0] ?? []).map((f, i) => (i === 0 ? '1fr' : f.type === 'select' ? '90px' : '56px')).join(' ');
  return (
    <div style={{ display: 'grid', gridTemplateColumns, gap: '3px 4px', alignItems: 'center' }}>
      {(rows[0] ?? []).map(f => (
        <div key={f.id} style={{ fontSize: '0.55rem', opacity: 0.65, letterSpacing: '1px', padding: '0 4px' }}>{f.label}</div>
      ))}
      {rows.map((row) => (
        <React.Fragment key={row[0].id}>
          {row.map((field) => (
            <FieldInput
              key={field.id}
              field={field}
              data={data}
              readOnly={readOnly}
              onFieldChange={onFieldChange}
              style={{ ...cell, ...(field.type === 'number' ? { textAlign: 'center' } : null) }}
            />
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

function ListSection({ section, data, readOnly, onFieldChange, onOpenLink }: {
  section: SheetSection; data: SheetData; readOnly: boolean;
  onFieldChange: (fieldId: string, value: string | number) => void;
  onOpenLink?: (source: NonNullable<SheetField['source']>) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {section.fields.map((field) => (
        <div key={field.id} title={field.hint}>
          <div style={{ fontSize: '0.6rem', opacity: 0.65, letterSpacing: '1px', marginBottom: '2px' }}>{field.label}</div>
          <FieldInput field={field} data={data} readOnly={readOnly} onFieldChange={onFieldChange} onOpenLink={onOpenLink} />
        </div>
      ))}
    </div>
  );
}

export function SheetRenderer({ template, data, readOnly = false, onFieldChange, portraitUrl, onPortraitUpload, onOpenLink, onRoll, onDeathSave, onStabilize, allowFumbleShield = false, hiddenTabs }: SheetRendererProps) {
  const tabs = (template.tabs ?? ['SHEET']).filter(t => !hiddenTabs?.includes(t));
  const [activeTab, setActiveTab] = useState(tabs[0]);
  // If the active tab gets hidden (house rule toggled off), fall back to the
  // first visible one.
  useEffect(() => {
    if (!tabs.includes(activeTab) && tabs.length > 0) setActiveTab(tabs[0]);
  }, [tabs.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  // LUCK declared for the next roll (CP:R: declare before rolling; any spend
  // also negates a natural-1 fumble). Consumed and reset by the next roll.
  const [armedLuck, setArmedLuck] = useState(0);
  const [armedNegate, setArmedNegate] = useState(false);
  const handleRoll = onRoll
    ? (fieldId: string) => {
        onRoll(fieldId, armedLuck > 0 ? armedLuck : undefined, armedNegate || undefined);
        setArmedLuck(0);
        setArmedNegate(false);
      }
    : undefined;
  const [closedSections, setClosedSections] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    setClosedSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const sectionsForTab = template.sections.filter(s => (s.tab ?? tabs[0]) === activeTab);
  const tabHasRolls = sectionsForTab.some(s => s.fields.some(f => f.roll));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <style>{`
        .sheet-input::-webkit-outer-spin-button, .sheet-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        .sheet-input[type=number] { -moz-appearance: textfield; appearance: textfield; }
        .sheet-input:focus { outline: 1px solid var(--green); }
        .sheet-input::placeholder { color: var(--green); opacity: 0.3; font-style: italic; }

        /* TV portrait: intermittent glitch jitter — idle most of the cycle */
        .portrait-tv { animation: portrait-glitch 4s infinite steps(1); }
        @keyframes portrait-glitch {
          0%, 91% { transform: none; filter: none; }
          92% { transform: translateX(2px) skewX(-1deg); }
          93% { transform: translateX(-2px); filter: brightness(1.3); }
          94% { transform: translateX(1px) skewX(0.5deg); }
          95%, 100% { transform: none; filter: none; }
        }
        .portrait-scanlines {
          position: absolute; inset: 0; pointer-events: none;
          background: repeating-linear-gradient(
            to bottom,
            rgba(0, 0, 0, 0) 0px, rgba(0, 0, 0, 0) 2px,
            rgba(0, 0, 0, 0.28) 2px, rgba(0, 0, 0, 0.28) 3px
          );
        }
        .portrait-rollband {
          position: absolute; left: 0; right: 0; height: 22%; pointer-events: none;
          background: linear-gradient(to bottom, rgba(255,255,255,0) 0%, rgba(255,255,255,0.07) 50%, rgba(255,255,255,0) 100%);
          animation: portrait-roll 6s linear infinite;
        }
        @keyframes portrait-roll {
          from { top: -25%; }
          to { top: 105%; }
        }
      `}</style>

      <SheetHeaderBlock template={template} data={data} portraitUrl={portraitUrl} onPortraitUpload={onPortraitUpload} onOpenLink={onOpenLink} onFieldChange={onFieldChange} onDeathSave={onDeathSave} onStabilize={onStabilize} armedLuck={armedLuck} setArmedLuck={setArmedLuck} armedNegate={armedNegate} setArmedNegate={setArmedNegate} allowFumbleShield={allowFumbleShield} canRoll={!!onRoll} />

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: '6px', paddingRight: '4px' }}>
        {tabHasRolls && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '4px', fontSize: '0.6rem', opacity: 0.55, letterSpacing: '1px' }}>
            {onRoll ? <>click <DiceIcon size={11} /> to roll</> : <>rolls land in the dice tray</>}
          </div>
        )}
        {sectionsForTab.map((section) => {
          const open = !closedSections.has(section.id);
          return (
            <div key={section.id}>
              <button
                onClick={() => toggle(section.id)}
                style={{
                  background: 'none', border: 'none', color: 'var(--green)', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: '0.62rem', letterSpacing: '2px', opacity: 0.7,
                  padding: '2px 0', width: '100%', textAlign: 'left',
                }}
              >
                {open ? '▾' : '▸'} ─── {section.label} ───
              </button>
              {open && (
                <div style={{ padding: '4px 0 6px' }}>
                  {section.layout === 'grid' && <GridSection section={section} data={data} readOnly={readOnly} onFieldChange={onFieldChange} onRoll={handleRoll} />}
                  {section.layout === 'skills' && <SkillsSection section={section} data={data} readOnly={readOnly} onFieldChange={onFieldChange} onRoll={handleRoll} />}
                  {section.layout === 'weapons' && <WeaponsSection section={section} data={data} readOnly={readOnly} onFieldChange={onFieldChange} />}
                  {(section.layout === 'list' || section.layout === 'notes') && <ListSection section={section} data={data} readOnly={readOnly} onFieldChange={onFieldChange} onOpenLink={onOpenLink} />}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {tabs.length > 1 && (
        <div style={{ display: 'flex', border: '1px solid var(--green)', borderBottom: 'none', marginTop: '8px', flex: '0 0 auto' }}>
          {tabs.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, padding: '7px 4px', background: activeTab === tab ? 'rgba(0, 60, 0, 0.5)' : 'none',
                border: 'none',
                borderRight: i < tabs.length - 1 ? '1px solid var(--green)' : 'none',
                color: 'var(--green)',
                fontFamily: 'inherit', fontSize: '0.62rem', letterSpacing: '1px', cursor: 'pointer',
                opacity: activeTab === tab ? 1 : 0.55,
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
