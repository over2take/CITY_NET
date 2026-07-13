import React, { useState } from 'react';
import type { SheetTemplate, SheetSection, SheetField, SheetData } from '../sheets';

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
  /** In-app only: linked fields (token HP, bank cash) open their own window
   *  when clicked. Absent on the standalone tab - values still display live. */
  onOpenLink?: (source: NonNullable<SheetField['source']>) => void;
  /** Roll a rollable field. The server resolves the formula against the
   *  stored sheet - the client only names the field. */
  onRoll?: (fieldId: string) => void;
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
  if (field.type === 'textarea') {
    return (
      <textarea
        aria-label={field.label}
        className="sheet-input"
        style={{ ...inputStyle, minHeight: '60px', resize: 'vertical', ...style }}
        value={String(value)}
        readOnly={readOnly}
        onChange={(e) => onFieldChange(field.id, e.target.value)}
      />
    );
  }
  const isNumber = field.type === 'number';
  // Number fields default to 0 - an untouched sheet reads as all zeroes,
  // not blanks
  const display = value === null || value === undefined || value === ''
    ? (isNumber ? '0' : '')
    : String(value);
  return (
    <input
      aria-label={field.label}
      type={isNumber ? 'number' : 'text'}
      className="sheet-input"
      style={{ ...inputStyle, ...style }}
      value={display}
      readOnly={readOnly}
      onFocus={isNumber ? (e) => e.target.select() : undefined}
      onChange={(e) => onFieldChange(field.id, isNumber ? Number(e.target.value) : e.target.value)}
    />
  );
}

// Targeting-bracket portrait frame - the visual identity of the sheet system
function BracketPortrait({ initial, portraitUrl, size = 64 }: { initial: string; portraitUrl?: string | null; size?: number }) {
  const b = Math.max(9, Math.round(size * 0.18));
  const corner = (pos: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute', width: `${b}px`, height: `${b}px`, ...pos,
  });
  return (
    <div style={{ position: 'relative', width: `${size}px`, height: `${size}px`, background: 'rgba(0, 20, 0, 0.6)', flex: '0 0 auto' }}>
      {portraitUrl ? (
        <img src={portraitUrl} alt="portrait" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
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
}

function SheetHeaderBlock({ template, data, portraitUrl, onOpenLink }: {
  template: SheetTemplate; data: SheetData; portraitUrl?: string | null;
  onOpenLink?: (source: NonNullable<SheetField['source']>) => void;
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
      <BracketPortrait initial={(name || '?').charAt(0).toUpperCase()} portraitUrl={portraitUrl} size={68} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '1rem', color: 'var(--green)', letterSpacing: '1px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name ? name.toUpperCase() : 'UNNAMED'}
        </div>
        {subtitle && (
          <div style={{ fontSize: '0.65rem', opacity: 0.65, marginTop: '1px', letterSpacing: '1px' }}>{subtitle.toUpperCase()}</div>
        )}
        {h.hpField && (
          <div
            role={onOpenLink ? 'button' : undefined}
            title={onOpenLink ? 'Synced with your token — click to open HIT_POINTS' : 'Synced with your token'}
            onClick={onOpenLink ? () => onOpenLink('token_hp') : undefined}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', cursor: onOpenLink ? 'pointer' : 'default' }}
          >
            <span style={{ fontSize: '0.6rem', opacity: 0.65 }}>HP</span>
            <div style={{ flex: 1, height: '9px', background: 'rgba(0, 20, 0, 0.6)', border: '1px solid var(--green)' }}>
              <div style={{ width: `${hpPct}%`, height: '100%', background: 'var(--green)', transition: 'width 0.2s' }} />
            </div>
            <span style={{ fontSize: '0.65rem', color: 'var(--green)' }}>{hp ?? 0}/{hpMax ?? 0}</span>
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
          <div key={field.id} style={{ border: '1px solid var(--green)', background: 'rgba(0, 20, 0, 0.35)', textAlign: 'center' }}>
            <div style={{ fontSize: '0.55rem', opacity: 0.65, letterSpacing: '1px', padding: '4px 2px 0' }}>{field.label}</div>
            {maxField ? (
              <div style={{ display: 'flex', alignItems: 'center', padding: '0 2px' }}>
                <FieldInput field={field} data={data} readOnly={readOnly} onFieldChange={onFieldChange} style={numInput} />
                <span style={{ opacity: 0.5 }}>/</span>
                <FieldInput field={maxField} data={data} readOnly={readOnly} onFieldChange={onFieldChange} style={numInput} />
              </div>
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
                  display: 'block', width: '100%', borderTop: '1px solid var(--green)',
                  border: 'none', borderTopStyle: 'solid', borderTopWidth: '1px', borderTopColor: 'var(--green)',
                  background: 'none', fontSize: '0.6rem', padding: '2px 0', color: 'var(--green)',
                  opacity: onRoll ? 0.9 : 0.5, cursor: onRoll ? 'pointer' : 'default', fontFamily: 'inherit',
                }}
              >
                ⌁ ROLL
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
                fontSize: '0.68rem', minWidth: '42px', textAlign: 'right', color: 'var(--green)',
                background: 'none', border: 'none', padding: 0, fontFamily: 'inherit',
                cursor: onRoll && field.roll ? 'pointer' : 'default',
              }}
            >
              {base >= 0 ? `+${base}` : base} ⌁
            </button>
          </div>
        );
      })}
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
        <div key={field.id}>
          <div style={{ fontSize: '0.6rem', opacity: 0.65, letterSpacing: '1px', marginBottom: '2px' }}>{field.label}</div>
          <FieldInput field={field} data={data} readOnly={readOnly} onFieldChange={onFieldChange} onOpenLink={onOpenLink} />
        </div>
      ))}
    </div>
  );
}

export function SheetRenderer({ template, data, readOnly = false, onFieldChange, portraitUrl, onOpenLink, onRoll }: SheetRendererProps) {
  const tabs = template.tabs ?? ['SHEET'];
  const [activeTab, setActiveTab] = useState(tabs[0]);
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
      `}</style>

      <SheetHeaderBlock template={template} data={data} portraitUrl={portraitUrl} onOpenLink={onOpenLink} />

      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: '6px', paddingRight: '4px' }}>
        {tabHasRolls && (
          <div style={{ textAlign: 'right', fontSize: '0.6rem', opacity: 0.55, letterSpacing: '1px' }}>
            {onRoll ? 'click ⌁ to roll' : 'rolls land in the dice tray'}
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
                  {section.layout === 'grid' && <GridSection section={section} data={data} readOnly={readOnly} onFieldChange={onFieldChange} onRoll={onRoll} />}
                  {section.layout === 'skills' && <SkillsSection section={section} data={data} readOnly={readOnly} onFieldChange={onFieldChange} onRoll={onRoll} />}
                  {(section.layout === 'list' || section.layout === 'notes') && <ListSection section={section} data={data} readOnly={readOnly} onFieldChange={onFieldChange} onOpenLink={onOpenLink} />}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {tabs.length > 1 && (
        <div style={{ display: 'flex', borderTop: '1px solid var(--green)', marginTop: '8px', flex: '0 0 auto' }}>
          {tabs.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, padding: '7px 4px', background: activeTab === tab ? 'rgba(0, 60, 0, 0.5)' : 'none',
                border: 'none', borderRight: '1px solid var(--green)', color: 'var(--green)',
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
