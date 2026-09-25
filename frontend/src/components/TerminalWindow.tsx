import React, { useEffect, useState } from 'react';
import { DraggableWindow } from './DraggableWindow';

// The terminal window: a solid title bar, folders down the left with a picture above them,
// the open folder's contents on the right, a row of buttons and a key hint along the bottom.
//
// Drawn after the green-screen terminal the building window was modeled on, and shared so
// every window that holds several kinds of thing about one subject - a building, a token,
// the NPC library - is laid out, navigated and themed the same way. What goes in the folders
// is the caller's; this only arranges it.
//
// Everything is a theme variable, so it follows all seven themes; the solid title bar comes
// from the `terminal-window` class in App.css.

export interface TerminalFolder<Id extends string = string> {
  id: Id;
  label: React.ReactNode;
  /** Words for screen readers and tests when the label is not plain text. */
  name?: string;
}

/** A button along the bottom. The caller decides which apply; the window only lays them out. */
export interface TerminalAction {
  key: string;
  label: React.ReactNode;
  onClick: () => void;
  title?: string;
  /** How loud the button is. Primary is the thing most people came to do. */
  tone?: 'primary' | 'normal' | 'accent' | 'danger';
  disabled?: boolean;
}

/**
 * Which folder is open, falling back to the first when the open one stops existing - a
 * GM-only folder after signing out - and starting over when `resetKey` changes, so opening
 * another building or token starts at its first folder rather than wherever the last was left.
 */
export function useFolder<Id extends string>(folders: TerminalFolder<Id>[], resetKey: unknown): [Id, (id: Id) => void] {
  const first = folders[0]?.id;
  const [picked, setPicked] = useState<Id | undefined>(first);
  useEffect(() => { setPicked(first); }, [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const open = folders.some((f) => f.id === picked) ? (picked as Id) : (first as Id);
  return [open, setPicked as (id: Id) => void];
}

interface Props<Id extends string> {
  title: string;
  pos: { x: number; y: number };
  setPos: (p: { x: number; y: number }) => void;
  onClose: () => void;
  titleControls?: React.ReactNode;
  /** The picture above the folders. */
  preview?: React.ReactNode;
  folders: TerminalFolder<Id>[];
  open: Id;
  onOpen: (id: Id) => void;
  /** The line above the panel, saying what the open folder is. */
  header?: React.ReactNode;
  /** What the open folder holds. */
  children: React.ReactNode;
  /** Prose keeps its line breaks; a panel of controls may want normal wrapping. */
  panelMode?: 'text' | 'controls';
  actions?: TerminalAction[];
  /** Anything between the panel and the buttons that belongs to the whole window. */
  footer?: React.ReactNode;
  width?: number;
  /** For screen readers and the arrow keys' focus target. */
  label?: string;
}

/** The picture above the folders: callers draw their preview at this size. */
export const TERMINAL_PREVIEW = { width: 160, height: 124 };
const FOLDER_W = TERMINAL_PREVIEW.width;
const mono: React.CSSProperties = { fontFamily: 'monospace', letterSpacing: 1 };

const toneStyle = (tone: TerminalAction['tone']): React.CSSProperties => {
  if (tone === 'accent') return { borderColor: 'var(--cyan)', color: 'var(--cyan)' };
  if (tone === 'danger') return { borderColor: 'var(--danger)', color: 'var(--danger)' };
  return {};
};

export function TerminalWindow<Id extends string>({
  title, pos, setPos, onClose, titleControls, preview, folders, open, onOpen, header, children,
  panelMode = 'text', actions = [], footer, width = 660, label,
}: Props<Id>) {
  /** Up and down walk the folders, the way the terminal in the reference does. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    // Not while typing or choosing: arrows belong to the field there.
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
    if (folders.length < 2) return;
    e.preventDefault();
    const i = Math.max(0, folders.findIndex((f) => f.id === open));
    onOpen(folders[(i + (e.key === 'ArrowDown' ? 1 : folders.length - 1)) % folders.length].id);
  };

  const openFolder = folders.find((f) => f.id === open);

  return (
    <DraggableWindow
      title={title}
      pos={pos}
      setPos={setPos}
      onClose={onClose}
      titleControls={titleControls}
      className="terminal-window"
      windowStyle={{ width, maxWidth: '96vw' }}
      contentStyle={{ maxHeight: 'none', padding: 12 }}
    >
      <div
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label={label ?? `${title} information`}
        // Left-aligned like a terminal. The shared window content centers its text, which
        // suits a short notice and not a page of prose.
        style={{ outline: 'none', display: 'flex', flexDirection: 'column', gap: 10, textAlign: 'left' }}
      >
        <div style={{ display: 'flex', gap: 14, alignItems: 'stretch' }}>
          {/* Left: the picture, then the folders. */}
          <div style={{ width: FOLDER_W, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {preview}
            <div role="tablist" aria-orientation="vertical" aria-label="Folders" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {folders.map((f) => {
                const active = f.id === open;
                return (
                  <button
                    key={f.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-label={f.name}
                    onClick={() => onOpen(f.id)}
                    style={{
                      ...mono, position: 'relative', textAlign: 'left', fontSize: 11,
                      padding: '6px 8px', minHeight: 30, cursor: 'pointer',
                      background: active ? 'color-mix(in srgb, var(--green) 14%, var(--black))' : 'var(--black)',
                      color: 'var(--green)', border: '1px solid var(--green)',
                    }}
                  >
                    {f.label}
                    {/* The lead-in from the open folder to what it holds, as in the reference. */}
                    {active && (
                      <span
                        aria-hidden
                        style={{ position: 'absolute', left: '100%', top: '50%', width: 14, borderTop: '1px solid var(--green)' }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: what the open folder holds. */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {header !== undefined && (
              <div style={{ ...mono, fontSize: 10, color: 'var(--green)', opacity: 0.8 }}>
                {header}
              </div>
            )}
            <div
              role="tabpanel"
              aria-label={openFolder?.name ?? (typeof openFolder?.label === 'string' ? openFolder.label : undefined)}
              className="cyber-scroll"
              style={{
                ...mono, letterSpacing: 0, fontSize: 12, lineHeight: 1.6, flex: 1,
                // As tall as what it holds - no taller than the folder column beside it
                // unless it has to be, and scrolling past a screenful.
                maxHeight: 'min(62vh, 560px)', overflowY: 'auto', padding: '8px 10px',
                border: '1px solid var(--green)', color: 'var(--green)',
                overflowWrap: 'anywhere',
                ...(panelMode === 'text' ? { whiteSpace: 'pre-wrap' } : {}),
              }}
            >
              {children}
            </div>
          </div>
        </div>

        {footer}

        {actions.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {actions.map((a) => (
              <button
                key={a.key}
                type="button"
                className={`utility-btn ${a.tone === 'primary' ? 'active' : ''}`}
                title={a.title}
                onClick={a.onClick}
                disabled={a.disabled}
                style={{
                  ...mono, fontSize: 11, padding: '6px 12px', flex: '1 1 140px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  ...toneStyle(a.tone),
                }}
              >{a.label}</button>
            ))}
          </div>
        )}

        {folders.length > 1 && (
          <div style={{ ...mono, fontSize: 10, color: 'var(--green)', opacity: 0.7 }}>
            UP, DOWN: select folder
          </div>
        )}
      </div>
    </DraggableWindow>
  );
}
