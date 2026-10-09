import React, { useRef, useState } from 'react';
import type { systemsApi } from '../sheets/systemsApi';
import { CONDITION_ICON_IDS, isUploadedIcon } from '../sheets/conditionIcons';
import { ConditionIcon } from './ConditionIcon';

// A condition's icon, picked: the 24 drawn ones, which follow the theme, or one uploaded (a small
// PNG, WebP or SVG kept in its own colors). The builder's CONDITIONS page and the GAME tab's
// CONDITIONS panel (4e2c2) both pick with it.

interface Props {
  value: string;
  onPick: (icon: string) => void;
  /** For uploading an icon; without it only the drawn icons are offered. */
  api?: ReturnType<typeof systemsApi>;
  /** What the upload is for, in its label: "Upload an icon for Wired". */
  name: string;
  /** Each icon's width and height, in pixels. */
  size?: number;
}

const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' };
const why: React.CSSProperties = { fontSize: 11, lineHeight: 1.45, opacity: 0.85, margin: 0 };
const row: React.CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' };

export function ConditionIconPicker({ value, onPick, api, name, size = 30 }: Props) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File | undefined) => {
    if (!file || !api) return;
    setUploading(true);
    const r = await api.uploadIcon(file, 'condition');
    setUploading(false);
    if (!r.ok) { setUploadError(r.error); return; }
    setUploadError(null);
    onPick(r.value.icon);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <div role="radiogroup" aria-label="Icon" style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {CONDITION_ICON_IDS.map((id) => (
          <button key={id} type="button" role="radio" aria-checked={value === id} aria-label={id} onClick={() => onPick(id)}
            style={{ width: size, height: size, display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--green)', padding: 0,
              border: `1px solid ${value === id ? 'var(--green)' : 'var(--dark-green)'}`, background: value === id ? 'color-mix(in srgb, var(--green) 15%, transparent)' : 'none' }}>
            <ConditionIcon icon={id} />
          </button>
        ))}
      </div>
      <div style={row}>
        {isUploadedIcon(value) && (
          <span role="radio" aria-checked aria-label="Uploaded icon" style={{ width: size, height: size, display: 'grid', placeItems: 'center', border: '1px solid var(--green)' }}>
            <ConditionIcon icon={value} />
          </span>
        )}
        {api && <>
          <button type="button" className="utility-btn" style={btn} disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? 'UPLOADING…' : 'UPLOAD'}</button>
          <input ref={fileRef} type="file" accept=".png,.webp,.svg" aria-label={`Upload an icon for ${name}`} style={{ display: 'none' }}
            onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
          <span style={why}>PNG, WebP or SVG, a quarter of a megabyte. Kept in its own colors; the drawn ones follow the theme.</span>
        </>}
      </div>
      {uploadError && <span role="alert" style={{ color: 'var(--danger)', fontSize: 11 }}>{uploadError}</span>}
    </div>
  );
}
