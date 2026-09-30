import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { themeRoot } from '../utils/themeRoot';
import { groupSystems, flatten, moveActive, describe, type PickerSystem } from './systemPickerRules';

/**
 * The game-system picker: a searchable dropdown, grouped BUILT-IN then YOUR SYSTEMS.
 *
 * A row of buttons held four systems; this holds any number. Choosing a different system asks
 * first - it changes the game for everyone online, and a campaign should stay on one system -
 * using the app's own CONFIRM panel. The list and the confirmation are portalled into
 * themeRoot() so they wear the theme and are not clipped by the admin panel's scroll area.
 * The rules (grouping, search, keys) are in systemPickerRules.ts.
 */
export function SystemPicker({ systems, current, onSwitch }: {
  systems: PickerSystem[];
  current: string;
  /** Switch the game; resolve false (or throw) if the server refused. */
  onSwitch: (id: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [confirming, setConfirming] = useState<PickerSystem | null>(null);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const groups = useMemo(() => groupSystems(systems, query), [systems, query]);
  const flat = useMemo(() => flatten(groups), [groups]);
  const shown = describe(systems.find((s) => s.id === current));

  const close = () => { setOpen(false); setQuery(''); setActive(-1); };
  const toggle = () => {
    if (open) return close();
    setRect(buttonRef.current?.getBoundingClientRect() ?? null);
    setError(null);
    setOpen(true);
  };

  // Close when clicking anywhere else; follow the button if the panel scrolls or resizes.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (listRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      close();
    };
    const follow = () => setRect(buttonRef.current?.getBoundingClientRect() ?? null);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
    };
  }, [open]);

  const pick = (s: PickerSystem) => {
    close();
    if (s.id !== current) setConfirming(s);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => moveActive(i, e.key === 'ArrowDown' ? 1 : -1, flat.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && flat[active]) pick(flat[active]);
      else if (flat.length === 1) pick(flat[0]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      buttonRef.current?.focus();
    }
  };

  const confirmSwitch = async () => {
    const target = confirming;
    if (!target) return;
    setSwitching(true);
    let ok = false;
    try { ok = await onSwitch(target.id); } catch { ok = false; }
    setSwitching(false);
    setConfirming(null);
    if (!ok) setError(`Could not switch to ${target.name.toUpperCase()}. Nothing was changed.`);
  };

  const listId = 'system-picker-list';
  const width = Math.max(rect?.width ?? 260, 260);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="utility-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between', padding: '6px 10px' }}
      >
        <span style={{ fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shown.name}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {shown.tag && <span style={{ fontSize: '0.6rem', opacity: 0.75 }}>{shown.tag}</span>}
          <span aria-hidden="true">{open ? '▴' : '▾'}</span>
        </span>
      </button>
      {error && <p role="alert" style={{ margin: 0, fontSize: '0.65rem', color: 'var(--danger)' }}>{error}</p>}

      {open && rect && createPortal(
        <div
          ref={listRef}
          style={{
            position: 'fixed', left: rect.left, top: rect.bottom + 4, width, zIndex: 2000,
            background: 'var(--black)', border: '1px solid var(--green)', boxShadow: 'var(--glow)',
            fontFamily: 'monospace', color: 'var(--text)',
          }}
        >
          <input
            autoFocus
            type="text"
            role="combobox"
            aria-label="Search game systems"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={active >= 0 && flat[active] ? `system-option-${flat[active].id}` : undefined}
            placeholder="SEARCH SYSTEMS"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(-1); }}
            onKeyDown={onKeyDown}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '6px 8px', fontFamily: 'monospace', fontSize: '0.75rem',
              background: 'var(--black)', color: 'var(--green)', border: 'none', borderBottom: '1px solid var(--dark-green)', outline: 'none',
            }}
          />
          <div id={listId} role="listbox" aria-label="Game systems" className="system-picker-list">
            {groups.length === 0 && <div style={{ padding: '8px', fontSize: '0.7rem', opacity: 0.7 }}>No system matches.</div>}
            {groups.map((g) => (
              <div key={g.label} role="group" aria-label={g.label}>
                <div style={{ padding: '6px 8px 2px', fontSize: '0.6rem', letterSpacing: '2px', opacity: 0.6 }}>{g.label}</div>
                {g.items.map((s) => {
                  const index = flat.indexOf(s);
                  const isActive = index === active;
                  const isCurrent = s.id === current;
                  return (
                    <div
                      key={s.id}
                      id={`system-option-${s.id}`}
                      role="option"
                      aria-selected={isCurrent}
                      onMouseEnter={() => setActive(index)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pick(s)}
                      style={{
                        padding: '5px 10px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: '8px',
                        fontSize: '0.72rem',
                        background: isActive ? 'var(--dark-green)' : 'transparent',
                        color: isCurrent ? 'var(--green)' : 'var(--text)',
                        fontWeight: isCurrent ? 'bold' : 'normal',
                      }}
                    >
                      <span>{isCurrent ? '▶ ' : ''}{s.name.toUpperCase()}</span>
                      {s.custom && <span style={{ opacity: 0.6, fontSize: '0.6rem' }}>v{s.version ?? 0}</span>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>,
        themeRoot(),
      )}

      {confirming && createPortal(
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="system-switch-title">
          <div className="panel critical-alert" style={{ maxWidth: '460px' }}>
            <h2 id="system-switch-title" className="alert-text">!! SWITCH GAME SYSTEM !!</h2>
            <p>Switch the game to <span className="highlight">[{confirming.name.toUpperCase()}]</span>?</p>
            <p style={{ fontSize: '0.8rem', lineHeight: 1.5 }}>
              This changes the game for everyone online, and is meant for starting a new campaign.
              Each system keeps its own characters, banks and token health, so switching back brings them back.
            </p>
            <div className="button-group" style={{ marginTop: '20px' }}>
              <button type="button" className="upload-btn danger-btn" disabled={switching} onClick={confirmSwitch}>
                {switching ? 'SWITCHING…' : 'SWITCH'}
              </button>
              <button type="button" className="utility-btn" disabled={switching} onClick={() => setConfirming(null)}>CANCEL</button>
            </div>
          </div>
        </div>,
        themeRoot(),
      )}
    </>
  );
}
