import React, { useRef, useEffect, useState } from 'react';
import type { Combatant } from '../hooks/useInitiative';
import type { TurnAsk } from '../../../sheets/turnAsks';

interface Props {
  combatant: Combatant;
  index: number;
  isActive: boolean;
  isAdmin: boolean;
  onRemove: (id: string) => void;
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
  onDrop: () => void;
  /** The GM's: this NPC's EACH TURN rolls waiting (8a9c), each a ROLL on its row; the window gives a player none. */
  asks?: TurnAsk[];
  /** The asks being rolled, waiting for the answer. */
  rolling?: number[];
  onRollAsk?: (id: number) => void;
}

export function InitiativeCombatantRow({ combatant, index, isActive, isAdmin, onRemove, onDragStart, onDragOver, onDrop, asks = [], rolling = [], onRollAsk }: Props) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [showExplod, setShowExplod] = useState(combatant.exploded ?? false);

  useEffect(() => {
    if (combatant.exploded) {
      setShowExplod(true);
      const t = setTimeout(() => setShowExplod(false), 1400);
      return () => clearTimeout(t);
    }
  }, [combatant.id, combatant.exploded]);

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '5px 6px',
    borderBottom: '1px solid var(--dark-green)',
    background: isActive ? 'color-mix(in srgb, var(--green) 8%, transparent)' : 'transparent',
    borderLeft: isActive ? '2px solid var(--green)' : '2px solid transparent',
    cursor: isAdmin ? 'grab' : 'default',
    userSelect: 'none',
  };

  return (
    <div
      ref={rowRef}
      style={rowStyle}
      // Whose turn it is, said as well as drawn (8i2): what a screen reader announces and the journeys read.
      data-testid="initiative-row"
      aria-current={isActive ? 'step' : undefined}
      className={showExplod ? 'initiative-explod-row' : undefined}
      draggable={isAdmin}
      onDragStart={(e) => {
        if (!isAdmin) return;
        const ghost = document.createElement('div');
        ghost.style.position = 'absolute';
        ghost.style.top = '-9999px';
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 0, 0);
        setTimeout(() => document.body.removeChild(ghost), 0);
        onDragStart(index);
      }}
      onDragOver={(e) => { e.preventDefault(); if (isAdmin) onDragOver(index); }}
      onDrop={() => isAdmin && onDrop()}
    >
      {/* Portrait */}
      <div style={{ width: 28, height: 28, borderRadius: 2, overflow: 'hidden', flexShrink: 0, background: 'color-mix(in srgb, var(--black) 60%, transparent)', border: '1px solid var(--dark-green)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {combatant.portraitUrl
          ? <img src={combatant.portraitUrl} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
          : <span style={{ fontSize: '0.6rem', color: 'var(--green)', opacity: 0.65 }}>{combatant.isNpc ? '◆' : '◈'}</span>
        }
      </div>

      {/* Name */}
      <span title={combatant.name.toUpperCase()} style={{ flex: 1, fontSize: '0.75rem', color: isActive ? 'var(--green)' : 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {isActive && '▶ '}{combatant.name.toUpperCase()}
      </span>

      {/* An NPC's roll asked of the GM (8a9c): ROLL · POISONED SAVE, until rolled; NEXT never waits on it. */}
      {asks.map((a) => (
        <button
          key={a.id}
          className="utility-btn"
          title={a.says}
          disabled={rolling.includes(a.id)}
          onClick={() => onRollAsk?.(a.id)}
          style={{ flexShrink: 0, fontSize: '0.55rem', letterSpacing: '1px', padding: '2px 6px', color: 'var(--warning)', borderColor: 'var(--warning)' }}
        >
          ROLL · {a.named}
        </button>
      ))}

      {/* Score */}
      <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: isActive ? 'var(--green)' : 'inherit', minWidth: 24, textAlign: 'right' }}>
        {combatant.score}
      </span>


      {/* EXPLOD badge */}
      {showExplod && (
        <span style={{ fontSize: '0.55rem', letterSpacing: '1px', color: 'var(--black)', background: 'var(--green)', padding: '1px 4px', borderRadius: 2, fontWeight: 'bold', flexShrink: 0 }}>
          EXPLOD
        </span>
      )}

      {/* Admin trash */}
      {isAdmin && (
        <button
          onClick={() => onRemove(combatant.id)}
          title="REMOVE"
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)', opacity: 0.5, fontSize: '0.7rem', padding: '0 2px', lineHeight: 1 }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--danger)'; e.currentTarget.style.opacity = '1'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--green)'; e.currentTarget.style.opacity = '0.5'; }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
