// NPC_LIBRARY.EXE's rules (the user, 2026-11-24: "a way of selecting a specific generated or created NPC on demand"):
// FIND across the library, every word matching the NPC's name or folder; and PLACE, a new enemy or friendly token at the
// middle of the view, on the battle map and floor being looked at, named for the NPC, then linked to its sheet. Pure: the
// window and App draw and send it.

export interface NpcRow {
  id: number;
  npc_label: string;
  folder: string | null;
  portrait_url: string | null;
  updated_at: string;
}

/** The NPCs whose name or folder holds every word typed, in the order they were; all of them with nothing typed. */
export const npcsFound = (npcs: NpcRow[], query: string): NpcRow[] => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return npcs;
  return npcs.filter((n) => {
    const text = `${n.npc_label} ${n.folder ?? ''}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
};

export type PlaceAs = 'enemy' | 'friendly';

/** The battle map and floor being looked at, if any: a placed token goes there, as one made from the admin panel does. */
export interface BattleShown { locationId: number; currentFloorIndex: number }

/** A new token for `npc`, as the admin panel's NEW ENEMY or NEW FRIENDLY makes one, named for it, at `at`. */
export const placedToken = (npc: Pick<NpcRow, 'npc_label'>, as: PlaceAs, at: { tx: number; tz: number }, battle?: BattleShown | null) => ({
  name: npc.npc_label, description: '', npcs: '', x: at.tx, y: 0, z: at.tz,
  width: 1.875, height: 1.875, depth: 1.875,
  shape: as === 'enemy' ? 'enemy_rhombus' : 'friendly_rhombus',
  color: as === 'enemy' ? 'var(--danger)' : '#00ccff',
  isFavorite: false, isDanger: false, owner: 'SYSTEM', polyCount: 5,
  battle_map_id: battle?.locationId ?? null,
  floor_index: battle?.currentFloorIndex ?? null,
});
