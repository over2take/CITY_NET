import React, { useState } from 'react';
import { usePlayerSheet } from '../hooks/usePlayerSheet';
import { quickRolls } from '../sheets/quickRolls';
import { DefenseReadout, type TokenDefense } from './TokenWindow';

// Your own token's QUICK ACTIONS: your defense as it stands, and the rolls you would otherwise
// open the sheet for - saves, stats, a skill check. Each goes through the sheet's own roll
// path (`onRoll` by field id), so it is the same roll the sheet's button makes, penalties
// and all, and lands in the dice tray the same way.

interface Props {
  socket: any;
  userName: string | null;
  defense: TokenDefense | null;
  /** A roll went out: the app pops the dice tray. */
  onRolled?: () => void;
}

const sectionHead: React.CSSProperties = { fontSize: 10, opacity: 0.8, letterSpacing: 1, marginBottom: 6 };
const divider: React.CSSProperties = { borderTop: '1px solid var(--dark-green)', marginTop: 12, paddingTop: 10 };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, padding: '4px 10px' };

export function QuickActions({ socket, userName, defense, onRolled }: Props) {
  const { sheet, template, hiddenTabs, actions } = usePlayerSheet(socket, userName, { onRolled });
  const { checks, skills } = quickRolls(template, hiddenTabs);
  const [skill, setSkill] = useState('');
  const allSkills = skills.flatMap((g) => g.rolls);
  const picked = allSkills.some((r) => r.fieldId === skill) ? skill : '';

  return (
    <div>
      {defense && (
        <div>
          <div style={sectionHead}>DEFENSE</div>
          <DefenseReadout defense={defense} />
        </div>
      )}

      {!sheet ? (
        <div style={defense ? divider : undefined}>
          <div style={{ opacity: 0.7 }}>NO SHEET ON FILE · OPEN_SHEET TO MAKE ONE</div>
        </div>
      ) : (
        <>
          {checks.length > 0 && (
            <div style={defense ? divider : undefined}>
              <div style={sectionHead}>ROLLS</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {checks.map((r) => (
                  <button key={r.fieldId} type="button" className="utility-btn" style={btn} onClick={() => actions.onRoll(r.fieldId)}>
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {allSkills.length > 0 && (
            <div style={divider}>
              <div style={sectionHead}>SKILL CHECK</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <select
                  aria-label="Skill"
                  value={picked}
                  onChange={(e) => setSkill(e.target.value)}
                  style={{ ...btn, flex: 1, minWidth: 0, background: 'var(--black)', color: 'var(--green)', border: '1px solid var(--dark-green)' }}
                >
                  <option value="">PICK A SKILL…</option>
                  {skills.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.rolls.map((r) => {
                        const level = sheet.data[r.fieldId];
                        return (
                          <option key={r.fieldId} value={r.fieldId}>
                            {r.label}{level != null && level !== '' ? ` (${level})` : ''}
                          </option>
                        );
                      })}
                    </optgroup>
                  ))}
                </select>
                <button type="button" className="utility-btn" style={btn} disabled={!picked} onClick={() => actions.onRoll(picked)}>
                  ROLL
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
