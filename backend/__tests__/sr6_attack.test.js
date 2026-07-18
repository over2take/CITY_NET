import { describe, it, expect } from 'vitest';
const attackSr6 = require('../sheets/attackSr6');

// rng yielding fixed d6 faces in order
const rigged = (faces) => {
  let i = 0;
  return () => (faces[i++ % faces.length] - 1 + 0.5) / 6;
};

const sheet = {
  agility: 4, firearms: 3, close_combat: 2,
  weapon1_name: 'Ares Predator', weapon1_dv: '3P', weapon1_ar: 10, weapon1_skill: 'firearms', weapon1_atk: 0,
  weapon2_name: 'Sword', weapon2_dv: '4P', weapon2_ar: 9, weapon2_skill: 'close_combat', weapon2_atk: 1,
  weapon3_name: 'Bad', weapon3_dv: 'oops', weapon3_skill: 'firearms',
  weapon4_name: 'Stunner', weapon4_dv: '5S', weapon4_ar: 7, weapon4_skill: 'close_combat',
};

describe('SR6 attack module', () => {
  it('parses DV with track, defaulting to Physical', () => {
    expect(attackSr6.parseDv('3P')).toEqual({ value: 3, track: 'P' });
    expect(attackSr6.parseDv('5s')).toEqual({ value: 5, track: 'S' });
    expect(attackSr6.parseDv('4')).toEqual({ value: 4, track: 'P' });
    expect(attackSr6.parseDv('lots')).toBeNull();
    expect(attackSr6.parseDv('')).toBeNull();
  });

  it('getWeapon validates rows; bad DV or skill is rejected', () => {
    const w = attackSr6.getWeapon(sheet, 1);
    expect(w.name).toBe('Ares Predator');
    expect(w.attackType).toBe('ranged');
    expect(attackSr6.getWeapon(sheet, 2).attackType).toBe('melee');
    expect(attackSr6.getWeapon(sheet, 3)).toBeNull(); // invalid DV
    expect(attackSr6.getWeapon(sheet, 9)).toBeNull(); // out of range
  });

  it('attack pool = attribute + skill + atk bonus, counting hits', () => {
    const w = attackSr6.getWeapon(sheet, 2); // AGI 4 + CC 2 + atk 1 = 7 dice
    const out = attackSr6.rollAttack(sheet, w, rigged([6, 5, 4, 3, 2, 1, 5]));
    expect(out.poolSize).toBe(7);
    expect(out.hits).toBe(3);
  });

  it('AR vs Armor Rating shifts DV by ±1', () => {
    const w = attackSr6.getWeapon(sheet, 1); // AR 10
    expect(attackSr6.arDvMod(w, 8)).toBe(1);   // AR beats armor
    expect(attackSr6.arDvMod(w, 12)).toBe(-1); // armor beats AR
    expect(attackSr6.arDvMod(w, 10)).toBe(0);
    expect(attackSr6.finalDamage(w, 1)).toBe(4);  // 3P + 1
    expect(attackSr6.finalDamage(w, -1)).toBe(2); // 3P - 1
  });

  it('finalDamage never goes negative', () => {
    const w = { dv: { value: 0, track: 'P' } };
    expect(attackSr6.finalDamage(w, -1)).toBe(0);
  });
});
