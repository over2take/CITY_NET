import React from 'react';
import { TOPICS, FORMULA_FUNCTIONS, EXAMPLES, topicById, type HelpTopic } from '../sheets/builderHelp';
import type { BuilderPage } from '../sheets/builderSession';
import { TargetSeenExample } from './TargetSeenExample';

// The builder's HELP page (4i; approved mockup docs/mockups/builder-help.html, 2026-10-13): the
// topics down the left (getting started, every page, and the references), the open one on the
// right. A page's topic has GO TO, which opens that page; FORMULAS lists every function the engine
// knows; EXAMPLES opens the built-in games to look at. The words are sheets/builderHelp.ts.

interface Props {
  /** The topic open, by id; the first when it is none or unknown. */
  topic: string | null;
  onTopic: (id: string) => void;
  /** Whether there is a system (or an example) whose pages GO TO can open. */
  canGoTo: boolean;
  onGoTo: (page: BuilderPage) => void;
  /** Look at a built-in example; without it EXAMPLES only describes them. */
  onLook?: (exampleId: string) => void;
  /** Play the tour again; without it there is no START THE TOUR. */
  onStartTour?: () => void;
}

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 13, lineHeight: 1.55, margin: 0, maxWidth: '72ch' };
const btn: React.CSSProperties = { fontFamily: 'monospace', fontSize: 11, letterSpacing: 1, padding: '5px 10px' };
const cell: React.CSSProperties = { textAlign: 'left', padding: '5px 10px 5px 0', borderBottom: '1px solid var(--dark-green)', verticalAlign: 'top' };
const code: React.CSSProperties = { color: 'var(--cyan)', fontFamily: 'monospace' };

/** The open topic's buttons: START THE TOUR, GO TO its page, or the examples to look at. */
function Actions({ topic, canGoTo, onGoTo, onLook, onStartTour }: Omit<Props, 'onTopic' | 'topic'> & { topic: HelpTopic }) {
  const buttons = [
    topic.tour && onStartTour && <button key="tour" type="button" className="utility-btn" style={btn} onClick={onStartTour}>START THE TOUR</button>,
    topic.page && (
      <button key="go" type="button" className="utility-btn" style={btn} disabled={!canGoTo} onClick={() => onGoTo(topic.page!)}
        title={canGoTo ? undefined : 'Open a system first, in MY SYSTEMS.'}>GO TO {topic.title}</button>
    ),
    ...(topic.examples && onLook ? EXAMPLES.map((e) => (
      <button key={e.id} type="button" className="utility-btn" style={btn} onClick={() => onLook(e.id)}>LOOK AT {e.name}</button>
    )) : []),
  ].filter(Boolean);
  return buttons.length ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{buttons}</div> : null;
}

export function HelpPage({ topic: openId, onTopic, ...rest }: Props) {
  const open = topicById(openId ?? undefined);
  return (
    <div data-testid="help-page" style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 220px) minmax(0, 1fr)', gap: 16, alignItems: 'start', maxWidth: 1100 }}>
      <nav aria-label="Help topics" style={{ border: '1px solid var(--dark-green)', display: 'flex', flexDirection: 'column' }}>
        {TOPICS.map((t, i) => (
          <React.Fragment key={t.id}>
            {(i === 0 || TOPICS[i - 1].group !== t.group) && (
              <span style={{ ...small, fontSize: 9, opacity: 0.55, padding: '8px 10px 2px' }}>{t.group}</span>
            )}
            <button type="button" aria-current={t.id === open.id || undefined} onClick={() => onTopic(t.id)}
              style={{
                textAlign: 'left', padding: '6px 10px', border: 0, cursor: 'pointer', fontFamily: 'monospace', fontSize: 11, letterSpacing: 1,
                color: 'var(--green)', background: t.id === open.id ? 'color-mix(in srgb, var(--green) 12%, transparent)' : 'none',
                boxShadow: t.id === open.id ? 'inset 3px 0 0 var(--green)' : 'none',
              }}>{t.title}</button>
          </React.Fragment>
        ))}
      </nav>

      <article aria-labelledby="help-topic-title" style={{ border: '1px solid var(--dark-green)', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <h2 id="help-topic-title" style={{ margin: 0, fontSize: 14, letterSpacing: 1, color: 'var(--green)' }}>{open.title}</h2>
        {open.body.map((p, i) => <p key={i} style={why}>{p}</p>)}
        {open.id === 'formulas' && (
          <div style={{ overflowX: 'auto' }}>
            <table aria-label="Formula functions" style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
              <thead><tr>
                {['FUNCTION', 'GIVES', 'EXAMPLE'].map((h) => <th key={h} scope="col" style={{ ...cell, ...small, fontWeight: 'normal' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {FORMULA_FUNCTIONS.map((f) => (
                  <tr key={f.name}>
                    <td style={{ ...cell, ...code, whiteSpace: 'nowrap' }}>{f.name}({f.args})</td>
                    <td style={cell}>{f.gives}</td>
                    <td style={{ ...cell, ...code }}>{f.example}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {open.id === 'target' && <TargetSeenExample />}
        <Actions topic={open} {...rest} />
      </article>
    </div>
  );
}
