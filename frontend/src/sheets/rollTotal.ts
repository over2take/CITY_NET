// A roll's final total in its log line, found so the dice history can bold it (the user, 2026-11-11). The dice part
// of a line is its first [ ... ]: "rolled Save (Might) [3 + 13 = 16] — vs 15: SUCCESS". The total is what follows its
// last " = " ("16"), or, with nothing added, the whole of it ("[17]"); anything said after a " · " (symbols left) is not.
// Pure, so DiceTray only draws.

/** The line in three: before the total, the total, after it. Null when the line has no total to find. */
export const totalIn = (line: string): { before: string; total: string; after: string } | null => {
  const open = line.indexOf('[');
  const close = open < 0 ? -1 : line.indexOf(']', open);
  if (open < 0 || close < 0) return null;
  const inside = line.slice(open + 1, close);
  const said = inside.split(' · ')[0];
  const eq = said.lastIndexOf(' = ');
  const start = eq < 0 ? 0 : eq + 3;
  const total = said.slice(start).trim();
  if (!total) return null;
  const at = open + 1 + start + said.slice(start).indexOf(total);
  return { before: line.slice(0, at), total, after: line.slice(at + total.length) };
};
