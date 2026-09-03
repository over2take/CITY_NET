// Cyberware you attack with (CWN p70), for offering it alongside the weapon rows.
//
// backend/sheets/cwnCyberWeapons.js is authoritative: the server resolves the attack and
// rolls the dice. This exists so the attack picker can list body weaponry at all, and so
// the line it shows matches what will be rolled. Mirrored rather than shared for the same
// reason cwnGearMods and tokenControl are - the server is CommonJS and the browser cannot
// import it. A test cross-checks the two.
//
// Only what the picker needs: which implants are weapons, what to call them, the damage to
// print, and which skills the book allows. Shock and the Trauma Die are the server's
// business and are deliberately absent here rather than duplicated for no reader.

export interface CyberWeaponSpec {
  label: string;
  dmg: string;
  /** What the book allows the attack to be rolled with; the better one is used. */
  skills: string[];
}

/** Keyed by the catalogue name, lowercased - the same match the server makes. */
export const CWN_CYBER_WEAPONS: Record<string, CyberWeaponSpec> = {
  'body blades i': { label: 'Body Blades I', dmg: '1d8', skills: ['stab', 'punch'] },
  'body blades ii': { label: 'Body Blades II', dmg: '2d6', skills: ['stab', 'punch'] },
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const specFor = (name: unknown): CyberWeaponSpec | undefined =>
  CWN_CYBER_WEAPONS[String(name ?? '').trim().toLowerCase()];

/** Whichever of the allowed skills this character is best with. Ties keep book order. */
export const bestCyberSkill = (
  data: Record<string, unknown> | undefined | null,
  skills: string[],
): string => skills.reduce((best, s) => (num(data?.[s]) > num(data?.[best]) ? s : best), skills[0]);

/**
 * The cyber weapons a character can attack with right now.
 *
 * `index` is 1-based over these, not over the cyberware list, matching what the server
 * expects in `cyberIndex` - so adding unrelated chrome above a blade does not change which
 * weapon an index names.
 *
 * Defensive about the row shape: `cyberware` is free-form JSON on a sheet people import
 * into and edit by hand, and a picker that throws is worse than one that is short.
 */
export const cyberWeaponsOf = (
  data: Record<string, unknown> | undefined | null,
): { index: number; name: string; dmg: string; skill: string }[] => {
  const rows = Array.isArray(data?.cyberware) ? (data!.cyberware as unknown[]) : [];
  const out: { index: number; name: string; dmg: string; skill: string }[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    // Owning a piece costs nothing; only fitting it does, and only a fitted blade is one
    // you can swing.
    if (!row.equipped || !row.placed) continue;
    const spec = specFor(row.name);
    if (!spec) continue;
    out.push({
      index: out.length + 1,
      name: spec.label,
      dmg: spec.dmg,
      skill: bestCyberSkill(data, spec.skills),
    });
  }
  return out;
};
