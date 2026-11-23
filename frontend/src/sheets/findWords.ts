// How a FIND box matches (8a7c2; the user, 2026-11-23: GIVE.EXE's search "like FIND on GEAR"): what is typed, split into
// words, any case; a thing matches when it has every one of them, anywhere. GEAR's FIND (gearTypes.ts foundIn), the shop's
// QUICK FIND and GIVE.EXE's search all match this way, so "2d6 pistol" narrows the same in each.

/** What is typed into a FIND box, as the words a match must have: lower case, blanks gone. None for an empty box. */
export const findWords = (text: string): string[] => text.toLowerCase().split(/\s+/).filter(Boolean);

/** Whether every word is found, by `has` (a word in, true where the thing has it); true for no words. */
export const hasEvery = (words: string[], has: (word: string) => boolean): boolean => words.every(has);

/** Whether a thing's words (any text, any case) hold every one of `words`. */
export const textHasEvery = (text: string, words: string[]): boolean => {
  const on = text.toLowerCase();
  return hasEvery(words, (w) => on.includes(w));
};
