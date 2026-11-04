import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { DraggableWindow } from './DraggableWindow';
import { ChoicesSection } from './ChoicesSection';
import type { Socket } from 'socket.io-client';
import { ImportSheetDialog } from './ImportSheetDialog';
import { usePlayerSheet } from '../hooks/usePlayerSheet';
import { useChoicesRefused } from '../hooks/useChoicesRefused';
import { canImport } from '../sheets/importable';
import {
  flowDone, flowStepName, flowSteps, savedStep, statProblem, statsToSet, stepAnswered, stepListId, whoFields,
} from '../sheets/newCharacterFlow';
import { themeRoot } from '../utils/themeRoot';

// NEW_CHARACTER.EXE (7c2; approved mockup docs/mockups/new-character.html, 2026-11-03): a player with
// a blank sheet walked through the steps their GM set, each answer written to the sheet as they go.
// START offers an upload, today's IMPORT, taken as it is with no steps after it, and THE BLANK FORM.
// Closing it, or LEAVE FOR NOW, loses nothing: the place is on the sheet (backend creation.js), and
// the sheet's CREATING · CONTINUE opens it there again. What a step asks and whether it is answered
// is sheets/newCharacterFlow.ts.

interface Props {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  socket: Socket | null;
  userName: string;
  /** Closed with the character unfinished: their place is kept. */
  onLeave: () => void;
  /** Finished, or uploaded: the window closes on their sheet. */
  onDone: () => void;
}

const small: React.CSSProperties = { fontSize: '0.6rem', letterSpacing: '1px', opacity: 0.75 };
const why: React.CSSProperties = { fontSize: '0.7rem', lineHeight: 1.45, opacity: 0.85, margin: 0 };
const btn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--dark-green)', color: 'var(--green)', cursor: 'pointer',
  fontFamily: 'inherit', fontSize: '0.65rem', letterSpacing: '1px', padding: '3px 9px',
};
const go: React.CSSProperties = { ...btn, borderColor: 'var(--green)' };
const box: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--green) 6%, var(--black))', border: '1px solid var(--dark-green)', color: 'var(--green)',
  fontFamily: 'inherit', fontSize: '0.75rem', padding: '3px 6px', boxSizing: 'border-box', width: '100%',
};
/** A way to start, its button in a column of its own so the three line up. */
const option: React.CSSProperties = { display: 'grid', gridTemplateColumns: '130px minmax(0, 1fr)', gap: '10px', alignItems: 'center' };

export function NewCharacterWindow({ pos, setPos, socket, userName, onLeave, onDone }: Props) {
  const { sheet, template, handleFieldChange } = usePlayerSheet(socket, userName);
  const refused = useChoicesRefused(socket);
  // The step shown, ahead of the server's answer so NEXT doesn't wait on it. Null: as the sheet says.
  const [moved, setMoved] = useState<string | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importPos, setImportPos] = useState({ x: pos.x + 60, y: pos.y + 60 });
  const [formTaken, setFormTaken] = useState(false);
  const data = sheet?.data;
  const done = flowDone(data);
  useEffect(() => { if (done) onDone(); }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = `NEW_CHARACTER.EXE · ${(template?.name ?? '').toUpperCase()}`;
  const windowStyle: React.CSSProperties = { width: '480px', maxWidth: '92vw' };
  const contentStyle: React.CSSProperties = { maxHeight: '76vh', padding: 0, textAlign: 'left' };

  if (!sheet || !template?.creation) {
    return (
      <DraggableWindow title={title} pos={pos} setPos={setPos} onClose={onLeave} windowStyle={windowStyle} contentStyle={contentStyle}>
        <div style={{ ...why, padding: '12px' }}>ACCESSING RECORD...</div>
      </DraggableWindow>
    );
  }

  const steps = flowSteps(template);
  const at = moved ?? savedStep(template, data);
  // Without SHEET IMPORT there is only one way to start, so nothing to ask.
  const starting = !at && canImport(sheet.system);
  const step = at ?? steps[0];
  const index = steps.indexOf(step);
  const go_to = (id: string) => { setMoved(id); socket?.emit('creationAction', { kind: 'at', step: id }); };
  const answered = stepAnswered(template, step, data);
  const last = index === steps.length - 1;
  const listId = stepListId(step);

  const body = () => {
    if (starting) {
      return (
        <>
          <p style={{ ...why, fontSize: '0.8rem', opacity: 1 }}>A NEW CHARACTER. HOW DO YOU WANT TO START?</p>
          <div style={option}>
            <button type="button" style={go} onClick={() => go_to(steps[0])}>MAKE ONE HERE</button>
            <span style={small}>Step by step, as your GM set it up.</span>
          </div>
          <div style={option}>
            <button type="button" style={btn} onClick={() => setIsImportOpen(true)}>UPLOAD A SHEET</button>
            <span style={small}>A filled-in form, or one you already have. Taken as it is.</span>
          </div>
          <div style={option}>
            <a href="/api/sheets/import/template.pdf" download style={{ ...btn, textDecoration: 'none', textAlign: 'center', boxSizing: 'border-box', lineHeight: 'normal', alignSelf: 'center' }} onClick={() => setFormTaken(true)}>THE BLANK FORM</a>
            <span style={small}>To fill in outside the game, made from this system&apos;s own sheet.</span>
          </div>
          {formTaken && <p role="status" style={{ ...why, color: 'var(--cyan)', opacity: 1 }}>Fill it in, then come back and UPLOAD A SHEET.</p>}
        </>
      );
    }
    if (step === 'who') {
      return (
        <>
          <p style={why}>Who they are. The rest can wait; a name can&apos;t.</p>
          {whoFields(template).map((f) => (
            <label key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              <span style={small}>{f.label.toUpperCase()}</span>
              {f.type === 'textarea'
                ? <textarea aria-label={f.label} rows={3} style={{ ...box, resize: 'vertical' }} value={String(data?.[f.id] ?? '')} onChange={(e) => handleFieldChange(f.id, e.target.value)} />
                : <input aria-label={f.label} style={box} value={String(data?.[f.id] ?? '')} onChange={(e) => handleFieldChange(f.id, e.target.value)} />}
            </label>
          ))}
        </>
      );
    }
    if (step === 'stats') {
      return (
        <>
          <p style={why}>Type in what you have.</p>
          {statsToSet(template).map((g) => (
            <section key={g.id} aria-label={g.label} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span style={small}>{g.label.toUpperCase()}</span>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: '6px' }}>
                {g.stats.map((s) => {
                  const problem = statProblem(s, data?.[s.id]);
                  return (
                    <label key={s.id} style={{ border: '1px solid var(--green)', padding: '4px', display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center', textAlign: 'center' }}>
                      <span style={small}>{s.label}</span>
                      <input type="number" aria-label={s.label} min={s.min} max={s.max} style={{ ...box, textAlign: 'center', colorScheme: 'dark' }} value={String(data?.[s.id] ?? '')}
                        onChange={(e) => handleFieldChange(s.id, e.target.value === '' ? '' : Number(e.target.value))} />
                      {problem && <span style={{ ...small, color: 'var(--warning)', opacity: 1 }}>{problem}</span>}
                    </label>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      );
    }
    if (listId) {
      return (
        <>
          <p style={why}>Pick from these. One you don&apos;t meet is off, saying what it needs.</p>
          <ChoicesSection lists={template.choices ?? []} data={data ?? {}} readOnly={false} only={listId} takeBack
            onChoices={(action) => socket?.emit('choicesAction', action)} refused={refused} />
        </>
      );
    }
    return null;
  };

  return (
    <>
      <DraggableWindow title={title} pos={pos} setPos={setPos} onClose={onLeave} windowStyle={windowStyle} contentStyle={contentStyle}>
        <ol aria-label="The steps" style={{ listStyle: 'none', margin: 0, padding: '7px 12px', display: 'flex', flexWrap: 'wrap', gap: '2px 10px', borderBottom: '1px solid var(--dark-green)' }}>
          {steps.map((id, i) => {
            const past = !starting && i < index;
            const now = !starting && i === index;
            return (
              <li key={id} aria-current={now ? 'step' : undefined} style={{ fontSize: '0.6rem', letterSpacing: '1px', opacity: now ? 1 : past ? 0.65 : 0.4 }}>
                {past ? '✓ ' : ''}{flowStepName(template, id)}
              </li>
            );
          })}
        </ol>
        <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px', minHeight: '200px' }}>{body()}</div>
        <div style={{ position: 'sticky', bottom: 0, background: 'var(--black)', display: 'flex', justifyContent: 'space-between', gap: '8px', padding: '8px 12px', borderTop: '1px solid var(--dark-green)', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', gap: '6px' }}>
            {!starting && <button type="button" style={{ ...btn, opacity: index === 0 ? 0.4 : 1 }} disabled={index === 0} onClick={() => go_to(steps[index - 1])}>BACK</button>}
            <button type="button" style={btn} onClick={onLeave}>LEAVE FOR NOW</button>
          </span>
          {!starting && (
            <button type="button" style={{ ...go, opacity: answered ? 1 : 0.4, cursor: answered ? 'pointer' : 'not-allowed' }} disabled={!answered} title={answered ? undefined : 'Finish this step first'}
              onClick={() => {
                if (!last) return go_to(steps[index + 1]);
                socket?.emit('creationAction', { kind: 'finish' });
                return onDone();
              }}>{last ? 'FINISH' : 'NEXT'}</button>
          )}
        </div>
      </DraggableWindow>
      {isImportOpen && ReactDOM.createPortal(
        <ImportSheetDialog
          gameSystem={sheet.system}
          currentData={data}
          pos={importPos}
          setPos={setImportPos}
          onClose={() => setIsImportOpen(false)}
          onApply={(fields, opts) => { socket?.emit('importSheetFields', { fields, replace: opts?.replace, cyberware: opts?.cyberware }); }}
        />,
        themeRoot(),
      )}
    </>
  );
}
