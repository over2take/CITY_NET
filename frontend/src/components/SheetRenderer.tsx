import React, { useState } from 'react';
import type { SheetTemplate, SheetSection, SheetField, SheetData } from '../sheets';

// Renders any game-system template. One renderer for every system - the
// template data decides what appears.

interface SheetRendererProps {
  template: SheetTemplate;
  data: SheetData;
  readOnly?: boolean;
  onFieldChange: (fieldId: string, value: string | number) => void;
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

function FieldInput({ field, data, readOnly, onFieldChange }: {
  field: SheetField; data: SheetData; readOnly: boolean;
  onFieldChange: (fieldId: string, value: string | number) => void;
}) {
  const value = data[field.id] ?? '';
  if (field.type === 'textarea') {
    return (
      <textarea
        aria-label={field.label}
        style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }}
        value={String(value)}
        readOnly={readOnly}
        onChange={(e) => onFieldChange(field.id, e.target.value)}
      />
    );
  }
  return (
    <input
      aria-label={field.label}
      type={field.type === 'number' ? 'number' : 'text'}
      style={inputStyle}
      value={value === null || value === undefined ? '' : String(value)}
      readOnly={readOnly}
      onChange={(e) => onFieldChange(field.id, field.type === 'number' ? Number(e.target.value) : e.target.value)}
    />
  );
}

function GridSection({ section, data, readOnly, onFieldChange }: {
  section: SheetSection; data: SheetData; readOnly: boolean;
  onFieldChange: (fieldId: string, value: string | number) => void;
}) {
  // maxField pairs render inside their base field's cell as CUR / MAX
  const maxIds = new Set(section.fields.filter(f => f.maxField).map(f => f.maxField as string));
  const visible = section.fields.filter(f => !maxIds.has(f.id));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${section.columns ?? 4}, 1fr)`, gap: '6px' }}>
      {visible.map((field) => {
        const maxField = field.maxField ? section.fields.find(f => f.id === field.maxField) : undefined;
        return (
          <div key={field.id} style={{ border: '1px solid var(--green)', padding: '5px', textAlign: 'center', background: 'rgba(0, 20, 0, 0.3)' }}>
            <div style={{ fontSize: '0.6rem', opacity: 0.65, letterSpacing: '1px', marginBottom: '3px' }}>{field.label}</div>
            {maxField ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                <FieldInput field={field} data={data} readOnly={readOnly} onFieldChange={onFieldChange} />
                <span style={{ opacity: 0.5 }}>/</span>
                <FieldInput field={maxField} data={data} readOnly={readOnly} onFieldChange={onFieldChange} />
              </div>
            ) : (
              <FieldInput field={field} data={data} readOnly={readOnly} onFieldChange={onFieldChange} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function SkillsSection({ section, data, readOnly, onFieldChange }: {
  section: SheetSection; data: SheetData; readOnly: boolean;
  onFieldChange: (fieldId: string, value: string | number) => void;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 12px' }}>
      {section.fields.map((field) => {
        const lvl = num(data[field.id]);
        const base = lvl + (field.stat ? num(data[field.stat]) : 0);
        return (
          <div key={field.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '1px 4px', background: lvl > 0 ? 'rgba(0, 40, 0, 0.4)' : 'transparent' }}>
            <span style={{ flex: 1, fontSize: '0.7rem', opacity: lvl > 0 ? 1 : 0.6 }}>{field.label}</span>
            <input
              aria-label={field.label}
              type="number"
              style={{ ...inputStyle, width: '44px', textAlign: 'center', padding: '1px 2px' }}
              value={data[field.id] === null || data[field.id] === undefined || data[field.id] === '' ? '' : String(data[field.id])}
              readOnly={readOnly}
              onChange={(e) => onFieldChange(field.id, Number(e.target.value))}
            />
            <span style={{ fontSize: '0.7rem', minWidth: '34px', textAlign: 'right', color: 'var(--green)' }} title="BASE = level + stat">
              {base}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ListSection({ section, data, readOnly, onFieldChange }: {
  section: SheetSection; data: SheetData; readOnly: boolean;
  onFieldChange: (fieldId: string, value: string | number) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {section.fields.map((field) => (
        <div key={field.id}>
          <div style={{ fontSize: '0.6rem', opacity: 0.65, letterSpacing: '1px', marginBottom: '2px' }}>{field.label}</div>
          <FieldInput field={field} data={data} readOnly={readOnly} onFieldChange={onFieldChange} />
        </div>
      ))}
    </div>
  );
}

export function SheetRenderer({ template, data, readOnly = false, onFieldChange }: SheetRendererProps) {
  const [openSections, setOpenSections] = useState<Set<string>>(
    () => new Set(template.sections.slice(0, 4).map(s => s.id))
  );

  const toggle = (id: string) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {template.sections.map((section) => {
        const open = openSections.has(section.id);
        return (
          <div key={section.id}>
            <button
              onClick={() => toggle(section.id)}
              style={{
                background: 'none', border: 'none', color: 'var(--green)', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: '0.65rem', letterSpacing: '2px', opacity: 0.7,
                padding: '2px 0', width: '100%', textAlign: 'left',
              }}
            >
              {open ? '▾' : '▸'} ─── {section.label} ───
            </button>
            {open && (
              <div style={{ padding: '4px 0 6px' }}>
                {section.layout === 'grid' && <GridSection section={section} data={data} readOnly={readOnly} onFieldChange={onFieldChange} />}
                {section.layout === 'skills' && <SkillsSection section={section} data={data} readOnly={readOnly} onFieldChange={onFieldChange} />}
                {(section.layout === 'list' || section.layout === 'notes') && <ListSection section={section} data={data} readOnly={readOnly} onFieldChange={onFieldChange} />}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
