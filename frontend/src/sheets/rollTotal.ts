// A roll's final total in its log line, found so the dice history can bold it (the user, 2026-11-11). The dice part
// of a line is its first [ ... ]: "rolled Save (Might) [3 + 13 = 16] — vs 15: SUCCESS". The total is what follows its
// last " = " ("16"), or, with nothing added, the whole of it ("[17]"); anything said after a " · " (symbols left) is not.
// A hit's line (8b5c; the user, 2026-11-25: "the total damage at the end and highlighted"): what it took, last, "TAKES 7 OF
// 10" or "WOULD TAKE 7 OF 10", and a to-hit's HIT or MISS after its target ("→ GHOUL · VS AC 13 · MISS"), marked `hit` for the tray to draw it larger (the user: "make the total text larger"). A DAMAGE with its types (8b2a), its dice in parts "[0 + 4] + [(5, 3)]": the whole after the last
// "] = " ("4 SLASHING + 6 FIRE DMG (10)"), up to where a hit's words begin.
// Pure, so DiceTray only draws.

/** The line in three: before the total, the total, after it. Null when the line has no total to find. */
export const totalIn = (line: string): { before: string; total: string; after: string; hit?: true } | null => {
  const took = / · ((?:WOULD TAKE|TAKES) \d+(?: OF \d+)?)$/.exec(line) || / → .* · (HIT|MISS)$/.exec(line);
  // Last on the line, so everything before it stays as written.
  if (took) return { before: line.slice(0, line.length - took[1].length), total: took[1], after: '', hit: true };
  const typed = line.lastIndexOf('] = ');
  if (typed >= 0) {
    const from = typed + 4;
    const arrow = line.indexOf(' → ', from);
    const end = arrow < 0 ? line.length : arrow;
    if (line.slice(from, end).trim()) return { before: line.slice(0, from), total: line.slice(from, end), after: line.slice(end) };
  }
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
