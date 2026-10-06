import React from 'react';
import type { Definition } from '../sheets/systemsApi';
import type { WordForm } from '../sheets/words';
import { TERM_GROUPS, PART_ROWS, WORD_LIMIT, wordOf, withWord, withoutWord, readsAs, termPartOff } from '../sheets/wordsFeatures';

// The builder's WORDS page (4b1b): what the game calls the app's terms, one table, each term's one,
// many and short forms with the app's own word as the placeholder (approved mockup
// docs/mockups/builder-words-features.html, 2026-10-06). A box left blank is the app's word and
// nothing is stored for it (the user, same day). A term whose part is off in FEATURES is greyed: it
// has nowhere to show. What it reads and writes is sheets/wordsFeatures.ts; every change goes
// through the builder's `edit`, which autosaves it.

interface Props {
  definition: Definition;
  edit: (next: Definition) => void;
}

const FORMS: WordForm[] = ['singular', 'plural', 'short'];
const FORM_LABEL: Record<WordForm, string> = { singular: 'ONE', plural: 'MANY', short: 'SHORT' };
const cell: React.CSSProperties = { padding: '4px 8px 4px 0', verticalAlign: 'middle', borderTop: '1px solid var(--dark-green)' };

export function WordsPage({ definition, edit }: Props) {
  return (
    <div style={{ maxWidth: 940, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, opacity: 0.85, maxWidth: '72ch' }}>
        Leave a box empty to keep the app's own word, shown in it. The last column shows each term as players will read it.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            {['TERM', ...FORMS.map((f) => FORM_LABEL[f]), 'READS AS', ''].map((h, i) => (
              <th key={i} scope="col" style={{ textAlign: 'left', fontSize: 10, letterSpacing: 2, opacity: 0.7, fontWeight: 'normal', padding: '0 8px 6px 0' }}>{h}</th>
            ))}
          </tr>
        </thead>
        {TERM_GROUPS.map((group) => (
          <tbody key={group.label}>
            <tr><th colSpan={6} scope="colgroup" style={{ textAlign: 'left', paddingTop: 14, fontSize: 10, letterSpacing: 2, color: 'var(--green)', opacity: 0.8, fontWeight: 'normal' }}>{group.label}</th></tr>
            {group.terms.map((row) => {
              const off = termPartOff(definition, row);
              const changed = FORMS.some((f) => wordOf(definition, row.id, f));
              const part = off ? PART_ROWS.find((p) => p.id === row.part) : undefined;
              const name = row.app.singular!;
              return (
                <tr key={row.id} data-testid={`term-${row.id}`} style={{ opacity: off ? 0.45 : 1 }}>
                  <td style={{ ...cell, width: 160 }}>
                    <b style={{ color: 'var(--green)', letterSpacing: 1 }}>{name}</b>
                    <span style={{ display: 'block', fontSize: 11, opacity: 0.65 }}>{part ? `${part.label} is off in FEATURES` : row.what}</span>
                  </td>
                  {FORMS.map((form) => (
                    <td key={form} style={{ ...cell, ...(form === 'short' ? { width: 90 } : {}) }}>
                      {row.app[form] === undefined
                        ? <span aria-hidden style={{ opacity: 0.4 }}>·</span>
                        : (
                          <input
                            type="text"
                            maxLength={WORD_LIMIT}
                            aria-label={`${name} ${FORM_LABEL[form].toLowerCase()}`}
                            value={wordOf(definition, row.id, form)}
                            placeholder={row.app[form]}
                            disabled={off}
                            onChange={(e) => edit(withWord(definition, row.id, form, e.target.value))}
                            style={{
                              width: '100%', boxSizing: 'border-box', background: 'var(--black)', color: 'var(--green)', fontFamily: 'monospace', fontSize: 12,
                              padding: '5px 7px', border: `1px solid ${wordOf(definition, row.id, form) ? 'var(--cyan)' : 'var(--green)'}`,
                            }}
                          />
                        )}
                    </td>
                  ))}
                  <td style={{ ...cell, fontSize: 11, opacity: 0.8, whiteSpace: 'nowrap' }}>{readsAs(definition, row)}</td>
                  <td style={cell}>
                    <button type="button" className="utility-btn" style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '4px 9px' }}
                      disabled={!changed || off} aria-label={`Back to the app's words for ${name}`}
                      onClick={() => edit(withoutWord(definition, row.id))}>RESET</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}
