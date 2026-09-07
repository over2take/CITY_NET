// Languages a character speaks (CWN p26).
//
// The setting decides the list: p7 says outright "the world is Earth as of the late 21st
// century", so these are real languages rather than invented ones.
//
// The list cannot be complete and is not trying to be. It is one or more per major region
// so a player finds their enclave without scrolling an alphabet, and anything missing is
// typed in - which is not a convenience but a requirement, because the two languages every
// character starts with are their city's common tongue and their enclave's native one, and
// the city is invented per campaign. Neither could ever ship in a list.

/** Grouped so the picker reads by region rather than alphabetically. */
export const CWN_LANGUAGE_GROUPS: { region: string; languages: string[] }[] = [
  { region: 'Americas', languages: ['English (US)', 'Spanish', 'Portuguese', 'Haitian Creole', 'Quechua'] },
  { region: 'Europe', languages: ['English (GB)', 'French', 'German', 'Italian', 'Polish', 'Russian', 'Ukrainian'] },
  { region: 'Middle East & North Africa', languages: ['Arabic', 'Farsi', 'Turkish', 'Hebrew'] },
  { region: 'Africa', languages: ['Swahili', 'Hausa', 'Yoruba', 'Amharic', 'Zulu'] },
  { region: 'South Asia', languages: ['Hindi', 'Urdu', 'Bengali', 'Tamil', 'Punjabi'] },
  { region: 'East Asia', languages: ['Mandarin', 'Cantonese', 'Japanese', 'Korean'] },
  { region: 'Southeast Asia', languages: ['Indonesian', 'Vietnamese', 'Thai', 'Tagalog'] },
];

/** Every listed language, in the order the picker offers them. */
export const CWN_LANGUAGES: string[] = CWN_LANGUAGE_GROUPS.flatMap((g) => g.languages);

/**
 * The picker's options.
 *
 * Stored as the name itself rather than an id. A language is its own name - there is no
 * catalogue to look it up in, no stats hanging off it, and a custom one has no id to
 * invent - so an id layer would exist only to be translated back for display.
 */
export const CWN_LANGUAGE_OPTIONS = CWN_LANGUAGES.map((l) => ({ value: l, label: l }));

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Languages every character has: their city's common tongue and their native one. */
export const CWN_BASE_LANGUAGES = 2;

/**
 * How many languages one skill grants.
 *
 * "Level-0 in either grants one more language and level-1 grants two", and each level
 * after that grants another - so it is level + 1, floored at zero because untrained is -1
 * on this sheet and would otherwise come out negative.
 *
 * An empty box reads 0, which this counts as level-0 rather than as untrained. The two
 * are indistinguishable in the data - a character who really is Connect-0 types nothing
 * different from one who never took it - and every other reader on the sheet already
 * treats blank as 0, rolls included. Following that beats inventing a second convention
 * here; a character who is genuinely untrained types -1, which the hint asks for.
 */
const fromSkill = (level: unknown): number => Math.max(0, num(level) + 1);

/**
 * How many languages a character may know.
 *
 * Two to start with, plus what Connect and Know grant. The book works the example: a PC
 * with Connect-1 and Know-1 is fluent in their native tongue, the city's common language,
 * "and four additional languages of their choice".
 *
 * A GM can always allow more - the book offers months of immersion as another route - so
 * this is shown as a count rather than enforced as a limit.
 */
export const languageAllowance = (data: Record<string, unknown> | undefined | null): number =>
  CWN_BASE_LANGUAGES + fromSkill(data?.connect) + fromSkill(data?.know);

/**
 * What the line under the list says.
 *
 * Over the allowance is worth flagging and not worth blocking: immersion in a culture
 * earns another, and the GM rules on it.
 */
export const summariseLanguages = (
  known: string[],
  data: Record<string, unknown> | undefined | null,
): { text: string; warn?: boolean } => {
  const max = languageAllowance(data);
  const spoken = known.length;
  if (spoken > max) {
    return {
      text: `${spoken} / ${max} — ${spoken - max} more than Connect and Know allow. A GM can grant more for time spent in a culture.`,
      warn: true,
    };
  }
  return { text: `${spoken} / ${max} known, counting your city's common tongue and your own.` };
};
