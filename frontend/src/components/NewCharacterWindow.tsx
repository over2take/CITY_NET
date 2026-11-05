import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { TerminalWindow, type TerminalAction, type TerminalFolder } from './TerminalWindow';
import { BracketPortrait } from './BracketPortrait';
import { ChoicesSection } from './ChoicesSection';
import type { Socket } from 'socket.io-client';
import { ImportSheetDialog } from './ImportSheetDialog';
import { usePlayerSheet, uploadSheetPortrait } from '../hooks/usePlayerSheet';
import { useChoicesRefused } from '../hooks/useChoicesRefused';
import { canImport } from '../sheets/importable';
import {
  flowDone, flowStepName, flowSteps, savedStep, statProblem, statsToSet, stepAnswered, stepListId, whoFields,
} from '../sheets/newCharacterFlow';
import { themeRoot } from '../utils/themeRoot';

// NEW_CHARACTER.EXE (7c2; approved mockup docs/mockups/new-character.html, 2026-11-03; a terminal
// window, as ID.EXE is, the user's call of 2026-11-04). It starts with the ways in as its folders, each
// saying what it is with a button to go ahead: MAKE ONE HERE, UPLOAD A SHEET (today's IMPORT, taken as
// it is with no steps after it) and THE BLANK FORM. Making one, the folders become the steps their GM
// set, every answer written to the sheet as they go; a step opens once those before it are answered,
// as one may need an earlier one (a class, a stat). Closing it, or LEAVE FOR NOW, loses nothing: the
// place is on the sheet (backend creation.js), and the sheet's CREATING · CONTINUE opens it there
// again. What a step asks and whether it is answered is sheets/newCharacterFlow.ts. A portrait is
// uploaded on WHO THEY ARE, the sheet's own frame; the window has none above its folders, being about
// the making of a character (the user, 2026-11-04). What it says of the open folder is inside the panel,
// so the panel starts level with the folders and each one's lead-in meets it.

interface Props {
  pos: { x: number; y: number };
  setPos: (pos: { x: number; y: number }) => void;
  socket: Socket | null;
  userName: string;
  /** Who is uploading a portrait. Without it, WHO THEY ARE offers no upload. */
  authToken?: string | null;
  /** Closed with the character unfinished: their place is kept. */
  onLeave: () => void;
  /** Finished, or uploaded: the window closes on their sheet. */
  onDone: () => void;
}

/** Before the steps, while there is a choice of how to start. */
const START = 'start';
const WAYS: TerminalFolder[] = [
  { id: 'make', label: 'MAKE ONE HERE', name: 'MAKE ONE HERE' },
  { id: 'upload', label: 'UPLOAD A SHEET', name: 'UPLOAD A SHEET' },
  { id: 'form', label: 'THE BLANK FORM', name: 'THE BLANK FORM' },
];

const small: React.CSSProperties = { fontSize: '0.6rem', letterSpacing: '1px', opacity: 0.75 };
const why: React.CSSProperties = { fontSize: '0.7rem', lineHeight: 1.45, opacity: 0.85, margin: 0 };
const btn: React.CSSProperties = {
  background: 'none', border: '1px solid var(--dark-green)', color: 'var(--green)', cursor: 'pointer', whiteSpace: 'nowrap',
  fontFamily: 'inherit', fontSize: '0.65rem', letterSpacing: '1px', padding: '3px 9px', textAlign: 'center', boxSizing: 'border-box', lineHeight: 'normal',
};
const box: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--green) 6%, var(--black))', border: '1px solid var(--dark-green)', color: 'var(--green)',
  fontFamily: 'inherit', fontSize: '0.75rem', padding: '3px 6px', boxSizing: 'border-box', width: '100%',
};
const confirm: React.CSSProperties = { ...btn, borderColor: 'var(--green)', alignSelf: 'flex-start', padding: '5px 14px' };
const page: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: '10px' };
/** Says which folder is open, at the head of the panel. */
const head: React.CSSProperties = { fontSize: 10, letterSpacing: 1, opacity: 0.8 };

export function NewCharacterWindow({ pos, setPos, socket, userName, authToken, onLeave, onDone }: Props) {
  const { sheet, template, handleFieldChange } = usePlayerSheet(socket, userName);
  const refused = useChoicesRefused(socket);
  // The folder shown, ahead of the server's answer so NEXT doesn't wait on it. Null: as the sheet says.
  const [moved, setMoved] = useState<string | null>(null);
  // The way in shown, on START.
  const [way, setWay] = useState(WAYS[0].id);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importPos, setImportPos] = useState({ x: pos.x + 60, y: pos.y + 60 });
  const [formTaken, setFormTaken] = useState(false);
  const data = sheet?.data;
  const done = flowDone(data);
  useEffect(() => { if (done) onDone(); }, [done]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = `NEW_CHARACTER.EXE · ${(template?.name ?? '').toUpperCase()}`;

  if (!sheet || !template?.creation) {
    return (
      <TerminalWindow title={title} pos={pos} setPos={setPos} onClose={onLeave} panelMode="controls"
        folders={[{ id: START, label: 'START' }]} open={START} onOpen={() => {}}>
        <span style={why}>ACCESSING RECORD...</span>
      </TerminalWindow>
    );
  }

  const steps = flowSteps(template);
  // Without SHEET IMPORT there is only one way to start, so nothing to ask.
  const hasStart = canImport(sheet.system);
  const open = moved ?? savedStep(template, data) ?? (hasStart ? START : steps[0]);
  const starting = open === START;
  const index = steps.indexOf(open);
  const answered = (id: string) => stepAnswered(template, id, data);
  /** A step opens once every step before it is answered. */
  const reachable = (i: number) => steps.slice(0, i).every(answered);

  const goTo = (id: string) => {
    setMoved(id);
    if (id !== START) socket?.emit('creationAction', { kind: 'at', step: id });
  };

  const folders: TerminalFolder[] = starting ? WAYS : steps.map((id, i) => {
    const name = flowStepName(template, id);
    const ticked = id !== open && reachable(i) && answered(id);
    return { id, label: `${ticked ? '✓ ' : ''}${name}`, name: ticked ? `${name}, answered` : name, disabled: !reachable(i) };
  });

  const last = index === steps.length - 1;
  const everyAnswered = steps.every(answered);
  const canGoOn = index >= 0 && (last ? everyAnswered : answered(open));
  const actions: TerminalAction[] = [
    ...(index >= 0 ? [{
      key: 'back', label: 'BACK', disabled: index === 0 && !hasStart,
      onClick: () => goTo(index === 0 ? START : steps[index - 1]),
    }] : []),
    { key: 'leave', label: 'LEAVE FOR NOW', onClick: onLeave },
    ...(index >= 0 ? [{
      key: 'next', label: last ? 'FINISH' : 'NEXT', tone: 'primary' as const, disabled: !canGoOn,
      title: canGoOn ? undefined : 'Finish this step first',
      onClick: () => {
        if (!last) return goTo(steps[index + 1]);
        socket?.emit('creationAction', { kind: 'finish' });
        return onDone();
      },
    }] : []),
  ];

  const listId = stepListId(open);
  const body = () => {
    if (starting && way === 'make') {
      return (
        <div style={page}>
          <p style={why}>Step by step, as your GM set it up. Your answers are saved as you go, so you can leave and come back.</p>
          <p style={small}>{steps.map((id) => flowStepName(template, id)).join(' · ')}</p>
          <button type="button" style={confirm} onClick={() => goTo(steps[0])}>BEGIN</button>
        </div>
      );
    }
    if (starting && way === 'upload') {
      return (
        <div style={page}>
          <p style={why}>A filled-in form, or a sheet you already have. It is taken as it is, with no steps after it.</p>
          <button type="button" style={confirm} onClick={() => setIsImportOpen(true)}>CHOOSE A SHEET</button>
        </div>
      );
    }
    if (starting) {
      return (
        <div style={page}>
          <p style={why}>To fill in outside the game, made from this system&apos;s own sheet.</p>
          <a href="/api/sheets/import/template.pdf" download style={{ ...confirm, textDecoration: 'none' }} onClick={() => setFormTaken(true)}>DOWNLOAD THE FORM</a>
          {formTaken && <p role="status" style={{ ...why, color: 'var(--cyan)', opacity: 1 }}>Fill it in, then come back and UPLOAD A SHEET.</p>}
        </div>
      );
    }
    if (open === 'who') {
      const name = String(data?.[template.header?.nameField ?? 'name'] ?? '');
      return (
        <div style={page}>
          <p style={why}>Who they are. The rest can wait; a name can&apos;t.</p>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <BracketPortrait initial={(name.trim() || '?').charAt(0).toUpperCase()} portraitUrl={sheet.portrait_url} size={120}
              onUpload={authToken ? (file) => uploadSheetPortrait(authToken, file) : undefined} />
            <div style={{ ...page, flex: '1 1 160px', minWidth: 0 }}>
              {whoFields(template).map((f) => (
                <label key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <span style={small}>{f.label.toUpperCase()}</span>
                  {f.type === 'textarea'
                    ? <textarea aria-label={f.label} rows={3} style={{ ...box, resize: 'vertical' }} value={String(data?.[f.id] ?? '')} onChange={(e) => handleFieldChange(f.id, e.target.value)} />
                    : <input aria-label={f.label} style={box} value={String(data?.[f.id] ?? '')} onChange={(e) => handleFieldChange(f.id, e.target.value)} />}
                </label>
              ))}
            </div>
          </div>
        </div>
      );
    }
    if (open === 'stats') {
      return (
        <div style={page}>
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
        </div>
      );
    }
    if (listId) {
      return (
        <div style={page}>
          <p style={why}>Pick from these. One you don&apos;t meet is off, saying what it needs.</p>
          <ChoicesSection lists={template.choices ?? []} data={data ?? {}} readOnly={false} only={listId} takeBack
            onChoices={(action) => socket?.emit('choicesAction', action)} refused={refused} />
        </div>
      );
    }
    return null;
  };

  return (
    <>
      <TerminalWindow
        title={title}
        pos={pos}
        setPos={setPos}
        onClose={onLeave}
        panelMode="controls"
        folders={folders}
        open={starting ? way : open}
        onOpen={starting ? setWay : goTo}
        actions={actions}
        label="A new character"
      >
        <div style={page}>
          <div style={head}>{starting ? 'A NEW CHARACTER. HOW DO YOU WANT TO START?' : `${flowStepName(template, open)} · STEP ${index + 1} OF ${steps.length}`}</div>
          {body()}
        </div>
      </TerminalWindow>
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
