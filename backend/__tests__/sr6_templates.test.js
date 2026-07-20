import { describe, it, expect } from 'vitest';
const { TEMPLATES, applyDerived, getLinkedFields, filterPublicData } = require('../sheets/templates');
const { getRoll, SR6_SKILLS } = require('../sheets/rolls');
const { parseFormula } = require('../sheets/rollEngine');
const npcTiers = require('../sheets/npcTiers');
const { getImporter } = require('../sheets/importers');

describe('SR6 backend template', () => {
  it('is registered with name/description public and armor linked to the token', () => {
    const meta = TEMPLATES.shadowrun_6e;
    expect(meta).toBeTruthy();
    expect(meta.publicFields).toContain('name');
    expect(meta.publicFields).toContain('description');
    expect(getLinkedFields('shadowrun_6e').armor_rating).toBe('token_ac');
    expect(getLinkedFields('shadowrun_6e').hp).toBe('token_hp');
  });

  it('derives monitors, initiative and composure from attributes', () => {
    const data = { body: 5, willpower: 4, reaction: 3, intuition: 4, charisma: 2 };
    applyDerived('shadowrun_6e', data, 'body');
    expect(data.physical_monitor).toBe(11); // 8 + ceil(5/2)
    expect(data.stun_monitor).toBe(10);     // 8 + ceil(4/2)
    expect(data.initiative_score).toBe(7);  // REA 3 + INT 4
    expect(data.composure).toBe(6);         // WIL 4 + CHA 2
  });

  it('filterPublicData exposes identity but not combat fields', () => {
    const data = JSON.stringify({ name: 'Shade', metatype: 'Ork', role: 'Samurai', description: 'chromed', armor_rating: 12, firearms: 5 });
    const pub = filterPublicData('shadowrun_6e', data);
    expect(pub).toEqual({ name: 'Shade', metatype: 'Ork', role: 'Samurai', description: 'chromed' });
  });

  it('every SR6 skill has a parseable pool roll', () => {
    Object.keys(SR6_SKILLS).forEach((id) => {
      const def = getRoll('shadowrun_6e', id);
      expect(def, id).toBeTruthy();
      expect(def.shape).toBe('pool');
      expect(() => parseFormula(def.formula)).not.toThrow();
    });
    expect(getRoll('shadowrun_6e', 'composure').shape).toBe('pool');
    expect(getRoll('shadowrun_6e', 'initiative_score').shape).toBe('sum');
  });

  it('NPC tiers build consistent monitors and weapon rows', () => {
    const tier = npcTiers.buildTier('shadowrun_6e', 'shadowrunner');
    expect(tier).toBeTruthy();
    expect(tier.data.physical_monitor).toBe(8 + Math.ceil(tier.data.body / 2));
    expect(tier.hp).toBe(tier.data.physical_monitor);
    expect(tier.data.weapon1_dv).toMatch(/^\d+[PS]$/);
    expect(tier.dv.melee).toBe(tier.data.armor_rating);
    // unknown tier falls back to the default
    expect(npcTiers.buildTier('shadowrun_6e', 'nope').tierId).toBe('ganger');
  });

  it('importer maps attribute aliases and seeds Edge current from max', () => {
    const importer = getImporter('shadowrun_6e');
    const { mapped, skipped } = importer.mapFields({ BOD: '5', agi: '4', Edge: '3', armor: '10', firearms: '4', name: 'Shade' });
    expect(mapped.body).toBe(5);
    expect(mapped.agility).toBe(4);
    expect(mapped.edge_max).toBe(3);
    expect(mapped.edge).toBe(3);
    expect(mapped.firearms).toBe(4);
    expect(mapped.name).toBe('Shade');
    // armor_rating is a linked field - routed to the token, not sheet JSON
    expect(skipped.armor).toBe('10');
  });
});
