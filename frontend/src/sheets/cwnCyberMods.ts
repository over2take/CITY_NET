// Cyberware mods (CWN p71), for the parts of them the sheet owns.
//
// backend/sheets/cwnCyberMods.js is authoritative and holds the whole table. This mirror
// exists because two of the effects land on numbers the *client* computes: System Strain,
// which gates installing and is worked out in cyberwareRows, and concealment. A test
// cross-checks the two.
//
// Only the effects the sheet needs are mirrored. Monoblade, Targeting Processor and
// Hardened Weave all land on the server - in an attack roll and in the token's AC - and
// have no business being duplicated here.

/** Concealment, least obvious last - the order the book steps along. */
export const CONC_ORDER = ['obvious', 'sight', 'touch', 'medical'];

interface SheetSideEffect {
  strain?: number;
  concSteps?: number;
  setConc?: string;
  /** Minimum Strain the system must cost for the mod to do anything. */
  minStrain?: number;
  /** Needs the implant to grant a base AC. */
  needsBaseAc?: boolean;
}

/** Keyed by mod id. A mod absent here changes nothing the sheet computes. */
export const CWN_CYBER_MOD_SHEET_EFFECTS: Record<string, SheetSideEffect> = {
  tailored_interface: { strain: -1, minStrain: 2 },
  profile_adjustment: { concSteps: 1 },
  hardened_weave: { setConc: 'obvious', needsBaseAc: true },
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The base AC an implant grants, read the way the server reads it. */
const baseAcOf = (row: { mods?: unknown }): number => {
  let mods: unknown = row?.mods;
  if (typeof mods === 'string') { try { mods = JSON.parse(mods); } catch { return 0; } }
  if (!Array.isArray(mods)) return 0;
  let best = 0;
  for (const m of mods) {
    if (!m || typeof m !== 'object') continue;
    const mod = m as { target?: unknown; value?: unknown };
    if (String(mod.target ?? '').trim().toLowerCase() !== 'base ac') continue;
    const v = num(mod.value);
    if (v > best) best = v;
  }
  return best;
};

/** A row's fitted mod ids, defensively - the field is free-form JSON. */
export const fittedModIds = (row: { cyberMods?: unknown }): string[] => {
  let value: unknown = row?.cyberMods;
  if (typeof value === 'string') {
    if (value.trim() === '') return [];
    try { value = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(value) ? value.map(String) : [];
};

/** Only the mods that fit this row, matching the server's rule. */
const activeSheetEffects = (row: { hl?: unknown; mods?: unknown; cyberMods?: unknown }) =>
  fittedModIds(row)
    .map((id) => CWN_CYBER_MOD_SHEET_EFFECTS[id])
    .filter((e): e is SheetSideEffect => {
      if (!e) return false;
      if (e.minStrain !== undefined && num(row?.hl) < e.minStrain) return false;
      if (e.needsBaseAc && baseAcOf(row) <= 0) return false;
      return true;
    });

/**
 * What one implant costs in System Strain once its mods are counted.
 *
 * Tailored Interface is the reason this exists: it lowers a system's strain by a point,
 * which changes how much chrome fits, and strain is enforced when installing.
 */
export const rowStrain = (row: { hl?: unknown; mods?: unknown; cyberMods?: unknown }): number =>
  Math.max(0, num(row?.hl) + activeSheetEffects(row).reduce((n, e) => n + (e.strain ?? 0), 0));

/**
 * A row's concealment after its mods.
 *
 * Hardened Weave bolts plating on and forces Obvious; Profile Adjustment steps the other
 * way. Applied in that order, so a system with both is Obvious stepped down rather than
 * its original rating stepped down.
 */
export const rowConc = (row: { conc?: unknown; hl?: unknown; mods?: unknown; cyberMods?: unknown }): string => {
  const effects = activeSheetEffects(row);
  const forced = effects.reduce<string | null>((c, e) => e.setConc ?? c, null);
  const steps = effects.reduce((n, e) => n + (e.concSteps ?? 0), 0);
  const start = forced ?? String(row?.conc ?? '').trim().toLowerCase();
  const i = CONC_ORDER.indexOf(start);
  if (i < 0) return String(row?.conc ?? '');
  return CONC_ORDER[Math.min(CONC_ORDER.length - 1, i + steps)];
};
