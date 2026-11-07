// What the upload preview says of the picks a sheet names (7c6; approved mockup new-character): what each
// comes to, one not met coming in as it is, and what it couldn't place: a name it can't find, no room, or
// nothing opening it. An upload is the character, so it replaces what a list held, locked or not, and clears a
// list it doesn't name. The inventory it adds to, so that is said too. What is read and written is the server's
// (backend systemBuilder/sheetImport.js); ImportPreviewWindow only draws this.

import type { ImportPreview } from '../components/ImportPreviewWindow';
import type { ChoiceListShown } from './choicesShown';

/** What this sheet holds in a list, by name. */
const heldIn = (data: Record<string, unknown> | undefined, list: ChoiceListShown): string[] => {
  const picks = (data?._choices as Record<string, unknown> | undefined)?.[list.id];
  return (Array.isArray(picks) ? picks : []).flatMap((p) => {
    const id = (p as { option?: unknown } | null)?.option;
    const option = list.options.find((o) => o.id === id);
    return option ? [option.label] : [];
  });
};

/** What the window says of an upload's picks, in order. */
export const pickLinesSaid = (preview: ImportPreview, currentData?: Record<string, unknown>, lists: ChoiceListShown[] = []): { tone: 'good' | 'warn'; text: string }[] => [
  ...(preview.picksSaid ?? []).map((p) => {
    const named = `${p.one.toUpperCase()}: ${p.option.toUpperCase()}${p.level === undefined ? '' : ` ${p.level}`}`;
    return p.unmet
      ? { tone: 'warn' as const, text: `${named}, COMING IN AS IT IS: IT NEEDS ${p.unmet}` }
      : { tone: 'good' as const, text: named };
  }),
  ...Object.entries(preview.picksNotFound ?? {}).map(([line, names]) => ({ tone: 'warn' as const, text: `${line}: CAN'T FIND ${names.join(', ')}, LEFT OUT` })),
  ...Object.entries(preview.picksTooMany ?? {}).map(([line, names]) => ({ tone: 'warn' as const, text: `${line}: NO ROOM FOR ${names.join(', ')}, LEFT OUT` })),
  ...Object.entries(preview.picksUnopened ?? {}).map(([line, names]) => ({ tone: 'warn' as const, text: `${line}: NOTHING ON THIS SHEET OPENS ${names.join(', ')}, LEFT OUT` })),
  ...lists.filter((l) => !preview.picks?.[l.id]).flatMap((l) => {
    const held = heldIn(currentData, l);
    return held.length ? [{ tone: 'warn' as const, text: `${l.one.toUpperCase()}: ${held.join(', ').toUpperCase()}, CLEARED: THIS SHEET DOESN'T NAME ONE` }] : [];
  }),
  ...(preview.inventoryAdds ? [{ tone: 'good' as const, text: 'INVENTORY: ADDED TO WHAT IS ALREADY THERE. FIX IT ON THE SHEET.' }] : []),
];
