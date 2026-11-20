import React from 'react';

interface Props {
  /** BEGIN in NEXT's place (sheets/turnAsks.ts beginOffered): round 1 not begun, where the game's conditions act on turns. */
  begin: boolean;
  /** BEGIN ROUND 1: the system's own word for a round, and its number. */
  beginLabel: string;
  /** NEXT, or Shadowrun's CLEAR once everyone must roll again. */
  nextLabel: string;
  /** Nothing to begin or move on with: no one in the order yet. */
  disabled: boolean;
  /** END INIT, in the system's own word. */
  endLabel: string;
  onNext: () => void;
  onBegin: () => void;
  onEnd: () => void;
  /** WAITING ON KES'S POISONED SAVE: a player's roll asked of them; NEXT never waits on it. */
  waiting: string | null;
  /** A roll the tracker asked for and was refused, in words. */
  error: string | null;
}

/**
 * The GM's buttons under the order, the same in D&D style and group style (8a9c; approved mockup
 * docs/mockups/condition-turn-effects.html): BEGIN ROUND 1 until the round has begun where it does anything, then NEXT;
 * END. Above them, what the round is waiting on, and a refused roll.
 */
export function InitiativeControls({ begin, beginLabel, nextLabel, disabled, endLabel, onNext, onBegin, onEnd, waiting, error }: Props) {
  return (
    <>
      {waiting && (
        <div data-testid="initiative-waiting" style={{ fontSize: '0.6rem', letterSpacing: '1px', color: 'var(--warning)', margin: '0 0 6px' }}>
          {waiting}
        </div>
      )}
      {error && (
        <div role="alert" style={{ fontSize: '0.6rem', color: 'var(--danger)', margin: '0 0 6px' }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: '6px' }}>
        {begin ? (
          <button
            className="upload-btn"
            style={{ flex: 1, width: 'auto' }}
            onClick={onBegin}
            disabled={disabled}
            title="Once everyone has rolled: the round's start, then the first one's turn. Then it is NEXT."
          >
            {beginLabel}
          </button>
        ) : (
          <button className="upload-btn" style={{ flex: 1, width: 'auto' }} onClick={onNext} disabled={disabled}>
            {nextLabel}
          </button>
        )}
        <button
          className="upload-btn"
          style={{ flex: 1, width: 'auto', background: 'transparent', color: 'var(--danger)', borderColor: 'var(--danger)' }}
          onClick={onEnd}
        >
          {endLabel}
        </button>
      </div>
    </>
  );
}
