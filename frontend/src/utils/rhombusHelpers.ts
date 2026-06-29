export function mergeRhombusHealthFromLocation(existing: any, prev: any) {
  return {
    color: existing.color || prev.color,
    name: existing.name || '',
    description: existing.description || '',
    hp_max: existing.hp_max || 0,
    hp_current: existing.hp_current != null ? existing.hp_current : (existing.hp_max || prev.hp_current),
    hp_temp: existing.hp_temp ?? 0,
  };
}

/**
 * Resolves hp values for a deploy payload.
 * When an existing DB record is present, trust its values.
 * When no record exists (first deploy after exiting a battle map), carry over
 * rhombusState so damaged health is not silently reset to max.
 */
export function resolveDeployHealth(existing: any | null, rhombusState: any) {
  if (existing) {
    return {
      hp_max: existing.hp_max ?? 100,
      hp_current: existing.hp_current ?? existing.hp_max ?? 100,
      hp_temp: existing.hp_temp ?? 0,
    };
  }
  return {
    hp_max: rhombusState.hp_max || 100,
    hp_current: rhombusState.hp_current || rhombusState.hp_max || 100,
    hp_temp: rhombusState.hp_temp || 0,
  };
}
