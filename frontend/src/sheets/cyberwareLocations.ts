// Where cyberware goes, and where that is on the body.
//
// The types are the Cyberpunk RED install categories, which are labels in the same sense
// the stat and skill names are: what a thing is called, not the rules text about it.
// Nothing here encodes how much a type holds or what any piece costs — a slot limit is the
// book's, and the humanity cost of a given piece is typed in by whoever installed it.
//
// Side is a property of the row, not part of the type. An earlier pass made `Cyberarm R`
// and `Cyberarm L` separate types, which reads fine on a diagram and badly everywhere
// else: sorting a list by type then splits somebody's two arms apart, and nine categories
// become twelve. So a row carries a type and a side, and the diagram puts the two sides in
// two panels.

/**
 * The figure's centreline, as a fraction of its own width.
 *
 * Not 0.5: the trace is not centred in its own artwork, and its arms hang asymmetrically.
 * Measured by hit-testing the path rather than guessed, because guessing put several
 * anchors in the empty space beside the body.
 */
const MIDLINE = 0.428;

/** Which side of the body a row is installed on. `null` for anything unpaired. */
export type Side = 'l' | 'r' | null;

export interface CyberType {
  /** Stored on the sheet, so it must not change once anyone has data. */
  id: string;
  /** What the column and the panel heading say. */
  label: string;
  /** Whether a row of this type needs a side, and gets two panels on the figure. */
  paired: boolean;
  /**
   * Where its wire lands, as a fraction of the *drawn figure* — not of the box the figure
   * sits in. The drawing letterboxes inside its container, so measuring against the
   * container spreads every anchor across the empty space beside the body.
   *
   * Measured against `assets/body.svg` by hit-testing the path with `isPointInFill` at a
   * range of heights, which is how the hands and thighs were found rather than estimated.
   * Every one sits on ink or within 1.5% of it, and they are specific to that trace:
   * replacing the figure means measuring again.
   *
   * `null` means no wire is drawn. Internal, External, Fashionware and Borgware are kinds
   * of thing rather than places on a body, and four lines converging on one torso would be
   * inventing a precision that is not there.
   */
  anchor: { r: [number, number]; l: [number, number] } | [number, number] | null;
}

/** Ordered head down, then the categories that are not a place so much as a kind. */
export const CYBER_TYPES: CyberType[] = [
  { id: 'cyberaudio', label: 'Cyberaudio', paired: false, anchor: [0.335, 0.075] },
  // Anatomical, not positional: the figure faces you, so its right eye is on your left.
  // The book labels them the same way, and a sheet that disagrees with the book about
  // which arm is which is a sheet nobody can read aloud.
  { id: 'cybereye', label: 'Cybereye', paired: true, anchor: { r: [0.393, 0.062], l: [0.465, 0.062] } },
  { id: 'neural', label: 'Neural Link', paired: false, anchor: [MIDLINE, 0.115] },
  { id: 'cyberarm', label: 'Cyberarm', paired: true, anchor: { r: [0.090, 0.550], l: [0.890, 0.550] } },
  { id: 'cyberleg', label: 'Cyberleg', paired: true, anchor: { r: [0.294, 0.620], l: [0.557, 0.620] } },
  { id: 'internal', label: 'Internal', paired: false, anchor: null },
  { id: 'external', label: 'External', paired: false, anchor: null },
  { id: 'fashionware', label: 'Fashionware', paired: false, anchor: null },
  { id: 'borgware', label: 'Borgware', paired: false, anchor: null },
];

const BY_ID = new Map(CYBER_TYPES.map((t) => [t.id, t]));

/** A type by id, or undefined for a row filed under something that no longer exists. */
export const typeById = (id: string): CyberType | undefined => BY_ID.get(id);

/** `Cyberarm R`, or just `Neural Link` for anything unpaired. */
export const describe = (typeId: string, side: Side): string => {
  const t = BY_ID.get(typeId);
  if (!t) return typeId;
  return t.paired && side ? `${t.label} ${side.toUpperCase()}` : t.label;
};

/**
 * Words that hint a piece belongs to a type, for ordering a list of candidates.
 *
 * A suggestion, never a decision. An imported piece knows only its name — the export
 * carries no install location — so this reads the name and puts the likely matches first
 * when you are filing chrome into an arm. Guessing outright would put a Cyberaudio Suite
 * in somebody's leg and never tell them.
 *
 * Plain anatomy rather than a catalogue: eye, arm, leg, ear. Nothing here is a list of
 * products.
 */
const HINTS: Record<string, RegExp> = {
  cyberaudio: /(audio|ear|radio|amplif|sound)/i,
  cybereye: /(eye|optic|ocular|vision|sight)/i,
  neural: /(neur|chip|interface|link|processor|boost)/i,
  cyberarm: /(arm|hand|finger|grip|wrist|elbow)/i,
  cyberleg: /(leg|foot|feet|knee|ankle|jump)/i,
  fashionware: /(tattoo|hair|skinwatch|shift|light\s?tat)/i,
  borgware: /(borg|frame|implant\s?frame)/i,
};

/** Whether a name reads as though it belongs to this type. Ordering only. */
export const looksLike = (typeId: string, name: string): boolean =>
  Boolean(HINTS[typeId]?.test(String(name || '')));

export interface Panel {
  /** Unique per panel, so a paired type yields two. */
  key: string;
  typeId: string;
  side: Side;
  label: string;
  anchor: [number, number] | null;
}

/**
 * One panel per place on the figure: a paired type becomes two, everything else one.
 *
 * The diagram needs sides split apart; the table needs them together. Deriving the panels
 * here rather than storing them keeps the two views from disagreeing about what exists.
 */
export const PANELS: Panel[] = CYBER_TYPES.flatMap((t) => {
  if (!t.paired) {
    return [{
      key: t.id,
      typeId: t.id,
      side: null as Side,
      label: t.label,
      anchor: Array.isArray(t.anchor) ? t.anchor : null,
    }];
  }
  const a = t.anchor && !Array.isArray(t.anchor) ? t.anchor : null;
  return (['r', 'l'] as const).map((side) => ({
    key: `${t.id}_${side}`,
    typeId: t.id,
    side: side as Side,
    label: `${t.label} ${side.toUpperCase()}`,
    anchor: a ? a[side] : null,
  }));
});

/** The panels drawn beside the figure, in the order they stack down each side. */
export const wiredPanels = (): Panel[] => PANELS.filter((p) => p.anchor !== null);

/** The rest, which sit below without a wire. */
export const unwiredPanels = (): Panel[] => PANELS.filter((p) => p.anchor === null);

/**
 * The rectangle the figure actually occupies inside a box of the given size.
 *
 * `preserveAspectRatio` letterboxes the drawing, and every anchor is a fraction of the
 * drawing. Without this the wires point into the margins beside the body.
 */
export function drawnFigureBox(
  boxWidth: number,
  boxHeight: number,
  aspect = 560 / 1280,
): { left: number; top: number; width: number; height: number } {
  const height = Math.min(boxHeight, boxWidth / aspect);
  const width = height * aspect;
  return { left: (boxWidth - width) / 2, top: (boxHeight - height) / 2, width, height };
}
