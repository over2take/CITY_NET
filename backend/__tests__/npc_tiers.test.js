import { describe, it, expect } from 'vitest';
import { TIERS, getTierOptions, buildTier } from '../sheets/npcTiers.js';
import { getWeapon } from '../sheets/attack.js';

describe('CP:R NPC tiers', () => {
  it('offers four tiers', () => {
    expect(getTierOptions('cyberpunk_red').map(t => t.id)).toEqual(['mook', 'skilled', 'pro', 'elite']);
  });

  it('tiers escalate: stats, SP, HP and DV all rise', () => {
    const ids = ['mook', 'skilled', 'pro', 'elite'];
    const built = ids.map(id => buildTier('cyberpunk_red', id));
    for (let i = 1; i < built.length; i++) {
      expect(built[i].data.ref).toBeGreaterThan(built[i - 1].data.ref);
      expect(built[i].data.sp_body).toBeGreaterThan(built[i - 1].data.sp_body);
      expect(built[i].hp).toBeGreaterThan(built[i - 1].hp);
      expect(built[i].dv.ranged).toBeGreaterThan(built[i - 1].dv.ranged);
    }
  });

  it('every tier weapon row is valid for the attack engine', () => {
    getTierOptions('cyberpunk_red').forEach(({ id }) => {
      const { data } = buildTier('cyberpunk_red', id);
      expect(getWeapon(data, 1)).not.toBeNull();
    });
  });

  it('unknown tier ids fall back to the system default', () => {
    const t = buildTier('cyberpunk_red', 'boss_of_all_bosses');
    expect(t.tierId).toBe('mook');
  });

  it('systems without tiers return null', () => {
    expect(buildTier('generic', 'mook')).toBeNull();
  });

  it('death save target matches BODY in every tier', () => {
    getTierOptions('cyberpunk_red').forEach(({ id }) => {
      const { data } = buildTier('cyberpunk_red', id);
      expect(data.death_save).toBe(data.body);
    });
  });
});
