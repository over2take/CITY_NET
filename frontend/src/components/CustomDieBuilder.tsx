import React, { useState, useRef } from 'react';
import { DraggableWindow } from './DraggableWindow';
import type { CustomDie, CustomDieFace } from '../types';

interface Props {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  onClose: () => void;
  onCreate: (die: Omit<CustomDie, 'id'>) => Promise<boolean>;
  onUpdate: (die: CustomDie) => Promise<boolean>;
  existingDice: CustomDie[];
  /** When set, the builder opens in edit mode for this die. */
  editingDie?: CustomDie | null;
  /** Server-side failure from the last save attempt, if any. */
  serverError?: string | null;
}

const MAX_SIDES = 999;
const VISIBLE_FACES = 20;
const FACE_ROW_H = 33;

const STANDARD_NAMES = new Set(['d2', 'd4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100']);

// Note: App keys this component on the die being edited, so switching targets
// remounts it and every initializer below re-runs against the new die. `pos`
// lives in App so the window keeps its place across that remount.
export function CustomDieBuilder({ pos, setPos, onClose, onCreate, onUpdate, existingDice, editingDie, serverError }: Props) {
  const isEditing = !!editingDie;

  const [sidesInput, setSidesInput] = useState(editingDie ? String(editingDie.sides) : '');
  const [sides, setSides] = useState(editingDie?.sides ?? 0);
  const [faces, setFaces] = useState<string[]>(editingDie ? editingDie.faces.map(f => f.value) : []);
  const [name, setName] = useState(editingDie?.name ?? '');
  const [nameError, setNameError] = useState('');
  const [sidesError, setSidesError] = useState('');
  const [saving, setSaving] = useState(false);
  const sidesInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const validateName = (val: string): string => {
    const trimmed = val.trim();
    if (!trimmed) return 'required';
    if (STANDARD_NAMES.has(trimmed.toLowerCase())) return 'name taken by a standard die';
    // The die being edited is allowed to keep its own name.
    const clash = existingDice.some(
      d => d.id !== editingDie?.id && d.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (clash) return 'name already in use';
    return '';
  };

  const handleNameChange = (val: string) => {
    setName(val);
    if (nameError) setNameError(validateName(val));
  };

  const handleSetSides = () => {
    const n = parseInt(sidesInput, 10);
    if (!sidesInput.trim() || isNaN(n) || n < 2) {
      setSidesError('min 2');
      sidesInputRef.current?.focus();
      return;
    }
    if (n > MAX_SIDES) {
      setSidesError(`max ${MAX_SIDES}`);
      sidesInputRef.current?.focus();
      return;
    }
    setSidesError('');
    setSides(n);
    // Preserve any values already entered when resizing the die.
    setFaces(prev => Array.from({ length: n }, (_, i) => prev[i] ?? ''));
  };

  const handleSidesKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSetSides();
  };

  const handleSidesInput = (val: string) => {
    const cleaned = val.replace(/\D/g, '').slice(0, 3);
    setSidesInput(cleaned);
    setSidesError('');
  };

  const handleFaceChange = (i: number, val: string) => {
    setFaces(prev => {
      const next = [...prev];
      next[i] = val;
      return next;
    });
  };

  const handleSubmit = async () => {
    const err = validateName(name);
    if (err) {
      setNameError(err);
      nameInputRef.current?.focus();
      return;
    }
    if (sides < 2 || faces.length !== sides || !faces.every(f => f.trim() !== '')) return;

    const faceDefs: CustomDieFace[] = faces.map(v => ({ value: v.trim() }));
    setSaving(true);
    const ok = isEditing && editingDie
      ? await onUpdate({ ...editingDie, name: name.trim(), sides, faces: faceDefs })
      : await onCreate({ name: name.trim(), sides, faces: faceDefs });
    setSaving(false);

    // On failure the parent surfaces the server's message; keep the form open
    // so the entered faces are not lost.
    if (ok) onClose();
  };

  const allFacesFilled = sides >= 2 && faces.length === sides && faces.every(f => f.trim() !== '');
  const canSubmit = allFacesFilled && name.trim() !== '' && !saving;

  const faceAreaHeight = Math.min(sides, VISIBLE_FACES) * FACE_ROW_H;

  return (
    <DraggableWindow
      title={isEditing ? 'CUSTOM_DIE.EXE — EDIT' : 'CUSTOM_DIE.EXE'}
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      windowStyle={{ width: '300px' }}
      contentStyle={{ display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 140px)' }}
    >
      {/* Name — required */}
      <div style={{ marginBottom: '10px' }}>
        <div style={{ fontSize: '0.7rem', color: 'var(--green)', marginBottom: '4px', textAlign: 'center' }}>
          NAME <span style={{ color: '#cc4400' }}>*</span>
        </div>
        <input
          ref={nameInputRef}
          type="text"
          value={name}
          onChange={e => handleNameChange(e.target.value)}
          placeholder="die name"
          style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(0,20,0,0.8)', border: `1px solid ${nameError ? '#cc4400' : 'var(--dark-green)'}`, color: 'var(--green)', padding: '5px 8px', fontFamily: 'inherit', fontSize: '0.85rem' }}
        />
        {nameError && (
          <div style={{ fontSize: '0.65rem', color: '#cc4400', marginTop: '3px', textAlign: 'center' }}>{nameError}</div>
        )}
      </div>

      {/* Sides — centered */}
      <div style={{ marginBottom: sides >= 2 ? '12px' : '4px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
          <input
            ref={sidesInputRef}
            type="text"
            inputMode="numeric"
            value={sidesInput}
            onChange={e => handleSidesInput(e.target.value)}
            onKeyDown={handleSidesKeyDown}
            placeholder="##"
            style={{ width: '48px', flexShrink: 0, background: 'rgba(0,20,0,0.8)', border: `1px solid ${sidesError ? '#cc4400' : 'var(--dark-green)'}`, color: 'var(--green)', padding: '5px 6px', fontFamily: 'inherit', fontSize: '0.85rem', textAlign: 'center' }}
          />
          <span style={{ fontSize: '0.7rem', color: '#888', flexShrink: 0 }}>Sides</span>
          <button
            className="upload-btn"
            style={{ width: 'auto', flexShrink: 0, marginTop: 0, padding: '5px 12px', fontSize: '0.7rem', letterSpacing: '1px' }}
            onClick={handleSetSides}
          >
            SET
          </button>
        </div>
        {sidesError && (
          <div style={{ fontSize: '0.65rem', color: '#cc4400', marginTop: '3px', textAlign: 'center' }}>{sidesError}</div>
        )}
      </div>

      {/* Face value inputs */}
      {sides >= 2 && (
        <>
          <div style={{ fontSize: '0.7rem', color: 'var(--green)', marginBottom: '6px', textAlign: 'center' }}>
            FACE VALUES <span style={{ color: '#555' }}>({sides} sides)</span>
          </div>
          <div style={{ overflowY: 'auto', height: `${faceAreaHeight}px`, flexShrink: 0, marginBottom: '14px', paddingRight: '4px' }}>
            {faces.map((val, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
                <span style={{ fontSize: '0.7rem', color: '#555', width: '22px', textAlign: 'right', flexShrink: 0 }}>{i + 1}</span>
                <input
                  type="text"
                  value={val}
                  onChange={e => handleFaceChange(i, e.target.value)}
                  placeholder="value or symbol"
                  style={{ flex: 1, background: 'rgba(0,20,0,0.8)', border: `1px solid ${val.trim() ? 'var(--dark-green)' : '#333'}`, color: 'var(--green)', padding: '4px 7px', fontFamily: 'inherit', fontSize: '0.85rem' }}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {serverError && (
        <div style={{ fontSize: '0.65rem', color: '#cc4400', marginBottom: '6px', textAlign: 'center' }}>{serverError}</div>
      )}

      <button
        className="upload-btn"
        style={{ width: '100%', padding: '10px', fontSize: '0.9rem', background: canSubmit ? 'var(--green)' : 'var(--dark-green)', color: 'var(--black)', opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
        onClick={handleSubmit}
        disabled={!canSubmit}
      >
        {saving ? 'SAVING…' : isEditing ? 'SAVE' : 'CREATE'}
      </button>
    </DraggableWindow>
  );
}
