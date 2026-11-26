import { useState } from 'react';
import { applyLabel, headWords, newestFirst, rowParts, type WaitingView } from '../sheets/waitingHits';
import type { WaitingAct, WaitingActAnswer } from '../hooks/useWaitingHits';

/**
 * Hits waiting under APPLY DAMAGE CONFIRM on a token (8b6b2; approved mockup docs/mockups/waiting-hits.html, sections 3 and 4):
 * under its HP on HEALTH (answer 3 A) and in a sheet's vitals box. To whoever may apply them: each, newest first, who made it
 * with what, its notes and what it would take larger, APPLY and DISMISS; APPLY ALL where two or more wait. In the vitals box
 * (`fold`), more than two fold into "3 HITS WAITING ▸", opened in place. To the one who made some: how many, and who applies
 * them. To anyone else, nothing. Why the server said no, said under it.
 */
export function WaitingHits({ view, act, gm, fold = false }: {
  view: WaitingView | null;
  act: (payload: WaitingAct) => Promise<WaitingActAnswer>;
  /** The game's word for the GM, as "THE GM APPLIES THEM" says it. */
  gm: string;
  fold?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const head = headWords(view, gm);
  if (!view || !view.ok || !head) return null;
  const run = (payload: WaitingAct) => {
    setBusy(true);
    setSaid(null);
    void act(payload).then((answer) => { setBusy(false); if (!answer.ok) setSaid(answer.error); });
  };
  const box: React.CSSProperties = { border: '1px solid var(--warning)', padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '6px', textAlign: 'left', fontSize: '0.65rem' };
  const headStyle: React.CSSProperties = { color: 'var(--warning)', fontSize: '0.55rem', letterSpacing: '2px' };
  const button: React.CSSProperties = { fontSize: '0.55rem', padding: '1px 8px', letterSpacing: '1px', whiteSpace: 'nowrap' };
  if (!view.may) {
    return (
      <div role="status" aria-label="Hits waiting" style={box}>
        <span style={headStyle}>{head}</span>
      </div>
    );
  }
  const rows = newestFirst(view.hits);
  // Folded where there are more than two (the vitals box), till opened.
  if (fold && rows.length > 2 && !opened) {
    return (
      <div role="group" aria-label="Hits waiting" style={box}>
        <button type="button" className="utility-btn" aria-expanded={false} onClick={() => setOpened(true)}
          style={{ ...button, alignSelf: 'flex-start', border: 0, color: 'var(--warning)', background: 'none', padding: 0 }}>{rows.length} HITS WAITING ▸</button>
      </div>
    );
  }
  return (
    <div role="group" aria-label="Hits waiting" style={box}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <span style={headStyle}>{head}</span>
        {rows.length > 1 && (
          <button type="button" className="utility-btn" disabled={busy} title="Every one, oldest first" onClick={() => run({ act: 'apply_all' })} style={button}>APPLY ALL</button>
        )}
      </div>
      {rows.map((h) => {
        const { notes, would } = rowParts(h.words);
        return (
          <div key={h.id} role="group" aria-label={`${h.what} from ${h.from}`}
            style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '4px 10px', alignItems: 'center', borderTop: '1px dashed color-mix(in srgb, var(--warning) 40%, transparent)', paddingTop: '5px' }}>
            <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
              from <span style={{ color: 'var(--cyan)' }}>{h.from}</span> · {h.what}{notes.length ? ` · ${notes.join(' · ')}` : ''}
              {would && <><br /><b data-testid="would-take" style={{ fontWeight: 800, fontSize: '1.2em' }}>{would}</b></>}
            </span>
            <span style={{ display: 'flex', gap: '6px' }}>
              <button type="button" className="utility-btn" disabled={busy} aria-label={`${applyLabel(h)}: ${h.what} from ${h.from}`} onClick={() => run({ act: 'apply', hitId: h.id })} style={button}>{applyLabel(h)}</button>
              <button type="button" className="utility-btn" disabled={busy} aria-label={`Dismiss ${h.what} from ${h.from}`} onClick={() => run({ act: 'dismiss', hitId: h.id })} style={{ ...button, opacity: 0.75 }}>DISMISS</button>
            </span>
          </div>
        );
      })}
      {said && <span role="alert" style={{ color: 'var(--warning)', fontSize: '0.6rem' }}>{said}</span>}
    </div>
  );
}
