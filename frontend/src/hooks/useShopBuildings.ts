import { useEffect, useState } from 'react';
import type { systemsApi } from '../sheets/systemsApi';

/**
 * How many buildings are each of a system's own shops in it (8a7b3b, GET /api/systems/:id/shop-buildings), for what
 * FEATURES says beside a shop and before deleting one. Null until it has answered, or with no system or API to ask.
 */
export function useShopBuildings(api: ReturnType<typeof systemsApi> | undefined, systemId: string | null | undefined): Record<string, number> | null {
  const [counts, setCounts] = useState<{ systemId: string; counts: Record<string, number> } | null>(null);
  useEffect(() => {
    if (!api || !systemId) return undefined;
    let live = true;
    api.shopBuildings(systemId).then((r) => { if (live && r.ok) setCounts({ systemId, counts: r.value.counts }); });
    return () => { live = false; };
  }, [api, systemId]);
  return counts && counts.systemId === systemId ? counts.counts : null;
}
