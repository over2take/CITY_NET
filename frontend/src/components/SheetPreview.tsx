import React, { useMemo, useState } from 'react';
import { SheetRenderer } from './SheetRenderer';
import { templateFromRender, type CustomRender, type CustomRenderSheet } from '../sheets/customTemplates';
import type { Definition } from '../sheets/systemsApi';
import { formulaList, sampleOf, allStats } from '../sheets/statsRules';
import { othersSee } from '../sheets/publicLines';

// The CHARACTER SHEET page's preview (4b3d2): the sheet as the game draws it, by the game's own
// SheetRenderer, seen as its owner or as the GM, and what everyone else gets: the lines of the
// character's ID.EXE INFO (decided with the user 2026-10-07: a custom system shows its name and
// every EVERYONE field there, 4b3e). Values are a made-up character: the SAMPLE values from STATS &
// RULES and the formulas worked out from them. Typing in it tries the sheet out; nothing is saved.

type View = 'owner' | 'gm' | 'others';

const small: React.CSSProperties = { fontSize: 10, letterSpacing: 2, opacity: 0.75 };
const why: React.CSSProperties = { fontSize: 12, lineHeight: 1.45, opacity: 0.85 };
const segBtn = (on: boolean): React.CSSProperties => ({
  background: on ? 'var(--green)' : 'none', color: on ? 'var(--black)' : 'var(--green)', border: 0, fontFamily: 'monospace', fontSize: 11, padding: '4px 9px', cursor: 'pointer',
});

/** The name a made-up character gets. */
export const SAMPLE_NAME = 'Sample character';

interface Props {
  definition: Definition;
  /** The sheet as the server draws it (its own or the starter, without parts that are off). */
  sheet: CustomRenderSheet;
  /** Formulas worked out from the sample character. */
  values: Record<string, number>;
  /** An NPC's stat block: only the GM ever sees it, so there is no one else to show it as. */
  gmOnly?: boolean;
}

export function SheetPreview({ definition, sheet, values, gmOnly = false }: Props) {
  const [chosen, setView] = useState<View>('owner');
  const view: View = gmOnly ? 'gm' : chosen;
  const [tried, setTried] = useState<Record<string, unknown>>({});

  const template = useMemo(() => templateFromRender({
    id: 'sys_0000000000000000',
    name: definition.name,
    derived: formulaList(definition).map((f) => f.id),
    sheet,
  } as unknown as CustomRender), [definition, sheet]);

  const samples = Object.fromEntries(allStats(definition).map((s) => [s.id, sampleOf(definition, s.id)]).filter(([, v]) => v !== null));
  const data: Record<string, unknown> = { name: SAMPLE_NAME, ...samples, ...values, ...tried };

  return (
    <div data-testid="sheet-preview" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {gmOnly ? <span style={small}>AS THE GM SEES IT</span> : (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={small}>SEEN BY</span>
          <span role="group" aria-label="Seen by" style={{ display: 'inline-flex', border: '1px solid var(--green)' }}>
            {([['owner', 'ITS OWNER'], ['gm', 'THE GM'], ['others', 'EVERYONE ELSE']] as const).map(([id, label]) => (
              <button key={id} type="button" style={segBtn(view === id)} aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>
            ))}
          </span>
        </div>
      )}
      {view === 'others' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <p style={{ ...why, margin: 0 }}>Other players and spectators, in ID.EXE&apos;s INFO when they open this character&apos;s token. Everything else stays with the owner and the GM.</p>
          <div data-testid="others-see" style={{ border: '1px solid var(--green)', padding: '8px 10px', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {othersSee(sheet, data).map((line) => (
              <div key={line.label} style={{ display: 'flex', gap: 10 }}>
                <span style={{ ...small, minWidth: 90 }}>{line.label.toUpperCase()}</span>
                <span style={{ color: 'var(--green)' }}>{line.value}</span>
              </div>
            ))}
          </div>
          {othersSee(sheet, data).length <= 1 && <p style={{ ...why, fontSize: 11, margin: 0 }}>Only the name. Set a field&apos;s WHO SEES IT to EVERYONE to show it here.</p>}
        </div>
      ) : (
        <>
          <p style={{ ...why, margin: 0, fontSize: 11 }}>
            {view === 'gm' ? 'The GM changes everything but worked-out values.' : 'Fields only the GM changes are locked for the owner.'} A made-up character: type to try it out, nothing is saved.
          </p>
          <div style={{ border: '1px solid var(--dark-green)', maxWidth: 620 }}>
            <SheetRenderer key={view} template={template} data={data as never} gm={view === 'gm'}
              onFieldChange={(id, value) => setTried((t) => ({ ...t, [id]: value }))} />
          </div>
        </>
      )}
    </div>
  );
}
