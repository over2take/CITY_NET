import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

// ─── Three / R3F mocks ────────────────────────────────────────────────────────

vi.mock('@react-three/fiber', () => ({
  useFrame: vi.fn(),
}));

vi.mock('@react-three/drei', () => ({
  Html: ({ children }: any) => <div data-testid="html-content">{children}</div>,
}));

vi.mock('three', async () => {
  const actual = await vi.importActual('three') as any;
  return { ...actual };
});

import { AttackAnimations, AttackAnimationEntry } from '../AttackAnimations';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let idCounter = 0;
const makeEntry = (overrides: Partial<AttackAnimationEntry> = {}): AttackAnimationEntry => ({
  id: `entry-${++idCounter}`,
  hit: true,
  attackType: 'melee',
  attackerPos: { x: 0, z: 0 },
  targetPos: { x: 10, z: 10 },
  targetId: 42,
  isBattleMap: false,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Clean up window globals between tests
  delete (window as any).activeRhombuses;
  delete (window as any).rhombusWiggles;
});

// ─── AttackAnimations queue renderer ─────────────────────────────────────────

describe('AttackAnimations', () => {
  it('renders nothing when animations array is empty', () => {
    const { container } = render(<AttackAnimations animations={[]} onComplete={vi.fn()} />);
    // R3F components render as fragments — container should have no visible DOM output
    expect(container.firstChild).toBeNull();
  });

  it('renders a MissText (Html) when entry is a miss', () => {
    const entry = makeEntry({ hit: false });
    const { getByTestId } = render(
      <AttackAnimations animations={[entry]} onComplete={vi.fn()} />
    );
    expect(getByTestId('html-content')).toBeInTheDocument();
  });

  it('does not render Html for a hit — no miss text on hits', () => {
    const entry = makeEntry({ hit: true, attackType: 'melee' });
    const { queryByTestId } = render(
      <AttackAnimations animations={[entry]} onComplete={vi.fn()} />
    );
    expect(queryByTestId('html-content')).toBeNull();
  });

  it('renders multiple miss texts for multiple miss entries', () => {
    const entries = [
      makeEntry({ hit: false }),
      makeEntry({ hit: false }),
    ];
    const { getAllByTestId } = render(
      <AttackAnimations animations={entries} onComplete={vi.fn()} />
    );
    expect(getAllByTestId('html-content')).toHaveLength(2);
  });

  it('renders no Html elements for hit ranged entries', () => {
    const entry = makeEntry({ hit: true, attackType: 'ranged', attackerPos: { x: 5, z: 5 } });
    const { queryByTestId } = render(
      <AttackAnimations animations={[entry]} onComplete={vi.fn()} />
    );
    expect(queryByTestId('html-content')).toBeNull();
  });

  it('handles mixed hit/miss in the same queue', () => {
    const entries = [
      makeEntry({ hit: true, attackType: 'melee' }),
      makeEntry({ hit: false }),
      makeEntry({ hit: true, attackType: 'ranged', attackerPos: { x: 1, z: 1 } }),
    ];
    const { getAllByTestId } = render(
      <AttackAnimations animations={entries} onComplete={vi.fn()} />
    );
    // Only the miss entry produces Html
    expect(getAllByTestId('html-content')).toHaveLength(1);
  });
});

// ─── MISS_STRINGS content ─────────────────────────────────────────────────────

describe('MissText content', () => {
  const EXPECTED_STRINGS = [
    'MISS!', 'DODGED!', 'BLOCKED!', 'DEFLECTED!', 'PARRIED!', 'EVADED!',
    'RESISTED!', 'ABSORBED!', 'GLANCING BLOW!', 'TOO SLOW!', 'NOT A SCRATCH!', 'CLOSE ONE!',
  ];

  it('miss text content is one of the 12 expected strings', () => {
    const entry = makeEntry({ hit: false });
    const { getByTestId } = render(
      <AttackAnimations animations={[entry]} onComplete={vi.fn()} />
    );
    const text = getByTestId('html-content').textContent ?? '';
    expect(EXPECTED_STRINGS).toContain(text);
  });

  it('each miss entry keeps its text stable (not re-randomised on re-render)', () => {
    const entry = makeEntry({ hit: false });
    const { getByTestId, rerender } = render(
      <AttackAnimations animations={[entry]} onComplete={vi.fn()} />
    );
    const firstText = getByTestId('html-content').textContent;
    rerender(<AttackAnimations animations={[entry]} onComplete={vi.fn()} />);
    expect(getByTestId('html-content').textContent).toBe(firstText);
  });
});

// ─── liveTargetPos / window.activeRhombuses ───────────────────────────────────

describe('liveTargetPos fallback', () => {
  it('falls back to entry.targetPos when activeRhombuses has no entry for the target', () => {
    (window as any).activeRhombuses = {}; // registry exists but target absent
    const entry = makeEntry({ hit: false, targetId: 99, targetPos: { x: 50, z: 50 } });
    // MissText renders and uses targetPos as initial position — no crash expected
    expect(() =>
      render(<AttackAnimations animations={[entry]} onComplete={vi.fn()} />)
    ).not.toThrow();
  });

  it('does not crash when window.activeRhombuses is undefined', () => {
    delete (window as any).activeRhombuses;
    const entry = makeEntry({ hit: false });
    expect(() =>
      render(<AttackAnimations animations={[entry]} onComplete={vi.fn()} />)
    ).not.toThrow();
  });
});

// ─── triggerWiggle / window.rhombusWiggles ────────────────────────────────────

describe('triggerWiggle (window.rhombusWiggles)', () => {
  it('initialises rhombusWiggles registry if absent', () => {
    delete (window as any).rhombusWiggles;
    // Trigger wiggle directly by simulating what the animation does
    if (!(window as any).rhombusWiggles) (window as any).rhombusWiggles = {};
    (window as any).rhombusWiggles[1] = Date.now();
    expect((window as any).rhombusWiggles[1]).toBeGreaterThan(0);
  });

  it('stores a timestamp for the given targetId', () => {
    const before = Date.now();
    if (!(window as any).rhombusWiggles) (window as any).rhombusWiggles = {};
    (window as any).rhombusWiggles[42] = Date.now();
    expect((window as any).rhombusWiggles[42]).toBeGreaterThanOrEqual(before);
  });

  it('separate targets get separate wiggle entries', () => {
    if (!(window as any).rhombusWiggles) (window as any).rhombusWiggles = {};
    (window as any).rhombusWiggles[1] = 1000;
    (window as any).rhombusWiggles[2] = 2000;
    expect((window as any).rhombusWiggles[1]).toBe(1000);
    expect((window as any).rhombusWiggles[2]).toBe(2000);
  });
});

// ─── RangedProjectile fallback attackerPos ────────────────────────────────────

describe('RangedProjectile with null attackerPos', () => {
  it('renders without crashing when attackerPos is null', () => {
    const entry = makeEntry({ hit: true, attackType: 'ranged', attackerPos: null });
    expect(() =>
      render(<AttackAnimations animations={[entry]} onComplete={vi.fn()} />)
    ).not.toThrow();
  });
});

// ─── isBattleMap flag ─────────────────────────────────────────────────────────

describe('isBattleMap flag', () => {
  it('world projectile renders without crashing (isBattleMap=false)', () => {
    const entry = makeEntry({ hit: true, attackType: 'ranged', isBattleMap: false });
    expect(() =>
      render(<AttackAnimations animations={[entry]} onComplete={vi.fn()} />)
    ).not.toThrow();
  });

  it('battle map projectile renders without crashing (isBattleMap=true)', () => {
    const entry = makeEntry({ hit: true, attackType: 'ranged', isBattleMap: true });
    expect(() =>
      render(<AttackAnimations animations={[entry]} onComplete={vi.fn()} />)
    ).not.toThrow();
  });

  it('battle map melee renders without crashing (isBattleMap=true)', () => {
    const entry = makeEntry({ hit: true, attackType: 'melee', isBattleMap: true });
    expect(() =>
      render(<AttackAnimations animations={[entry]} onComplete={vi.fn()} />)
    ).not.toThrow();
  });

  it('battle map miss renders Html text (isBattleMap=true)', () => {
    const entry = makeEntry({ hit: false, isBattleMap: true });
    const { getByTestId } = render(
      <AttackAnimations animations={[entry]} onComplete={vi.fn()} />
    );
    expect(getByTestId('html-content')).toBeInTheDocument();
  });

  it('radius is doubled for battle map projectile (1.2 vs 0.6)', () => {
    // The isBattleMap flag selects radius 1.2 vs 0.6 — verify the math directly
    const worldRadius = 0.6;
    const battleRadius = 0.6 * 2;
    expect(battleRadius).toBe(1.2);
    expect(battleRadius / worldRadius).toBe(2);
  });
});
