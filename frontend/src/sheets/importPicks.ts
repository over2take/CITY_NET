// What the upload preview says of the picks a sheet names (7c6; approved mockup new-character): what each
// comes to, one not met coming in as it is, one it can't find or has no room for, and one a player's upload
// can't replace because a roll or the GM locked that list. What is read and written is the server's
// (backend systemBuilder/sheetImport.js); ImportPreviewWindow only draws this.

import type { ImportPreview } from '../components/ImportPreviewWindow';

/** Whether this sheet holds a locked pick in a list. */
const lockedIn = (data: Record<string, unknown> | undefined, list: string): boolean => {
  const picks = (data?._choices as Record<string, unknown> | undefined)?.[list];
  return Array.isArray(picks) && picks.some((p) => !!p && typeof p === 'object' && (p as { locked?: unknown }).locked === true);
};

/** What the window says of an upload's picks, in order (7c6). */
export const pickLinesSaid = (preview: ImportPreview, currentData?: Record<string, unknown>, gm = false): { tone: 'good' | 'warn'; text: string }[] => {
  const kept = (list: string) => !gm && lockedIn(currentData, list);
  return [
    ...(preview.picksSaid ?? []).flatMap((p): { tone: 'good' | 'warn'; text: string }[] => {
      const named = `${p.one.toUpperCase()}: ${p.option.toUpperCase()}${p.level === undefined ? '' : ` ${p.level}`}`;
      if (kept(p.list)) return [{ tone: 'warn', text: `${named}, NOT TAKEN: THIS CHARACTER'S ${p.one.toUpperCase()} IS LOCKED. YOUR GM CAN CLEAR IT.` }];
      return p.unmet
        ? [{ tone: 'warn', text: `${named}, COMING IN AS IT IS: IT NEEDS ${p.unmet}` }]
        : [{ tone: 'good', text: named }];
    }),
    ...Object.entries(preview.picksNotFound ?? {}).map(([line, names]) => ({ tone: 'warn' as const, text: `${line}: CAN'T FIND ${names.join(', ')}, LEFT OUT` })),
    ...Object.entries(preview.picksTooMany ?? {}).map(([line, names]) => ({ tone: 'warn' as const, text: `${line}: NO ROOM FOR ${names.join(', ')}, LEFT OUT` })),
  ];
};
