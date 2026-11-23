// A drawing made on the builder's 16 by 16 pad (6c2b1 for the dice's symbols; shared since 8b0, the damage types' icons
// next): 16 rows of 16 squares, each row 4 hex digits, the first square the highest bit, as the server keeps it (backend
// systemBuilder/drawings.js). Pure, so the pad and whatever shows a drawing only draw.

/** A drawing nothing has been drawn on: 16 rows of 16 empty squares, as stored (4 hex digits a row). */
export const BLANK_DRAWN: string[] = Array.from({ length: 16 }, () => '0000');

/** Whether square (x, y) of a drawing is drawn: the row's highest bit is its first square. */
export const drawnAt = (drawn: string[], x: number, y: number): boolean => ((parseInt(drawn[y] ?? '0', 16) >> (15 - x)) & 1) === 1;

/** A drawing with square (x, y) drawn or rubbed out. */
export const withSquare = (drawn: string[], x: number, y: number, on: boolean): string[] => drawn.map((row, i) => {
  if (i !== y || x < 0 || x > 15) return row;
  const bits = parseInt(row, 16);
  const next = on ? bits | (1 << (15 - x)) : bits & ~(1 << (15 - x));
  return next.toString(16).padStart(4, '0');
});

/** The squares drawn, for drawing them: [x, y] each. */
export const drawnSquares = (drawn: string[]): [number, number][] =>
  drawn.flatMap((_, y) => Array.from({ length: 16 }, (__, x) => x).filter((x) => drawnAt(drawn, x, y)).map((x): [number, number] => [x, y]));
