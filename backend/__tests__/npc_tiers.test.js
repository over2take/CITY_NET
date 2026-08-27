import { describe, it, expect } from 'vitest';
import { TIERS, getTierOptions, buildTier } from '../sheets/npcTiers.js';
import { getWeapon } from '../sheets/attack.js';
import { effects, rollBonus } from '../sheets/cyberwareEffects.js';

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

describe('CP:R NPC chrome', () => {
  // Generated chrome is this app's kit, like the weapon rows — a Cybereye that helps you
  // spot things, not a catalogue entry. What matters is that it behaves like real chrome
  // once it is on the sheet.
  const built = (id) => buildTier('cyberpunk_red', id).data;

  it('leaves a mook unchromed', () => {
    // A mook is a mook. Full Humanity, nothing installed.
    const d = built('mook');
    expect(d.cyberware).toBeUndefined();
    expect(d.humanity).toBe(d.humanity_max);
  });

  it('chromes the higher tiers, more as they climb', () => {
    const counts = ['skilled', 'pro', 'elite'].map((id) => built(id).cyberware.length);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    expect(counts[0]).toBeGreaterThan(0);
    expect(counts.at(-1)).toBeGreaterThan(counts[0]);
  });

  it('arrives installed, so a GM does not place four pieces per mook', () => {
    for (const c of built('elite').cyberware) expect(c.placed).toBe(true);
  });

  it('gives a paired piece a side, or it would be in neither limb', () => {
    // The vanishing state: a Cyberarm placed but in no arm shows on no panel.
    const paired = built('elite').cyberware.filter((c) => ['cybereye', 'cyberarm', 'cyberleg'].includes(c.type));
    expect(paired.length).toBeGreaterThan(0);
    for (const c of paired) expect(c.side).toBeTruthy();
  });

  it('pays for the chrome out of Humanity', () => {
    const d = built('elite');
    const spent = d.cyberware.reduce((sum, c) => sum + c.hl, 0);
    expect(spent).toBeGreaterThan(0);
    expect(d.humanity).toBe(d.humanity_max - spent);
  });

  it('drops current EMP to match, the way a save would', () => {
    // applyDerived recomputes EMP from Humanity on every write. A generated sheet that
    // claimed full EMP beside four implants would be corrected the first time it saved.
    for (const id of ['mook', 'skilled', 'pro', 'elite']) {
      const d = built(id);
      expect(d.emp).toBe(Math.floor(d.humanity / 10));
      expect(d.emp).toBeLessThanOrEqual(d.emp_max);
    }
  });

  it('names things the effects layer can actually resolve', () => {
    // Chrome whose modifiers match no field would be decoration. This is the check that
    // the generated names agree with the sheet's own skill labels.
    for (const id of ['skilled', 'pro', 'elite']) {
      expect(effects(built(id)).unmatched).toEqual([]);
    }
  });

  it('actually lifts the skills it claims to', () => {
    const d = built('pro');
    expect(effects(d).fields.perception.value).toBeGreaterThan(d.perception);
  });

  it('reaches a roll type as well as a skill', () => {
    expect(rollBonus(built('pro'), 'Initiative')).toBeGreaterThan(0);
  });

  it('gives no other system chrome it has no notion of', () => {
    expect(buildTier('cities_without_number', 'mook').data.cyberware).toBeUndefined();
    expect(buildTier('shadowrun_6e', 'mook').data.cyberware).toBeUndefined();
  });
});
